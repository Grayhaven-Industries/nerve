/**
 * HIR shape guard: nothing else watches the schema's SHAPE. Instance
 * snapshots only catch fields the fixtures happen to populate, and plugins
 * gate on HIR_SCHEMA_VERSION — so a silent structural change is a contract
 * break waiting to ship.
 *
 * The Effect schema serializes to JSON Schema and is compared against the
 * committed tests/__snapshots__/hir-shape.json:
 *
 * - ADDITIVE optional fields (the documented matingMpn/reservedPins
 *   policy): allowed, but the snapshot must be refreshed in the same
 *   commit — UPDATE_HIR_SHAPE=1 bun ... vitest run hir-shape
 * - Anything else (removed field, type change, new REQUIRED field):
 *   bump HIR_SCHEMA_VERSION, then refresh.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Schema } from "effect"
import { describe, expect, it } from "vitest"
// Relative import: root-level tests sit outside the workspace packages,
// so the @grayhaven/nerve specifier does not resolve here.
import { hirJsonSchema, HIR_SCHEMA_VERSION } from "../packages/nerve/src/index.js"
import { isJsonObject, isJsonString, JsonValue, parseJson } from "../scripts/json.js"

const SNAP_DIR = join(import.meta.dirname, "__snapshots__")
const SNAP_PATH = join(SNAP_DIR, "hir-shape.json")

const Snapshot = Schema.Struct({
  hirSchemaVersion: Schema.String,
  jsonSchema: JsonValue
})
type Snapshot = Schema.Schema.Type<typeof Snapshot>
const readSnapshot = (): Snapshot =>
  Schema.decodeUnknownSync(Snapshot)(JSON.parse(readFileSync(SNAP_PATH, "utf8")))

const current = (): Snapshot => ({
  hirSchemaVersion: HIR_SCHEMA_VERSION,
  jsonSchema: parseJson(JSON.stringify(hirJsonSchema()))
})

const isObj = isJsonObject

/** A JSON Schema `required` list: the property names it holds, or none. */
const requiredNames = (v: JsonValue | undefined): ReadonlyArray<string> =>
  Array.isArray(v) ? v.filter(isJsonString) : []

/**
 * Collect BREAKING differences old → new. Additions of optional properties
 * (and anything nested inside them) are fine; everything else is reported.
 */
const breakingDiffs = (
  oldS: JsonValue | undefined,
  newS: JsonValue | undefined,
  path: string
): Array<string> => {
  if (isObj(oldS) && isObj(newS)) {
    const diffs: Array<string> = []
    // Object schemas: compare properties + required with the additive rule.
    if (oldS["type"] === "object" && newS["type"] === "object") {
      const oldProps = isObj(oldS["properties"]) ? oldS["properties"] : {}
      const newProps = isObj(newS["properties"]) ? newS["properties"] : {}
      const oldReq = new Set(requiredNames(oldS["required"]))
      const newReq = new Set(requiredNames(newS["required"]))
      for (const key of Object.keys(oldProps)) {
        if (!(key in newProps)) diffs.push(`${path}.${key}: removed`)
        else diffs.push(...breakingDiffs(oldProps[key], newProps[key], `${path}.${key}`))
      }
      for (const key of Object.keys(newProps)) {
        if (!(key in oldProps) && newReq.has(key)) {
          diffs.push(`${path}.${key}: added as REQUIRED (additive fields must be optional)`)
        }
      }
      for (const key of oldReq) {
        if (!newReq.has(key)) diffs.push(`${path}.${key}: required → optional (readers may rely on presence)`)
      }
      for (const key of newReq) {
        if (!oldReq.has(key) && key in oldProps) diffs.push(`${path}.${key}: optional → required`)
      }
      // Records carry their value-type in additionalProperties, not
      // properties — recurse into it, or a breaking change to a record's
      // value type (e.g. the diagnostic `data` Record) reads as additive.
      if (oldS["additionalProperties"] !== undefined || newS["additionalProperties"] !== undefined) {
        diffs.push(
          ...breakingDiffs(oldS["additionalProperties"], newS["additionalProperties"], `${path}{}`)
        )
      }
      // Non-structural keys (description, $schema, …) are not contract.
      return diffs
    }
    // Everything else: key-wise deep compare (arrays/unions/literals).
    const keys = new Set([...Object.keys(oldS), ...Object.keys(newS)])
    for (const key of keys) {
      if (key === "description" || key === "$schema" || key === "title") continue
      if (!(key in newS)) diffs.push(`${path}.${key}: removed`)
      else if (!(key in oldS)) diffs.push(`${path}.${key}: added`)
      else diffs.push(...breakingDiffs(oldS[key], newS[key], `${path}.${key}`))
    }
    return diffs
  }
  if (Array.isArray(oldS) && Array.isArray(newS)) {
    if (oldS.length !== newS.length) return [`${path}: arity ${oldS.length} → ${newS.length}`]
    return oldS.flatMap((v, i) => breakingDiffs(v, newS[i], `${path}[${i}]`))
  }
  return Object.is(oldS, newS) ? [] : [`${path}: ${JSON.stringify(oldS)} → ${JSON.stringify(newS)}`]
}

describe("HIR shape snapshot", () => {
  it("schema shape changes are deliberate", () => {
    const now = current()
    if (!existsSync(SNAP_PATH) || process.env["UPDATE_HIR_SHAPE"] === "1") {
      mkdirSync(SNAP_DIR, { recursive: true })
      writeFileSync(SNAP_PATH, JSON.stringify(now, null, 2) + "\n")
      return
    }
    const committed = readSnapshot()

    const breaking = breakingDiffs(committed.jsonSchema, now.jsonSchema, "hir")
    if (breaking.length > 0 && committed.hirSchemaVersion === now.hirSchemaVersion) {
      expect.fail(
        `HIR shape changed incompatibly without a HIR_SCHEMA_VERSION bump:\n` +
          breaking.map((d) => `  - ${d}`).join("\n") +
          `\nBump HIR_SCHEMA_VERSION (and migration story), then refresh with UPDATE_HIR_SHAPE=1.`
      )
    }

    // Additive-only drift still requires a deliberate snapshot refresh.
    expect(
      now,
      `HIR shape drifted from the committed snapshot (additively). ` +
        `Refresh deliberately: UPDATE_HIR_SHAPE=1 bun run test tests/hir-shape`
    ).toEqual(committed)
  })

  it("snapshot version matches the live schema version", () => {
    if (!existsSync(SNAP_PATH)) return
    const committed = readSnapshot()
    expect(committed.hirSchemaVersion).toBe(HIR_SCHEMA_VERSION)
  })
})

describe("breaking-diff classifier", () => {
  const base = {
    type: "object",
    required: ["a"],
    properties: { a: { type: "string" }, b: { type: "number" } }
  }

  it("added optional field is NOT breaking", () => {
    const next = {
      ...base,
      properties: { ...base.properties, c: { type: "string" } }
    }
    expect(breakingDiffs(base, next, "x")).toEqual([])
  })

  it("added REQUIRED field is breaking", () => {
    const next = {
      ...base,
      required: ["a", "c"],
      properties: { ...base.properties, c: { type: "string" } }
    }
    expect(breakingDiffs(base, next, "x")).toContainEqual(expect.stringContaining("REQUIRED"))
  })

  it("removed field is breaking", () => {
    const next = { type: "object", required: ["a"], properties: { a: { type: "string" } } }
    expect(breakingDiffs(base, next, "x")).toContainEqual(expect.stringContaining("removed"))
  })

  it("type change is breaking", () => {
    const next = {
      ...base,
      properties: { a: { type: "number" }, b: { type: "number" } }
    }
    expect(breakingDiffs(base, next, "x").length).toBeGreaterThan(0)
  })

  it("optional → required is breaking", () => {
    const next = { ...base, required: ["a", "b"] }
    expect(breakingDiffs(base, next, "x")).toContainEqual(expect.stringContaining("optional → required"))
  })

  it("a record's value-type change (additionalProperties) is breaking", () => {
    // e.g. diagnostics.data going from Record<string, string|number> to
    // Record<string, string> — invisible if we only diff `properties`.
    const rec = { type: "object", properties: {}, additionalProperties: { type: ["string", "number"] } }
    const narrowed = { type: "object", properties: {}, additionalProperties: { type: "string" } }
    expect(breakingDiffs(rec, narrowed, "x").length).toBeGreaterThan(0)
    expect(breakingDiffs(rec, rec, "x")).toEqual([])
  })
})

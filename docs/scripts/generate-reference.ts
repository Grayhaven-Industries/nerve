/**
 * Reference generation: the parts of the docs that are extracted from
 * @grayhaven/* source rather than written by hand. Every fragment below is
 * included into an authored page with `<include>`, so the prose stays in
 * MDX and the tables cannot drift from the code.
 *
 * Run from the repository root (`bun run docs:reference`) — the imports
 * below reach package sources by relative path, and those sources resolve
 * their own dependencies through the workspace install.
 *
 * Fragments are `.md`, not `.mdx`: fumadocs parses an included `.md` as
 * markdown, so generated type strings like `Array<string>` and `{ a, b }`
 * are never read as JSX.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { JsonSchema7, JsonSchema7Root } from "effect/JSONSchema"
import { HIR_SCHEMA_VERSION, hirJsonSchema } from "../../packages/nerve/src/index.ts"
import { allParts, partSpecs } from "../../packages/nerve-connectors/src/index.ts"
import { builtinRules } from "../../packages/nerve-rules/src/index.ts"
// The editor and the docs share one summary table and one DSL extractor:
// two copies would be two things to keep true.
import { dslReferenceMd, extractDslMeta } from "../../packages/nerve-web/scripts/extract-dsl.ts"
import { RULE_SUMMARIES } from "../../packages/nerve-web/src/docs/rule-summaries.ts"

const ROOT = join(import.meta.dirname, "..", "..")
const OUT = join(import.meta.dirname, "..", "content", "generated")

// These fragments are included into MDX pages, and an HTML comment survives
// markdown parsing as a `raw` node that MDX cannot compile. The "generated,
// do not edit" notice therefore lives in content/generated/README.md, not at
// the top of each file.
const BANNER = ""

/** Every built-in rule with its stable code and one-line summary. */
const rulesFragment = (): string => {
  const rows = builtinRules
    .map((r) => `| \`${r.code}\` | \`${r.name}\` | ${RULE_SUMMARIES.get(r.name) ?? "-"} |`)
    .join("\n")
  return `${BANNER}Nerve ships ${builtinRules.length} built-in rules.

| Code | Rule | Checks |
| --- | --- | --- |
${rows}
`
}

/** Any node the schema walk can reach: a schema, an \`anyOf\` member (Effect
 * encodes Schema.Object / \`{}\` with bare \`{ type }\` members), an \`items\`
 * tuple, or an absent/boolean slot. */
type SchemaNode = JsonSchema7 | { type: "object" } | Array<JsonSchema7> | boolean | undefined

/** HIR field tables, generated from the live Effect schema. */
const hirFragment = (): string => {
  // SAFETY: hirJsonSchema() is JSONSchema.make(Hir) round-tripped through
  // JSON.stringify/parse, so its structure is Effect's JsonSchema7Root (the
  // round trip only drops undefined-valued keys).
  const schema = hirJsonSchema() as JsonSchema7Root
  // Effect emits Schema.Unknown as { $id: "/schemas/unknown" } (or {}).
  // Match it precisely — a stringify-includes check would mis-flag any
  // struct that merely CONTAINS an unknown field as wholly unknown.
  const isUnknownSchema = (s: JsonSchema7 | { type: "object" }): boolean =>
    ("$id" in s && s.$id === "/schemas/unknown") ||
    ("$ref" in s && s.$ref.endsWith("/unknown")) ||
    Object.keys(s).length === 0
  // A record (Schema.Record) is an object with NO declared properties but
  // an additionalProperties value-schema — distinct from a struct.
  const isRecord = (s: JsonSchema7 | { type: "object" }): boolean =>
    "type" in s &&
    s.type === "object" &&
    (!("properties" in s) || Object.keys(s.properties).length === 0)
  const typeOf = (s: SchemaNode): string => {
    if (s === undefined || s === true || s === false || Array.isArray(s)) return "unknown"
    if ("enum" in s) return s.enum.map((e) => JSON.stringify(e)).join(" \\| ")
    if ("anyOf" in s) return s.anyOf.map(typeOf).join(" \\| ")
    if ("type" in s && s.type === "array") return `Array<${typeOf(s.items)}>`
    // Record before the unknown check: a record-of-unknown is
    // Record<string, unknown>, not bare "unknown".
    if (isRecord(s)) {
      const values = "additionalProperties" in s ? s.additionalProperties : undefined
      const valueType =
        values !== undefined && values !== true && values !== false ? typeOf(values) : "unknown"
      return `Record<string, ${valueType}>`
    }
    if (isUnknownSchema(s)) return "unknown"
    if ("type" in s && s.type === "object" && "properties" in s) {
      return `{ ${Object.keys(s.properties).join(", ")} }`
    }
    return String(("type" in s ? s.type : undefined) ?? "unknown")
  }
  const table = (name: string, s: JsonSchema7): string => {
    // Arrays of structs document the element shape.
    const target =
      "type" in s &&
      s.type === "array" &&
      s.items !== undefined &&
      s.items !== false &&
      !Array.isArray(s.items)
        ? s.items
        : s
    // Records and property-less objects have no field table — render the
    // single-line type form rather than an empty header-only table.
    if (
      isRecord(target) ||
      !("properties" in target) ||
      Object.keys(target.properties).length === 0
    ) {
      return `## ${name}\n\nType: \`${typeOf(s)}\`\n`
    }
    const req = new Set(target.required)
    const rows = Object.entries(target.properties)
      .map(([k, v]) => {
        const desc = (v.description ?? "").replace(/\n+/g, " ")
        return `| \`${k}\` | \`${typeOf(v)}\` | ${req.has(k) ? "yes" : "no"} | ${desc} |`
      })
      .join("\n")
    const prefix = "type" in s && s.type === "array" ? "Array of:" : ""
    return `## ${name}\n\n${prefix}\n\n| Field | Type | Required | Notes |\n| --- | --- | --- | --- |\n${rows}\n`
  }
  const props = "properties" in schema ? schema.properties : {}
  const sections = Object.entries(props)
    .map(([k, v]) => table(k, v))
    .join("\n")
  return `${BANNER}The current schema version is \`${HIR_SCHEMA_VERSION}\`.

${sections}
## Versioning

\`schemaVersion\` is \`${HIR_SCHEMA_VERSION}\`. Additive optional fields may appear without a version bump (guarded by the shape-snapshot test). Removals, type changes, and new required fields bump the version.
`
}

interface PartRow {
  readonly spec?: string
  readonly mpn: string
  readonly family?: string
  readonly description?: string
  readonly pinCount: number
  readonly gender?: string
  readonly verification?: string
}

const partRow = (mpn: string, spec: string | undefined): PartRow => {
  const p = allParts[mpn]!
  return {
    spec,
    mpn,
    family: p.family,
    description: p.description,
    pinCount: p.pinCount,
    gender: p.gender,
    verification: p.provenance?.verification
  }
}

/** The shipped connector library, specs first (the way parts should be reached). */
const partsFragment = (): string => {
  const bySpec = new Map<string, string>()
  for (const [spec, mpn] of Object.entries(partSpecs)) {
    // First spec for an MPN wins the row; aliases are listed separately.
    if (!bySpec.has(mpn)) bySpec.set(mpn, spec)
  }
  const speced = new Set(bySpec.keys())
  const rows: Array<PartRow> = []
  for (const [mpn, spec] of [...bySpec.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    rows.push(partRow(mpn, spec))
  }
  for (const mpn of Object.keys(allParts).sort()) {
    if (speced.has(mpn)) continue
    rows.push(partRow(mpn, undefined))
  }
  const table = rows
    .map(
      (r) =>
        `| ${r.spec !== undefined ? `\`${r.spec}\`` : ""} | \`${r.mpn}\` | ${r.family ?? ""} | ${r.pinCount} | ${r.gender ?? ""} | ${r.verification ?? ""} | ${r.description ?? ""} |`
    )
    .join("\n")
  const aliases = Object.entries(partSpecs)
    .filter(([, mpn], i, all) => all.findIndex(([, m]) => m === mpn) !== i)
    .map(([s]) => `\`${s}\``)
    .join(", ")
  return `${BANNER}The library ships ${Object.keys(allParts).length} connectors reachable by ${Object.keys(partSpecs).length} compact specs.

| Spec | MPN | Family | Pins | Gender | Verification | Description |
| --- | --- | --- | --- | --- | --- | --- |
${table}

These aliases resolve to the same housings as their primary specs: ${aliases}.
`
}

const dslFragment = (): string => `${BANNER}${dslReferenceMd(extractDslMeta())}`

/**
 * The repository CHANGELOG, demoted one level so its version headings sit
 * under the page title. Emitted as markdown rather than MDX on purpose: the
 * changelog is prose nobody writes with a docs parser in mind, and a stray
 * `Record<...>` outside backticks would otherwise fail the build.
 */
const changelogFragment = (): string => {
  const src = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8")
  // Drop the file's own H1; the page title supplies it. Version headings
  // are already `##`, which is exactly the level a docs page section wants.
  const body = src.replace(/^#\s.*\n/, "")
  return `${BANNER}${body.trimEnd()}\n`
}

mkdirSync(OUT, { recursive: true })

const files: ReadonlyArray<readonly [string, string]> = [
  ["rules-table.md", rulesFragment()],
  ["hir-schema.md", hirFragment()],
  ["part-library.md", partsFragment()],
  ["dsl-reference.md", dslFragment()],
  ["changelog.md", changelogFragment()]
]

let changed = 0
for (const [name, body] of files) {
  const path = join(OUT, name)
  let current: string | undefined
  try {
    current = readFileSync(path, "utf8")
  } catch {
    current = undefined
  }
  if (current !== body) {
    writeFileSync(path, body)
    changed += 1
  }
}

console.log(
  `docs reference: ${files.length} fragments, ${changed} written (${builtinRules.length} rules, HIR ${HIR_SCHEMA_VERSION}, ${Object.keys(allParts).length} parts)`
)

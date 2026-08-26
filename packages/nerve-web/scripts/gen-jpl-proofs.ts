/**
 * Generates src/showcase/jpl-proofs.json at build time so the showcase route
 * ships precomputed proofs instead of running the compiler, wireviz importer,
 * and rules on the main thread at module evaluation.
 * Run: bun scripts/gen-jpl-proofs.ts
 */
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { compileDesign, runRules, type Hir } from "@grayhaven/nerve"
import {
  bomTable,
  cutListTable,
  generateTestPlan,
  hirFingerprint,
  schematicSvg,
  type TableData
} from "@grayhaven/nerve-exporters"
import { builtinRules } from "@grayhaven/nerve-rules"
import { importWireViz } from "@grayhaven/nerve-wireviz"

const FIXTURES = join(
  import.meta.dir,
  "../../nerve-wireviz/test/fixtures/jpl-open-source-rover"
)
const OUT = join(import.meta.dir, "../src/showcase/jpl-proofs.json")

const readFixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), "utf8")

const templates = readFixture("templates.yml")

const corpus = [
  { slug: "front-encoder", name: "Front encoder", source: readFixture("front_encoder.yml") },
  { slug: "front-servo", name: "Front servo", source: readFixture("front_servo.yml") },
  { slug: "middle-encoder", name: "Middle encoder", source: readFixture("middle_encoder.yml") },
  { slug: "back-encoder", name: "Back encoder", source: readFixture("back_encoder.yml") },
  { slug: "back-servo", name: "Back servo", source: readFixture("back_servo.yml") },
  { slug: "encoder-extension", name: "Encoder extension", source: readFixture("encoder_extension.yml") }
] as const

/**
 * Table cells are `string | number | undefined`; JSON arrays cannot hold
 * undefined, so store empty cells as null. jpl-rover.ts revives null back to
 * undefined at load time so exported values match the original exactly.
 */
const jsonTable = (table: TableData) => ({
  headers: table.headers,
  rows: table.rows.map((row) => row.map((cell) => cell ?? null))
})

const buildProof = (entry: (typeof corpus)[number]) => {
  const imported = importWireViz(entry.source, {
    harnessId: `jpl-${entry.slug}`,
    revision: "A",
    prependYaml: [templates]
  })
  const compiled = compileDesign(imported.design)
  const beforeRules: Hir = {
    ...compiled.hir,
    diagnostics: [...imported.diagnostics, ...compiled.diagnostics]
  }
  const reviewDiagnostics = runRules(beforeRules, builtinRules)
  const hir: Hir = {
    ...beforeRules,
    diagnostics: [...beforeRules.diagnostics, ...reviewDiagnostics]
  }

  return {
    ...entry,
    title: imported.design.metadata?.["sourceTitle"] ?? entry.name,
    hir,
    schematic: schematicSvg(hir),
    fingerprint: hirFingerprint(hir),
    importDiagnostics: imported.diagnostics,
    reviewDiagnostics,
    bom: jsonTable(bomTable(hir)),
    cutList: jsonTable(cutListTable(hir)),
    testPlan: generateTestPlan(hir),
    releaseReady: !hir.diagnostics.some((diagnostic) => diagnostic.severity === "error")
  }
}

const harnesses = corpus.map(buildProof)

const summary = {
  designs: harnesses.length,
  conductors: harnesses.reduce((total, proof) => total + proof.hir.wires.length, 0),
  ruleCount: builtinRules.length,
  packetFiles: 22
}

const payload = { harnesses, summary }

/** Fail loudly if anything in the payload would be lost by JSON serialization.
 * Polymorphic over the payload: every slot is classified at runtime (null,
 * array, plain object, primitive), whatever its static type claims. */
const assertSerializable = <T>(value: T, path: string): void => {
  if (value === null) return
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSerializable(item, `${path}[${index}]`))
    return
  }
  if (value instanceof Object) {
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`Non-plain object (${proto?.constructor?.name ?? "unknown"}) at ${path}`)
    }
    for (const [key, entry] of Object.entries(value)) {
      assertSerializable(entry, `${path}.${key}`)
    }
    return
  }
  // A primitive slot. JSON drops undefined and symbols outright and turns
  // non-finite numbers into null; both are silent data loss. (A bigint makes
  // JSON.stringify throw on its own.)
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error(`Non-serializable value at ${path}`)
  if (encoded === "null") throw new Error(`Non-finite number at ${path}`)
}

assertSerializable(payload, "payload")

const text = JSON.stringify(payload, null, 2)
const rebuilt = JSON.parse(text)
if (JSON.stringify(rebuilt) !== JSON.stringify(payload)) {
  throw new Error("jpl-proofs.json round-trip lost data; refusing to write")
}

writeFileSync(OUT, `${text}\n`)
console.log(
  `Wrote ${OUT}: ${harnesses.length} harnesses, ${summary.conductors} conductors, ${(text.length / 1024).toFixed(1)} KiB`
)

/**
 * Pack-and-install smoke test: exercises the PUBLISHED tarball shape, not
 * the source workspace. Three consecutive releases (≤ v0.5.1) shipped
 * consumer-breaking artifact bugs that the source-tree CI could never see:
 * src-pointing exports, phantom internal dep pins from a stale bun.lock,
 * and missing dist files. Each class is caught mechanically here:
 *
 *   1. Pack every public package (scripts/publish-all.ts --pack).
 *   2. Tarball integrity: every @grayhaven/* dep inside each tarball must
 *      pin the exact workspace version (no phantom pins, no workspace:
 *      protocol leakage), and every file referenced by exports/main/types/
 *      bin must exist in the tarball listing.
 *   3. Consumer install: npm-install the tarballs (overrides force every
 *      internal dep to the local artifact) in a temp dir, then run
 *      `nerve --version/init/validate/export`, immediately compile a mapped
 *      CSV migration, and load every package from dist under BOTH `import`
 *      and `require` (an import-only exports map broke every CJS consumer).
 *
 *   bun run build && bun scripts/smoke-tarballs.ts
 */
import { execFileSync, spawnSync } from "node:child_process"
import {
  copyFileSync,
  globSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Schema } from "effect"
import {
  decodeDependencyBlock,
  isJsonObject,
  isJsonString,
  parseJsonObject,
  parsePackageManifest,
  type JsonObject,
  type JsonValue
} from "./json.js"

const ROOT = join(import.meta.dirname, "..")

const run = (cmd: string, args: string[], cwd: string, env?: Record<string, string>): void => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}`)
}

// ---------------------------------------------------------------- 1. pack
const packsFrom = mkdtempSync(join(tmpdir(), "nerve-packs-"))
run("bun", ["scripts/publish-all.ts", "--pack"], ROOT, { PACK_DEST: packsFrom })

// Map tarball -> its embedded package.json (never trust filename parsing).
interface PackedPkg {
  readonly tgz: string
  readonly pkg: JsonObject
  readonly entries: ReadonlySet<string>
}
const packed = new Map<string, PackedPkg>()
for (const f of readdirSync(packsFrom).filter((f) => f.endsWith(".tgz"))) {
  const tgz = join(packsFrom, f)
  const text = execFileSync("tar", ["-xzOf", tgz, "package/package.json"], { encoding: "utf8" })
  const pkg = parseJsonObject(text)
  const entries = new Set(
    execFileSync("tar", ["-tzf", tgz], { encoding: "utf8" }).trim().split("\n")
  )
  packed.set(parsePackageManifest(text).name, { tgz, pkg, entries })
}

// Workspace truth: name -> version from packages/*/package.json.
const workspaceVersions = new Map<string, string>()
const publishableWorkspacePackages = new Set<string>()
for (const rel of globSync("packages/*/package.json", { cwd: ROOT })) {
  const source = readFileSync(join(ROOT, rel), "utf8")
  const pkg = parsePackageManifest(source)
  const raw = parseJsonObject(source)
  if (pkg.version !== undefined) workspaceVersions.set(pkg.name, pkg.version)
  if (raw["private"] !== true && pkg.name.startsWith("@grayhaven/")) {
    publishableWorkspacePackages.add(pkg.name)
  }
}

// ----------------------------------------------- 2. tarball integrity
const collectPaths = (value: JsonValue | undefined, out: string[]): void => {
  if (value === undefined) return
  if (isJsonString(value)) {
    if (value.startsWith("./")) out.push(value.slice(2))
  } else if (Array.isArray(value)) {
    for (const v of value) collectPaths(v, out)
  } else if (isJsonObject(value)) {
    for (const v of Object.values(value)) collectPaths(v, out)
  }
}

const problems: string[] = []
const missingPacks = [...publishableWorkspacePackages]
  .filter((name) => !packed.has(name))
  .sort()
const unexpectedPacks = [...packed.keys()]
  .filter((name) => !publishableWorkspacePackages.has(name))
  .sort()
if (missingPacks.length > 0) {
  problems.push(`publish-all omitted public workspace packages: ${missingPacks.join(", ")}`)
}
if (unexpectedPacks.length > 0) {
  problems.push(`publish-all packed unexpected packages: ${unexpectedPacks.join(", ")}`)
}
for (const [name, { pkg, entries }] of packed) {
  // 2a. internal dep pins match the workspace exactly — across EVERY dep
  // block (a workspace: leak or stale pin in peer/dev/optional deps breaks
  // installs too, and ships in the published package.json).
  for (const block of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = decodeDependencyBlock(pkg[block] ?? {})
    for (const [dep, spec] of Object.entries(deps)) {
      if (!dep.startsWith("@grayhaven/")) continue
      if (spec.startsWith("workspace:")) {
        problems.push(`${name}: ${dep} still uses workspace protocol in ${block} (${spec})`)
        continue
      }
      const expected = workspaceVersions.get(dep)
      const pinned = spec.replace(/^[\^~]/, "")
      if (pinned !== expected) {
        problems.push(
          `${name}: ${dep} (${block}) pinned to ${spec} but workspace has ${expected} — stale bun.lock? Run bun run sync-workspace-lock and re-pack.`
        )
      }
    }
  }
  // 2b. every referenced artifact exists in the tarball
  const referenced: string[] = []
  for (const key of ["exports", "main", "types", "bin"]) collectPaths(pkg[key], referenced)
  for (const rel of referenced) {
    if (!entries.has(`package/${rel}`)) {
      problems.push(`${name}: package.json references ./${rel} but the tarball does not contain it`)
    }
  }
  if (referenced.length === 0) problems.push(`${name}: no exports/main/bin paths found to verify`)
  // 2c. nothing the publish shouldn't ship leaked in (a missing `files`
  // allowlist over-packs src/, tests, tsconfig, and the transient
  // package.json.publish-backup — caught nerve-react shipping its source).
  const leaked = [...entries].filter((e) => {
    const rel = e.replace(/^package\//, "").replace(/\/$/, "")
    if (rel === "" || rel === "package") return false
    return (
      rel.startsWith("src/") ||
      rel.startsWith("test/") ||
      rel.startsWith("tests/") ||
      rel === "tsconfig.json" ||
      rel.endsWith(".publish-backup") ||
      rel.endsWith(".test.ts") ||
      rel.endsWith(".test.tsx")
    )
  })
  if (leaked.length > 0) {
    problems.push(
      `${name}: tarball ships files it shouldn't (add a "files" allowlist): ${leaked.join(", ")}`
    )
  }
}
if (problems.length > 0) {
  console.error("✗ tarball integrity failures:")
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`✓ tarball integrity: ${packed.size} packages, pins + artifact paths verified`)

// ----------------------------------------------- 3. consumer install + CLI
const consumer = mkdtempSync(join(tmpdir(), "nerve-smoke-"))
const fileSpec = (name: string): string => `file:${packed.get(name)!.tgz}`
const directDeps = [
  "@grayhaven/nerve",
  "@grayhaven/nerve-cli",
  "@grayhaven/nerve-compiler",
  "@grayhaven/nerve-connectors",
  "@grayhaven/nerve-eval",
  "@grayhaven/nerve-exporters",
  "@grayhaven/nerve-importers",
  "@grayhaven/nerve-interop",
  "@grayhaven/nerve-platform",
  "@grayhaven/nerve-react",
  "@grayhaven/nerve-rules",
  "@grayhaven/nerve-wireviz"
]
for (const d of directDeps) {
  if (!packed.has(d)) {
    console.error(`✗ expected tarball for ${d} was not produced`)
    process.exit(1)
  }
}
writeFileSync(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      name: "nerve-smoke-consumer",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(directDeps.map((d) => [d, fileSpec(d)])),
      // Force every transitive @grayhaven/* resolution to the local tarball:
      // the registry must never satisfy an internal dep during this test.
      overrides: Object.fromEntries([...packed.keys()].map((d) => [d, fileSpec(d)]))
    },
    null,
    2
  )
)
run("npm", ["install", "--no-audit", "--no-fund"], consumer)

const packedCliVersion = packed.get("@grayhaven/nerve-cli")!.pkg["version"]
if (!isJsonString(packedCliVersion)) {
  throw new Error("@grayhaven/nerve-cli tarball has no string version")
}
const versionOutput = execFileSync("npx", ["nerve", "--version"], {
  cwd: consumer,
  encoding: "utf8"
})
if (versionOutput !== `${packedCliVersion}\n`) {
  console.error(
    `✗ published CLI version output was ${JSON.stringify(versionOutput)}; expected ${JSON.stringify(`${packedCliVersion}\n`)}`
  )
  process.exit(1)
}
console.log(`✓ published CLI reports exact package version ${packedCliVersion}`)

// This compiles the generated TypeScript during import. It specifically
// exercises ESM-condition resolution from the installed CLI tarball.
writeFileSync(
  join(consumer, "wire-list.csv"),
  "Wire,From,From Pin,To,To Pin,Signal,Gauge,Color,Length\nW1,J1,1,J2,1,GND,20AWG,black,100\n"
)
writeFileSync(
  join(consumer, "columns.json"),
  JSON.stringify({
    wireId: "Wire",
    fromConnector: "From",
    fromPin: "From Pin",
    toConnector: "To",
    toPin: "To Pin",
    signal: "Signal",
    gauge: "Gauge",
    color: "Color",
    length: "Length"
  })
)
run(
  "npx",
  [
    "nerve",
    "import",
    "./wire-list.csv",
    "--map",
    "./columns.json",
    "--id",
    "smoke-csv",
    "--out",
    "./csv-migration"
  ],
  consumer
)
const CsvHir = Schema.Struct({
  harness: Schema.Struct({ id: Schema.String }),
  connectors: Schema.Array(Schema.Unknown),
  wires: Schema.Array(Schema.Unknown)
})
const csvHir = Schema.decodeUnknownSync(CsvHir)(
  JSON.parse(readFileSync(join(consumer, "csv-migration", "harness.json"), "utf8"))
)
if (csvHir.harness.id !== "smoke-csv" || csvHir.connectors.length !== 2 || csvHir.wires.length !== 1) {
  console.error("✗ published CLI did not immediately compile the mapped CSV migration")
  process.exit(1)
}
console.log("✓ published CLI immediately compiles mapped CSV migrations")

// The published bin, against the published dist, compiling a scaffolded
// project whose imports resolve from the installed tarballs.
run("npx", ["nerve", "init", "."], consumer)
run("npx", ["nerve", "validate", "./src/main.harness.ts"], consumer)
run("npx", ["nerve", "export", "./src/main.harness.ts", "--out", "./packet"], consumer)
const packet = readdirSync(join(consumer, "packet"))
if (!packet.includes("manufacturing-packet.pdf")) {
  console.error(`✗ export packet missing manufacturing-packet.pdf (got: ${packet.join(", ")})`)
  process.exit(1)
}

// The published CLI must import an untouched, externally sourced WireViz
// harness with the same prepend semantics used by NASA/JPL's rover corpus.
const jplCorpus = join(
  ROOT,
  "packages/nerve-wireviz/test/fixtures/jpl-open-source-rover"
)
copyFileSync(join(jplCorpus, "templates.yml"), join(consumer, "jpl-templates.yml"))
copyFileSync(join(jplCorpus, "front_encoder.yml"), join(consumer, "jpl-front-encoder.yml"))
run(
  "npx",
  [
    "nerve",
    "import",
    "./jpl-front-encoder.yml",
    "--prepend-file",
    "./jpl-templates.yml",
    "--id",
    "jpl-front-encoder",
    "--out",
    "./jpl-import"
  ],
  consumer
)
const ImportedHir = Schema.Struct({
  harness: Schema.Struct({
    id: Schema.String,
    metadata: Schema.Record({ key: Schema.String, value: Schema.String })
  }),
  wires: Schema.Array(Schema.Struct({ length: Schema.optional(Schema.Number) }))
})
const jplHir = Schema.decodeUnknownSync(ImportedHir)(
  JSON.parse(readFileSync(join(consumer, "jpl-import", "harness.json"), "utf8"))
)
if (
  jplHir.harness.id !== "jpl-front-encoder" ||
  jplHir.harness.metadata["sourceTitle"] !== "Front Encoder Cable (x2)" ||
  jplHir.wires.length !== 6 ||
  jplHir.wires.some((wire) => wire.length === undefined)
) {
  console.error("✗ published CLI lost JPL rover harness semantics")
  process.exit(1)
}
console.log("✓ published CLI imports NASA/JPL rover harness semantics")

// Dist exports resolve for every consumer-facing package (would have
// caught the src-pointing exports shipped through v0.5.0).
const importCheck = `
const checks = [
  ["@grayhaven/nerve", ["harness", "connector", "wire", "defineConfig"]],
  ["@grayhaven/nerve-cli", ["run", "main"]],
  ["@grayhaven/nerve-compiler", ["compileFile", "CompilerService"]],
  ["@grayhaven/nerve-connectors", ["part", "allParts", "partSpecs"]],
  ["@grayhaven/nerve-eval", ["createReviewReport", "decodeEvalManifest", "evaluateCase"]],
  ["@grayhaven/nerve-exporters", ["createBuildRecord", "generateTestPlan", "createRelease"]],
  ["@grayhaven/nerve-importers", ["importWireList", "parseCsvWireList", "parseXlsxWireList"]],
  ["@grayhaven/nerve-interop", ["importVec22Subset", "createOpc40570Job", "evaluateAutomationReadiness"]],
  ["@grayhaven/nerve-platform", ["createWorkOrder", "replayUnitBuild", "ShopFloorCodes"]],
  ["@grayhaven/nerve-react", ["Harness", "Connector", "Wire"]],
  ["@grayhaven/nerve-react/jsx-runtime", ["jsx"]],
  ["@grayhaven/nerve-rules", ["builtinRules", "ruleCategory", "parseAwg"]],
  ["@grayhaven/nerve-wireviz", ["importWireViz", "exportWireViz"]]
]
for (const [mod, names] of checks) {
  const m = await import(mod)
  for (const n of names) {
    if (m[n] === undefined) throw new Error(mod + " is missing export " + n)
  }
}
console.log("✓ dist exports resolve: " + checks.map(c => c[0]).join(", "))
`
writeFileSync(join(consumer, "import-check.mjs"), importCheck)
run("node", ["import-check.mjs"], consumer)

// Every library package must also load under require(). Publishing an
// "import"-only exports map made require("@grayhaven/nerve") fail with a
// misleading `No "exports" main defined`, which broke CJS consumers and any
// tool resolving with require conditions. The two tool packages
// (nerve-cli, nerve-compiler) are deliberately ESM-only: they read
// import.meta, which has no correct CJS shim.
const requireCheck = `
const checks = [
  ["@grayhaven/nerve", ["harness", "connector", "wire", "defineConfig", "compileDesign"]],
  ["@grayhaven/nerve-connectors", ["part", "allParts", "partSpecs"]],
  ["@grayhaven/nerve-eval", ["createReviewReport", "decodeEvalManifest", "evaluateCase"]],
  ["@grayhaven/nerve-exporters", ["createBuildRecord", "generateTestPlan", "createRelease"]],
  ["@grayhaven/nerve-importers", ["importWireList", "parseCsvWireList", "parseXlsxWireList"]],
  ["@grayhaven/nerve-interop", ["importVec22Subset", "createOpc40570Job", "evaluateAutomationReadiness"]],
  ["@grayhaven/nerve-platform", ["createWorkOrder", "replayUnitBuild", "ShopFloorCodes"]],
  ["@grayhaven/nerve-react", ["Harness", "Connector", "Wire"]],
  ["@grayhaven/nerve-react/jsx-runtime", ["jsx"]],
  ["@grayhaven/nerve-rules", ["builtinRules", "ruleCategory", "parseAwg"]],
  ["@grayhaven/nerve-wireviz", ["importWireViz", "exportWireViz"]]
]
for (const [mod, names] of checks) {
  const m = require(mod)
  for (const n of names) {
    if (m[n] === undefined) throw new Error(mod + " is missing require export " + n)
  }
}
// Not just resolvable — usable. This compiles a design through the CJS copy.
const { harness, compileDesign } = require("@grayhaven/nerve")
const { hir } = compileDesign(
  harness("cjs-smoke", { revision: "A", units: "mm", connectors: [], wires: [] })
)
if (hir.harness.id !== "cjs-smoke") throw new Error("CJS compileDesign did not produce the design")
console.log("✓ require() resolves: " + checks.map(c => c[0]).join(", "))
`
writeFileSync(join(consumer, "require-check.cjs"), requireCheck)
run("node", ["require-check.cjs"], consumer)

rmSync(consumer, { recursive: true, force: true })
rmSync(packsFrom, { recursive: true, force: true })
console.log("✓ pack-and-install smoke test passed")

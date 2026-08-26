/**
 * Nerve CLI (PRD §9.7).
 *
 *   nerve init [dir]
 *   nerve compile  <file.harness.ts> [--out dir]
 *   nerve validate <file.harness.ts>
 *   nerve render   <file.harness.ts> --format svg [--out dir]
 *   nerve export   <file.harness.ts> --target manufacturing-packet [--out dir]
 *   nerve inspect  <dist/harness.json>
 *
 * Exit codes: 0 success · 1 validation errors · 2 usage/compile failure.
 * All file output is deterministic and CI-suitable.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { basename, dirname, extname, join, resolve } from "node:path"
import { Effect, Exit, Cause, Predicate, Schema } from "effect"
import {
  compileDesign,
  decodeHir,
  diffHir,
  formatDiff,
  diffMargins,
  hasErrors,
  isEmptyDiff,
  runRulesWithMargins,
  type Diagnostic,
  type Hir
} from "@grayhaven/nerve"
import {
  compileFile,
  findConfig,
  type CompileFileOptions,
  type CompileFileResult
} from "@grayhaven/nerve-compiler"
import { exportWireViz, importWireViz } from "@grayhaven/nerve-wireviz"
import {
  importWireList,
  normalizeWireListColumnMap,
  parseCsvWireList,
  parseXlsxWireList,
  wireListColumnMapJson,
  type JsonValue
} from "@grayhaven/nerve-importers"
import {
  auditProvenance,
  createCorpusReport,
  provenanceAuditJson,
  createReviewReport,
  decodeEvalManifest,
  evaluateCase,
} from "@grayhaven/nerve-eval"
import { builtinRulesWith } from "@grayhaven/nerve-rules"
import { startDev } from "./dev.js"
import { runSnapshot } from "./snapshot.js"
import { cliVersion, initFiles, setupFiles, writeScaffold } from "./scaffold.js"
import {
  connectorFacesSvg,
  boardSvg,
  analysisCsv,
  analysisJson,
  analyzeHarness,
  builtinAdapters,
  buildRecordJson,
  contractJson,
  createBuildRecord,
  createRedline,
  createRelease,
  formboardSheets,
  mergePatches,
  redlinesFromBuildRecord,
  releaseJson,
  ReleaseBlockedError,
  resolveRedline,
  suggestPatch,
  validateRedlineTarget,
  exportConnectorContract,
  findAdapter,
  findContractImporter,
  generateQuote,
  importPinoutCsv,
  exportTscircuitCircuitJson,
  importTscircuitPinout,
  quoteCsv,
  quoteJson,
  validateContract,
  buildPacket,
  canRelease,
  hirFingerprint,
  pinoutSvg,
  schematicSvg,
  parseTscircuitCircuitJson,
  type ConnectorContract,
  type Redline,
  type RedlineType
} from "@grayhaven/nerve-exporters"

export interface Io {
  out(line: string): void
  err(line: string): void
}

const realIo: Io = {
  out: (line) => process.stdout.write(line + "\n"),
  err: (line) => process.stderr.write(line + "\n")
}

interface ParsedArgs {
  readonly command: string | undefined
  readonly positional: ReadonlyArray<string>
  readonly flags: Readonly<Record<string, string>>
}

// Value-less boolean flags MUST NOT consume the next token — otherwise
// `nerve snapshot --update main.harness.ts` swallows the file as
// --update's "value" and updates every configured harness instead.
const BOOLEAN_FLAGS = new Set([
  "update",
  "codes",
  "ci",
  "json",
  "accept",
  "reject",
  "help"
])

const parseArgs = (argv: ReadonlyArray<string>): ParsedArgs => {
  const [command, ...rest] = argv
  const positional: Array<string> = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=")
      if (eq > -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1)
      } else {
        const name = arg.slice(2)
        flags[name] =
          !BOOLEAN_FLAGS.has(name) && rest[i + 1]?.startsWith("--") === false
            ? rest[++i]!
            : "true"
      }
    } else {
      positional.push(arg)
    }
  }
  return { command, positional, flags }
}

/** Display-only rounding. The report JSON keeps full precision. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000

/**
 * A command that stopped early. Carrying the exit code in its own type keeps
 * it distinguishable from a result without inspecting the value.
 */
class CommandExit {
  constructor(readonly code: number) {}
}

/** The parsed document a JSON file holds; callers narrow from here. */
const readJson = (path: string): JsonValue => {
  // JSON.parse yields nothing outside the JSON value grammar.
  const parsed: JsonValue = JSON.parse(readFileSync(path, "utf8"))
  return parsed
}

/** A ledger file (redlines.json) must hold a JSON array; anything else is corrupt. */
const readJsonArray = (path: string): ReadonlyArray<JsonValue> => {
  const parsed = readJson(path)
  if (!Array.isArray(parsed)) throw new Error(`${path} does not contain a JSON array.`)
  return parsed
}

/** The `id` of a ledger entry, when the entry carries one. */
const entryId = (entry: JsonValue): string | undefined =>
  Predicate.isRecord(entry) && Predicate.isString(entry["id"]) ? entry["id"] : undefined

const REDLINE_TYPES = [
  "ambiguity",
  "incorrect-length",
  "incorrect-label",
  "orientation",
  "process",
  "other"
] as const satisfies ReadonlyArray<RedlineType>

const RedlineTypeSchema = Schema.Literal(...REDLINE_TYPES)

const RedlineSchema: Schema.Schema<Redline> = Schema.Struct({
  id: Schema.String,
  target: Schema.String,
  type: RedlineTypeSchema,
  description: Schema.String,
  proposedValue: Schema.optionalWith(Schema.String, { exact: true }),
  release: Schema.String,
  serial: Schema.optionalWith(Schema.String, { exact: true }),
  reportedBy: Schema.optionalWith(Schema.String, { exact: true }),
  status: Schema.Literal("open", "accepted", "rejected"),
  resolution: Schema.optionalWith(
    Schema.Struct({
      by: Schema.optionalWith(Schema.String, { exact: true }),
      reason: Schema.String,
      resolvedAt: Schema.String
    }),
    { exact: true }
  )
})

// Extra keys survive the round trip, so rewriting a ledger never strips what
// another tool recorded on an entry.
const decodeRedline = Schema.decodeUnknownSync(RedlineSchema, { onExcessProperty: "preserve" })
const decodeRedlines = Schema.decodeUnknownSync(Schema.Array(RedlineSchema), {
  onExcessProperty: "preserve"
})

// Lowercase to match formatDiff's section labels; the severity is a tag on
// the line, not a heading over it.
const severityLabel = {
  error: "error",
  warning: "warning",
  info: "info"
} satisfies Record<Diagnostic["severity"], string>

/**
 * Findings lead with the object and what is wrong with it, not the rule code.
 *
 * A code is a database key: useful to CI, to a waiver, and to an auditor
 * reading the coverage map, and noise to somebody mid-iteration who has to
 * translate it before learning anything. The browser workspace already treats
 * it that way — a small link chip beside the target, with the message given
 * the room. This matches it. `--codes` puts them back for the audit read, and
 * every JSON artifact carries them unconditionally either way.
 */
const printDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
  io: Io,
  showCodes = false
): void => {
  for (const d of diagnostics) {
    const label = severityLabel[d.severity] ?? d.severity
    const target = d.target !== undefined ? `  ${d.target}` : ""
    const code = showCodes ? `  ${d.code}` : ""
    const print = d.severity === "error" ? io.err : io.out
    print(`${label}${target}${code}`)
    print(`  ${d.message}`)
  }
}

const summarize = (hir: Hir): string => {
  const errors = hir.diagnostics.filter((d) => d.severity === "error").length
  const warnings = hir.diagnostics.filter((d) => d.severity === "warning").length
  return `${hir.harness.id} rev ${hir.harness.revision} — ${hir.connectors.length} connectors, ${hir.wires.length} wires — ${errors} error(s), ${warnings} warning(s)`
}

const compileOrExit = async (
  file: string,
  io: Io,
  options: CompileFileOptions = {}
): Promise<CompileFileResult | CommandExit> => {
  const exit = await Effect.runPromiseExit(compileFile(file, options))
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause)
    io.err(
      failure._tag === "Some"
        ? `CompileError: ${failure.value.message}`
        : `Unexpected failure: ${Cause.pretty(exit.cause)}`
    )
    return new CommandExit(2)
  }
  return exit.value
}

/**
 * Resolve the harness-file argument and the directory its nerve.config.ts
 * lives in. Explicit positional wins, else `config.entry`. `configDir` is
 * the base for `config.outputDir` so a configured project's output lands
 * next to the config, not in whatever cwd the command ran from.
 */
const resolveHarnessArg = async (
  positional: ReadonlyArray<string>
): Promise<{ file: string; configDir: string } | undefined> => {
  if (positional[0] !== undefined) {
    const file = positional[0]
    const exit = await Effect.runPromiseExit(findConfig(dirname(resolve(file))))
    const configDir = Exit.isSuccess(exit) ? exit.value.dir : process.cwd()
    return { file, configDir }
  }
  const exit = await Effect.runPromiseExit(findConfig(process.cwd()))
  if (Exit.isFailure(exit)) return undefined
  const { config, dir } = exit.value
  return config.entry !== undefined ? { file: join(dir, config.entry), configDir: dir } : undefined
}

/**
 * Output directory: an explicit `--out` is relative to the cwd (the user's
 * intent), but a `config.outputDir` is relative to the config dir so bare
 * commands from a subdir don't scatter dist/ into the cwd.
 */
const resolveOutDir = (
  flags: Readonly<Record<string, string>>,
  config: { readonly outputDir?: string },
  configDir: string
): string =>
  flags["out"] !== undefined
    ? resolve(flags["out"])
    : resolve(configDir, config.outputDir ?? "dist")

const writeOutBytes = (dir: string, name: string, bytes: Uint8Array, io: Io): void => {
  const path = join(dir, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
  io.out(`wrote ${path}`)
}

const writeOut = (dir: string, name: string, contents: string | Uint8Array, io: Io): void => {
  const path = join(dir, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
  io.out(`wrote ${path}`)
}

const USAGE = `nerve — deterministic harness review (Grayhaven Nerve)

Findings print as object + message. Add --codes for the HK-* codes; every
JSON artifact carries them either way.

Usage:
  nerve init [dir]
  nerve setup [dir]   (write CI workflows: validate, snapshot, reproduce)
  nerve compile  <file.harness.ts> [--out dir]
  nerve dev      [file.harness.ts] [--port 4477]   (watch + live browser preview)
  nerve snapshot [files...] [--update] [--ci]   (committed visual snapshots, byte-exact)
  nerve validate <file.harness.ts>
  nerve render   <file.harness.ts> [--format svg] [--view schematic|board|faces|pinout|formboard] [--paper letter|a4] [--out dir]
  nerve export   <file.harness.ts> [--target manufacturing-packet|wireviz] [--out dir]
  nerve import   <file.yml> [--prepend-file base.yml] [--id harness-id] [--out dir]   (WireViz YAML → HIR)
  nerve import   <file.csv|xlsx> --map columns.json [--sheet name] [--id harness-id] [--out dir]
  nerve review   <file.harness.ts> [--out dir]   (stable machine-readable finding report)
  nerve provenance <file.harness.ts> [--out dir]   (what the checks rest on)
  nerve eval     [eval-corpus/manifest.json] [--out dir]   (provenance-aware rule scorecard)
  nerve quote    <file.harness.ts> [--out dir]   (requires costing in nerve.config.ts)
  nerve analyze  <file.harness.ts> [--out dir]   (resistance, drop, bundle, weight §34)
  nerve machine  <adapter-id> <file.harness.ts> [--out dir]   (shop-floor exports §31)
  nerve contract <file.harness.ts> --connector <ref> [--against contract.json|pinout.csv|board.kicad_pcb] [--component ref] [--out dir]
  nerve release  <file.harness.ts> --eco <id> --reason <text> --date <iso> [--against release.json] [--out dir]
  nerve record   <file.harness.ts> --release <release.json> --serial <sn> --operator <name> --date <iso> --results <measurements.json> [--lengths lengths.json] [--length-tolerance mm] [--out dir]
  nerve redline  add <file.harness.ts> --target <hir-ref> --type <type> --description <text> [--value v] [--release id] [--serial sn]
  nerve redline  from-record <file.harness.ts> --record <build-record.json> [--file redlines.json] [--prefix RL] [--by name]
  nerve redline  resolve <redlines.json> --id <id> --accept|--reject --reason <text> --date <iso>
  nerve redline  patch <redlines.json> [--out dir]   (merge accepted redlines into one variant() patch)
  nerve diff     <revA> <revB> [--json]   (each: harness.json, .harness.ts, or revision dir)
  nerve inspect  <harness.json>
  nerve parts    [spec-or-mpn] [--json]   (bundled connector library + which checks the data enables)
  nerve parts    scaffold <mpn> --pins <n> [--out dir]   (stub a new part with every rule-relevant field)`

/** Resolve a diff argument to HIR: a harness.json, a .harness.ts, or a directory. */
const loadHirForDiff = async (path: string, io: Io): Promise<Hir | CommandExit> => {
  const p = resolve(path)
  if (existsSync(p) && statSync(p).isDirectory()) {
    for (const candidate of [join(p, "harness.json"), join(p, "dist", "harness.json")]) {
      if (existsSync(candidate)) return loadHirForDiff(candidate, io)
    }
    io.err(`No harness.json found in ${path} (looked in ./ and ./dist).`)
    return new CommandExit(2)
  }
  if (p.endsWith(".json")) {
    try {
      return decodeHir(readJson(p))
    } catch (cause) {
      io.err(`Failed to load ${path}: ${cause instanceof Error ? cause.message : String(cause)}`)
      return new CommandExit(2)
    }
  }
  const result = await compileOrExit(p, io)
  return result instanceof CommandExit ? result : result.hir
}

export const run = async (argv: ReadonlyArray<string>, io: Io = realIo): Promise<number> => {
  const { command, positional, flags } = parseArgs(argv)

  switch (command) {
    case "compile": {
      const arg = await resolveHarnessArg(positional)
      if (arg === undefined) return usage(io)
      const { file, configDir } = arg
      const result = await compileOrExit(file, io)
      if (result instanceof CommandExit) return result.code
      const outDir = resolveOutDir(flags, result.config, configDir)
      writeOut(outDir, "harness.json", JSON.stringify(result.hir, null, 2) + "\n", io)
      writeOut(outDir, "diagnostics.json", JSON.stringify(result.diagnostics, null, 2) + "\n", io)
      printDiagnostics(result.diagnostics, io, flags["codes"] !== undefined)
      io.out(summarize(result.hir))
      return hasErrors(result.diagnostics) ? 1 : 0
    }

    case "dev": {
      const arg = await resolveHarnessArg(positional)
      if (arg === undefined) return usage(io)
      const { file } = arg
      const port = flags["port"]
      try {
        const dev = await startDev(file, port === undefined ? { io } : { io, port: Number(port) })
        io.out(`nerve dev → ${dev.url}  (views: / /board /faces /pinout) — watching for changes, ctrl-c to stop`)
        // Keep the process alive until killed.
        await new Promise<void>((res) => process.once("SIGINT", () => void dev.close().then(res)))
        return 0
      } catch (cause) {
        io.err(`Failed to start dev server: ${cause instanceof Error ? cause.message : String(cause)}`)
        return 2
      }
    }

    case "snapshot": {
      // Files: explicit positionals, else config.harnessFiles, else entry.
      let files: ReadonlyArray<string> = positional
      if (files.length === 0) {
        const exit = await Effect.runPromiseExit(findConfig(process.cwd()))
        if (Exit.isSuccess(exit)) {
          const { config, dir } = exit.value
          const fromConfig = config.harnessFiles ?? (config.entry !== undefined ? [config.entry] : [])
          files = fromConfig.map((f) => join(dir, f))
        }
      }
      if (files.length === 0) return usage(io)
      return runSnapshot(files, flags, io)
    }

    case "validate": {
      const arg = await resolveHarnessArg(positional)
      if (arg === undefined) return usage(io)
      const { file } = arg
      const result = await compileOrExit(file, io)
      if (result instanceof CommandExit) return result.code
      printDiagnostics(result.diagnostics, io, flags["codes"] !== undefined)
      io.out(summarize(result.hir))
      return hasErrors(result.diagnostics) ? 1 : 0
    }

    case "render": {
      const arg = await resolveHarnessArg(positional)
      if (arg === undefined) return usage(io)
      const { file, configDir } = arg
      const format = flags["format"] ?? "svg"
      if (format !== "svg" && format !== "png") {
        io.err(`Unsupported render format: ${format} (supported: svg, png)`)
        return 2
      }
      const view = flags["view"] ?? "schematic"
      if (view !== "schematic" && view !== "board" && view !== "faces" && view !== "pinout" && view !== "formboard") {
        io.err(`Unsupported render view: ${view} (supported: schematic, board, faces, pinout, formboard)`)
        return 2
      }
      const result = await compileOrExit(file, io)
      if (result instanceof CommandExit) return result.code
      const outDir = resolveOutDir(flags, result.config, configDir)
      if (view === "formboard") {
        const paper = flags["paper"] === "a4" ? "a4" as const : "letter" as const
        const board = formboardSheets(result.hir, { paper })
        for (const sheet of board.sheets) writeOut(outDir, sheet.name, sheet.svg, io)
        io.out(
          `formboard ${board.boardWidthMm}x${board.boardHeightMm} mm → ${board.rows}x${board.cols} ${paper} sheet(s) at 1:1. Print at 100% and verify the calibration ruler.`
        )
        return 0
      }
      const svg =
        view === "board"
          ? boardSvg(result.hir)
          : view === "faces"
            ? connectorFacesSvg(result.hir)
            : view === "pinout"
              ? pinoutSvg(result.hir)
              : schematicSvg(result.hir)
      const base =
        view === "schematic" ? "schematic" : view === "faces" ? "connector-faces" : view
      if (format === "png") {
        // PNG preview (PRD §9.8): native resvg lives in the CLI only — the
        // exporters package stays browser-clean.
        const { Resvg } = await import("@resvg/resvg-js")
        const png = new Resvg(svg, { fitTo: { mode: "width", value: 1600 } }).render().asPng()
        writeOutBytes(outDir, `${base}.png`, png, io)
      } else {
        writeOut(outDir, `${base}.svg`, svg, io)
      }
      return 0
    }

    case "export": {
      const arg = await resolveHarnessArg(positional)
      if (arg === undefined) return usage(io)
      const { file, configDir } = arg
      const target = flags["target"] ?? "manufacturing-packet"
      if (target === "wireviz") {
        const result = await compileOrExit(file, io)
        if (result instanceof CommandExit) return result.code
        const { yaml, diagnostics } = exportWireViz(result.hir)
        printDiagnostics(diagnostics, io, flags["codes"] !== undefined)
        const outDir = resolveOutDir(flags, result.config, configDir)
        writeOut(outDir, "wireviz.yml", yaml, io)
        return 0
      }
      if (target !== "manufacturing-packet") {
        io.err(`Unsupported export target: ${target} (supported: manufacturing-packet, wireviz)`)
        return 2
      }
      const result = await compileOrExit(file, io)
      if (result instanceof CommandExit) return result.code
      printDiagnostics(result.diagnostics, io, flags["codes"] !== undefined)
      if (!canRelease(result.hir)) {
        io.err(
          "Export blocked: validation errors present. Release exports fail closed (PRD §15)."
        )
        return 1
      }
      const outDir = resolveOutDir(flags, result.config, configDir)
      const tolerance = result.config.defaultWireTolerance
      const costing = result.config.costing
      const toleranced = tolerance === undefined ? {} : { defaultWireTolerance: tolerance }
      const options = costing === undefined ? toleranced : { ...toleranced, costing }
      // The packet IS the artifact list (PRD §9.8): write every file it
      // contains as loose output too — one source of truth, no second
      // hand-maintained list to drift (the pre-0.5.2 list silently lacked
      // connector faces, the HTML viewer, and the JSON satellites).
      const packet = await buildPacket(result.hir, options)
      // config.exports toggles which loose files land in outputDir
      // (declared-but-dead config is worse than none); the zip always
      // carries the complete packet.
      const toggles = result.config.exports
      const skip = (name: string): boolean =>
        (toggles?.csv === false && name.endsWith(".csv")) ||
        (toggles?.svg === false && name.endsWith(".svg")) ||
        (toggles?.pdf === false && name.endsWith(".pdf"))
      for (const [name, contents] of packet.files) {
        if (skip(name)) continue
        writeOut(outDir, name, contents, io)
      }
      writeOut(outDir, "manufacturing-packet.zip", packet.zip, io)
      io.out(summarize(result.hir))
      return 0
    }

    case "import": {
      const file = positional[0]
      if (file === undefined) return usage(io)
      const extension = extname(file).toLowerCase()
      if (extension === ".csv" || extension === ".xlsx" || extension === ".xls") {
        const mappingPath = flags["map"]
        if (mappingPath === undefined) {
          io.err("Wire-list import requires --map <columns.json>.")
          return 2
        }
        try {
          const mapping = normalizeWireListColumnMap(readJson(resolve(mappingPath)))
          const bytes = readFileSync(resolve(file))
          const table =
            extension === ".csv"
              ? parseCsvWireList(bytes.toString("utf8"))
              : parseXlsxWireList(bytes, flags["sheet"])
          const harnessId = flags["id"]
          const imported = importWireList(
            table,
            mapping,
            harnessId === undefined
              ? { sourceName: basename(file) }
              : { harnessId, sourceName: basename(file) }
          )
          const outDir = resolve(flags["out"] ?? "dist")
          writeOut(outDir, "column-map.json", wireListColumnMapJson(mapping), io)
          writeOut(
            outDir,
            "import-report.json",
            JSON.stringify(imported.report, null, 2) + "\n",
            io
          )
          if (imported.design === undefined) {
            writeOut(
              outDir,
              "diagnostics.json",
              JSON.stringify(imported.diagnostics, null, 2) + "\n",
              io
            )
            printDiagnostics(imported.diagnostics, io, flags["codes"] !== undefined)
            return 1
          }
          const scaffoldFiles = new Map(initFiles(cliVersion()))
          scaffoldFiles.delete("src/main.harness.ts")
          writeScaffold(outDir, scaffoldFiles, io)
          writeOut(outDir, "src/main.harness.ts", imported.source, io)
          const sourcePath = join(outDir, "src", "main.harness.ts")
          const coreModule = createRequire(import.meta.url).resolve("@grayhaven/nerve")
          const compiled = await compileOrExit(sourcePath, io, {
            config: {},
            moduleAliases: { "@grayhaven/nerve": coreModule }
          })
          if (compiled instanceof CommandExit) return compiled.code
          const diagnostics = [
            ...imported.diagnostics,
            ...compiled.diagnostics
          ]
          const full = { ...compiled.hir, diagnostics }
          writeOut(outDir, "harness.json", JSON.stringify(full, null, 2) + "\n", io)
          writeOut(
            outDir,
            "diagnostics.json",
            JSON.stringify(diagnostics, null, 2) + "\n",
            io
          )
          printDiagnostics(diagnostics, io, flags["codes"] !== undefined)
          io.out(
            `${imported.report.accepted} row(s) accepted, ${imported.report.rejected} rejected. Review every unverified part before release.`
          )
          return hasErrors(diagnostics) ? 1 : 0
        } catch (cause) {
          io.err(
            `Failed to import ${file}: ${cause instanceof Error ? cause.message : String(cause)}`
          )
          return 2
        }
      }
      let result
      try {
        const harnessId = flags["id"]
        const prependFile = flags["prepend-file"]
        const identified = harnessId === undefined ? {} : { harnessId }
        const options =
          prependFile === undefined
            ? identified
            : { ...identified, prependYaml: [readFileSync(resolve(prependFile), "utf8")] }
        result = importWireViz(readFileSync(resolve(file), "utf8"), options)
      } catch (cause) {
        io.err(
          `Failed to import ${file}: ${cause instanceof Error ? cause.message : String(cause)}`
        )
        return 2
      }
      const { hir, diagnostics: structural } = compileDesign(result.design)
      const diagnostics = [...result.diagnostics, ...structural]
      const full = { ...hir, diagnostics }
      printDiagnostics(diagnostics, io, flags["codes"] !== undefined)
      const outDir = resolve(flags["out"] ?? "dist")
      writeOut(outDir, "harness.json", JSON.stringify(full, null, 2) + "\n", io)
      writeOut(outDir, "diagnostics.json", JSON.stringify(diagnostics, null, 2) + "\n", io)
      io.out(summarize(full))
      return hasErrors(diagnostics) ? 1 : 0
    }

    case "review": {
      const arg = await resolveHarnessArg(positional)
      if (arg === undefined) return usage(io)
      const result = await compileOrExit(arg.file, io)
      if (result instanceof CommandExit) return result.code
      // Findings say what is wrong; margins say how close to wrong everything
      // else is. A design with zero errors can still sit at 99% of every
      // limit, and no other artifact answers that.
      const reviewRules = builtinRulesWith(result.config.shop)
      const { margins } = runRulesWithMargins(result.hir, reviewRules, result.config.rules)
      const report = createReviewReport(result.hir, result.diagnostics, {
        source: { name: basename(arg.file), format: "nerve-typescript" },
        hirFingerprint: hirFingerprint(result.hir),
        toolVersion: cliVersion(),
        margins,
        rules: {
          package: "@grayhaven/nerve-rules",
          version: cliVersion(),
          codes: reviewRules.map((rule) => rule.code)
        },
        limitations: [
          "Checks can use only facts present in the submitted design and configured part data.",
          "The built-in rules are generic consistency and engineering checks, not a standards certification.",
          "Structural compiler checks and configured plugins may contribute findings beyond the listed built-in rule codes."
        ]
      })
      const outDir = resolveOutDir(flags, result.config, arg.configDir)
      writeOut(
        outDir,
        "review-report.json",
        JSON.stringify(report, null, 2) + "\n",
        io
      )
      printDiagnostics(result.diagnostics, io, flags["codes"] !== undefined)
      if (report.margins !== undefined && report.margins.summary.measured > 0) {
        const s = report.margins.summary
        io.out(
          `${s.measured} measurement(s), ${s.overBudget} over budget. Tightest headroom:`
        )
        for (const m of [...report.margins.measurements]
          .sort((a, b) => a.margin - b.margin)
          .slice(0, 5)) {
          io.out(
            `  ${(m.utilization * 100).toFixed(1).padStart(6)}%  ${m.quantity} — ${m.target} (${round3(m.measured)}/${round3(m.limit)}${m.unit})`
          )
        }
      }
      io.out(
        `${result.hir.harness.id} rev ${result.hir.harness.revision}: ${report.summary.findings} finding(s), fingerprint ${report.harness.fingerprint}`
      )
      return report.summary.errors > 0 ? 1 : 0
    }

    // Coverage says what is checked; this says what the checks rest on. A
    // clean report over unverified limits is not the same result as a clean
    // report over confirmed ones, and nothing else distinguishes them.
    case "provenance": {
      const arg = await resolveHarnessArg(positional)
      if (arg === undefined) return usage(io)
      const result = await compileOrExit(arg.file, io)
      if (result instanceof CommandExit) return result.code
      const audit = auditProvenance(result.hir)
      const outDir = resolveOutDir(flags, result.config, arg.configDir)
      writeOut(outDir, "provenance-audit.json", provenanceAuditJson(audit), io)

      const s = audit.summary
      for (const p of audit.parts.filter((x) => x.tier !== "verified" && x.decisiveFields.length > 0)) {
        io.out(`  ${p.tier.padEnd(12)} ${p.kind.padEnd(10)} ${p.mpn}  (${p.decisiveFields.join(", ")})`)
      }
      const tiers = Object.entries(s.byTier)
        .filter(([, n]) => n > 0)
        .map(([t, n]) => `${n} ${t}`)
        .join(", ")
      io.out(`${s.parts} part(s): ${tiers}`)
      io.out(
        s.decisiveUnverified === 0
          ? "Every limit this design is judged against comes from verified part data."
          : `${s.decisiveUnverified} part(s) supply a limit a rule judges against without being verified. A clean report is only as good as these.`
      )
      // Reporting, not gating: unverified data is a normal state, not a defect.
      return 0
    }

    case "eval": {
      const manifestPath = resolve(positional[0] ?? "eval-corpus/manifest.json")
      try {
        const manifest = decodeEvalManifest(readJson(manifestPath))
        const caseResults = []
        for (const testCase of manifest.cases) {
          const fixturePath = resolve(dirname(manifestPath), testCase.fixture)
          const compiled = await compileOrExit(fixturePath, io)
          if (compiled instanceof CommandExit) return compiled.code
          caseResults.push(evaluateCase(testCase, compiled.diagnostics))
        }
        const report = createCorpusReport(caseResults)
        const outDir = resolve(flags["out"] ?? "dist/eval")
        writeOut(
          outDir,
          "eval-report.json",
          JSON.stringify(report, null, 2) + "\n",
          io
        )
        for (const testCase of report.cases) {
          io.out(`${testCase.passed ? "PASS" : "FAIL"} ${testCase.id} [${testCase.provenance.kind}]`)
        }
        io.out(
          `${report.summary.passed}/${report.summary.total} case(s) passed; ${report.summary.byProvenance["field-verified"]} field-verified case(s).`
        )
        return report.summary.failed > 0 ? 1 : 0
      } catch (cause) {
        io.err(
          `Failed to evaluate ${manifestPath}: ${cause instanceof Error ? cause.message : String(cause)}`
        )
        return 2
      }
    }

    case "quote": {
      const file = positional[0]
      if (file === undefined) return usage(io)
      const result = await compileOrExit(file, io)
      if (result instanceof CommandExit) return result.code
      const model = result.config.costing
      if (model === undefined) {
        io.err("No costing model: add `costing: { laborRatePerHour, ... }` to nerve.config.ts (PRD §29).")
        return 2
      }
      const quote = generateQuote(result.hir, model)
      const outDir = resolve(flags["out"] ?? result.config.outputDir ?? "dist")
      writeOut(outDir, "quote.csv", quoteCsv(result.hir, model), io)
      writeOut(outDir, "quote.json", quoteJson(result.hir, model), io)
      io.out(
        `${quote.harness.id} rev ${quote.harness.revision} — material ${quote.materialCost.toFixed(2)} + scrap ${quote.scrapCost.toFixed(2)} + labor ${quote.laborCost.toFixed(2)} = ${quote.totalCost.toFixed(2)} ${quote.currency} (${quote.perUnitCost.toFixed(2)}/unit @ ${(quote.assumptions.yield * 100).toFixed(0)}% yield)`
      )
      for (const mpn of quote.longLeadItems) io.out(`LONG-LEAD: ${mpn}`)
      for (const mpn of quote.lifecycleRisks) io.out(`LIFECYCLE: ${mpn}`)
      for (const item of quote.unpricedItems) io.out(`UNPRICED: ${item}`)
      return 0
    }

    case "analyze": {
      const file = positional[0]
      if (file === undefined) return usage(io)
      const result = await compileOrExit(file, io)
      if (result instanceof CommandExit) return result.code
      const report = analyzeHarness(result.hir)
      const outDir = resolve(flags["out"] ?? result.config.outputDir ?? "dist")
      writeOut(outDir, "analysis.csv", analysisCsv(result.hir), io)
      writeOut(outDir, "analysis.json", analysisJson(result.hir), io)
      io.out(
        `${report.harness.id} rev ${report.harness.revision} — ${report.totals.wireLengthM} m wire, ~${report.totals.estimatedWeightG} g, ${report.branches.map((b) => `${b.id}: Ø${b.bundleDiameterMm}mm`).join(", ")}`
      )
      return 0
    }

    case "machine": {
      const [adapterId, file] = positional
      if (adapterId === undefined || file === undefined) return usage(io)
      const adapter = findAdapter(adapterId)
      if (adapter === undefined) {
        io.err(`Unknown adapter: ${adapterId}. Available: ${builtinAdapters.map((a) => a.id).join(", ")}`)
        return 2
      }
      const result = await compileOrExit(file, io)
      if (result instanceof CommandExit) return result.code
      const { files, diagnostics } = adapter.generate(result.hir)
      printDiagnostics(diagnostics, io, flags["codes"] !== undefined)
      if (hasErrors(diagnostics)) return 1
      const outDir = resolve(flags["out"] ?? result.config.outputDir ?? "dist")
      for (const [name, contents] of files) writeOut(outDir, name, contents, io)
      return 0
    }

    case "contract": {
      const file = positional[0]
      const connectorRef = flags["connector"]
      if (file === undefined || connectorRef === undefined) return usage(io)
      const result = await compileOrExit(file, io)
      if (result instanceof CommandExit) return result.code
      const against = flags["against"]
      if (against !== undefined) {
        let contract: ConnectorContract | undefined
        try {
          const raw = readFileSync(resolve(against), "utf8")
          if (against.endsWith(".csv")) {
            contract = importPinoutCsv(raw, { connector: connectorRef })
          } else if (findContractImporter(against) !== undefined) {
            const component = flags["component"]
            const named =
              component === undefined
                ? { connector: connectorRef }
                : { connector: connectorRef, component }
            contract = findContractImporter(against)!.import(raw, {
              ...named,
              sourceName: basename(against)
            })
            if (contract === undefined) {
              io.err(`Component ${flags["component"] ?? connectorRef} not found in ${against}.`)
              return 2
            }
          } else if (against.endsWith(".circuit.json")) {
            // PRD §37: validate the harness against a tscircuit board.
            const component = flags["component"]
            contract = importTscircuitPinout(
              parseTscircuitCircuitJson(raw),
              component === undefined
                ? { connector: connectorRef }
                : { connector: connectorRef, component }
            )
            if (contract === undefined) {
              io.err(`Component ${flags["component"] ?? connectorRef} not found in ${against}.`)
              return 2
            }
          } else {
            contract = JSON.parse(raw)
          }
        } catch (cause) {
          io.err(`Failed to load contract ${against}: ${cause instanceof Error ? cause.message : String(cause)}`)
          return 2
        }
        if (contract === undefined) {
          io.err(`Contract importer did not produce a contract for ${against}.`)
          return 2
        }
        const diagnostics = validateContract(result.hir, contract)
        const outDir = resolve(flags["out"] ?? result.config.outputDir ?? "dist")
        writeOut(
          outDir,
          `contract-${connectorRef}.normalized.json`,
          contractJson(contract),
          io
        )
        printDiagnostics(diagnostics, io, flags["codes"] !== undefined)
        io.out(
          diagnostics.length === 0
            ? `Connector ${connectorRef} conforms to ${against}.`
            : `${diagnostics.length} contract issue(s) for ${connectorRef}.`
        )
        return hasErrors(diagnostics) ? 1 : 0
      }
      const contract = exportConnectorContract(result.hir, connectorRef)
      if (contract === undefined) {
        io.err(`Connector ${connectorRef} not found in ${result.hir.harness.id}.`)
        return 2
      }
      const outDir = resolve(flags["out"] ?? result.config.outputDir ?? "dist")
      if (flags["format"] === "circuit-json") {
        // PRD §37 reverse direction: hand tscircuit the harness side.
        writeOut(
          outDir,
          `${connectorRef}.circuit.json`,
          JSON.stringify(exportTscircuitCircuitJson(result.hir, connectorRef), null, 2) + "\n",
          io
        )
        return 0
      }
      writeOut(outDir, `contract-${connectorRef}.json`, contractJson(contract), io)
      return 0
    }

    case "release": {
      const file = positional[0]
      const eco = flags["eco"]
      const reason = flags["reason"]
      const date = flags["date"]
      if (file === undefined || eco === undefined || reason === undefined || date === undefined) return usage(io)
      const result = await compileOrExit(file, io)
      if (result instanceof CommandExit) return result.code
      let previous
      if (flags["against"] !== undefined) {
        try {
          const prevRelease = JSON.parse(readFileSync(resolve(flags["against"]), "utf8"))
          const prevDir = resolve(flags["against"], "..")
          const prevHir = decodeHir(readJson(join(prevDir, "harness.json")))
          previous = { hir: prevHir, releaseId: prevRelease.releaseId }
        } catch (cause) {
          io.err(`Failed to load previous release: ${cause instanceof Error ? cause.message : String(cause)}`)
          return 2
        }
      }
      try {
        const author = flags["author"]
        const dated = {
          eco: author === undefined ? { id: eco, reason } : { id: eco, reason, author },
          createdAt: date
        }
        const release = createRelease(
          result.hir,
          previous === undefined ? dated : { ...dated, previous }
        )
        const outDir = resolve(flags["out"] ?? result.config.outputDir ?? "dist")
        writeOut(outDir, "harness.json", JSON.stringify(result.hir, null, 2) + "\n", io)
        writeOut(outDir, `release-${result.hir.harness.revision}.json`, releaseJson(release), io)
        io.out(
          `Release ${release.releaseId} (${eco}) — fingerprint ${release.hirFingerprint}` +
            (release.impact !== undefined
              ? ` — impact: ${release.impact.riskScore} (${release.impact.risk}), ${release.impact.pinoutChanges} pinout / ${release.impact.wireChanges} wire change(s)`
              : "")
        )
        return 0
      } catch (cause) {
        if (cause instanceof ReleaseBlockedError) {
          io.err(cause.message)
          return 1
        }
        throw cause
      }
    }

    case "record": {
      const file = positional[0]
      const releasePath = flags["release"]
      const serial = flags["serial"]
      const operator = flags["operator"]
      const date = flags["date"]
      const resultsPath = flags["results"]
      if (file === undefined || releasePath === undefined || serial === undefined || operator === undefined || date === undefined || resultsPath === undefined) {
        return usage(io)
      }
      const result = await compileOrExit(file, io)
      if (result instanceof CommandExit) return result.code
      // --lengths is the as-built half of the loop (§36): the technician's
      // measured wire lengths, judged against design length + tolerance.
      // Optional on purpose — a continuity-only record stays byte-identical.
      const lengthsPath = flags["lengths"]
      let release, measurements, lengths
      try {
        release = JSON.parse(readFileSync(resolve(releasePath), "utf8"))
        measurements = JSON.parse(readFileSync(resolve(resultsPath), "utf8"))
        lengths =
          lengthsPath !== undefined
            ? JSON.parse(readFileSync(resolve(lengthsPath), "utf8"))
            : undefined
      } catch (cause) {
        io.err(`Failed to load inputs: ${cause instanceof Error ? cause.message : String(cause)}`)
        return 2
      }
      const lengthTolerance = flags["length-tolerance"]
      const lot = flags["lot"]
      const workstation = flags["workstation"]
      const identified = { serial, operator, buildDate: date }
      const lotted = lot === undefined ? identified : { ...identified, lot }
      const stationed = workstation === undefined ? lotted : { ...lotted, workstation }
      const measuredLengths = lengths === undefined ? stationed : { ...stationed, lengths }
      const recordOptions =
        lengthTolerance === undefined
          ? measuredLengths
          : { ...measuredLengths, defaultLengthTolerance: Number(lengthTolerance) }
      const record = createBuildRecord(result.hir, release, measurements, recordOptions)
      const outDir = resolve(flags["out"] ?? result.config.outputDir ?? "dist")
      writeOut(outDir, `build-record-${serial}.json`, buildRecordJson(record), io)
      io.out(
        `${serial}: ${record.summary.pass} pass / ${record.summary.fail} fail / ${record.summary.notRun} not run → ${record.summary.status.toUpperCase()}`
      )
      if (record.lengthSummary !== undefined) {
        const l = record.lengthSummary
        io.out(
          `${serial} lengths: ${l.inTolerance} in tolerance / ${l.outOfTolerance} out / ${l.noDesignLength} no design length`
        )
        if (l.outOfTolerance > 0) {
          io.out(`Turn these into redlines: nerve redline from-record ${file} --record ${join(outDir, `build-record-${serial}.json`)}`)
        }
      }
      return record.summary.status === "fail" ? 1 : 0
    }

    case "redline": {
      const sub = positional[0]
      if (sub === "add") {
        const file = positional[1]
        const target = flags["target"]
        const type = flags["type"]
        const description = flags["description"]
        if (file === undefined || target === undefined || type === undefined || description === undefined) return usage(io)
        const result = await compileOrExit(file, io)
        if (result instanceof CommandExit) return result.code
        const invalid = validateRedlineTarget(result.hir, target)
        if (invalid !== undefined) {
          printDiagnostics([invalid], io, flags["codes"] !== undefined)
          return 1
        }
        if (!Schema.is(RedlineTypeSchema)(type)) {
          io.err(`Unsupported redline type: ${type} (supported: ${REDLINE_TYPES.join(", ")})`)
          return 2
        }
        const redlinesPath = resolve(flags["file"] ?? "redlines.json")
        const existing = existsSync(redlinesPath) ? readJsonArray(redlinesPath) : []
        const proposedValue = flags["value"]
        const serial = flags["serial"]
        const reportedBy = flags["by"]
        const described = {
          id: `RL-${String(existing.length + 1).padStart(3, "0")}`,
          target,
          type,
          description
        }
        const proposed =
          proposedValue === undefined ? described : { ...described, proposedValue }
        const released = {
          ...proposed,
          release: flags["release"] ?? `${result.hir.harness.id}@${result.hir.harness.revision}`
        }
        const serialized = serial === undefined ? released : { ...released, serial }
        const redline = createRedline(
          reportedBy === undefined ? serialized : { ...serialized, reportedBy }
        )
        writeFileSync(redlinesPath, JSON.stringify([...existing, redline], null, 2) + "\n")
        io.out(`Recorded ${redline.id} against ${target} in ${redlinesPath}`)
        return 0
      }
      // Bulk-generate redlines from a build record's out-of-tolerance
      // lengths — the return leg of the loop. Doing this by hand is one
      // `redline add` per wire, which is why nobody does it.
      if (sub === "from-record") {
        const file = positional[1]
        const recordPath = flags["record"]
        if (file === undefined || recordPath === undefined) return usage(io)
        const result = await compileOrExit(file, io)
        if (result instanceof CommandExit) return result.code
        let record
        try {
          record = JSON.parse(readFileSync(resolve(recordPath), "utf8"))
        } catch (cause) {
          io.err(`Failed to load ${recordPath}: ${cause instanceof Error ? cause.message : String(cause)}`)
          return 2
        }
        const idPrefix = flags["prefix"]
        const reportedBy = flags["by"]
        const prefixed = idPrefix === undefined ? {} : { idPrefix }
        const generated = redlinesFromBuildRecord(
          record,
          reportedBy === undefined ? prefixed : { ...prefixed, reportedBy }
        )
        if (generated.length === 0) {
          io.out("No out-of-tolerance lengths in this build record; nothing to redline.")
          return 0
        }
        const redlinesPath = resolve(flags["file"] ?? "redlines.json")
        const existing = existsSync(redlinesPath) ? readJsonArray(redlinesPath) : []
        const seen = new Set(existing.map(entryId))
        const fresh = generated.filter((r) => !seen.has(r.id))
        writeFileSync(redlinesPath, JSON.stringify([...existing, ...fresh], null, 2) + "\n")
        for (const r of fresh) io.out(`${r.id}  ${r.target}  ${r.description}`)
        const skipped = generated.length - fresh.length
        io.out(
          `Recorded ${fresh.length} redline(s) in ${redlinesPath}${skipped > 0 ? ` (${skipped} already present)` : ""}`
        )
        return 0
      }
      // Collapse every accepted redline into one variant()-shaped patch, so a
      // whole build's feedback is a single reviewable change, not N.
      if (sub === "patch") {
        const redlinesPath = positional[1]
        if (redlinesPath === undefined) return usage(io)
        let redlines
        try {
          redlines = decodeRedlines(readJson(resolve(redlinesPath)))
        } catch (cause) {
          io.err(`Failed to load ${redlinesPath}: ${cause instanceof Error ? cause.message : String(cause)}`)
          return 2
        }
        const accepted = redlines.filter((r) => r.status === "accepted")
        const patches = accepted.map((r) => suggestPatch(r)).filter((p) => p !== undefined)
        if (patches.length === 0) {
          io.out("No accepted redlines yield a structured patch.")
          return 0
        }
        const merged = mergePatches(patches)
        const json = JSON.stringify(merged, null, 2) + "\n"
        if (flags["out"] !== undefined) {
          writeOut(resolve(flags["out"]), "redline-patch.json", json, io)
        } else {
          io.out(json.trimEnd())
        }
        io.out(`${patches.length} accepted redline(s) merged into one patch.`)
        return 0
      }
      if (sub === "resolve") {
        const redlinesPath = positional[1]
        const id = flags["id"]
        const reason = flags["reason"]
        const date = flags["date"]
        const accept = flags["accept"] === "true"
        const reject = flags["reject"] === "true"
        if (redlinesPath === undefined || id === undefined || reason === undefined || date === undefined || accept === reject) return usage(io)
        const redlines = readJsonArray(resolve(redlinesPath))
        const index = redlines.findIndex((entry) => entryId(entry) === id)
        const existing = redlines[index]
        if (existing === undefined) {
          io.err(`Redline ${id} not found in ${redlinesPath}.`)
          return 2
        }
        const by = flags["by"]
        const decision = { accept, reason, resolvedAt: date }
        const resolved = resolveRedline(
          decodeRedline(existing),
          by === undefined ? decision : { ...decision, by }
        )
        // Every other entry is written back verbatim.
        const updated = [...redlines.slice(0, index), resolved, ...redlines.slice(index + 1)]
        writeFileSync(resolve(redlinesPath), JSON.stringify(updated, null, 2) + "\n")
        io.out(`${id} ${resolved.status}.`)
        if (resolved.status === "accepted") {
          const patch = suggestPatch(resolved)
          if (patch !== undefined) {
            io.out("Structured patch (apply via variant() or edit the source):")
            io.out(JSON.stringify(patch, null, 2))
          }
        }
        return 0
      }
      return usage(io)
    }

    case "diff": {
      const [pathA, pathB] = positional
      if (pathA === undefined || pathB === undefined) return usage(io)
      const a = await loadHirForDiff(pathA, io)
      if (a instanceof CommandExit) return a.code
      const b = await loadHirForDiff(pathB, io)
      if (b instanceof CommandExit) return b.code
      const d = diffHir(a, b)
      // Structural diff alone is blind to a design walking toward a cliff
      // without stepping off it: a revision that eats 30% of the thermal
      // headroom adds no finding and changes no object. Margin movement is
      // the only channel that shows it.
      const rules = builtinRulesWith()
      const md = diffMargins(
        runRulesWithMargins(a, rules).margins,
        runRulesWithMargins(b, rules).margins
      )
      if (flags["json"] === "true") {
        io.out(JSON.stringify({ ...d, margins: md }, null, 2))
      } else {
        io.out(formatDiff(d).trimEnd())
        if (!md.unchanged) {
          const worsened = md.changes.filter((c) => c.kind === "worsened")
          io.out(`\nMargin movement: ${worsened.length} worsened, ${md.changes.filter((c) => c.kind === "improved").length} improved`)
          if (md.worstRegression !== undefined) {
            const w = md.worstRegression
            io.out(
              `  worst: ${w.quantity} on ${w.target} ${(w.before!.utilization * 100).toFixed(1)}% → ${(w.after!.utilization * 100).toFixed(1)}%${w.crossedLimit === true ? "  (crossed the limit)" : ""}`
            )
          }
        }
      }
      // git-diff convention: exit 1 when differences exist.
      return isEmptyDiff(d) && md.unchanged ? 0 : 1
    }

    case "inspect": {
      const file = positional[0]
      if (file === undefined) return usage(io)
      try {
        const hir = decodeHir(readJson(resolve(file)))
        io.out(`schema   ${hir.schemaVersion}`)
        io.out(`harness  ${hir.harness.id}`)
        io.out(`revision ${hir.harness.revision}`)
        io.out(`units    ${hir.harness.units}`)
        io.out(`connectors ${hir.connectors.length}`)
        io.out(`wires      ${hir.wires.length}`)
        io.out(`branches   ${hir.branches.length}`)
        io.out(`labels     ${hir.labels.length}`)
        io.out(`bom items  ${hir.bom.length}`)
        io.out(
          `diagnostics ${hir.diagnostics.length} (${hir.diagnostics.filter((d) => d.severity === "error").length} errors)`
        )
        return 0
      } catch (cause) {
        io.err(
          `Failed to inspect ${file}: ${cause instanceof Error ? cause.message : String(cause)}`
        )
        return 2
      }
    }

    case "parts": {
      // Bundled library introspection for humans and agents: the same data
      // behind editor completions and the generated docs page.
      const { allParts, partCoverage, partInfo, partSpecs, scaffoldPartSource } = await import(
        "@grayhaven/nerve-connectors"
      )
      // `parts scaffold` is the cheap path to declaring an unknown part: a
      // stub with every rule-relevant field present and annotated with the
      // check it unlocks, so nothing goes dark by accident.
      if (positional[0] === "scaffold") {
        const mpn = positional[1]
        const pins = flags["pins"]
        if (mpn === undefined || pins === undefined) return usage(io)
        const pinCount = Number(pins)
        if (!Number.isInteger(pinCount) || pinCount < 1) {
          io.err(`--pins must be a positive integer, got "${pins}".`)
          return 2
        }
        const source = scaffoldPartSource(mpn, pinCount)
        if (flags["out"] !== undefined) {
          const file = `${mpn.replace(/[^A-Za-z0-9.-]/g, "-")}.ts`
          writeOut(resolve(flags["out"]), file, source, io)
        } else {
          io.out(source.trimEnd())
        }
        return 0
      }
      const query = positional[0]
      if (query !== undefined) {
        const info = partInfo(query)
        if (info === undefined) {
          io.err(`Unknown part "${query}". Try: nerve parts`)
          return 2
        }
        // Which built-in checks this part's data actually enables. A part
        // missing `wireGaugeRange` produces a clean report only because
        // HK-MFG-004 never ran — say so instead of letting it look verified.
        const cov = partCoverage(info.part)
        if (flags["json"] !== undefined) {
          io.out(JSON.stringify({ ...info, coverage: cov }, null, 2))
        } else {
          const p = info.part
          io.out(`mpn        ${info.mpn}`)
          if (info.specs.length > 0) io.out(`specs      ${info.specs.join(", ")}`)
          if (p.family !== undefined) io.out(`family     ${p.family}`)
          if (p.description !== undefined) io.out(`desc       ${p.description}`)
          io.out(`pins       ${p.pinCount}`)
          if (p.gender !== undefined) io.out(`gender     ${p.gender}`)
          if (p.wireGaugeRange !== undefined) io.out(`gauge      ${p.wireGaugeRange.max} to ${p.wireGaugeRange.min}`)
          if (p.currentLimitA !== undefined) io.out(`current    ${p.currentLimitA}A`)
          if (p.voltageLimitV !== undefined) io.out(`voltage    ${p.voltageLimitV}V`)
          if (p.matingMpn !== undefined) io.out(`mates with ${p.matingMpn}`)
          if (p.provenance !== undefined) io.out(`verified   ${p.provenance.verification}`)
          io.out(`checks     ${cov.active.length} active, ${cov.inactive.length} inactive`)
          for (const i of cov.inactive) {
            io.out(`  inactive ${i.code} — needs ${i.missingField}`)
          }
        }
        return 0
      }
      const rows = Object.keys(allParts)
        .sort()
        .map((mpn) => partInfo(mpn)!)
      if (flags["json"] !== undefined) {
        io.out(
          JSON.stringify(
            rows.map((r) => ({
              mpn: r.mpn,
              specs: r.specs,
              family: r.part.family,
              pinCount: r.part.pinCount,
              gender: r.part.gender,
              verification: r.part.provenance?.verification
            })),
            null,
            2
          )
        )
      } else {
        io.out(`${rows.length} parts, ${Object.keys(partSpecs).length} compact specs:`)
        for (const r of rows) {
          const spec = r.specs[0] !== undefined ? ` (${r.specs[0]})` : ""
          io.out(`  ${r.mpn}${spec} — ${r.part.family ?? "?"} · ${r.part.pinCount} pins`)
        }
      }
      return 0
    }

    case "init": {
      const dir = resolve(positional[0] ?? ".")
      const configPath = join(dir, "nerve.config.ts")
      const harnessPath = join(dir, "src", "main.harness.ts")
      if (existsSync(configPath) && existsSync(harnessPath)) {
        io.err(`Refusing to overwrite an existing Nerve project in ${dir}.`)
        return 2
      }
      io.out(`Initialized Nerve project in ${dir}`)
      writeScaffold(dir, initFiles(cliVersion()), io)
      io.out("Next: npm install && nerve compile")
      return 0
    }

    case "setup": {
      const dir = resolve(positional[0] ?? ".")
      io.out(`Nerve CI workflows in ${dir}`)
      const { wrote } = writeScaffold(dir, setupFiles(), io)
      if (wrote > 0) io.out("Commit the workflows; validation, snapshots, and byte-reproducibility now gate every PR.")
      return 0
    }

    case undefined:
    case "help":
    case "--help":
      io.out(USAGE)
      return command === undefined ? 2 : 0

    default:
      io.err(`Unknown command: ${command}`)
      io.out(USAGE)
      return 2
  }
}

const usage = (io: Io): number => {
  io.err("Missing required argument.")
  io.out(USAGE)
  return 2
}

/** bin/nerve.js entrypoint. */
export const main = (): Promise<number> => run(process.argv.slice(2))

export { startDev, type DevServer, type DevIo } from "./dev.js"

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { Effect, Exit, ParseResult, Predicate, Schema } from "effect"
import { DiagnosticSeverity, refs, type Diagnostic, type Hir } from "@grayhaven/nerve"
import {
  contractJson,
  exportConnectorContract,
  exportTscircuitCircuitJson,
  findContractImporter,
  hirFingerprint,
  importKiCadNetlistPinout,
  importPinoutCsv,
  importTscircuitPinout,
  parseTscircuitCircuitJson,
  validateContract,
  type ConnectorContract
} from "@grayhaven/nerve-exporters"
import { findConfig, type CompileFileResult } from "@grayhaven/nerve-compiler"
import type { Io } from "./index.js"
import type { JsonValue } from "@grayhaven/nerve-importers"

const Nonempty = Schema.String.pipe(Schema.minLength(1), Schema.filter((s) => s.trim() === s))
const OptionalString = Schema.optionalWith(Nonempty, { exact: true })
const ManifestString = Schema.String.pipe(
  Schema.filter((s) => s.length === 0 ? "Must not be empty."
    : s.trim() !== s ? "Remove leading or trailing whitespace." : true, {
    title: "a nonempty string without surrounding whitespace"
  })
)
const ManifestOptionalString = Schema.optionalWith(ManifestString, { exact: true })
const InterfaceSchema = Schema.Struct({
  id: ManifestString.pipe(Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: () => "Start with a letter or number; use only letters, numbers, dots, underscores, and hyphens."
  })),
  connector: ManifestString,
  against: ManifestString,
  component: ManifestOptionalString,
  mpn: ManifestOptionalString,
  pins: Schema.optionalWith(Schema.Record({ key: ManifestString, value: ManifestString }).annotations({
    title: "an object mapping source-pad strings to harness-cavity strings"
  }), { exact: true })
}).annotations({ title: "an interface object" })
const ManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal("0.1.0"),
  harness: ManifestString,
  interfaces: Schema.Array(InterfaceSchema).annotations({ title: "an array of interface objects" }).pipe(
    Schema.minItems(1, { message: () => "Add at least one interface." })
  )
}).annotations({ title: "an interface manifest object" })
export type ProjectInterface = typeof InterfaceSchema.Type
export type InterfaceManifest = typeof ManifestSchema.Type

const manifestIssuePath = (path: ReadonlyArray<PropertyKey>): string => path.reduce<string>((current, segment) => {
  if (Predicate.isNumber(segment)) return `${current}[${segment}]`
  if (Predicate.isString(segment) && /^[A-Za-z_$][\w$]*$/.test(segment)) return current === "" ? segment : `${current}.${segment}`
  return `${current}[${JSON.stringify(String(segment))}]`
}, "") || "$"

export const decodeInterfaceManifest = (input: JsonValue): InterfaceManifest => {
  let manifest: InterfaceManifest
  try {
    manifest = Schema.decodeUnknownSync(ManifestSchema)(input, { onExcessProperty: "error", errors: "all" })
  } catch (cause) {
    if (!ParseResult.isParseError(cause)) throw cause
    const issues = ParseResult.ArrayFormatter.formatErrorSync(cause)
    const details = issues.slice(0, 5).map((issue) => {
      const detail = `${manifestIssuePath(issue.path)}: ${issue.message}`
      return detail.length <= 400 ? detail : `${detail.slice(0, 397)}...`
    })
    if (issues.length > details.length) details.push(`${issues.length - details.length} more issue(s). Fix these fields and retry.`)
    throw new Error(details.join("\n"))
  }
  const ids = new Map<string, number>()
  const bindings = new Map<string, number>()
  for (const [index, entry] of manifest.interfaces.entries()) {
    const previousId = ids.get(entry.id)
    if (previousId !== undefined) throw new Error(`interfaces[${index}].id: Duplicate interface id ${JSON.stringify(entry.id)}; already used by interfaces[${previousId}].id.`)
    ids.set(entry.id, index)
    const binding = JSON.stringify([entry.connector, entry.against, entry.component ?? entry.connector])
    const previousBinding = bindings.get(binding)
    if (previousBinding !== undefined) throw new Error(`interfaces[${index}]: Duplicate interface mapping ${JSON.stringify(entry.id)}; connector, against, and component already match interfaces[${previousBinding}].`)
    bindings.set(binding, index)
  }
  return manifest
}

export interface InterfaceCheck {
  readonly id: string
  readonly connector: string
  readonly component: string
  /** Relative to the manifest directory, or cwd for a single check. */
  readonly source: string
  readonly status: "pass" | "fail" | "incomplete"
  readonly contract?: ConnectorContract
  readonly diagnostics: ReadonlyArray<Diagnostic>
}
export interface InterfaceReport {
  readonly schemaVersion: "0.1.0"
  readonly harness: { readonly id: string; readonly revision: string }
  readonly harnessFingerprint: string
  readonly complete: boolean
  readonly interfaces: ReadonlyArray<InterfaceCheck>
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly summary: {
    readonly interfaces: number
    readonly errors: number
    readonly warnings: number
    readonly uncheckedConnectors: ReadonlyArray<string>
  }
}

const json = <A>(value: A): string => JSON.stringify(value, null, 2) + "\n"
const message = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)
const portable = (base: string, path: string): string => relative(base, path).split(sep).join("/")
const hasError = (diagnostics: ReadonlyArray<Diagnostic>): boolean =>
  diagnostics.some((d) => d.severity === DiagnosticSeverity.Error)

const ContractSchema = Schema.Struct({
  contractVersion: Schema.Literal("0.1.0"),
  harness: Schema.Struct({ id: Nonempty, revision: Schema.String }),
  hirSchema: Nonempty,
  connector: Nonempty,
  mpn: Nonempty,
  matingSide: OptionalString,
  source: Schema.optionalWith(Schema.Struct({
    format: Nonempty, name: OptionalString, component: OptionalString,
    designRevision: Schema.optionalWith(Schema.String, { exact: true }),
    formatVersion: OptionalString, generator: OptionalString, contentFingerprint: OptionalString
  }), { exact: true }),
  pinout: Schema.Array(Schema.Struct({
    pin: Nonempty,
    signal: OptionalString,
    connection: Schema.optionalWith(Schema.Literal("net", "unconnected"), { exact: true }),
    sourcePin: OptionalString
  })).pipe(Schema.minItems(1))
})

/** Apply only an explicit complete source-pad → harness-cavity mapping. */
export const mapContractPins = (
  contract: ConnectorContract,
  pins: Readonly<Record<string, string>> | undefined
): ConnectorContract => {
  const seen = new Set<string>()
  const sourcePins = new Set(contract.pinout.map((p) => p.sourcePin ?? p.pin))
  if (pins !== undefined) {
    for (const pin of Object.keys(pins)) {
      if (!sourcePins.has(pin)) throw new Error(`Pin mapping names source pad ${pin}, which does not exist.`)
    }
  }
  const pinout = contract.pinout.map((p) => {
    const sourcePin = p.sourcePin ?? p.pin
    const pin = pins === undefined ? p.pin : pins[sourcePin]
    if (pin === undefined) throw new Error(`Pin mapping is missing source pad ${sourcePin}. Supply every numbered source pad.`)
    if (seen.has(pin)) throw new Error(`Multiple source pads map to harness cavity ${pin}.`)
    seen.add(pin)
    if (p.connection === "net" && p.signal === undefined) throw new Error(`Pad ${sourcePin} declares a net without a signal.`)
    if (p.connection === "unconnected" && p.signal !== undefined) throw new Error(`Pad ${sourcePin} declares both a signal and no connection.`)
    return { ...p, pin, sourcePin }
  }).sort((a, b) => a.pin.localeCompare(b.pin, "en", { numeric: true }))
  if (pinout.length === 0) throw new Error("The source connector has no numbered pins to check.")
  return { ...contract, pinout }
}

const kicadExecutable = (requested: string | undefined): string => {
  if (requested !== undefined) return requested
  const mac = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
  return process.platform === "darwin" && existsSync(mac) ? mac : "kicad-cli"
}

/** KiCad resolves hierarchy and graphical connections; Nerve reads its exported netlist. */
export const exportSchematicNetlist = (path: string, executable?: string): string => {
  const directory = mkdtempSync(join(tmpdir(), "nerve-kicad-"))
  try {
    const output = join(directory, "schematic.net")
    execFileSync(kicadExecutable(executable), [
      "sch", "export", "netlist", "--format", "kicadsexpr", "--output", output, path
    ], { encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] })
    return readFileSync(output, "utf8")
  } catch (cause) {
    throw new Error(`Could not export ${path} with kicad-cli. Install KiCad or pass --kicad-cli /path/to/kicad-cli. ${message(cause)}`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

const loadContract = (
  entry: ProjectInterface,
  path: string,
  source: string,
  rawCache: Map<string, string>,
  executable?: string
): ConnectorContract => {
  let raw = rawCache.get(path)
  if (raw === undefined) {
    raw = path.toLowerCase().endsWith(".kicad_sch") ? exportSchematicNetlist(path, executable) : readFileSync(path, "utf8")
    rawCache.set(path, raw)
  }
  const named = {
    connector: entry.connector,
    component: entry.component ?? entry.connector,
    sourceName: basename(path)
  }
  const meta = entry.mpn === undefined ? named : { ...named, mpn: entry.mpn }
  let contract: ConnectorContract | undefined
  if (path.toLowerCase().endsWith(".kicad_sch")) contract = importKiCadNetlistPinout(raw, meta)
  else if (path.toLowerCase().endsWith(".csv")) contract = importPinoutCsv(raw, meta)
  else if (path.toLowerCase().endsWith(".circuit.json")) contract = importTscircuitPinout(parseTscircuitCircuitJson(raw), meta)
  else {
    const importer = findContractImporter(path)
    contract = importer === undefined
      ? Schema.decodeUnknownSync(ContractSchema)(JSON.parse(raw))
      : importer.import(raw, meta)
  }
  if (contract === undefined) throw new Error(`Component ${meta.component} not found in ${source}.`)
  const mapped = { ...contract, connector: entry.connector }
  return mapContractPins(entry.mpn === undefined ? mapped : { ...mapped, mpn: entry.mpn }, entry.pins)
}

export const checkProjectInterfaces = (
  hir: Hir,
  entries: ReadonlyArray<ProjectInterface>,
  base: string,
  harnessDiagnostics: ReadonlyArray<Diagnostic> = [],
  executable?: string
): InterfaceReport => {
  const rawCache = new Map<string, string>()
  const interfaces: InterfaceCheck[] = [...entries].sort((a, b) => a.id.localeCompare(b.id, "en")).map((entry) => {
    const path = resolve(base, entry.against)
    const source = portable(base, path)
    const identity = { id: entry.id, connector: entry.connector, component: entry.component ?? entry.connector, source }
    try {
      const contract = loadContract(entry, path, source, rawCache, executable)
      const unknownPins = contract.pinout.filter((pin) => pin.signal === undefined && pin.connection === undefined)
      const diagnostics: Diagnostic[] = [...validateContract(hir, contract), ...unknownPins.map((pin) => ({
        code: "HK-IFC-008", severity: DiagnosticSeverity.Warning,
        target: refs.pin(entry.connector, pin.pin),
        message: `Connectivity of ${source} component ${identity.component} pad ${pin.sourcePin ?? pin.pin} is unknown; Nerve ${entry.connector}.${pin.pin} could not be verified.`
      }))]
      return { ...identity, status: unknownPins.length > 0 ? "incomplete" : hasError(diagnostics) ? "fail" : "pass", contract, diagnostics }
    } catch (cause) {
      return {
        ...identity, status: "incomplete", diagnostics: [{
          code: "HK-IFC-007", severity: DiagnosticSeverity.Error,
          target: refs.connector(entry.connector),
          message: `Interface ${entry.id} could not be checked against ${source}: ${message(cause)}`
        }]
      }
    }
  })
  const diagnostics = [...harnessDiagnostics, ...interfaces.flatMap((entry) => entry.diagnostics)]
  const checked = new Set(entries.map((entry) => entry.connector))
  return {
    schemaVersion: "0.1.0",
    harness: { id: hir.harness.id, revision: hir.harness.revision },
    harnessFingerprint: hirFingerprint(hir),
    complete: interfaces.every((entry) => entry.status !== "incomplete"),
    interfaces,
    diagnostics,
    summary: {
      interfaces: interfaces.length,
      errors: diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error).length,
      warnings: diagnostics.filter((d) => d.severity === DiagnosticSeverity.Warning).length,
      uncheckedConnectors: hir.connectors.map((c) => c.ref).filter((ref) => !checked.has(ref)).sort()
    }
  }
}


/** Remove only normalized artifacts previously written by a manifest run. */
const cleanManifestArtifacts = (directory: string, protectedPaths: ReadonlySet<string>): void => {
  const index = join(directory, ".nerve-interface-files.json")
  if (!existsSync(index)) return
  let names: ReadonlyArray<string>
  try { names = Schema.decodeUnknownSync(Schema.Array(Schema.String))(JSON.parse(readFileSync(index, "utf8"))) } catch { return }
  for (const name of names) {
    if (!protectedPaths.has(resolve(directory, name)) && basename(name) === name && /^contract-[A-Za-z0-9][A-Za-z0-9._-]*\.normalized\.json$/.test(name)) {
      rmSync(join(directory, name), { force: true })
    }
  }
  rmSync(index, { force: true })
}

export const runContractCommand = async (
  positional: ReadonlyArray<string>,
  flags: Readonly<Record<string, string>>,
  io: Io,
  compile: (path: string) => Promise<CompileFileResult | undefined>
): Promise<number> => {
  try {
    const manifestPath = flags["manifest"] === undefined ? undefined : resolve(flags["manifest"])
    if (manifestPath !== undefined && (positional.length > 0 || flags["connector"] !== undefined || flags["against"] !== undefined || flags["component"] !== undefined || flags["format"] !== undefined)) {
      throw new Error("Use --manifest on its own, or supply a harness with --connector and --against.")
    }
    const checking = manifestPath !== undefined || flags["against"] !== undefined
    const config = manifestPath === undefined && positional[0] !== undefined
      ? await Effect.runPromiseExit(findConfig(dirname(resolve(positional[0])), { fresh: true }))
      : undefined
    const configuredOutput = config !== undefined && Exit.isSuccess(config) ? config.value.config.outputDir : undefined
    // Invalidate the prior verdict even when parsing or compilation fails this run.
    const preliminaryDirectory = resolve(flags["out"] ?? (manifestPath === undefined ? configuredOutput ?? "dist" : join(dirname(manifestPath), "dist", "interfaces")))
    const reportPath = join(preliminaryDirectory, "interface-report.json")
    if (manifestPath === reportPath || (flags["against"] !== undefined && resolve(flags["against"]) === reportPath)) {
      throw new Error("The output report path overlaps an input. Choose another --out directory.")
    }
    let manifest: InterfaceManifest | undefined
    try {
      manifest = manifestPath === undefined ? undefined : decodeInterfaceManifest(JSON.parse(readFileSync(manifestPath, "utf8")))
    } catch (cause) {
      if (checking) rmSync(reportPath, { force: true })
      const detail = cause instanceof SyntaxError ? `Invalid JSON: ${message(cause)}` : message(cause)
      throw new Error(`Invalid manifest ${manifestPath}: ${detail}`)
    }
    const base = manifestPath === undefined ? process.cwd() : dirname(manifestPath)
    const file = manifest === undefined ? positional[0] : resolve(base, manifest.harness)
    const connector = flags["connector"]
    if (file === undefined || (manifest === undefined && connector === undefined)) {
      throw new Error("Supply a harness and --connector, or --manifest nerve-interfaces.json.")
    }
    const protectedPaths = new Set(manifest?.interfaces.map((entry) => resolve(base, entry.against)) ?? (flags["against"] === undefined ? [] : [resolve(flags["against"])]))
    protectedPaths.add(resolve(file))
    if (protectedPaths.has(reportPath)) throw new Error("The output report path overlaps an input. Choose another --out directory.")
    if (checking) rmSync(reportPath, { force: true })
    if (manifest !== undefined) cleanManifestArtifacts(preliminaryDirectory, protectedPaths)
    else if (flags["against"] !== undefined) {
      const previous = join(preliminaryDirectory, `contract-${encodeURIComponent(connector!)}.normalized.json`)
      if (!protectedPaths.has(previous)) rmSync(previous, { force: true })
    }
    const result = await compile(file)
    if (result === undefined) return 2
    const directory = resolve(flags["out"] ?? (manifest === undefined ? result.config.outputDir ?? "dist" : join(base, "dist", "interfaces")))
    if (manifest === undefined && flags["against"] === undefined) {
      const contract = exportConnectorContract(result.hir, connector!)
      if (contract === undefined) throw new Error(`Connector ${connector} not found in ${result.hir.harness.id}.`)
      const circuit = flags["format"] === "circuit-json"
      const content = circuit ? json(exportTscircuitCircuitJson(result.hir, connector!)) : contractJson(contract)
      const name = circuit ? `${encodeURIComponent(connector!)}.circuit.json` : `contract-${encodeURIComponent(connector!)}.json`
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, name), content)
      io.out(flags["json"] !== undefined ? content.trimEnd() : `wrote ${join(directory, name)}`)
      return 0
    }
    const single = { id: "connector", connector: connector!, against: flags["against"]! }
    const entries = manifest?.interfaces ?? [flags["component"] === undefined ? single : { ...single, component: flags["component"] }]
    const report = checkProjectInterfaces(result.hir, entries, base, result.diagnostics, flags["kicad-cli"])
    mkdirSync(directory, { recursive: true })
    for (const entry of report.interfaces) {
      if (entry.contract !== undefined) {
        const name = manifest === undefined ? encodeURIComponent(entry.connector) : entry.id
        writeFileSync(join(directory, `contract-${name}.normalized.json`), contractJson(entry.contract))
      }
    }
    if (manifest !== undefined) writeFileSync(join(directory, ".nerve-interface-files.json"), json(report.interfaces.filter((entry) => entry.contract !== undefined).map((entry) => `contract-${entry.id}.normalized.json`)))
    writeFileSync(join(directory, "interface-report.json"), json(report))
    if (flags["json"] !== undefined) io.out(json(report).trimEnd())
    else {
      for (const entry of report.interfaces) {
        io.out(entry.status === "pass"
          ? `Connector ${entry.connector} conforms to ${entry.source} (${entry.component}).`
          : `${entry.status.toUpperCase()} ${entry.id}: ${entry.diagnostics.length} contract issue(s) for ${entry.connector}.`)
      }
      for (const diagnostic of report.diagnostics) io.err(`${diagnostic.severity} ${diagnostic.target}${flags["codes"] === undefined ? "" : ` ${diagnostic.code}`}: ${diagnostic.message}`)
      io.out(`${report.summary.interfaces} interface(s), ${report.summary.errors} error(s), ${report.summary.warnings} warning(s).`)
      if (report.summary.uncheckedConnectors.length > 0) io.out(`Connectors without an interface mapping: ${report.summary.uncheckedConnectors.join(", ")}.`)
      io.out(`wrote ${join(directory, "interface-report.json")}`)
    }
    return !report.complete ? 2 : report.summary.errors > 0 ? 1 : 0
  } catch (cause) {
    io.err(`Failed to check interfaces: ${message(cause)}`)
    return 2
  }
}

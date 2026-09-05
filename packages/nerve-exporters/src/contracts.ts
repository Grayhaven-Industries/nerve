/**
 * System interface contracts (PRD §37).
 *
 * A connector contract is the harness-side pinout as a versioned, shareable
 * artifact: PCB teams validate their connector against it, firmware teams
 * validate their signal dictionary, and `validateContract` catches the
 * classic swapped-pin mistake between board and harness revisions.
 */
import { Option, Schema } from "effect"
import {
  DiagnosticSeverity,
  HIR_SCHEMA_VERSION,
  refs,
  type Diagnostic,
  type Hir
} from "@grayhaven/nerve"
import { draft } from "./draft.js"

/** Where an imported contract came from, as recorded in the artifact. */
export interface ContractSource {
  readonly format: string
  readonly name?: string
  readonly component?: string
  readonly designRevision?: string
  readonly formatVersion?: string
  readonly generator?: string
  readonly contentFingerprint?: string
}

export interface ContractPin {
  readonly pin: string
  readonly signal?: string
  /** Known net assignment; unconnected does not by itself prove an NC flag. */
  readonly connection?: "net" | "unconnected"
  /** Pin/pad identifier in the source system when it differs from `pin`. */
  readonly sourcePin?: string
}

export interface ConnectorContract {
  readonly contractVersion: "0.1.0"
  readonly harness: { readonly id: string; readonly revision: string }
  readonly hirSchema: string
  readonly connector: string
  readonly mpn: string
  readonly matingSide?: string
  readonly source?: ContractSource
  readonly pinout: ReadonlyArray<ContractPin>
}

export interface ConnectorContractImportMeta {
  readonly connector: string
  readonly component?: string
  readonly mpn?: string
  readonly sourceName?: string
}

/** Stable import boundary for future Altium/EAGLE neutral-export adapters. */
export interface ConnectorContractImporter {
  readonly id: string
  readonly extensions: ReadonlyArray<string>
  import(
    source: string,
    meta: ConnectorContractImportMeta
  ): ConnectorContract | undefined
}

/** Export the harness-side contract for one connector. */
export const exportConnectorContract = (
  hir: Hir,
  connectorRef: string
): ConnectorContract | undefined => {
  const c = hir.connectors.find((x) => x.ref === connectorRef)
  if (c === undefined) return undefined
  return {
    contractVersion: "0.1.0",
    harness: { id: hir.harness.id, revision: hir.harness.revision },
    hirSchema: HIR_SCHEMA_VERSION,
    connector: c.ref,
    mpn: c.mpn,
    pinout: c.pins.map((p) => ({
      pin: p.pin,
      ...(p.signal !== undefined
        ? { signal: p.signal, connection: "net" as const }
        : { connection: "unconnected" as const })
    }))
  }
}

/**
 * Validate the harness against a contract (e.g. exported from a PCB tool or
 * a previous release). Detects swapped pins, signal renames, and missing or
 * extra pins.
 */
export const validateContract = (
  hir: Hir,
  contract: ConnectorContract
): ReadonlyArray<Diagnostic> => {
  const diagnostics: Array<Diagnostic> = []
  const c = hir.connectors.find((x) => x.ref === contract.connector)
  const sourceComponent = contract.source?.component ?? contract.connector
  const sourceLabel =
    contract.source === undefined
      ? "contract"
      : `${contract.source.format} component ${sourceComponent}`
  if (c === undefined) {
    return [
      {
        code: "HK-IFC-001",
        severity: DiagnosticSeverity.Error,
        message: `${sourceLabel} maps to Nerve connector ${contract.connector}, which does not exist in this harness.`,
        target: refs.connector(contract.connector)
      }
    ]
  }
  // PRD §37: PCB connector, harness connector, and mating connector are
  // linked but distinct — a contract naming the harness part's MATE (the
  // PCB-side housing) is correct, not a mismatch.
  if (c.mpn !== contract.mpn && c.matingMpn !== contract.mpn && contract.mpn !== "unknown") {
    diagnostics.push({
      code: "HK-IFC-002",
      severity: DiagnosticSeverity.Warning,
      message: `Nerve connector ${c.ref} is ${c.mpn} (mates ${c.matingMpn ?? "unspecified"}) but ${sourceLabel} specifies ${contract.mpn}.`,
      target: refs.connector(c.ref)
    })
  }
  const harnessPins = new Map(c.pins.map((p) => [p.pin, p.signal]))
  const contractPins = new Map(contract.pinout.map((p) => [p.pin, p]))
  for (const [pin, expectedPin] of contractPins) {
    const expected = expectedPin.signal
    const sourcePin = expectedPin.sourcePin ?? pin
    if (!harnessPins.has(pin)) {
      diagnostics.push({
        code: "HK-IFC-003",
        severity: DiagnosticSeverity.Error,
        message: `${sourceLabel} pad ${sourcePin} (${expected ?? expectedPin.connection ?? "unassigned"}) maps to Nerve ${c.ref}.${pin}, which is missing from the harness pinout.`,
        target: refs.pin(c.ref, pin)
      })
      continue
    }
    const actual = harnessPins.get(pin)
    if (expected !== undefined && actual !== expected) {
      diagnostics.push({
        code: "HK-IFC-004",
        severity: DiagnosticSeverity.Error,
        message: `Nerve ${c.ref}.${pin} carries ${actual ?? "nothing"}, but ${sourceLabel} pad ${sourcePin} requires ${expected}.`,
        target: refs.pin(c.ref, pin)
      })
    } else if (expectedPin.connection === "unconnected" && actual !== undefined) {
      diagnostics.push({
        code: "HK-IFC-006",
        severity: DiagnosticSeverity.Error,
        message: `Nerve ${c.ref}.${pin} carries ${actual}, but ${sourceLabel} pad ${sourcePin} has no assigned connection in the source.`,
        target: refs.pin(c.ref, pin)
      })
    }
  }
  for (const pin of harnessPins.keys()) {
    if (!contractPins.has(pin)) {
      diagnostics.push({
        code: "HK-IFC-005",
        severity: DiagnosticSeverity.Warning,
        message: `Nerve ${c.ref}.${pin} has no pad counterpart in ${sourceLabel}.`,
        target: refs.pin(c.ref, pin)
      })
    }
  }
  return diagnostics
}

/** Parse a simple pinout CSV ("pin,signal" with optional header) into a contract. */
export const importPinoutCsv = (
  csv: string,
  meta: { readonly connector: string; readonly mpn?: string }
): ConnectorContract => {
  const rows = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.split(",").map((cell) => cell.trim()))
  const body = rows[0]?.[0]?.toLowerCase() === "pin" ? rows.slice(1) : rows
  return {
    contractVersion: "0.1.0",
    harness: { id: "external", revision: "-" },
    hirSchema: HIR_SCHEMA_VERSION,
    connector: meta.connector,
    mpn: meta.mpn ?? "unknown",
    pinout: body.map(([pin, signal]): ContractPin => {
      const entry = draft<ContractPin>({ pin: pin ?? "" })
      if (signal !== undefined && signal !== "") entry.signal = signal
      return entry
    })
  }
}

type SExpression = string | ReadonlyArray<SExpression>
type SExpressionToken = "(" | ")" | { readonly atom: string }

const tokenizeSExpression = (text: string): Array<SExpressionToken> => {
  const tokens: Array<SExpressionToken> = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === ";") {
      while (i < text.length && text[i] !== "\n") i += 1
      continue
    }
    if (ch === "(" || ch === ")") {
      tokens.push(ch)
      i += 1
      continue
    }
    if (ch === '"') {
      let value = ""
      let closed = false
      i += 1
      while (i < text.length) {
        const current = text[i]!
        if (current === '"') {
          i += 1
          closed = true
          break
        }
        if (current === "\\" && i + 1 < text.length) {
          const escaped = text[i + 1]!
          value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped === "r" ? "\r" : escaped
          i += 2
          continue
        }
        value += current
        i += 1
      }
      if (!closed) throw new Error("Unterminated quoted string in KiCad file.")
      tokens.push({ atom: value })
      continue
    }
    let value = ""
    while (i < text.length && !/[\s()]/.test(text[i]!)) {
      value += text[i]!
      i += 1
    }
    if (value !== "") tokens.push({ atom: value })
  }
  return tokens
}

const parseSExpression = (text: string): SExpression => {
  const stack: Array<Array<SExpression>> = []
  let root: SExpression | undefined
  for (const token of tokenizeSExpression(text)) {
    if (token === ")") {
      if (stack.length === 0) throw new Error("Unexpected closing parenthesis in KiCad file.")
      stack.pop()
      continue
    }
    const value: SExpression = token === "(" ? [] : token.atom
    const parent = stack.at(-1)
    if (parent !== undefined) parent.push(value)
    else if (root === undefined) root = value
    else throw new Error("Unexpected content after KiCad root expression.")
    if (Array.isArray(value)) stack.push(value)
  }
  if (stack.length > 0) throw new Error("Unclosed expression in KiCad file.")
  if (root === undefined) throw new Error("Unexpected end of KiCad file.")
  return root
}

const isList = (value: SExpression): value is ReadonlyArray<SExpression> =>
  Array.isArray(value)

/** A present atom (a bare or quoted token); lists and missing slots are not. */
const isAtom = (value: SExpression | undefined): value is string =>
  value !== undefined && !isList(value)

const childrenNamed = (
  list: ReadonlyArray<SExpression>,
  name: string
): ReadonlyArray<ReadonlyArray<SExpression>> =>
  list.filter(
    (value): value is ReadonlyArray<SExpression> =>
      isList(value) && value[0] === name
  )

const scalarChild = (list: ReadonlyArray<SExpression>, name: string): string | undefined => {
  const value = childrenNamed(list, name)[0]?.[1]
  return isAtom(value) ? value : undefined
}

const requiredScalar = (list: ReadonlyArray<SExpression>, name: string, context: string): string => {
  const values = childrenNamed(list, name)
  const value = values[0]?.[1]
  if (values.length !== 1 || !isAtom(value) || value === "") {
    throw new Error(`Expected one non-empty ${name} in ${context}.`)
  }
  return value
}

const sortedPins = (pins: Iterable<ContractPin>): Array<ContractPin> =>
  [...pins].sort((a, b) => a.pin.localeCompare(b.pin, "en", { numeric: true }))

const propertyValue = (
  footprint: ReadonlyArray<SExpression>,
  key: string
): string | undefined => {
  const property = childrenNamed(footprint, "property").find(
    (entry) => entry[1] === key
  )
  const value = property?.[2]
  if (isAtom(value)) return value
  const legacyType = key === "Reference" ? "reference" : key === "Value" ? "value" : undefined
  if (legacyType === undefined) return undefined
  const legacy = childrenNamed(footprint, "fp_text").find(
    (entry) => entry[1] === legacyType
  )
  const legacyValue = legacy?.[2]
  return isAtom(legacyValue) ? legacyValue : undefined
}

/**
 * Import a connector contract from a KiCad 6+ board file. Board footprints
 * contain both the reference designator and pad-to-net assignment, avoiding
 * geometric connectivity inference from the schematic drawing.
 */
export const importKiCadPcbPinout = (
  board: string,
  meta: ConnectorContractImportMeta
): ConnectorContract | undefined => {
  const root = parseSExpression(board)
  if (!isList(root) || root[0] !== "kicad_pcb") {
    throw new Error("Expected a KiCad 6+ .kicad_pcb file.")
  }
  const wanted = meta.component ?? meta.connector
  const footprints = childrenNamed(root, "footprint").filter(
    (entry) => propertyValue(entry, "Reference") === wanted
  )
  if (footprints.length > 1) throw new Error(`Duplicate KiCad footprint reference ${wanted}.`)
  const footprint = footprints[0]
  if (footprint === undefined) return undefined

  const customProperties = new Map(
    childrenNamed(footprint, "property").flatMap((entry) => {
      const name = entry[1]
      const value = entry[2]
      return isAtom(name) && isAtom(value)
        ? [[name.toLowerCase().replace(/[^a-z0-9]/g, ""), value] as const]
        : []
    })
  )
  const mpn =
    meta.mpn ??
    customProperties.get("mpn") ??
    customProperties.get("manufacturerpartnumber") ??
    "unknown"

  const titleBlock = childrenNamed(root, "title_block")[0]
  const designRevision = titleBlock === undefined ? undefined : scalarChild(titleBlock, "rev")
  const formatVersion = scalarChild(root, "version")
  const generatorName = scalarChild(root, "generator")
  const generatorVersion = scalarChild(root, "generator_version")
  const generator =
    generatorName === undefined
      ? undefined
      : generatorVersion === undefined
        ? generatorName
        : `${generatorName} ${generatorVersion}`

  const pads = new Map<string, ContractPin>()
  for (const pad of childrenNamed(footprint, "pad")) {
    const pin = pad[1]
    if (!isAtom(pin) || pin === "") continue
    const net = childrenNamed(pad, "net")[0]
    // KiCad 10 stores just the net name; older boards also include a numeric code.
    const netName = net?.length === 2 ? net[1] : net?.[2]
    const noConnect = scalarChild(pad, "pintype")?.split("+").includes("no_connect") ?? false
    const signal = !noConnect && isAtom(netName) && netName !== "" ? netName : undefined
    const entry: ContractPin = {
      pin,
      sourcePin: pin,
      ...(signal !== undefined
        ? { signal, connection: "net" as const }
        : { connection: "unconnected" as const })
    }
    const existing = pads.get(pin)
    if (existing !== undefined && existing.signal !== entry.signal) {
      throw new Error(`KiCad component ${wanted} has conflicting net assignments on duplicate pad ${pin}.`)
    }
    pads.set(pin, entry)
  }
  const pinout = sortedPins(pads.values())

  // Hash the normalized connector facts, not KiCad object order or file
  // whitespace. This keeps the committed contract stable when pcbnew merely
  // reorders S-expressions while still changing for any checked interface fact.
  const normalizedSource = JSON.stringify({
    format: "kicad-pcb",
    component: wanted,
    mpn,
    designRevision: designRevision ?? null,
    formatVersion: formatVersion ?? null,
    generator: generator ?? null,
    pinout
  })

  // Assembled in serialized key order; optional facts appear only when the
  // board file carried them.
  const source = draft<ContractSource>({ format: "kicad-pcb" })
  if (meta.sourceName !== undefined) source.name = meta.sourceName
  source.component = wanted
  if (designRevision !== undefined) source.designRevision = designRevision
  if (formatVersion !== undefined) source.formatVersion = formatVersion
  if (generator !== undefined) source.generator = generator
  source.contentFingerprint = `fnv1a64:${fnv1a64(normalizedSource)}`

  return {
    contractVersion: "0.1.0",
    harness: { id: "kicad-pcb", revision: designRevision ?? "-" },
    hirSchema: HIR_SCHEMA_VERSION,
    connector: meta.connector,
    mpn,
    source,
    pinout
  }
}

/**
 * Import KiCad's resolved `kicad-cli sch export netlist --format kicadsexpr`
 * output. Library pin inventory includes pins omitted from the nets section;
 * omission alone supplies no no-connect intent. KiCad exports actual NC flags
 * as a `+no_connect` suffix on node pintype, independently of the net name.
 */
export const importKiCadNetlistPinout = (
  netlist: string,
  meta: ConnectorContractImportMeta
): ConnectorContract | undefined => {
  const root = parseSExpression(netlist)
  if (!isList(root) || root[0] !== "export") {
    throw new Error("Expected a KiCad S-expression .net file; export with kicad-cli sch export netlist --format kicadsexpr.")
  }
  const components = childrenNamed(root, "components")[0]
  const libparts = childrenNamed(root, "libparts")[0]
  const nets = childrenNamed(root, "nets")[0]
  if (components === undefined || libparts === undefined || nets === undefined) {
    throw new Error("KiCad netlist requires components, libparts, and nets sections; re-export with --format kicadsexpr.")
  }
  const wanted = meta.component ?? meta.connector
  const matches = childrenNamed(components, "comp").filter((entry) => scalarChild(entry, "ref") === wanted)
  if (matches.length > 1) throw new Error(`Duplicate KiCad component reference ${wanted}.`)
  const component = matches[0]
  if (component === undefined) return undefined

  const libsource = childrenNamed(component, "libsource")[0]
  if (libsource === undefined) throw new Error(`KiCad component ${wanted} has no library source for its pin inventory.`)
  const library = requiredScalar(libsource, "lib", `KiCad component ${wanted} library source`)
  const part = requiredScalar(libsource, "part", `KiCad component ${wanted} library source`)
  const matchingParts = childrenNamed(libparts, "libpart").filter(
    (entry) => scalarChild(entry, "lib") === library && scalarChild(entry, "part") === part
  )
  if (matchingParts.length !== 1) {
    throw new Error(`KiCad component ${wanted} requires one library pin inventory for ${library}:${part}; found ${matchingParts.length}.`)
  }
  const inventory = childrenNamed(matchingParts[0]!, "pins")[0]
  if (inventory === undefined || childrenNamed(inventory, "pin").length === 0) {
    throw new Error(`KiCad component ${wanted} has no library pin inventory; re-export with --format kicadsexpr.`)
  }
  const pins = new Map<string, ContractPin>()
  const libraryNoConnects = new Set<string>()
  for (const pinEntry of childrenNamed(inventory, "pin")) {
    const pin = requiredScalar(pinEntry, "num", `KiCad component ${wanted} library pin`)
    const noConnect = scalarChild(pinEntry, "type") === "no_connect"
    if (pins.has(pin) && libraryNoConnects.has(pin) !== noConnect) {
      throw new Error(`KiCad component ${wanted} has conflicting no-connect declarations for library pin ${pin}.`)
    }
    if (noConnect) libraryNoConnects.add(pin)
    const entry = draft<ContractPin>({ pin, sourcePin: pin })
    if (noConnect) entry.connection = "unconnected"
    pins.set(pin, entry)
  }

  const assignments = new Map<string, { readonly code: string; readonly name: string; readonly noConnect: boolean }>()
  const netNames = new Map<string, string>()
  for (const net of childrenNamed(nets, "net")) {
    const code = requiredScalar(net, "code", "KiCad net")
    const name = requiredScalar(net, "name", `KiCad net ${code}`)
    const previousName = netNames.get(code)
    if (previousName !== undefined && previousName !== name) {
      throw new Error(`KiCad net code ${code} has conflicting names ${previousName} and ${name}.`)
    }
    netNames.set(code, name)
    for (const node of childrenNamed(net, "node")) {
      const ref = requiredScalar(node, "ref", `KiCad net ${name} node`)
      const pin = requiredScalar(node, "pin", `KiCad net ${name} node ${ref}`)
      if (ref !== wanted) continue
      if (!pins.has(pin)) {
        throw new Error(`KiCad component ${wanted} node pin ${pin} is absent from its library pin inventory.`)
      }
      const pinType = scalarChild(node, "pintype")
      const noConnect = pinType?.split("+").includes("no_connect") ?? libraryNoConnects.has(pin)
      const previous = assignments.get(pin)
      if (previous !== undefined && (previous.code !== code || previous.name !== name || previous.noConnect !== noConnect)) {
        throw new Error(`KiCad component ${wanted} pin ${pin} has conflicting net or no-connect assignments (${previous.name}, ${name}).`)
      }
      if (libraryNoConnects.has(pin) && !noConnect) {
        throw new Error(`KiCad component ${wanted} library no-connect pin ${pin} is assigned to net ${name}.`)
      }
      assignments.set(pin, { code, name, noConnect })
      pins.set(pin, {
        pin,
        sourcePin: pin,
        ...(noConnect ? { connection: "unconnected" as const } : { signal: name, connection: "net" as const })
      })
    }
  }

  const properties = new Map<string, string>()
  const fields = childrenNamed(component, "fields")[0]
  for (const field of fields === undefined ? [] : childrenNamed(fields, "field")) {
    const key = scalarChild(field, "name")
    const value = field[2]
    if (key !== undefined && isAtom(value) && value !== "") {
      properties.set(key.toLowerCase().replace(/[^a-z0-9]/g, ""), value)
    }
  }
  for (const property of childrenNamed(component, "property")) {
    const key = scalarChild(property, "name")
    const value = scalarChild(property, "value")
    if (key !== undefined && value !== undefined && value !== "") {
      properties.set(key.toLowerCase().replace(/[^a-z0-9]/g, ""), value)
    }
  }
  const mpn = meta.mpn ?? properties.get("mpn") ?? properties.get("manufacturerpartnumber") ?? "unknown"
  const design = childrenNamed(root, "design")[0]
  const sheets = design === undefined ? [] : childrenNamed(design, "sheet")
  const rootSheet = sheets.find((sheet) => scalarChild(sheet, "name") === "/") ?? sheets[0]
  const titleBlock = rootSheet === undefined ? undefined : childrenNamed(rootSheet, "title_block")[0]
  const designRevision = titleBlock === undefined ? undefined : scalarChild(titleBlock, "rev")
  const formatVersion = scalarChild(root, "version")
  const generator = design === undefined ? undefined : scalarChild(design, "tool")
  const pinout = sortedPins(pins.values())
  const source = draft<ContractSource>({ format: "kicad-netlist" })
  if (meta.sourceName !== undefined) source.name = meta.sourceName
  source.component = wanted
  if (designRevision !== undefined) source.designRevision = designRevision
  if (formatVersion !== undefined) source.formatVersion = formatVersion
  if (generator !== undefined) source.generator = generator
  source.contentFingerprint = `fnv1a64:${fnv1a64(JSON.stringify({
    format: source.format,
    component: wanted,
    mpn,
    designRevision: designRevision ?? null,
    formatVersion: formatVersion ?? null,
    generator: generator ?? null,
    pinout
  }))}`
  return {
    contractVersion: "0.1.0",
    harness: { id: "kicad-netlist", revision: designRevision ?? "-" },
    hirSchema: HIR_SCHEMA_VERSION,
    connector: meta.connector,
    mpn,
    source,
    pinout
  }
}

const fnv1a64 = (text: string): string => {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return hash.toString(16).padStart(16, "0")
}

export const kicadPcbContractImporter: ConnectorContractImporter = {
  id: "kicad-pcb",
  extensions: [".kicad_pcb"],
  import: importKiCadPcbPinout
}

export const kicadNetlistContractImporter: ConnectorContractImporter = {
  id: "kicad-netlist",
  extensions: [".net"],
  import: importKiCadNetlistPinout
}

export const builtinContractImporters: ReadonlyArray<ConnectorContractImporter> = [
  kicadPcbContractImporter,
  kicadNetlistContractImporter
]

export const findContractImporter = (
  filename: string
): ConnectorContractImporter | undefined => {
  const normalized = filename.toLowerCase()
  return builtinContractImporters.find((importer) =>
    importer.extensions.some((extension) => normalized.endsWith(extension))
  )
}

/**
 * The tscircuit Circuit JSON elements the contract importer reads, as
 * circuit-json@0.0.433 defines them. Excess properties in a real board file
 * are ignored on decode; elements of any other type are dropped.
 */
export const TscircuitSourceComponent = Schema.Struct({
  type: Schema.Literal("source_component"),
  source_component_id: Schema.String,
  name: Schema.String,
  ftype: Schema.optional(Schema.String),
  manufacturer_part_number: Schema.optional(Schema.String),
  display_value: Schema.optional(Schema.String)
})
export type TscircuitSourceComponent = Schema.Schema.Type<typeof TscircuitSourceComponent>

export const TscircuitSourcePort = Schema.Struct({
  type: Schema.Literal("source_port"),
  source_port_id: Schema.String,
  source_component_id: Schema.String,
  name: Schema.String,
  pin_number: Schema.optional(Schema.Number),
  port_hints: Schema.optional(Schema.Array(Schema.String))
})
export type TscircuitSourcePort = Schema.Schema.Type<typeof TscircuitSourcePort>

export const TscircuitElement = Schema.Union(TscircuitSourceComponent, TscircuitSourcePort)
export type TscircuitElement = Schema.Schema.Type<typeof TscircuitElement>

const decodeTscircuitElement = Schema.decodeUnknownOption(TscircuitElement)

/**
 * Parse a Circuit JSON file at the I/O boundary: the elements the importer
 * understands come back typed, every other element is dropped. Throws on
 * text that is not a JSON array.
 */
export const parseTscircuitCircuitJson = (text: string): ReadonlyArray<TscircuitElement> =>
  Schema.decodeUnknownSync(Schema.Array(Schema.Unknown))(JSON.parse(text)).flatMap(
    (element) => Option.toArray(decodeTscircuitElement(element))
  )

/**
 * Import a connector pinout from tscircuit Circuit JSON (PRD §37).
 * Circuit JSON is a flat array of typed elements; we read the named
 * `source_component` (the PCB-side connector, e.g. "J1") and its
 * `source_port`s. Signal names come from port_hints (first hint that
 * is not a pinN/number alias) falling back to the port name.
 */
export const importTscircuitPinout = (
  circuitJson: ReadonlyArray<TscircuitElement>,
  meta: { readonly connector: string; readonly component?: string }
): ConnectorContract | undefined => {
  const wanted = meta.component ?? meta.connector
  const component = circuitJson.find(
    (el): el is TscircuitSourceComponent => el.type === "source_component" && el.name === wanted
  )
  if (component === undefined) return undefined
  const componentId = component.source_component_id
  const ports = circuitJson.filter(
    (el): el is TscircuitSourcePort =>
      el.type === "source_port" && el.source_component_id === componentId
  )
  const isAlias = (hint: string, pin: number | undefined): boolean =>
    /^(pin)?\d+$/i.test(hint) && (pin === undefined || hint.replace(/^pin/i, "") === String(pin))
  const pinout = ports
    .map((port): ContractPin => {
      const pinNumber = port.pin_number
      const hints = port.port_hints ?? []
      const name = port.name
      const signal =
        hints.find((h) => !isAlias(h, pinNumber)) ?? (!isAlias(name, pinNumber) ? name : undefined)
      const entry = draft<ContractPin>({
        pin: pinNumber !== undefined ? String(pinNumber) : name
      })
      if (signal !== undefined) entry.signal = signal.toUpperCase()
      return entry
    })
    .filter((p) => p.pin !== "")
    .sort((a, b) => Number(a.pin) - Number(b.pin))
  return {
    contractVersion: "0.1.0",
    harness: { id: "tscircuit", revision: "-" },
    hirSchema: HIR_SCHEMA_VERSION,
    connector: meta.connector,
    mpn: component.manufacturer_part_number ?? "unknown",
    pinout
  }
}

/**
 * Export harness connectors as tscircuit Circuit JSON source elements
 * (PRD §37, reverse direction): a tscircuit board project can validate
 * its connector against the HARNESS as the source of truth. Shapes match
 * circuit-json@0.0.433; ids are deterministic.
 */
export const exportTscircuitCircuitJson = (
  hir: Hir,
  connectorRef?: string
): Array<TscircuitElement> => {
  const connectors =
    connectorRef !== undefined
      ? hir.connectors.filter((c) => c.ref === connectorRef)
      : hir.connectors
  return connectors.flatMap((c): Array<TscircuitElement> => {
    const component = draft<TscircuitSourceComponent>({
      type: "source_component",
      ftype: "simple_chip",
      source_component_id: `nerve_${c.ref}`,
      name: c.ref,
      manufacturer_part_number: c.mpn
    })
    if (c.matingMpn !== undefined) component.display_value = `mates ${c.matingMpn}`
    return [
      component,
      ...c.pins.map(
        (p): TscircuitSourcePort => ({
          type: "source_port",
          source_port_id: `nerve_${c.ref}_pin${p.pin}`,
          source_component_id: `nerve_${c.ref}`,
          name: `pin${p.pin}`,
          pin_number: Number(p.pin),
          port_hints: [...(p.signal !== undefined ? [p.signal] : []), `pin${p.pin}`]
        })
      )
    ]
  })
}

export const contractJson = (contract: ConnectorContract): string =>
  JSON.stringify(contract, null, 2) + "\n"

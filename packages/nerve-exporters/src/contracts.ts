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
  /** Explicit ECAD no-connect state. Omitted means the source did not say. */
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
        message: `Nerve ${c.ref}.${pin} carries ${actual}, but ${sourceLabel} pad ${sourcePin} is explicitly unconnected.`,
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

const tokenizeSExpression = (text: string): Array<string> => {
  const tokens: Array<string> = []
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
      i += 1
      while (i < text.length) {
        const current = text[i]!
        if (current === '"') {
          i += 1
          break
        }
        if (current === "\\" && i + 1 < text.length) {
          const escaped = text[i + 1]!
          value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped
          i += 2
          continue
        }
        value += current
        i += 1
      }
      tokens.push(value)
      continue
    }
    let value = ""
    while (i < text.length && !/[\s()]/.test(text[i]!)) {
      value += text[i]!
      i += 1
    }
    if (value !== "") tokens.push(value)
  }
  return tokens
}

const parseSExpression = (text: string): SExpression => {
  const tokens = tokenizeSExpression(text)
  let cursor = 0
  const parseOne = (): SExpression => {
    const token = tokens[cursor++]
    if (token === undefined) throw new Error("Unexpected end of KiCad file.")
    if (token !== "(") {
      if (token === ")") throw new Error("Unexpected closing parenthesis in KiCad file.")
      return token
    }
    const values: Array<SExpression> = []
    while (tokens[cursor] !== ")") {
      if (tokens[cursor] === undefined) {
        throw new Error("Unclosed expression in KiCad file.")
      }
      values.push(parseOne())
    }
    cursor += 1
    return values
  }
  const root = parseOne()
  if (cursor !== tokens.length) throw new Error("Unexpected content after KiCad root expression.")
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
  const footprint = childrenNamed(root, "footprint").find(
    (entry) => propertyValue(entry, "Reference") === wanted
  )
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

  const scalarChild = (list: ReadonlyArray<SExpression>, name: string): string | undefined => {
    const value = childrenNamed(list, name)[0]?.[1]
    return isAtom(value) ? value : undefined
  }
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

  const pinout = childrenNamed(footprint, "pad")
    .flatMap((pad) => {
      const pin = pad[1]
      if (!isAtom(pin) || pin === "") return []
      const netName = childrenNamed(pad, "net")[0]?.[2]
      const signal = isAtom(netName) && netName !== "" ? netName : undefined
      return [{
        pin,
        sourcePin: pin,
        ...(signal !== undefined
          ? { signal, connection: "net" as const }
          : { connection: "unconnected" as const })
      }]
    })
    .sort((a, b) => a.pin.localeCompare(b.pin, undefined, { numeric: true }))

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

export const builtinContractImporters: ReadonlyArray<ConnectorContractImporter> = [
  kicadPcbContractImporter
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

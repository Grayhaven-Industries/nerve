/**
 * WireViz YAML → HarnessDesign (PRD §27.2).
 *
 * Imports the useful subset: connectors (type, subtype, pincount,
 * pinlabels), cables (gauge, length, wirecount, colors, color_code,
 * wirelabels, shield), named template instances, and connections
 * (alternating connector/cable chains with pin lists, semantic labels, or
 * ranges). Anything WireViz expresses that HIR cannot map cleanly produces
 * an actionable diagnostic instead of silent loss.
 *
 * The YAML tree is decoded once, at the boundary, into the `WireViz*` types
 * below; everything after that works on typed values.
 */
import { parse } from "yaml"
import {
  cable,
  canonicalGauge,
  connector,
  harness,
  wire,
  DiagnosticSeverity,
  type CableDef,
  type CableProps,
  type ConnectorInstance,
  type ConnectorPart,
  type Diagnostic,
  type HarnessDesign,
  type WireDef,
  type WireProps
} from "@grayhaven/nerve"
import { COLOR_CODES, colorFromWireViz, isWireVizColorCodeName } from "./colors.js"

export interface ImportOptions {
  readonly harnessId?: string
  readonly revision?: string
  /** WireViz YAML prepended before the main document (equivalent to --prepend-file). */
  readonly prependYaml?: ReadonlyArray<string>
}

export interface ImportResult {
  readonly design: HarnessDesign
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

type Draft<T> = { -readonly [K in keyof T]: T[K] }
/** Mutable builders for the DSL inputs; optional properties are added only when present. */
type ConnectorPartDraft = Draft<ConnectorPart>
type CablePropsDraft = Draft<CableProps>
type WirePropsDraft = Draft<WireProps>

// --- YAML boundary ----------------------------------------------------------

/** The value tree `yaml.parse` yields under the core schema. */
type YamlValue = string | number | boolean | null | Array<YamlValue> | YamlMapping
interface YamlMapping {
  readonly [key: string]: YamlValue
}

const isMapping = (value: YamlValue | undefined): value is YamlMapping =>
  value !== null && value !== undefined && !Array.isArray(value) && value instanceof Object

const isNumber = (value: YamlValue | undefined): value is number =>
  Number.isFinite(value) ||
  Number.isNaN(value) ||
  value === Number.POSITIVE_INFINITY ||
  value === Number.NEGATIVE_INFINITY

const isText = (value: YamlValue | undefined): value is string =>
  value !== undefined &&
  value !== null &&
  value !== true &&
  value !== false &&
  !Array.isArray(value) &&
  !(value instanceof Object) &&
  !isNumber(value)

/** `String(x)` for a present YAML value; `undefined` stays absent and `null` reads as absent. */
const textOf = (value: YamlValue | undefined): string | undefined =>
  value === undefined || value === null ? undefined : String(value)

const SUPPORTED_CONNECTOR_KEYS = new Set([
  "type",
  "subtype",
  "pincount",
  "pins",
  "pinlabels",
  "pn",
  "manufacturer",
  "mpn",
  "notes"
])
const SUPPORTED_CABLE_KEYS = new Set([
  "gauge",
  "length",
  "wirecount",
  "colors",
  "color_code",
  "wirelabels",
  "shield",
  "category",
  "notes"
])

interface WireVizConnector {
  /** `mpn`, else `pn`, else `type`, else the designator — as text. */
  readonly mpn: string
  /** `type`, when it is text. */
  readonly family: string | undefined
  readonly manufacturer: string | undefined
  /** `subtype`, lower-cased. */
  readonly subtype: string | undefined
  readonly pincount: number | undefined
  /** Explicit `pins` identifiers, as text. */
  readonly pinIds: ReadonlyArray<string>
  /** `pinlabels`; a null entry leaves that pin unlabeled. */
  readonly pinlabels: ReadonlyArray<string | undefined>
  readonly unsupportedKeys: ReadonlyArray<string>
}

interface WireVizLength {
  /** The source text, for diagnostics. */
  readonly source: string
  /** Millimetres, when the source could be converted. */
  readonly mm: number | undefined
}

interface WireVizCable {
  /** `gauge` as written, when it is text or a number. */
  readonly gauge: string | undefined
  readonly length: WireVizLength | undefined
  /** `wirecount`, else the number of declared `colors`. */
  readonly wirecount: number | undefined
  readonly colors: ReadonlyArray<string>
  /** `color_code`, upper-cased. */
  readonly colorCode: string | undefined
  /** `wirelabels`; a null entry leaves that conductor unlabeled. */
  readonly wirelabels: ReadonlyArray<string | undefined>
  /** `true` or a shield description; `true` reads as "shield". */
  readonly shield: string | undefined
  readonly notes: string | undefined
  /** `category: bundle` — loose wires rather than a cable. */
  readonly isBundle: boolean
  readonly unsupportedKeys: ReadonlyArray<string>
}

/** One `{name: pins}` entry of a connection chain, or something that is not one. */
type WireVizChainEntry =
  | { readonly kind: "named"; readonly name: string; readonly pins: ReadonlyArray<string> }
  | { readonly kind: "unrecognized" }

/** One row of `connections`: a chain of entries, or something that is not a sequence. */
type WireVizConnectionRow =
  | { readonly kind: "chain"; readonly entries: ReadonlyArray<WireVizChainEntry> }
  | { readonly kind: "not-a-sequence" }

interface WireVizMetadata {
  readonly title: string | undefined
  readonly pn: string | undefined
  readonly unsupportedKeys: ReadonlyArray<string>
}

interface WireVizDocument {
  readonly connectors: ReadonlyMap<string, WireVizConnector>
  readonly cables: ReadonlyMap<string, WireVizCable>
  readonly connections: ReadonlyArray<WireVizConnectionRow>
  /** `options.template_separator` when it is non-empty text. */
  readonly templateSeparator: string | undefined
  /** `options.template_separator` was given but is not non-empty text. */
  readonly invalidTemplateSeparator: boolean
  readonly unsupportedOptions: ReadonlyArray<string>
  /** Top-level sections WireViz defines that the import does not carry. */
  readonly unsupportedSections: ReadonlyArray<string>
  readonly metadata: WireVizMetadata
}

const LENGTH_UNIT_TO_MM = {
  "": 1000,
  m: 1000,
  meter: 1000,
  meters: 1000,
  metre: 1000,
  metres: 1000,
  cm: 10,
  centimeter: 10,
  centimeters: 10,
  centimetre: 10,
  centimetres: 10,
  mm: 1,
  millimeter: 1,
  millimeters: 1,
  millimetre: 1,
  millimetres: 1,
  in: 25.4,
  inch: 25.4,
  inches: 25.4,
  '"': 25.4,
  ft: 304.8,
  foot: 304.8,
  feet: 304.8,
  "'": 304.8
} as const satisfies Record<string, number>

type LengthUnit = keyof typeof LENGTH_UNIT_TO_MM

const isLengthUnit = (unit: string): unit is LengthUnit => Object.hasOwn(LENGTH_UNIT_TO_MM, unit)

/** WireViz assumes numeric lengths are metres; unit-bearing strings retain their unit. */
const lengthToMm = (length: YamlValue): number | undefined => {
  if (isNumber(length)) return Number.isFinite(length) ? Math.round(length * 1000) : undefined
  if (!isText(length)) return undefined
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([a-zA-Z"']*)$/.exec(length.trim())
  if (match === null) return undefined
  const value = Number(match[1])
  const unit = match[2]!.toLowerCase()
  if (!Number.isFinite(value) || !isLengthUnit(unit)) return undefined
  return Math.round(value * LENGTH_UNIT_TO_MM[unit])
}

/** "1-4" → [1,2,3,4]; "4-1" → [4,3,2,1]; 3 → [3]. */
const expandPins = (spec: YamlValue | undefined): Array<string> => {
  const expandOne = (v: YamlValue | undefined): Array<string> => {
    if (isNumber(v)) return [String(v)]
    if (isText(v)) {
      const range = /^(\d+)\s*-\s*(\d+)$/.exec(v.trim())
      if (range !== null) {
        const lo = Number(range[1])
        const hi = Number(range[2])
        const out: Array<string> = []
        const step = lo <= hi ? 1 : -1
        for (let i = lo; step > 0 ? i <= hi : i >= hi; i += step) out.push(String(i))
        return out
      }
      return [v.trim()]
    }
    return []
  }
  return Array.isArray(spec) ? spec.flatMap(expandOne) : expandOne(spec)
}

const textList = (value: YamlValue | undefined): Array<string> =>
  Array.isArray(value) ? value.map(String) : []

const labelList = (value: YamlValue | undefined): Array<string | undefined> =>
  Array.isArray(value) ? value.map(textOf) : []

const unsupportedKeysOf = (mapping: YamlMapping, supported: ReadonlySet<string>): Array<string> =>
  Object.keys(mapping).filter((key) => !supported.has(key))

const decodeConnector = (ref: string, value: YamlValue): WireVizConnector => {
  if (!isMapping(value)) throw new Error(`WireViz connector "${ref}" must be a mapping.`)
  const pincount = value["pincount"]
  const subtype = value["subtype"]
  const family = value["type"]
  const manufacturer = value["manufacturer"]
  return {
    mpn: String(value["mpn"] ?? value["pn"] ?? value["type"] ?? ref),
    family: isText(family) ? family : undefined,
    manufacturer: isText(manufacturer) ? manufacturer : undefined,
    subtype: isText(subtype) ? subtype.toLowerCase() : undefined,
    pincount: isNumber(pincount) ? pincount : undefined,
    pinIds: textList(value["pins"]),
    pinlabels: labelList(value["pinlabels"]),
    unsupportedKeys: unsupportedKeysOf(value, SUPPORTED_CONNECTOR_KEYS)
  }
}

const decodeCable = (id: string, value: YamlValue): WireVizCable => {
  if (!isMapping(value)) throw new Error(`WireViz cable "${id}" must be a mapping.`)
  const gauge = value["gauge"]
  const length = value["length"]
  const wirecount = value["wirecount"]
  const colors = value["colors"]
  const colorCode = value["color_code"]
  const shield = value["shield"]
  const notes = value["notes"]
  return {
    gauge: isText(gauge) || isNumber(gauge) ? String(gauge) : undefined,
    length: length === undefined ? undefined : { source: String(length), mm: lengthToMm(length) },
    wirecount: isNumber(wirecount)
      ? wirecount
      : Array.isArray(colors)
        ? colors.length
        : undefined,
    colors: textList(colors),
    colorCode: isText(colorCode) ? colorCode.toUpperCase() : undefined,
    wirelabels: labelList(value["wirelabels"]),
    shield: shield === true ? "shield" : isText(shield) ? shield : undefined,
    notes: isText(notes) ? notes : undefined,
    isBundle: value["category"] === "bundle",
    unsupportedKeys: unsupportedKeysOf(value, SUPPORTED_CABLE_KEYS)
  }
}

const decodeChainEntry = (entry: YamlValue): WireVizChainEntry => {
  if (!isMapping(entry)) return { kind: "unrecognized" }
  const first = Object.entries(entry)[0]
  if (first === undefined) return { kind: "unrecognized" }
  const [name, spec] = first
  return { kind: "named", name, pins: expandPins(spec) }
}

const decodeConnectionRow = (row: YamlValue): WireVizConnectionRow =>
  Array.isArray(row)
    ? { kind: "chain", entries: row.map(decodeChainEntry) }
    : { kind: "not-a-sequence" }

const decodeSection = <T>(
  doc: YamlMapping,
  section: string,
  decodeEntry: (key: string, value: YamlValue) => T
): ReadonlyMap<string, T> => {
  const value = doc[section] ?? {}
  if (!isMapping(value)) throw new Error(`WireViz section "${section}" must be a mapping.`)
  return new Map(Object.entries(value).map(([key, entry]) => [key, decodeEntry(key, entry)]))
}

const decodeDocument = (source: string): WireVizDocument => {
  // The core YAML schema (no custom tags) yields only strings, numbers,
  // booleans, null, arrays, and plain objects — exactly `YamlValue`. An
  // empty document parses to null.
  const root: YamlValue = parse(source, { merge: true })
  const doc = root ?? {}
  if (!isMapping(doc)) throw new Error("WireViz source must be a YAML mapping.")

  const connections = doc["connections"] ?? []
  if (!Array.isArray(connections)) throw new Error(`WireViz section "connections" must be a sequence.`)

  const options = doc["options"] ?? {}
  if (!isMapping(options)) throw new Error(`WireViz section "options" must be a mapping.`)
  const separator = options["template_separator"]
  const hasSeparator = isText(separator) && separator.length > 0

  const metadata = doc["metadata"] ?? {}
  if (!isMapping(metadata)) throw new Error(`WireViz section "metadata" must be a mapping.`)
  const title = metadata["title"]
  const pn = metadata["pn"]

  return {
    connectors: decodeSection(doc, "connectors", decodeConnector),
    cables: decodeSection(doc, "cables", decodeCable),
    connections: connections.map(decodeConnectionRow),
    templateSeparator: hasSeparator ? separator : undefined,
    invalidTemplateSeparator: separator !== undefined && !hasSeparator,
    unsupportedOptions: Object.keys(options).filter((key) => key !== "template_separator"),
    unsupportedSections: ["tweak", "additional_bom_items"].filter(
      (section) => doc[section] !== undefined
    ),
    metadata: {
      title: isText(title) ? title : undefined,
      pn: isText(pn) ? pn : undefined,
      unsupportedKeys: Object.keys(metadata).filter((key) => key !== "title" && key !== "pn")
    }
  }
}

// --- Import ------------------------------------------------------------------

const normalizeGauge = (gauge: string | undefined): string | undefined => {
  if (gauge === undefined) return undefined
  const s = gauge.trim()
  // WireViz convention (syntax.md): a unitless gauge number is mm², NOT
  // AWG. Tag it so canonicalGauge/parseAwg never misread "16" (16mm² ≈
  // 5AWG) as 16AWG. Explicit AWG spellings canonicalize as everywhere else.
  if (/awg/i.test(s)) return canonicalGauge(s)
  if (/^\d+(\.\d+)?$/.test(s)) return `${s}mm2`
  return s
}

const addReference = (
  references: Map<string, Array<string>>,
  reference: string | undefined,
  value: string
): void => {
  if (reference === undefined) return
  const key = reference.trim()
  if (key === "") return
  const values = references.get(key) ?? []
  if (!values.includes(value)) values.push(value)
  references.set(key, values)
}

const splitGeneratedName = (
  name: string,
  separator: string
): { readonly template: string; readonly instance: string } | undefined => {
  const at = name.indexOf(separator)
  if (at <= 0) return undefined
  return {
    template: name.slice(0, at),
    instance: name.slice(at + separator.length)
  }
}

type ImportedMetadata = {
  readonly importedFrom: "wireviz"
  sourceTitle?: string
  sourcePartNumber?: string
}

export const importWireViz = (
  yamlText: string,
  options: ImportOptions = {}
): ImportResult => {
  const source = [...(options.prependYaml ?? []), yamlText].join("\n")
  const doc = decodeDocument(source)
  const diagnostics: Array<Diagnostic> = []
  const report = (
    severity: DiagnosticSeverity,
    message: string,
    target?: string
  ) => {
    const code = "HK-WV-001"
    diagnostics.push(
      target === undefined ? { code, severity, message } : { code, severity, message, target }
    )
  }
  const warn = (message: string, target?: string) =>
    report(DiagnosticSeverity.Warning, message, target)
  const error = (message: string, target?: string) =>
    report(DiagnosticSeverity.Error, message, target)

  const templateSeparator = doc.templateSeparator ?? "."
  if (doc.invalidTemplateSeparator) {
    warn(`WireViz option "template_separator" must be a non-empty string; using ".".`)
  }
  if (doc.unsupportedOptions.length > 0) {
    warn(`WireViz options ${doc.unsupportedOptions.map((key) => `"${key}"`).join(", ")} are not imported.`)
  }

  for (const section of doc.unsupportedSections) {
    warn(`WireViz section "${section}" is not imported.`)
  }

  const importedMetadata: ImportedMetadata = { importedFrom: "wireviz" }
  if (doc.metadata.title !== undefined) importedMetadata.sourceTitle = doc.metadata.title
  if (doc.metadata.pn !== undefined) importedMetadata.sourcePartNumber = doc.metadata.pn
  for (const key of doc.metadata.unsupportedKeys) {
    warn(`WireViz metadata key "${key}" is not imported.`)
  }

  // --- Connectors -----------------------------------------------------------
  const connectors: Array<ConnectorInstance> = []
  const connectorByRef = new Map<string, ConnectorInstance>()
  const connectorPins = new Map<string, ReadonlySet<string>>()
  const connectorPinsByLabel = new Map<string, Map<string, Array<string>>>()
  for (const [ref, def] of doc.connectors) {
    for (const key of def.unsupportedKeys) {
      warn(`Connector ${ref}: WireViz key "${key}" is not imported.`, `connector:${ref}`)
    }
    const pincount = def.pincount ?? Math.max(def.pinlabels.length, def.pinIds.length)
    const pins: Record<string, string> = {}
    const pinsByLabel = new Map<string, Array<string>>()
    def.pinlabels.forEach((label, i) => {
      if (label !== undefined) {
        const pin = def.pinIds[i] ?? String(i + 1)
        pins[pin] = label
        addReference(pinsByLabel, label, pin)
      }
    })
    const part: ConnectorPartDraft = { mpn: def.mpn, pinCount: Math.max(pincount, 1) }
    if (def.manufacturer !== undefined) part.manufacturer = def.manufacturer
    if (def.family !== undefined) part.family = def.family
    if (def.subtype === "female") part.gender = "receptacle"
    else if (def.subtype === "male") part.gender = "plug"
    const instance = connector(ref, part, { pins })
    connectors.push(instance)
    connectorByRef.set(ref, instance)
    connectorPins.set(
      ref,
      new Set(
        def.pinIds.length > 0
          ? def.pinIds
          : Array.from({ length: Math.max(pincount, 1) }, (_, index) => String(index + 1))
      )
    )
    connectorPinsByLabel.set(ref, pinsByLabel)
  }

  // --- Cables ---------------------------------------------------------------
  interface CableInfo {
    readonly def: CableDef
    readonly gauge: string | undefined
    readonly lengthMm: number | undefined
    readonly colors: ReadonlyArray<string>
    readonly conductorReferences: ReadonlyMap<string, ReadonlyArray<string>>
    readonly isBundle: boolean
  }
  const cables: Array<CableDef> = []
  const cableInfo = new Map<string, CableInfo>()
  for (const [id, def] of doc.cables) {
    for (const key of def.unsupportedKeys) {
      warn(`Cable ${id}: WireViz key "${key}" is not imported.`, `cable:${id}`)
    }
    const wirecount = def.wirecount
    let colorTokens = [...def.colors]
    let colors = colorTokens.map(colorFromWireViz)
    const colorCode = def.colorCode
    if (colors.length === 0 && colorCode !== undefined) {
      const cycle = isWireVizColorCodeName(colorCode) ? COLOR_CODES[colorCode] : undefined
      if (cycle !== undefined && wirecount !== undefined) {
        colorTokens = Array.from({ length: wirecount }, (_, i) => cycle[i % cycle.length]!)
        colors = colorTokens.map(colorFromWireViz)
      } else {
        warn(`Cable ${id}: color_code "${colorCode}" is not supported; colors omitted.`, `cable:${id}`)
      }
    }
    const isBundle = def.isBundle
    const lengthMm = def.length?.mm
    if (def.length !== undefined && lengthMm === undefined) {
      warn(`Cable ${id}: length "${def.length.source}" cannot be converted to millimetres.`, `cable:${id}`)
    }
    const cableProps: CablePropsDraft = {}
    if (def.gauge !== undefined) cableProps.type = `${wirecount ?? "?"}x${def.gauge}`
    if (wirecount !== undefined) cableProps.conductors = wirecount
    if (def.shield !== undefined) cableProps.shield = def.shield
    if (def.notes !== undefined) cableProps.notes = def.notes
    const cableDef = cable(id, cableProps)
    const conductorReferences = new Map<string, Array<string>>()
    const wirelabels = def.wirelabels
    const referenceCount = Math.max(wirecount ?? 0, colorTokens.length, wirelabels.length)
    for (let index = 0; index < referenceCount; index++) {
      const conductor = String(index + 1)
      addReference(conductorReferences, conductor, conductor)
      addReference(conductorReferences, wirelabels[index], conductor)
      addReference(conductorReferences, colorTokens[index], conductor)
      addReference(conductorReferences, colors[index], conductor)
    }
    if (!isBundle) cables.push(cableDef)
    cableInfo.set(id, {
      def: cableDef,
      gauge: normalizeGauge(def.gauge),
      lengthMm,
      colors,
      conductorReferences,
      isBundle
    })
  }

  const sourceConnectorRefs = new Set(doc.connectors.keys())
  const sourceCableIds = new Set(doc.cables.keys())
  const directlyUsedConnectors = new Set<string>()
  const directlyUsedCables = new Set<string>()
  const usedConnectorTemplates = new Set<string>()
  const usedCableTemplates = new Set<string>()
  const generatedConnectorOrigins = new Map<string, string>()
  const generatedCableOrigins = new Map<string, string>()

  const resolveConnector = (name: string, row: number): ConnectorInstance | undefined => {
    const exact = connectorByRef.get(name)
    if (exact !== undefined) {
      if (sourceConnectorRefs.has(name)) directlyUsedConnectors.add(name)
      return exact
    }

    const generated = splitGeneratedName(name, templateSeparator)
    if (generated === undefined) return undefined
    if (generated.instance === "") {
      error(
        `Connection row ${row}: unnamed connector autogeneration "${name}" is not representable; assign an explicit designator.`,
        `connector:${generated.template}`
      )
      return undefined
    }
    const template = connectorByRef.get(generated.template)
    if (template === undefined || !sourceConnectorRefs.has(generated.template)) return undefined

    const occupied = connectorByRef.get(generated.instance)
    if (occupied !== undefined) {
      if (generatedConnectorOrigins.get(generated.instance) === generated.template) return occupied
      error(
        `Connection row ${row}: connector designator ${generated.instance} already exists; cannot instantiate template ${generated.template}.`,
        `connector:${generated.instance}`
      )
      return undefined
    }

    const instance = connector(generated.instance, template.part, {
      pins: template.pins,
      terminals: template.terminals,
      seals: template.seals
    })
    connectors.push(instance)
    connectorByRef.set(generated.instance, instance)
    connectorPins.set(generated.instance, connectorPins.get(generated.template) ?? new Set())
    connectorPinsByLabel.set(
      generated.instance,
      connectorPinsByLabel.get(generated.template) ?? new Map()
    )
    usedConnectorTemplates.add(generated.template)
    generatedConnectorOrigins.set(generated.instance, generated.template)
    return instance
  }

  const resolveCable = (name: string, row: number): CableInfo | undefined => {
    const exact = cableInfo.get(name)
    if (exact !== undefined) {
      if (sourceCableIds.has(name)) directlyUsedCables.add(name)
      return exact
    }

    const generated = splitGeneratedName(name, templateSeparator)
    if (generated === undefined) return undefined
    if (generated.instance === "") {
      error(
        `Connection row ${row}: unnamed cable autogeneration "${name}" is not representable; assign an explicit designator.`,
        `cable:${generated.template}`
      )
      return undefined
    }
    const template = cableInfo.get(generated.template)
    if (template === undefined || !sourceCableIds.has(generated.template)) return undefined

    const occupied = cableInfo.get(generated.instance)
    if (occupied !== undefined) {
      if (generatedCableOrigins.get(generated.instance) === generated.template) return occupied
      error(
        `Connection row ${row}: cable designator ${generated.instance} already exists; cannot instantiate template ${generated.template}.`,
        `cable:${generated.instance}`
      )
      return undefined
    }

    const { id: _id, kind: _kind, ...props } = template.def
    const instance = cable(generated.instance, props)
    const info: CableInfo = { ...template, def: instance }
    cableInfo.set(generated.instance, info)
    if (!template.isBundle) cables.push(instance)
    usedCableTemplates.add(generated.template)
    generatedCableOrigins.set(generated.instance, generated.template)
    return info
  }

  const resolveConnectorPin = (
    instance: ConnectorInstance,
    reference: string,
    row: number
  ): string | undefined => {
    if (connectorPins.get(instance.ref)?.has(reference) === true) return reference
    const matches = connectorPinsByLabel.get(instance.ref)?.get(reference) ?? []
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      error(
        `Connection row ${row}: pin label "${reference}" is ambiguous on connector ${instance.ref}.`,
        `connector:${instance.ref}`
      )
      return undefined
    }
    error(
      `Connection row ${row}: pin "${reference}" does not exist on connector ${instance.ref}.`,
      `connector:${instance.ref}`
    )
    return undefined
  }

  const resolveConductor = (
    info: CableInfo,
    reference: string,
    row: number
  ): string | undefined => {
    const matches = info.conductorReferences.get(reference) ?? []
    if (matches.length === 1) return matches[0]
    if (matches.length > 1) {
      error(
        `Connection row ${row}: conductor reference "${reference}" is ambiguous on cable ${info.def.id}.`,
        `cable:${info.def.id}`
      )
      return undefined
    }
    error(
      `Connection row ${row}: conductor "${reference}" does not exist on cable ${info.def.id}.`,
      `cable:${info.def.id}`
    )
    return undefined
  }

  // --- Connections ------------------------------------------------------------
  const wires: Array<WireDef> = []
  let looseWireCounter = 0
  for (const [rowIndex, row] of doc.connections.entries()) {
    if (row.kind === "not-a-sequence") {
      error(`Connection row ${rowIndex + 1} is not a sequence; skipped.`)
      continue
    }
    // Each row is an alternating chain of {connector: pins} / {cable: conductors}.
    const items = row.entries.map((entry) => (entry.kind === "named" ? entry : undefined))
    for (let i = 0; i + 2 < items.length || (items.length === 2 && i === 0); i += 2) {
      const left = items[i]
      const middle = items.length === 2 ? undefined : items[i + 1]
      const right = items.length === 2 ? items[i + 1] : items[i + 2]
      if (left === undefined || right === undefined) {
        error(`Connection row ${rowIndex + 1} has an unrecognized entry; skipped.`)
        break
      }
      const leftConn = resolveConnector(left.name, rowIndex + 1)
      const rightConn = resolveConnector(right.name, rowIndex + 1)
      if (leftConn === undefined || rightConn === undefined) {
        error(
          `Connection row ${rowIndex + 1} references unknown connector ${leftConn === undefined ? left.name : right.name}; skipped.`
        )
        break
      }
      const info = middle !== undefined ? resolveCable(middle.name, rowIndex + 1) : undefined
      if (middle !== undefined && info === undefined) {
        error(`Connection row ${rowIndex + 1} references unknown cable ${middle.name}; skipped.`)
        break
      }
      const pinCounts = [left.pins.length, right.pins.length]
      if (middle !== undefined) pinCounts.push(middle.pins.length)
      if (new Set(pinCounts).size !== 1) {
        error(
          `Connection row ${rowIndex + 1} has mismatched pin counts (${pinCounts.join("/")}); only aligned pins are imported.`
        )
      }
      const count = Math.min(
        left.pins.length,
        right.pins.length,
        middle?.pins.length ?? Number.POSITIVE_INFINITY
      )
      if (count === 0) {
        error(`Connection row ${rowIndex + 1} contains no aligned pins; skipped.`)
        continue
      }
      for (let k = 0; k < count; k++) {
        const fromPin = resolveConnectorPin(leftConn, left.pins[k]!, rowIndex + 1)
        const toPin = resolveConnectorPin(rightConn, right.pins[k]!, rowIndex + 1)
        const conductorReference = middle?.pins[k]
        const conductor =
          conductorReference !== undefined && info !== undefined
            ? resolveConductor(info, conductorReference, rowIndex + 1)
            : undefined
        if (fromPin === undefined || toPin === undefined) continue
        if (middle !== undefined && conductor === undefined) continue
        const cableId = info?.def.id
        const id =
          cableId !== undefined && conductor !== undefined
            ? `${cableId}.${conductor}`
            : `W${++looseWireCounter}`
        const signal =
          leftConn.pins[fromPin] ?? rightConn.pins[toPin]
        const props: WirePropsDraft = {}
        if (info?.gauge !== undefined) props.gauge = info.gauge
        if (info?.lengthMm !== undefined) props.length = info.lengthMm
        if (conductor !== undefined && info !== undefined) {
          const color = info.colors[Number(conductor) - 1]
          if (color !== undefined) props.color = color
          if (cableId !== undefined && cables.some((c) => c.id === cableId)) {
            props.cable = cableId
            props.conductor = conductor
          }
        }
        if (signal !== undefined) props.signal = signal
        wires.push(wire(id, leftConn.pin(fromPin), rightConn.pin(toPin), props))
      }
    }
  }

  if (doc.connections.length > 0 && wires.length === 0) {
    error(`WireViz source declares ${doc.connections.length} connection row(s), but no wires were imported.`)
  }

  const design = harness(options.harnessId ?? "imported-wireviz-harness", {
    revision: options.revision ?? "A",
    units: "mm",
    metadata: importedMetadata,
    connectors: connectors.filter(
      (instance) =>
        !usedConnectorTemplates.has(instance.ref) || directlyUsedConnectors.has(instance.ref)
    ),
    wires,
    cables: cables.filter(
      (instance) => !usedCableTemplates.has(instance.id) || directlyUsedCables.has(instance.id)
    )
  })

  return { design, diagnostics }
}

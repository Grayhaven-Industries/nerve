import { read, utils } from "@e965/xlsx"
import {
  connector,
  harness,
  wire,
  DiagnosticSeverity,
  type ConnectorPart,
  type ConnectorProps,
  type Diagnostic,
  type HarnessDesign,
  type Units,
  type WireProps
} from "@grayhaven/nerve"

type Draft<T> = { -readonly [K in keyof T]: T[K] }

/** A parsed JSON document, as `JSON.parse` yields it. */
export type JsonValue = string | number | boolean | null | Array<JsonValue> | JsonObject
export interface JsonObject {
  readonly [key: string]: JsonValue
}

const isJsonObject = (value: JsonValue): value is JsonObject =>
  value !== null && !Array.isArray(value) && value instanceof Object

const isJsonString = (value: JsonValue): value is string =>
  value !== null &&
  value !== true &&
  value !== false &&
  !Array.isArray(value) &&
  !(value instanceof Object) &&
  !Number.isFinite(value) &&
  !Number.isNaN(value)

/** An object type (not an interface) so a column map is itself a `JsonObject`. */
export type WireListColumnMap = {
  readonly fromConnector: string
  readonly fromPin: string
  readonly toConnector: string
  readonly toPin: string
  readonly wireId?: string
  readonly signal?: string
  readonly gauge?: string
  readonly color?: string
  readonly length?: string
  readonly lengthUnit?: string
  readonly fromMpn?: string
  readonly fromPinCount?: string
  readonly toMpn?: string
  readonly toPinCount?: string
  readonly fromTerminal?: string
  readonly toTerminal?: string
  readonly fromSeal?: string
  readonly toSeal?: string
}

const columnMapKeys = [
  "fromConnector",
  "fromPin",
  "toConnector",
  "toPin",
  "wireId",
  "signal",
  "gauge",
  "color",
  "length",
  "lengthUnit",
  "fromMpn",
  "fromPinCount",
  "toMpn",
  "toPinCount",
  "fromTerminal",
  "toTerminal",
  "fromSeal",
  "toSeal"
] as const satisfies ReadonlyArray<keyof WireListColumnMap>

const requiredColumnMapKeys = ["fromConnector", "fromPin", "toConnector", "toPin"] as const
type RequiredColumnMapKey = (typeof requiredColumnMapKeys)[number]
const isRequiredColumnMapKey = (key: keyof WireListColumnMap): key is RequiredColumnMapKey =>
  requiredColumnMapKeys.some((required) => required === key)

type WireListColumnMapDraft = Draft<WireListColumnMap>

/** Decode and canonically order a reusable wire-list column map. */
export const normalizeWireListColumnMap = (input: JsonValue): WireListColumnMap => {
  if (!isJsonObject(input)) {
    throw new Error("Column map must be a JSON object.")
  }
  const known = new Set<string>(columnMapKeys)
  const unknown = Object.keys(input).filter((key) => !known.has(key)).sort()
  if (unknown.length > 0) {
    throw new Error(`Unknown column-map field(s): ${unknown.join(", ")}.`)
  }
  const validated = new Map<keyof WireListColumnMap, string>()
  for (const key of columnMapKeys) {
    const value = input[key]
    if (value === undefined) {
      if (isRequiredColumnMapKey(key)) {
        throw new Error(`Column map requires ${key}.`)
      }
      continue
    }
    if (!isJsonString(value) || value.trim() === "") {
      throw new Error(`Column-map field ${key} must be a non-empty string.`)
    }
    validated.set(key, value.trim())
  }
  const required = (key: RequiredColumnMapKey): string => {
    const value = validated.get(key)
    if (value === undefined) throw new Error(`Column map requires ${key}.`)
    return value
  }
  const normalized: WireListColumnMapDraft = {
    fromConnector: required("fromConnector"),
    fromPin: required("fromPin"),
    toConnector: required("toConnector"),
    toPin: required("toPin")
  }
  for (const key of columnMapKeys) {
    if (isRequiredColumnMapKey(key)) continue
    const value = validated.get(key)
    if (value !== undefined) normalized[key] = value
  }
  return normalized
}

export const wireListColumnMapJson = (mapping: WireListColumnMap): string =>
  JSON.stringify(normalizeWireListColumnMap(mapping), null, 2) + "\n"

export interface ParsedWireList {
  readonly headers: ReadonlyArray<string>
  readonly rows: ReadonlyArray<Readonly<Record<string, string>>>
}

export interface WireListImportOptions {
  readonly harnessId?: string
  readonly revision?: string
  readonly units?: Units
  readonly sourceName?: string
}

export interface ImportRowResult {
  readonly row: number
  readonly status: "accepted" | "rejected"
  readonly wireId?: string
  readonly diagnostics: ReadonlyArray<string>
}

export interface WireListImportReport {
  readonly reportVersion: "0.1.0"
  readonly source: string
  readonly harnessId: string
  readonly rows: ReadonlyArray<ImportRowResult>
  readonly accepted: number
  readonly rejected: number
}

export interface WireListImportResult {
  readonly source: string
  readonly design?: HarnessDesign
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly report: WireListImportReport
}

const csvRows = (text: string): Array<Array<string>> => {
  const rows: Array<Array<string>> = []
  let row: Array<string> = []
  let field = ""
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n") {
      row.push(field.replace(/\r$/, ""))
      if (row.some((v) => v.trim() !== "")) rows.push(row)
      row = []
      field = ""
    } else field += ch
  }
  row.push(field.replace(/\r$/, ""))
  if (row.some((v) => v.trim() !== "")) rows.push(row)
  return rows
}

const tableFromRows = (rows: ReadonlyArray<ReadonlyArray<unknown>>): ParsedWireList => {
  const headers = (rows[0] ?? []).map((v) => String(v ?? "").trim())
  return {
    headers,
    rows: rows.slice(1).map((values) =>
      Object.fromEntries(headers.map((header, i) => [header, String(values[i] ?? "").trim()]))
    )
  }
}

export const parseCsvWireList = (text: string): ParsedWireList => tableFromRows(csvRows(text))

export const parseXlsxWireList = (
  bytes: Uint8Array,
  sheetName?: string
): ParsedWireList => {
  const workbook = read(bytes, { type: "array", cellDates: false })
  const selected = sheetName ?? workbook.SheetNames[0]
  if (selected === undefined || workbook.Sheets[selected] === undefined) {
    throw new Error(
      sheetName === undefined
        ? "Workbook has no worksheets."
        : `Worksheet ${sheetName} was not found. Available: ${workbook.SheetNames.join(", ")}`
    )
  }
  return tableFromRows(
    utils.sheet_to_json<Array<unknown>>(workbook.Sheets[selected], {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false
    })
  )
}

const literal = (value: string): string => JSON.stringify(value)

const numericPinCount = (pins: ReadonlySet<string>): number => {
  const numbers = [...pins].map(Number).filter((n) => Number.isInteger(n) && n > 0)
  return Math.max(pins.size, numbers.length > 0 ? Math.max(...numbers) : 1)
}

const safeNumber = (value: string): number | undefined => {
  if (value.trim() === "") return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const convertLength = (value: number, from: string | undefined, to: Units): number => {
  const unit = from?.trim().toLowerCase()
  if (unit === undefined || unit === "" || unit === to) return value
  if ((unit === "in" || unit === "inch" || unit === "inches") && to === "mm") {
    return Number((value * 25.4).toFixed(6))
  }
  if ((unit === "mm" || unit === "millimeter" || unit === "millimeters") && to === "in") {
    return Number((value / 25.4).toFixed(6))
  }
  return value
}

const knownLengthUnit = (value: string): boolean =>
  value === "" ||
  ["mm", "millimeter", "millimeters", "in", "inch", "inches"].includes(
    value.trim().toLowerCase()
  )

interface AcceptedRow {
  readonly row: number
  readonly wireId: string
  readonly fromConnector: string
  readonly fromPin: string
  readonly toConnector: string
  readonly toPin: string
  readonly signal?: string
  readonly gauge?: string
  readonly color?: string
  readonly length?: number
}

type AcceptedRowDraft = Draft<AcceptedRow>
type ConnectorPropsDraft = Draft<ConnectorProps>
type WirePropsDraft = Draft<WireProps>

interface ConnectorDraft {
  readonly ref: string
  readonly pins: Map<string, string>
  readonly seenPins: Set<string>
  readonly terminals: Map<string, string>
  readonly seals: Map<string, string>
  mpn?: string
  pinCount?: number
}

export const importWireList = (
  table: ParsedWireList,
  mapping: WireListColumnMap,
  options: WireListImportOptions = {}
): WireListImportResult => {
  const diagnostics: Array<Diagnostic> = []
  const rowResults: Array<ImportRowResult> = []
  const accepted: Array<AcceptedRow> = []
  const connectors = new Map<string, ConnectorDraft>()
  const wireIds = new Set<string>()
  const harnessId = options.harnessId ?? "imported-harness"
  const units = options.units ?? "mm"
  const sourceName = options.sourceName ?? "wire-list"

  const mappedColumns = [...new Set(Object.values(mapping))]
  for (const column of mappedColumns) {
    if (!table.headers.includes(column)) {
      diagnostics.push({
        code: "HK-IMPORT-001",
        severity: DiagnosticSeverity.Error,
        message: `Mapped column ${column} is missing from ${sourceName}.`
      })
    }
  }
  if (diagnostics.length > 0) {
    const rows = table.rows.map((_, index) => ({
      row: index + 2,
      status: "rejected" as const,
      diagnostics: ["HK-IMPORT-001"]
    }))
    return {
      source: "",
      diagnostics,
      report: {
        reportVersion: "0.1.0",
        source: sourceName,
        harnessId,
        rows,
        accepted: 0,
        rejected: rows.length
      }
    }
  }

  const get = (row: Readonly<Record<string, string>>, column?: string): string =>
    column === undefined ? "" : (row[column] ?? "").trim()
  const draft = (ref: string): ConnectorDraft => {
    const existing = connectors.get(ref)
    if (existing !== undefined) return existing
    const created: ConnectorDraft = {
      ref,
      pins: new Map(),
      seenPins: new Set(),
      terminals: new Map(),
      seals: new Map()
    }
    connectors.set(ref, created)
    return created
  }
  const setPin = (
    connector: ConnectorDraft,
    pin: string,
    signal: string | undefined,
    terminal: string,
    seal: string
  ): void => {
    connector.seenPins.add(pin)
    if (signal !== undefined) connector.pins.set(pin, signal)
    if (terminal !== "") connector.terminals.set(pin, terminal)
    if (seal !== "") connector.seals.set(pin, seal)
  }

  table.rows.forEach((row, index) => {
    const rowNumber = index + 2
    const codes: Array<string> = []
    const fromConnector = get(row, mapping.fromConnector)
    const fromPin = get(row, mapping.fromPin)
    const toConnector = get(row, mapping.toConnector)
    const toPin = get(row, mapping.toPin)
    const missing = [
      ["from connector", fromConnector, mapping.fromConnector],
      ["from pin", fromPin, mapping.fromPin],
      ["to connector", toConnector, mapping.toConnector],
      ["to pin", toPin, mapping.toPin]
    ].filter(([, value]) => value === "")
    if (missing.length > 0) {
      const missingLabels = missing.map(([label]) => label)
      const missingColumns = missing.map(([, , column]) => column)
      diagnostics.push({
        code: "HK-IMPORT-002",
        severity: DiagnosticSeverity.Error,
        message: `Row ${rowNumber} is missing ${missingLabels.join(", ")} (${missingColumns.join(", ")}).`,
        target: `source-row:${rowNumber}`,
        data: { sourceRow: rowNumber, sourceColumn: missingColumns.join(",") }
      })
      rowResults.push({ row: rowNumber, status: "rejected", diagnostics: ["HK-IMPORT-002"] })
      return
    }

    const wireId = get(row, mapping.wireId) || `W${String(index + 1).padStart(3, "0")}`
    if (wireIds.has(wireId)) {
      diagnostics.push({
        code: "HK-IMPORT-003",
        severity: DiagnosticSeverity.Error,
        message: `Row ${rowNumber} repeats wire ID ${wireId}.`,
        target: `source-row:${rowNumber}`,
        data: { sourceRow: rowNumber, sourceColumn: mapping.wireId ?? "(generated wire ID)" }
      })
      rowResults.push({ row: rowNumber, status: "rejected", wireId, diagnostics: ["HK-IMPORT-003"] })
      return
    }

    const rawLength = get(row, mapping.length)
    const parsedLength = safeNumber(rawLength)
    if (rawLength !== "" && parsedLength === undefined) {
      diagnostics.push({
        code: "HK-IMPORT-004",
        severity: DiagnosticSeverity.Error,
        message: `Row ${rowNumber} length ${literal(rawLength)} is not numeric.`,
        target: `source-row:${rowNumber}`,
        data: { sourceRow: rowNumber, sourceColumn: mapping.length ?? "" }
      })
      rowResults.push({ row: rowNumber, status: "rejected", wireId, diagnostics: ["HK-IMPORT-004"] })
      return
    }

    const rawLengthUnit = get(row, mapping.lengthUnit)
    if (rawLength !== "" && !knownLengthUnit(rawLengthUnit)) {
      diagnostics.push({
        code: "HK-IMPORT-006",
        severity: DiagnosticSeverity.Error,
        message: `Row ${rowNumber} length unit ${literal(rawLengthUnit)} is not supported. Use mm or in.`,
        target: `source-row:${rowNumber}`,
        data: { sourceRow: rowNumber, sourceColumn: mapping.lengthUnit ?? "" }
      })
      rowResults.push({ row: rowNumber, status: "rejected", wireId, diagnostics: ["HK-IMPORT-006"] })
      return
    }

    const signalValue = get(row, mapping.signal)
    const signal = signalValue === "" ? undefined : signalValue
    const fromMpn = get(row, mapping.fromMpn)
    const toMpn = get(row, mapping.toMpn)
    const endpointInputs = [
      { ref: fromConnector, pin: fromPin, mpn: fromMpn, mpnColumn: mapping.fromMpn },
      { ref: toConnector, pin: toPin, mpn: toMpn, mpnColumn: mapping.toMpn }
    ]
    for (const endpoint of endpointInputs) {
      const existing = connectors.get(endpoint.ref)
      const existingSignal = existing?.pins.get(endpoint.pin)
      if (signal !== undefined && existingSignal !== undefined && existingSignal !== signal) {
        diagnostics.push({
          code: "HK-IMPORT-005",
          severity: DiagnosticSeverity.Error,
          message: `Row ${rowNumber} assigns ${endpoint.ref}.${endpoint.pin} to ${signal}, but an earlier accepted row assigned ${existingSignal}.`,
          target: `source-row:${rowNumber}`,
          data: { sourceRow: rowNumber, sourceColumn: mapping.signal ?? "" }
        })
        codes.push("HK-IMPORT-005")
      }
      if (endpoint.mpn !== "" && existing?.mpn !== undefined && existing.mpn !== endpoint.mpn) {
        diagnostics.push({
          code: "HK-IMPORT-007",
          severity: DiagnosticSeverity.Error,
          message: `Row ${rowNumber} assigns ${endpoint.ref} part ${endpoint.mpn}, but an earlier accepted row assigned ${existing.mpn}.`,
          target: `source-row:${rowNumber}`,
          data: { sourceRow: rowNumber, sourceColumn: endpoint.mpnColumn ?? "" }
        })
        codes.push("HK-IMPORT-007")
      }
    }
    if (codes.length > 0) {
      rowResults.push({ row: rowNumber, status: "rejected", wireId, diagnostics: codes })
      return
    }

    wireIds.add(wireId)
    const from = draft(fromConnector)
    const to = draft(toConnector)
    if (fromMpn !== "") from.mpn = fromMpn
    if (toMpn !== "") to.mpn = toMpn
    const fromCount = safeNumber(get(row, mapping.fromPinCount))
    const toCount = safeNumber(get(row, mapping.toPinCount))
    if (fromCount !== undefined) from.pinCount = Math.max(from.pinCount ?? 0, fromCount)
    if (toCount !== undefined) to.pinCount = Math.max(to.pinCount ?? 0, toCount)
    setPin(from, fromPin, signal, get(row, mapping.fromTerminal), get(row, mapping.fromSeal))
    setPin(to, toPin, signal, get(row, mapping.toTerminal), get(row, mapping.toSeal))
    const acceptedRow: AcceptedRowDraft = {
      row: rowNumber,
      wireId,
      fromConnector,
      fromPin,
      toConnector,
      toPin
    }
    if (signal !== undefined) acceptedRow.signal = signal
    const gauge = get(row, mapping.gauge)
    if (gauge !== "") acceptedRow.gauge = gauge
    const color = get(row, mapping.color)
    if (color !== "") acceptedRow.color = color
    if (parsedLength !== undefined) {
      acceptedRow.length = convertLength(parsedLength, rawLengthUnit, units)
    }
    accepted.push(acceptedRow)
    rowResults.push({ row: rowNumber, status: "accepted", wireId, diagnostics: [] })
  })

  const connectorList = [...connectors.values()].sort((a, b) => a.ref.localeCompare(b.ref))
  const connectorVars = new Map(connectorList.map((c, i) => [c.ref, `c${i + 1}`]))
  const lines: Array<string> = [
    `// Generated from ${sourceName}. Review all unverified parts before release.`,
    `import { connector, harness, wire, type ConnectorPart } from "@grayhaven/nerve"`,
    ""
  ]
  connectorList.forEach((c, index) => {
    const pins = [...c.pins.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    const pinCount = Math.max(c.pinCount ?? 0, numericPinCount(c.seenPins))
    const partVar = `part${index + 1}`
    lines.push(
      `const ${partVar}: ConnectorPart = {`,
      `  mpn: ${literal(c.mpn ?? `UNVERIFIED-${c.ref}`)},`,
      `  pinCount: ${pinCount},`,
      `  provenance: { source: ${literal(sourceName)}, verification: "unverified" },`,
      `}`,
      `const ${connectorVars.get(c.ref)} = connector(${literal(c.ref)}, ${partVar}, {`,
      `  pins: { ${pins.map(([pin, signal]) => `${literal(pin)}: ${literal(signal)}`).join(", ")} },`,
      ...(c.terminals.size > 0
        ? [`  terminals: { ${[...c.terminals].map(([pin, mpn]) => `${literal(pin)}: ${literal(mpn)}`).join(", ")} },`]
        : []),
      ...(c.seals.size > 0
        ? [`  seals: { ${[...c.seals].map(([pin, mpn]) => `${literal(pin)}: ${literal(mpn)}`).join(", ")} },`]
        : []),
      `})`,
      ""
    )
  })
  lines.push(
    `export default harness(${literal(harnessId)}, {`,
    `  revision: ${literal(options.revision ?? "A")},`,
    `  units: ${literal(units)},`,
    `  connectors: [${connectorList.map((c) => connectorVars.get(c.ref)).join(", ")}],`,
    `  wires: [`
  )
  for (const row of accepted) {
    const props = [
      row.signal !== undefined ? `signal: ${literal(row.signal)}` : undefined,
      row.gauge !== undefined ? `gauge: ${literal(row.gauge)}` : undefined,
      row.color !== undefined ? `color: ${literal(row.color)}` : undefined,
      row.length !== undefined ? `length: ${row.length}` : undefined
    ].filter((value): value is string => value !== undefined)
    lines.push(
      `    // source row ${row.row}`,
      `    wire(${literal(row.wireId)}, ${connectorVars.get(row.fromConnector)}.pin(${literal(row.fromPin)}), ${connectorVars.get(row.toConnector)}.pin(${literal(row.toPin)}), { ${props.join(", ")} }),`
    )
  }
  lines.push("  ],", "})", "")

  const instances = connectorList.map((c) => {
    const pins = Object.fromEntries(c.pins)
    const part: ConnectorPart = {
      mpn: c.mpn ?? `UNVERIFIED-${c.ref}`,
      pinCount: Math.max(c.pinCount ?? 0, numericPinCount(c.seenPins)),
      provenance: { source: sourceName, verification: "unverified" }
    }
    const props: ConnectorPropsDraft = { pins }
    if (c.terminals.size > 0) props.terminals = Object.fromEntries(c.terminals)
    if (c.seals.size > 0) props.seals = Object.fromEntries(c.seals)
    return connector(c.ref, part, props)
  })
  const instanceByRef = new Map(instances.map((instance) => [instance.ref, instance]))
  const design = harness(harnessId, {
    revision: options.revision ?? "A",
    units,
    connectors: instances,
    wires: accepted.map((row) => {
      const props: WirePropsDraft = {}
      if (row.signal !== undefined) props.signal = row.signal
      if (row.gauge !== undefined) props.gauge = row.gauge
      if (row.color !== undefined) props.color = row.color
      if (row.length !== undefined) props.length = row.length
      return wire(
        row.wireId,
        instanceByRef.get(row.fromConnector)!.pin(row.fromPin),
        instanceByRef.get(row.toConnector)!.pin(row.toPin),
        props
      )
    })
  })

  return {
    source: lines.join("\n"),
    design,
    diagnostics,
    report: {
      reportVersion: "0.1.0",
      source: sourceName,
      harnessId,
      rows: rowResults,
      accepted: rowResults.filter((row) => row.status === "accepted").length,
      rejected: rowResults.filter((row) => row.status === "rejected").length
    }
  }
}

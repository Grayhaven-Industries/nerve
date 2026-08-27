/** Tester result ingest with release provenance and structured evidence. */
import { DiagnosticSeverity, type Diagnostic } from "@grayhaven/nerve"
import type { Measurement } from "./build-record.js"
import { draft } from "./draft.js"
import type { Release } from "./release.js"
import type { ElectricalTestMethod } from "./test-spec.js"
import type { TestPlan } from "./test-plan.js"

export interface TesterIngestResult {
  readonly measurements: ReadonlyArray<Measurement>
  readonly diagnostics: ReadonlyArray<Diagnostic>
  /** False when the results do not belong to this release. */
  readonly fingerprintMatches: boolean
}

export interface TesterIngestOptions {
  readonly plan?: TestPlan
  /** Out-of-band fingerprint claim; an in-file header takes precedence. */
  readonly expectFingerprint?: string
  readonly rawResultReference?: string
  readonly rawResultHash?: string
  readonly testerId?: string
  readonly testerManufacturer?: string
  readonly testerModel?: string
  readonly testerSerial?: string
  readonly softwareName?: string
  readonly softwareVersion?: string
  readonly calibrationId?: string
  readonly calibrationDueAt?: string
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const metaLine = /^#\s*([\w-]+)\s*:\s*(.+)$/
const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "")

/** Parse one CSV row, including quoted commas and doubled quotes. */
const csvRow = (line: string): ReadonlyArray<string> => {
  const cells: Array<string> = []
  let cell = ""
  let quoted = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]!
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (char === "," && !quoted) {
      cells.push(cell.trim())
      cell = ""
    } else {
      cell += char
    }
  }
  cells.push(cell.trim())
  return cells
}

const aliases = {
  id: ["testid", "id", "stepid"],
  method: ["method", "testmethod"],
  measuredOhms: ["measuredohms", "ohms", "resistanceohms", "measuredresistanceohms"],
  appliedVoltageV: ["appliedvoltagev", "testvoltagev", "voltagev"],
  appliedWaveform: ["appliedwaveform", "testwaveform", "waveform"],
  leakageMilliAmps: ["leakagema", "leakagemilliamps", "measuredleakagema"],
  durationSeconds: ["durationseconds", "durationsec", "dwellseconds"],
  rawResultReference: ["rawresultreference", "rawresultref", "evidencereference"],
  rawResultHash: ["rawresulthash", "evidencehash"],
  testerId: ["testerid", "equipmentid"],
  testerManufacturer: ["testermanufacturer", "equipmentmanufacturer"],
  testerModel: ["testermodel", "equipmentmodel"],
  testerSerial: ["testerserial", "equipmentserial"],
  softwareName: ["softwarename", "testersoftware"],
  softwareVersion: ["softwareversion", "testersoftwareversion"],
  calibrationId: ["calibrationid", "calibrationcertificate", "calibrationreference"],
  calibrationDueAt: ["calibrationdueat", "calibrationdue", "calibrationexpiry"],
  timestamp: ["timestamp", "measuredat", "testedat"],
  interlockConfirmed: ["interlockconfirmed", "interlock"],
  dischargeConfirmed: ["dischargeconfirmed", "discharge"]
} as const

type AliasName = keyof typeof aliases

const allHeaderNames: ReadonlySet<string> = new Set(Object.values(aliases).flat())

const columnMap = (header: ReadonlyArray<string>): ReadonlyMap<string, number> =>
  new Map(header.map((cell, index) => [normalized(cell), index]))

const column = (
  row: ReadonlyArray<string>,
  columns: ReadonlyMap<string, number>,
  name: AliasName
): string | undefined => {
  for (const alias of aliases[name]) {
    const index = columns.get(alias)
    if (index !== undefined) return row[index]
  }
  return undefined
}

const method = (raw: string | undefined): ElectricalTestMethod | undefined => {
  if (raw === undefined || raw === "") return undefined
  switch (normalized(raw)) {
    case "continuity":
      return "continuity"
    case "fourwireresistance":
    case "4wireresistance":
    case "kelvin":
      return "four-wire-resistance"
    case "insulationresistance":
    case "ir":
      return "insulation-resistance"
    case "dielectricwithstand":
    case "hipot":
      return "dielectric-withstand"
    default:
      return undefined
  }
}

const confirmation = (raw: string | undefined): boolean | undefined => {
  if (raw === undefined || raw === "") return undefined
  switch (normalized(raw)) {
    case "true":
    case "yes":
    case "1":
    case "confirmed":
    case "pass":
      return true
    case "false":
    case "no":
    case "0":
    case "notconfirmed":
    case "fail":
      return false
    default:
      return undefined
  }
}

const waveform = (raw: string | undefined): "ac" | "dc" | undefined => {
  if (raw === undefined || raw === "") return undefined
  switch (normalized(raw)) {
    case "ac":
      return "ac"
    case "dc":
      return "dc"
    default:
      return undefined
  }
}

interface ParsedNumber {
  readonly value?: number
  readonly invalid: boolean
}

const numeric = (raw: string | undefined): ParsedNumber => {
  if (raw === undefined || raw === "") return { invalid: false }
  const value = Number(raw)
  return Number.isFinite(value) ? { value, invalid: false } : { invalid: true }
}

const metaOrOption = (
  meta: ReadonlyMap<string, string>,
  key: string,
  option: string | undefined
): string | undefined => meta.get(key) ?? option

const assignString = (
  measurement: ReturnType<typeof draft<Measurement>>,
  key: Exclude<
    keyof Measurement,
    | "id"
    | "method"
    | "measuredOhms"
    | "appliedVoltageV"
    | "appliedWaveform"
    | "leakageMilliAmps"
    | "durationSeconds"
    | "interlockConfirmed"
    | "dischargeConfirmed"
  >,
  value: string | undefined
): void => {
  if (value !== undefined && value !== "") measurement[key] = value
}

/**
 * Ingest legacy two-column CSV or a named-column evidence export. Rows may
 * override tester/calibration metadata supplied in options or `# key: value`
 * headers. Invalid rows are diagnosed and skipped rather than guessed at.
 */
export const ingestTesterResults = (
  source: string,
  release: Release,
  options: TesterIngestOptions = {}
): TesterIngestResult => {
  const meta = new Map<string, string>()
  const rows: Array<ReadonlyArray<string>> = []
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (line.startsWith("#")) {
      const match = metaLine.exec(line)
      if (match !== null) meta.set(match[1]!.toLowerCase(), match[2]!.trim())
      continue
    }
    rows.push(csvRow(line))
  }

  const first = rows[0]
  const hasNamedHeader = first?.some((cell) => allHeaderNames.has(normalized(cell))) ?? false
  // Preserve the old tolerance for arbitrary header wording in column two: a
  // legacy two-column file may label its columns anything, so a non-numeric
  // second cell in the first row marks a header row to drop. Those rows are
  // still read positionally — only a recognized named header switches the body
  // onto column-name lookups.
  const hasLegacyHeader = first !== undefined && !Number.isFinite(Number(first[1]))
  const header = hasNamedHeader || hasLegacyHeader ? first : undefined
  const body = header === undefined ? rows : rows.slice(1)
  const columns = columnMap(hasNamedHeader ? (first ?? []) : [])

  const diagnostics: Array<Diagnostic> = []
  const claimed = meta.get("hir-fingerprint") ?? options.expectFingerprint
  const fingerprintMatches = claimed !== undefined && claimed === release.hirFingerprint
  if (claimed === undefined) {
    diagnostics.push({
      code: "HK-TEST-001",
      severity: DiagnosticSeverity.Warning,
      message: `Results declare no HIR fingerprint, so they cannot be proven to come from release ${release.releaseId}.`,
      data: { release: release.releaseId, expected: release.hirFingerprint }
    })
  } else if (!fingerprintMatches) {
    diagnostics.push({
      code: "HK-TEST-002",
      severity: DiagnosticSeverity.Error,
      message: `Results claim HIR ${claimed}, but release ${release.releaseId} is ${release.hirFingerprint}. These results were taken against a different design.`,
      data: { release: release.releaseId, claimed, expected: release.hirFingerprint }
    })
  }

  const defaults = {
    rawResultReference: metaOrOption(meta, "raw-result-reference", options.rawResultReference),
    rawResultHash: metaOrOption(meta, "raw-result-hash", options.rawResultHash),
    testerId: metaOrOption(meta, "tester-id", options.testerId),
    testerManufacturer: metaOrOption(meta, "tester-manufacturer", options.testerManufacturer),
    testerModel: metaOrOption(meta, "tester-model", options.testerModel),
    testerSerial: metaOrOption(meta, "tester-serial", options.testerSerial),
    softwareName: metaOrOption(meta, "software-name", options.softwareName),
    softwareVersion: metaOrOption(meta, "software-version", options.softwareVersion),
    calibrationId: metaOrOption(meta, "calibration-id", options.calibrationId),
    calibrationDueAt: metaOrOption(meta, "calibration-due-at", options.calibrationDueAt)
  }

  const measurements: Array<Measurement> = []
  for (const [index, row] of body.entries()) {
    const read = (name: AliasName): string | undefined =>
      hasNamedHeader ? column(row, columns, name) : undefined
    const id = hasNamedHeader ? (read("id") ?? "") : (row[0] ?? "")
    const ohms = numeric(hasNamedHeader ? read("measuredOhms") : row[1])
    const voltage = numeric(read("appliedVoltageV"))
    const leakage = numeric(read("leakageMilliAmps"))
    const duration = numeric(read("durationSeconds"))
    if (id === "" || (ohms.value === undefined && leakage.value === undefined)) {
      diagnostics.push({
        code: "HK-TEST-003",
        severity: DiagnosticSeverity.Warning,
        message: `Result row ${index + 1} has no test id or finite electrical result and was skipped: ${row.join(",")}`,
        data: { row: index + 1 }
      })
      continue
    }
    if (ohms.invalid || voltage.invalid || leakage.invalid || duration.invalid) {
      diagnostics.push({
        code: "HK-TEST-006",
        severity: DiagnosticSeverity.Warning,
        message: `Result ${id} contains a non-finite optional numeric evidence field; that field was omitted.`,
        data: { test: id }
      })
    }

    const rawMethod = read("method")
    const parsedMethod = method(rawMethod)
    if (rawMethod !== undefined && rawMethod !== "" && parsedMethod === undefined) {
      diagnostics.push({
        code: "HK-TEST-007",
        severity: DiagnosticSeverity.Warning,
        message: `Result ${id} names unknown electrical method ${rawMethod}; the row was skipped.`,
        data: { test: id, method: rawMethod }
      })
      continue
    }
    const rawInterlock = read("interlockConfirmed")
    const rawDischarge = read("dischargeConfirmed")
    const rawWaveform = read("appliedWaveform")
    const appliedWaveform = waveform(rawWaveform)
    if (rawWaveform !== undefined && rawWaveform !== "" && appliedWaveform === undefined) {
      diagnostics.push({
        code: "HK-TEST-010",
        severity: DiagnosticSeverity.Warning,
        message: `Result ${id} names unknown applied waveform ${rawWaveform}; the row was skipped.`,
        data: { test: id, waveform: rawWaveform }
      })
      continue
    }
    const interlock = confirmation(rawInterlock)
    const discharge = confirmation(rawDischarge)
    if (
      (rawInterlock !== undefined && rawInterlock !== "" && interlock === undefined) ||
      (rawDischarge !== undefined && rawDischarge !== "" && discharge === undefined)
    ) {
      diagnostics.push({
        code: "HK-TEST-008",
        severity: DiagnosticSeverity.Warning,
        message: `Result ${id} contains an unrecognized safety confirmation; it was omitted.`,
        data: { test: id }
      })
    }

    const measurement = draft<Measurement>({ id })
    if (parsedMethod !== undefined) measurement.method = parsedMethod
    if (ohms.value !== undefined) measurement.measuredOhms = ohms.value
    if (voltage.value !== undefined) measurement.appliedVoltageV = voltage.value
    if (appliedWaveform !== undefined) measurement.appliedWaveform = appliedWaveform
    if (leakage.value !== undefined) measurement.leakageMilliAmps = leakage.value
    if (duration.value !== undefined) measurement.durationSeconds = duration.value
    assignString(
      measurement,
      "rawResultReference",
      read("rawResultReference") || defaults.rawResultReference
    )
    assignString(measurement, "rawResultHash", read("rawResultHash") || defaults.rawResultHash)
    assignString(measurement, "testerId", read("testerId") || defaults.testerId)
    assignString(
      measurement,
      "testerManufacturer",
      read("testerManufacturer") || defaults.testerManufacturer
    )
    assignString(measurement, "testerModel", read("testerModel") || defaults.testerModel)
    assignString(measurement, "testerSerial", read("testerSerial") || defaults.testerSerial)
    assignString(measurement, "softwareName", read("softwareName") || defaults.softwareName)
    assignString(
      measurement,
      "softwareVersion",
      read("softwareVersion") || defaults.softwareVersion
    )
    assignString(measurement, "calibrationId", read("calibrationId") || defaults.calibrationId)
    assignString(
      measurement,
      "calibrationDueAt",
      read("calibrationDueAt") || defaults.calibrationDueAt
    )
    assignString(measurement, "timestamp", read("timestamp"))
    if (interlock !== undefined) measurement.interlockConfirmed = interlock
    if (discharge !== undefined) measurement.dischargeConfirmed = discharge
    measurements.push(measurement)
  }
  measurements.sort((a, b) => cmp(a.id, b.id) || cmp(a.timestamp ?? "", b.timestamp ?? ""))
  const seenMeasurementIds = new Set<string>()
  const diagnosedDuplicateIds = new Set<string>()
  for (const measurement of measurements) {
    if (seenMeasurementIds.has(measurement.id) && !diagnosedDuplicateIds.has(measurement.id)) {
      diagnostics.push({
        code: "HK-TEST-009",
        severity: DiagnosticSeverity.Warning,
        message: `Result ${measurement.id} appears more than once; a build record will retain the evidence but leave the test unassessed.`,
        data: { test: measurement.id }
      })
      diagnosedDuplicateIds.add(measurement.id)
    }
    seenMeasurementIds.add(measurement.id)
  }

  const plan = options.plan
  if (plan !== undefined) {
    const planned = new Set(plan.tests.map((test) => test.id))
    const measured = new Set(measurements.map((measurement) => measurement.id))
    for (const measurement of measurements) {
      if (planned.has(measurement.id)) continue
      diagnostics.push({
        code: "HK-TEST-004",
        severity: DiagnosticSeverity.Warning,
        message: `Result ${measurement.id} is not a test in release ${release.releaseId}'s plan; it will not be judged.`,
        data: { test: measurement.id, release: release.releaseId }
      })
    }
    const missing = plan.tests.filter((test) => !measured.has(test.id)).length
    if (missing > 0) {
      diagnostics.push({
        code: "HK-TEST-005",
        severity: DiagnosticSeverity.Info,
        message: `${missing} of ${plan.tests.length} planned tests have no result in this file.`,
        data: { missing, planned: plan.tests.length }
      })
    }
  }

  return { measurements, diagnostics, fingerprintMatches }
}

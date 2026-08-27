/**
 * Nerve Build Record — as-built traceability (PRD §36).
 *
 * Electrical verdicts are replayed only against an approved, valid
 * TestSpecification. A generated plan contains topology, never acceptance
 * limits, so measurements without that authority remain evidence but are
 * explicitly unassessed.
 */
import type { Hir } from "@grayhaven/nerve"
import { draft } from "./draft.js"
import { hirFingerprint, type Release } from "./release.js"
import {
  evaluateElectricalMeasurement,
  snapshotTestSpecification,
  testSpecificationMatchesPlan,
  validateTestSpecification,
  type ElectricalTestMethod,
  type TestSpecification
} from "./test-spec.js"
import { generateTestPlan, type HarnessTest, type TestPoint } from "./test-plan.js"

export interface Measurement {
  readonly id: string
  /** Omitted only for the retained legacy `{ id, measuredOhms }` evidence shape. */
  readonly method?: ElectricalTestMethod
  readonly measuredOhms?: number
  readonly appliedVoltageV?: number
  readonly appliedWaveform?: "ac" | "dc"
  readonly leakageMilliAmps?: number
  readonly durationSeconds?: number
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
  readonly timestamp?: string
  readonly interlockConfirmed?: boolean
  readonly dischargeConfirmed?: boolean
}

export type TestVerdict = "pass" | "fail" | "not-run" | "unassessed"

export interface ElectricalTestResult extends Measurement {
  readonly type: HarnessTest["type"]
  readonly expected: "closed" | "open"
  readonly verdict: TestVerdict
}

export interface LengthObservation {
  /** Wire id, matching HIR `wires[].id`. */
  readonly wire: string
  /** Measured end-to-end length in harness units. */
  readonly measuredLength: number
}

export interface LengthVerdict {
  readonly wire: string
  readonly designLength?: number
  readonly tolerance?: number
  readonly measuredLength: number
  /** measured - design, present only when a design length exists. */
  readonly delta?: number
  readonly verdict: "in-tolerance" | "out-of-tolerance" | "no-design-length"
}

export type CrimpEvidenceVerdict = "pass" | "fail" | "unassessed"

/**
 * Canonical crimp/process evidence. The record stores observed values and the
 * caller's process verdict; it does not invent terminal limits or claim a
 * particular industry or equipment-vendor compliance regime.
 */
export interface CrimpProcessEvidence {
  readonly id: string
  readonly wire: string
  readonly endpoint: TestPoint
  readonly terminal: string
  readonly tool?: string
  readonly die?: string
  readonly press?: string
  readonly setupRevision?: string
  readonly materialLot?: string
  readonly toolLot?: string
  readonly targetCrimpHeightMm?: number
  readonly actualCrimpHeightMm?: number
  readonly targetCrimpWidthMm?: number
  readonly actualCrimpWidthMm?: number
  readonly targetPullForceN?: number
  readonly actualPullForceN?: number
  readonly forceCurveReference?: string
  readonly rawEvidenceReference?: string
  readonly rawEvidenceHash?: string
  readonly samplingPlanReference?: string
  readonly controlPlanReference?: string
  readonly reactionPlanReference?: string
  readonly timestamp: string
  readonly operator: string
  readonly verdict: CrimpEvidenceVerdict
  readonly ncrReference?: string
  readonly concessionReference?: string
  readonly reworkReference?: string
  readonly retestReference?: string
}

export interface BuildRecord {
  readonly recordVersion: "0.2.0"
  readonly release: string
  readonly hirFingerprint: string
  readonly serial: string
  readonly lot?: string
  readonly operator: string
  readonly workstation?: string
  readonly buildDate: string
  /** Legacy free-text maps remain readable; structured evidence below is canonical. */
  readonly materialLots?: Readonly<Record<string, string>>
  readonly tools?: Readonly<Record<string, string>>
  readonly testProgramVersion: string
  readonly testSpecification?: TestSpecification
  readonly results: ReadonlyArray<ElectricalTestResult>
  readonly summary: {
    readonly pass: number
    readonly fail: number
    readonly notRun: number
    readonly unassessed: number
    readonly status: "pass" | "fail" | "incomplete"
  }
  /** As-built length evidence. Omitted entirely when nothing was measured. */
  readonly lengths?: ReadonlyArray<LengthVerdict>
  readonly lengthSummary?: {
    readonly inTolerance: number
    readonly outOfTolerance: number
    readonly noDesignLength: number
  }
  readonly crimpEvidence?: ReadonlyArray<CrimpProcessEvidence>
  /** Legacy free-text dispositions retained for compatibility. */
  readonly rework?: ReadonlyArray<string>
  readonly deviations?: ReadonlyArray<string>
}

export interface BuildRecordOptions {
  readonly serial: string
  readonly operator: string
  readonly buildDate: string
  readonly lot?: string
  readonly workstation?: string
  readonly materialLots?: Readonly<Record<string, string>>
  readonly tools?: Readonly<Record<string, string>>
  readonly testSpecification?: TestSpecification
  /** As-built wire lengths measured on the bench. */
  readonly lengths?: ReadonlyArray<LengthObservation>
  /**
   * Tolerance applied to wires that declare no `lengthTolerance` of their
   * own. Without it, an exact match is the only thing in tolerance.
   */
  readonly defaultLengthTolerance?: number
  readonly crimpEvidence?: ReadonlyArray<CrimpProcessEvidence>
  readonly rework?: ReadonlyArray<string>
  readonly deviations?: ReadonlyArray<string>
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const sortedRecord = (
  record: Readonly<Record<string, string>>
) => {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(record).sort(cmp)) sorted[key] = record[key]!
  return sorted
}

const canonicalMeasurement = (measurement: Measurement): Measurement => {
  const result = draft<Measurement>({ id: measurement.id })
  if (measurement.method !== undefined) result.method = measurement.method
  if (measurement.measuredOhms !== undefined) result.measuredOhms = measurement.measuredOhms
  if (measurement.appliedVoltageV !== undefined) result.appliedVoltageV = measurement.appliedVoltageV
  if (measurement.appliedWaveform !== undefined) {
    result.appliedWaveform = measurement.appliedWaveform
  }
  if (measurement.leakageMilliAmps !== undefined) {
    result.leakageMilliAmps = measurement.leakageMilliAmps
  }
  if (measurement.durationSeconds !== undefined) result.durationSeconds = measurement.durationSeconds
  if (measurement.rawResultReference !== undefined) {
    result.rawResultReference = measurement.rawResultReference
  }
  if (measurement.rawResultHash !== undefined) result.rawResultHash = measurement.rawResultHash
  if (measurement.testerId !== undefined) result.testerId = measurement.testerId
  if (measurement.testerManufacturer !== undefined) {
    result.testerManufacturer = measurement.testerManufacturer
  }
  if (measurement.testerModel !== undefined) result.testerModel = measurement.testerModel
  if (measurement.testerSerial !== undefined) result.testerSerial = measurement.testerSerial
  if (measurement.softwareName !== undefined) result.softwareName = measurement.softwareName
  if (measurement.softwareVersion !== undefined) {
    result.softwareVersion = measurement.softwareVersion
  }
  if (measurement.calibrationId !== undefined) result.calibrationId = measurement.calibrationId
  if (measurement.calibrationDueAt !== undefined) {
    result.calibrationDueAt = measurement.calibrationDueAt
  }
  if (measurement.timestamp !== undefined) result.timestamp = measurement.timestamp
  if (measurement.interlockConfirmed !== undefined) {
    result.interlockConfirmed = measurement.interlockConfirmed
  }
  if (measurement.dischargeConfirmed !== undefined) {
    result.dischargeConfirmed = measurement.dischargeConfirmed
  }
  return result
}

const canonicalCrimpEvidence = (evidence: CrimpProcessEvidence): CrimpProcessEvidence => {
  const result = draft<CrimpProcessEvidence>({
    id: evidence.id,
    wire: evidence.wire,
    endpoint: { connector: evidence.endpoint.connector, pin: evidence.endpoint.pin },
    terminal: evidence.terminal,
    timestamp: evidence.timestamp,
    operator: evidence.operator,
    verdict: evidence.verdict
  })
  if (evidence.tool !== undefined) result.tool = evidence.tool
  if (evidence.die !== undefined) result.die = evidence.die
  if (evidence.press !== undefined) result.press = evidence.press
  if (evidence.setupRevision !== undefined) result.setupRevision = evidence.setupRevision
  if (evidence.materialLot !== undefined) result.materialLot = evidence.materialLot
  if (evidence.toolLot !== undefined) result.toolLot = evidence.toolLot
  if (evidence.targetCrimpHeightMm !== undefined) {
    result.targetCrimpHeightMm = evidence.targetCrimpHeightMm
  }
  if (evidence.actualCrimpHeightMm !== undefined) {
    result.actualCrimpHeightMm = evidence.actualCrimpHeightMm
  }
  if (evidence.targetCrimpWidthMm !== undefined) {
    result.targetCrimpWidthMm = evidence.targetCrimpWidthMm
  }
  if (evidence.actualCrimpWidthMm !== undefined) {
    result.actualCrimpWidthMm = evidence.actualCrimpWidthMm
  }
  if (evidence.targetPullForceN !== undefined) result.targetPullForceN = evidence.targetPullForceN
  if (evidence.actualPullForceN !== undefined) result.actualPullForceN = evidence.actualPullForceN
  if (evidence.forceCurveReference !== undefined) {
    result.forceCurveReference = evidence.forceCurveReference
  }
  if (evidence.rawEvidenceReference !== undefined) {
    result.rawEvidenceReference = evidence.rawEvidenceReference
  }
  if (evidence.rawEvidenceHash !== undefined) result.rawEvidenceHash = evidence.rawEvidenceHash
  if (evidence.samplingPlanReference !== undefined) {
    result.samplingPlanReference = evidence.samplingPlanReference
  }
  if (evidence.controlPlanReference !== undefined) {
    result.controlPlanReference = evidence.controlPlanReference
  }
  if (evidence.reactionPlanReference !== undefined) {
    result.reactionPlanReference = evidence.reactionPlanReference
  }
  if (evidence.ncrReference !== undefined) result.ncrReference = evidence.ncrReference
  if (evidence.concessionReference !== undefined) {
    result.concessionReference = evidence.concessionReference
  }
  if (evidence.reworkReference !== undefined) result.reworkReference = evidence.reworkReference
  if (evidence.retestReference !== undefined) result.retestReference = evidence.retestReference
  return result
}

/** Judge measured lengths against the design without modifying design intent. */
const judgeLengths = (
  hir: Hir,
  observations: ReadonlyArray<LengthObservation>,
  defaultLengthTolerance: number | undefined
): ReadonlyArray<LengthVerdict> => {
  const wires = new Map(hir.wires.map((wire) => [wire.id, wire]))
  return [...observations]
    .sort((a, b) => cmp(a.wire, b.wire))
    .map((observation): LengthVerdict => {
      const wire = wires.get(observation.wire)
      const designLength = wire?.length
      if (designLength === undefined) {
        return {
          wire: observation.wire,
          measuredLength: observation.measuredLength,
          verdict: "no-design-length"
        }
      }
      const tolerance = wire?.lengthTolerance ?? defaultLengthTolerance
      const delta = observation.measuredLength - designLength
      const result = draft<LengthVerdict>({
        wire: observation.wire,
        designLength,
        measuredLength: observation.measuredLength,
        delta,
        verdict: Math.abs(delta) <= (tolerance ?? 0) ? "in-tolerance" : "out-of-tolerance"
      })
      if (tolerance !== undefined) result.tolerance = tolerance
      return result
    })
}

const resultWithMeasurement = (
  test: HarnessTest,
  measurement: Measurement,
  verdict: Exclude<TestVerdict, "not-run">
): ElectricalTestResult => {
  const { id, ...evidence } = canonicalMeasurement(measurement)
  return { id, type: test.type, expected: test.expected, ...evidence, verdict }
}

export const createBuildRecord = (
  hir: Hir,
  release: Release,
  measurements: ReadonlyArray<Measurement>,
  options: BuildRecordOptions
): BuildRecord => {
  const plan = generateTestPlan(hir)
  const requestedSpecification = options.testSpecification
  const specificationIsValid =
    requestedSpecification !== undefined &&
    validateTestSpecification(requestedSpecification).length === 0
  const specification =
    requestedSpecification !== undefined && specificationIsValid
      ? snapshotTestSpecification(requestedSpecification)
      : undefined
  const releaseMatchesHir =
    release.hirFingerprint === hirFingerprint(hir) &&
    release.hirSchema === hir.schemaVersion &&
    release.harness.id === hir.harness.id &&
    release.harness.revision === hir.harness.revision &&
    release.counts.tests === plan.tests.length
  const approvedSpecification =
    specification !== undefined &&
    releaseMatchesHir &&
    specification.status === "approved" &&
    testSpecificationMatchesPlan(specification, plan) &&
    release.harness.id === specification.harness.id &&
    release.harness.revision === specification.harness.revision
      ? specification
      : undefined
  const specificationSteps = new Map(
    (approvedSpecification?.steps ?? []).map((step) => [step.id, step])
  )
  const measurementGroups = new Map<string, Array<Measurement>>()
  for (const measurement of measurements) {
    const group = measurementGroups.get(measurement.id) ?? []
    group.push(canonicalMeasurement(measurement))
    measurementGroups.set(measurement.id, group)
  }
  const measured = new Map<string, Measurement>()
  const duplicateMeasurementIds = new Set<string>()
  for (const [id, group] of measurementGroups) {
    group.sort((a, b) => cmp(JSON.stringify(a), JSON.stringify(b)))
    measured.set(id, group[0]!)
    if (group.length > 1) duplicateMeasurementIds.add(id)
  }

  const results: Array<ElectricalTestResult> = plan.tests.map((test) => {
    const measurement = measured.get(test.id)
    if (measurement === undefined) {
      return { id: test.id, type: test.type, expected: test.expected, verdict: "not-run" }
    }
    const step = specificationSteps.get(test.id)
    return resultWithMeasurement(
      test,
      measurement,
      step === undefined || duplicateMeasurementIds.has(test.id)
        ? "unassessed"
        : evaluateElectricalMeasurement(step, measurement)
    )
  })
  const pass = results.filter((result) => result.verdict === "pass").length
  const fail = results.filter((result) => result.verdict === "fail").length
  const notRun = results.filter((result) => result.verdict === "not-run").length
  const unassessed = results.filter((result) => result.verdict === "unassessed").length

  const lengths =
    options.lengths === undefined
      ? undefined
      : judgeLengths(hir, options.lengths, options.defaultLengthTolerance)
  const crimps =
    options.crimpEvidence === undefined
      ? undefined
      : options.crimpEvidence
          .map(canonicalCrimpEvidence)
          .sort(
            (a, b) =>
              cmp(a.id, b.id) ||
              cmp(a.wire, b.wire) ||
              cmp(a.endpoint.connector, b.endpoint.connector) ||
              cmp(a.endpoint.pin, b.endpoint.pin)
          )

  const identity = draft<
    Pick<BuildRecord, "recordVersion" | "release" | "hirFingerprint" | "serial" | "lot">
  >({
    recordVersion: "0.2.0",
    release: release.releaseId,
    hirFingerprint: release.hirFingerprint,
    serial: options.serial
  })
  if (options.lot !== undefined) identity.lot = options.lot
  const station = draft<Pick<BuildRecord, "operator" | "workstation">>({
    operator: options.operator
  })
  if (options.workstation !== undefined) station.workstation = options.workstation
  const materials = draft<Pick<BuildRecord, "buildDate" | "materialLots" | "tools">>({
    buildDate: options.buildDate
  })
  if (options.materialLots !== undefined) materials.materialLots = sortedRecord(options.materialLots)
  if (options.tools !== undefined) materials.tools = sortedRecord(options.tools)
  const testing = draft<Pick<BuildRecord, "testProgramVersion" | "testSpecification">>({
    testProgramVersion: `${release.releaseId}#${plan.tests.length}`
  })
  if (specification !== undefined) testing.testSpecification = specification
  const record = draft<BuildRecord>({
    ...identity,
    ...station,
    ...materials,
    ...testing,
    results,
    summary: {
      pass,
      fail,
      notRun,
      unassessed,
      status: fail > 0 ? "fail" : notRun > 0 || unassessed > 0 ? "incomplete" : "pass"
    }
  })
  if (lengths !== undefined) {
    record.lengths = lengths
    record.lengthSummary = {
      inTolerance: lengths.filter((length) => length.verdict === "in-tolerance").length,
      outOfTolerance: lengths.filter((length) => length.verdict === "out-of-tolerance").length,
      noDesignLength: lengths.filter((length) => length.verdict === "no-design-length").length
    }
  }
  if (crimps !== undefined) record.crimpEvidence = crimps
  if (options.rework !== undefined) record.rework = [...options.rework]
  if (options.deviations !== undefined) record.deviations = [...options.deviations]
  return record
}

export const buildRecordJson = (record: BuildRecord): string =>
  JSON.stringify(record, null, 2) + "\n"

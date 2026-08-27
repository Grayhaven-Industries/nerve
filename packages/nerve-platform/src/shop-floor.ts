/* oxlint-disable anti-slop/no-object-parameters, anti-slop/no-reflect-get -- The replay boundary must inspect serialized evidence before narrowing it into the named StepEvidence domain union. */
/**
 * Deterministic shop-floor execution and serialized unit build records.
 *
 * This module is deliberately a reducer, not a service. The caller supplies
 * every identity and timestamp, the event log is the authority, and replaying
 * that log is the only way state is produced. A disconnected station can
 * therefore make progress without a clock, database, or network connection
 * and later submit the same bytes that an online station would have produced.
 */
import { canonicalize, type Canonical } from "./fingerprint.js"

export type ShopStepKind =
  | "material-pick"
  | "cut-strip"
  | "crimp"
  | "route"
  | "label"
  | "inspect"
  | "electrical-test"
  | "custom"

export type EvidenceKind =
  | "operator"
  | "material-lot"
  | "tool-calibration"
  | "measurement"
  | "attachment"
  | "electrical-test"

/** One immutable instruction in the released manufacturing route. */
export interface ShopStep {
  readonly id: string
  readonly stationId: string
  readonly kind: ShopStepKind
  readonly instruction: string
  readonly revision: string
  readonly prerequisiteStepIds: ReadonlyArray<string>
  readonly requiredEvidenceKinds: ReadonlyArray<EvidenceKind>
  /** A failed step with this flag clear may be bypassed, but cannot close. */
  readonly failureBlocksDownstream: boolean
}

/** Stations and steps are ordered; their array order is part of the route. */
export interface StationPlan {
  readonly id: string
  readonly name?: string | undefined
  readonly steps: ReadonlyArray<ShopStep>
}

/** Values copied into a work-order configuration or option bag. */
export type WorkOrderValue = Canonical

export interface WorkOrderInput {
  /** Stable ERP/MES or content-addressed identity supplied by the caller. */
  readonly id: string
  readonly harnessId: string
  readonly releaseId: string
  /** The exact released HIR that a station must retrieve or scan. */
  readonly hirFingerprint: string
  readonly quantity: number
  readonly configuration?: WorkOrderValue | undefined
  readonly options?: Readonly<Record<string, WorkOrderValue>> | undefined
  readonly stations: ReadonlyArray<StationPlan>
}

/**
 * Immutable manufacturing intent. Current status is intentionally absent;
 * progress is derived from serialized unit builds instead.
 */
export interface WorkOrder {
  readonly id: string
  readonly harnessId: string
  readonly releaseId: string
  readonly hirFingerprint: string
  readonly quantity: number
  readonly configuration?: WorkOrderValue | undefined
  readonly options?: Readonly<Record<string, WorkOrderValue>> | undefined
  readonly stations: ReadonlyArray<StationPlan>
}

interface EvidenceBase {
  readonly id: string
  readonly timestamp: string
}

export interface OperatorEvidence extends EvidenceBase {
  readonly kind: "operator"
  readonly operatorId: string
}

export interface MaterialLotEvidence extends EvidenceBase {
  readonly kind: "material-lot"
  readonly materialId: string
  readonly lotId: string
  readonly supplierLotId?: string | undefined
}

export interface ToolCalibrationEvidence extends EvidenceBase {
  readonly kind: "tool-calibration"
  readonly toolId: string
  readonly calibrationId: string
  readonly calibrationStatus?: "current" | "expired" | "unassessed" | undefined
  readonly calibrationExpiresAt?: string | undefined
}

export interface MeasurementEvidence extends EvidenceBase {
  readonly kind: "measurement"
  readonly value: number
  readonly units: string
  readonly requirementRef: string
}

export interface AttachmentEvidence extends EvidenceBase {
  readonly kind: "attachment"
  readonly attachmentId: string
  readonly contentHash: string
  readonly mediaType?: string | undefined
}

export interface ElectricalTestEvidence extends EvidenceBase {
  readonly kind: "electrical-test"
  readonly specificationRef: string
  readonly resultRef: string
  readonly rawResultRef: string
  readonly verdict: "pass" | "fail" | "unassessed"
  readonly testerId?: string | undefined
  readonly testProgramVersion?: string | undefined
}

/** Evidence is never summarized in place of the caller's original record. */
export type StepEvidence =
  | OperatorEvidence
  | MaterialLotEvidence
  | ToolCalibrationEvidence
  | MeasurementEvidence
  | AttachmentEvidence
  | ElectricalTestEvidence

interface EventBase {
  readonly id: string
  readonly timestamp: string
  readonly actor: string
  readonly workOrderId: string
  readonly serial: string
}

export type ShopFloorEvent =
  | (EventBase & {
      readonly type: "unit-started"
      readonly hirFingerprint: string
      /** If present, it is checked as well as the mandatory fingerprint. */
      readonly releaseId?: string | undefined
    })
  | (EventBase & {
      readonly type: "step-evidence-recorded"
      readonly stepId: string
      readonly evidence: StepEvidence
    })
  | (EventBase & {
      readonly type: "step-completed"
      readonly stepId: string
      /** Omitted means pass, keeping a normal completion event compact. */
      readonly outcome?: "pass" | "fail" | undefined
    })
  | (EventBase & {
      readonly type: "deviation-opened"
      readonly deviationId: string
      readonly stepId: string
      readonly reason: string
      readonly reference?: string | undefined
    })
  | (EventBase & {
      readonly type: "deviation-dispositioned"
      readonly deviationId: string
      readonly disposition: "accepted" | "rework-required" | "rejected" | "scrap"
      readonly rationale: string
      readonly dispositionRef?: string | undefined
    })
  | (EventBase & {
      readonly type: "rework-recorded"
      readonly reworkId: string
      readonly stepId: string
      readonly deviationId?: string | undefined
      readonly description: string
      readonly attachmentRefs?: ReadonlyArray<string> | undefined
    })
  | (EventBase & {
      readonly type: "step-reopened"
      readonly stepId: string
      readonly reason: string
      readonly reworkId?: string | undefined
      readonly deviationId?: string | undefined
    })
  | (EventBase & {
      readonly type: "unit-closed"
      readonly finalApprovalRef?: string | undefined
      readonly packoutRef?: string | undefined
      readonly shipmentRef?: string | undefined
    })

export interface UnitStepState {
  readonly id: string
  readonly stationId: string
  readonly kind: ShopStepKind
  readonly instruction: string
  readonly revision: string
  readonly prerequisiteStepIds: ReadonlyArray<string>
  readonly requiredEvidenceKinds: ReadonlyArray<EvidenceKind>
  readonly failureBlocksDownstream: boolean
  readonly status: "pending" | "in-progress" | "passed" | "failed"
  /** Starts at one and increments only through a step-reopened event. */
  readonly attempt: number
  /** All attempts, in event order; failed observations are never discarded. */
  readonly evidence: ReadonlyArray<StepEvidence>
  readonly completionEventIds: ReadonlyArray<string>
  readonly reopenEventIds: ReadonlyArray<string>
}

export interface UnitStationState {
  readonly id: string
  readonly name?: string | undefined
  readonly status: "pending" | "in-progress" | "passed" | "failed"
  readonly stepIds: ReadonlyArray<string>
}

export interface UnitDeviationState {
  readonly id: string
  readonly stepId: string
  readonly reason: string
  readonly openedEventId: string
  readonly status: "open" | "accepted" | "rework-required" | "rejected" | "scrap"
  readonly reference?: string | undefined
  readonly dispositionEventId?: string | undefined
  readonly rationale?: string | undefined
  readonly dispositionRef?: string | undefined
}

export interface UnitReworkState {
  readonly id: string
  readonly stepId: string
  readonly description: string
  readonly recordedEventId: string
  readonly status: "awaiting-reopen" | "awaiting-verification" | "resolved"
  readonly deviationId?: string | undefined
  readonly attachmentRefs?: ReadonlyArray<string> | undefined
  readonly reopenedEventId?: string | undefined
  readonly resolvedEventId?: string | undefined
}

/** A complete projection of one event log, suitable for immutable storage. */
export interface UnitBuildState {
  readonly recordVersion: "1.0.0"
  readonly workOrderId: string
  readonly harnessId: string
  readonly releaseId: string
  readonly hirFingerprint: string
  readonly serial: string
  readonly status: "in-progress" | "closed"
  readonly startedAt: string
  readonly startedBy: string
  readonly closedAt?: string | undefined
  readonly closedBy?: string | undefined
  readonly cycleDurationMs?: number | undefined
  readonly stations: ReadonlyArray<UnitStationState>
  readonly steps: ReadonlyArray<UnitStepState>
  readonly deviations: ReadonlyArray<UnitDeviationState>
  readonly rework: ReadonlyArray<UnitReworkState>
  readonly operatorIds: ReadonlyArray<string>
  readonly materialLots: ReadonlyArray<MaterialLotEvidence>
  readonly tools: ReadonlyArray<ToolCalibrationEvidence>
  readonly specificationRefs: ReadonlyArray<string>
  readonly resultRefs: ReadonlyArray<string>
  readonly events: ReadonlyArray<ShopFloorEvent>
}

export const ShopFloorCodes = {
  InvalidWorkOrder: "PL-SHOP-001",
  FingerprintMismatch: "PL-SHOP-002",
  ReleaseMismatch: "PL-SHOP-003",
  DuplicateEvent: "PL-SHOP-004",
  WrongWorkOrder: "PL-SHOP-005",
  WrongSerial: "PL-SHOP-006",
  InvalidTimestamp: "PL-SHOP-007",
  TimestampOutOfOrder: "PL-SHOP-008",
  UnitNotStarted: "PL-SHOP-009",
  AlreadyStarted: "PL-SHOP-010",
  AlreadyClosed: "PL-SHOP-011",
  UnknownStep: "PL-SHOP-012",
  PrerequisiteIncomplete: "PL-SHOP-013",
  DuplicateEvidence: "PL-SHOP-014",
  StepAlreadyCompleted: "PL-SHOP-015",
  StepNotCompleted: "PL-SHOP-016",
  MissingEvidence: "PL-SHOP-017",
  ElectricalTestNotPassed: "PL-SHOP-018",
  DuplicateDeviation: "PL-SHOP-019",
  UnknownDeviation: "PL-SHOP-020",
  DeviationAlreadyDispositioned: "PL-SHOP-021",
  DuplicateRework: "PL-SHOP-022",
  InvalidRework: "PL-SHOP-023",
  IncompleteSteps: "PL-SHOP-024",
  OpenDeviation: "PL-SHOP-025",
  UnresolvedRework: "PL-SHOP-026",
  QuantityExceeded: "PL-SHOP-027",
  SerialAlreadyStarted: "PL-SHOP-028",
  ProgressMismatch: "PL-SHOP-029",
  InvalidEvent: "PL-SHOP-030",
  InvalidEvidence: "PL-SHOP-031",
  RejectedDeviation: "PL-SHOP-032",
  CompletedDependent: "PL-SHOP-033",
  StartContextRequired: "PL-SHOP-034",
  DivergentHistory: "PL-SHOP-035"
} as const

export type ShopFloorCode = (typeof ShopFloorCodes)[keyof typeof ShopFloorCodes]

export interface ShopFloorProblem {
  readonly code: ShopFloorCode
  readonly message: string
  readonly eventId?: string | undefined
  readonly stepId?: string | undefined
  readonly evidenceKind?: EvidenceKind | undefined
  readonly relatedId?: string | undefined
}

export type ShopFloorResult =
  | {
      readonly ok: true
      readonly state: UnitBuildState
      readonly problems: readonly []
    }
  | {
      readonly ok: false
      readonly problems: ReadonlyArray<ShopFloorProblem>
    }

export interface WorkOrderProgress {
  readonly workOrderId: string
  readonly quantity: number
  readonly started: number
  readonly inProgress: number
  readonly completed: number
  /** Planned units that have not started yet. */
  readonly remaining: number
  /** Planned units that have not closed yet. */
  readonly remainingToComplete: number
  readonly overrun: number
  readonly serials: ReadonlyArray<string>
}

/** Input for the one event that may create a unit build. */
export interface StartUnitBuildInput {
  readonly type?: "unit-started" | undefined
  readonly id: string
  readonly timestamp: string
  readonly actor: string
  readonly workOrderId?: string | undefined
  readonly serial: string
  readonly hirFingerprint: string
  readonly releaseId?: string | undefined
  /**
   * Authoritative pre-reservation snapshots. At least one of `builds` or
   * `progress` is required at runtime. This pure reducer validates a snapshot;
   * the caller must reserve the serial and quantity slot atomically with
   * persisting the returned unit-started event.
   */
  readonly builds?: ReadonlyArray<UnitBuildState> | undefined
  readonly progress?: WorkOrderProgress | undefined
}

type MutableStep = {
  readonly definition: ShopStep
  status: UnitStepState["status"]
  attempt: number
  readonly evidence: Array<StepEvidence>
  readonly currentEvidence: Array<StepEvidence>
  readonly completionEventIds: Array<string>
  readonly reopenEventIds: Array<string>
}

type MutableDeviation = {
  readonly id: string
  readonly stepId: string
  readonly reason: string
  readonly openedEventId: string
  status: UnitDeviationState["status"]
  reference?: string
  dispositionEventId?: string
  rationale?: string
  dispositionRef?: string
}

type MutableRework = {
  readonly id: string
  readonly stepId: string
  readonly description: string
  readonly recordedEventId: string
  status: UnitReworkState["status"]
  deviationId?: string
  attachmentRefs?: ReadonlyArray<string>
  reopenedEventId?: string
  reopenedAttempt?: number
  resolvedEventId?: string
}

interface UnitDeviationDraft {
  readonly id: string
  readonly stepId: string
  readonly reason: string
  readonly openedEventId: string
  readonly status: UnitDeviationState["status"]
  reference?: string
  dispositionEventId?: string
  rationale?: string
  dispositionRef?: string
}

interface UnitReworkDraft {
  readonly id: string
  readonly stepId: string
  readonly description: string
  readonly recordedEventId: string
  readonly status: UnitReworkState["status"]
  deviationId?: string
  attachmentRefs?: ReadonlyArray<string>
  reopenedEventId?: string
  resolvedEventId?: string
}

interface UnitStartedEventDraft extends EventBase {
  readonly type: "unit-started"
  readonly hirFingerprint: string
  releaseId?: string
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const copy = <T>(value: T): T => structuredClone(value)

const absent = (value: string): boolean => value.trim() === ""

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Replay is the parser boundary for serialized shop-floor events and must narrow untrusted fields before domain use.
const runtimeString = (value: unknown): value is string => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Establish the serialized field contract before domain use.
  return typeof value === "string"
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Serialized event strings are checked before domain use.
const runtimeNonBlankString = (value: unknown): value is string =>
  runtimeString(value) && value.trim() !== ""

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Serialized numeric evidence is checked before domain use.
const runtimeNumber = (value: unknown): value is number => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Establish the serialized field contract before domain use.
  return typeof value === "number"
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Serialized boolean evidence is checked before domain use.
const runtimeBoolean = (value: unknown): value is boolean => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Establish the serialized field contract before domain use.
  return typeof value === "boolean"
}

const eventProblem = (
  code: ShopFloorCode,
  message: string,
  event: ShopFloorEvent,
  context: Omit<ShopFloorProblem, "code" | "message" | "eventId"> = {}
): ShopFloorProblem => ({ code, message, eventId: event.id, ...context })

const refusal = (...problems: ReadonlyArray<ShopFloorProblem>): ShopFloorResult => ({
  ok: false,
  problems
})

const success = (state: UnitBuildState): ShopFloorResult => ({
  ok: true,
  state,
  problems: []
})

const rfc3339WithOffset =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/

const timestampInstant = (timestamp: string): number => {
  const parts = rfc3339WithOffset.exec(timestamp)
  if (parts === null) return Number.NaN
  const year = Number(parts[1])
  const month = Number(parts[2])
  const day = Number(parts[3])
  const hour = Number(parts[4])
  const minute = Number(parts[5])
  const second = Number(parts[6])
  const offsetHour = Number(parts[7] ?? 0)
  const offsetMinute = Number(parts[8] ?? 0)
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth[month - 1]! ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return Number.NaN
  }
  return Date.parse(timestamp)
}

const calibrationStatuses = new Set(["current", "expired", "unassessed"])
const electricalVerdicts: ReadonlySet<unknown> = new Set(["pass", "fail", "unassessed"])
const shopFloorEventTypes: ReadonlySet<unknown> = new Set([
  "unit-started",
  "step-evidence-recorded",
  "step-completed",
  "deviation-opened",
  "deviation-dispositioned",
  "rework-recorded",
  "step-reopened",
  "unit-closed"
])
const deviationDispositions = new Set([
  "accepted",
  "rework-required",
  "rejected",
  "scrap"
])

const optionalRuntimeString = (record: object, key: string): boolean => {
  const value = Reflect.get(record, key)
  return value === undefined || runtimeString(value)
}

const optionalRuntimeBoolean = (record: object, key: string): boolean => {
  const value = Reflect.get(record, key)
  return value === undefined || runtimeBoolean(value)
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the serialized evidence parser used before reducer/domain access.
const runtimeStepEvidence = (value: unknown): value is StepEvidence => {
  if (!(value instanceof Object) || Array.isArray(value)) return false
  const kind = Reflect.get(value, "kind")
  if (!runtimeString(Reflect.get(value, "id")) || !runtimeString(Reflect.get(value, "timestamp"))) {
    return false
  }
  switch (kind) {
    case "operator":
      return runtimeString(Reflect.get(value, "operatorId"))
    case "material-lot":
      return runtimeString(Reflect.get(value, "materialId")) &&
        runtimeString(Reflect.get(value, "lotId")) &&
        optionalRuntimeString(value, "supplierLotId")
    case "tool-calibration": {
      const status = Reflect.get(value, "calibrationStatus")
      return runtimeString(Reflect.get(value, "toolId")) &&
        runtimeString(Reflect.get(value, "calibrationId")) &&
        (status === undefined || calibrationStatuses.has(status)) &&
        optionalRuntimeString(value, "calibrationExpiresAt")
    }
    case "measurement":
      return runtimeNumber(Reflect.get(value, "value")) &&
        runtimeString(Reflect.get(value, "units")) &&
        runtimeString(Reflect.get(value, "requirementRef"))
    case "attachment":
      return runtimeString(Reflect.get(value, "attachmentId")) &&
        runtimeString(Reflect.get(value, "contentHash")) &&
        optionalRuntimeString(value, "mediaType")
    case "electrical-test":
      return runtimeString(Reflect.get(value, "specificationRef")) &&
        runtimeString(Reflect.get(value, "resultRef")) &&
        runtimeString(Reflect.get(value, "rawResultRef")) &&
        electricalVerdicts.has(Reflect.get(value, "verdict")) &&
        optionalRuntimeString(value, "testerId") &&
        optionalRuntimeString(value, "testProgramVersion") &&
        optionalRuntimeBoolean(value, "interlockConfirmed") &&
        optionalRuntimeBoolean(value, "dischargeConfirmed")
    default:
      return false
  }
}

const uniqueSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)].sort(compare)

const validateWorkOrder = (input: WorkOrderInput): void => {
  const invalid = (message: string): never => {
    throw new TypeError(`${ShopFloorCodes.InvalidWorkOrder}: ${message}`)
  }
  if (absent(input.id)) invalid("A work order requires a non-blank id.")
  if (absent(input.harnessId)) invalid("A work order requires a harness id.")
  if (absent(input.releaseId)) invalid("A work order requires a release id.")
  if (absent(input.hirFingerprint)) invalid("A work order requires a HIR fingerprint.")
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    invalid("Work-order quantity must be a positive safe integer.")
  }
  if (input.stations.length === 0) {
    invalid("A work order requires at least one station and one route step.")
  }

  const stationIds = new Set<string>()
  const stepIds = new Set<string>()
  for (const station of input.stations) {
    if (absent(station.id) || stationIds.has(station.id)) {
      invalid(`Station ids must be non-blank and unique; found ${JSON.stringify(station.id)}.`)
    }
    stationIds.add(station.id)
    if (station.steps.length === 0) {
      invalid(`Station ${station.id} requires at least one route step.`)
    }
    for (const step of station.steps) {
      if (step.stationId !== station.id) {
        invalid(`Step ${step.id} names station ${step.stationId}, not ${station.id}.`)
      }
      if (absent(step.id) || stepIds.has(step.id)) {
        invalid(`Step ids must be non-blank and unique; found ${JSON.stringify(step.id)}.`)
      }
      stepIds.add(step.id)
    }
  }

  const preceding = new Set<string>()
  for (const station of input.stations) {
    for (const step of station.steps) {
      for (const prerequisite of step.prerequisiteStepIds) {
        if (!preceding.has(prerequisite)) {
          invalid(
            `Step ${step.id} requires ${prerequisite}, which is not an earlier step in the ordered route.`
          )
        }
      }
      preceding.add(step.id)
    }
  }
}

/** Deep-copy a valid plan so later caller mutation cannot rewrite the order. */
export const createWorkOrder = (input: WorkOrderInput): WorkOrder => {
  validateWorkOrder(input)
  const required: WorkOrder = {
    id: input.id,
    harnessId: input.harnessId,
    releaseId: input.releaseId,
    hirFingerprint: input.hirFingerprint,
    quantity: input.quantity,
    stations: input.stations.map((station): StationPlan => {
      const plan: StationPlan = {
        id: station.id,
        steps: station.steps.map((step): ShopStep => ({
          id: step.id,
          stationId: step.stationId,
          kind: step.kind,
          instruction: step.instruction,
          revision: step.revision,
          prerequisiteStepIds: [...step.prerequisiteStepIds],
          requiredEvidenceKinds: [...step.requiredEvidenceKinds],
          failureBlocksDownstream: step.failureBlocksDownstream
        }))
      }
      return station.name === undefined ? plan : { ...plan, name: station.name }
    })
  }
  const configured =
    input.configuration === undefined
      ? required
      : { ...required, configuration: copy(input.configuration) }
  return input.options === undefined
    ? configured
    : { ...configured, options: copy(input.options) }
}

const prerequisitesReady = (
  step: MutableStep,
  steps: ReadonlyMap<string, MutableStep>
): string | undefined => {
  for (const id of step.definition.prerequisiteStepIds) {
    const prerequisite = steps.get(id)
    if (prerequisite === undefined) return id
    if (prerequisite.status === "passed") continue
    if (
      prerequisite.status === "failed" &&
      !prerequisite.definition.failureBlocksDownstream
    ) {
      continue
    }
    return id
  }
  return undefined
}

const transitivelyDependsOn = (
  candidate: MutableStep,
  prerequisiteId: string,
  steps: ReadonlyMap<string, MutableStep>,
  // One shared visited set across the whole walk, so each node is expanded at
  // most once (O(V+E)). The route is already validated acyclic, so global
  // memoization keeps reachability correct while eliminating the per-path
  // `new Set([...seen, id])` re-expansion that made a branching prerequisite
  // graph Fibonacci-exponential to check.
  seen: Set<string> = new Set()
): boolean => {
  for (const id of candidate.definition.prerequisiteStepIds) {
    if (id === prerequisiteId) return true
    if (seen.has(id)) continue
    seen.add(id)
    const prerequisite = steps.get(id)
    if (
      prerequisite !== undefined &&
      transitivelyDependsOn(prerequisite, prerequisiteId, steps, seen)
    ) {
      return true
    }
  }
  return false
}

/** Deepest completed dependent first, matching the order it must be reopened. */
const completedDependent = (
  stepId: string,
  steps: ReadonlyMap<string, MutableStep>
): MutableStep | undefined =>
  [...steps.values()]
    .reverse()
    .find(
      (candidate) =>
        (candidate.status === "passed" || candidate.status === "failed") &&
        transitivelyDependsOn(candidate, stepId, steps)
    )

const completionEvidenceProblems = (
  event: Extract<ShopFloorEvent, { readonly type: "step-completed" }>,
  step: MutableStep
): ReadonlyArray<ShopFloorProblem> => {
  const problems: Array<ShopFloorProblem> = []
  const outcome = event.outcome ?? "pass"
  for (const kind of step.definition.requiredEvidenceKinds) {
    const matching = step.currentEvidence.filter((evidence) => evidence.kind === kind)
    if (matching.length === 0) {
      problems.push(
        eventProblem(
          ShopFloorCodes.MissingEvidence,
          `Step ${step.definition.id} requires ${kind} evidence in its current attempt.`,
          event,
          { stepId: step.definition.id, evidenceKind: kind }
        )
      )
      continue
    }
    if (kind === "electrical-test") {
      const latest = matching.at(-1)
      const verdict = latest?.kind === "electrical-test" ? latest.verdict : undefined
      const verdictSupportsOutcome =
        outcome === "pass"
          ? verdict === "pass"
          : verdict === "fail" || verdict === "unassessed"
      if (!verdictSupportsOutcome) {
        problems.push(
          eventProblem(
            ShopFloorCodes.ElectricalTestNotPassed,
            outcome === "pass"
              ? `Step ${step.definition.id} requires a passing electrical-test result; its latest result is ${verdict ?? "missing"}.`
              : `Step ${step.definition.id} can be completed as failed only with a fail or unassessed electrical-test result; its latest result is ${verdict ?? "missing"}.`,
            event,
            { stepId: step.definition.id, evidenceKind: kind }
          )
        )
      }
    }
    if (kind === "tool-calibration" && outcome === "pass") {
      const latest = matching.at(-1)
      const current = latest?.kind === "tool-calibration" &&
        latest.calibrationStatus === "current" &&
        (
          latest.calibrationExpiresAt === undefined ||
          timestampInstant(latest.calibrationExpiresAt) >= timestampInstant(event.timestamp)
        )
      if (!current) {
        problems.push(
          eventProblem(
            ShopFloorCodes.InvalidEvidence,
            `Step ${step.definition.id} requires current tool-calibration evidence at completion.`,
            event,
            { stepId: step.definition.id, evidenceKind: kind }
          )
        )
      }
    }
  }
  return problems
}

const invalidEvidenceReason = (evidence: StepEvidence): string | undefined => {
  if (absent(evidence.id)) return "Evidence requires a non-blank id."
  if (!Number.isFinite(timestampInstant(evidence.timestamp))) {
    return `Evidence ${evidence.id} requires an RFC 3339 timestamp with an explicit offset.`
  }
  switch (evidence.kind) {
    case "operator":
      return absent(evidence.operatorId) ? "Operator evidence requires an operator id." : undefined
    case "material-lot":
      return absent(evidence.materialId) || absent(evidence.lotId)
        ? "Material-lot evidence requires material and lot ids."
        : undefined
    case "tool-calibration":
      if (absent(evidence.toolId) || absent(evidence.calibrationId)) {
        return "Tool evidence requires tool and calibration ids."
      }
      if (
        evidence.calibrationStatus !== undefined &&
        !calibrationStatuses.has(evidence.calibrationStatus)
      ) {
        return "Tool evidence has an invalid calibration status."
      }
      if (
        evidence.calibrationExpiresAt !== undefined &&
        !Number.isFinite(timestampInstant(evidence.calibrationExpiresAt))
      ) {
        return "Tool evidence requires an RFC 3339 calibration expiry with an explicit offset."
      }
      return undefined
    case "measurement":
      return !Number.isFinite(evidence.value) ||
        absent(evidence.units) ||
        absent(evidence.requirementRef)
        ? "Measurement evidence requires a finite value, units, and requirement reference."
        : undefined
    case "attachment":
      return absent(evidence.attachmentId) || absent(evidence.contentHash)
        ? "Attachment evidence requires an attachment id and content hash."
        : undefined
    case "electrical-test":
      return absent(evidence.specificationRef) ||
        absent(evidence.resultRef) ||
        absent(evidence.rawResultRef)
        ? "Electrical-test evidence requires specification, result, and raw-result references."
        : undefined
  }
}

const stationStatus = (
  station: StationPlan,
  steps: ReadonlyMap<string, MutableStep>
): UnitStationState["status"] => {
  const statuses = station.steps.map((step) => steps.get(step.id)?.status ?? "pending")
  if (statuses.some((status) => status === "failed")) return "failed"
  if (statuses.every((status) => status === "passed")) return "passed"
  if (statuses.some((status) => status !== "pending")) return "in-progress"
  return "pending"
}

const deviationState = (deviation: MutableDeviation): UnitDeviationState => {
  const state: UnitDeviationDraft = {
    id: deviation.id,
    stepId: deviation.stepId,
    reason: deviation.reason,
    openedEventId: deviation.openedEventId,
    status: deviation.status
  }
  if (deviation.reference !== undefined) state.reference = deviation.reference
  if (deviation.dispositionEventId !== undefined) {
    state.dispositionEventId = deviation.dispositionEventId
  }
  if (deviation.rationale !== undefined) state.rationale = deviation.rationale
  if (deviation.dispositionRef !== undefined) state.dispositionRef = deviation.dispositionRef
  return state
}

const reworkState = (rework: MutableRework): UnitReworkState => {
  const state: UnitReworkDraft = {
    id: rework.id,
    stepId: rework.stepId,
    description: rework.description,
    recordedEventId: rework.recordedEventId,
    status: rework.status
  }
  if (rework.deviationId !== undefined) state.deviationId = rework.deviationId
  if (rework.attachmentRefs !== undefined) state.attachmentRefs = [...rework.attachmentRefs]
  if (rework.reopenedEventId !== undefined) state.reopenedEventId = rework.reopenedEventId
  if (rework.resolvedEventId !== undefined) state.resolvedEventId = rework.resolvedEventId
  return state
}

const makeState = (
  workOrder: WorkOrder,
  acceptedEvents: ReadonlyArray<ShopFloorEvent>,
  steps: ReadonlyMap<string, MutableStep>,
  deviations: ReadonlyMap<string, MutableDeviation>,
  rework: ReadonlyMap<string, MutableRework>
): UnitBuildState => {
  const started = acceptedEvents[0]
  if (started?.type !== "unit-started") {
    throw new Error("Internal shop-floor replay error: accepted log has no start event.")
  }
  const closed = acceptedEvents.at(-1)
  const isClosed = closed?.type === "unit-closed"
  const allEvidence = acceptedEvents.flatMap((event) =>
    event.type === "step-evidence-recorded" ? [event.evidence] : []
  )
  const electrical = allEvidence.filter(
    (evidence): evidence is ElectricalTestEvidence => evidence.kind === "electrical-test"
  )
  const measurement = allEvidence.filter(
    (evidence): evidence is MeasurementEvidence => evidence.kind === "measurement"
  )
  const state: UnitBuildState = {
    recordVersion: "1.0.0",
    workOrderId: workOrder.id,
    harnessId: workOrder.harnessId,
    releaseId: workOrder.releaseId,
    hirFingerprint: workOrder.hirFingerprint,
    serial: started.serial,
    status: isClosed ? "closed" : "in-progress",
    startedAt: started.timestamp,
    startedBy: started.actor,
    stations: workOrder.stations.map((station): UnitStationState => {
      const base: UnitStationState = {
        id: station.id,
        status: stationStatus(station, steps),
        stepIds: station.steps.map((step) => step.id)
      }
      return station.name === undefined ? base : { ...base, name: station.name }
    }),
    steps: workOrder.stations.flatMap((station) =>
      station.steps.map((definition): UnitStepState => {
        const step = steps.get(definition.id)
        if (step === undefined) {
          throw new Error(`Internal shop-floor replay error: missing step ${definition.id}.`)
        }
        return {
          id: definition.id,
          stationId: definition.stationId,
          kind: definition.kind,
          instruction: definition.instruction,
          revision: definition.revision,
          prerequisiteStepIds: [...definition.prerequisiteStepIds],
          requiredEvidenceKinds: [...definition.requiredEvidenceKinds],
          failureBlocksDownstream: definition.failureBlocksDownstream,
          status: step.status,
          attempt: step.attempt,
          evidence: copy(step.evidence),
          completionEventIds: [...step.completionEventIds],
          reopenEventIds: [...step.reopenEventIds]
        }
      })
    ),
    deviations: [...deviations.values()].map(deviationState),
    rework: [...rework.values()].map(reworkState),
    operatorIds: uniqueSorted([
      ...acceptedEvents.map((event) => event.actor),
      ...allEvidence.flatMap((evidence) =>
        evidence.kind === "operator" ? [evidence.operatorId] : []
      )
    ]),
    materialLots: copy(
      allEvidence.filter(
        (evidence): evidence is MaterialLotEvidence => evidence.kind === "material-lot"
      )
    ),
    tools: copy(
      allEvidence.filter(
        (evidence): evidence is ToolCalibrationEvidence =>
          evidence.kind === "tool-calibration"
      )
    ),
    specificationRefs: uniqueSorted([
      ...measurement.map((evidence) => evidence.requirementRef),
      ...electrical.map((evidence) => evidence.specificationRef)
    ]),
    resultRefs: uniqueSorted(
      electrical.flatMap((evidence) => [evidence.resultRef, evidence.rawResultRef])
    ),
    events: copy(acceptedEvents)
  }
  if (!isClosed || closed === undefined) return state
  return {
    ...state,
    closedAt: closed.timestamp,
    closedBy: closed.actor,
    cycleDurationMs: timestampInstant(closed.timestamp) - timestampInstant(started.timestamp)
  }
}

/**
 * Replay is the reference implementation of every transition and refusal.
 * It stops at the first invalid event, except completion/close gates which
 * return all independent missing requirements in stable route order.
 */
const replayUnitBuildInternal = (
  workOrder: WorkOrder,
  serial: string,
  events: ReadonlyArray<ShopFloorEvent>
): ShopFloorResult => {
  if (events.length === 0) {
    return refusal({
      code: ShopFloorCodes.UnitNotStarted,
      message: `Unit ${serial} has no unit-started event.`
    })
  }

  const duplicateEventIds = new Set<string>()
  const seenEventIds = new Set<string>()
  for (const event of events) {
    if (seenEventIds.has(event.id)) duplicateEventIds.add(event.id)
    seenEventIds.add(event.id)
  }
  if (duplicateEventIds.size > 0) {
    const id = [...duplicateEventIds].sort(compare)[0]!
    return refusal({
      code: ShopFloorCodes.DuplicateEvent,
      message: `Event id ${id} appears more than once.`,
      eventId: id
    })
  }

  const steps = new Map<string, MutableStep>()
  for (const station of workOrder.stations) {
    for (const definition of station.steps) {
      steps.set(definition.id, {
        definition,
        status: "pending",
        attempt: 1,
        evidence: [],
        currentEvidence: [],
        completionEventIds: [],
        reopenEventIds: []
      })
    }
  }
  const evidenceIds = new Set<string>()
  const deviations = new Map<string, MutableDeviation>()
  const rework = new Map<string, MutableRework>()
  const acceptedEvents: Array<ShopFloorEvent> = []
  let priorInstant = Number.NEGATIVE_INFINITY
  let closed = false

  for (let index = 0; index < events.length; index += 1) {
    const original = events[index]!
    const event = copy(original)
    if (!runtimeNonBlankString(event.id) || !runtimeNonBlankString(event.actor)) {
      return refusal(
        eventProblem(
          ShopFloorCodes.InvalidEvent,
          "Every event requires a non-blank id and actor.",
          event
        )
      )
    }
    if (!shopFloorEventTypes.has(event.type)) {
      return refusal(
        eventProblem(
          ShopFloorCodes.InvalidEvent,
          "Event has an unsupported runtime type.",
          event
        )
      )
    }
    if (event.workOrderId !== workOrder.id) {
      return refusal(
        eventProblem(
          ShopFloorCodes.WrongWorkOrder,
          `Event ${event.id} belongs to work order ${event.workOrderId}, not ${workOrder.id}.`,
          event
        )
      )
    }
    if (event.serial !== serial) {
      return refusal(
        eventProblem(
          ShopFloorCodes.WrongSerial,
          `Event ${event.id} belongs to serial ${event.serial}, not ${serial}.`,
          event
        )
      )
    }
    const instant = timestampInstant(event.timestamp)
    if (!Number.isFinite(instant)) {
      return refusal(
        eventProblem(
          ShopFloorCodes.InvalidTimestamp,
          `Event ${event.id} has an invalid or zone-less RFC 3339 timestamp.`,
          event
        )
      )
    }
    if (instant < priorInstant) {
      return refusal(
        eventProblem(
          ShopFloorCodes.TimestampOutOfOrder,
          `Event ${event.id} predates the event before it.`,
          event
        )
      )
    }
    priorInstant = instant

    if (index === 0 && event.type !== "unit-started") {
      return refusal(
        eventProblem(
          ShopFloorCodes.UnitNotStarted,
          "The first event for a serialized unit must be unit-started.",
          event
        )
      )
    }
    if (closed) {
      return refusal(
        eventProblem(
          ShopFloorCodes.AlreadyClosed,
          `Unit ${serial} is closed; no later event may alter its record.`,
          event
        )
      )
    }

    switch (event.type) {
      case "unit-started": {
        if (index !== 0) {
          return refusal(
            eventProblem(
              ShopFloorCodes.AlreadyStarted,
              `Unit ${serial} already has a unit-started event.`,
              event
            )
          )
        }
        if (event.hirFingerprint !== workOrder.hirFingerprint) {
          return refusal(
            eventProblem(
              ShopFloorCodes.FingerprintMismatch,
              `Scanned HIR fingerprint ${event.hirFingerprint} does not match released fingerprint ${workOrder.hirFingerprint}.`,
              event
            )
          )
        }
        if (event.releaseId !== undefined && event.releaseId !== workOrder.releaseId) {
          return refusal(
            eventProblem(
              ShopFloorCodes.ReleaseMismatch,
              `Retrieved release ${event.releaseId} does not match work-order release ${workOrder.releaseId}.`,
              event
            )
          )
        }
        break
      }

      case "step-evidence-recorded": {
        if (!runtimeNonBlankString(event.stepId) || !runtimeStepEvidence(event.evidence)) {
          return refusal(
            eventProblem(
              ShopFloorCodes.InvalidEvent,
              "A step-evidence-recorded event requires a non-blank step id and a recognized evidence payload.",
              event
            )
          )
        }
        const step = steps.get(event.stepId)
        if (step === undefined) {
          return refusal(
            eventProblem(
              ShopFloorCodes.UnknownStep,
              `Evidence names unknown step ${event.stepId}.`,
              event,
              { stepId: event.stepId }
            )
          )
        }
        if (step.status === "passed" || step.status === "failed") {
          return refusal(
            eventProblem(
              ShopFloorCodes.StepAlreadyCompleted,
              `Step ${event.stepId} is complete and must be reopened before recording more evidence.`,
              event,
              { stepId: event.stepId }
            )
          )
        }
        const blockedBy = prerequisitesReady(step, steps)
        if (blockedBy !== undefined) {
          return refusal(
            eventProblem(
              ShopFloorCodes.PrerequisiteIncomplete,
              `Step ${event.stepId} is blocked by prerequisite ${blockedBy}.`,
              event,
              { stepId: event.stepId, relatedId: blockedBy }
            )
          )
        }
        if (evidenceIds.has(event.evidence.id)) {
          return refusal(
            eventProblem(
              ShopFloorCodes.DuplicateEvidence,
              `Evidence id ${event.evidence.id} has already been recorded.`,
              event,
              { stepId: event.stepId, relatedId: event.evidence.id }
            )
          )
        }
        const evidenceProblem = invalidEvidenceReason(event.evidence)
        if (evidenceProblem !== undefined) {
          return refusal(
            eventProblem(ShopFloorCodes.InvalidEvidence, evidenceProblem, event, {
              stepId: event.stepId,
              evidenceKind: event.evidence.kind,
              relatedId: event.evidence.id
            })
          )
        }
        evidenceIds.add(event.evidence.id)
        step.evidence.push(copy(event.evidence))
        step.currentEvidence.push(copy(event.evidence))
        step.status = "in-progress"
        break
      }

      case "step-completed": {
        const step = steps.get(event.stepId)
        if (step === undefined) {
          return refusal(
            eventProblem(
              ShopFloorCodes.UnknownStep,
              `Completion names unknown step ${event.stepId}.`,
              event,
              { stepId: event.stepId }
            )
          )
        }
        if (step.status === "passed" || step.status === "failed") {
          return refusal(
            eventProblem(
              ShopFloorCodes.StepAlreadyCompleted,
              `Step ${event.stepId} is already complete.`,
              event,
              { stepId: event.stepId }
            )
          )
        }
        const blockedBy = prerequisitesReady(step, steps)
        if (blockedBy !== undefined) {
          return refusal(
            eventProblem(
              ShopFloorCodes.PrerequisiteIncomplete,
              `Step ${event.stepId} is blocked by prerequisite ${blockedBy}.`,
              event,
              { stepId: event.stepId, relatedId: blockedBy }
            )
          )
        }
        const evidenceProblems = completionEvidenceProblems(event, step)
        if (evidenceProblems.length > 0) return refusal(...evidenceProblems)
        const outcome = event.outcome ?? "pass"
        step.status = outcome === "pass" ? "passed" : "failed"
        step.completionEventIds.push(event.id)
        if (outcome === "pass") {
          for (const item of rework.values()) {
            if (item.stepId !== event.stepId || item.reopenedAttempt !== step.attempt) continue
            item.status = "resolved"
            item.resolvedEventId = event.id
          }
        }
        break
      }

      case "deviation-opened": {
        if (
          !runtimeNonBlankString(event.deviationId) ||
          !runtimeNonBlankString(event.stepId) ||
          !runtimeNonBlankString(event.reason) ||
          (event.reference !== undefined && !runtimeNonBlankString(event.reference))
        ) {
          return refusal(
            eventProblem(
              ShopFloorCodes.InvalidEvent,
              "A deviation requires non-blank deviation, step, and reason fields; its optional reference must also be non-blank.",
              event,
              { stepId: event.stepId, relatedId: event.deviationId }
            )
          )
        }
        if (!steps.has(event.stepId)) {
          return refusal(
            eventProblem(
              ShopFloorCodes.UnknownStep,
              `Deviation ${event.deviationId} names unknown step ${event.stepId}.`,
              event,
              { stepId: event.stepId, relatedId: event.deviationId }
            )
          )
        }
        if (deviations.has(event.deviationId)) {
          return refusal(
            eventProblem(
              ShopFloorCodes.DuplicateDeviation,
              `Deviation id ${event.deviationId} has already been opened.`,
              event,
              { stepId: event.stepId, relatedId: event.deviationId }
            )
          )
        }
        const deviation: MutableDeviation = {
          id: event.deviationId,
          stepId: event.stepId,
          reason: event.reason,
          openedEventId: event.id,
          status: "open"
        }
        if (event.reference !== undefined) deviation.reference = event.reference
        deviations.set(event.deviationId, deviation)
        break
      }

      case "deviation-dispositioned": {
        if (
          !runtimeNonBlankString(event.deviationId) ||
          !runtimeNonBlankString(event.rationale) ||
          !deviationDispositions.has(event.disposition) ||
          (event.dispositionRef !== undefined && !runtimeNonBlankString(event.dispositionRef))
        ) {
          return refusal(
            eventProblem(
              ShopFloorCodes.InvalidEvent,
              "A deviation disposition requires a known disposition and non-blank deviation and rationale fields; its optional reference must also be non-blank.",
              event,
              { relatedId: event.deviationId }
            )
          )
        }
        const deviation = deviations.get(event.deviationId)
        if (deviation === undefined) {
          return refusal(
            eventProblem(
              ShopFloorCodes.UnknownDeviation,
              `Disposition names unknown deviation ${event.deviationId}.`,
              event,
              { relatedId: event.deviationId }
            )
          )
        }
        if (deviation.status !== "open") {
          return refusal(
            eventProblem(
              ShopFloorCodes.DeviationAlreadyDispositioned,
              `Deviation ${event.deviationId} is already ${deviation.status}.`,
              event,
              { stepId: deviation.stepId, relatedId: event.deviationId }
            )
          )
        }
        deviation.status = event.disposition
        deviation.dispositionEventId = event.id
        deviation.rationale = event.rationale
        if (event.dispositionRef !== undefined) deviation.dispositionRef = event.dispositionRef
        break
      }

      case "rework-recorded": {
        const step = steps.get(event.stepId)
        if (step === undefined) {
          return refusal(
            eventProblem(
              ShopFloorCodes.UnknownStep,
              `Rework ${event.reworkId} names unknown step ${event.stepId}.`,
              event,
              { stepId: event.stepId, relatedId: event.reworkId }
            )
          )
        }
        if (rework.has(event.reworkId)) {
          return refusal(
            eventProblem(
              ShopFloorCodes.DuplicateRework,
              `Rework id ${event.reworkId} has already been recorded.`,
              event,
              { stepId: event.stepId, relatedId: event.reworkId }
            )
          )
        }
        if (event.deviationId !== undefined) {
          const deviation = deviations.get(event.deviationId)
          if (
            deviation === undefined ||
            deviation.status !== "rework-required" ||
            deviation.stepId !== event.stepId
          ) {
            return refusal(
              eventProblem(
                ShopFloorCodes.InvalidRework,
                `Rework ${event.reworkId} must link to a rework-required deviation on step ${event.stepId}.`,
                event,
                { stepId: event.stepId, relatedId: event.deviationId }
              )
            )
          }
        }
        const item: MutableRework = {
          id: event.reworkId,
          stepId: event.stepId,
          description: event.description,
          recordedEventId: event.id,
          status: "awaiting-reopen"
        }
        if (event.deviationId !== undefined) item.deviationId = event.deviationId
        if (event.attachmentRefs !== undefined) item.attachmentRefs = [...event.attachmentRefs]
        rework.set(event.reworkId, item)
        break
      }

      case "step-reopened": {
        const step = steps.get(event.stepId)
        if (step === undefined) {
          return refusal(
            eventProblem(
              ShopFloorCodes.UnknownStep,
              `Reopen event names unknown step ${event.stepId}.`,
              event,
              { stepId: event.stepId }
            )
          )
        }
        if (step.status !== "passed" && step.status !== "failed") {
          return refusal(
            eventProblem(
              ShopFloorCodes.StepNotCompleted,
              `Step ${event.stepId} must be complete before it can be reopened.`,
              event,
              { stepId: event.stepId }
            )
          )
        }
        const dependent = completedDependent(event.stepId, steps)
        if (dependent !== undefined) {
          return refusal(
            eventProblem(
              ShopFloorCodes.CompletedDependent,
              `Step ${event.stepId} cannot reopen while dependent step ${dependent.definition.id} is complete; reopen completed dependents first.`,
              event,
              { stepId: event.stepId, relatedId: dependent.definition.id }
            )
          )
        }
        let linkedRework: MutableRework | undefined
        if (event.reworkId !== undefined) {
          linkedRework = rework.get(event.reworkId)
          if (
            linkedRework === undefined ||
            linkedRework.stepId !== event.stepId ||
            linkedRework.status !== "awaiting-reopen"
          ) {
            return refusal(
              eventProblem(
                ShopFloorCodes.InvalidRework,
                `Step ${event.stepId} cannot reopen against rework ${event.reworkId}.`,
                event,
                { stepId: event.stepId, relatedId: event.reworkId }
              )
            )
          }
        }
        if (event.deviationId !== undefined) {
          const deviation = deviations.get(event.deviationId)
          if (deviation === undefined || deviation.stepId !== event.stepId) {
            return refusal(
              eventProblem(
                ShopFloorCodes.UnknownDeviation,
                `Step ${event.stepId} cannot reopen against deviation ${event.deviationId}.`,
                event,
                { stepId: event.stepId, relatedId: event.deviationId }
              )
            )
          }
          if (linkedRework?.deviationId !== undefined && linkedRework.deviationId !== event.deviationId) {
            return refusal(
              eventProblem(
                ShopFloorCodes.InvalidRework,
                `Rework ${linkedRework.id} belongs to deviation ${linkedRework.deviationId}, not ${event.deviationId}.`,
                event,
                { stepId: event.stepId, relatedId: linkedRework.id }
              )
            )
          }
        }
        step.status = "pending"
        step.attempt += 1
        step.currentEvidence.length = 0
        step.reopenEventIds.push(event.id)
        if (linkedRework !== undefined) {
          linkedRework.status = "awaiting-verification"
          linkedRework.reopenedEventId = event.id
          linkedRework.reopenedAttempt = step.attempt
        }
        break
      }

      case "unit-closed": {
        const problems: Array<ShopFloorProblem> = []
        for (const step of steps.values()) {
          if (step.status !== "passed") {
            problems.push(
              eventProblem(
                ShopFloorCodes.IncompleteSteps,
                `Step ${step.definition.id} is ${step.status}; every step must pass before unit close.`,
                event,
                { stepId: step.definition.id }
              )
            )
          }
        }
        for (const deviation of deviations.values()) {
          if (deviation.status === "open") {
            problems.push(
              eventProblem(
                ShopFloorCodes.OpenDeviation,
                `Deviation ${deviation.id} is still open.`,
                event,
                { stepId: deviation.stepId, relatedId: deviation.id }
              )
            )
          }
          if (deviation.status === "rejected" || deviation.status === "scrap") {
            problems.push(
              eventProblem(
                ShopFloorCodes.RejectedDeviation,
                `Deviation ${deviation.id} is dispositioned ${deviation.status}; the unit cannot close.`,
                event,
                { stepId: deviation.stepId, relatedId: deviation.id }
              )
            )
          }
          if (
            deviation.status === "rework-required" &&
            ![...rework.values()].some(
              (item) => item.deviationId === deviation.id && item.status === "resolved"
            )
          ) {
            problems.push(
              eventProblem(
                ShopFloorCodes.UnresolvedRework,
                `Deviation ${deviation.id} requires rework that has not been verified.`,
                event,
                { stepId: deviation.stepId, relatedId: deviation.id }
              )
            )
          }
        }
        for (const item of rework.values()) {
          if (item.status !== "resolved") {
            problems.push(
              eventProblem(
                ShopFloorCodes.UnresolvedRework,
                `Rework ${item.id} is ${item.status}.`,
                event,
                { stepId: item.stepId, relatedId: item.id }
              )
            )
          }
        }
        if (problems.length > 0) return refusal(...problems)
        closed = true
        break
      }

      default:
        return refusal(
          eventProblem(
            ShopFloorCodes.InvalidEvent,
            "Event has an unsupported runtime type.",
            event
          )
        )
    }
    acceptedEvents.push(event)
  }

  return success(makeState(workOrder, acceptedEvents, steps, deviations, rework))
}

/** Replay never leaks native exceptions for malformed serialized events. */
export const replayUnitBuild = (
  workOrder: WorkOrder,
  serial: string,
  events: ReadonlyArray<ShopFloorEvent>
): ShopFloorResult => {
  try {
    return replayUnitBuildInternal(workOrder, serial, events)
  } catch {
    return refusal({
      code: ShopFloorCodes.InvalidEvent,
      message: "Shop-floor event history contains an unreadable runtime payload."
    })
  }
}

type ProgressProjection =
  | { readonly ok: true; readonly progress: WorkOrderProgress }
  | { readonly ok: false; readonly problem: ShopFloorProblem }

const progressFailure = (
  code: typeof ShopFloorCodes.ProgressMismatch | typeof ShopFloorCodes.DivergentHistory,
  message: string
): ProgressProjection => ({ ok: false, problem: { code, message } })

const canonicalEvent = (event: ShopFloorEvent): string => {
  const canonical: Canonical = JSON.parse(JSON.stringify(event))
  return canonicalize(canonical)
}

const canonicalBuild = (build: UnitBuildState): string => {
  const canonical: Canonical = JSON.parse(JSON.stringify(build))
  return canonicalize(canonical)
}

const sameSortedStrings = (
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>
): boolean => {
  const left = [...a].sort(compare)
  const right = [...b].sort(compare)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

const sameProgress = (a: WorkOrderProgress, b: WorkOrderProgress): boolean =>
  a.workOrderId === b.workOrderId &&
  a.quantity === b.quantity &&
  a.started === b.started &&
  a.inProgress === b.inProgress &&
  a.completed === b.completed &&
  a.remaining === b.remaining &&
  a.remainingToComplete === b.remainingToComplete &&
  a.overrun === b.overrun &&
  sameSortedStrings(a.serials, b.serials)

const invalidProgressContext = (
  workOrder: WorkOrder,
  progress: WorkOrderProgress
): ShopFloorProblem | undefined => {
  if (progress.workOrderId !== workOrder.id || progress.quantity !== workOrder.quantity) {
    return {
      code: ShopFloorCodes.ProgressMismatch,
      message: `Progress context does not describe work order ${workOrder.id} and quantity ${workOrder.quantity}.`
    }
  }
  const counts = [
    progress.started,
    progress.inProgress,
    progress.completed,
    progress.remaining,
    progress.remainingToComplete,
    progress.overrun
  ]
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
    return {
      code: ShopFloorCodes.ProgressMismatch,
      message: "Progress context counts must be nonnegative safe integers."
    }
  }
  if (!Array.isArray(progress.serials)) {
    return {
      code: ShopFloorCodes.ProgressMismatch,
      message: "Progress context requires a serial array."
    }
  }
  const invalidSerial = progress.serials.some(absent)
  const serials = new Set(progress.serials)
  if (invalidSerial || serials.size !== progress.serials.length) {
    return {
      code: ShopFloorCodes.ProgressMismatch,
      message: "Progress context serials must be non-blank and unique."
    }
  }
  if (
    progress.started !== progress.serials.length ||
    progress.inProgress + progress.completed !== progress.started ||
    progress.remaining !== Math.max(0, progress.quantity - progress.started) ||
    progress.remainingToComplete !== Math.max(0, progress.quantity - progress.completed) ||
    progress.overrun !== Math.max(0, progress.started - progress.quantity)
  ) {
    return {
      code: ShopFloorCodes.ProgressMismatch,
      message: "Progress context counts are not self-consistent with its serials and quantity."
    }
  }
  return undefined
}

const buildMatchesWorkOrder = (workOrder: WorkOrder, build: UnitBuildState): boolean =>
  build.workOrderId === workOrder.id &&
  build.harnessId === workOrder.harnessId &&
  build.releaseId === workOrder.releaseId &&
  build.hirFingerprint === workOrder.hirFingerprint

const deriveWorkOrderProgress = (
  workOrder: WorkOrder,
  builds: ReadonlyArray<UnitBuildState>,
  requireMatchingIdentity: boolean
): ProgressProjection => {
  const current = new Map<string, UnitBuildState>()
  for (const build of builds) {
    if (!buildMatchesWorkOrder(workOrder, build)) {
      if (!requireMatchingIdentity) continue
      return progressFailure(
        ShopFloorCodes.ProgressMismatch,
        `Build ${build.serial} does not belong to work order ${workOrder.id}.`
      )
    }
    if (absent(build.serial)) {
      return progressFailure(
        ShopFloorCodes.ProgressMismatch,
        "Build context contains a blank serial."
      )
    }
    const replayed = replayUnitBuild(workOrder, build.serial, build.events)
    if (!replayed.ok) {
      return progressFailure(
        ShopFloorCodes.ProgressMismatch,
        `Build ${build.serial} is not a valid projection: ${replayed.problems[0]?.code ?? "unknown replay failure"}.`
      )
    }
    if (canonicalBuild(replayed.state) !== canonicalBuild(build)) {
      return progressFailure(
        ShopFloorCodes.ProgressMismatch,
        `Build ${build.serial} is not self-consistent with its event history.`
      )
    }

    const existing = current.get(build.serial)
    if (existing === undefined) {
      current.set(build.serial, build)
      continue
    }
    const sharedLength = Math.min(existing.events.length, build.events.length)
    let isPrefix = true
    for (let index = 0; index < sharedLength; index += 1) {
      if (canonicalEvent(existing.events[index]!) === canonicalEvent(build.events[index]!)) continue
      isPrefix = false
      break
    }
    if (!isPrefix) {
      return progressFailure(
        ShopFloorCodes.DivergentHistory,
        `Serial ${build.serial} has divergent event histories; neither projection may supersede the other.`
      )
    }
    if (build.events.length > existing.events.length) current.set(build.serial, build)
  }

  const serials = [...current.keys()].sort(compare)
  const started = serials.length
  const completed = [...current.values()].filter((build) => build.status === "closed").length
  const inProgress = started - completed
  return {
    ok: true,
    progress: {
      workOrderId: workOrder.id,
      quantity: workOrder.quantity,
      started,
      inProgress,
      completed,
      remaining: Math.max(0, workOrder.quantity - started),
      remainingToComplete: Math.max(0, workOrder.quantity - completed),
      overrun: Math.max(0, started - workOrder.quantity),
      serials
    }
  }
}

/**
 * Validate a pre-reservation snapshot and create a start event. This does not
 * reserve anything by itself: the caller must make context validation and
 * persistence atomic so two stations cannot consume the same quantity slot.
 */
export const startUnitBuild = (
  workOrder: WorkOrder,
  input: StartUnitBuildInput
): ShopFloorResult => {
  if (input.builds === undefined && input.progress === undefined) {
    return refusal({
      code: ShopFloorCodes.StartContextRequired,
      message:
        "Starting a unit requires authoritative builds or progress context; reserve the serial and quantity slot atomically when persisting the start event."
    })
  }
  if (absent(input.serial)) {
    return refusal({
      code: ShopFloorCodes.InvalidEvent,
      message: "Starting a unit requires a non-blank serial."
    })
  }

  const derived =
    input.builds === undefined
      ? undefined
      : deriveWorkOrderProgress(workOrder, input.builds, true)
  if (derived !== undefined && !derived.ok) return refusal(derived.problem)

  if (input.progress !== undefined) {
    const problem = invalidProgressContext(workOrder, input.progress)
    if (problem !== undefined) return refusal(problem)
    if (derived?.ok === true && !sameProgress(derived.progress, input.progress)) {
      return refusal({
        code: ShopFloorCodes.ProgressMismatch,
        message: "Supplied builds and progress contexts disagree."
      })
    }
  }
  const progress = input.progress ?? (derived?.ok === true ? derived.progress : undefined)
  if (progress === undefined) {
    return refusal({
      code: ShopFloorCodes.StartContextRequired,
      message: "Starting a unit requires authoritative builds or progress context."
    })
  }
  if (progress.serials.includes(input.serial)) {
    return refusal({
      code: ShopFloorCodes.SerialAlreadyStarted,
      message: `Serial ${input.serial} has already started on work order ${workOrder.id}.`
    })
  }
  if (progress.started >= workOrder.quantity) {
    return refusal({
      code: ShopFloorCodes.QuantityExceeded,
      message: `Work order ${workOrder.id} already has ${progress.started} of ${workOrder.quantity} units started.`
    })
  }

  const event: UnitStartedEventDraft = {
    type: "unit-started",
    id: input.id,
    timestamp: input.timestamp,
    actor: input.actor,
    workOrderId: input.workOrderId ?? workOrder.id,
    serial: input.serial,
    hirFingerprint: input.hirFingerprint
  }
  if (input.releaseId !== undefined) event.releaseId = input.releaseId
  return replayUnitBuild(workOrder, input.serial, [event])
}

/** Append without mutating the prior array; full replay is intentional. */
export const appendShopFloorEvent = (
  workOrder: WorkOrder,
  priorEvents: ReadonlyArray<ShopFloorEvent>,
  event: ShopFloorEvent
): ShopFloorResult =>
  replayUnitBuild(workOrder, priorEvents[0]?.serial ?? event.serial, [...priorEvents, event])

/**
 * Count current projections, not serialized history snapshots. Exact and
 * prefix-related histories collapse to the longest valid projection. A fork
 * has no safe winner and throws a stable PL-SHOP diagnostic instead.
 */
export const workOrderProgress = (
  workOrder: WorkOrder,
  builds: ReadonlyArray<UnitBuildState>
): WorkOrderProgress => {
  const projection = deriveWorkOrderProgress(workOrder, builds, false)
  if (!projection.ok) {
    throw new TypeError(`${projection.problem.code}: ${projection.problem.message}`)
  }
  return projection.progress
}

/** Canonical JSON, with the record delimiter required for file concatenation. */
export const serializeUnitBuild = (state: UnitBuildState): string => {
  // JSON parsing gives the structural Canonical union a concrete JSON value;
  // the stringify step also drops absent optional members before key sorting.
  const canonical: Canonical = JSON.parse(JSON.stringify(state))
  return `${canonicalize(canonical)}\n`
}

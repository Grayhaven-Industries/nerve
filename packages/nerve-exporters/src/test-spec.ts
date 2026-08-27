/**
 * Versioned electrical acceptance authority.
 *
 * A generated test plan says what points are connected; it is not an
 * acceptance specification. Numeric limits enter Nerve only through this
 * caller-authored, reviewable record. The source plan is retained so point
 * and test-id traceability can be replayed without consulting mutable state.
 */
import { DiagnosticSeverity, type Diagnostic } from "@grayhaven/nerve"
import { draft } from "./draft.js"
import type { Measurement } from "./build-record.js"
import type { HarnessTest, TestPlan, TestPoint } from "./test-plan.js"

export const TEST_SPEC_SCHEMA_VERSION = "1.0.0" as const

export type ElectricalTestMethod =
  | "continuity"
  | "four-wire-resistance"
  | "insulation-resistance"
  | "dielectric-withstand"

export interface TestSpecificationAuthority {
  /** The customer, engineering, or other controlled source authorizing the limits. */
  readonly source: string
  readonly documentRevision?: string
  readonly clause?: string
}

export interface TestSpecificationApproval {
  readonly approvedBy: string
  /** Caller-supplied timestamp; approval never reads the system clock. */
  readonly approvedAt: string
  readonly reference?: string
}

interface ElectricalTestStepTrace {
  /** ID copied from `generateTestPlan(...).tests[].id`. */
  readonly id: string
  readonly planType: HarnessTest["type"]
  readonly expected: HarnessTest["expected"]
  readonly from: TestPoint
  readonly to: TestPoint
  readonly net?: string
}

export interface ContinuityElectricalTestStep extends ElectricalTestStepTrace {
  readonly method: "continuity"
  readonly maxOhms: number
}

export interface FourWireResistanceElectricalTestStep extends ElectricalTestStepTrace {
  readonly method: "four-wire-resistance"
  readonly maxOhms: number
}

export interface InsulationResistanceElectricalTestStep extends ElectricalTestStepTrace {
  readonly method: "insulation-resistance"
  readonly testVoltageV: number
  readonly testVoltageToleranceV?: number
  readonly minOhms: number
  readonly dwellSeconds?: number
  readonly rampSeconds?: number
}

export interface DielectricWithstandElectricalTestStep extends ElectricalTestStepTrace {
  readonly method: "dielectric-withstand"
  readonly testVoltageV: number
  readonly testVoltageToleranceV?: number
  readonly maxLeakageMilliAmps: number
  readonly dwellSeconds: number
  readonly rampSeconds?: number
  readonly waveform: "ac" | "dc"
}

export type ElectricalTestStep =
  | ContinuityElectricalTestStep
  | FourWireResistanceElectricalTestStep
  | InsulationResistanceElectricalTestStep
  | DielectricWithstandElectricalTestStep

export type ElectricalTestStepOptions =
  | Pick<ContinuityElectricalTestStep, "id" | "method" | "maxOhms">
  | Pick<FourWireResistanceElectricalTestStep, "id" | "method" | "maxOhms">
  | Pick<
      InsulationResistanceElectricalTestStep,
      | "id"
      | "method"
      | "testVoltageV"
      | "testVoltageToleranceV"
      | "minOhms"
      | "dwellSeconds"
      | "rampSeconds"
    >
  | Pick<
      DielectricWithstandElectricalTestStep,
      | "id"
      | "method"
      | "testVoltageV"
      | "testVoltageToleranceV"
      | "maxLeakageMilliAmps"
      | "dwellSeconds"
      | "rampSeconds"
      | "waveform"
    >

export interface TestSpecificationOptions {
  readonly id: string
  readonly revision: string
  readonly authority: TestSpecificationAuthority
  /** Procedure order is retained exactly; limits are never synthesized. */
  readonly steps: ReadonlyArray<ElectricalTestStepOptions>
}

export interface TestSpecification {
  readonly schemaVersion: typeof TEST_SPEC_SCHEMA_VERSION
  readonly id: string
  readonly revision: string
  readonly harness: { readonly id: string; readonly revision: string }
  readonly status: "draft" | "approved"
  readonly authority: TestSpecificationAuthority
  /** Exact generated plan against which step traces were authored. */
  readonly testPlan: TestPlan
  readonly steps: ReadonlyArray<ElectricalTestStep>
  readonly approval?: TestSpecificationApproval
}

export type ElectricalMeasurementVerdict = "pass" | "fail" | "unassessed"

const ELECTRICAL_TEST_METHODS: ReadonlyArray<ElectricalTestMethod> = [
  "continuity",
  "four-wire-resistance",
  "insulation-resistance",
  "dielectric-withstand"
]

const knownElectricalMethod = (method: ElectricalTestMethod): boolean =>
  ELECTRICAL_TEST_METHODS.includes(method)

const nonBlank = (value: string | null | undefined): value is string =>
  (value?.trim?.().length ?? 0) > 0

const positiveFinite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0

const nonNegativeFinite = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0

const samePoint = (
  a: TestPoint | null | undefined,
  b: TestPoint | null | undefined
): boolean =>
  a?.connector === b?.connector && a?.pin === b?.pin && a != null && b != null

const sameStringArray = (
  a: ReadonlyArray<string> | undefined,
  b: ReadonlyArray<string> | undefined
): boolean =>
  a === undefined || b === undefined
    ? a === b
    : a.length === b.length && a.every((value, index) => value === b[index])

const samePlanTest = (a: HarnessTest, b: HarnessTest): boolean => {
  if (
    a.id !== b.id ||
    a.type !== b.type ||
    a.expected !== b.expected ||
    !samePoint(a.from, b.from) ||
    !samePoint(a.to, b.to) ||
    a.net !== b.net
  ) {
    return false
  }
  if (a.type === "continuity" && b.type === "continuity") return a.wire === b.wire
  if (a.type === "splice" && b.type === "splice") return a.splice === b.splice
  if (a.type === "net-continuity" && b.type === "net-continuity") {
    return sameStringArray(a.wires, b.wires) && sameStringArray(a.splices, b.splices)
  }
  return a.type === "no-short" && b.type === "no-short"
}

const copyPlanTest = (test: HarnessTest): HarnessTest => {
  const from = { connector: test.from.connector, pin: test.from.pin }
  const to = { connector: test.to.connector, pin: test.to.pin }
  return test.type === "net-continuity"
    ? { ...test, from, to, wires: [...test.wires], splices: [...test.splices] }
    : { ...test, from, to }
}

const copyTestPlan = (plan: TestPlan): TestPlan => ({
  harness: { id: plan.harness.id, revision: plan.harness.revision },
  tests: plan.tests.map(copyPlanTest)
})

/** True only when the complete retained source plan matches the supplied plan. */
export const testSpecificationMatchesPlan = (
  specification: TestSpecification,
  plan: TestPlan
): boolean =>
  specification.harness.id === plan.harness.id &&
  specification.harness.revision === plan.harness.revision &&
  specification.testPlan.harness.id === plan.harness.id &&
  specification.testPlan.harness.revision === plan.harness.revision &&
  specification.testPlan.tests.length === plan.tests.length &&
  specification.testPlan.tests.every((test, index) => {
    const current = plan.tests[index]
    return current !== undefined && samePlanTest(test, current)
  })

const trace = (test: HarnessTest | undefined): ElectricalTestStepTrace => {
  if (test === undefined) {
    return {
      id: "",
      planType: "continuity",
      expected: "closed",
      from: { connector: "", pin: "" },
      to: { connector: "", pin: "" }
    }
  }
  const result = draft<ElectricalTestStepTrace>({
    id: test.id,
    planType: test.type,
    expected: test.expected,
    from: { connector: test.from.connector, pin: test.from.pin },
    to: { connector: test.to.connector, pin: test.to.pin }
  })
  if (test.net !== undefined) result.net = test.net
  return result
}

const makeStep = (
  planById: ReadonlyMap<string, HarnessTest>,
  option: ElectricalTestStepOptions
): ElectricalTestStep => {
  const planned = planById.get(option.id)
  // Retain an unknown requested id in the invalid draft so validation can
  // report it. Blank points make it impossible to mistake for usable trace.
  const base = { ...trace(planned), id: option.id }
  switch (option.method) {
    case "continuity":
      return { ...base, method: option.method, maxOhms: option.maxOhms }
    case "four-wire-resistance":
      return { ...base, method: option.method, maxOhms: option.maxOhms }
    case "insulation-resistance": {
      const step = draft<InsulationResistanceElectricalTestStep>({
        ...base,
        method: option.method,
        testVoltageV: option.testVoltageV,
        minOhms: option.minOhms
      })
      if (option.testVoltageToleranceV !== undefined) {
        step.testVoltageToleranceV = option.testVoltageToleranceV
      }
      if (option.dwellSeconds !== undefined) step.dwellSeconds = option.dwellSeconds
      if (option.rampSeconds !== undefined) step.rampSeconds = option.rampSeconds
      return step
    }
    case "dielectric-withstand": {
      const step = draft<DielectricWithstandElectricalTestStep>({
        ...base,
        method: option.method,
        testVoltageV: option.testVoltageV,
        maxLeakageMilliAmps: option.maxLeakageMilliAmps,
        dwellSeconds: option.dwellSeconds,
        waveform: option.waveform
      })
      if (option.testVoltageToleranceV !== undefined) {
        step.testVoltageToleranceV = option.testVoltageToleranceV
      }
      if (option.rampSeconds !== undefined) step.rampSeconds = option.rampSeconds
      return step
    }
  }
}

/** Create a deterministic draft. Invalid caller input is retained and diagnosed, never thrown. */
export const createTestSpecification = (
  plan: TestPlan,
  options: TestSpecificationOptions
): TestSpecification => {
  const retainedPlan = copyTestPlan(plan)
  const planById = new Map(retainedPlan.tests.map((test) => [test.id, test]))
  const authority = draft<TestSpecificationAuthority>({ source: options.authority.source })
  if (options.authority.documentRevision !== undefined) {
    authority.documentRevision = options.authority.documentRevision
  }
  if (options.authority.clause !== undefined) authority.clause = options.authority.clause
  return {
    schemaVersion: TEST_SPEC_SCHEMA_VERSION,
    id: options.id,
    revision: options.revision,
    harness: { id: plan.harness.id, revision: plan.harness.revision },
    status: "draft",
    authority,
    testPlan: retainedPlan,
    steps: options.steps.map((option) => makeStep(planById, option))
  }
}

const copyElectricalTestStep = (step: ElectricalTestStep): ElectricalTestStep => {
  const base = draft<ElectricalTestStepTrace>({
    id: step.id,
    planType: step.planType,
    expected: step.expected,
    from: { connector: step.from.connector, pin: step.from.pin },
    to: { connector: step.to.connector, pin: step.to.pin }
  })
  if (step.net !== undefined) base.net = step.net
  switch (step.method) {
    case "continuity":
    case "four-wire-resistance":
      return { ...base, method: step.method, maxOhms: step.maxOhms }
    case "insulation-resistance": {
      const copy = draft<InsulationResistanceElectricalTestStep>({
        ...base,
        method: step.method,
        testVoltageV: step.testVoltageV,
        minOhms: step.minOhms
      })
      if (step.testVoltageToleranceV !== undefined) {
        copy.testVoltageToleranceV = step.testVoltageToleranceV
      }
      if (step.dwellSeconds !== undefined) copy.dwellSeconds = step.dwellSeconds
      if (step.rampSeconds !== undefined) copy.rampSeconds = step.rampSeconds
      return copy
    }
    case "dielectric-withstand": {
      const copy = draft<DielectricWithstandElectricalTestStep>({
        ...base,
        method: step.method,
        testVoltageV: step.testVoltageV,
        maxLeakageMilliAmps: step.maxLeakageMilliAmps,
        dwellSeconds: step.dwellSeconds,
        waveform: step.waveform
      })
      if (step.testVoltageToleranceV !== undefined) {
        copy.testVoltageToleranceV = step.testVoltageToleranceV
      }
      if (step.rampSeconds !== undefined) copy.rampSeconds = step.rampSeconds
      return copy
    }
  }
}

/** Canonical owned copy used at approval and build-record boundaries. */
export const snapshotTestSpecification = (
  specification: TestSpecification
): TestSpecification => {
  const authority = draft<TestSpecificationAuthority>({
    source: specification.authority.source
  })
  if (specification.authority.documentRevision !== undefined) {
    authority.documentRevision = specification.authority.documentRevision
  }
  if (specification.authority.clause !== undefined) {
    authority.clause = specification.authority.clause
  }
  const copy = draft<TestSpecification>({
    schemaVersion: specification.schemaVersion,
    id: specification.id,
    revision: specification.revision,
    harness: { id: specification.harness.id, revision: specification.harness.revision },
    status: specification.status,
    authority,
    testPlan: copyTestPlan(specification.testPlan),
    steps: specification.steps.map(copyElectricalTestStep)
  })
  if (specification.approval !== undefined) {
    const approval = draft<TestSpecificationApproval>({
      approvedBy: specification.approval.approvedBy,
      approvedAt: specification.approval.approvedAt
    })
    if (specification.approval.reference !== undefined) {
      approval.reference = specification.approval.reference
    }
    copy.approval = approval
  }
  return copy
}

const issue = (code: string, message: string, target?: string): Diagnostic => {
  const diagnostic = draft<Diagnostic>({ code, severity: DiagnosticSeverity.Error, message })
  if (target !== undefined) diagnostic.target = target
  return diagnostic
}

/** Validate identity, approval, numeric limits, and every retained plan trace. */
export const validateTestSpecification = (
  specification: TestSpecification
): ReadonlyArray<Diagnostic> => {
  if (specification === null || specification === undefined) {
    return [issue("HK-TEST-102", "A test specification object is required.")]
  }
  const diagnostics: Array<Diagnostic> = []
  if (specification.schemaVersion !== TEST_SPEC_SCHEMA_VERSION) {
    diagnostics.push(
      issue(
        "HK-TEST-101",
        `Test specification schema must be ${TEST_SPEC_SCHEMA_VERSION}; got ${String(specification.schemaVersion)}.`
      )
    )
  }
  if (!nonBlank(specification.id)) {
    diagnostics.push(issue("HK-TEST-102", "Test specification id is required."))
  }
  if (!nonBlank(specification.revision)) {
    diagnostics.push(issue("HK-TEST-102", "Test specification revision is required."))
  }
  if (!nonBlank(specification.harness?.id) || !nonBlank(specification.harness?.revision)) {
    diagnostics.push(issue("HK-TEST-102", "Harness id and revision are required."))
  }
  if (!nonBlank(specification.authority?.source)) {
    diagnostics.push(issue("HK-TEST-102", "Test-limit authority source is required."))
  }
  for (const [label, value] of [
    ["document revision", specification.authority?.documentRevision],
    ["clause", specification.authority?.clause]
  ] as const) {
    if (value !== undefined && !nonBlank(value)) {
      diagnostics.push(issue("HK-TEST-102", `Authority ${label} cannot be blank when present.`))
    }
  }

  const retainedPlan = specification.testPlan
  const retainedTests = Array.isArray(retainedPlan?.tests) ? retainedPlan.tests : undefined
  if (
    retainedPlan == null ||
    retainedPlan.harness?.id !== specification.harness?.id ||
    retainedPlan.harness?.revision !== specification.harness?.revision ||
    retainedTests === undefined
  ) {
    diagnostics.push(
      issue("HK-TEST-109", "The retained test plan does not match the specification harness.")
    )
  }

  if (specification.status === "approved") {
    if (
      specification.approval == null ||
      !nonBlank(specification.approval.approvedBy) ||
      !nonBlank(specification.approval.approvedAt) ||
      (specification.approval.reference !== undefined &&
        !nonBlank(specification.approval.reference))
    ) {
      diagnostics.push(
        issue(
          "HK-TEST-108",
          "An approved test specification requires a complete approver identity and timestamp."
        )
      )
    }
  } else if (specification.status === "draft") {
    if (specification.approval !== undefined) {
      diagnostics.push(issue("HK-TEST-108", "A draft test specification cannot carry an approval."))
    }
  } else {
    diagnostics.push(issue("HK-TEST-108", `Unknown approval status ${String(specification.status)}.`))
  }

  const planById = new Map<string, HarnessTest>()
  for (const test of retainedTests ?? []) {
    if (test == null) {
      diagnostics.push(issue("HK-TEST-103", "A retained plan test is missing its id."))
      continue
    }
    if (!nonBlank(test.id)) {
      diagnostics.push(issue("HK-TEST-103", "A retained plan test is missing its id."))
    } else if (planById.has(test.id)) {
      diagnostics.push(issue("HK-TEST-103", `Duplicate retained plan test id ${test.id}.`))
    } else {
      planById.set(test.id, test)
    }
  }

  const seen = new Set<string>()
  const steps = Array.isArray(specification.steps) ? specification.steps : undefined
  if (steps === undefined) {
    diagnostics.push(issue("HK-TEST-103", "Electrical test steps must be an ordered array."))
  }
  for (const step of steps ?? []) {
    if (step == null) {
      diagnostics.push(issue("HK-TEST-103", "An electrical test step is missing its id."))
      continue
    }
    const target = nonBlank(step.id) ? `test:${step.id}` : undefined
    if (!nonBlank(step.id)) {
      diagnostics.push(issue("HK-TEST-103", "An electrical test step is missing its id."))
      continue
    }
    if (seen.has(step.id)) {
      diagnostics.push(issue("HK-TEST-103", `Duplicate electrical test step id ${step.id}.`, target))
      continue
    }
    seen.add(step.id)
    const planned = planById.get(step.id)
    if (planned === undefined) {
      diagnostics.push(
        issue("HK-TEST-104", `Electrical step ${step.id} is not in the retained test plan.`, target)
      )
      continue
    }
    if (
      step.planType !== planned.type ||
      step.expected !== planned.expected ||
      !samePoint(step.from, planned.from) ||
      !samePoint(step.to, planned.to) ||
      step.net !== planned.net
    ) {
      diagnostics.push(
        issue(
          "HK-TEST-105",
          `Electrical step ${step.id} does not trace to its generated test points and net.`,
          target
        )
      )
    }

    if (!knownElectricalMethod(step.method)) {
      diagnostics.push(
        issue(
          "HK-TEST-106",
          `Electrical step ${step.id} uses unknown method ${String(step.method)}.`,
          target
        )
      )
      continue
    }

    const closedMethod = step.method === "continuity" || step.method === "four-wire-resistance"
    if ((planned.expected === "closed") !== closedMethod) {
      diagnostics.push(
        issue(
          "HK-TEST-107",
          `Electrical method ${step.method} is incompatible with generated ${planned.expected} test ${step.id}.`,
          target
        )
      )
    }

    switch (step.method) {
      case "continuity":
      case "four-wire-resistance":
        if (!positiveFinite(step.maxOhms)) {
          diagnostics.push(issue("HK-TEST-106", `${step.id} maxOhms must be positive and finite.`, target))
        }
        break
      case "insulation-resistance":
        if (!positiveFinite(step.testVoltageV) || !positiveFinite(step.minOhms)) {
          diagnostics.push(
            issue(
              "HK-TEST-106",
              `${step.id} testVoltageV and minOhms must be positive and finite.`,
              target
            )
          )
        }
        if (
          step.testVoltageToleranceV !== undefined &&
          !nonNegativeFinite(step.testVoltageToleranceV)
        ) {
          diagnostics.push(
            issue(
              "HK-TEST-106",
              `${step.id} testVoltageToleranceV must be nonnegative and finite.`,
              target
            )
          )
        }
        if (step.dwellSeconds !== undefined && !positiveFinite(step.dwellSeconds)) {
          diagnostics.push(issue("HK-TEST-106", `${step.id} dwellSeconds must be positive and finite.`, target))
        }
        if (step.rampSeconds !== undefined && !positiveFinite(step.rampSeconds)) {
          diagnostics.push(issue("HK-TEST-106", `${step.id} rampSeconds must be positive and finite.`, target))
        }
        break
      case "dielectric-withstand":
        if (
          !positiveFinite(step.testVoltageV) ||
          !positiveFinite(step.maxLeakageMilliAmps) ||
          !positiveFinite(step.dwellSeconds)
        ) {
          diagnostics.push(
            issue(
              "HK-TEST-106",
              `${step.id} voltage, leakage, and dwell limits must be positive and finite.`,
              target
            )
          )
        }
        if (
          step.testVoltageToleranceV !== undefined &&
          !nonNegativeFinite(step.testVoltageToleranceV)
        ) {
          diagnostics.push(
            issue(
              "HK-TEST-106",
              `${step.id} testVoltageToleranceV must be nonnegative and finite.`,
              target
            )
          )
        }
        if (step.rampSeconds !== undefined && !positiveFinite(step.rampSeconds)) {
          diagnostics.push(issue("HK-TEST-106", `${step.id} rampSeconds must be positive and finite.`, target))
        }
        if (step.waveform !== "ac" && step.waveform !== "dc") {
          diagnostics.push(issue("HK-TEST-106", `${step.id} waveform must be ac or dc.`, target))
        }
        break
    }
  }
  for (const id of planById.keys()) {
    if (seen.has(id)) continue
    diagnostics.push(
      issue(
        "HK-TEST-110",
        `Generated test ${id} is missing from the electrical test specification.`,
        `test:${id}`
      )
    )
  }
  return diagnostics
}

/**
 * Approve a valid draft. Invalid specifications or incomplete approvals are
 * returned unchanged, so a failed approval attempt can never create an
 * apparently approved artifact.
 */
export const approveTestSpecification = (
  specification: TestSpecification,
  approval: TestSpecificationApproval
): TestSpecification => {
  const recorded = draft<TestSpecificationApproval>({
    approvedBy: approval.approvedBy,
    approvedAt: approval.approvedAt
  })
  if (approval.reference !== undefined) recorded.reference = approval.reference
  const candidate: TestSpecification = {
    ...specification,
    status: "approved",
    approval: recorded
  }
  return validateTestSpecification(candidate).length === 0
    ? snapshotTestSpecification(candidate)
    : specification
}

/** Judge one complete measurement against one caller-authorized step. */
export const evaluateElectricalMeasurement = (
  step: ElectricalTestStep,
  measurement: Measurement
): ElectricalMeasurementVerdict => {
  if (measurement.id !== step.id) return "unassessed"
  if (!knownElectricalMethod(step.method)) return "unassessed"
  if (measurement.method !== undefined && measurement.method !== step.method) {
    return "unassessed"
  }

  if (step.method === "continuity" || step.method === "four-wire-resistance") {
    return nonNegativeFinite(measurement.measuredOhms)
      ? measurement.measuredOhms <= step.maxOhms
        ? "pass"
        : "fail"
      : "unassessed"
  }

  // Both high-voltage methods require positive applied-voltage evidence and
  // explicit safety confirmations. Missing safety evidence is not a pass;
  // an explicitly false confirmation or insufficient voltage is a failure.
  if (!positiveFinite(measurement.appliedVoltageV)) return "unassessed"
  if (!positiveFinite(step.testVoltageV)) return "unassessed"
  if (measurement.appliedWaveform === undefined) return "unassessed"
  if (measurement.interlockConfirmed === undefined || measurement.dischargeConfirmed === undefined) {
    return "unassessed"
  }
  const expectedWaveform = step.method === "insulation-resistance" ? "dc" : step.waveform
  const voltageTolerance = step.testVoltageToleranceV ?? 0
  if (!nonNegativeFinite(voltageTolerance)) return "unassessed"
  if (
    measurement.interlockConfirmed !== true ||
    measurement.dischargeConfirmed !== true ||
    measurement.appliedWaveform !== expectedWaveform ||
    Math.abs(measurement.appliedVoltageV - step.testVoltageV) > voltageTolerance
  ) {
    return "fail"
  }

  if (step.dwellSeconds !== undefined) {
    if (!positiveFinite(measurement.durationSeconds)) return "unassessed"
    if (measurement.durationSeconds < step.dwellSeconds) return "fail"
  }

  if (step.method === "insulation-resistance") {
    return nonNegativeFinite(measurement.measuredOhms)
      ? measurement.measuredOhms >= step.minOhms
        ? "pass"
        : "fail"
      : "unassessed"
  }
  return nonNegativeFinite(measurement.leakageMilliAmps)
    ? measurement.leakageMilliAmps <= step.maxLeakageMilliAmps
      ? "pass"
      : "fail"
    : "unassessed"
}

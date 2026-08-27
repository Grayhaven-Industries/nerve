// Vitest 4.1.10 — describe/it/expect confirmed against the official v4 API reference.
import { describe, expect, it } from "vitest"
import { compileDesign } from "@grayhaven/nerve"
import {
  TEST_SPEC_SCHEMA_VERSION,
  approveTestSpecification,
  createBuildRecord,
  createRelease,
  createTestSpecification,
  evaluateElectricalMeasurement,
  generateTestPlan,
  genericTesterJson,
  validateTestSpecification,
  type ElectricalTestStepOptions
} from "@grayhaven/nerve-exporters"
import motor from "../../../examples/motor-controller/src/main.harness.js"

const { hir } = compileDesign(motor)
const plan = generateTestPlan(hir)
const release = createRelease(hir, {
  eco: { id: "ECO-TEST", reason: "Authorize electrical procedure" },
  createdAt: "2026-08-27"
})
const closed = plan.tests.filter((test) => test.expected === "closed")
const open = plan.tests.filter((test) => test.expected === "open")

const stepOptions: ReadonlyArray<ElectricalTestStepOptions> = [
  { id: closed[0]!.id, method: "continuity", maxOhms: 1.25 },
  { id: closed[1]!.id, method: "four-wire-resistance", maxOhms: 0.08 },
  {
    id: open[0]!.id,
    method: "insulation-resistance",
    testVoltageV: 500,
    minOhms: 10_000_000,
    dwellSeconds: 2,
    rampSeconds: 1
  },
  {
    id: open[1]!.id,
    method: "dielectric-withstand",
    testVoltageV: 1_000,
    testVoltageToleranceV: 25,
    maxLeakageMilliAmps: 1.5,
    dwellSeconds: 3,
    rampSeconds: 1,
    waveform: "ac"
  },
  ...closed.slice(2).map((test) => ({
    id: test.id,
    method: "continuity" as const,
    maxOhms: 1.25
  })),
  ...open.slice(2).map((test) => ({
    id: test.id,
    method: "insulation-resistance" as const,
    testVoltageV: 500,
    minOhms: 10_000_000
  }))
]

const draftSpecification = () =>
  createTestSpecification(plan, {
    id: "ETS-MOTOR",
    revision: "C",
    authority: {
      source: "controlled engineering test procedure ETP-41",
      documentRevision: "C",
      clause: "7.2"
    },
    steps: stepOptions
  })

const approvedSpecification = () =>
  approveTestSpecification(draftSpecification(), {
    approvedBy: "quality-engineer-a",
    approvedAt: "2026-08-27T14:00:00Z",
    reference: "review:ETP-41-C"
  })

describe("versioned electrical test specifications", () => {
  it("copies generated trace and retains only caller-supplied method limits", () => {
    const specification = draftSpecification()

    expect(TEST_SPEC_SCHEMA_VERSION).toBe("1.0.0")
    expect(specification).toMatchObject({
      schemaVersion: "1.0.0",
      id: "ETS-MOTOR",
      revision: "C",
      harness: plan.harness,
      status: "draft",
      authority: {
        source: "controlled engineering test procedure ETP-41",
        documentRevision: "C",
        clause: "7.2"
      }
    })
    expect(specification.steps[0]).toMatchObject({
      id: closed[0]!.id,
      planType: closed[0]!.type,
      expected: "closed",
      from: closed[0]!.from,
      to: closed[0]!.to,
      method: "continuity",
      maxOhms: 1.25
    })
    expect(validateTestSpecification(specification)).toEqual([])
    expect(draftSpecification()).toEqual(specification)
  })

  it("approves only a complete, valid draft", () => {
    expect(approvedSpecification()).toMatchObject({
      status: "approved",
      approval: {
        approvedBy: "quality-engineer-a",
        approvedAt: "2026-08-27T14:00:00Z"
      }
    })

    const invalid = createTestSpecification(plan, {
      id: "ETS-BAD",
      revision: "A",
      authority: { source: "ETP-BAD" },
      steps: [{ id: closed[0]!.id, method: "continuity", maxOhms: Number.POSITIVE_INFINITY }]
    })
    expect(validateTestSpecification(invalid).map((diagnostic) => diagnostic.code)).toContain(
      "HK-TEST-106"
    )
    expect(
      approveTestSpecification(invalid, {
        approvedBy: "quality-engineer-a",
        approvedAt: "2026-08-27T14:00:00Z"
      })
    ).toBe(invalid)
    expect(
      approveTestSpecification(draftSpecification(), {
        approvedBy: "",
        approvedAt: "2026-08-27T14:00:00Z"
      }).status
    ).toBe("draft")

    const partial = createTestSpecification(plan, {
      id: "ETS-PARTIAL",
      revision: "A",
      authority: { source: "incomplete procedure" },
      steps: stepOptions.slice(0, -1)
    })
    const missingId = plan.tests.at(-1)!.id
    expect(validateTestSpecification(partial)).toContainEqual(
      expect.objectContaining({ code: "HK-TEST-110", target: `test:${missingId}` })
    )
    expect(
      approveTestSpecification(partial, {
        approvedBy: "quality-engineer-a",
        approvedAt: "2026-08-27T14:00:00Z"
      })
    ).toBe(partial)
    expect(partial.status).toBe("draft")
  })

  it("diagnoses duplicate IDs and point/test trace tampering with stable codes", () => {
    const specification = draftSpecification()
    const first = specification.steps[0]!
    const duplicate = { ...specification, steps: [first, first] }
    expect(validateTestSpecification(duplicate).map((diagnostic) => diagnostic.code)).toContain(
      "HK-TEST-103"
    )

    const tampered = {
      ...specification,
      steps: [
        { ...first, from: { connector: "J-NOT-IN-PLAN", pin: first.from.pin } },
        ...specification.steps.slice(1)
      ]
    }
    expect(validateTestSpecification(tampered).map((diagnostic) => diagnostic.code)).toContain(
      "HK-TEST-105"
    )

    const invalidTolerance = {
      ...specification,
      steps: specification.steps.map((step) =>
        step.method === "dielectric-withstand"
          ? { ...step, testVoltageToleranceV: -1 }
          : step
      )
    }
    expect(
      validateTestSpecification(invalidTolerance).map((diagnostic) => diagnostic.code)
    ).toContain("HK-TEST-106")

    // SAFETY: this deliberately injects a runtime value outside the stable
    // method union to prove serialized/mutated specifications fail closed.
    const unknownMethod = "vendor-auto" as never
    const malformedMethod = {
      ...specification,
      steps: [{ ...first, method: unknownMethod }, ...specification.steps.slice(1)]
    }
    expect(validateTestSpecification(malformedMethod).map((diagnostic) => diagnostic.code)).toContain(
      "HK-TEST-106"
    )
    expect(
      evaluateElectricalMeasurement(malformedMethod.steps[0]!, {
        id: first.id,
        measuredOhms: 0.01
      })
    ).toBe("unassessed")

    // SAFETY: a parsed JSON object can omit a statically required id; the
    // validator must diagnose that boundary value rather than throw.
    const missingId = undefined as never
    const missingStepId = {
      ...specification,
      steps: [{ ...first, id: missingId }, ...specification.steps.slice(1)]
    }
    expect(validateTestSpecification(missingStepId).map((diagnostic) => diagnostic.code)).toContain(
      "HK-TEST-103"
    )

    // SAFETY: exercise the parsed-JSON trust boundary with missing arrays.
    const missingArray = undefined as never
    const malformedStructure = {
      ...specification,
      testPlan: { harness: specification.harness, tests: missingArray },
      steps: missingArray
    }
    expect(validateTestSpecification(malformedStructure).map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["HK-TEST-109", "HK-TEST-103"])
    )
  })

  it("exports limits only when an approved specification supplies them", () => {
    const withoutAuthority = JSON.parse(
      genericTesterJson.generate(hir).files.get("tester.program.json")!
    )
    const withAuthority = JSON.parse(
      genericTesterJson
        .generate(hir, { testSpecification: approvedSpecification() })
        .files.get("tester.program.json")!
    )

    expect(withoutAuthority.steps[0]).not.toHaveProperty("maxOhms")
    expect(withoutAuthority).not.toHaveProperty("testSpecification")
    expect(withAuthority.testSpecification).toEqual({
      schemaVersion: "1.0.0",
      id: "ETS-MOTOR",
      revision: "C"
    })
    expect(withAuthority.steps.find((step: { id: string }) => step.id === closed[0]!.id)).toMatchObject(
      { method: "continuity", maxOhms: 1.25 }
    )
    expect(withAuthority.steps.find((step: { id: string }) => step.id === open[0]!.id)).toMatchObject(
      { method: "insulation-resistance", testVoltageV: 500, waveform: "dc" }
    )
    expect(withAuthority.steps.find((step: { id: string }) => step.id === open[1]!.id)).toMatchObject(
      {
        method: "dielectric-withstand",
        testVoltageV: 1_000,
        testVoltageToleranceV: 25,
        waveform: "ac"
      }
    )
  })

  it("owns generated-plan and approval snapshots", () => {
    const callerPlan = generateTestPlan(hir)
    const specification = createTestSpecification(callerPlan, {
      id: "ETS-SNAPSHOT",
      revision: "A",
      authority: { source: "snapshot procedure" },
      steps: stepOptions
    })
    const created = JSON.stringify(specification)
    Object.assign(callerPlan.harness, { id: "mutated-after-create" })
    Object.assign(callerPlan.tests[0]!.from, { connector: "MUTATED" })
    expect(JSON.stringify(specification)).toBe(created)

    const approved = approveTestSpecification(specification, {
      approvedBy: "quality-a",
      approvedAt: "2026-08-27T16:00:00Z"
    })
    const approvedBytes = JSON.stringify(approved)
    Object.assign(specification.authority, { source: "mutated-after-approval" })
    Object.assign(specification.testPlan.harness, { id: "mutated-after-approval" })
    Object.assign(specification.steps[0]!.from, { connector: "MUTATED-AGAIN" })
    expect(JSON.stringify(approved)).toBe(approvedBytes)
  })
})

describe("method-specific electrical judgments", () => {
  const steps = approvedSpecification().steps

  it("judges continuity and four-wire resistance against their explicit maxima", () => {
    expect(evaluateElectricalMeasurement(steps[0]!, { id: steps[0]!.id, measuredOhms: 1.2 })).toBe(
      "pass"
    )
    expect(evaluateElectricalMeasurement(steps[0]!, { id: steps[0]!.id, measuredOhms: 1.3 })).toBe(
      "fail"
    )
    expect(
      evaluateElectricalMeasurement(steps[1]!, {
        id: steps[1]!.id,
        method: "four-wire-resistance",
        measuredOhms: 0.081
      })
    ).toBe("fail")
  })

  it("requires an explicit method for every non-legacy electrical procedure", () => {
    expect(
      evaluateElectricalMeasurement(steps[1]!, {
        id: steps[1]!.id,
        measuredOhms: 0.01
      })
    ).toBe("unassessed")
    expect(
      evaluateElectricalMeasurement(steps[2]!, {
        id: steps[2]!.id,
        measuredOhms: 20_000_000,
        appliedVoltageV: 500,
        appliedWaveform: "dc",
        durationSeconds: 2,
        interlockConfirmed: true,
        dischargeConfirmed: true
      })
    ).toBe("unassessed")
    expect(
      evaluateElectricalMeasurement(steps[3]!, {
        id: steps[3]!.id,
        leakageMilliAmps: 1.4,
        appliedVoltageV: 1_000,
        appliedWaveform: "ac",
        durationSeconds: 3,
        interlockConfirmed: true,
        dischargeConfirmed: true
      })
    ).toBe("unassessed")
  })

  it("requires voltage, dwell, interlock, and discharge evidence for HV methods", () => {
    const insulation = {
      id: steps[2]!.id,
      method: "insulation-resistance" as const,
      measuredOhms: 20_000_000,
      appliedVoltageV: 500,
      appliedWaveform: "dc" as const,
      durationSeconds: 2,
      interlockConfirmed: true,
      dischargeConfirmed: true
    }
    expect(evaluateElectricalMeasurement(steps[2]!, insulation)).toBe("pass")
    expect(
      evaluateElectricalMeasurement(steps[2]!, { ...insulation, appliedVoltageV: 501 })
    ).toBe("fail")
    expect(
      evaluateElectricalMeasurement(steps[2]!, { ...insulation, appliedWaveform: "ac" })
    ).toBe("fail")
    expect(
      evaluateElectricalMeasurement(steps[2]!, {
        id: insulation.id,
        method: insulation.method,
        measuredOhms: insulation.measuredOhms,
        appliedVoltageV: insulation.appliedVoltageV,
        durationSeconds: insulation.durationSeconds,
        interlockConfirmed: insulation.interlockConfirmed,
        dischargeConfirmed: insulation.dischargeConfirmed
      })
    ).toBe("unassessed")
    expect(
      evaluateElectricalMeasurement(steps[2]!, { ...insulation, measuredOhms: 9_000_000 })
    ).toBe("fail")
    expect(
      evaluateElectricalMeasurement(steps[2]!, {
        id: insulation.id,
        method: insulation.method,
        measuredOhms: insulation.measuredOhms,
        appliedVoltageV: insulation.appliedVoltageV,
        appliedWaveform: insulation.appliedWaveform,
        durationSeconds: insulation.durationSeconds,
        interlockConfirmed: insulation.interlockConfirmed
      })
    ).toBe("unassessed")

    const dielectric = {
      id: steps[3]!.id,
      method: "dielectric-withstand" as const,
      leakageMilliAmps: 1.4,
      appliedVoltageV: 1_000,
      appliedWaveform: "ac" as const,
      durationSeconds: 3,
      interlockConfirmed: true,
      dischargeConfirmed: true
    }
    expect(evaluateElectricalMeasurement(steps[3]!, dielectric)).toBe("pass")
    expect(
      evaluateElectricalMeasurement(steps[3]!, { ...dielectric, appliedVoltageV: 1_025 })
    ).toBe("pass")
    expect(
      evaluateElectricalMeasurement(steps[3]!, { ...dielectric, appliedVoltageV: 1_026 })
    ).toBe("fail")
    expect(
      evaluateElectricalMeasurement(steps[3]!, { ...dielectric, appliedWaveform: "dc" })
    ).toBe("fail")
    expect(
      evaluateElectricalMeasurement(steps[3]!, {
        id: dielectric.id,
        method: dielectric.method,
        leakageMilliAmps: dielectric.leakageMilliAmps,
        appliedVoltageV: dielectric.appliedVoltageV,
        durationSeconds: dielectric.durationSeconds,
        interlockConfirmed: dielectric.interlockConfirmed,
        dischargeConfirmed: dielectric.dischargeConfirmed
      })
    ).toBe("unassessed")
    expect(
      evaluateElectricalMeasurement(steps[3]!, { ...dielectric, leakageMilliAmps: 1.6 })
    ).toBe("fail")
    expect(
      evaluateElectricalMeasurement(steps[3]!, { ...dielectric, interlockConfirmed: false })
    ).toBe("fail")
    // SAFETY: malformed serialized evidence is injected intentionally to
    // prove truthy non-boolean values cannot satisfy an HV safety gate.
    const malformedConfirmation = "true" as never
    expect(
      evaluateElectricalMeasurement(steps[3]!, {
        ...dielectric,
        interlockConfirmed: malformedConfirmation
      })
    ).toBe("fail")
  })

  it("keeps absent, draft, invalid, mismatched, and unapproved-HV results unassessed", () => {
    const measurement = { id: steps[0]!.id, measuredOhms: 0.01 }
    const noSpecification = createBuildRecord(hir, release, [measurement], {
      serial: "SN-UNAUTHORIZED",
      operator: "tech-a",
      buildDate: "2026-08-27"
    })
    const draft = createBuildRecord(hir, release, [measurement], {
      serial: "SN-DRAFT",
      operator: "tech-a",
      buildDate: "2026-08-27",
      testSpecification: draftSpecification()
    })
    const approved = createBuildRecord(hir, release, [measurement], {
      serial: "SN-APPROVED",
      operator: "tech-a",
      buildDate: "2026-08-27",
      testSpecification: approvedSpecification()
    })
    const authorized = approvedSpecification()
    const invalidSpecification = {
      ...authorized,
      steps: authorized.steps.map((step, index) =>
        index === 0 && step.method === "continuity"
          ? { ...step, maxOhms: Number.POSITIVE_INFINITY }
          : step
      )
    }
    const invalid = createBuildRecord(hir, release, [measurement], {
      serial: "SN-INVALID",
      operator: "tech-a",
      buildDate: "2026-08-27",
      testSpecification: invalidSpecification
    })
    const otherPlan = {
      ...plan,
      harness: { id: "different-harness", revision: "Z" }
    }
    const mismatchedSpecification = approveTestSpecification(
      createTestSpecification(otherPlan, {
        id: "ETS-OTHER",
        revision: "A",
        authority: { source: "procedure for a different harness" },
        steps: stepOptions
      }),
      { approvedBy: "quality-a", approvedAt: "2026-08-27T15:00:00Z" }
    )
    const mismatched = createBuildRecord(hir, release, [measurement], {
      serial: "SN-MISMATCH",
      operator: "tech-a",
      buildDate: "2026-08-27",
      testSpecification: mismatchedSpecification
    })
    const staleRelease = createBuildRecord({ ...hir, labels: [] }, release, [measurement], {
      serial: "SN-STALE-RELEASE",
      operator: "tech-a",
      buildDate: "2026-08-27",
      testSpecification: approvedSpecification()
    })
    const hvMeasurement = {
      id: steps[2]!.id,
      method: "insulation-resistance" as const,
      measuredOhms: 20_000_000,
      appliedVoltageV: 500,
      appliedWaveform: "dc" as const,
      durationSeconds: 2,
      interlockConfirmed: true,
      dischargeConfirmed: true
    }
    const unapprovedHv = createBuildRecord(hir, release, [hvMeasurement], {
      serial: "SN-HV-DRAFT",
      operator: "tech-a",
      buildDate: "2026-08-27",
      testSpecification: draftSpecification()
    })

    expect(noSpecification.results.find((result) => result.id === measurement.id)?.verdict).toBe(
      "unassessed"
    )
    expect(draft.results.find((result) => result.id === measurement.id)?.verdict).toBe(
      "unassessed"
    )
    expect(invalid.results.find((result) => result.id === measurement.id)?.verdict).toBe(
      "unassessed"
    )
    expect(mismatched.results.find((result) => result.id === measurement.id)?.verdict).toBe(
      "unassessed"
    )
    expect(staleRelease.results.find((result) => result.id === measurement.id)?.verdict).toBe(
      "unassessed"
    )
    expect(unapprovedHv.results.find((result) => result.id === hvMeasurement.id)?.verdict).toBe(
      "unassessed"
    )
    expect(approved.results.find((result) => result.id === measurement.id)?.verdict).toBe("pass")
    expect(noSpecification.summary.unassessed).toBe(1)
    expect(noSpecification.summary.status).toBe("incomplete")
  })

  it("leaves duplicate measurement IDs unassessed independent of input order", () => {
    const passing = { id: steps[0]!.id, measuredOhms: 0.01 }
    const failing = { id: steps[0]!.id, measuredOhms: 99 }
    const options = {
      serial: "SN-DUPLICATE",
      operator: "tech-a",
      buildDate: "2026-08-27",
      testSpecification: approvedSpecification()
    }
    const forward = createBuildRecord(hir, release, [passing, failing], options)
    const reversed = createBuildRecord(hir, release, [failing, passing], options)

    expect(forward.results.find((result) => result.id === passing.id)?.verdict).toBe("unassessed")
    expect(reversed).toEqual(forward)
  })

  it("fails closed instead of copying a malformed serialized specification", () => {
    // SAFETY: parsed JSON may violate the static contract; this deliberately
    // removes a required nested object to exercise the build-record boundary.
    const missingAuthority = null as never
    const malformed = { ...approvedSpecification(), authority: missingAuthority }
    const measurement = { id: steps[0]!.id, measuredOhms: 0.01 }
    const record = createBuildRecord(hir, release, [measurement], {
      serial: "SN-MALFORMED-SPEC",
      operator: "tech-a",
      buildDate: "2026-08-27",
      testSpecification: malformed
    })

    expect(record.testSpecification).toBeUndefined()
    expect(record.results.find((result) => result.id === measurement.id)?.verdict).toBe(
      "unassessed"
    )

    // SAFETY: top-level JSON null is likewise outside the static contract.
    const nullSpecification = null as never
    const nullRecord = createBuildRecord(hir, release, [measurement], {
      serial: "SN-NULL-SPEC",
      operator: "tech-a",
      buildDate: "2026-08-27",
      testSpecification: nullSpecification
    })
    expect(nullRecord.testSpecification).toBeUndefined()
    expect(nullRecord.results.find((result) => result.id === measurement.id)?.verdict).toBe(
      "unassessed"
    )
  })

  it("owns specification and evidence snapshots in build records", () => {
    const specification = approvedSpecification()
    const measurement = { id: steps[0]!.id, measuredOhms: 0.5 }
    const materialLots = { terminal: "LOT-A" }
    const crimp = {
      id: "CR-SNAPSHOT",
      wire: "W1",
      endpoint: { connector: "J1", pin: "1" },
      terminal: "43030-0007",
      timestamp: "2026-08-27T16:30:00Z",
      operator: "tech-a",
      verdict: "pass" as const
    }
    const record = createBuildRecord(hir, release, [measurement], {
      serial: "SN-SNAPSHOT",
      operator: "tech-a",
      buildDate: "2026-08-27",
      materialLots,
      crimpEvidence: [crimp],
      testSpecification: specification
    })
    const bytes = JSON.stringify(record)

    Object.assign(specification.authority, { source: "mutated" })
    Object.assign(specification.testPlan.harness, { id: "mutated" })
    Object.assign(specification.steps[0]!.from, { connector: "mutated" })
    Object.assign(measurement, { measuredOhms: 99 })
    Object.assign(materialLots, { terminal: "LOT-MUTATED" })
    Object.assign(crimp.endpoint, { connector: "mutated" })
    Object.assign(crimp, { verdict: "fail" })

    expect(record.recordVersion).toBe("0.2.0")
    expect(JSON.stringify(record)).toBe(bytes)
  })
})

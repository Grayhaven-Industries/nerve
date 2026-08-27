import { describe, expect, it } from "vitest"

import {
  appendShopFloorEvent,
  createWorkOrder,
  fingerprint,
  memoryStore,
  replayUnitBuild,
  serializeUnitBuild,
  ShopFloorCodes,
  startUnitBuild,
  workOrderProgress,
  type Canonical,
  type ShopFloorEvent,
  type ShopStep,
  type StepEvidence,
  type UnitBuildState,
  type WorkOrder,
  type WorkOrderInput
} from "@grayhaven/nerve-platform"

const releasedFingerprint = `sha256:${"a".repeat(64)}`

const makeWorkOrder = (quantity = 2): WorkOrder =>
  createWorkOrder({
    id: "WO-100",
    harnessId: "motor-harness",
    releaseId: "REL-A",
    hirFingerprint: releasedFingerprint,
    quantity,
    configuration: { variant: "left-hand" },
    options: { manufacturingLot: "LOT-9" },
    stations: [
      {
        id: "wire-prep",
        name: "Wire preparation",
        steps: [
          {
            id: "pick",
            stationId: "wire-prep",
            kind: "material-pick",
            instruction: "Scan the released wire lot.",
            revision: "A",
            prerequisiteStepIds: [],
            requiredEvidenceKinds: ["operator", "material-lot"],
            failureBlocksDownstream: true
          },
          {
            id: "crimp",
            stationId: "wire-prep",
            kind: "crimp",
            instruction: "Crimp terminal and record height.",
            revision: "A",
            prerequisiteStepIds: ["pick"],
            requiredEvidenceKinds: ["tool-calibration", "measurement"],
            failureBlocksDownstream: true
          }
        ]
      },
      {
        id: "qa",
        steps: [
          {
            id: "test",
            stationId: "qa",
            kind: "electrical-test",
            instruction: "Run released continuity program.",
            revision: "A",
            prerequisiteStepIds: ["crimp"],
            requiredEvidenceKinds: ["electrical-test", "attachment"],
            failureBlocksDownstream: true
          }
        ]
      }
    ]
  })

const makeLinearWorkOrder = (quantity = 2): WorkOrder =>
  createWorkOrder({
    id: "WO-100",
    harnessId: "motor-harness",
    releaseId: "REL-A",
    hirFingerprint: releasedFingerprint,
    quantity,
    stations: [
      {
        id: "linear",
        steps: [
          {
            id: "A",
            stationId: "linear",
            kind: "custom",
            instruction: "Complete A.",
            revision: "A",
            prerequisiteStepIds: [],
            requiredEvidenceKinds: [],
            failureBlocksDownstream: true
          },
          {
            id: "B",
            stationId: "linear",
            kind: "custom",
            instruction: "Complete B.",
            revision: "A",
            prerequisiteStepIds: ["A"],
            requiredEvidenceKinds: [],
            failureBlocksDownstream: true
          },
          {
            id: "C",
            stationId: "linear",
            kind: "custom",
            instruction: "Complete C.",
            revision: "A",
            prerequisiteStepIds: ["B"],
            requiredEvidenceKinds: [],
            failureBlocksDownstream: true
          }
        ]
      }
    ]
  })

const makeElectricalWorkOrder = (): WorkOrder =>
  createWorkOrder({
    id: "WO-100",
    harnessId: "motor-harness",
    releaseId: "REL-A",
    hirFingerprint: releasedFingerprint,
    quantity: 1,
    stations: [
      {
        id: "qa",
        steps: [
          {
            id: "test",
            stationId: "qa",
            kind: "electrical-test",
            instruction: "Test",
            revision: "A",
            prerequisiteStepIds: [],
            requiredEvidenceKinds: ["electrical-test"],
            failureBlocksDownstream: true
          }
        ]
      }
    ]
  })

const at = (second: number): string => `2026-08-27T15:00:${String(second).padStart(2, "0")}Z`

const common = (id: string, second: number, serial = "SN-001") => ({
  id,
  timestamp: at(second),
  actor: "operator-a",
  workOrderId: "WO-100",
  serial
})

const evidenceEvent = (
  id: string,
  second: number,
  stepId: string,
  evidence: StepEvidence,
  serial = "SN-001"
): ShopFloorEvent => ({
  type: "step-evidence-recorded",
  ...common(id, second, serial),
  stepId,
  evidence
})

const operatorEvidence = (id: string, second: number): StepEvidence => ({
  kind: "operator",
  id,
  timestamp: at(second),
  operatorId: "operator-a"
})

const started = (serial = "SN-001", id = "evt-start"): ShopFloorEvent => ({
  type: "unit-started",
  ...common(id, 0, serial),
  serial,
  hirFingerprint: releasedFingerprint,
  releaseId: "REL-A"
})

const happyEvents = (serial = "SN-001"): ReadonlyArray<ShopFloorEvent> => [
  started(serial, `${serial}-start`),
  evidenceEvent(
    `${serial}-operator`,
    1,
    "pick",
    { ...operatorEvidence(`${serial}-operator-scan`, 1) },
    serial
  ),
  evidenceEvent(
    `${serial}-lot`,
    2,
    "pick",
    {
      kind: "material-lot",
      id: `${serial}-lot-scan`,
      timestamp: at(2),
      materialId: "WIRE-20-RD",
      lotId: "WIRE-LOT-44",
      supplierLotId: "SUP-991"
    },
    serial
  ),
  { type: "step-completed", ...common(`${serial}-pick-done`, 3, serial), stepId: "pick" },
  evidenceEvent(
    `${serial}-tool`,
    4,
    "crimp",
    {
      kind: "tool-calibration",
      id: `${serial}-tool-scan`,
      timestamp: at(4),
      toolId: "PRESS-7",
      calibrationId: "CAL-2026-08",
      calibrationStatus: "current",
      calibrationExpiresAt: "2026-09-01T00:00:00Z"
    },
    serial
  ),
  evidenceEvent(
    `${serial}-height`,
    5,
    "crimp",
    {
      kind: "measurement",
      id: `${serial}-height-reading`,
      timestamp: at(5),
      value: 1.42,
      units: "mm",
      requirementRef: "REL-A#crimp-height-20awg"
    },
    serial
  ),
  { type: "step-completed", ...common(`${serial}-crimp-done`, 6, serial), stepId: "crimp" },
  evidenceEvent(
    `${serial}-test-result`,
    7,
    "test",
    {
      kind: "electrical-test",
      id: `${serial}-test-scan`,
      timestamp: at(7),
      specificationRef: "REL-A#continuity-v3",
      resultRef: `result:${serial}`,
      rawResultRef: `blob:sha256:${"b".repeat(64)}`,
      verdict: "pass",
      testerId: "TESTER-2",
      testProgramVersion: "3.0.1"
    },
    serial
  ),
  evidenceEvent(
    `${serial}-attachment`,
    8,
    "test",
    {
      kind: "attachment",
      id: `${serial}-attachment-scan`,
      timestamp: at(8),
      attachmentId: `report-${serial}.pdf`,
      contentHash: `sha256:${"c".repeat(64)}`,
      mediaType: "application/pdf"
    },
    serial
  ),
  { type: "step-completed", ...common(`${serial}-test-done`, 9, serial), stepId: "test" },
  {
    type: "unit-closed",
    ...common(`${serial}-close`, 10, serial),
    finalApprovalRef: "QA-APPROVAL-9"
  }
]

const stateOf = (result: ReturnType<typeof replayUnitBuild>): UnitBuildState => {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.problems.map((problem) => problem.message).join("\n"))
  return result.state
}

describe("shop-floor execution", () => {
  it("rejects work orders without a nonempty manufacturing route", () => {
    const required = {
      id: "WO-EMPTY",
      harnessId: "motor-harness",
      releaseId: "REL-A",
      hirFingerprint: releasedFingerprint,
      quantity: 1
    }
    expect(() => createWorkOrder({ ...required, stations: [] })).toThrow(
      `${ShopFloorCodes.InvalidWorkOrder}: A work order requires at least one station`
    )
    expect(() =>
      createWorkOrder({
        ...required,
        stations: [{ id: "empty-station", steps: [] }]
      })
    ).toThrow(`${ShopFloorCodes.InvalidWorkOrder}: Station empty-station requires at least one route step`)
  })

  it("runs a released unit across two stations and retains its full genealogy", () => {
    const workOrder = makeWorkOrder()
    const state = stateOf(replayUnitBuild(workOrder, "SN-001", happyEvents()))

    expect(state.status).toBe("closed")
    expect(state.cycleDurationMs).toBe(10_000)
    expect(state.stations.map((station) => [station.id, station.status])).toEqual([
      ["wire-prep", "passed"],
      ["qa", "passed"]
    ])
    expect(state.materialLots[0]).toMatchObject({
      materialId: "WIRE-20-RD",
      lotId: "WIRE-LOT-44",
      supplierLotId: "SUP-991"
    })
    expect(state.tools[0]).toMatchObject({ toolId: "PRESS-7", calibrationId: "CAL-2026-08" })
    expect(state.operatorIds).toEqual(["operator-a"])
    expect(state.specificationRefs).toEqual([
      "REL-A#continuity-v3",
      "REL-A#crimp-height-20awg"
    ])
    expect(state.resultRefs).toEqual([
      `blob:sha256:${"b".repeat(64)}`,
      "result:SN-001"
    ])
    expect(state.releaseId).toBe("REL-A")
    expect(state.hirFingerprint).toBe(releasedFingerprint)
  })

  it("refuses a start against any fingerprint other than the released HIR", () => {
    const result = startUnitBuild(makeWorkOrder(), {
      id: "wrong-release-start",
      timestamp: at(0),
      actor: "operator-a",
      serial: "SN-BAD",
      hirFingerprint: `sha256:${"0".repeat(64)}`,
      builds: []
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected fingerprint refusal")
    expect(result.problems[0]?.code).toBe(ShopFloorCodes.FingerprintMismatch)
  })

  it("blocks evidence and completion until prerequisite steps have passed", () => {
    const events: ReadonlyArray<ShopFloorEvent> = [
      started(),
      evidenceEvent("early-tool", 1, "crimp", {
        kind: "tool-calibration",
        id: "early-tool-scan",
        timestamp: at(1),
        toolId: "PRESS-7",
        calibrationId: "CAL-1"
      })
    ]
    const result = replayUnitBuild(makeWorkOrder(), "SN-001", events)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected prerequisite refusal")
    expect(result.problems[0]).toMatchObject({
      code: ShopFloorCodes.PrerequisiteIncomplete,
      stepId: "crimp",
      relatedId: "pick"
    })
  })

  it("rejects unknown steps and events crossing serial or work-order boundaries", () => {
    const workOrder = makeWorkOrder()
    const unknownStep = appendShopFloorEvent(workOrder, [started()], {
      type: "step-completed",
      ...common("unknown-step", 1),
      stepId: "does-not-exist"
    })
    expect(unknownStep.ok).toBe(false)
    if (unknownStep.ok) throw new Error("expected unknown-step refusal")
    expect(unknownStep.problems[0]?.code).toBe(ShopFloorCodes.UnknownStep)

    const wrongSerial = appendShopFloorEvent(workOrder, [started()], {
      type: "step-completed",
      ...common("wrong-serial", 1, "SN-OTHER"),
      stepId: "pick"
    })
    expect(wrongSerial.ok).toBe(false)
    if (wrongSerial.ok) throw new Error("expected serial-boundary refusal")
    expect(wrongSerial.problems[0]).toMatchObject({
      code: ShopFloorCodes.WrongSerial,
      eventId: "wrong-serial"
    })

    const wrongWorkOrder: ShopFloorEvent = {
      type: "step-completed",
      ...common("wrong-work-order", 1),
      workOrderId: "WO-OTHER",
      stepId: "pick"
    }
    const crossedOrder = appendShopFloorEvent(workOrder, [started()], wrongWorkOrder)
    expect(crossedOrder.ok).toBe(false)
    if (crossedOrder.ok) throw new Error("expected work-order-boundary refusal")
    expect(crossedOrder.problems[0]).toMatchObject({
      code: ShopFloorCodes.WrongWorkOrder,
      eventId: "wrong-work-order"
    })
  })

  it("fails closed for unknown event types and unreadable evidence payloads", () => {
    // SAFETY: this value intentionally models serialized input that bypassed
    // the TypeScript DTO so replay can prove its discriminator is exhaustive.
    const futureEventType = "future-event" as never
    // SAFETY: this value intentionally models a serialized null payload that
    // bypassed the TypeScript DTO so replay can prove it fails closed.
    const unreadableEvidence = null as never
    const futureEvent: ShopFloorEvent = {
      type: futureEventType,
      ...common("future-event", 1)
    }
    const unknownFirst = replayUnitBuild(makeLinearWorkOrder(), "SN-001", [futureEvent])
    expect(unknownFirst.ok).toBe(false)
    if (unknownFirst.ok) throw new Error("expected first-event type refusal")
    expect(unknownFirst.problems[0]).toMatchObject({
      code: ShopFloorCodes.InvalidEvent,
      eventId: "future-event"
    })

    const unknownType = replayUnitBuild(makeLinearWorkOrder(), "SN-001", [
      started(),
      futureEvent
    ])
    expect(unknownType.ok).toBe(false)
    if (unknownType.ok) throw new Error("expected unknown event-type refusal")
    expect(unknownType.problems[0]).toMatchObject({
      code: ShopFloorCodes.InvalidEvent,
      eventId: "future-event"
    })

    const malformedEvidence: ShopFloorEvent = {
      type: "step-evidence-recorded",
      ...common("null-evidence", 1),
      stepId: "A",
      evidence: unreadableEvidence
    }
    const invalidPayload = replayUnitBuild(makeLinearWorkOrder(), "SN-001", [
      started(),
      malformedEvidence
    ])
    expect(invalidPayload.ok).toBe(false)
    if (invalidPayload.ok) throw new Error("expected unreadable evidence refusal")
    expect(invalidPayload.problems[0]).toMatchObject({
      code: ShopFloorCodes.InvalidEvent,
      eventId: "null-evidence"
    })
  })

  it("refuses completion when a required operator or material scan is missing", () => {
    const noScans: ReadonlyArray<ShopFloorEvent> = [
      started(),
      { type: "step-completed", ...common("pick-too-soon", 1), stepId: "pick" }
    ]
    const result = replayUnitBuild(makeWorkOrder(), "SN-001", noScans)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected missing evidence refusal")
    expect(result.problems.map((problem) => [problem.code, problem.evidenceKind])).toEqual([
      [ShopFloorCodes.MissingEvidence, "operator"],
      [ShopFloorCodes.MissingEvidence, "material-lot"]
    ])
  })

  it.each([
    ["an explicit expired status", { calibrationStatus: "expired" as const }],
    ["a missing status", {}],
    [
      "an expiry before step completion",
      { calibrationStatus: "current" as const, calibrationExpiresAt: at(5) }
    ]
  ])("refuses passing completion with %s on required tool calibration", (_label, calibration) => {
    const result = replayUnitBuild(makeWorkOrder(), "SN-001", [
      ...happyEvents().slice(0, 4),
      evidenceEvent("calibration-event", 4, "crimp", {
        kind: "tool-calibration",
        id: "calibration-evidence",
        timestamp: at(4),
        toolId: "PRESS-7",
        calibrationId: "CAL-EXPIRED",
        ...calibration
      }),
      evidenceEvent("measurement-event", 5, "crimp", {
        kind: "measurement",
        id: "measurement-evidence",
        timestamp: at(5),
        value: 1.42,
        units: "mm",
        requirementRef: "REL-A#crimp-height-20awg"
      }),
      { type: "step-completed", ...common("crimp-complete", 6), stepId: "crimp" }
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected invalid calibration refusal")
    expect(result.problems[0]).toMatchObject({
      code: ShopFloorCodes.InvalidEvidence,
      stepId: "crimp",
      evidenceKind: "tool-calibration"
    })
  })

  it.each([
    "2026-02-30T00:00:00Z",
    "2025-02-29T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-12-01T24:00:00Z"
  ])("rejects impossible calibration expiry %s", (calibrationExpiresAt) => {
    const result = replayUnitBuild(makeWorkOrder(), "SN-001", [
      ...happyEvents().slice(0, 4),
      evidenceEvent("invalid-expiry-event", 4, "crimp", {
        kind: "tool-calibration",
        id: "invalid-expiry-evidence",
        timestamp: at(4),
        toolId: "PRESS-7",
        calibrationId: "CAL-INVALID-DATE",
        calibrationStatus: "current",
        calibrationExpiresAt
      })
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected invalid expiry refusal")
    expect(result.problems[0]).toMatchObject({
      code: ShopFloorCodes.InvalidEvidence,
      evidenceKind: "tool-calibration"
    })
  })

  it.each(["fail", "unassessed"] as const)(
    "retains a %s electrical result but refuses to complete the required test step",
    (verdict) => {
      const workOrder = makeElectricalWorkOrder()
      const failedEvidence = evidenceEvent("result-event", 1, "test", {
        kind: "electrical-test",
        id: "result-evidence",
        timestamp: at(1),
        specificationRef: "REL-A#continuity-v3",
        resultRef: "result:failed",
        rawResultRef: "blob:failed",
        verdict
      })
      const recorded = replayUnitBuild(workOrder, "SN-001", [started(), failedEvidence])
      expect(recorded.ok).toBe(true)
      if (!recorded.ok) throw new Error("the physical observation must be retained")
      expect(recorded.state.steps[0]?.evidence[0]).toMatchObject({ verdict })

      const completed = appendShopFloorEvent(workOrder, recorded.state.events, {
        type: "step-completed",
        ...common("complete-failed-test", 2),
        stepId: "test"
      })
      expect(completed.ok).toBe(false)
      if (completed.ok) throw new Error("expected failed test gate")
      expect(completed.problems[0]?.code).toBe(ShopFloorCodes.ElectricalTestNotPassed)
    }
  )

  it.each(["fail", "unassessed"] as const)(
    "completes a required electrical-test step as failed from a %s verdict",
    (verdict) => {
      const result = replayUnitBuild(makeElectricalWorkOrder(), "SN-001", [
        started(),
        evidenceEvent("failed-result-event", 1, "test", {
          kind: "electrical-test",
          id: "failed-result-evidence",
          timestamp: at(1),
          specificationRef: "REL-A#continuity-v3",
          resultRef: `result:${verdict}`,
          rawResultRef: `blob:${verdict}`,
          verdict
        }),
        {
          type: "step-completed",
          ...common("complete-as-failed", 2),
          stepId: "test",
          outcome: "fail"
        }
      ])
      const state = stateOf(result)
      expect(state.steps[0]).toMatchObject({ status: "failed", attempt: 1 })
    }
  )

  it("retains fail evidence through deviation, rework, reopen, and passing verification", () => {
    const events: ReadonlyArray<ShopFloorEvent> = [
      started(),
      evidenceEvent("test-fail-event", 1, "test", {
        kind: "electrical-test",
        id: "test-fail-evidence",
        timestamp: at(1),
        specificationRef: "REL-A#continuity-v3",
        resultRef: "result:failed",
        rawResultRef: "blob:failed",
        verdict: "fail"
      }),
      {
        type: "step-completed",
        ...common("test-failed", 2),
        stepId: "test",
        outcome: "fail"
      },
      {
        type: "deviation-opened",
        ...common("electrical-dev-open", 3),
        deviationId: "DEV-ELECTRICAL",
        stepId: "test",
        reason: "Continuity result exceeded the approved limit."
      },
      {
        type: "deviation-dispositioned",
        ...common("electrical-dev-disposition", 4),
        deviationId: "DEV-ELECTRICAL",
        disposition: "rework-required",
        rationale: "Repair the termination and repeat the released test."
      },
      {
        type: "rework-recorded",
        ...common("electrical-rework", 5),
        reworkId: "RW-ELECTRICAL",
        deviationId: "DEV-ELECTRICAL",
        stepId: "test",
        description: "Replaced the failed termination."
      },
      {
        type: "step-reopened",
        ...common("electrical-reopen", 6),
        stepId: "test",
        deviationId: "DEV-ELECTRICAL",
        reworkId: "RW-ELECTRICAL",
        reason: "Verify the repaired termination."
      },
      evidenceEvent("test-pass-event", 7, "test", {
        kind: "electrical-test",
        id: "test-pass-evidence",
        timestamp: at(7),
        specificationRef: "REL-A#continuity-v3",
        resultRef: "result:passed",
        rawResultRef: "blob:passed",
        verdict: "pass"
      }),
      { type: "step-completed", ...common("test-passed", 8), stepId: "test" },
      { type: "unit-closed", ...common("test-unit-close", 9) }
    ]

    const state = stateOf(replayUnitBuild(makeElectricalWorkOrder(), "SN-001", events))
    expect(state.status).toBe("closed")
    expect(state.steps[0]).toMatchObject({ status: "passed", attempt: 2 })
    expect(
      state.steps[0]?.evidence.map((evidence) =>
        evidence.kind === "electrical-test" ? evidence.verdict : evidence.kind
      )
    ).toEqual(["fail", "pass"])
    expect(state.rework[0]).toMatchObject({
      id: "RW-ELECTRICAL",
      status: "resolved",
      resolvedEventId: "test-passed"
    })
  })

  it("requires rework to be reopened, re-evidenced, and passed before close", () => {
    const workOrder = createWorkOrder({
      id: "WO-100",
      harnessId: "motor-harness",
      releaseId: "REL-A",
      hirFingerprint: releasedFingerprint,
      quantity: 1,
      stations: [
        {
          id: "qa",
          steps: [
            {
              id: "inspect",
              stationId: "qa",
              kind: "inspect",
              instruction: "Inspect label placement.",
              revision: "A",
              prerequisiteStepIds: [],
              requiredEvidenceKinds: ["operator"],
              failureBlocksDownstream: true
            }
          ]
        }
      ]
    })
    const beforeReopen: ReadonlyArray<ShopFloorEvent> = [
      started(),
      evidenceEvent("inspect-op-1", 1, "inspect", operatorEvidence("inspect-scan-1", 1)),
      { type: "step-completed", ...common("inspect-done-1", 2), stepId: "inspect" },
      {
        type: "deviation-opened",
        ...common("dev-open", 3),
        deviationId: "DEV-1",
        stepId: "inspect",
        reason: "Label is 5 mm out of position."
      },
      {
        type: "deviation-dispositioned",
        ...common("dev-disposition", 4),
        deviationId: "DEV-1",
        disposition: "rework-required",
        rationale: "Replace the label to released drawing."
      },
      {
        type: "rework-recorded",
        ...common("rework-record", 5),
        reworkId: "RW-1",
        deviationId: "DEV-1",
        stepId: "inspect",
        description: "Removed and replaced label."
      }
    ]
    const blockedClose = replayUnitBuild(workOrder, "SN-001", [
      ...beforeReopen,
      { type: "unit-closed", ...common("too-early-close", 6) }
    ])
    expect(blockedClose.ok).toBe(false)
    if (blockedClose.ok) throw new Error("expected unresolved rework")
    expect(blockedClose.problems.some((problem) => problem.code === ShopFloorCodes.UnresolvedRework)).toBe(true)

    const completeLog: ReadonlyArray<ShopFloorEvent> = [
      ...beforeReopen,
      {
        type: "step-reopened",
        ...common("inspect-reopen", 6),
        stepId: "inspect",
        reworkId: "RW-1",
        deviationId: "DEV-1",
        reason: "Verify replacement label."
      },
      evidenceEvent("inspect-op-2", 7, "inspect", operatorEvidence("inspect-scan-2", 7)),
      { type: "step-completed", ...common("inspect-done-2", 8), stepId: "inspect" },
      { type: "unit-closed", ...common("close-after-rework", 9) }
    ]
    const state = stateOf(replayUnitBuild(workOrder, "SN-001", completeLog))
    expect(state.steps[0]).toMatchObject({ attempt: 2, status: "passed" })
    expect(state.steps[0]?.evidence).toHaveLength(2)
    expect(state.deviations[0]).toMatchObject({ id: "DEV-1", status: "rework-required" })
    expect(state.rework[0]).toMatchObject({
      id: "RW-1",
      status: "resolved",
      reopenedEventId: "inspect-reopen",
      resolvedEventId: "inspect-done-2"
    })
  })

  it("allows accepted deviations to close", () => {
    const events: ReadonlyArray<ShopFloorEvent> = [
      started(),
      { type: "step-completed", ...common("A-done", 1), stepId: "A" },
      { type: "step-completed", ...common("B-done", 2), stepId: "B" },
      { type: "step-completed", ...common("C-done", 3), stepId: "C" },
      {
        type: "deviation-opened",
        ...common("accepted-dev-open", 4),
        deviationId: "DEV-ACCEPTED",
        stepId: "C",
        reason: "Documented cosmetic observation."
      },
      {
        type: "deviation-dispositioned",
        ...common("accepted-dev-close", 5),
        deviationId: "DEV-ACCEPTED",
        disposition: "accepted",
        rationale: "Engineering accepted as-is."
      },
      { type: "unit-closed", ...common("accepted-unit-close", 6) }
    ]
    expect(stateOf(replayUnitBuild(makeLinearWorkOrder(), "SN-001", events)).status).toBe(
      "closed"
    )
  })

  it("rejects blank deviation data before it can authorize unit close", () => {
    const malformedOpen: ShopFloorEvent = {
      type: "deviation-opened",
      ...common("blank-dev-open", 4),
      deviationId: " ",
      stepId: "C",
      reason: " "
    }
    const malformedDisposition: ShopFloorEvent = {
      type: "deviation-dispositioned",
      ...common("blank-dev-disposition", 5),
      deviationId: " ",
      disposition: "accepted",
      rationale: " "
    }
    const result = replayUnitBuild(makeLinearWorkOrder(), "SN-001", [
      started(),
      { type: "step-completed", ...common("blank-A", 1), stepId: "A" },
      { type: "step-completed", ...common("blank-B", 2), stepId: "B" },
      { type: "step-completed", ...common("blank-C", 3), stepId: "C" },
      malformedOpen,
      malformedDisposition,
      { type: "unit-closed", ...common("blank-close", 6) }
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected blank deviation refusal")
    expect(result.problems[0]?.code).toBe(ShopFloorCodes.InvalidEvent)
  })

  it("rejects unknown runtime deviation dispositions", () => {
    // SAFETY: this intentionally injects an unrecognized serialized value to
    // prove the reducer validates the runtime disposition before storing it.
    const unknownDisposition = "waived" as never
    const malformedDisposition: ShopFloorEvent = {
      type: "deviation-dispositioned",
      ...common("unknown-disposition", 5),
      deviationId: "DEV-RUNTIME",
      disposition: unknownDisposition,
      rationale: "Unrecognized runtime disposition."
    }
    const result = replayUnitBuild(makeLinearWorkOrder(), "SN-001", [
      started(),
      { type: "step-completed", ...common("runtime-A", 1), stepId: "A" },
      { type: "step-completed", ...common("runtime-B", 2), stepId: "B" },
      { type: "step-completed", ...common("runtime-C", 3), stepId: "C" },
      {
        type: "deviation-opened",
        ...common("runtime-dev-open", 4),
        deviationId: "DEV-RUNTIME",
        stepId: "C",
        reason: "Runtime payload validation."
      },
      malformedDisposition,
      { type: "unit-closed", ...common("runtime-close", 6) }
    ])

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected unknown disposition refusal")
    expect(result.problems[0]?.code).toBe(ShopFloorCodes.InvalidEvent)
  })

  it("returns InvalidEvent for non-string serialized deviation fields", () => {
    // SAFETY: null is intentionally injected to exercise the serialized-event
    // parser boundary before any deviation field is used as a domain string.
    const serializedNull = null as never
    const malformedOpenEvents: ReadonlyArray<ShopFloorEvent> = [
      {
        type: "deviation-opened",
        ...common("null-deviation-id", 1),
        deviationId: serializedNull,
        stepId: "A",
        reason: "Runtime boundary."
      },
      {
        type: "deviation-opened",
        ...common("null-step-id", 1),
        deviationId: "DEV-NULL",
        stepId: serializedNull,
        reason: "Runtime boundary."
      },
      {
        type: "deviation-opened",
        ...common("null-reason", 1),
        deviationId: "DEV-NULL",
        stepId: "A",
        reason: serializedNull
      },
      {
        type: "deviation-opened",
        ...common("null-reference", 1),
        deviationId: "DEV-NULL",
        stepId: "A",
        reason: "Runtime boundary.",
        reference: serializedNull
      }
    ]
    for (const event of malformedOpenEvents) {
      const result = replayUnitBuild(makeLinearWorkOrder(), "SN-001", [started(), event])
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected non-string deviation refusal")
      expect(result.problems[0]?.code).toBe(ShopFloorCodes.InvalidEvent)
    }

    const opened: ShopFloorEvent = {
      type: "deviation-opened",
      ...common("valid-before-malformed-disposition", 1),
      deviationId: "DEV-NULL",
      stepId: "A",
      reason: "Runtime boundary."
    }
    const malformedDispositionEvents: ReadonlyArray<ShopFloorEvent> = [
      {
        type: "deviation-dispositioned",
        ...common("null-disposition-id", 2),
        deviationId: serializedNull,
        disposition: "accepted",
        rationale: "Runtime boundary."
      },
      {
        type: "deviation-dispositioned",
        ...common("null-rationale", 2),
        deviationId: "DEV-NULL",
        disposition: "accepted",
        rationale: serializedNull
      },
      {
        type: "deviation-dispositioned",
        ...common("null-disposition-reference", 2),
        deviationId: "DEV-NULL",
        disposition: "accepted",
        rationale: "Runtime boundary.",
        dispositionRef: serializedNull
      }
    ]
    for (const event of malformedDispositionEvents) {
      const result = replayUnitBuild(makeLinearWorkOrder(), "SN-001", [
        started(),
        opened,
        event
      ])
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected non-string disposition refusal")
      expect(result.problems[0]?.code).toBe(ShopFloorCodes.InvalidEvent)
    }
  })

  it.each(["rejected", "scrap"] as const)(
    "blocks unit close for a %s deviation disposition",
    (disposition) => {
      const result = replayUnitBuild(makeLinearWorkOrder(), "SN-001", [
        started(),
        { type: "step-completed", ...common("A-done", 1), stepId: "A" },
        { type: "step-completed", ...common("B-done", 2), stepId: "B" },
        { type: "step-completed", ...common("C-done", 3), stepId: "C" },
        {
          type: "deviation-opened",
          ...common("terminal-dev-open", 4),
          deviationId: "DEV-TERMINAL",
          stepId: "C",
          reason: "Unit is not releasable."
        },
        {
          type: "deviation-dispositioned",
          ...common("terminal-dev-disposition", 5),
          deviationId: "DEV-TERMINAL",
          disposition,
          rationale: "Quality disposition."
        },
        { type: "unit-closed", ...common("blocked-terminal-close", 6) }
      ])
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected terminal disposition refusal")
      expect(result.problems[0]).toMatchObject({
        code: ShopFloorCodes.RejectedDeviation,
        relatedId: "DEV-TERMINAL"
      })
    }
  )

  it("requires completed A → B → C dependents to reopen from C back to A", () => {
    const workOrder = makeLinearWorkOrder()
    const completed: ReadonlyArray<ShopFloorEvent> = [
      started(),
      { type: "step-completed", ...common("A-complete-1", 1), stepId: "A" },
      { type: "step-completed", ...common("B-complete-1", 2), stepId: "B" },
      { type: "step-completed", ...common("C-complete-1", 3), stepId: "C" }
    ]
    const reopen = (id: string, second: number, stepId: string): ShopFloorEvent => ({
      type: "step-reopened",
      ...common(id, second),
      stepId,
      reason: `Reverify ${stepId}.`
    })

    const blockedA = replayUnitBuild(workOrder, "SN-001", [
      ...completed,
      reopen("A-reopen-too-soon", 4, "A")
    ])
    expect(blockedA.ok).toBe(false)
    if (blockedA.ok) throw new Error("expected transitive dependent refusal")
    expect(blockedA.problems[0]).toMatchObject({
      code: ShopFloorCodes.CompletedDependent,
      stepId: "A",
      relatedId: "C"
    })

    const cReopened = [...completed, reopen("C-reopen", 4, "C")]
    const stillBlockedA = replayUnitBuild(workOrder, "SN-001", [
      ...cReopened,
      reopen("A-reopen-before-B", 5, "A")
    ])
    expect(stillBlockedA.ok).toBe(false)
    if (stillBlockedA.ok) throw new Error("expected direct dependent refusal")
    expect(stillBlockedA.problems[0]).toMatchObject({
      code: ShopFloorCodes.CompletedDependent,
      stepId: "A",
      relatedId: "B"
    })

    const explicitlyReopened: ReadonlyArray<ShopFloorEvent> = [
      ...cReopened,
      reopen("B-reopen", 5, "B"),
      reopen("A-reopen", 6, "A")
    ]
    const reopenedState = stateOf(replayUnitBuild(workOrder, "SN-001", explicitlyReopened))
    expect(reopenedState.steps.map((step) => [step.id, step.status, step.attempt])).toEqual([
      ["A", "pending", 2],
      ["B", "pending", 2],
      ["C", "pending", 2]
    ])
    expect(reopenedState.events.map((event) => event.id).slice(-3)).toEqual([
      "C-reopen",
      "B-reopen",
      "A-reopen"
    ])

    const reverified = stateOf(
      replayUnitBuild(workOrder, "SN-001", [
        ...explicitlyReopened,
        { type: "step-completed", ...common("A-complete-2", 7), stepId: "A" },
        { type: "step-completed", ...common("B-complete-2", 8), stepId: "B" },
        { type: "step-completed", ...common("C-complete-2", 9), stepId: "C" },
        { type: "unit-closed", ...common("linear-close", 10) }
      ])
    )
    expect(reverified.status).toBe("closed")
  })

  it("checks transitive dependents in polynomial time on a branching route", () => {
    // Each step depends on the previous two, so the prerequisite graph branches
    // like a Fibonacci tree: the number of distinct paths from the top step to
    // the base step grows exponentially in the step count. The prior transitive
    // check recursed with a fresh per-path visited set, re-expanding each node
    // once per path, so reopening the top step — which nothing depends on and so
    // forces a full walk of every completed candidate — took tens of seconds at
    // this size. A single shared visited set makes each check O(V+E); this must
    // resolve in milliseconds. (vitest 4.1.10.)
    const stepCount = 34
    const stepId = (index: number): string => `s${index}`
    const workOrder = createWorkOrder({
      id: "WO-100",
      harnessId: "motor-harness",
      releaseId: "REL-A",
      hirFingerprint: releasedFingerprint,
      quantity: 1,
      stations: [
        {
          id: "fib",
          steps: Array.from({ length: stepCount }, (_, index): ShopStep => ({
            id: stepId(index),
            stationId: "fib",
            kind: "custom",
            instruction: `Complete ${stepId(index)}.`,
            revision: "A",
            prerequisiteStepIds:
              index === 0
                ? []
                : index === 1
                  ? [stepId(0)]
                  : [stepId(index - 1), stepId(index - 2)],
            requiredEvidenceKinds: [],
            failureBlocksDownstream: true
          }))
        }
      ]
    })

    const completeAll: ReadonlyArray<ShopFloorEvent> = [
      started(),
      ...Array.from({ length: stepCount }, (_, index): ShopFloorEvent => ({
        type: "step-completed",
        ...common(`${stepId(index)}-done`, index + 1),
        stepId: stepId(index)
      }))
    ]
    const topStep = stepId(stepCount - 1)
    const reopenSecond = stepCount + 1

    const startedMs = Date.now()
    const reopenTop = replayUnitBuild(workOrder, "SN-001", [
      ...completeAll,
      {
        type: "step-reopened",
        ...common("reopen-top", reopenSecond),
        stepId: topStep,
        reason: "Reverify the top step."
      }
    ])
    const elapsedMs = Date.now() - startedMs

    // Nothing depends on the top step, so its reopen is admitted only after the
    // dependent scan clears every completed step — the exact exponential path.
    const reopenedState = stateOf(reopenTop)
    expect(reopenedState.steps.find((step) => step.id === topStep)).toMatchObject({
      status: "pending",
      attempt: 2
    })
    expect(elapsedMs).toBeLessThan(2000)

    // The shared visited set must not change the answer: reopening the base step
    // is still refused while its deepest completed dependent stays complete.
    const reopenBase = replayUnitBuild(workOrder, "SN-001", [
      ...completeAll,
      {
        type: "step-reopened",
        ...common("reopen-base", reopenSecond),
        stepId: stepId(0),
        reason: "Reverify the base step."
      }
    ])
    expect(reopenBase.ok).toBe(false)
    if (reopenBase.ok) throw new Error("expected completed-dependent refusal")
    expect(reopenBase.problems[0]).toMatchObject({
      code: ShopFloorCodes.CompletedDependent,
      stepId: stepId(0),
      relatedId: topStep
    })
  })

  it("refuses duplicate event ids before applying either duplicate", () => {
    const duplicate = started("SN-001", "same-id")
    const result = replayUnitBuild(makeWorkOrder(), "SN-001", [duplicate, duplicate])
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected duplicate id refusal")
    expect(result.problems[0]).toMatchObject({
      code: ShopFloorCodes.DuplicateEvent,
      eventId: "same-id"
    })
  })

  it("replays and serializes deterministically without mutating inputs", () => {
    const mutableInput = {
      id: "WO-100",
      harnessId: "motor-harness",
      releaseId: "REL-A",
      hirFingerprint: releasedFingerprint,
      quantity: 2,
      configuration: { variant: "left" },
      stations: [
        {
          id: "one",
          name: "Original name",
          steps: [
            {
              id: "only",
              stationId: "one",
              kind: "custom",
              instruction: "Do it",
              revision: "A",
              prerequisiteStepIds: [],
              requiredEvidenceKinds: [],
              failureBlocksDownstream: true
            }
          ]
        }
      ]
    } satisfies WorkOrderInput
    const workOrder = createWorkOrder(mutableInput)
    mutableInput.configuration.variant = "changed"
    mutableInput.stations[0]!.name = "Changed name"
    expect(workOrder.configuration).toEqual({ variant: "left" })
    expect(workOrder.stations[0]?.name).toBe("Original name")

    const events: Array<ShopFloorEvent> = [
      started(),
      { type: "step-completed", ...common("only-done", 1), stepId: "only" },
      { type: "unit-closed", ...common("only-close", 2) }
    ]
    const before = structuredClone(events)
    const first = stateOf(replayUnitBuild(workOrder, "SN-001", events))
    const second = stateOf(replayUnitBuild(workOrder, "SN-001", structuredClone(events)))
    expect(events).toEqual(before)
    expect(first).toEqual(second)
    expect(serializeUnitBuild(first)).toBe(serializeUnitBuild(second))
    expect(serializeUnitBuild(first).endsWith("\n")).toBe(true)
    expect(JSON.parse(serializeUnitBuild(first))).toEqual(first)
  })

  it("requires authoritative start context and validates its identity and counts", () => {
    const workOrder = makeWorkOrder(2)
    const base = {
      id: "context-start",
      timestamp: at(0),
      actor: "operator-a",
      serial: "SN-CONTEXT",
      hirFingerprint: releasedFingerprint
    }
    const missing = startUnitBuild(workOrder, base)
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error("expected required-context refusal")
    expect(missing.problems[0]?.code).toBe(ShopFloorCodes.StartContextRequired)

    expect(startUnitBuild(workOrder, { ...base, builds: [] }).ok).toBe(true)
    const empty = workOrderProgress(workOrder, [])
    const malformedContexts = [
      { ...empty, workOrderId: "WO-OTHER" },
      { ...empty, quantity: 99 },
      {
        ...empty,
        started: 2,
        inProgress: 2,
        remaining: 0,
        serials: ["SN-DUPLICATE", "SN-DUPLICATE"]
      },
      { ...empty, started: 1 }
    ]
    for (const [index, progress] of malformedContexts.entries()) {
      const result = startUnitBuild(workOrder, {
        ...base,
        id: `bad-context-${index}`,
        progress
      })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected malformed progress refusal")
      expect(result.problems[0]?.code).toBe(ShopFloorCodes.ProgressMismatch)
    }

    const existing = stateOf(replayUnitBuild(workOrder, "SN-EXISTING", [started("SN-EXISTING")]))
    const duplicate = startUnitBuild(workOrder, {
      ...base,
      id: "duplicate-start",
      serial: "SN-EXISTING",
      progress: workOrderProgress(workOrder, [existing])
    })
    expect(duplicate.ok).toBe(false)
    if (duplicate.ok) throw new Error("expected duplicate-serial refusal")
    expect(duplicate.problems[0]?.code).toBe(ShopFloorCodes.SerialAlreadyStarted)

    for (const build of [
      { ...existing, workOrderId: "WO-OTHER" },
      { ...existing, status: "closed" as const }
    ]) {
      const result = startUnitBuild(workOrder, { ...base, builds: [build] })
      expect(result.ok).toBe(false)
      if (result.ok) throw new Error("expected invalid build-context refusal")
      expect(result.problems[0]?.code).toBe(ShopFloorCodes.ProgressMismatch)
    }
  })

  it("collapses exact and prefix histories but rejects equal and unequal forks", () => {
    const workOrder = makeLinearWorkOrder()
    const startEvents: ReadonlyArray<ShopFloorEvent> = [started()]
    const startState = stateOf(replayUnitBuild(workOrder, "SN-001", startEvents))
    const closedState = stateOf(
      replayUnitBuild(workOrder, "SN-001", [
        ...startEvents,
        { type: "step-completed", ...common("prefix-A", 1), stepId: "A" },
        { type: "step-completed", ...common("prefix-B", 2), stepId: "B" },
        { type: "step-completed", ...common("prefix-C", 3), stepId: "C" },
        { type: "unit-closed", ...common("prefix-close", 4) }
      ])
    )
    expect(workOrderProgress(workOrder, [closedState, closedState])).toMatchObject({
      started: 1,
      completed: 1
    })
    expect(workOrderProgress(workOrder, [closedState, startState])).toMatchObject({
      started: 1,
      completed: 1
    })

    const equalForkA = stateOf(
      replayUnitBuild(workOrder, "SN-001", [
        ...startEvents,
        { type: "step-completed", ...common("fork-A-complete", 1), stepId: "A" }
      ])
    )
    const equalForkB = stateOf(
      replayUnitBuild(workOrder, "SN-001", [
        ...startEvents,
        {
          type: "deviation-opened",
          ...common("fork-dev-open", 1),
          deviationId: "DEV-FORK",
          stepId: "A",
          reason: "Forked observation."
        }
      ])
    )
    expect(() => workOrderProgress(workOrder, [equalForkA, equalForkB])).toThrow(
      ShopFloorCodes.DivergentHistory
    )

    const unequalFork = stateOf(
      replayUnitBuild(workOrder, "SN-001", [
        ...equalForkB.events,
        {
          type: "deviation-dispositioned",
          ...common("fork-dev-accepted", 2),
          deviationId: "DEV-FORK",
          disposition: "accepted",
          rationale: "Accepted only on this branch."
        }
      ])
    )
    expect(() => workOrderProgress(workOrder, [equalForkA, unequalFork])).toThrow(
      ShopFloorCodes.DivergentHistory
    )
  })

  it("calculates quantity progress, deduplicates snapshots, and gates overrun", () => {
    const workOrder = makeWorkOrder(2)
    const closed = stateOf(replayUnitBuild(workOrder, "SN-001", happyEvents("SN-001")))
    const open = stateOf(
      replayUnitBuild(workOrder, "SN-002", [started("SN-002", "SN-002-start")])
    )
    const progress = workOrderProgress(workOrder, [open, closed, closed])
    expect(progress).toEqual({
      workOrderId: "WO-100",
      quantity: 2,
      started: 2,
      inProgress: 1,
      completed: 1,
      remaining: 0,
      remainingToComplete: 1,
      overrun: 0,
      serials: ["SN-001", "SN-002"]
    })

    const overrun = startUnitBuild(workOrder, {
      id: "SN-003-start",
      timestamp: at(0),
      actor: "operator-b",
      serial: "SN-003",
      hirFingerprint: releasedFingerprint,
      progress
    })
    expect(overrun.ok).toBe(false)
    if (overrun.ok) throw new Error("expected quantity gate")
    expect(overrun.problems[0]?.code).toBe(ShopFloorCodes.QuantityExceeded)

    const syntheticThird: UnitBuildState = {
      ...open,
      serial: "SN-003",
      events: open.events.map((event) => ({ ...event, serial: "SN-003" }))
    }
    expect(workOrderProgress(workOrder, [closed, open, syntheticThird]).overrun).toBe(1)
  })

  it("stores work orders and canonical unit builds in their immutable namespaces", () => {
    const workOrder = makeWorkOrder()
    const state = stateOf(replayUnitBuild(workOrder, "SN-001", happyEvents()))
    const store = memoryStore()
    const workOrderValue: unknown = workOrder
    // SAFETY: createWorkOrder only returns canonical data copied from its
    // Canonical-typed input fields and the statically declared route.
    const workOrderRecord = workOrderValue as Canonical
    const parsedUnit: unknown = JSON.parse(serializeUnitBuild(state))
    // SAFETY: serializeUnitBuild emits a canonical UnitBuildState, and parsing
    // those bytes can only reconstruct that same JSON-domain value.
    const unitRecord = parsedUnit as Canonical
    const workOrderId = fingerprint(workOrderRecord)
    const unitId = fingerprint(unitRecord)

    expect(store.put("work-order", workOrderId, workOrderRecord)).toBe("stored")
    expect(store.put("unit-build", unitId, unitRecord)).toBe("stored")
    expect(store.get("unit-build", unitId)).toEqual(unitRecord)
  })
})

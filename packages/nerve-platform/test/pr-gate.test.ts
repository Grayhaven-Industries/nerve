/**
 * Pull-request gate (§9.5, Workflow E).
 *
 * The batching and the unanchored-finding cases matter most: both are places
 * where a naive implementation loses a blocking finding silently, which is the
 * one outcome a merge gate must never produce.
 */
import { describe, expect, it } from "vitest"

import {
  checkRunForReview,
  fingerprint,
  MAX_ANNOTATIONS_PER_REQUEST,
  type Finding,
  type GateResult,
  type Policy
} from "@grayhaven/nerve-platform"

const policy: Policy = {
  id: "pol-1",
  organizationId: "org-1",
  requiredRulePacks: [],
  requiredInterfaceContracts: [],
  severityOverrides: {},
  requireWarningAcknowledgement: false,
  waiverRequirements: {
    requireApprover: false,
    requireAttachment: false,
    requireExpiry: false,
    requireIssueLink: false
  },
  requiredApproverIds: [],
  allowSingleApprover: false,
  allowEvidenceReuse: false,
  retentionDays: 365,
  sourceStalenessToleranceDays: 30,
  fingerprint: fingerprint({ policy: "pol-1" })
}

const passing: GateResult = { ready: true, blockers: [] }
const blocked: GateResult = {
  ready: false,
  blockers: [{ code: "REV-GATE-004", message: "Error finding HK-WIRE-001 has no disposition." }]
}

const finding = (id: string, row: number | undefined, severity: "error" | "warning"): Finding => ({
  id,
  reviewRunId: "run-1",
  code: "HK-WIRE-001",
  severity,
  ruleSeverity: severity,
  message: "Duplicate wire id.",
  target: "wire:W1",
  ...(row === undefined ? {} : { sourceLocation: { filename: "wires.csv", row, column: "Wire" } })
})

const base = {
  policy,
  detailsUrl: "https://nerve.example/reviews/run-1",
  reviewRunId: "run-1"
}

describe("pull-request gate (§9.5)", () => {
  it("reports success and links to the hosted review", () => {
    const plan = checkRunForReview({ ...base, gate: passing, findings: [] })
    expect(plan.checkRun.conclusion).toBe("success")
    expect(plan.checkRun.status).toBe("completed")
    // §9.5 step 5: the route to the evidence must survive into the payload.
    expect(plan.checkRun.details_url).toBe(base.detailsUrl)
    expect(plan.checkRun.output.summary).toContain(base.detailsUrl)
  })

  it("fails and annotates a blocking finding on its source line", () => {
    const plan = checkRunForReview({
      ...base,
      gate: blocked,
      findings: [finding("f-1", 12, "error")]
    })
    expect(plan.checkRun.conclusion).toBe("failure")
    expect(plan.checkRun.output.annotations).toEqual([
      {
        path: "wires.csv",
        start_line: 12,
        end_line: 12,
        annotation_level: "failure",
        title: "HK-WIRE-001 (column Wire)",
        message: "Duplicate wire id."
      }
    ])
  })

  it("reports an execution failure as action_required, not as a design failure", () => {
    // §10.1: a failed run holds no verdict, so it must not read as "your
    // harness is wrong".
    const plan = checkRunForReview({
      ...base,
      gate: blocked,
      findings: [],
      executionFailed: true
    })
    expect(plan.checkRun.conclusion).toBe("action_required")
  })

  it("names blocking findings it cannot anchor instead of dropping them", () => {
    // The set is mixed on purpose. §9.5 step 4 promises an annotation only for
    // blocking findings, so only their absence is reported. An unanchored
    // warning listed here would be counted by the summary line "N blocking
    // finding(s) have no source line", overstating the blocking count in the
    // one place a PR reviewer reads the verdict.
    const plan = checkRunForReview({
      ...base,
      gate: blocked,
      findings: [
        finding("f-nowhere", undefined, "error"),
        finding("w-nowhere", undefined, "warning")
      ]
    })
    expect(plan.checkRun.output.annotations).toEqual([])
    expect(plan.unanchoredFindingIds).toEqual(["f-nowhere"])
    expect(plan.checkRun.output.summary).toContain("f-nowhere")
    // `toContain` is the substring matcher for strings, and `.not` negates it
    // (vitest 4.1.10, docs/api/expect.md, confirmed via Context7).
    expect(plan.checkRun.output.summary).not.toContain("w-nowhere")
  })

  it("batches past the API ceiling without losing an annotation", () => {
    const many = Array.from({ length: 120 }, (_, i) => finding(`f-${i}`, i + 1, "error"))
    const plan = checkRunForReview({ ...base, gate: blocked, findings: many })

    const total = plan.annotationBatches.reduce((sum, b) => sum + b.length, 0)
    expect(total).toBe(120)
    expect(plan.annotationBatches).toHaveLength(3)
    for (const b of plan.annotationBatches) {
      expect(b.length).toBeLessThanOrEqual(MAX_ANNOTATIONS_PER_REQUEST)
    }
    // The first batch travels with the create call.
    expect(plan.checkRun.output.annotations).toEqual(plan.annotationBatches[0])
  })

  it("honors an org severity override in both directions (ORG-004)", () => {
    const demoted: Policy = { ...policy, severityOverrides: { "HK-WIRE-001": "info" } }
    const plan = checkRunForReview({
      ...base,
      policy: demoted,
      gate: passing,
      findings: [finding("f-1", 3, "error")]
    })
    // Demoted to info: neither blocking nor annotated.
    expect(plan.checkRun.output.annotations).toEqual([])
    expect(plan.checkRun.output.summary).toContain("Blocking findings: 0")

    const promoted: Policy = { ...policy, severityOverrides: { "HK-WIRE-001": "error" } }
    const promotedPlan = checkRunForReview({
      ...base,
      policy: promoted,
      gate: blocked,
      findings: [finding("f-1", 3, "warning")]
    })
    expect(promotedPlan.checkRun.output.annotations[0]?.annotation_level).toBe("failure")
  })
})

/**
 * Cross-module integration (§9.1 Workflow A through §9.4 Workflow D).
 *
 * The per-module suites prove each rule in isolation. This suite proves the
 * seams between them, which is where the modules were written independently
 * and could disagree: the gate reading a disposition, an approval reading the
 * candidate the gate passed, and the bundle reading that approval.
 *
 * The expiry case below is a regression guard. `dispositionApplies` skips its
 * expiry clause when no clock is supplied, so a gate that called it with three
 * arguments let a lapsed waiver clear a blocking error finding — the exact
 * outcome §9.3 step 5 exists to prevent.
 */
import { describe, expect, it } from "vitest"

import {
  buildEvidenceBundle,
  evaluateReadyForApproval,
  fingerprint,
  GateCodes,
  proposeApproval,
  validateRelease,
  type Disposition,
  type Finding,
  type GateInput,
  type Membership,
  type Policy,
  type Project,
  type ReleaseCandidate
} from "@grayhaven/nerve-platform"

const SOURCE_FP = fingerprint({ source: "set" })

const policy: Policy = {
  id: "pol-1",
  organizationId: "org-1",
  requiredRulePacks: ["core"],
  requiredInterfaceContracts: ["ic-1"],
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
  fingerprint: fingerprint({ policy: "pol-1" })
}

const candidate: ReleaseCandidate = {
  id: "rc-1",
  reviewRunId: "run-1",
  reviewRunFingerprint: fingerprint({ run: "run-1" }),
  sourceSetFingerprint: SOURCE_FP,
  policyFingerprint: policy.fingerprint,
  artifactHashes: { "bom.csv": fingerprint({ artifact: "bom" }) },
  proposedBy: "engineer-1",
  // The clock every deterministic judgement in this suite is made against.
  proposedAt: "2026-03-01T00:00:00Z",
  fingerprint: fingerprint({ candidate: "rc-1" })
}

const errorFinding: Finding = {
  id: "f-1",
  reviewRunId: "run-1",
  code: "HK-WIRE-001",
  severity: "error",
  ruleSeverity: "error",
  message: "Duplicate wire id.",
  target: "wire:W1"
}

/** A complete waiver, differing only in when it lapses. */
const waiver = (expiresAt: string | undefined): Disposition => ({
  findingId: "f-1",
  state: "accepted-risk",
  reason: "Reviewed with the manufacturer; risk accepted for this build.",
  ownerId: "engineer-1",
  decidedBy: "reviewer-1",
  decidedAt: "2026-01-01T00:00:00Z",
  ...(expiresAt === undefined ? {} : { expiresAt }),
  scope: {
    harnessId: "h-1",
    code: "HK-WIRE-001",
    target: "wire:W1",
    sourceSetFingerprint: SOURCE_FP
  }
})

/** A gate input that passes every §10.2 bullet; individual tests spoil one. */
const passingGate = (overrides: Partial<GateInput> = {}): GateInput => ({
  candidate,
  policy,
  compilation: { compiled: true, hirDecoded: true },
  rowAccountingComplete: true,
  findings: [],
  dispositions: [],
  warningAcknowledgements: [],
  interfaceContractResults: [{ contractId: "ic-1", passed: true }],
  rulePackResults: [{ rulePackId: "core", succeeded: true }],
  coverageDisclosure: {
    acknowledgedBy: candidate.proposedBy,
    acknowledgedAt: candidate.proposedAt
  },
  regeneratedArtifacts: {
    fromCandidateFingerprint: candidate.fingerprint,
    hashes: candidate.artifactHashes
  },
  sources: [{ filename: "wires.csv", required: true, status: "verified", staleForDays: 0 }],
  sourceStalenessToleranceDays: 30,
  ...overrides
})

describe("gate and disposition seam (§9.3 step 5, §10.2)", () => {
  it("passes when every §10.2 bullet is satisfied", () => {
    expect(evaluateReadyForApproval(passingGate())).toEqual({ ready: true, blockers: [] })
  })

  it("lets a live waiver clear a blocking error finding", () => {
    const result = evaluateReadyForApproval(
      passingGate({ findings: [errorFinding], dispositions: [waiver("2026-06-01T00:00:00Z")] })
    )
    expect(result.ready).toBe(true)
  })

  it("refuses to let a waiver that lapsed before the candidate clear the same finding", () => {
    const result = evaluateReadyForApproval(
      passingGate({ findings: [errorFinding], dispositions: [waiver("2026-02-01T00:00:00Z")] })
    )
    expect(result.ready).toBe(false)
    expect(result.blockers.map((b) => b.code)).toContain(GateCodes.ErrorFindingUndispositioned)
  })

  it("refuses a waiver written against a different source set", () => {
    const stale: Disposition = {
      ...waiver(undefined),
      scope: { ...waiver(undefined).scope, sourceSetFingerprint: fingerprint({ other: true }) }
    }
    const result = evaluateReadyForApproval(
      passingGate({ findings: [errorFinding], dispositions: [stale] })
    )
    expect(result.ready).toBe(false)
  })
})

describe("approval and release seam (§10.2, §10.3)", () => {
  const project: Project = {
    id: "proj-1",
    organizationId: "org-1",
    name: "Pilot",
    production: true,
    createdAt: "2026-01-01T00:00:00Z"
  }
  const reviewer: Membership = { userId: "reviewer-1", organizationId: "org-1", role: "reviewer" }

  it("refuses the preparer as their own approver, then admits a different reviewer", () => {
    const selfApproval = proposeApproval({
      candidate,
      approverId: candidate.proposedBy,
      membership: { userId: candidate.proposedBy, organizationId: "org-1", role: "reviewer" },
      project,
      policy,
      approvedAt: "2026-03-02T00:00:00Z"
    })
    expect(selfApproval.admissible).toBe(false)

    const other = proposeApproval({
      candidate,
      approverId: "reviewer-1",
      membership: reviewer,
      project,
      policy,
      approvedAt: "2026-03-02T00:00:00Z"
    })
    expect(other.admissible).toBe(true)
  })

  it("carries an approved candidate through to an admissible release", () => {
    const decision = proposeApproval({
      candidate,
      approverId: "reviewer-1",
      membership: reviewer,
      project,
      policy,
      approvedAt: "2026-03-02T00:00:00Z"
    })
    if (!decision.admissible) throw new Error("approval should be admissible")

    const bundle = buildEvidenceBundle({
      candidate,
      project,
      approvals: [decision.approval],
      entries: [
        { path: "results.json", contentHash: fingerprint({ r: 1 }), byteLength: 10 },
        { path: "inputs.json", contentHash: fingerprint({ i: 1 }), byteLength: 20 }
      ]
    })

    expect(
      validateRelease({
        candidate,
        policy,
        approvals: [decision.approval],
        bundle,
        gatePassed: true
      })
    ).toEqual([])
  })

  it("refuses release when the gate did not pass", () => {
    const decision = proposeApproval({
      candidate,
      approverId: "reviewer-1",
      membership: reviewer,
      project,
      policy,
      approvedAt: "2026-03-02T00:00:00Z"
    })
    if (!decision.admissible) throw new Error("approval should be admissible")
    const bundle = buildEvidenceBundle({
      candidate,
      project,
      approvals: [decision.approval],
      entries: []
    })
    expect(
      validateRelease({ candidate, policy, approvals: [decision.approval], bundle, gatePassed: false })
    ).not.toEqual([])
  })
})

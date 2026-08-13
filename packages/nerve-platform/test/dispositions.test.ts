/**
 * Dispositions: what a reviewer must state, and how far it reaches
 * (PRD §9.3).
 *
 * The cases are written one requirement at a time. A test that omits five
 * fields and asserts "invalid" passes for the wrong reason the moment two of
 * the five checks are deleted, and §9.3 step 4 is exactly the kind of list
 * that erodes that way.
 *
 * Pinned versions: vitest 4.1.10, effect 3.22.1 (`Schema.optional`, so an absent
 * field stays absent rather than becoming `null`).
 */
import { describe, expect, it } from "vitest"
import {
  DispositionCodes,
  dispositionApplies,
  validateDisposition
} from "../src/dispositions.js"
import type { Disposition, Finding, Policy, WaiverRequirements } from "../src/objects.js"

const noWaiverRequirements: WaiverRequirements = {
  requireApprover: false,
  requireAttachment: false,
  requireExpiry: false,
  requireIssueLink: false
}

const policyWith = (waiverRequirements: WaiverRequirements): Policy => ({
  id: "pol_1",
  organizationId: "org_1",
  requiredRulePacks: [],
  requiredInterfaceContracts: [],
  severityOverrides: {},
  requireWarningAcknowledgement: false,
  waiverRequirements,
  requiredApproverIds: [],
  allowSingleApprover: false,
  allowEvidenceReuse: false,
  retentionDays: 365,
  sourceStalenessToleranceDays: 30,
  fingerprint: "sha256:policy"
})

/** A complete accepted-risk waiver; each test removes exactly one field. */
const completeWaiver: Disposition = {
  findingId: "fnd_1",
  state: "accepted-risk",
  reason: "The measured current is within the derated limit for this run.",
  ownerId: "usr_owner",
  decidedBy: "usr_reviewer",
  decidedAt: "2026-08-13T10:00:00Z",
  approverId: "usr_approver",
  attachmentId: "att_1",
  expiresAt: "2026-09-13T10:00:00Z",
  issueLink: "https://example.invalid/issues/1",
  scope: {
    harnessId: "hns_1",
    code: "HK-WIRE-001",
    target: "wire:W12",
    sourceSetFingerprint: "sha256:source-a"
  }
}

const codesOf = (problems: ReadonlyArray<{ readonly code: string }>) =>
  problems.map((problem) => problem.code)

describe("validateDisposition (§9.3 steps 3 and 4)", () => {
  it("accepts a fixed-in-new-run disposition with nothing else stated", () => {
    const fixed: Disposition = {
      findingId: "fnd_1",
      state: "fixed-in-new-run",
      decidedBy: "usr_engineer",
      decidedAt: "2026-08-13T10:00:00Z",
      scope: completeWaiver.scope
    }
    expect(
      validateDisposition(
        fixed,
        policyWith({
          requireApprover: true,
          requireAttachment: true,
          requireExpiry: true,
          requireIssueLink: true
        })
      )
    ).toEqual([])
  })

  it("accepts a complete waiver under the strictest policy", () => {
    expect(
      validateDisposition(
        completeWaiver,
        policyWith({
          requireApprover: true,
          requireAttachment: true,
          requireExpiry: true,
          requireIssueLink: true
        })
      )
    ).toEqual([])
  })

  for (const state of ["accepted-risk", "false-positive", "not-applicable", "deferred"] as const) {
    it(`requires a reason for a ${state} disposition`, () => {
      const { reason: _reason, ...withoutReason } = completeWaiver
      expect(
        codesOf(
          validateDisposition({ ...withoutReason, state }, policyWith(noWaiverRequirements))
        )
      ).toEqual([DispositionCodes.MissingReason])
    })

    it(`requires an owner for a ${state} disposition`, () => {
      const { ownerId: _ownerId, ...withoutOwner } = completeWaiver
      expect(
        codesOf(
          validateDisposition({ ...withoutOwner, state }, policyWith(noWaiverRequirements))
        )
      ).toEqual([DispositionCodes.MissingOwner])
    })
  }

  it("treats a whitespace-only reason as no reason", () => {
    expect(
      codesOf(
        validateDisposition(
          { ...completeWaiver, reason: "   " },
          policyWith(noWaiverRequirements)
        )
      )
    ).toEqual([DispositionCodes.MissingReason])
  })

  it("requires an approver when the policy demands one", () => {
    const { approverId: _approverId, ...withoutApprover } = completeWaiver
    expect(
      codesOf(
        validateDisposition(
          withoutApprover,
          policyWith({ ...noWaiverRequirements, requireApprover: true })
        )
      )
    ).toEqual([DispositionCodes.MissingApprover])
  })

  it("requires an attachment when the policy demands one", () => {
    const { attachmentId: _attachmentId, ...withoutAttachment } = completeWaiver
    expect(
      codesOf(
        validateDisposition(
          withoutAttachment,
          policyWith({ ...noWaiverRequirements, requireAttachment: true })
        )
      )
    ).toEqual([DispositionCodes.MissingAttachment])
  })

  it("requires an expiration date when the policy demands one", () => {
    const { expiresAt: _expiresAt, ...withoutExpiry } = completeWaiver
    expect(
      codesOf(
        validateDisposition(
          withoutExpiry,
          policyWith({ ...noWaiverRequirements, requireExpiry: true })
        )
      )
    ).toEqual([DispositionCodes.MissingExpiry])
  })

  it("requires an issue link when the policy demands one", () => {
    const { issueLink: _issueLink, ...withoutIssueLink } = completeWaiver
    expect(
      codesOf(
        validateDisposition(
          withoutIssueLink,
          policyWith({ ...noWaiverRequirements, requireIssueLink: true })
        )
      )
    ).toEqual([DispositionCodes.MissingIssueLink])
  })

  it("does not apply the policy's waiver requirements to a fix", () => {
    const fixed: Disposition = {
      findingId: "fnd_1",
      state: "fixed-in-new-run",
      decidedBy: "usr_engineer",
      decidedAt: "2026-08-13T10:00:00Z",
      scope: completeWaiver.scope
    }
    expect(
      validateDisposition(
        fixed,
        policyWith({ ...noWaiverRequirements, requireIssueLink: true })
      )
    ).toEqual([])
  })

  it("reports every unmet requirement at once", () => {
    const bare: Disposition = {
      findingId: "fnd_1",
      state: "deferred",
      decidedBy: "usr_reviewer",
      decidedAt: "2026-08-13T10:00:00Z",
      scope: completeWaiver.scope
    }
    expect(
      codesOf(
        validateDisposition(
          bare,
          policyWith({
            requireApprover: true,
            requireAttachment: true,
            requireExpiry: true,
            requireIssueLink: true
          })
        )
      )
    ).toEqual([
      DispositionCodes.MissingReason,
      DispositionCodes.MissingOwner,
      DispositionCodes.MissingApprover,
      DispositionCodes.MissingAttachment,
      DispositionCodes.MissingExpiry,
      DispositionCodes.MissingIssueLink
    ])
  })
})

const finding: Finding = {
  id: "fnd_1",
  reviewRunId: "run_1",
  code: "HK-WIRE-001",
  severity: "error",
  ruleSeverity: "error",
  message: "Duplicate wire id.",
  target: "wire:W12"
}

describe("dispositionApplies (§9.3 step 5)", () => {
  it("applies to the same rule and object in the same submission", () => {
    expect(dispositionApplies(completeWaiver, finding, "sha256:source-a")).toBe(true)
  })

  it("refuses to carry to a changed submission", () => {
    expect(dispositionApplies(completeWaiver, finding, "sha256:source-b")).toBe(false)
  })

  it("refuses a different rule", () => {
    expect(
      dispositionApplies(completeWaiver, { ...finding, code: "HK-WIRE-002" }, "sha256:source-a")
    ).toBe(false)
  })

  it("refuses a different object", () => {
    expect(
      dispositionApplies(completeWaiver, { ...finding, target: "wire:W13" }, "sha256:source-a")
    ).toBe(false)
  })

  it("refuses a finding that names no object when the waiver names one", () => {
    const { target: _target, ...untargeted } = finding
    expect(dispositionApplies(completeWaiver, untargeted, "sha256:source-a")).toBe(false)
  })

  it("does not apply after it expires", () => {
    expect(
      dispositionApplies(
        completeWaiver,
        finding,
        "sha256:source-a",
        "2026-09-14T00:00:00Z"
      )
    ).toBe(false)
  })

  it("still applies before it expires", () => {
    expect(
      dispositionApplies(
        completeWaiver,
        finding,
        "sha256:source-a",
        "2026-09-01T00:00:00Z"
      )
    ).toBe(true)
  })

  it("does not apply when its expiration date cannot be read", () => {
    expect(
      dispositionApplies(
        { ...completeWaiver, expiresAt: "next Tuesday" },
        finding,
        "sha256:source-a",
        "2026-09-01T00:00:00Z"
      )
    ).toBe(false)
  })

  it("applies forever when the waiver states no expiration date", () => {
    const { expiresAt: _expiresAt, ...withoutExpiry } = completeWaiver
    expect(
      dispositionApplies(withoutExpiry, finding, "sha256:source-a", "2099-01-01T00:00:00Z")
    ).toBe(true)
  })
})

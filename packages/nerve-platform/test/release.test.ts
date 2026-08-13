/**
 * Approvals, evidence bundles, and release (PRD §10.2, §10.3, §9.4 step 4).
 *
 * The separation of duties is the rule that has to survive refactoring, so it
 * is tested from both ends: the preparer is refused as their own approver,
 * and a release whose only signature is the preparer's is refused even when
 * an approval record exists. The pilot exception is tested in both
 * directions too — allowed on a non-production project, refused on a
 * production one with the same policy.
 *
 * Pinned versions: vitest 4.1.10, effect 3.22.1.
 */
import { describe, expect, it } from "vitest"
import { ApprovalCodes, invalidateApprovals, proposeApproval } from "../src/approvals.js"
import {
  ReleaseCodes,
  buildEvidenceBundle,
  evidenceBundleFingerprint,
  validateRelease,
  type BundleEntry
} from "../src/evidence.js"
import type {
  Approval,
  Membership,
  Policy,
  Project,
  ReleaseCandidate
} from "../src/objects.js"

const basePolicy: Policy = {
  id: "pol_1",
  organizationId: "org_1",
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
  fingerprint: "sha256:policy"
}

const productionProject: Project = {
  id: "prj_ship",
  organizationId: "org_1",
  name: "Flight harness",
  production: true,
  createdAt: "2026-01-01T00:00:00Z"
}

const pilotProject: Project = {
  ...productionProject,
  id: "prj_pilot",
  name: "Bench pilot",
  production: false
}

const candidate: ReleaseCandidate = {
  id: "rc_1",
  reviewRunId: "run_1",
  reviewRunFingerprint: "sha256:run",
  sourceSetFingerprint: "sha256:source-a",
  policyFingerprint: "sha256:policy",
  artifactHashes: { "bom.csv": "sha256:bom" },
  proposedBy: "usr_preparer",
  proposedAt: "2026-08-13T09:00:00Z",
  fingerprint: "sha256:candidate-a"
}

const membershipFor = (userId: string, project: Project): Membership => ({
  userId,
  organizationId: project.organizationId,
  role: "reviewer"
})

const codesOf = (items: ReadonlyArray<{ readonly code: string }>) =>
  items.map((item) => item.code)

describe("proposeApproval (§10.3)", () => {
  it("admits a different authorized user", () => {
    const decision = proposeApproval({
      candidate,
      approverId: "usr_reviewer",
      membership: membershipFor("usr_reviewer", productionProject),
      project: productionProject,
      policy: basePolicy,
      approvedAt: "2026-08-13T11:00:00Z"
    })
    expect(decision).toEqual({
      admissible: true,
      approval: {
        candidateFingerprint: "sha256:candidate-a",
        approvedBy: "usr_reviewer",
        approvedAt: "2026-08-13T11:00:00Z",
        singleApproverException: false
      }
    })
  })

  it("refuses the preparer as their own approver", () => {
    const decision = proposeApproval({
      candidate,
      approverId: "usr_preparer",
      membership: membershipFor("usr_preparer", productionProject),
      project: productionProject,
      policy: basePolicy,
      approvedAt: "2026-08-13T11:00:00Z"
    })
    expect(decision.admissible).toBe(false)
    if (decision.admissible) return
    expect(codesOf(decision.refusals)).toContain(ApprovalCodes.SelfApproval)
  })

  it("allows the single-approver exception on a non-production project", () => {
    const decision = proposeApproval({
      candidate,
      approverId: "usr_preparer",
      membership: membershipFor("usr_preparer", pilotProject),
      project: pilotProject,
      policy: { ...basePolicy, allowSingleApprover: true },
      approvedAt: "2026-08-13T11:00:00Z"
    })
    expect(decision.admissible).toBe(true)
    if (!decision.admissible) return
    expect(decision.approval.singleApproverException).toBe(true)
  })

  it("refuses the single-approver exception on a production project", () => {
    const decision = proposeApproval({
      candidate,
      approverId: "usr_preparer",
      membership: membershipFor("usr_preparer", productionProject),
      project: productionProject,
      policy: { ...basePolicy, allowSingleApprover: true },
      approvedAt: "2026-08-13T11:00:00Z"
    })
    expect(decision.admissible).toBe(false)
    if (decision.admissible) return
    expect(codesOf(decision.refusals)).toEqual([ApprovalCodes.SingleApproverOnProduction])
  })

  it("refuses a user who cannot approve reviews", () => {
    const decision = proposeApproval({
      candidate,
      approverId: "usr_viewer",
      membership: { ...membershipFor("usr_viewer", productionProject), role: "viewer" },
      project: productionProject,
      policy: basePolicy,
      approvedAt: "2026-08-13T11:00:00Z"
    })
    expect(decision.admissible).toBe(false)
    if (decision.admissible) return
    expect(codesOf(decision.refusals)).toEqual([ApprovalCodes.NotAuthorized])
  })

  it("refuses a user the policy does not name", () => {
    const decision = proposeApproval({
      candidate,
      approverId: "usr_reviewer",
      membership: membershipFor("usr_reviewer", productionProject),
      project: productionProject,
      policy: { ...basePolicy, requiredApproverIds: ["usr_chief"] },
      approvedAt: "2026-08-13T11:00:00Z"
    })
    expect(decision.admissible).toBe(false)
    if (decision.admissible) return
    expect(codesOf(decision.refusals)).toEqual([ApprovalCodes.NotRequiredApprover])
  })
})

const approvedInputs = {
  sourceSetFingerprint: "sha256:source-a",
  ruleFingerprint: "sha256:rules-1",
  policyFingerprint: "sha256:policy",
  dependencyFingerprint: "sha256:deps-1"
}

const approval: Approval = {
  candidateFingerprint: "sha256:candidate-a",
  approvedBy: "usr_reviewer",
  approvedAt: "2026-08-13T11:00:00Z",
  singleApproverException: false
}

describe("invalidateApprovals (§9.4 step 4)", () => {
  it("keeps approvals when nothing moved", () => {
    const result = invalidateApprovals([approval], approvedInputs, approvedInputs)
    expect(result.retained).toEqual([approval])
    expect(result.invalidated).toEqual([])
    expect(result.reasons).toEqual([])
  })

  for (const [field, code] of [
    ["sourceSetFingerprint", ApprovalCodes.SourceChanged],
    ["ruleFingerprint", ApprovalCodes.RulesChanged],
    ["policyFingerprint", ApprovalCodes.PolicyChanged],
    ["dependencyFingerprint", ApprovalCodes.DependenciesChanged]
  ] as const) {
    it(`invalidates every approval when ${field} moves`, () => {
      const result = invalidateApprovals([approval], approvedInputs, {
        ...approvedInputs,
        [field]: "sha256:moved"
      })
      expect(result.retained).toEqual([])
      expect(result.invalidated).toEqual([approval])
      expect(codesOf(result.reasons)).toEqual([code])
    })
  }
})

const entries: ReadonlyArray<BundleEntry> = [
  { path: "report.html", contentHash: "sha256:report", byteLength: 2048 },
  { path: "artifacts/bom.csv", contentHash: "sha256:bom", byteLength: 512 },
  { path: "findings.json", contentHash: "sha256:findings", byteLength: 1024 }
]

const exceptionApproval: Approval = {
  candidateFingerprint: "sha256:candidate-a",
  approvedBy: "usr_preparer",
  approvedAt: "2026-08-13T11:00:00Z",
  singleApproverException: true
}

describe("buildEvidenceBundle (§10.2, §10.3)", () => {
  it("gives the same fingerprint whatever order the entries arrive in", () => {
    const forward = buildEvidenceBundle({
      candidate,
      project: productionProject,
      approvals: [approval],
      entries
    })
    const reversed = buildEvidenceBundle({
      candidate,
      project: productionProject,
      approvals: [approval],
      entries: [...entries].reverse()
    })
    expect(reversed.fingerprint).toBe(forward.fingerprint)
    expect(forward.entries.map((entry) => entry.path)).toEqual([
      "artifacts/bom.csv",
      "findings.json",
      "report.html"
    ])
  })

  it("changes fingerprint when an entry's content changes", () => {
    const original = buildEvidenceBundle({
      candidate,
      project: productionProject,
      approvals: [approval],
      entries
    })
    const edited = buildEvidenceBundle({
      candidate,
      project: productionProject,
      approvals: [approval],
      entries: [...entries.slice(1), { ...entries[0]!, contentHash: "sha256:other" }]
    })
    expect(edited.fingerprint).not.toBe(original.fingerprint)
  })

  it("states every single-approver exception in the bundle", () => {
    const bundle = buildEvidenceBundle({
      candidate,
      project: pilotProject,
      approvals: [exceptionApproval],
      entries
    })
    expect(bundle.exceptions).toHaveLength(1)
    expect(bundle.exceptions[0]).toContain("Single-approver exception")
    expect(bundle.exceptions[0]).toContain("usr_preparer")
    expect(bundle.exceptions[0]).toContain("prj_pilot")
  })

  it("records no exception when two people signed", () => {
    const bundle = buildEvidenceBundle({
      candidate,
      project: productionProject,
      approvals: [approval],
      entries
    })
    expect(bundle.exceptions).toEqual([])
    expect(evidenceBundleFingerprint(bundle)).toBe(bundle.fingerprint)
  })
})

const bundleFor = (approvals: ReadonlyArray<Approval>, project: Project = productionProject) =>
  buildEvidenceBundle({ candidate, project, approvals, entries })

describe("validateRelease (§10.2)", () => {
  it("admits a candidate that meets every bullet", () => {
    expect(
      validateRelease({
        candidate,
        policy: basePolicy,
        approvals: [approval],
        bundle: bundleFor([approval]),
        gatePassed: true
      })
    ).toEqual([])
  })

  it("refuses when the gate did not pass", () => {
    expect(
      codesOf(
        validateRelease({
          candidate,
          policy: basePolicy,
          approvals: [approval],
          bundle: bundleFor([approval]),
          gatePassed: false
        })
      )
    ).toEqual([ReleaseCodes.GateFailed])
  })

  it("refuses when nothing was approved", () => {
    expect(
      codesOf(
        validateRelease({
          candidate,
          policy: basePolicy,
          approvals: [],
          bundle: bundleFor([]),
          gatePassed: true
        })
      )
    ).toEqual([ReleaseCodes.NoApprovals])
  })

  it("refuses when only the preparer signed and no exception is recorded", () => {
    const selfApproval: Approval = { ...approval, approvedBy: "usr_preparer" }
    expect(
      codesOf(
        validateRelease({
          candidate,
          policy: basePolicy,
          approvals: [selfApproval],
          bundle: bundleFor([selfApproval]),
          gatePassed: true
        })
      )
    ).toEqual([ReleaseCodes.SelfApprovalWithoutException])
  })

  it("admits a pilot release carrying the recorded exception", () => {
    expect(
      validateRelease({
        candidate,
        policy: { ...basePolicy, allowSingleApprover: true },
        approvals: [exceptionApproval],
        bundle: bundleFor([exceptionApproval], pilotProject),
        gatePassed: true
      })
    ).toEqual([])
  })

  it("refuses when an exception was used but the bundle does not state it", () => {
    expect(
      codesOf(
        validateRelease({
          candidate,
          policy: { ...basePolicy, allowSingleApprover: true },
          approvals: [exceptionApproval],
          bundle: bundleFor([], pilotProject),
          gatePassed: true
        })
      )
    ).toEqual([ReleaseCodes.ExceptionNotRecorded])
  })

  it("refuses when an approval records no identity or timestamp", () => {
    const anonymous: Approval = { ...approval, approvedBy: "", approvedAt: " " }
    expect(
      codesOf(
        validateRelease({
          candidate,
          policy: basePolicy,
          approvals: [anonymous],
          bundle: bundleFor([anonymous]),
          gatePassed: true
        })
      )
    ).toEqual([
      ReleaseCodes.ApprovalIdentityMissing,
      ReleaseCodes.ApprovalTimestampMissing
    ])
  })

  it("refuses when a required approver has not signed", () => {
    expect(
      codesOf(
        validateRelease({
          candidate,
          policy: { ...basePolicy, requiredApproverIds: ["usr_chief"] },
          approvals: [approval],
          bundle: bundleFor([approval]),
          gatePassed: true
        })
      )
    ).toEqual([ReleaseCodes.MissingRequiredApprover])
  })

  it("refuses an approval given against a different candidate", () => {
    const elsewhere: Approval = { ...approval, candidateFingerprint: "sha256:candidate-b" }
    expect(
      codesOf(
        validateRelease({
          candidate,
          policy: basePolicy,
          approvals: [elsewhere],
          bundle: bundleFor([elsewhere]),
          gatePassed: true
        })
      )
    ).toEqual([ReleaseCodes.ApprovalOnOtherCandidate, ReleaseCodes.NoApprovals])
  })

  it("refuses when the bundle was not generated", () => {
    expect(
      codesOf(
        validateRelease({
          candidate,
          policy: basePolicy,
          approvals: [approval],
          bundle: undefined,
          gatePassed: true
        })
      )
    ).toEqual([ReleaseCodes.BundleMissing])
  })

  it("refuses when the bundle names a different candidate fingerprint", () => {
    const bundle = bundleFor([approval])
    expect(
      codesOf(
        validateRelease({
          candidate,
          policy: basePolicy,
          approvals: [approval],
          bundle: { ...bundle, releaseCandidateFingerprint: "sha256:candidate-b" },
          gatePassed: true
        })
      )
    ).toEqual([
      ReleaseCodes.BundleCandidateMismatch,
      ReleaseCodes.BundleFingerprintMismatch
    ])
  })

  it("refuses a bundle whose contents were edited after it was fingerprinted", () => {
    const bundle = bundleFor([approval])
    expect(
      codesOf(
        validateRelease({
          candidate,
          policy: basePolicy,
          approvals: [approval],
          bundle: {
            ...bundle,
            entries: [
              ...bundle.entries.slice(1),
              { path: "extra.txt", contentHash: "sha256:extra", byteLength: 4 }
            ]
          },
          gatePassed: true
        })
      )
    ).toEqual([ReleaseCodes.BundleFingerprintMismatch])
  })
})

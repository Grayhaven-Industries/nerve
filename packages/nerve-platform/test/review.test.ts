// vitest 4.1.10 (resolved at the workspace root in bun.lock) — describe/it/expect.
import { describe, expect, it } from "vitest"
import type {
  Disposition,
  Finding,
  Policy,
  ReleaseCandidate,
  ReviewRun,
  ReviewState
} from "../src/objects.js"
import {
  canTransition,
  checkTransition,
  diffRevisions,
  evaluateReadyForApproval,
  evidenceReuseAllowed,
  GateCodes,
  isTerminalState,
  nextStates,
  requiresNewRun,
  reviewStates,
  TransitionCodes
} from "../src/review.js"
import type { GateInput, RevisionObject, RevisionSide } from "../src/review.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SOURCE_FP = "sha256:source"
const CANDIDATE_FP = "sha256:candidate"

const policy = (overrides: Partial<Policy> = {}): Policy => ({
  id: "pol-1",
  organizationId: "org-1",
  requiredRulePacks: ["pack.core"],
  requiredInterfaceContracts: ["contract.j1"],
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
  fingerprint: "sha256:policy",
  ...overrides
})

const candidate = (overrides: Partial<ReleaseCandidate> = {}): ReleaseCandidate => ({
  id: "rc-1",
  reviewRunId: "run-1",
  reviewRunFingerprint: "sha256:run",
  sourceSetFingerprint: SOURCE_FP,
  policyFingerprint: "sha256:policy",
  artifactHashes: { "drawing.pdf": "sha256:drawing" },
  proposedBy: "user-owner",
  proposedAt: "2026-01-01T00:00:00Z",
  fingerprint: CANDIDATE_FP,
  ...overrides
})

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  id: "f-1",
  reviewRunId: "run-1",
  code: "HK-WIRE-001",
  severity: "error",
  ruleSeverity: "error",
  message: "Duplicate wire id.",
  ...overrides
})

/** A disposition that both applies (§9.3 step 5) and is complete (step 3). */
const disposition = (overrides: Partial<Disposition> = {}): Disposition => ({
  findingId: "f-1",
  state: "accepted-risk",
  reason: "The duplicate is a documented rework.",
  ownerId: "user-owner",
  decidedBy: "user-reviewer",
  decidedAt: "2026-01-01T00:00:00Z",
  scope: {
    harnessId: "harness-1",
    code: "HK-WIRE-001",
    sourceSetFingerprint: SOURCE_FP
  },
  ...overrides
})

/** A gate input in which all nine §10.2 conditions hold. */
const passingInput = (overrides: Partial<GateInput> = {}): GateInput => ({
  candidate: candidate(),
  policy: policy(),
  compilation: { compiled: true, hirDecoded: true },
  rowAccountingComplete: true,
  findings: [],
  dispositions: [],
  warningAcknowledgements: [],
  interfaceContractResults: [{ contractId: "contract.j1", passed: true }],
  rulePackResults: [{ rulePackId: "pack.core", succeeded: true }],
  coverageDisclosure: {
    acknowledgedBy: "user-owner",
    acknowledgedAt: "2026-01-01T00:00:00Z"
  },
  regeneratedArtifacts: {
    fromCandidateFingerprint: CANDIDATE_FP,
    hashes: { "drawing.pdf": "sha256:drawing" }
  },
  sources: [{ filename: "harness.csv", required: true, status: "verified", staleForDays: 0 }],
  sourceStalenessToleranceDays: 7,
  ...overrides
})

const codesOf = (input: GateInput): ReadonlyArray<string> =>
  evaluateReadyForApproval(input).blockers.map((blocker) => blocker.code)

const run = (id: string, state: ReviewState): ReviewRun => ({
  id,
  harnessId: "harness-1",
  sourceSetId: `ss-${id}`,
  sourceSetFingerprint: `sha256:ss-${id}`,
  engineVersion: "7.0.0",
  policyId: "pol-1",
  policyFingerprint: "sha256:policy",
  state,
  preparedBy: "user-owner",
  createdAt: "2026-01-01T00:00:00Z",
  fingerprint: `sha256:${id}`
})

const side = (id: string, state: ReviewState, objects: ReadonlyArray<RevisionObject>): RevisionSide => ({
  run: run(id, state),
  objects
})

// ---------------------------------------------------------------------------
// §10.1 Review states
// ---------------------------------------------------------------------------

describe("review state machine (§10.1)", () => {
  it("walks the documented happy path end to end", () => {
    const happyPath: ReadonlyArray<ReviewState> = [
      "draft",
      "import-needs-attention",
      "review-running",
      "action-required",
      "ready-for-approval",
      "approved",
      "released",
      "superseded"
    ]
    for (let index = 0; index < happyPath.length - 1; index += 1) {
      const from = happyPath[index]!
      const to = happyPath[index + 1]!
      expect(canTransition(from, to), `${from} -> ${to}`).toBe(true)
    }
  })

  it("lists every schema state, so nothing was added without an edge decision", () => {
    expect([...reviewStates].sort()).toEqual(
      [
        "action-required",
        "approved",
        "draft",
        "import-needs-attention",
        "ready-for-approval",
        "released",
        "review-failed",
        "review-running",
        "superseded"
      ].sort()
    )
  })

  it("refuses every route out of review-failed toward a verdict", () => {
    for (const target of ["ready-for-approval", "approved", "released"] as const) {
      const check = checkTransition("review-failed", target)
      expect(check.allowed, `review-failed -> ${target}`).toBe(false)
      expect(check.allowed === false && check.code).toBe(TransitionCodes.TerminalState)
    }
    // Not even back to work: a failed run is finished, a new run replaces it.
    expect(canTransition("review-failed", "review-running")).toBe(false)
    expect(canTransition("review-failed", "draft")).toBe(false)
    expect(nextStates("review-failed")).toEqual([])
    expect(isTerminalState("review-failed")).toBe(true)
    expect(requiresNewRun("review-failed")).toBe(true)
  })

  it("treats a superseded release as history", () => {
    expect(nextStates("superseded")).toEqual([])
    expect(canTransition("superseded", "released")).toBe(false)
    expect(requiresNewRun("superseded")).toBe(true)
  })

  it("does not let a candidate skip stages", () => {
    const skipped: ReadonlyArray<readonly [ReviewState, ReviewState]> = [
      ["draft", "ready-for-approval"],
      ["draft", "approved"],
      ["draft", "released"],
      ["review-running", "approved"],
      ["action-required", "approved"],
      ["ready-for-approval", "released"],
      ["approved", "superseded"],
      ["released", "approved"]
    ]
    for (const [from, to] of skipped) {
      const check = checkTransition(from, to)
      expect(check.allowed, `${from} -> ${to}`).toBe(false)
      expect(check.allowed === false && check.code).toBe(TransitionCodes.IllegalTransition)
    }
  })

  it("names a self transition rather than calling it illegal", () => {
    const check = checkTransition("approved", "approved")
    expect(check.allowed).toBe(false)
    expect(check.allowed === false && check.code).toBe(TransitionCodes.NoChange)
  })

  it("allows the documented back-edges", () => {
    // Re-run after fixes (§9.1 step 8 — as a new run entering this state).
    expect(canTransition("action-required", "review-running")).toBe(true)
    // Dispositions alone can clear the gate without a re-run (§9.3).
    expect(canTransition("action-required", "ready-for-approval")).toBe(true)
    // A late finding or expired waiver drops a ready candidate back.
    expect(canTransition("ready-for-approval", "action-required")).toBe(true)
    // §10.2: a policy or dependency move invalidates an approval.
    expect(canTransition("approved", "action-required")).toBe(true)
    // Fixing an import returns the submission to draft.
    expect(canTransition("import-needs-attention", "draft")).toBe(true)
    // Only a running engine can fail.
    expect(canTransition("review-running", "review-failed")).toBe(true)
    expect(canTransition("action-required", "review-failed")).toBe(false)
    expect(canTransition("draft", "review-failed")).toBe(false)
  })

  it("does not require a new run from a live state", () => {
    expect(requiresNewRun("action-required")).toBe(false)
    expect(requiresNewRun("released")).toBe(false)
  })

  it("explains a refusal in the message", () => {
    const check = checkTransition("review-failed", "approved")
    expect(check.allowed === false && check.message).toContain("Create a new review run")
  })
})

// ---------------------------------------------------------------------------
// §10.2 Gate
// ---------------------------------------------------------------------------

describe("evaluateReadyForApproval (§10.2)", () => {
  it("passes when all nine conditions hold", () => {
    const result = evaluateReadyForApproval(passingInput())
    expect(result.blockers).toEqual([])
    expect(result.ready).toBe(true)
  })

  it("blocks when compilation fails", () => {
    expect(
      codesOf(passingInput({ compilation: { compiled: false, hirDecoded: true } }))
    ).toEqual([GateCodes.CompilationFailed])
  })

  it("blocks when the HIR does not decode", () => {
    expect(
      codesOf(passingInput({ compilation: { compiled: true, hirDecoded: false } }))
    ).toEqual([GateCodes.HirDecodeFailed])
  })

  it("blocks when source-row accounting is incomplete", () => {
    expect(codesOf(passingInput({ rowAccountingComplete: false }))).toEqual([
      GateCodes.RowAccountingIncomplete
    ])
  })

  it("blocks an undispositioned error finding", () => {
    const result = evaluateReadyForApproval(passingInput({ findings: [finding()] }))
    expect(result.ready).toBe(false)
    expect(result.blockers).toEqual([
      {
        code: GateCodes.ErrorFindingUndispositioned,
        message: "Error finding HK-WIRE-001 has no disposition.",
        subject: "f-1"
      }
    ])
  })

  it("clears an error finding with a complete, in-scope disposition", () => {
    const result = evaluateReadyForApproval(
      passingInput({ findings: [finding()], dispositions: [disposition()] })
    )
    expect(result.ready).toBe(true)
  })

  it("still blocks an error finding whose disposition is incomplete", () => {
    // The policy demands an approver; the disposition names none, so §9.3
    // step 4 is unmet and the waiver must not clear the error.
    const input = passingInput({
      policy: policy({
        waiverRequirements: {
          requireApprover: true,
          requireAttachment: false,
          requireExpiry: false,
          requireIssueLink: false
        }
      }),
      findings: [finding()],
      dispositions: [disposition()]
    })
    const result = evaluateReadyForApproval(input)
    expect(result.ready).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      GateCodes.DispositionIncomplete
    ])
    // Reported as an incomplete decision, not as a missing one: the reviewer
    // has to add the approver, not make the call again.
    expect(result.blockers[0]?.message).toContain("approver")
    expect(result.blockers[0]?.subject).toBe("f-1")
  })

  it("does not let an out-of-scope disposition clear a finding (§9.3 step 5)", () => {
    const stale = disposition({
      scope: {
        harnessId: "harness-1",
        code: "HK-WIRE-001",
        sourceSetFingerprint: "sha256:some-other-submission"
      }
    })
    expect(codesOf(passingInput({ findings: [finding()], dispositions: [stale] }))).toEqual([
      GateCodes.ErrorFindingUndispositioned
    ])
  })

  it("ignores warnings unless the policy requires acknowledgement", () => {
    const warning = finding({ severity: "warning", ruleSeverity: "warning" })
    expect(evaluateReadyForApproval(passingInput({ findings: [warning] })).ready).toBe(true)
    expect(
      codesOf(
        passingInput({
          policy: policy({ requireWarningAcknowledgement: true }),
          findings: [warning]
        })
      )
    ).toEqual([GateCodes.WarningUnacknowledged])
  })

  it("accepts an explicit acknowledgement for a warning", () => {
    const warning = finding({ severity: "warning", ruleSeverity: "warning" })
    const result = evaluateReadyForApproval(
      passingInput({
        policy: policy({ requireWarningAcknowledgement: true }),
        findings: [warning],
        warningAcknowledgements: ["f-1"]
      })
    )
    expect(result.ready).toBe(true)
  })

  it("judges on the effective severity when policy promotes a rule", () => {
    // The rule only warns; the organization decided it blocks (ORG-004).
    const warning = finding({ severity: "warning", ruleSeverity: "warning" })
    const result = evaluateReadyForApproval(
      passingInput({
        policy: policy({ severityOverrides: { "HK-WIRE-001": "error" } }),
        findings: [warning]
      })
    )
    expect(result.ready).toBe(false)
    expect(result.blockers.map((blocker) => blocker.code)).toEqual([
      GateCodes.ErrorFindingUndispositioned
    ])
  })

  it("judges on the effective severity when policy demotes a rule", () => {
    // The rule errors; the organization decided it only warns, and warnings
    // need no acknowledgement here, so nothing blocks.
    const result = evaluateReadyForApproval(
      passingInput({
        policy: policy({ severityOverrides: { "HK-WIRE-001": "warning" } }),
        findings: [finding()]
      })
    )
    expect(result.ready).toBe(true)
  })

  it("never blocks on an informational finding", () => {
    const result = evaluateReadyForApproval(
      passingInput({
        policy: policy({
          requireWarningAcknowledgement: true,
          severityOverrides: { "HK-WIRE-001": "info" }
        }),
        findings: [finding()]
      })
    )
    expect(result.ready).toBe(true)
  })

  it("blocks a required interface contract that did not run or failed", () => {
    expect(codesOf(passingInput({ interfaceContractResults: [] }))).toEqual([
      GateCodes.InterfaceContractNotRun
    ])
    expect(
      codesOf(
        passingInput({ interfaceContractResults: [{ contractId: "contract.j1", passed: false }] })
      )
    ).toEqual([GateCodes.InterfaceContractFailed])
  })

  it("blocks a required rule pack that did not run or failed", () => {
    expect(codesOf(passingInput({ rulePackResults: [] }))).toEqual([GateCodes.RulePackNotRun])
    expect(
      codesOf(passingInput({ rulePackResults: [{ rulePackId: "pack.core", succeeded: false }] }))
    ).toEqual([GateCodes.RulePackFailed])
  })

  it("blocks when coverage was never displayed", () => {
    expect(codesOf(passingInput({ coverageDisclosure: undefined }))).toEqual([
      GateCodes.CoverageNotDisplayed
    ])
  })

  it("blocks when coverage was displayed to someone other than the owner", () => {
    expect(
      codesOf(
        passingInput({
          coverageDisclosure: {
            acknowledgedBy: "user-bystander",
            acknowledgedAt: "2026-01-01T00:00:00Z"
          }
        })
      )
    ).toEqual([GateCodes.CoverageDisplayedToOther])
  })

  it("blocks artifacts regenerated from a different candidate", () => {
    expect(
      codesOf(
        passingInput({
          regeneratedArtifacts: {
            fromCandidateFingerprint: "sha256:other-candidate",
            hashes: { "drawing.pdf": "sha256:drawing" }
          }
        })
      )
    ).toEqual([GateCodes.ArtifactsFromOtherCandidate])
  })

  it("blocks a missing or mismatched artifact", () => {
    expect(
      codesOf(
        passingInput({
          regeneratedArtifacts: { fromCandidateFingerprint: CANDIDATE_FP, hashes: {} }
        })
      )
    ).toEqual([GateCodes.ArtifactMissing])
    expect(
      codesOf(
        passingInput({
          regeneratedArtifacts: {
            fromCandidateFingerprint: CANDIDATE_FP,
            hashes: { "drawing.pdf": "sha256:regenerated-differently" }
          }
        })
      )
    ).toEqual([GateCodes.ArtifactHashMismatch])
  })

  it("blocks a required source that is stale or unverified beyond tolerance", () => {
    expect(
      codesOf(
        passingInput({
          sources: [
            { filename: "harness.csv", required: true, status: "stale", staleForDays: 30 }
          ]
        })
      )
    ).toEqual([GateCodes.SourceStale])
    expect(
      codesOf(
        passingInput({
          sources: [
            { filename: "pinout.csv", required: true, status: "unverified", staleForDays: 30 }
          ]
        })
      )
    ).toEqual([GateCodes.SourceUnverified])
  })

  it("tolerates staleness inside the tolerance, and on non-required sources", () => {
    const within = evaluateReadyForApproval(
      passingInput({
        sources: [{ filename: "harness.csv", required: true, status: "stale", staleForDays: 7 }]
      })
    )
    expect(within.ready).toBe(true)
    const optional = evaluateReadyForApproval(
      passingInput({
        sources: [{ filename: "notes.csv", required: false, status: "unverified", staleForDays: 90 }]
      })
    )
    expect(optional.ready).toBe(true)
  })

  it("reports every unmet condition at once, not just the first", () => {
    const codes = codesOf(
      passingInput({
        compilation: { compiled: false, hirDecoded: false },
        rowAccountingComplete: false,
        interfaceContractResults: [],
        rulePackResults: []
      })
    )
    expect(codes).toEqual([
      GateCodes.CompilationFailed,
      GateCodes.HirDecodeFailed,
      GateCodes.RowAccountingIncomplete,
      GateCodes.InterfaceContractNotRun,
      GateCodes.RulePackNotRun
    ])
  })
})

// ---------------------------------------------------------------------------
// §9.2 Revision review
// ---------------------------------------------------------------------------

describe("diffRevisions (§9.2)", () => {
  const baselineObjects: ReadonlyArray<RevisionObject> = [
    {
      ref: "connector:J1",
      domain: "engineering",
      fingerprint: "sha256:j1-a",
      downstreamArtifacts: ["drawing.pdf"]
    },
    {
      ref: "bom:line-7",
      domain: "bom",
      fingerprint: "sha256:bom7",
      downstreamArtifacts: ["bom.csv"]
    },
    {
      ref: "test:continuity",
      domain: "test",
      fingerprint: "sha256:test",
      downstreamArtifacts: ["testplan.pdf"]
    }
  ]

  const candidateObjects: ReadonlyArray<RevisionObject> = [
    {
      ref: "connector:J1",
      domain: "engineering",
      fingerprint: "sha256:j1-b",
      downstreamArtifacts: ["drawing.pdf", "cutlist.csv"]
    },
    {
      ref: "test:continuity",
      domain: "test",
      fingerprint: "sha256:test",
      downstreamArtifacts: ["testplan.pdf"]
    },
    {
      ref: "manufacturing:cut-length",
      domain: "manufacturing",
      fingerprint: "sha256:cut",
      downstreamArtifacts: ["cutlist.csv"]
    }
  ]

  const diff = (p: Policy = policy()) =>
    diffRevisions(
      side("run-a", "released", baselineObjects),
      side("run-b", "review-running", candidateObjects),
      p
    )

  it("classifies added, removed, changed, and unchanged objects", () => {
    const byRef = new Map(diff().changes.map((change) => [change.ref, change]))
    expect(byRef.get("connector:J1")?.kind).toBe("changed")
    expect(byRef.get("bom:line-7")?.kind).toBe("removed")
    expect(byRef.get("manufacturing:cut-length")?.kind).toBe("added")
    expect(byRef.get("test:continuity")?.kind).toBe("unchanged")
  })

  it("ranks by changed object and affected downstream artifacts (step 3)", () => {
    const ranked = diff().changes.map((change) => change.ref)
    // engineering change (4 * 2 + 2 artifacts = 10) outranks the BOM removal
    // (3 * 3 + 1 = 10 — tie broken by the higher-risk domain) and the
    // manufacturing addition (2 * 1 + 1 = 3). Unchanged evidence sorts last.
    expect(ranked).toEqual([
      "connector:J1",
      "bom:line-7",
      "manufacturing:cut-length",
      "test:continuity"
    ])
    expect(ranked.at(-1)).toBe("test:continuity")
    expect(diff().changes.at(-1)?.riskScore).toBe(0)
  })

  it("summarizes the change per §9.2 step 2 view and its downstream artifacts", () => {
    const result = diff()
    expect(result.changedByDomain).toEqual({
      engineering: 1,
      manufacturing: 1,
      test: 0,
      bom: 1,
      "interface-contract": 0
    })
    expect(result.affectedArtifacts).toEqual(["bom.csv", "cutlist.csv", "drawing.pdf"])
    expect(result.baselineRunId).toBe("run-a")
    expect(result.candidateRunId).toBe("run-b")
  })

  it("refuses evidence reuse when the policy forbids it, even on identical fingerprints", () => {
    const forbidden = diff(policy({ allowEvidenceReuse: false }))
    const unchanged = forbidden.changes.find((change) => change.ref === "test:continuity")
    // The object is byte-identical across revisions and still may not be reused.
    expect(unchanged?.kind).toBe("unchanged")
    expect(unchanged?.baselineFingerprint).toBe(unchanged?.candidateFingerprint)
    expect(unchanged?.evidenceReusable).toBe(false)
    expect(forbidden.reusableEvidenceRefs).toEqual([])
    expect(forbidden.evidenceReusePermitted).toBe(false)
    // With nothing reusable, everything is in front of the reviewer (step 5).
    expect(forbidden.focusRefs).toHaveLength(4)
  })

  it("reuses only fingerprint-identical evidence when the policy permits it", () => {
    const permitted = diff(policy({ allowEvidenceReuse: true }))
    expect(permitted.evidenceReusePermitted).toBe(true)
    expect(permitted.reusableEvidenceRefs).toEqual(["test:continuity"])
    expect(permitted.focusRefs).toEqual([
      "connector:J1",
      "bom:line-7",
      "manufacturing:cut-length"
    ])
  })

  it("exposes the reuse rule as a predicate over both conditions (step 4)", () => {
    const permissive = policy({ allowEvidenceReuse: true })
    const strict = policy({ allowEvidenceReuse: false })
    expect(evidenceReuseAllowed("sha256:x", "sha256:x", permissive)).toBe(true)
    expect(evidenceReuseAllowed("sha256:x", "sha256:x", strict)).toBe(false)
    expect(evidenceReuseAllowed("sha256:x", "sha256:y", permissive)).toBe(false)
    // An object present on one side only has no evidence to carry forward.
    expect(evidenceReuseAllowed(undefined, undefined, permissive)).toBe(false)
    expect(evidenceReuseAllowed("sha256:x", undefined, permissive)).toBe(false)
  })
})

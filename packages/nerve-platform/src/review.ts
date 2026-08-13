/**
 * Review lifecycle, approval gate, and revision comparison
 * (PRD §9.1 step 8, §9.2, §10.1, §10.2).
 *
 * Three questions live here because they share one premise: a review run is
 * immutable evidence about one exact submission. §9.1 step 8 says a changed
 * input creates a new run and never mutates the previous verdict, so nothing
 * in this module edits a run — the state machine only says which move is
 * legal, the gate only reports what blocks, and the revision diff only
 * reports what moved between two runs.
 *
 * That premise is what makes `review-failed` terminal (§10.1). A run whose
 * execution failed holds no verdict to progress; the way forward is another
 * run against corrected source or configuration. Encoding that as an empty
 * outgoing edge set, rather than as a check at each call site, is what stops
 * a failed run from reaching approval through some path nobody considered.
 *
 * Every function here is pure and deterministic. Timestamps and ages arrive
 * as parameters so that replaying a gate decision from an evidence bundle
 * produces the same answer it produced on the day it was made.
 */
// effect 3.22.1 (installed under the package's ^3.16.0 range; confirmed via
// Context7 /effect-ts/effect v3): `Schema.Literal(...).literals` exposes the
// declared members as a readonly tuple, so the state list below is derived
// from the schema in `objects.ts` instead of being retyped and left to drift.
import { ReviewState } from "./objects.js"
import type {
  Disposition,
  Finding,
  Policy,
  ReleaseCandidate,
  ReviewRun
} from "./objects.js"
import type { Fingerprint } from "./fingerprint.js"
import { effectiveSeverity } from "./policy.js"
import { dispositionApplies, validateDisposition } from "./dispositions.js"

// ---------------------------------------------------------------------------
// §10.1 Review states
// ---------------------------------------------------------------------------

/**
 * Every review state, in the §10.1 progression order, with `review-failed`
 * last because it is not a step of the progression at all.
 */
export const reviewStates: ReadonlyArray<ReviewState> = ReviewState.literals

/**
 * Legal moves out of each state.
 *
 * The happy path is §10.1 verbatim:
 * `draft -> import-needs-attention -> review-running -> action-required ->
 * ready-for-approval -> approved -> released -> superseded`.
 *
 * The mapped type is the exhaustiveness check: a state added to the schema
 * fails to compile here until someone decides what may follow it, which is
 * the decision that should never be made by omission.
 */
export const reviewTransitions: {
  readonly [S in ReviewState]: ReadonlyArray<ReviewState>
} = {
  /**
   * A clean import skips `import-needs-attention` — that state describes an
   * import that needs a human, not a stage every submission passes through.
   */
  draft: ["import-needs-attention", "review-running"],
  /**
   * Back-edge to `draft`: fixing an import means replacing files or the
   * column map, which returns the candidate to an unsubmitted state. Forward
   * to `review-running` covers the case where the reported rows were
   * confirmed rather than changed.
   */
  "import-needs-attention": ["draft", "review-running"],
  /**
   * A run either produces something to act on, produces nothing blocking, or
   * fails to execute. `review-failed` is only reachable from here because
   * only a running engine can fail (§10.1).
   */
  "review-running": ["action-required", "ready-for-approval", "review-failed"],
  /**
   * Back-edge to `review-running`: the usual response to findings is a re-run
   * on corrected source, which per §9.1 step 8 is a new run entering this
   * state, not a rewrite of this one. The direct edge to
   * `ready-for-approval` covers the other legitimate response — dispositions
   * recorded against the same evidence (§9.3) that clear the gate without any
   * input changing.
   */
  "action-required": ["review-running", "ready-for-approval"],
  /**
   * Back-edge to `action-required`: readiness is a computed verdict over
   * evidence that keeps moving. A waiver expires, an approver requests a
   * change, a late rule-pack result lands — the candidate must be able to
   * fall back out of readiness, or the gate would be a one-way latch that
   * outlives the facts it was based on.
   */
  "ready-for-approval": ["action-required", "approved"],
  /**
   * Back-edge to `action-required`: §10.2 invalidates an approval when the
   * policy or a pinned dependency moves before release. The approval does not
   * become a release and does not silently stand; the candidate returns to
   * the state that says a human owes it work.
   */
  approved: ["action-required", "released"],
  /** §10.1: a release ends only by being replaced. */
  released: ["superseded"],
  /** Terminal. A superseded release is history, and history is not edited. */
  superseded: [],
  /**
   * Terminal (§10.1). Deliberately empty: a failed execution holds no design
   * verdict, so it must not reach `ready-for-approval`, `approved`, or
   * `released` by any route. Correcting the source or the configuration
   * produces a new run in `draft`.
   */
  "review-failed": []
}

/** Stable rejection codes for illegal lifecycle moves (§10.1). */
export const TransitionCodes = {
  /** The state has no outgoing edges at all. */
  TerminalState: "REV-STATE-001",
  /** Both states exist, but the move between them is not in §10.1. */
  IllegalTransition: "REV-STATE-002",
  /** Source and destination are the same state, so nothing was proposed. */
  NoChange: "REV-STATE-003"
} as const

export type TransitionCode = (typeof TransitionCodes)[keyof typeof TransitionCodes]

export type TransitionCheck =
  | { readonly allowed: true }
  | {
      readonly allowed: false
      readonly code: TransitionCode
      readonly message: string
    }

/** States from which a run cannot move at all. */
export const isTerminalState = (state: ReviewState): boolean =>
  reviewTransitions[state].length === 0

/**
 * True when the only way forward is a new review run (§9.1 step 8).
 *
 * `review-failed` and `superseded` are terminal for different reasons — one
 * never produced a verdict, one produced a verdict that has been replaced —
 * but the caller's next action is the same in both cases, so one predicate
 * answers it.
 */
export const requiresNewRun = (state: ReviewState): boolean => isTerminalState(state)

/** The states a run may legally move to. */
export const nextStates = (from: ReviewState): ReadonlyArray<ReviewState> =>
  reviewTransitions[from]

/**
 * Validate a proposed lifecycle move, with a reason when it is refused.
 *
 * The refusal carries a code rather than only prose because the caller has to
 * branch on it: a terminal state tells the UI to offer "start a new run",
 * while an ordinary illegal move tells it the request is stale.
 */
export const checkTransition = (from: ReviewState, to: ReviewState): TransitionCheck => {
  if (from === to) {
    return {
      allowed: false,
      code: TransitionCodes.NoChange,
      message: `The run is already in state ${from}.`
    }
  }
  if (isTerminalState(from)) {
    return {
      allowed: false,
      code: TransitionCodes.TerminalState,
      message: `State ${from} is terminal for this run. Create a new review run to continue.`
    }
  }
  if (!reviewTransitions[from].includes(to)) {
    return {
      allowed: false,
      code: TransitionCodes.IllegalTransition,
      message: `A run cannot move from ${from} to ${to}.`
    }
  }
  return { allowed: true }
}

/** Convenience predicate over `checkTransition`. */
export const canTransition = (from: ReviewState, to: ReviewState): boolean =>
  checkTransition(from, to).allowed

// ---------------------------------------------------------------------------
// §10.2 Default MVP gate
// ---------------------------------------------------------------------------

/** Did the submission compile and decode (§10.2 bullet 1)? */
export interface CompilationOutcome {
  readonly compiled: boolean
  readonly hirDecoded: boolean
}

/** Result of one required interface contract (§10.2 bullet 5). */
export interface InterfaceContractResult {
  readonly contractId: string
  readonly passed: boolean
}

/** Result of one required rule pack (§10.2 bullet 6). */
export interface RulePackResult {
  readonly rulePackId: string
  readonly succeeded: boolean
}

/**
 * Proof that rule coverage and system limitations were shown to the person
 * proposing the candidate (§10.2 bullet 7).
 *
 * The acknowledgement names a user because the bullet names one: coverage
 * shown to a bystander does not tell the candidate owner what the tool did
 * not check.
 */
export interface CoverageDisclosure {
  readonly acknowledgedBy: string
  readonly acknowledgedAt: string
}

/**
 * Artifacts as they were regenerated for this check (§10.2 bullet 8).
 *
 * `fromCandidateFingerprint` is carried separately from the hashes because
 * the bullet has two halves: the artifacts must match, and they must have
 * been produced from this candidate. Hashes alone cannot prove the second.
 */
export interface RegeneratedArtifacts {
  readonly fromCandidateFingerprint: Fingerprint
  readonly hashes: Readonly<Record<string, Fingerprint>>
}

/** How fresh one source is (§10.2 bullet 9). */
export interface SourceFreshness {
  readonly filename: string
  /** Only required sources block; a supporting reference does not. */
  readonly required: boolean
  readonly status: "verified" | "stale" | "unverified"
  /**
   * Days the source has been in a non-verified status, supplied by the
   * caller so the gate stays deterministic and replayable.
   */
  readonly staleForDays: number
}

/**
 * Everything §10.2 judges, in one record.
 *
 * The gate owns no I/O: compilation, ingestion, the rule runner, and the
 * artifact generator each report their own outcome, and this function decides
 * what the combination means. That is what lets the same nine bullets be
 * re-evaluated later from a stored bundle and reach the same answer.
 */
export interface GateInput {
  readonly candidate: ReleaseCandidate
  readonly policy: Policy
  /** Bullet 1. */
  readonly compilation: CompilationOutcome
  /** Bullet 2: the ingestion module's row-accounting summary (ING-005). */
  readonly rowAccountingComplete: boolean
  /** Bullets 3 and 4. */
  readonly findings: ReadonlyArray<Finding>
  readonly dispositions: ReadonlyArray<Disposition>
  /**
   * Bullet 4: ids of findings a human explicitly acknowledged without
   * dispositioning them. Only consulted when the policy demands it.
   */
  readonly warningAcknowledgements: ReadonlyArray<string>
  /** Bullet 5. */
  readonly interfaceContractResults: ReadonlyArray<InterfaceContractResult>
  /** Bullet 6. */
  readonly rulePackResults: ReadonlyArray<RulePackResult>
  /** Bullet 7. Absent means the disclosure never happened. */
  readonly coverageDisclosure?: CoverageDisclosure | undefined
  /** Bullet 8. */
  readonly regeneratedArtifacts: RegeneratedArtifacts
  /** Bullet 9. */
  readonly sources: ReadonlyArray<SourceFreshness>
  /**
   * Bullet 9's tolerance, in days. It is an input rather than a `Policy`
   * field because the MVP policy schema (ORG-004) carries no staleness
   * setting; the caller supplies the organization's configured value so the
   * gate does not invent one.
   */
  readonly sourceStalenessToleranceDays: number
}

/**
 * Stable gate codes (§10.2).
 *
 * Codes exist for the same reason the compiler's diagnostic codes do: a UI
 * blocks a button on them, a CI job fails on them, and an evidence bundle
 * read three years from now has to still say which rule refused. Numbers are
 * never reused, and a bullet that can fail two ways gets two codes because
 * "the contract did not run" and "the contract failed" send the reader to
 * different places.
 */
export const GateCodes = {
  /** Bullet 1. */
  CompilationFailed: "REV-GATE-001",
  HirDecodeFailed: "REV-GATE-002",
  /** Bullet 2. */
  RowAccountingIncomplete: "REV-GATE-003",
  /** Bullet 3. */
  ErrorFindingUndispositioned: "REV-GATE-004",
  /** Bullet 3: a disposition exists but does not satisfy §9.3. */
  DispositionIncomplete: "REV-GATE-005",
  /** Bullet 4. */
  WarningUnacknowledged: "REV-GATE-006",
  /** Bullet 5. */
  InterfaceContractNotRun: "REV-GATE-007",
  InterfaceContractFailed: "REV-GATE-008",
  /** Bullet 6. */
  RulePackNotRun: "REV-GATE-009",
  RulePackFailed: "REV-GATE-010",
  /** Bullet 7. */
  CoverageNotDisplayed: "REV-GATE-011",
  CoverageDisplayedToOther: "REV-GATE-012",
  /** Bullet 8. */
  ArtifactsFromOtherCandidate: "REV-GATE-013",
  ArtifactMissing: "REV-GATE-014",
  ArtifactHashMismatch: "REV-GATE-015",
  /** Bullet 9. */
  SourceStale: "REV-GATE-016",
  SourceUnverified: "REV-GATE-017"
} as const

export type GateCode = (typeof GateCodes)[keyof typeof GateCodes]

/** One unmet §10.2 condition. */
export interface GateBlocker {
  readonly code: GateCode
  readonly message: string
  /**
   * What the blocker points at — a finding id, contract id, rule pack id,
   * artifact name, or filename — so the UI can link the reason to the thing
   * instead of asking the reader to search for it.
   */
  readonly subject?: string | undefined
}

/**
 * The gate's answer. Never a bare boolean: §10.2 is nine conditions, and a
 * candidate owner needs the list of the ones that are unmet, not the fact
 * that at least one is.
 */
export interface GateResult {
  readonly ready: boolean
  readonly blockers: ReadonlyArray<GateBlocker>
}

/**
 * Evaluate the §10.2 gate for a release candidate.
 *
 * Findings are judged on their *effective* severity, because ORG-004 lets an
 * organization override a rule's level in either direction. A warning the
 * organization promoted to error blocks like any other error, and an error it
 * demoted stops blocking — reading `finding.severity` directly would silently
 * apply whichever level happened to be stored on the record.
 *
 * A finding is only cleared by a disposition that both applies to it
 * (`dispositionApplies`, which enforces the §9.3 step 5 scope) and is
 * complete (`validateDisposition`). An incomplete waiver is reported as its
 * own blocker rather than as "undispositioned", because the two need
 * different work: one needs a decision, the other needs the approver,
 * attachment, expiry, or link the policy demands.
 */
export const evaluateReadyForApproval = (input: GateInput): GateResult => {
  const blockers: Array<GateBlocker> = []
  const { candidate, policy } = input

  // Bullet 1: compilation and HIR decoding.
  if (!input.compilation.compiled) {
    blockers.push({
      code: GateCodes.CompilationFailed,
      message: "Compilation did not succeed. Correct the source and start a new run."
    })
  }
  if (!input.compilation.hirDecoded) {
    blockers.push({
      code: GateCodes.HirDecodeFailed,
      message: "The HIR did not decode. The submission cannot be reviewed."
    })
  }

  // Bullet 2: source-row accounting.
  if (!input.rowAccountingComplete) {
    blockers.push({
      code: GateCodes.RowAccountingIncomplete,
      message: "Source-row accounting is not complete. Some rows are not imported or not explained."
    })
  }

  // Bullets 3 and 4: findings, dispositions, and acknowledgements.
  for (const finding of input.findings) {
    const severity = effectiveSeverity(finding.code, finding.ruleSeverity, policy)
    if (severity === "info") continue

    // `proposedAt` is the clock the expiry clause is judged against, rather
    // than the wall clock: the gate must replay to the same verdict when the
    // same candidate is re-evaluated, and a waiver that had not expired when
    // the candidate was proposed cannot retroactively stop applying. Omitting
    // it would skip the expiry check entirely and let a lapsed waiver clear a
    // blocking error finding (§9.3 step 5).
    const applied = input.dispositions.find((disposition) =>
      dispositionApplies(
        disposition,
        finding,
        candidate.sourceSetFingerprint,
        candidate.proposedAt
      )
    )
    const problems = applied === undefined ? [] : validateDisposition(applied, policy)
    const resolved = applied !== undefined && problems.length === 0

    if (severity === "error") {
      if (resolved) continue
      if (applied === undefined) {
        blockers.push({
          code: GateCodes.ErrorFindingUndispositioned,
          message: `Error finding ${finding.code} has no disposition.`,
          subject: finding.id
        })
        continue
      }
      blockers.push({
        code: GateCodes.DispositionIncomplete,
        message: `The disposition of error finding ${finding.code} is not complete: ${problems
          .map((problem) => problem.message)
          .join(" ")}`,
        subject: finding.id
      })
      continue
    }

    // A warning blocks only when the organization asks for acknowledgement
    // (§10.2 bullet 4, ORG-004). An incomplete waiver does not resolve it,
    // but an explicit acknowledgement still can.
    if (!policy.requireWarningAcknowledgement) continue
    if (resolved) continue
    if (input.warningAcknowledgements.includes(finding.id)) continue
    blockers.push({
      code: GateCodes.WarningUnacknowledged,
      message: `Warning finding ${finding.code} is not resolved and not acknowledged.`,
      subject: finding.id
    })
  }

  // Bullet 5: required interface contracts. The policy names what must pass,
  // so results for contracts it does not require are not examined here.
  for (const contractId of policy.requiredInterfaceContracts) {
    const result = input.interfaceContractResults.find(
      (candidateResult) => candidateResult.contractId === contractId
    )
    if (result === undefined) {
      blockers.push({
        code: GateCodes.InterfaceContractNotRun,
        message: `Required interface contract ${contractId} did not run.`,
        subject: contractId
      })
      continue
    }
    if (!result.passed) {
      blockers.push({
        code: GateCodes.InterfaceContractFailed,
        message: `Required interface contract ${contractId} failed.`,
        subject: contractId
      })
    }
  }

  // Bullet 6: required rule packs.
  for (const rulePackId of policy.requiredRulePacks) {
    const result = input.rulePackResults.find(
      (packResult) => packResult.rulePackId === rulePackId
    )
    if (result === undefined) {
      blockers.push({
        code: GateCodes.RulePackNotRun,
        message: `Required rule pack ${rulePackId} did not run.`,
        subject: rulePackId
      })
      continue
    }
    if (!result.succeeded) {
      blockers.push({
        code: GateCodes.RulePackFailed,
        message: `Required rule pack ${rulePackId} did not complete successfully.`,
        subject: rulePackId
      })
    }
  }

  // Bullet 7: coverage and limitations shown to the candidate owner.
  const disclosure = input.coverageDisclosure
  if (disclosure === undefined) {
    blockers.push({
      code: GateCodes.CoverageNotDisplayed,
      message: "Rule coverage and system limitations were not shown to the candidate owner."
    })
  } else if (disclosure.acknowledgedBy !== candidate.proposedBy) {
    blockers.push({
      code: GateCodes.CoverageDisplayedToOther,
      message: `Rule coverage was acknowledged by ${disclosure.acknowledgedBy}, not by the candidate owner ${candidate.proposedBy}.`,
      subject: disclosure.acknowledgedBy
    })
  }

  // Bullet 8: artifacts regenerated from this candidate fingerprint.
  if (input.regeneratedArtifacts.fromCandidateFingerprint !== candidate.fingerprint) {
    blockers.push({
      code: GateCodes.ArtifactsFromOtherCandidate,
      message: "The artifacts were regenerated from a different candidate fingerprint."
    })
  }
  for (const [name, expected] of Object.entries(candidate.artifactHashes)) {
    const actual = input.regeneratedArtifacts.hashes[name]
    if (actual === undefined) {
      blockers.push({
        code: GateCodes.ArtifactMissing,
        message: `Artifact ${name} was not regenerated.`,
        subject: name
      })
      continue
    }
    if (actual !== expected) {
      blockers.push({
        code: GateCodes.ArtifactHashMismatch,
        message: `Artifact ${name} does not match the hash recorded on the candidate.`,
        subject: name
      })
    }
  }

  // Bullet 9: no required source stale or unverified beyond tolerance.
  for (const source of input.sources) {
    if (!source.required) continue
    if (source.status === "verified") continue
    if (source.staleForDays <= input.sourceStalenessToleranceDays) continue
    blockers.push({
      code:
        source.status === "stale" ? GateCodes.SourceStale : GateCodes.SourceUnverified,
      message: `Required source ${source.filename} is ${source.status} for ${source.staleForDays} days, beyond the tolerance of ${input.sourceStalenessToleranceDays} days.`,
      subject: source.filename
    })
  }

  return { ready: blockers.length === 0, blockers }
}

// ---------------------------------------------------------------------------
// §9.2 Revision review
// ---------------------------------------------------------------------------

/** The five views §9.2 step 2 requires a revision diff to cover. */
export type RevisionDomain =
  | "engineering"
  | "manufacturing"
  | "test"
  | "bom"
  | "interface-contract"

/**
 * One fingerprinted object on one side of a revision comparison.
 *
 * `downstreamArtifacts` is declared per object rather than derived here
 * because only the generator knows what it produced from what; §9.2 step 3
 * ranks by affected downstream artifacts, and a diff that guessed at that
 * edge would rank by a guess.
 */
export interface RevisionObject {
  /** Stable object ref in the §19 grammar, e.g. `connector:J1`. */
  readonly ref: string
  readonly domain: RevisionDomain
  readonly fingerprint: Fingerprint
  readonly downstreamArtifacts: ReadonlyArray<string>
}

/** One side of the comparison: the run and the objects it contained. */
export interface RevisionSide {
  readonly run: ReviewRun
  readonly objects: ReadonlyArray<RevisionObject>
}

export type RevisionChangeKind = "added" | "removed" | "changed" | "unchanged"

export interface RevisionChange {
  readonly ref: string
  readonly domain: RevisionDomain
  readonly kind: RevisionChangeKind
  readonly baselineFingerprint?: Fingerprint | undefined
  readonly candidateFingerprint?: Fingerprint | undefined
  /** Downstream artifacts named by either side, deduplicated and sorted. */
  readonly affectedArtifacts: ReadonlyArray<string>
  /** §9.2 step 3 ranking score. Zero for unchanged objects. */
  readonly riskScore: number
  /** §9.2 step 4: may the baseline's evidence stand in for this object? */
  readonly evidenceReusable: boolean
}

export interface RevisionDiff {
  readonly baselineRunId: string
  readonly candidateRunId: string
  /** Every object from either side, highest risk first (§9.2 step 3). */
  readonly changes: ReadonlyArray<RevisionChange>
  /** Count of changed objects per domain, for the §9.2 step 2 summary. */
  readonly changedByDomain: { readonly [D in RevisionDomain]: number }
  /** Downstream artifacts touched by at least one changed object. */
  readonly affectedArtifacts: ReadonlyArray<string>
  /** Refs whose evidence may be reused, already filtered by policy. */
  readonly reusableEvidenceRefs: ReadonlyArray<string>
  /** The policy's answer to §9.2 step 4, restated so a reader of the diff
   * can tell "nothing was reusable" from "reuse was not permitted". */
  readonly evidenceReusePermitted: boolean
  /** Refs a reviewer must look at: everything not reusable (§9.2 step 5). */
  readonly focusRefs: ReadonlyArray<string>
}

/**
 * §9.2 step 4, as a predicate rather than an assumption.
 *
 * Two conditions, and both are load-bearing. Identical fingerprints mean the
 * evidence still describes this exact object; the policy flag means the
 * organization has decided it accepts carried-forward evidence at all. A
 * match with the flag off is refused — that is the whole point of making
 * reuse opt-in (ORG-004), and it is the case a "fingerprints match, so reuse
 * it" shortcut gets wrong.
 */
export const evidenceReuseAllowed = (
  baselineFingerprint: Fingerprint | undefined,
  candidateFingerprint: Fingerprint | undefined,
  policy: Policy
): boolean =>
  policy.allowEvidenceReuse &&
  baselineFingerprint !== undefined &&
  baselineFingerprint === candidateFingerprint

/**
 * Risk weight per domain (§9.2 step 3).
 *
 * Interface contracts lead because a moved contract invalidates evidence on
 * both sides of the connector, including evidence in harnesses this review
 * never looked at. Engineering follows because it is what every other view is
 * generated from. BOM outranks manufacturing and test because a wrong part is
 * bought and installed before any downstream check runs.
 */
const domainRisk: { readonly [D in RevisionDomain]: number } = {
  "interface-contract": 5,
  engineering: 4,
  bom: 3,
  manufacturing: 2,
  test: 2
}

/**
 * Risk weight per kind of change.
 *
 * A removal outranks a modification because the checks that covered the
 * removed object leave with it and nothing reports their absence. An addition
 * ranks lowest of the real changes: it brings new evidence to review, but it
 * invalidates none of the evidence already approved.
 */
const kindRisk: { readonly [K in RevisionChangeKind]: number } = {
  removed: 3,
  changed: 2,
  added: 1,
  unchanged: 0
}

const mergeArtifacts = (
  baseline: RevisionObject | undefined,
  candidate: RevisionObject | undefined
): ReadonlyArray<string> =>
  [
    ...new Set([
      ...(baseline?.downstreamArtifacts ?? []),
      ...(candidate?.downstreamArtifacts ?? [])
    ])
  ].sort()

/**
 * Compare a candidate revision against a released baseline (§9.2).
 *
 * The result ranks every object so the reviewer's attention lands where §9.2
 * step 5 puts it — on changed and newly affected evidence — while still
 * listing the unchanged objects, because "this was not touched" is itself a
 * review finding the approver needs to see rather than infer from a gap.
 *
 * Ordering is fully determined by the inputs: score descending, then domain
 * risk, then ref. A diff shown twice must not reshuffle.
 */
export const diffRevisions = (
  baseline: RevisionSide,
  candidate: RevisionSide,
  policy: Policy
): RevisionDiff => {
  const baselineByRef = new Map(baseline.objects.map((object) => [object.ref, object]))
  const candidateByRef = new Map(candidate.objects.map((object) => [object.ref, object]))
  const refs = [...new Set([...baselineByRef.keys(), ...candidateByRef.keys()])]

  const changes: Array<RevisionChange> = refs.map((ref) => {
    const before = baselineByRef.get(ref)
    const after = candidateByRef.get(ref)
    const kind: RevisionChangeKind =
      before === undefined
        ? "added"
        : after === undefined
          ? "removed"
          : before.fingerprint === after.fingerprint
            ? "unchanged"
            : "changed"
    // An object present on one side only still has a domain; take it from
    // whichever side holds it.
    const domain = (after ?? before)?.domain ?? "engineering"
    const affectedArtifacts = mergeArtifacts(before, after)
    return {
      ref,
      domain,
      kind,
      baselineFingerprint: before?.fingerprint,
      candidateFingerprint: after?.fingerprint,
      affectedArtifacts,
      riskScore:
        kind === "unchanged"
          ? 0
          : domainRisk[domain] * kindRisk[kind] + affectedArtifacts.length,
      evidenceReusable: evidenceReuseAllowed(before?.fingerprint, after?.fingerprint, policy)
    }
  })

  changes.sort(
    (left, right) =>
      right.riskScore - left.riskScore ||
      domainRisk[right.domain] - domainRisk[left.domain] ||
      (left.ref < right.ref ? -1 : left.ref > right.ref ? 1 : 0)
  )

  const changedByDomain: { [D in RevisionDomain]: number } = {
    engineering: 0,
    manufacturing: 0,
    test: 0,
    bom: 0,
    "interface-contract": 0
  }
  const affected = new Set<string>()
  for (const change of changes) {
    if (change.kind === "unchanged") continue
    changedByDomain[change.domain] += 1
    for (const artifact of change.affectedArtifacts) affected.add(artifact)
  }

  return {
    baselineRunId: baseline.run.id,
    candidateRunId: candidate.run.id,
    changes,
    changedByDomain,
    affectedArtifacts: [...affected].sort(),
    reusableEvidenceRefs: changes
      .filter((change) => change.evidenceReusable)
      .map((change) => change.ref),
    evidenceReusePermitted: policy.allowEvidenceReuse,
    focusRefs: changes
      .filter((change) => !change.evidenceReusable)
      .map((change) => change.ref)
  }
}

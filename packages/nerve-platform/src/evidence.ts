/**
 * Evidence bundles and release admissibility (PRD §10.2 release half, §10.3).
 *
 * The bundle is the artifact a customer hands to an auditor years later, so
 * it has to be reproducible: the same candidate, the same entries, and the
 * same recorded exceptions must always produce the same fingerprint. That is
 * why entries are sorted by path before hashing. The archive's file order is
 * an accident of whichever generator emitted it, and an accident must not
 * fork the identity of the evidence — §10.2 ends with "the bundle
 * fingerprint matches the approved candidate fingerprint", which is only a
 * checkable statement if the bundle has one fingerprint rather than one per
 * traversal order. The recorded exception lines are sorted for the same
 * reason.
 *
 * `exceptions` is not decoration. §10.3 says the one-person approval
 * exception must be visible in the evidence bundle, so it is written as a
 * sentence a reader who has never seen this product can understand, and the
 * release check refuses when an exception was used but the bundle does not
 * state it.
 *
 * Verified against effect 3.22.1 (the version installed for the `^3.16.0`
 * range in this package); `EvidenceBundle` and friends are the
 * `Schema`-derived types from `objects.ts`.
 */
import type { Fingerprint } from "./fingerprint.js"
import { fingerprint } from "./fingerprint.js"
import { PLATFORM_SCHEMA_VERSION } from "./objects.js"
import type {
  Approval,
  EvidenceBundle,
  Policy,
  Project,
  ReleaseCandidate
} from "./objects.js"

/** One named item in the archive, verifiable without unpacking it. */
export interface BundleEntry {
  readonly path: string
  readonly contentHash: string
  readonly byteLength: number
}

/** One reason a candidate may not be released. */
export interface ReleaseRefusal {
  readonly code: string
  readonly message: string
}

/**
 * Stable codes, in the order of the §10.2 bullets they enforce: the gate,
 * the required approvals, the recorded identities and timestamps, the
 * generated bundle, and the fingerprint match.
 */
export const ReleaseCodes = {
  /** §10.2: the default gate did not pass. */
  GateFailed: "PL-REL-001",
  /** §10.2: nothing was approved. */
  NoApprovals: "PL-REL-002",
  /** §10.2: an approval refers to a different candidate. */
  ApprovalOnOtherCandidate: "PL-REL-003",
  /** §10.2: an approval records no approver identity. */
  ApprovalIdentityMissing: "PL-REL-004",
  /** §10.2: an approval records no timestamp. */
  ApprovalTimestampMissing: "PL-REL-005",
  /** §10.3: only the preparer approved, without a recorded exception. */
  SelfApprovalWithoutException: "PL-REL-006",
  /** §10.2: a user the policy names has not approved. */
  MissingRequiredApprover: "PL-REL-007",
  /** §10.2: evidence-bundle generation did not succeed. */
  BundleMissing: "PL-REL-008",
  /** §10.2: the bundle was built for a different candidate. */
  BundleCandidateMismatch: "PL-REL-009",
  /** §10.2: the bundle's contents do not hash to its own fingerprint. */
  BundleFingerprintMismatch: "PL-REL-010",
  /** §10.3: an exception was used but the bundle does not state it. */
  ExceptionNotRecorded: "PL-REL-011"
} as const

/** Sort by path, so archive traversal order cannot fork bundle identity. */
const byPath = (
  entries: ReadonlyArray<BundleEntry>
): ReadonlyArray<BundleEntry> =>
  [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

/**
 * One sentence per single-approver exception (§10.3).
 *
 * Written from the approval rather than from the policy flag: the flag says
 * the exception was available, the approval says it was used, and the bundle
 * must report what happened.
 */
export const singleApproverExceptionLines = (
  candidate: ReleaseCandidate,
  project: Project,
  approvals: ReadonlyArray<Approval>
): ReadonlyArray<string> =>
  approvals
    .filter((approval) => approval.singleApproverException)
    .map(
      (approval) =>
        `Single-approver exception (PRD 10.3): user ${approval.approvedBy} prepared and approved release candidate ${candidate.id} on the non-production project ${project.name} (${project.id}) at ${approval.approvedAt}.`
    )
    .sort()

/**
 * Content identity of a bundle, taken over the sorted entries and sorted
 * exception lines and over nothing else. The stored `fingerprint` is
 * excluded, so the value can be recomputed from a bundle on disk and
 * compared with what it claims to be.
 */
export const evidenceBundleFingerprint = (
  bundle: Omit<EvidenceBundle, "fingerprint">
): Fingerprint =>
  fingerprint({
    schemaVersion: bundle.schemaVersion,
    releaseCandidateFingerprint: bundle.releaseCandidateFingerprint,
    entries: byPath(bundle.entries).map((entry) => ({
      path: entry.path,
      contentHash: entry.contentHash,
      byteLength: entry.byteLength
    })),
    exceptions: [...bundle.exceptions].sort()
  })

/**
 * Build the bundle for a candidate (§10.2, §10.3).
 *
 * Deterministic by construction: the caller may pass entries in any order,
 * and two callers that pass the same set get the same fingerprint.
 */
export const buildEvidenceBundle = (input: {
  readonly candidate: ReleaseCandidate
  readonly project: Project
  readonly approvals: ReadonlyArray<Approval>
  readonly entries: ReadonlyArray<BundleEntry>
}): EvidenceBundle => {
  const draft = {
    schemaVersion: PLATFORM_SCHEMA_VERSION,
    releaseCandidateFingerprint: input.candidate.fingerprint,
    entries: byPath(input.entries),
    exceptions: singleApproverExceptionLines(
      input.candidate,
      input.project,
      input.approvals
    )
  }
  return { ...draft, fingerprint: evidenceBundleFingerprint(draft) }
}

/** Blank strings do not count as a recorded identity or timestamp. */
const absent = (value: string): boolean => value.trim() === ""

/**
 * Everything §10.2 needs to decide a release. `bundle` is `undefined` when
 * generation failed — the fourth bullet is a real outcome, not an exception
 * to swallow, so it is modelled in the input rather than thrown.
 */
export interface ProposedRelease {
  readonly candidate: ReleaseCandidate
  readonly policy: Policy
  readonly approvals: ReadonlyArray<Approval>
  readonly bundle: EvidenceBundle | undefined
  /** Verdict of the default gate, decided by the review module. */
  readonly gatePassed: boolean
}

/**
 * List every reason a candidate may not be released (§10.2). An empty array
 * means it may — a candidate is `Released` only when all five bullets hold,
 * so the check reports all of them at once instead of stopping at the first.
 */
export const validateRelease = (
  proposed: ProposedRelease
): ReadonlyArray<ReleaseRefusal> => {
  const { approvals, bundle, candidate, policy } = proposed
  const refusals: Array<ReleaseRefusal> = []

  if (!proposed.gatePassed) {
    refusals.push({
      code: ReleaseCodes.GateFailed,
      message: "The default gate did not pass."
    })
  }

  // An approval given against a different candidate fingerprint is an
  // approval of different work; it is reported and then ignored.
  const forCandidate = approvals.filter(
    (approval) => approval.candidateFingerprint === candidate.fingerprint
  )
  if (forCandidate.length < approvals.length) {
    refusals.push({
      code: ReleaseCodes.ApprovalOnOtherCandidate,
      message: "An approval refers to a different release candidate."
    })
  }

  if (forCandidate.length === 0) {
    refusals.push({
      code: ReleaseCodes.NoApprovals,
      message: "The candidate has no approvals."
    })
  } else {
    if (forCandidate.some((approval) => absent(approval.approvedBy))) {
      refusals.push({
        code: ReleaseCodes.ApprovalIdentityMissing,
        message: "An approval does not record who approved."
      })
    }
    if (forCandidate.some((approval) => absent(approval.approvedAt))) {
      refusals.push({
        code: ReleaseCodes.ApprovalTimestampMissing,
        message: "An approval does not record when it was given."
      })
    }
    // §10.3: a second person, or a recorded exception. Nothing else.
    const independent = forCandidate.some(
      (approval) => approval.approvedBy !== candidate.proposedBy
    )
    const exceptionUsed = forCandidate.some(
      (approval) => approval.singleApproverException
    )
    if (!independent && !exceptionUsed) {
      refusals.push({
        code: ReleaseCodes.SelfApprovalWithoutException,
        message:
          "Only the user who prepared the candidate approved it, and no single-approver exception is recorded."
      })
    }
  }

  const approverIds = forCandidate.map((approval) => approval.approvedBy)
  for (const requiredId of policy.requiredApproverIds) {
    if (!approverIds.includes(requiredId)) {
      refusals.push({
        code: ReleaseCodes.MissingRequiredApprover,
        message: `The policy requires an approval from user ${requiredId}.`
      })
    }
  }

  if (bundle === undefined) {
    refusals.push({
      code: ReleaseCodes.BundleMissing,
      message: "The evidence bundle was not generated."
    })
    return refusals
  }

  if (bundle.releaseCandidateFingerprint !== candidate.fingerprint) {
    refusals.push({
      code: ReleaseCodes.BundleCandidateMismatch,
      message: "The evidence bundle was built for a different release candidate."
    })
  }
  if (evidenceBundleFingerprint(bundle) !== bundle.fingerprint) {
    refusals.push({
      code: ReleaseCodes.BundleFingerprintMismatch,
      message: "The contents of the evidence bundle do not agree with its fingerprint."
    })
  }
  if (
    forCandidate.some((approval) => approval.singleApproverException) &&
    bundle.exceptions.length === 0
  ) {
    refusals.push({
      code: ReleaseCodes.ExceptionNotRecorded,
      message:
        "A single-approver exception was used, but the evidence bundle does not state it."
    })
  }

  return refusals
}

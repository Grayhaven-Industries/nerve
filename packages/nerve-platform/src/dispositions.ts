/**
 * Dispositions and waiver scope (PRD §9.3).
 *
 * Two questions live here, and they are deliberately separate. The first is
 * whether a reviewer's decision is complete enough to be recorded at all
 * (§9.3 steps 3 and 4). The second is whether a decision already on file
 * still covers a finding in front of the gate (§9.3 step 5).
 *
 * Both answer with data, not with prose or with a bare boolean. A gate that
 * says "this disposition is invalid" tells the reviewer nothing; a gate that
 * says `PL-DISP-005` tells them the policy demands an expiration date, and
 * lets CI, docs, and the evidence bundle refer to the same fact across
 * releases. The codes therefore behave like the compiler's diagnostic codes
 * (`packages/nerve/src/diagnostics.ts`): stable, and never renumbered.
 *
 * Verified against effect 3.22.1 (the version installed for the `^3.16.0`
 * range in this package). Only the types derived from the `Schema` structs in
 * `objects.ts` are used here — validation of a disposition's shape is the
 * codec's job at the boundary, and this module judges its content.
 */
import type { Disposition, Finding, Policy } from "./objects.js"

/**
 * One unmet requirement. Shaped like a `Diagnostic` minus severity, because
 * every problem here blocks the same thing: recording the disposition.
 */
export interface DispositionProblem {
  readonly code: string
  readonly message: string
}

/**
 * Stable problem codes. `001` and `002` come from §9.3 step 3, which applies
 * to every non-fixed state; `003` through `006` come from §9.3 step 4, where
 * the organization's policy adds requirements on top.
 */
export const DispositionCodes = {
  /** §9.3 step 3: a decision without a reason cannot be audited later. */
  MissingReason: "PL-DISP-001",
  /** §9.3 step 3: a waiver with no owner has nobody to come back to. */
  MissingOwner: "PL-DISP-002",
  /** §9.3 step 4: `policy.waiverRequirements.requireApprover`. */
  MissingApprover: "PL-DISP-003",
  /** §9.3 step 4: `policy.waiverRequirements.requireAttachment`. */
  MissingAttachment: "PL-DISP-004",
  /** §9.3 step 4: `policy.waiverRequirements.requireExpiry`. */
  MissingExpiry: "PL-DISP-005",
  /** §9.3 step 4: `policy.waiverRequirements.requireIssueLink`. */
  MissingIssueLink: "PL-DISP-006"
} as const

/**
 * A field is absent when it is missing or holds only space. A reason of `" "`
 * satisfies the type but not the intent, and the gate must not accept a
 * keystroke as an audit record.
 */
const absent = (value: string | undefined): boolean =>
  value === undefined || value.trim() === ""

/** How each state reads in a message, so the text stays plain. */
const stateNames: { readonly [S in Disposition["state"]]: string } = {
  "fixed-in-new-run": "fixed in new run",
  "accepted-risk": "accepted risk",
  "false-positive": "false positive",
  "not-applicable": "not applicable",
  deferred: "deferred"
}

/**
 * List every requirement a disposition does not meet (§9.3 steps 3 and 4).
 * An empty array means the disposition can be recorded.
 *
 * `fixed in new run` returns early with no problems. It is not a waiver: it
 * says the finding is gone in a later submission, and the later run either
 * shows that or does not. Every other state keeps a finding open on the
 * customer's authority, so it must name a reason and an owner, and it must
 * carry whatever the organization additionally requires.
 */
export const validateDisposition = (
  d: Disposition,
  p: Policy
): ReadonlyArray<DispositionProblem> => {
  if (d.state === "fixed-in-new-run") return []

  const stateName = stateNames[d.state]
  const problems: Array<DispositionProblem> = []

  if (absent(d.reason)) {
    problems.push({
      code: DispositionCodes.MissingReason,
      message: `A "${stateName}" disposition must have a reason.`
    })
  }
  if (absent(d.ownerId)) {
    problems.push({
      code: DispositionCodes.MissingOwner,
      message: `A "${stateName}" disposition must have an owner.`
    })
  }

  const required = p.waiverRequirements
  if (required.requireApprover && absent(d.approverId)) {
    problems.push({
      code: DispositionCodes.MissingApprover,
      message: "The policy requires an approver for this disposition."
    })
  }
  if (required.requireAttachment && absent(d.attachmentId)) {
    problems.push({
      code: DispositionCodes.MissingAttachment,
      message: "The policy requires an attachment for this disposition."
    })
  }
  if (required.requireExpiry && absent(d.expiresAt)) {
    problems.push({
      code: DispositionCodes.MissingExpiry,
      message: "The policy requires an expiration date for this disposition."
    })
  }
  if (required.requireIssueLink && absent(d.issueLink)) {
    problems.push({
      code: DispositionCodes.MissingIssueLink,
      message: "The policy requires an issue link for this disposition."
    })
  }

  return problems
}

/**
 * Has the disposition run out at `now`?
 *
 * A timestamp neither side can parse counts as expired. The alternative is to
 * ignore an unreadable expiration date, which would turn a data problem into
 * a silently permanent waiver.
 */
const hasExpired = (expiresAt: string, now: string): boolean => {
  const deadline = Date.parse(expiresAt)
  const instant = Date.parse(now)
  if (Number.isNaN(deadline) || Number.isNaN(instant)) return true
  return instant > deadline
}

/**
 * Does an existing disposition cover this finding, in this submission?
 * (§9.3 step 5.)
 *
 * The rule is written to refuse, not to reach. A waiver applies to its own
 * rule, its own object, and its own source fingerprint; anything else needs
 * an administrator to define a broader policy exception deliberately. The
 * source-fingerprint test is the important one: it is what stops a waiver
 * written against one submission from carrying itself onto a changed one,
 * where the measurement behind the accepted risk may no longer hold.
 *
 * Two details follow from the shapes in `objects.ts`:
 *
 * - A `Finding` records no harness. The harness dimension of step 5 is
 *   carried by the fingerprint instead: a source set belongs to exactly one
 *   harness (`SourceSet.harnessId`), so equality on `sourceSetFingerprint`
 *   already binds the waiver to that harness's submission.
 * - The object test is exact equality, including the case where both sides
 *   name no object. A scope that names no object does not spread to findings
 *   that do; narrowness is the point of step 5.
 *
 * `now` is the last parameter and optional so the frozen three-argument call
 * still type-checks. When it is omitted the expiration clause is not judged,
 * because the caller has supplied no clock — gate callers pass the run's
 * timestamp. The function never reads the wall clock itself, so the same
 * inputs always give the same verdict.
 */
export const dispositionApplies = (
  d: Disposition,
  f: Finding,
  sourceSetFingerprint: string,
  now?: string | undefined
): boolean => {
  if (d.scope.sourceSetFingerprint !== sourceSetFingerprint) return false
  if (d.scope.code !== f.code) return false
  if (d.scope.target !== f.target) return false
  if (d.expiresAt !== undefined && now !== undefined && hasExpired(d.expiresAt, now)) {
    return false
  }
  return true
}

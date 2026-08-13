/**
 * Approval admissibility and invalidation (PRD §10.3, §9.4 step 4).
 *
 * The default approval policy is a separation of duties, not a counter: one
 * engineer prepares a candidate and one *different* authorized user approves
 * it. The preparer cannot satisfy the reviewer requirement. Everything else
 * in this module is subordinate to that sentence, so the self-approval test
 * runs first and is the one rule that cannot be satisfied by holding a
 * stronger role.
 *
 * §10.3 permits one exception, and it is scoped twice over: the organization
 * must have configured `policy.allowSingleApprover`, and the project must be
 * non-production. A production project refuses the exception even when the
 * flag is set, because a pilot's convenience must not follow the
 * configuration into work that ships. When the exception is used the
 * resulting `Approval` records `singleApproverException: true`, which is what
 * makes it visible in the evidence bundle rather than inferred from a
 * missing second signature.
 *
 * Verified against effect 3.22.1 (the version installed for the `^3.16.0`
 * range in this package); the object types here are the `Schema`-derived
 * types from `objects.ts`.
 */
import { can } from "./access.js"
import type {
  Approval,
  Membership,
  Policy,
  Project,
  ReleaseCandidate
} from "./objects.js"

/** One reason an approval was refused, or one reason approvals fell away. */
export interface ApprovalRefusal {
  readonly code: string
  readonly message: string
}

/**
 * Stable codes. `001`–`004` refuse a proposed approval (§10.3); `010`–`013`
 * report an input that moved out from under approvals already given
 * (§9.4 step 4). The two ranges are kept apart so a reader can tell "you may
 * not sign this" from "what you signed no longer exists".
 */
export const ApprovalCodes = {
  /** §10.3: the preparer proposed themselves, and no exception applies. */
  SelfApproval: "PL-APPR-001",
  /** §10.3: the one-person exception is configured but the project ships. */
  SingleApproverOnProduction: "PL-APPR-002",
  /** ORG-003: the user does not hold `review:approve` in this scope. */
  NotAuthorized: "PL-APPR-003",
  /** §10.3: the policy names its approvers, and this user is not one. */
  NotRequiredApprover: "PL-APPR-004",
  /** §9.4 step 4: the submission changed. */
  SourceChanged: "PL-APPR-010",
  /** §9.4 step 4: the rules or the engine that applied them changed. */
  RulesChanged: "PL-APPR-011",
  /** §9.4 step 4: the policy the candidate was judged under changed. */
  PolicyChanged: "PL-APPR-012",
  /** §9.4 step 4: a resolved dependency version changed. */
  DependenciesChanged: "PL-APPR-013"
} as const

/**
 * Everything the §10.3 decision needs, passed in rather than fetched, so the
 * rule is a pure function of stated facts and the audit trail can replay it.
 * `approvedAt` is a parameter for the same reason: the recorded timestamp
 * must be the one the caller attests to, not whatever the clock said when
 * this code happened to run.
 */
export interface ProposedApproval {
  readonly candidate: ReleaseCandidate
  readonly approverId: string
  /** The approver's membership, or `undefined` when they have none. */
  readonly membership: Membership | undefined
  /** The project the candidate belongs to; `production` gates the exception. */
  readonly project: Project
  readonly policy: Policy
  readonly approvedAt: string
}

/**
 * Admissible approvals come back as the `Approval` to record, so a caller
 * cannot forget to set `singleApproverException` on the way out; refused ones
 * come back as every reason at once, so a reviewer fixes them in one pass.
 */
export type ApprovalDecision =
  | { readonly admissible: true; readonly approval: Approval }
  | { readonly admissible: false; readonly refusals: ReadonlyArray<ApprovalRefusal> }

/**
 * Decide whether a proposed approval may be recorded (§10.3).
 *
 * Three tests run, and all of them run before anything is returned: the
 * separation of duties, the authorization check through `can`, and the
 * policy's named-approver list. The list is only applied when it is
 * non-empty — an empty `requiredApproverIds` means "any authorized user",
 * which `can` has already decided.
 */
export const proposeApproval = (proposed: ProposedApproval): ApprovalDecision => {
  const { approverId, candidate, membership, policy, project } = proposed
  const refusals: Array<ApprovalRefusal> = []

  // §10.3, first and hardest: the preparer cannot approve their own
  // candidate. Only a configured exception on a non-production project
  // converts this from a refusal into a recorded exception.
  const isPreparer = approverId === candidate.proposedBy
  let singleApproverException = false
  if (isPreparer) {
    if (!policy.allowSingleApprover) {
      refusals.push({
        code: ApprovalCodes.SelfApproval,
        message:
          "The user who prepared the candidate cannot approve it. A different authorized user must approve."
      })
    } else if (project.production) {
      refusals.push({
        code: ApprovalCodes.SingleApproverOnProduction,
        message:
          "One-person approval is permitted only on non-production projects. This project is production."
      })
    } else {
      singleApproverException = true
    }
  }

  if (
    !can(membership, "review:approve", {
      organizationId: project.organizationId,
      projectId: project.id
    })
  ) {
    refusals.push({
      code: ApprovalCodes.NotAuthorized,
      message: "The user is not permitted to approve reviews on this project."
    })
  }

  if (
    policy.requiredApproverIds.length > 0 &&
    !policy.requiredApproverIds.includes(approverId)
  ) {
    refusals.push({
      code: ApprovalCodes.NotRequiredApprover,
      message: "The policy names the users who must approve. This user is not one of them."
    })
  }

  if (refusals.length > 0) return { admissible: false, refusals }

  return {
    admissible: true,
    approval: {
      candidateFingerprint: candidate.fingerprint,
      approvedBy: approverId,
      approvedAt: proposed.approvedAt,
      singleApproverException
    }
  }
}

/**
 * The four identities an approval is given against (§9.4 step 4).
 *
 * They are separate fields rather than one candidate fingerprint because the
 * refusal must name what moved. "Your approval is stale" sends a reviewer
 * looking; "the rule pack changed" tells them what to read.
 */
export interface CandidateInputs {
  readonly sourceSetFingerprint: string
  /** Identity of the rule packs and the engine that applied them. */
  readonly ruleFingerprint: string
  readonly policyFingerprint: string
  /** Identity of the resolved dependency versions (`SourceSet.dependencyVersions`). */
  readonly dependencyFingerprint: string
}

export interface ApprovalInvalidation {
  /** Approvals that still refer to the thing being released. */
  readonly retained: ReadonlyArray<Approval>
  /** Approvals that no longer do, and must be collected again. */
  readonly invalidated: ReadonlyArray<Approval>
  /** Which inputs moved; empty exactly when nothing was invalidated. */
  readonly reasons: ReadonlyArray<ApprovalRefusal>
}

/**
 * Drop approvals whose inputs have moved (§9.4 step 4).
 *
 * Any one change invalidates every approval, not the ones "affected by" it.
 * An approver attested to a whole candidate — its source, its rules, its
 * policy, its dependencies — so once any of those differs, none of the
 * signatures describes what would ship, and there is no partial credit to
 * award.
 */
export const invalidateApprovals = (
  approvals: ReadonlyArray<Approval>,
  approved: CandidateInputs,
  current: CandidateInputs
): ApprovalInvalidation => {
  const reasons: Array<ApprovalRefusal> = []

  if (approved.sourceSetFingerprint !== current.sourceSetFingerprint) {
    reasons.push({
      code: ApprovalCodes.SourceChanged,
      message: "The source set changed after the approvals were given."
    })
  }
  if (approved.ruleFingerprint !== current.ruleFingerprint) {
    reasons.push({
      code: ApprovalCodes.RulesChanged,
      message: "The rules changed after the approvals were given."
    })
  }
  if (approved.policyFingerprint !== current.policyFingerprint) {
    reasons.push({
      code: ApprovalCodes.PolicyChanged,
      message: "The policy changed after the approvals were given."
    })
  }
  if (approved.dependencyFingerprint !== current.dependencyFingerprint) {
    reasons.push({
      code: ApprovalCodes.DependenciesChanged,
      message: "A dependency version changed after the approvals were given."
    })
  }

  if (reasons.length === 0) {
    return { retained: approvals, invalidated: [], reasons }
  }
  return { retained: [], invalidated: approvals, reasons }
}

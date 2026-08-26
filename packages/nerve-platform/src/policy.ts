/**
 * Release policy resolution (PRD ORG-004, §10.2).
 *
 * A policy is configuration that changes verdicts, so it has to behave like
 * an input to the review rather than like a setting read at display time.
 * That is why the severity a finding is judged at is computed here from the
 * rule's own severity plus the organization's overrides, and why the policy
 * carries a fingerprint: §10.2 invalidates an approval when policy moves, and
 * "moved" is only decidable if the policy has a content identity.
 */
import type { Canonical, Fingerprint } from "./fingerprint.js"
import { fingerprint } from "./fingerprint.js"
import type { Policy, Severity } from "./objects.js"

/**
 * The severity a finding is judged at (ORG-004).
 *
 * The rule's severity is the fallback, not the answer: an organization may
 * decide a rule blocks release, or that it only informs, and the gate must
 * read the organization's decision. The finding keeps `ruleSeverity` beside
 * the effective one so a reviewer can see that a downgrade came from
 * configuration rather than from the rule going quiet.
 */
export const effectiveSeverity = (
  code: string,
  ruleSeverity: Severity,
  policy: Policy
): Severity => policy.severityOverrides[code] ?? ruleSeverity

/**
 * Content identity of a policy (§10.2).
 *
 * Taken over every configured field except the fingerprint itself, through
 * the shared canonical encoder, so two policies that differ only in key order
 * or in how they were assembled are recognized as the same policy and do not
 * spuriously invalidate approvals.
 *
 * Every field the gate reads has to appear here, `sourceStalenessToleranceDays`
 * included: a field that changes a verdict but not the digest would let an
 * administrator loosen a release rule while `invalidateApprovals` reports no
 * policy change, and a candidate approved under the strict rule would release
 * under the loose one. The `satisfies` clause below is what keeps that true —
 * a field added to the Policy schema fails to compile until it is hashed.
 *
 * The three set-valued lists are sorted first because every consumer treats
 * them as sets (membership tests, not sequences), so a reordered list is the
 * same policy; hashing caller order would invalidate outstanding approvals for
 * a UI drag or a changed database row order. `sourceSetFingerprint` sorts its
 * interface contracts for the same reason.
 */
export const policyFingerprint = (policy: Omit<Policy, "fingerprint">): Fingerprint =>
  fingerprint({
    id: policy.id,
    organizationId: policy.organizationId,
    requiredRulePacks: [...policy.requiredRulePacks].sort(),
    requiredInterfaceContracts: [...policy.requiredInterfaceContracts].sort(),
    severityOverrides: policy.severityOverrides,
    requireWarningAcknowledgement: policy.requireWarningAcknowledgement,
    waiverRequirements: {
      requireApprover: policy.waiverRequirements.requireApprover,
      requireAttachment: policy.waiverRequirements.requireAttachment,
      requireExpiry: policy.waiverRequirements.requireExpiry,
      requireIssueLink: policy.waiverRequirements.requireIssueLink
    },
    requiredApproverIds: [...policy.requiredApproverIds].sort(),
    allowSingleApprover: policy.allowSingleApprover,
    allowEvidenceReuse: policy.allowEvidenceReuse,
    retentionDays: policy.retentionDays,
    sourceStalenessToleranceDays: policy.sourceStalenessToleranceDays
  } satisfies { readonly [K in keyof Omit<Policy, "fingerprint">]: Canonical })

import { describe, expect, it } from "vitest"
import type { Action } from "../src/access.js"
import { can, roleRank } from "../src/access.js"
import { effectiveSeverity, policyFingerprint } from "../src/policy.js"
import type { Membership, Policy, Role } from "../src/objects.js"

const membership = (role: Role, over?: Partial<Membership>): Membership => ({
  userId: "u1",
  organizationId: "org1",
  role,
  ...over
})

const actions: ReadonlyArray<Action> = [
  "org:manage",
  "member:invite",
  "project:read",
  "project:write",
  "review:create",
  "review:disposition",
  "review:approve",
  "release:publish"
]

/** Actions each role holds org-wide; anything absent must be denied. */
const held: { readonly [R in Role]: ReadonlyArray<Action> } = {
  viewer: ["project:read"],
  reviewer: ["project:read", "review:disposition", "review:approve"],
  engineer: [
    "project:read",
    "project:write",
    "review:create",
    "review:disposition",
    "review:approve",
    "release:publish"
  ],
  admin: actions
}

describe("can — boundaries (ORG-003)", () => {
  it("denies an absent membership", () => {
    expect(can(undefined, "project:read", { organizationId: "org1" })).toBe(false)
  })

  it("denies a membership from another organization, whatever the role", () => {
    const admin = membership("admin", { organizationId: "org2" })
    for (const action of actions) {
      expect(can(admin, action, { organizationId: "org1" })).toBe(false)
    }
  })

  it("denies a project-scoped membership on a project it does not name", () => {
    const engineer = membership("engineer", { projectIds: ["p1"] })
    expect(can(engineer, "project:write", { organizationId: "org1", projectId: "p1" })).toBe(true)
    expect(can(engineer, "project:write", { organizationId: "org1", projectId: "p2" })).toBe(false)
  })

  it("denies a project-scoped membership an org-wide question", () => {
    const admin = membership("admin", { projectIds: ["p1"] })
    expect(can(admin, "org:manage", { organizationId: "org1" })).toBe(false)
    expect(can(admin, "org:manage", { organizationId: "org1", projectId: "p1" })).toBe(true)
  })

  it("grants an org-wide membership on any project of that organization", () => {
    const engineer = membership("engineer")
    expect(can(engineer, "project:write", { organizationId: "org1" })).toBe(true)
    expect(can(engineer, "project:write", { organizationId: "org1", projectId: "anything" })).toBe(true)
  })
})

describe("can — role action sets (ORG-002, ORG-004, §10.3)", () => {
  for (const role of ["viewer", "reviewer", "engineer", "admin"] as const) {
    it(`${role} holds exactly its documented actions`, () => {
      for (const action of actions) {
        expect(can(membership(role), action, { organizationId: "org1" })).toBe(
          held[role].includes(action)
        )
      }
    })
  }

  it("lets a reviewer approve but never manage the organization", () => {
    const reviewer = membership("reviewer")
    expect(can(reviewer, "review:approve", { organizationId: "org1" })).toBe(true)
    expect(can(reviewer, "org:manage", { organizationId: "org1" })).toBe(false)
    expect(can(reviewer, "member:invite", { organizationId: "org1" })).toBe(false)
  })

  /**
   * §10.3 asks for "one different authorized user", not for a different role.
   * A second engineer is an admissible approver — the separation that actually
   * protects the release is preparer-versus-approver, and `proposeApproval`
   * enforces it. Withholding the permission here would instead impose a
   * staffing rule on the two-engineer teams §6.1 names as target customers.
   */
  it("lets an engineer approve, since §10.3 separates people and not roles", () => {
    expect(can(membership("engineer"), "review:approve", { organizationId: "org1" })).toBe(true)
    expect(roleRank.engineer).toBeGreaterThan(roleRank.reviewer)
  })

  it("gives a viewer read only", () => {
    const viewer = membership("viewer")
    expect(can(viewer, "project:read", { organizationId: "org1" })).toBe(true)
    expect(can(viewer, "project:write", { organizationId: "org1" })).toBe(false)
    expect(can(viewer, "review:disposition", { organizationId: "org1" })).toBe(false)
  })
})

const basePolicy: Policy = {
  id: "pol1",
  organizationId: "org1",
  requiredRulePacks: ["core", "shop"],
  requiredInterfaceContracts: ["ic1"],
  severityOverrides: { "HK-WIRE-001": "error", "HK-LABEL-003": "info" },
  requireWarningAcknowledgement: true,
  waiverRequirements: {
    requireApprover: true,
    requireAttachment: false,
    requireExpiry: true,
    requireIssueLink: false
  },
  requiredApproverIds: ["u9"],
  allowSingleApprover: false,
  allowEvidenceReuse: true,
  retentionDays: 365,
  sourceStalenessToleranceDays: 30,
  fingerprint: "sha256:unused"
}

describe("effectiveSeverity (ORG-004)", () => {
  it("applies an override when the policy names the code", () => {
    expect(effectiveSeverity("HK-WIRE-001", "warning", basePolicy)).toBe("error")
    expect(effectiveSeverity("HK-LABEL-003", "error", basePolicy)).toBe("info")
  })

  it("falls back to the rule's own severity for an unlisted code", () => {
    expect(effectiveSeverity("HK-CONN-001", "warning", basePolicy)).toBe("warning")
  })
})

describe("policyFingerprint (§10.2)", () => {
  it("is stable under key reordering of the policy and its nested records", () => {
    const reordered = {
      retentionDays: basePolicy.retentionDays,
      sourceStalenessToleranceDays: basePolicy.sourceStalenessToleranceDays,
      allowEvidenceReuse: basePolicy.allowEvidenceReuse,
      allowSingleApprover: basePolicy.allowSingleApprover,
      requiredApproverIds: basePolicy.requiredApproverIds,
      waiverRequirements: {
        requireIssueLink: basePolicy.waiverRequirements.requireIssueLink,
        requireExpiry: basePolicy.waiverRequirements.requireExpiry,
        requireAttachment: basePolicy.waiverRequirements.requireAttachment,
        requireApprover: basePolicy.waiverRequirements.requireApprover
      },
      requireWarningAcknowledgement: basePolicy.requireWarningAcknowledgement,
      severityOverrides: {
        "HK-LABEL-003": basePolicy.severityOverrides["HK-LABEL-003"] ?? "info",
        "HK-WIRE-001": basePolicy.severityOverrides["HK-WIRE-001"] ?? "error"
      },
      requiredInterfaceContracts: basePolicy.requiredInterfaceContracts,
      requiredRulePacks: basePolicy.requiredRulePacks,
      organizationId: basePolicy.organizationId,
      id: basePolicy.id
    } satisfies Omit<Policy, "fingerprint">

    expect(policyFingerprint(reordered)).toBe(policyFingerprint(basePolicy))
  })

  /**
   * Every field the fingerprint hashes, each relaxed the way an administrator
   * would relax it.
   *
   * §10.2 invalidates an approval by comparing the pinned policy fingerprint
   * with the current one, so a field that changes a verdict but leaves the
   * digest unmoved silently keeps approvals given under the stricter policy
   * (`invalidateApprovals`, PL-APPR-012). Pinning one field is not enough:
   * the digest has to move for all of them, so the table is exhaustive over
   * what `policyFingerprint` reads.
   *
   * `sourceStalenessToleranceDays` is the case that made this table
   * exhaustive: it changed the gate's verdict (§10.2, last bullet) while the
   * digest stood still, so an administrator could widen the tolerance after
   * approval and release a candidate the strict rule had blocked.
   *
   * The table is driven by a plain loop around `it`, as the role table above
   * is, rather than by `it.each` (vitest 4.1.10, the version the suite runs on).
   */
  const relaxations: ReadonlyArray<{
    readonly field: string
    readonly relax: (policy: Policy) => Policy
  }> = [
    { field: "id", relax: (p) => ({ ...p, id: "pol2" }) },
    { field: "organizationId", relax: (p) => ({ ...p, organizationId: "org2" }) },
    { field: "requiredRulePacks", relax: (p) => ({ ...p, requiredRulePacks: ["core"] }) },
    {
      field: "requiredInterfaceContracts",
      relax: (p) => ({ ...p, requiredInterfaceContracts: [] })
    },
    {
      field: "severityOverrides",
      relax: (p) => ({
        ...p,
        severityOverrides: { ...p.severityOverrides, "HK-WIRE-001": "warning" }
      })
    },
    {
      field: "requireWarningAcknowledgement",
      relax: (p) => ({ ...p, requireWarningAcknowledgement: !p.requireWarningAcknowledgement })
    },
    {
      field: "waiverRequirements",
      relax: (p) => ({
        ...p,
        waiverRequirements: { ...p.waiverRequirements, requireExpiry: !p.waiverRequirements.requireExpiry }
      })
    },
    {
      field: "requiredApproverIds",
      relax: (p) => ({ ...p, requiredApproverIds: [...p.requiredApproverIds, "u10"] })
    },
    {
      field: "allowSingleApprover",
      relax: (p) => ({ ...p, allowSingleApprover: !p.allowSingleApprover })
    },
    { field: "allowEvidenceReuse", relax: (p) => ({ ...p, allowEvidenceReuse: !p.allowEvidenceReuse }) },
    { field: "retentionDays", relax: (p) => ({ ...p, retentionDays: 30 }) },
    {
      field: "sourceStalenessToleranceDays",
      relax: (p) => ({ ...p, sourceStalenessToleranceDays: 3650 })
    }
  ]

  for (const { field, relax } of relaxations) {
    it(`moves when ${field} changes, so §10.2 can invalidate approvals`, () => {
      expect(policyFingerprint(relax(basePolicy))).not.toBe(policyFingerprint(basePolicy))
    })
  }

  it("ignores the stored fingerprint field", () => {
    const restamped: Policy = { ...basePolicy, fingerprint: "sha256:something-else" }
    expect(policyFingerprint(restamped)).toBe(policyFingerprint(basePolicy))
  })

  it("is stable when the set-valued lists are reordered", () => {
    const shuffled: Omit<Policy, "fingerprint"> = {
      ...basePolicy,
      requiredRulePacks: ["shop", "core"],
      requiredInterfaceContracts: ["ic2", "ic1"],
      requiredApproverIds: ["u10", "u9"]
    }
    const sorted: Omit<Policy, "fingerprint"> = {
      ...basePolicy,
      requiredRulePacks: ["core", "shop"],
      requiredInterfaceContracts: ["ic1", "ic2"],
      requiredApproverIds: ["u9", "u10"]
    }
    expect(policyFingerprint(shuffled)).toBe(policyFingerprint(sorted))
  })
})

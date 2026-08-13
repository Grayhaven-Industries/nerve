/**
 * Authorization (PRD §11.1, ORG-001 through ORG-005).
 *
 * One predicate answers every "may this person do this here?" question, so
 * the org and project boundaries ORG-003 demands are enforced in a single
 * place rather than re-derived at each call site. Two facts decide the
 * answer, and they are checked in this order because the second is
 * meaningless without the first: the membership must belong to the
 * organization under examination, and the role it carries must hold the
 * action.
 *
 * Permissions are a table from action to the roles that hold it, not a
 * threshold over `roleRank`. Reviewer sits below engineer in privilege yet is
 * the role that signs off a candidate (§10.3), so any rank comparison would
 * hand `review:approve` to every engineer and break the separation of duties
 * the approval rule exists to create.
 */
import type { Membership, Role } from "./objects.js"

/**
 * Privileged operations the platform gates. Named after the effect rather
 * than after the endpoint so a route can move without the audit trail
 * (ORG-006) losing the meaning of what was permitted.
 */
export type Action =
  | "org:manage"
  | "member:invite"
  | "project:read"
  | "project:write"
  | "review:create"
  | "review:disposition"
  | "review:approve"
  | "release:publish"

/**
 * Privilege order of the MVP roles (ORG-002), matching the literal order in
 * `objects.ts`. Useful for presenting members and for choosing the stronger
 * of two memberships; deliberately NOT used to decide permissions, for the
 * reviewer/engineer reason described in the module comment.
 */
export const roleRank: { readonly [R in Role]: number } = {
  viewer: 0,
  reviewer: 1,
  engineer: 2,
  admin: 3
}

/**
 * Which roles hold which action.
 *
 * Admin appears in every row because ORG-004 and ORG-005 make administrators
 * the owners of policy, private packs, and connector contracts; a gate an
 * admin could not pass would just be routed around outside the product.
 */
const actionRoles: { readonly [A in Action]: ReadonlyArray<Role> } = {
  /** Policy, retention, severity overrides, and org-owned assets (ORG-004, ORG-005). */
  "org:manage": ["admin"],
  /** ORG-001: growing the organization changes who can approve, so it stays with admins. */
  "member:invite": ["admin"],
  "project:read": ["viewer", "reviewer", "engineer", "admin"],
  "project:write": ["engineer", "admin"],
  /** §10.3: an engineer prepares the candidate. */
  "review:create": ["engineer", "admin"],
  /** §9.3: resolving a finding is a review decision, open to both the engineer
   * who can fix it and the reviewer who judges the risk. */
  "review:disposition": ["reviewer", "engineer", "admin"],
  /** §10.3: approval is a reviewer's act. Engineer is absent on purpose — the
   * preparer must not be able to satisfy the reviewer requirement, and giving
   * the whole engineer role the power would make that rule a convention
   * rather than a boundary. */
  "review:approve": ["reviewer", "admin"],
  "release:publish": ["engineer", "admin"]
}

/**
 * Decide whether a membership authorizes an action inside a scope.
 *
 * Absent membership is denied rather than treated as a public read: a caller
 * that could not find a membership has not proved anything about the user,
 * and ORG-003 puts the burden of proof on the request.
 *
 * A membership that names projects grants its role only on those projects, so
 * such a membership is denied both when the scope names an unlisted project
 * and when the scope names no project at all — an org-wide question asked of
 * a project-scoped grant has no affirmative answer.
 */
export const can = (
  membership: Membership | undefined,
  action: Action,
  scope: { readonly organizationId: string; readonly projectId?: string | undefined }
): boolean => {
  if (membership === undefined) return false
  if (membership.organizationId !== scope.organizationId) return false

  const scopedProjects = membership.projectIds
  if (scopedProjects !== undefined) {
    if (scope.projectId === undefined) return false
    if (!scopedProjects.includes(scope.projectId)) return false
  }

  return actionRoles[action].includes(membership.role)
}

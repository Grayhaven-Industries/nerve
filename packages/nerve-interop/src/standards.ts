/* oxlint-disable anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type -- Conditional spreads preserve omission; validation intentionally narrows an external unknown DTO before domain use. */
/**
 * References and evidence boundaries for caller-owned standards profiles.
 *
 * This module intentionally contains no standards prose, acceptance tables,
 * default values, or built-in "compliant" profile. It records what authority
 * a caller selected and keeps design, workmanship, and process evidence from
 * being collapsed into one misleading verdict.
 */

export const STANDARDS_PROFILE_SCHEMA_VERSION = "1.0.0" as const

export type EvidenceLayer =
  | "design-requirement"
  | "workmanship-observation"
  | "process-evidence"

export type RuleSourceKind =
  | "licensed"
  | "customer-supplied"
  | "public-metadata"

export interface StandardAuthority {
  readonly id: string
  readonly issuer: string
  readonly documentId: string
  readonly revision: string
  readonly addendum?: string
  readonly scope: string
  readonly sourceKind: RuleSourceKind
  readonly sourceReference: string
  /** Caller-supplied ISO publication date or publication label. */
  readonly publication?: string
}

export interface ApplicabilityDecision {
  readonly status: "applicable" | "not-applicable" | "conditional" | "unassessed"
  readonly rationale: string
  readonly decidedBy?: string
  readonly decidedOn?: string
}

export interface StandardRequirementReference {
  readonly id: string
  readonly authorityId: string
  readonly layer: EvidenceLayer
  /** Identifier only. Licensed clause prose does not belong in this package. */
  readonly clauseRef?: string
  readonly parameterSource?: {
    /** Named customer, drawing, contract, lab procedure, or other authority. */
    readonly authority?: string
    /** Optional link to an authority declared in the same profile. */
    readonly authorityId?: string
    readonly reference: string
    readonly revision?: string
  }
  readonly applicability?: ApplicabilityDecision
  readonly waiver?: {
    readonly reference: string
    readonly rationale: string
    readonly approvedBy: string
    readonly approvedOn?: string
  }
  readonly reviewer?: string
  readonly evidenceExpectations: ReadonlyArray<string>
}

export interface StandardEvidenceRecord {
  readonly id: string
  readonly requirementId: string
  readonly layer: EvidenceLayer
  readonly status: "satisfied" | "not-satisfied" | "unassessed"
  readonly evidenceRefs: ReadonlyArray<string>
  readonly reviewer?: string
  readonly observedAt?: string
}

export interface StandardsProfile {
  readonly schemaVersion: typeof STANDARDS_PROFILE_SCHEMA_VERSION
  readonly id: string
  readonly revision: string
  readonly title?: string
  readonly authorities: ReadonlyArray<StandardAuthority>
  readonly requirements: ReadonlyArray<StandardRequirementReference>
  readonly evidence: ReadonlyArray<StandardEvidenceRecord>
  /** Optional caller statements; certification/conformance claims are rejected. */
  readonly claims?: ReadonlyArray<string>
}

export interface StandardsIssue {
  readonly code: string
  readonly severity: "error" | "warning"
  readonly message: string
  readonly target?: string
  readonly relatedIds?: ReadonlyArray<string>
}

export interface StandardsComposition {
  readonly schemaVersion: typeof STANDARDS_PROFILE_SCHEMA_VERSION
  readonly profileIds: ReadonlyArray<string>
  readonly authorities: ReadonlyArray<StandardAuthority>
  readonly requirements: ReadonlyArray<StandardRequirementReference>
  readonly evidence: ReadonlyArray<StandardEvidenceRecord>
  readonly issues: ReadonlyArray<StandardsIssue>
  /** Structural/profile conflict indicator, never a compliance verdict. */
  readonly hasConflicts: boolean
}

const CODES = {
  SchemaVersion: "NI-STD-001",
  MissingIdentity: "NI-STD-002",
  InexactRevision: "NI-STD-003",
  MissingSource: "NI-STD-004",
  DuplicateAuthority: "NI-STD-005",
  UnknownAuthority: "NI-STD-006",
  DuplicateRequirement: "NI-STD-007",
  MissingApplicability: "NI-STD-008",
  MissingReviewer: "NI-STD-009",
  MissingParameterAuthority: "NI-STD-010",
  UnknownRequirement: "NI-STD-011",
  CrossLayerEvidence: "NI-STD-012",
  ForbiddenClaim: "NI-STD-013",
  DuplicateEvidence: "NI-STD-014",
  ConflictingRevision: "NI-STD-015",
  ConflictingRequirement: "NI-STD-016",
  ConflictingEvidence: "NI-STD-017",
  ConflictingProfile: "NI-STD-018",
  MissingEvidenceReference: "NI-STD-019",
  MalformedProfile: "NI-STD-020"
} as const

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length > 0

const exactRevision = (value: string | undefined): value is string =>
  present(value) && !/^(latest|current|head|tip|most recent)$/i.test(value.trim())

const sourceKinds: ReadonlySet<string> = new Set<RuleSourceKind>([
  "licensed",
  "customer-supplied",
  "public-metadata"
])

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === "string"
const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every(isString)
const optionalStrings = (record: UnknownRecord, keys: ReadonlyArray<string>): boolean =>
  keys.every((key) => record[key] === undefined || isString(record[key]))
const evidenceLayer = (value: unknown): boolean =>
  value === "design-requirement" ||
  value === "workmanship-observation" ||
  value === "process-evidence"

const isStandardsProfile = (value: unknown): value is StandardsProfile => {
  if (
    !isRecord(value) ||
    !isString(value.schemaVersion) ||
    !isString(value.id) ||
    !isString(value.revision) ||
    !Array.isArray(value.authorities) ||
    !Array.isArray(value.requirements) ||
    !Array.isArray(value.evidence) ||
    (value.title !== undefined && !isString(value.title)) ||
    (value.claims !== undefined && !isStringArray(value.claims))
  ) {
    return false
  }
  if (
    !value.authorities.every(
      (authority) =>
        isRecord(authority) &&
        isString(authority.id) &&
        isString(authority.issuer) &&
        isString(authority.documentId) &&
        isString(authority.revision) &&
        isString(authority.scope) &&
        isString(authority.sourceKind) &&
        sourceKinds.has(authority.sourceKind) &&
        isString(authority.sourceReference) &&
        optionalStrings(authority, ["addendum", "publication"])
    )
  ) {
    return false
  }
  if (
    !value.requirements.every(
      (requirement) =>
        isRecord(requirement) &&
        isString(requirement.id) &&
        isString(requirement.authorityId) &&
        evidenceLayer(requirement.layer) &&
        isStringArray(requirement.evidenceExpectations) &&
        optionalStrings(requirement, ["clauseRef", "reviewer"]) &&
        (requirement.applicability === undefined ||
          (isRecord(requirement.applicability) &&
            (requirement.applicability.status === "applicable" ||
              requirement.applicability.status === "not-applicable" ||
              requirement.applicability.status === "conditional" ||
              requirement.applicability.status === "unassessed") &&
            isString(requirement.applicability.rationale) &&
            optionalStrings(requirement.applicability, ["decidedBy", "decidedOn"]))) &&
        (requirement.parameterSource === undefined ||
          (isRecord(requirement.parameterSource) &&
            isString(requirement.parameterSource.reference) &&
            optionalStrings(requirement.parameterSource, ["authority", "authorityId", "revision"])))
    )
  ) {
    return false
  }
  return value.evidence.every(
    (evidence) =>
      isRecord(evidence) &&
      isString(evidence.id) &&
      isString(evidence.requirementId) &&
      evidenceLayer(evidence.layer) &&
      (evidence.status === "satisfied" ||
        evidence.status === "not-satisfied" ||
        evidence.status === "unassessed") &&
      isStringArray(evidence.evidenceRefs) &&
      optionalStrings(evidence, ["reviewer", "observedAt"])
  )
}

type CanonicalInput = object | string | number | boolean | null | undefined

const canonicalValue = <T extends CanonicalInput>(value: T): CanonicalInput => {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value !== null && value instanceof Object) {
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => cmp(a, b))
      .map(([key, child]) => [key, canonicalValue(child)] as const)
    return Object.fromEntries(entries)
  }
  return value
}

const identity = <T extends CanonicalInput>(value: T): string =>
  JSON.stringify(canonicalValue(value))

const issue = (
  code: string,
  message: string,
  target?: string,
  relatedIds?: ReadonlyArray<string>
): StandardsIssue => ({
  code,
  severity: "error",
  message,
  ...(target === undefined ? {} : { target }),
  ...(relatedIds === undefined ? {} : { relatedIds: [...relatedIds].sort(cmp) })
})

const sortIssues = (issues: ReadonlyArray<StandardsIssue>): ReadonlyArray<StandardsIssue> =>
  [...issues].sort(
    (a, b) =>
      cmp(a.code, b.code) ||
      cmp(a.target ?? "", b.target ?? "") ||
      cmp(a.message, b.message)
  )

const authorityKey = (authority: StandardAuthority): string =>
  [authority.issuer, authority.documentId, authority.addendum ?? ""]
    .map((part) => part.trim().toLocaleLowerCase("en-US"))
    .join("\u0000")

const forbiddenClaimPaths = (
  value: unknown,
  path = "profile",
  seen: WeakSet<object> = new WeakSet()
): ReadonlyArray<string> => {
  if (value === null || typeof value !== "object") return []
  if (seen.has(value)) return []
  seen.add(value)
  if (Array.isArray(value)) {
    return value.flatMap((child, index) =>
      forbiddenClaimPaths(child, `${path}[${index}]`, seen)
    )
  }
  const found: Array<string> = []
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (
      /^(compliant|compliance|conformant|conformance|certified|certification)$/i.test(key) &&
      child !== undefined &&
      child !== false &&
      child !== ""
    ) {
      found.push(childPath)
    }
    if (child !== null && child instanceof Object) {
      found.push(...forbiddenClaimPaths(child, childPath, seen))
    }
  }
  return found
}

/** Validate profile references and evidence boundaries without evaluating a standard. */
export const validateStandardsProfile = (
  profile: unknown
): ReadonlyArray<StandardsIssue> => {
  if (!isStandardsProfile(profile)) {
    return [
      issue(
        CODES.MalformedProfile,
        "Standards profile must contain correctly typed identity, authority, requirement, and evidence arrays.",
        "profile"
      )
    ]
  }
  const issues: Array<StandardsIssue> = []
  if (profile.schemaVersion !== STANDARDS_PROFILE_SCHEMA_VERSION) {
    issues.push(
      issue(
        CODES.SchemaVersion,
        `Profile schemaVersion must be ${STANDARDS_PROFILE_SCHEMA_VERSION}.`,
        "profile:schemaVersion"
      )
    )
  }
  if (!present(profile.id) || !exactRevision(profile.revision)) {
    issues.push(
      issue(
        !exactRevision(profile.revision) && present(profile.revision)
          ? CODES.InexactRevision
          : CODES.MissingIdentity,
        !exactRevision(profile.revision) && present(profile.revision)
          ? `Profile ${profile.id || "<missing>"} must name an exact revision, not "${profile.revision}".`
          : "Profile id and exact revision are required.",
        "profile"
      )
    )
  }

  const authorityIds = new Map<string, StandardAuthority>()
  const authoritiesByDocument = new Map<string, StandardAuthority>()
  for (const authority of profile.authorities ?? []) {
    const target = `authority:${authority.id}`
    if (
      !present(authority.id) ||
      !present(authority.issuer) ||
      !present(authority.documentId) ||
      !present(authority.scope)
    ) {
      issues.push(
        issue(
          CODES.MissingIdentity,
          "Authority id, issuer, documentId, and scope are required.",
          target
        )
      )
    }
    if (!exactRevision(authority.revision)) {
      issues.push(
        issue(
          CODES.InexactRevision,
          `Authority ${authority.id || "<missing>"} must name an exact revision, not "${String(authority.revision)}".`,
          target
        )
      )
    }
    if (!sourceKinds.has(authority.sourceKind) || !present(authority.sourceReference)) {
      issues.push(
        issue(
          CODES.MissingSource,
          `Authority ${authority.id || "<missing>"} requires source kind and source reference.`,
          target
        )
      )
    }
    const duplicate = authorityIds.get(authority.id)
    if (duplicate !== undefined) {
      issues.push(
        issue(
          CODES.DuplicateAuthority,
          `Authority id ${authority.id} is repeated.`,
          target,
          [duplicate.id, authority.id]
        )
      )
    } else authorityIds.set(authority.id, authority)

    const documentKey = authorityKey(authority)
    const sameDocument = authoritiesByDocument.get(documentKey)
    if (sameDocument !== undefined && sameDocument.revision !== authority.revision) {
      issues.push(
        issue(
          CODES.ConflictingRevision,
          `${authority.issuer} ${authority.documentId} is selected at both ${sameDocument.revision} and ${authority.revision}.`,
          target,
          [sameDocument.id, authority.id]
        )
      )
    } else authoritiesByDocument.set(documentKey, authority)
  }

  const requirements = new Map<string, StandardRequirementReference>()
  for (const requirement of profile.requirements ?? []) {
    const target = `requirement:${requirement.id}`
    if (!present(requirement.id)) {
      issues.push(issue(CODES.MissingIdentity, "Requirement id is required.", target))
    }
    if (!authorityIds.has(requirement.authorityId)) {
      issues.push(
        issue(
          CODES.UnknownAuthority,
          `Requirement ${requirement.id || "<missing>"} references unknown authority ${requirement.authorityId || "<missing>"}.`,
          target
        )
      )
    }
    const duplicate = requirements.get(requirement.id)
    if (duplicate !== undefined) {
      issues.push(
        issue(
          CODES.DuplicateRequirement,
          `Requirement id ${requirement.id} is repeated.`,
          target
        )
      )
    } else requirements.set(requirement.id, requirement)

    if (
      requirement.applicability === undefined ||
      !present(requirement.applicability.rationale)
    ) {
      issues.push(
        issue(
          CODES.MissingApplicability,
          `Requirement ${requirement.id || "<missing>"} requires an explicit applicability decision and rationale.`,
          target
        )
      )
    }
    const applies =
      requirement.applicability?.status === "applicable" ||
      requirement.applicability?.status === "conditional"
    if (applies && !present(requirement.reviewer)) {
      issues.push(
        issue(
          CODES.MissingReviewer,
          `Applicable requirement ${requirement.id} requires a reviewer.`,
          target
        )
      )
    }
    if (applies) {
      const parameterSource = requirement.parameterSource
      const hasAuthority =
        present(parameterSource?.authority) || present(parameterSource?.authorityId)
      if (!hasAuthority || !present(parameterSource?.reference)) {
        issues.push(
          issue(
            CODES.MissingParameterAuthority,
            `Applicable requirement ${requirement.id} requires an identified parameter authority and reference.`,
            target
          )
        )
      } else if (
        present(parameterSource?.authorityId) &&
        !authorityIds.has(parameterSource.authorityId)
      ) {
        issues.push(
          issue(
            CODES.UnknownAuthority,
            `Requirement ${requirement.id} parameter source references unknown authority ${parameterSource.authorityId}.`,
            target
          )
        )
      }
    }
  }

  const evidenceIds = new Set<string>()
  for (const evidence of profile.evidence ?? []) {
    const target = `evidence:${evidence.id}`
    if (
      evidence.status === "satisfied" &&
      !evidence.evidenceRefs.some((reference) => present(reference))
    ) {
      issues.push(
        issue(
          CODES.MissingEvidenceReference,
          `Satisfied evidence ${evidence.id || "<missing>"} requires at least one evidence reference.`,
          target
        )
      )
    }
    if (evidenceIds.has(evidence.id)) {
      issues.push(
        issue(CODES.DuplicateEvidence, `Evidence id ${evidence.id} is repeated.`, target)
      )
    }
    evidenceIds.add(evidence.id)
    const requirement = requirements.get(evidence.requirementId)
    if (requirement === undefined) {
      issues.push(
        issue(
          CODES.UnknownRequirement,
          `Evidence ${evidence.id} references unknown requirement ${evidence.requirementId}.`,
          target
        )
      )
    } else if (requirement.layer !== evidence.layer) {
      issues.push(
        issue(
          CODES.CrossLayerEvidence,
          `Evidence ${evidence.id} is ${evidence.layer}, but requirement ${requirement.id} is ${requirement.layer}.`,
          target,
          [requirement.id, evidence.id]
        )
      )
    }
  }

  for (const [index, claim] of (profile.claims ?? []).entries()) {
    if (/\b(?:certif(?:ied|ication)|compli(?:ant|ance)|conform(?:ant|ance|s)?)\b/i.test(claim)) {
      issues.push(
        issue(
          CODES.ForbiddenClaim,
          "Standards profiles may not assert certification, compliance, or conformance.",
          `profile:claims[${index}]`
        )
      )
    }
  }
  for (const path of forbiddenClaimPaths(profile)) {
    issues.push(
      issue(
        CODES.ForbiddenClaim,
        "Standards profiles may not carry certification or conformance fields.",
        path
      )
    )
  }
  return sortIssues(issues)
}

const normalizeProfile = (profile: StandardsProfile): StandardsProfile => {
  const parsed: unknown = JSON.parse(JSON.stringify(canonicalValue(profile)))
  if (!isStandardsProfile(parsed)) {
    throw new TypeError(`${CODES.MalformedProfile}: Standards profile could not be cloned.`)
  }
  const owned = parsed
  return {
    schemaVersion: STANDARDS_PROFILE_SCHEMA_VERSION,
    id: owned.id.trim(),
    revision: owned.revision.trim(),
    ...(owned.title === undefined ? {} : { title: owned.title.trim() }),
    authorities: [...owned.authorities].sort((a, b) => cmp(a.id, b.id)),
    requirements: [...owned.requirements].sort((a, b) => cmp(a.id, b.id)),
    evidence: [...owned.evidence].sort((a, b) => cmp(a.id, b.id)),
    ...(owned.claims === undefined ? {} : { claims: [...owned.claims] })
  }
}

/** Define and canonically order a valid profile; invalid profiles are rejected. */
export const defineStandardsProfile = (
  input: Omit<StandardsProfile, "schemaVersion" | "evidence"> & {
    readonly schemaVersion?: typeof STANDARDS_PROFILE_SCHEMA_VERSION
    readonly evidence?: ReadonlyArray<StandardEvidenceRecord>
  }
): StandardsProfile => {
  if (!isRecord(input)) {
    throw new TypeError(`${CODES.MalformedProfile}: Standards profile input must be an object.`)
  }
  const profile: StandardsProfile = {
    ...input,
    schemaVersion: input.schemaVersion ?? STANDARDS_PROFILE_SCHEMA_VERSION,
    evidence: input.evidence ?? []
  }
  const issues = validateStandardsProfile(profile)
  if (issues.length > 0) {
    throw new Error(issues.map((entry) => `${entry.code}: ${entry.message}`).join("\n"))
  }
  return normalizeProfile(profile)
}

/** Compose profiles while reporting, rather than silently resolving, conflicts. */
export const composeStandardsProfiles = (
  profiles: ReadonlyArray<unknown>
): StandardsComposition => {
  if (!Array.isArray(profiles)) {
    const malformed = issue(
      CODES.MalformedProfile,
      "Standards composition input must be an array.",
      "profiles"
    )
    return {
      schemaVersion: STANDARDS_PROFILE_SCHEMA_VERSION,
      profileIds: [],
      authorities: [],
      requirements: [],
      evidence: [],
      issues: [malformed],
      hasConflicts: true
    }
  }
  const issues: Array<StandardsIssue> = profiles.flatMap(validateStandardsProfile)
  const profileIds = new Set<string>()
  const profileDefinitions = new Map<string, string>()
  const authorities = new Map<string, StandardAuthority>()
  const authoritiesByDocument = new Map<string, StandardAuthority>()
  const requirements = new Map<string, StandardRequirementReference>()
  const evidence = new Map<string, StandardEvidenceRecord>()

  const seenProfiles = new Set<string>()
  const orderedProfiles = profiles
    .filter(isStandardsProfile)
    .map(normalizeProfile)
    .sort((a, b) => cmp(a.id, b.id) || cmp(identity(a), identity(b)))
    .filter((profile) => {
      const key = identity(profile)
      if (seenProfiles.has(key)) return false
      seenProfiles.add(key)
      return true
    })

  for (const profile of orderedProfiles) {
    const definition = identity(profile)
    const existingDefinition = profileDefinitions.get(profile.id)
    if (existingDefinition !== undefined && existingDefinition !== definition) {
      issues.push(
        issue(
          CODES.ConflictingProfile,
          `Profile id ${profile.id} has conflicting definitions across the composition.`,
          `profile:${profile.id}`
        )
      )
    } else if (existingDefinition === undefined) {
      profileDefinitions.set(profile.id, definition)
    }
    profileIds.add(profile.id)

    for (const authority of profile.authorities) {
      const byId = authorities.get(authority.id)
      if (byId === undefined) authorities.set(authority.id, authority)
      else if (identity(byId) !== identity(authority)) {
        issues.push(
          issue(
            CODES.DuplicateAuthority,
            `Authority id ${authority.id} has conflicting definitions across profiles.`,
            `authority:${authority.id}`
          )
        )
      }
      const key = authorityKey(authority)
      const sameDocument = authoritiesByDocument.get(key)
      if (sameDocument === undefined) authoritiesByDocument.set(key, authority)
      else if (sameDocument.revision !== authority.revision) {
        issues.push(
          issue(
            CODES.ConflictingRevision,
            `${authority.issuer} ${authority.documentId} is composed at both ${sameDocument.revision} and ${authority.revision}.`,
            `authority:${authority.id}`,
            [sameDocument.id, authority.id]
          )
        )
      }
    }

    for (const requirement of profile.requirements) {
      const existing = requirements.get(requirement.id)
      if (existing === undefined) requirements.set(requirement.id, requirement)
      else if (identity(existing) !== identity(requirement)) {
        issues.push(
          issue(
            CODES.ConflictingRequirement,
            `Requirement id ${requirement.id} has conflicting definitions across profiles.`,
            `requirement:${requirement.id}`
          )
        )
      }
    }

    for (const record of profile.evidence) {
      const existing = evidence.get(record.id)
      if (existing === undefined) evidence.set(record.id, record)
      else if (identity(existing) !== identity(record)) {
        issues.push(
          issue(
            CODES.ConflictingEvidence,
            `Evidence id ${record.id} has conflicting definitions across profiles.`,
            `evidence:${record.id}`
          )
        )
      }
    }
  }

  const orderedIssues = sortIssues(issues)
  return {
    schemaVersion: STANDARDS_PROFILE_SCHEMA_VERSION,
    profileIds: [...profileIds].sort(cmp),
    authorities: [...authorities.values()].sort((a, b) => cmp(a.id, b.id)),
    requirements: [...requirements.values()].sort((a, b) => cmp(a.id, b.id)),
    evidence: [...evidence.values()].sort((a, b) => cmp(a.id, b.id)),
    issues: orderedIssues,
    hasConflicts: orderedIssues.some((entry) => entry.severity === "error")
  }
}

/** Canonical, newline-terminated JSON for reviewable profile artifacts. */
export const standardsProfileJson = (profile: StandardsProfile): string =>
  JSON.stringify(canonicalValue(normalizeProfile(profile)), null, 2) + "\n"

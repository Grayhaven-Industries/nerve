/* oxlint-disable anti-slop/no-conditional-empty-object-spread -- Conditional spreads preserve exact optional-property omission in result DTOs. */
/** Caller-selected automation and high-voltage data-readiness evaluations. */
import type { Hir, HirEndpoint, HirPin, HirWire } from "@grayhaven/nerve"

type ReadinessStatus = "satisfied" | "failed" | "unassessed"

type AutomationFact =
  | "wire.finished-length"
  | "wire.material-reference"
  | "wire.gauge"
  | "wire.strip-length-both-ends"
  | "wire.termination-allowance-both-ends"
  | "wire.terminal-both-ends"
  | "wire.seal-both-ends"
  | "connector.part-identity"
  | "connector.assigned-pins"
  | (string & {})

interface AutomationRequirement {
  readonly id: string
  readonly fact: AutomationFact
  /** Omitted evaluates every HIR entity appropriate to the selected fact. */
  readonly entityIds?: ReadonlyArray<string>
  readonly evidenceExpectation?: string
}

export interface AutomationReadinessProfile {
  readonly id: string
  readonly revision: string
  readonly citation?: {
    readonly documentId: string
    readonly revision: string
    readonly reference: string
  }
  readonly requirements: ReadonlyArray<AutomationRequirement>
}

export interface AutomationReadinessFinding {
  readonly code: string
  readonly requirementId: string
  readonly fact: string
  readonly status: ReadinessStatus
  readonly target: string
  readonly message: string
  readonly evidence: ReadonlyArray<string>
}

export interface AutomationReadinessResult {
  readonly profileId: string
  readonly profileRevision: string
  readonly findings: ReadonlyArray<AutomationReadinessFinding>
  readonly counts: {
    readonly satisfied: number
    readonly failed: number
    readonly unassessed: number
  }
  /** Always data-readiness only, never DIN or other standards conformity. */
  readonly determination: "data-readiness-only"
}

interface ReadinessCounts {
  readonly satisfied: number
  readonly failed: number
  readonly unassessed: number
}

interface WireFactResult {
  readonly status: ReadinessStatus
  readonly evidence: ReadonlyArray<string>
  readonly detail: string
}

export interface VoltageDomain {
  readonly id: string
  readonly maximumOperatingVoltageV: number
  readonly nominalVoltageV?: number
  readonly authorityReference: string
}

export interface HighVoltageAssignment {
  readonly wireId: string
  readonly domainId: string
}

interface HighVoltageSystemDeclaration {
  readonly required: boolean
  readonly authorityReference: string
  readonly evidenceRefs?: ReadonlyArray<string>
}

export interface HighVoltageDesignProfile {
  readonly id: string
  readonly revision: string
  readonly parameterAuthority: {
    readonly name: string
    readonly reference: string
    readonly revision?: string
  }
  readonly domains: ReadonlyArray<VoltageDomain>
  readonly assignments: ReadonlyArray<HighVoltageAssignment>
  readonly hvil?: HighVoltageSystemDeclaration
  readonly segregation?: HighVoltageSystemDeclaration
  readonly shieldGround?: HighVoltageSystemDeclaration
}

export interface HighVoltageFinding {
  readonly code: string
  readonly status: ReadinessStatus
  readonly target: string
  readonly message: string
  readonly evidence: ReadonlyArray<string>
  readonly domainId?: string
  readonly wireId?: string
}

export interface HighVoltageResult {
  readonly profileId: string
  readonly profileRevision: string
  readonly findings: ReadonlyArray<HighVoltageFinding>
  readonly counts: {
    readonly satisfied: number
    readonly failed: number
    readonly unassessed: number
  }
  /** No hipot, clearance, or system-safety conclusion is made. */
  readonly determination: "design-data-readiness-only"
}

const AUTO_CODES = {
  Satisfied: "NI-AUTO-001",
  Failed: "NI-AUTO-002",
  Unsupported: "NI-AUTO-003",
  UnknownEntity: "NI-AUTO-004",
  InvalidProfile: "NI-AUTO-005"
} as const

const HV_CODES = {
  MissingAuthority: "NI-HV-001",
  DuplicateDomain: "NI-HV-002",
  UnknownDomain: "NI-HV-003",
  UnknownWire: "NI-HV-004",
  RatingMissing: "NI-HV-005",
  RatingInsufficient: "NI-HV-006",
  RatingSupported: "NI-HV-007",
  HvilUnassessed: "NI-HV-008",
  SegregationUnassessed: "NI-HV-009",
  ShieldGroundUnassessed: "NI-HV-010",
  InvalidDomain: "NI-HV-011",
  InvalidRating: "NI-HV-012"
} as const

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length > 0
const finiteNonnegative = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0
const finitePositive = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value > 0

const countStatuses = <T extends { readonly status: ReadinessStatus }>(
  findings: ReadonlyArray<T>
): ReadinessCounts => ({
  satisfied: findings.filter((entry) => entry.status === "satisfied").length,
  failed: findings.filter((entry) => entry.status === "failed").length,
  unassessed: findings.filter((entry) => entry.status === "unassessed").length
})

const endpointPin = (hir: Hir, endpoint: HirEndpoint): HirPin | undefined => {
  if (!("connector" in endpoint)) return undefined
  return hir.connectors
    .find((entry) => entry.ref === endpoint.connector)
    ?.pins.find((entry) => entry.pin === endpoint.pin)
}

const wireFact = (
  hir: Hir,
  entry: HirWire,
  fact: string
): WireFactResult => {
  const ref = `wire:${entry.id}`
  if (fact === "wire.finished-length") {
    if (entry.length === undefined) {
      return { status: "failed", evidence: [], detail: "finished length is absent" }
    }
    return finitePositive(entry.length)
      ? { status: "satisfied", evidence: [`${ref}.length`], detail: "finished length is declared and valid" }
      : { status: "failed", evidence: [`${ref}.length`], detail: "finished length is not finite and positive" }
  }
  if (fact === "wire.material-reference") {
    const materialReference = entry.part?.mpn
    if (materialReference === undefined) {
      return { status: "failed", evidence: [], detail: "material part reference is absent" }
    }
    return present(materialReference)
      ? { status: "satisfied", evidence: [`${ref}.part.mpn`], detail: "material part reference is declared" }
      : { status: "failed", evidence: [`${ref}.part.mpn`], detail: "material part reference is blank" }
  }
  if (fact === "wire.gauge") {
    const declared = [
      ...(entry.gauge === undefined ? [] : [{ value: entry.gauge, ref: `${ref}.gauge` }]),
      ...(entry.part?.gauge === undefined
        ? []
        : [{ value: entry.part.gauge, ref: `${ref}.part.gauge` }])
    ]
    const evidence = declared.map((entry) => entry.ref)
    if (declared.length === 0) {
      return { status: "failed", evidence, detail: "wire gauge is absent" }
    }
    return declared.every((entry) => present(entry.value))
      ? { status: "satisfied", evidence, detail: "wire gauge is declared" }
      : { status: "failed", evidence, detail: "one or more declared wire gauges are blank" }
  }
  if (fact === "wire.strip-length-both-ends") {
    if (entry.stripLength === undefined) {
      return { status: "failed", evidence: [], detail: "per-end strip lengths are absent" }
    }
    const evidence = [`${ref}.stripLength.from`, `${ref}.stripLength.to`]
    return finitePositive(entry.stripLength.from) && finitePositive(entry.stripLength.to)
      ? { status: "satisfied", evidence, detail: "both strip lengths are declared and valid" }
      : { status: "failed", evidence, detail: "one or both strip lengths are not finite and positive" }
  }
  if (fact === "wire.termination-allowance-both-ends") {
    if (entry.terminationAllowance === undefined) {
      return { status: "failed", evidence: [], detail: "per-end termination allowances are absent" }
    }
    const evidence = [
      `${ref}.terminationAllowance.from`,
      `${ref}.terminationAllowance.to`
    ]
    return finiteNonnegative(entry.terminationAllowance.from) &&
      finiteNonnegative(entry.terminationAllowance.to)
      ? { status: "satisfied", evidence, detail: "both termination allowances are declared and valid" }
      : { status: "failed", evidence, detail: "one or both termination allowances are negative or non-finite" }
  }
  if (fact === "wire.terminal-both-ends" || fact === "wire.seal-both-ends") {
    if (!("connector" in entry.from) || !("connector" in entry.to)) {
      return {
        status: "unassessed",
        evidence: [],
        detail: "a splice endpoint has no connector terminal/seal fact"
      }
    }
    const from = endpointPin(hir, entry.from)
    const to = endpointPin(hir, entry.to)
    const key = fact === "wire.terminal-both-ends" ? "terminal" : "seal"
    const fromValue = from?.[key]
    const toValue = to?.[key]
    const evidence = [
      ...(fromValue === undefined ? [] : [`connector:${entry.from.connector}.pin:${entry.from.pin}.${key}`]),
      ...(toValue === undefined ? [] : [`connector:${entry.to.connector}.pin:${entry.to.pin}.${key}`])
    ]
    if (fromValue === undefined || toValue === undefined) {
      return { status: "failed", evidence, detail: `${key} is absent at one or both ends` }
    }
    return present(fromValue) && present(toValue)
      ? { status: "satisfied", evidence, detail: `${key} is declared at both ends` }
      : { status: "failed", evidence, detail: `${key} is blank at one or both ends` }
  }
  return { status: "unassessed", evidence: [], detail: `fact ${fact} is not represented by this evaluator` }
}

const autoFinding = (
  requirement: AutomationRequirement,
  status: ReadinessStatus,
  target: string,
  detail: string,
  evidence: ReadonlyArray<string>,
  code?: string
): AutomationReadinessFinding => ({
  code:
    code ??
    (status === "satisfied"
      ? AUTO_CODES.Satisfied
      : status === "failed"
        ? AUTO_CODES.Failed
        : AUTO_CODES.Unsupported),
  requirementId: requirement.id,
  fact: requirement.fact,
  status,
  target,
  message: `${requirement.id}: ${detail}.`,
  evidence: [...evidence].sort(cmp)
})

/** Evaluate only caller-selected, finite data-presence requirements. */
export const evaluateAutomationReadiness = (
  hir: Hir,
  profile: AutomationReadinessProfile
): AutomationReadinessResult => {
  const findings: Array<AutomationReadinessFinding> = []
  const knownFacts = new Set([
    "wire.finished-length",
    "wire.material-reference",
    "wire.gauge",
    "wire.strip-length-both-ends",
    "wire.termination-allowance-both-ends",
    "wire.terminal-both-ends",
    "wire.seal-both-ends",
    "connector.part-identity",
    "connector.assigned-pins"
  ])
  for (const requirement of [...profile.requirements].sort((a, b) => cmp(a.id, b.id))) {
    if (!present(requirement.id)) {
      findings.push(
        autoFinding(
          requirement,
          "unassessed",
          `profile:${profile.id}`,
          "requirement id is absent",
          [],
          AUTO_CODES.InvalidProfile
        )
      )
      continue
    }
    if (!knownFacts.has(requirement.fact)) {
      findings.push(
        autoFinding(
          requirement,
          "unassessed",
          `profile:${profile.id}`,
          `fact ${requirement.fact} is unsupported and no proxy was inferred`,
          []
        )
      )
      continue
    }
    const connectorFact = requirement.fact.startsWith("connector.")
    if (connectorFact) {
      const byId = new Map(hir.connectors.map((entry) => [entry.ref, entry] as const))
      const ids = requirement.entityIds === undefined
        ? [...byId.keys()].sort(cmp)
        : [...new Set(requirement.entityIds)].sort(cmp)
      for (const id of ids) {
        const entry = byId.get(id)
        if (entry === undefined) {
          findings.push(
            autoFinding(
              requirement,
              "unassessed",
              `connector:${id}`,
              `connector ${id} is absent from HIR`,
              [],
              AUTO_CODES.UnknownEntity
            )
          )
          continue
        }
        const satisfied = requirement.fact === "connector.part-identity"
          ? present(entry.mpn)
          : entry.pins.length > 0
        const evidence = satisfied
          ? [
              requirement.fact === "connector.part-identity"
                ? `connector:${id}.mpn`
                : `connector:${id}.pins`
            ]
          : []
        findings.push(
          autoFinding(
            requirement,
            satisfied ? "satisfied" : "failed",
            `connector:${id}`,
            satisfied ? `${requirement.fact} is declared` : `${requirement.fact} is absent`,
            evidence
          )
        )
      }
      continue
    }

    const byId = new Map(hir.wires.map((entry) => [entry.id, entry] as const))
    const ids = requirement.entityIds === undefined
      ? [...byId.keys()].sort(cmp)
      : [...new Set(requirement.entityIds)].sort(cmp)
    for (const id of ids) {
      const entry = byId.get(id)
      if (entry === undefined) {
        findings.push(
          autoFinding(
            requirement,
            "unassessed",
            `wire:${id}`,
            `wire ${id} is absent from HIR`,
            [],
            AUTO_CODES.UnknownEntity
          )
        )
        continue
      }
      const evaluated = wireFact(hir, entry, requirement.fact)
      findings.push(
        autoFinding(
          requirement,
          evaluated.status,
          `wire:${id}`,
          evaluated.detail,
          evaluated.evidence
        )
      )
    }
  }
  const ordered = findings.sort(
    (a, b) => cmp(a.requirementId, b.requirementId) || cmp(a.target, b.target)
  )
  return {
    profileId: profile.id,
    profileRevision: profile.revision,
    findings: ordered,
    counts: countStatuses(ordered),
    determination: "data-readiness-only"
  }
}

const hvFinding = (
  code: string,
  status: ReadinessStatus,
  target: string,
  message: string,
  evidence: ReadonlyArray<string>,
  assignment?: HighVoltageAssignment
): HighVoltageFinding => ({
  code,
  status,
  target,
  message,
  evidence: [...evidence].sort(cmp),
  ...(assignment === undefined
    ? {}
    : { domainId: assignment.domainId, wireId: assignment.wireId })
})

/**
 * Compare caller-authorized voltage domains with declared HIR ratings.
 * Unsupported system/geometry facts remain unassessed; no test values result.
 */
export const evaluateHighVoltageProfile = (
  hir: Hir,
  profile: HighVoltageDesignProfile
): HighVoltageResult => {
  const findings: Array<HighVoltageFinding> = []
  const authorityValid =
    present(profile.parameterAuthority?.name) && present(profile.parameterAuthority?.reference)
  if (!authorityValid) {
    findings.push(
      hvFinding(
        HV_CODES.MissingAuthority,
        "unassessed",
        `profile:${profile.id}`,
        "Voltage comparisons require a caller-supplied parameter authority and reference.",
        []
      )
    )
  }

  const domains = new Map<string, VoltageDomain>()
  const duplicateDomains = new Set<string>()
  const invalidDomains = new Set<string>()
  for (const domain of profile.domains) {
    if (domains.has(domain.id)) {
      duplicateDomains.add(domain.id)
      findings.push(
        hvFinding(
          HV_CODES.DuplicateDomain,
          "unassessed",
          `domain:${domain.id}`,
          `Voltage domain ${domain.id} is repeated.`,
          []
        )
      )
      continue
    }
    domains.set(domain.id, domain)
    const nominalWithinMaximum =
      domain.nominalVoltageV === undefined ||
      (finiteNonnegative(domain.nominalVoltageV) &&
        finiteNonnegative(domain.maximumOperatingVoltageV) &&
        domain.nominalVoltageV <= domain.maximumOperatingVoltageV)
    if (
      !present(domain.id) ||
      !present(domain.authorityReference) ||
      !finiteNonnegative(domain.maximumOperatingVoltageV) ||
      !nominalWithinMaximum
    ) {
      invalidDomains.add(domain.id)
      findings.push(
        hvFinding(
          HV_CODES.InvalidDomain,
          "unassessed",
          `domain:${domain.id}`,
          `Voltage domain ${domain.id || "<missing>"} lacks a valid caller-authorized voltage definition.`,
          []
        )
      )
    }
  }
  const wires = new Map(hir.wires.map((entry) => [entry.id, entry] as const))
  for (const assignment of [...profile.assignments].sort(
    (a, b) => cmp(a.wireId, b.wireId) || cmp(a.domainId, b.domainId)
  )) {
    const target = `wire:${assignment.wireId}`
    const wireEntry = wires.get(assignment.wireId)
    if (wireEntry === undefined) {
      findings.push(
        hvFinding(
          HV_CODES.UnknownWire,
          "unassessed",
          target,
          `High-voltage assignment references unknown wire ${assignment.wireId}.`,
          [],
          assignment
        )
      )
      continue
    }
    const domain = domains.get(assignment.domainId)
    if (domain === undefined || duplicateDomains.has(assignment.domainId)) {
      findings.push(
        hvFinding(
          HV_CODES.UnknownDomain,
          "unassessed",
          target,
          `High-voltage assignment references unknown or ambiguous domain ${assignment.domainId}.`,
          [],
          assignment
        )
      )
      continue
    }
    if (invalidDomains.has(assignment.domainId)) {
      findings.push(
        hvFinding(
          HV_CODES.InvalidDomain,
          "unassessed",
          target,
          `Wire ${assignment.wireId} cannot be compared against invalid voltage domain ${assignment.domainId}.`,
          [],
          assignment
        )
      )
      continue
    }
    if (
      !authorityValid ||
      !present(domain.authorityReference) ||
      !finiteNonnegative(domain.maximumOperatingVoltageV)
    ) {
      findings.push(
        hvFinding(
          HV_CODES.MissingAuthority,
          "unassessed",
          target,
          `Wire ${assignment.wireId} cannot be compared without a valid parameter authority and voltage domain.`,
          [],
          assignment
        )
      )
      continue
    }
    const ratings = [
      ...(wireEntry.voltageRating === undefined
        ? []
        : [{ value: wireEntry.voltageRating, ref: `${target}.voltageRating` }]),
      ...(wireEntry.part?.voltageRating === undefined
        ? []
        : [{ value: wireEntry.part.voltageRating, ref: `${target}.part.voltageRating` }])
    ]
    if (ratings.length === 0) {
      findings.push(
        hvFinding(
          HV_CODES.RatingMissing,
          "unassessed",
          target,
          `Wire ${assignment.wireId} has no declared wire or material voltage rating to compare with domain ${domain.id}.`,
          [],
          assignment
        )
      )
      continue
    }
    const invalidRatings = ratings.filter((rating) => !finitePositive(rating.value))
    if (invalidRatings.length > 0) {
      findings.push(
        hvFinding(
          HV_CODES.InvalidRating,
          "unassessed",
          target,
          `Wire ${assignment.wireId} has a declared voltage rating that is not finite and positive; comparison with domain ${domain.id} was not performed.`,
          invalidRatings.map((rating) => rating.ref),
          assignment
        )
      )
      continue
    }
    const insufficient = ratings.filter(
      (rating) => rating.value < domain.maximumOperatingVoltageV
    )
    findings.push(
      hvFinding(
        insufficient.length === 0 ? HV_CODES.RatingSupported : HV_CODES.RatingInsufficient,
        insufficient.length === 0 ? "satisfied" : "failed",
        target,
        insufficient.length === 0
          ? `Declared ratings meet the caller-authorized ${domain.maximumOperatingVoltageV} V maximum for domain ${domain.id}.`
          : `One or more declared ratings are below the caller-authorized ${domain.maximumOperatingVoltageV} V maximum for domain ${domain.id}.`,
        ratings.map((rating) => rating.ref),
        assignment
      )
    )
  }

  const unsupportedSystemFacts = [
    ["hvil", profile.hvil, HV_CODES.HvilUnassessed, "HVIL function"],
    ["segregation", profile.segregation, HV_CODES.SegregationUnassessed, "physical segregation/clearance"],
    ["shield-ground", profile.shieldGround, HV_CODES.ShieldGroundUnassessed, "shield grounding/bonding"]
  ] as const
  for (const [target, declaration, code, label] of unsupportedSystemFacts) {
    if (declaration === undefined) continue
    findings.push(
      hvFinding(
        code,
        "unassessed",
        `system:${target}`,
        `${label} is caller-declared but is not established by current HIR facts; no proxy was inferred.`,
        declaration.evidenceRefs ?? []
      )
    )
  }

  const ordered = findings.sort(
    (a, b) => cmp(a.code, b.code) || cmp(a.target, b.target) || cmp(a.message, b.message)
  )
  return {
    profileId: profile.id,
    profileRevision: profile.revision,
    findings: ordered,
    counts: countStatuses(ordered),
    determination: "design-data-readiness-only"
  }
}

/**
 * Deterministic product-option configuration.
 *
 * A product family keeps one base harness and an ordered option catalog.
 * Requests are canonicalized against that catalog before any patch is
 * applied, so caller selection order cannot change either the design or the
 * diagnostics. Invalid configurations are data, not exceptions.
 */
import type {
  BranchDef,
  HarnessDesign,
  LabelDef,
  ProtectionDef,
  WireDef,
  WireProps
} from "./domain.js"
import { variant, type VariantOptions } from "./variant.js"

/** A variant patch without the output identity owned by a configuration request. */
export type VariantPatch = Omit<VariantOptions, "id" | "revision" | "metadata">

export interface ProductOption {
  /** Stable option/SKU feature id. */
  readonly id: string
  readonly label?: string
  readonly requires?: ReadonlyArray<string>
  readonly excludes?: ReadonlyArray<string>
  readonly patch: VariantPatch
}

export interface ProductFamily {
  readonly id: string
  readonly base: HarnessDesign
  /** Canonical option order for resolution and enumeration. */
  readonly options: ReadonlyArray<ProductOption>
}

export interface ConfigurationRequest {
  /** Id for the resolved harness design. */
  readonly id: string
  readonly optionIds: ReadonlyArray<string>
  readonly revision?: string
  readonly metadata?: Readonly<Record<string, string>>
}

export const ConfigurationIssueCodes = {
  DuplicateOptionDefinition: "HK-CONFIG-001",
  DuplicateSelection: "HK-CONFIG-002",
  UnknownSelection: "HK-CONFIG-003",
  UnsatisfiedRequirement: "HK-CONFIG-004",
  MutuallyExcluded: "HK-CONFIG-005",
  ConflictingMutation: "HK-CONFIG-006",
  EnumerationLimit: "HK-CONFIG-007",
  MissingMutationTarget: "HK-CONFIG-008"
} as const

export type ConfigurationIssueCode =
  (typeof ConfigurationIssueCodes)[keyof typeof ConfigurationIssueCodes]

export type ConfigurationEntitySection =
  | "connectors"
  | "wires"
  | "branches"
  | "labels"
  | "splices"
  | "cables"
  | "protections"

export interface ConfigurationIssue {
  readonly code: ConfigurationIssueCode
  readonly message: string
  /** Canonically ordered option ids involved in the issue. */
  readonly optionIds: ReadonlyArray<string>
  readonly section?: ConfigurationEntitySection
  readonly entityId?: string
}

export interface ResolvedConfiguration {
  readonly ok: true
  readonly design: HarnessDesign
  readonly optionIds: ReadonlyArray<string>
  readonly issues: readonly []
}

export interface RejectedConfiguration {
  readonly ok: false
  readonly optionIds: ReadonlyArray<string>
  readonly issues: ReadonlyArray<ConfigurationIssue>
}

export type ConfigurationResolution = ResolvedConfiguration | RejectedConfiguration

export const CONFIGURATION_METADATA_KEYS = {
  family: "configurationFamily",
  options: "configurationOptions"
} as const

/**
 * Preserve literal option ids while providing one named construction point
 * for future family validation tooling. Validation itself stays in resolution
 * so defining an incomplete family never throws during module evaluation.
 */
export const defineProductFamily = <const Family extends ProductFamily>(
  family: Family
): Family => family

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

/** JSON equality with recursively canonical object-key order. */
const stableJson = <Value>(value: Value): string =>
  JSON.stringify(value, (_key, nested) => {
    if (nested === null || Array.isArray(nested)) return nested
    if (Object.prototype.toString.call(nested) !== "[object Object]") return nested
    return Object.fromEntries(
      Object.entries(nested).sort(([left], [right]) => compareText(left, right))
    )
  }) ?? "undefined"

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)]

const duplicateDefinitionIssues = (
  family: ProductFamily
): ReadonlyArray<ConfigurationIssue> => {
  const seen = new Set<string>()
  const reported = new Set<string>()
  const issues: Array<ConfigurationIssue> = []
  for (const option of family.options) {
    if (!seen.has(option.id)) {
      seen.add(option.id)
      continue
    }
    if (reported.has(option.id)) continue
    reported.add(option.id)
    issues.push({
      code: ConfigurationIssueCodes.DuplicateOptionDefinition,
      message: `Product family ${family.id} defines option ${option.id} more than once.`,
      optionIds: [option.id]
    })
  }
  return issues
}

interface DetectableMods<Entity, Override extends object> {
  readonly add?: ReadonlyArray<Entity>
  readonly remove?: ReadonlyArray<string>
  readonly override?: Readonly<Record<string, Override>>
}

interface EntityActions<Override extends object> {
  readonly additions: Array<string>
  readonly removals: Array<string>
  readonly overrides: Array<{
    readonly optionId: string
    readonly values: Override
  }>
}

const conflictIssuesForSection = <Entity, Override extends object = object>(
  section: ConfigurationEntitySection,
  baseItems: ReadonlyArray<Entity>,
  keyOf: (entity: Entity) => string,
  modsOf: (option: ProductOption) => DetectableMods<Entity, Override> | undefined,
  selected: ReadonlyArray<ProductOption>
): ReadonlyArray<ConfigurationIssue> => {
  const baseIds = new Set(baseItems.map(keyOf))
  const actions = new Map<string, EntityActions<Override>>()
  const forEntity = (id: string): EntityActions<Override> => {
    const existing = actions.get(id)
    if (existing !== undefined) return existing
    const created: EntityActions<Override> = { additions: [], removals: [], overrides: [] }
    actions.set(id, created)
    return created
  }

  for (const option of selected) {
    const mods = modsOf(option)
    if (mods === undefined) continue
    for (const added of mods.add ?? []) {
      forEntity(keyOf(added)).additions.push(option.id)
    }
    for (const removed of mods.remove ?? []) forEntity(removed).removals.push(option.id)
    if (mods.override === undefined) continue
    for (const id of Object.keys(mods.override).sort(compareText)) {
      const values = mods.override[id]
      if (values === undefined) continue
      forEntity(id).overrides.push({ optionId: option.id, values })
    }
  }

  const issues: Array<ConfigurationIssue> = []
  for (const id of [...actions.keys()].sort(compareText)) {
    const entity = actions.get(id)!
    const missingTargetOwners = new Set<string>()
    if (!baseIds.has(id)) {
      for (const optionId of entity.removals) {
        // A remove/add pair owned by one option is the supported local
        // replacement form. Every other removal must target the base design.
        if (!entity.additions.includes(optionId)) missingTargetOwners.add(optionId)
      }
      for (const change of entity.overrides) missingTargetOwners.add(change.optionId)
    }
    if (missingTargetOwners.size > 0) {
      issues.push({
        code: ConfigurationIssueCodes.MissingMutationTarget,
        message: `Selected options mutate missing ${section} entity ${id}.`,
        optionIds: selected
          .filter((option) => missingTargetOwners.has(option.id))
          .map((option) => option.id),
        section,
        entityId: id
      })
    }

    let conflicts = entity.additions.length > 1

    if (entity.additions.length === 1) {
      const additionOwner = entity.additions[0]!
      const isLocalReplacement = entity.removals.includes(additionOwner)
      if (baseIds.has(id) && !isLocalReplacement) conflicts = true
      if (entity.removals.some((owner) => owner !== additionOwner)) conflicts = true
      if (entity.overrides.length > 0) conflicts = true
    }

    if (entity.removals.length > 0 && entity.overrides.length > 0) conflicts = true

    const fieldValues = new Map<string, string>()
    for (const change of entity.overrides) {
      for (const [field, value] of Object.entries(change.values)) {
        const serialized = stableJson(value)
        const prior = fieldValues.get(field)
        if (prior !== undefined && prior !== serialized) conflicts = true
        if (prior === undefined) fieldValues.set(field, serialized)
      }
    }

    if (!conflicts) continue
    const involved = new Set<string>()
    for (const optionId of entity.additions) involved.add(optionId)
    for (const optionId of entity.removals) involved.add(optionId)
    for (const change of entity.overrides) involved.add(change.optionId)
    const optionIds = selected.filter((option) => involved.has(option.id)).map((option) => option.id)
    issues.push({
      code: ConfigurationIssueCodes.ConflictingMutation,
      message: `Selected options conflict on ${section} entity ${id}.`,
      optionIds,
      section,
      entityId: id
    })
  }
  return issues
}

interface SimpleMods<T> {
  add?: ReadonlyArray<T>
  remove?: ReadonlyArray<string>
}

interface OverrideMods<T, Override extends object> extends SimpleMods<T> {
  override?: Readonly<Record<string, Override>>
}

interface MergedVariantPatch {
  connectors?: NonNullable<VariantPatch["connectors"]>
  wires?: NonNullable<VariantPatch["wires"]>
  branches?: NonNullable<VariantPatch["branches"]>
  labels?: NonNullable<VariantPatch["labels"]>
  splices?: NonNullable<VariantPatch["splices"]>
  cables?: NonNullable<VariantPatch["cables"]>
  protections?: NonNullable<VariantPatch["protections"]>
}

const mergeSimple = <T>(
  mods: ReadonlyArray<SimpleMods<T> | undefined>
): SimpleMods<T> | undefined => {
  const additions = mods.flatMap((entry) => entry?.add ?? [])
  const removals = unique(mods.flatMap((entry) => entry?.remove ?? []))
  if (additions.length === 0 && removals.length === 0) return undefined
  const merged: SimpleMods<T> = {}
  if (additions.length > 0) merged.add = additions
  if (removals.length > 0) merged.remove = removals
  return merged
}

const mergeOverride = <T, Override extends object>(
  mods: ReadonlyArray<OverrideMods<T, Override> | undefined>
): OverrideMods<T, Override> | undefined => {
  const simple = mergeSimple(mods)
  const combined = new Map<string, Override>()
  for (const entry of mods) {
    if (entry?.override === undefined) continue
    for (const id of Object.keys(entry.override).sort(compareText)) {
      const values = entry.override[id]
      if (values === undefined) continue
      const prior = combined.get(id)
      combined.set(id, prior === undefined ? values : Object.assign({}, prior, values))
    }
  }
  if (simple === undefined && combined.size === 0) return undefined
  const merged: OverrideMods<T, Override> = { ...simple }
  if (combined.size > 0) {
    const overrides: Record<string, Override> = {}
    for (const [id, value] of [...combined.entries()].sort(([left], [right]) =>
      compareText(left, right)
    )) overrides[id] = value
    merged.override = overrides
  }
  return merged
}

const mergePatches = (options: ReadonlyArray<ProductOption>): VariantPatch => {
  const connectors = mergeSimple(options.map((option) => option.patch.connectors))
  const wires = mergeOverride<WireDef, WireProps>(options.map((option) => option.patch.wires))
  const branches = mergeOverride<BranchDef, Partial<Omit<BranchDef, "kind" | "id">>>(
    options.map((option) => option.patch.branches)
  )
  const labels = mergeOverride<LabelDef, Partial<Omit<LabelDef, "kind" | "id">>>(
    options.map((option) => option.patch.labels)
  )
  const splices = mergeSimple(options.map((option) => option.patch.splices))
  const cables = mergeSimple(options.map((option) => option.patch.cables))
  const protections = mergeOverride<ProtectionDef, Partial<Omit<ProtectionDef, "id">>>(
    options.map((option) => option.patch.protections)
  )
  const patch: MergedVariantPatch = {}
  if (connectors !== undefined) patch.connectors = connectors
  if (wires !== undefined) patch.wires = wires
  if (branches !== undefined) patch.branches = branches
  if (labels !== undefined) patch.labels = labels
  if (splices !== undefined) patch.splices = splices
  if (cables !== undefined) patch.cables = cables
  if (protections !== undefined) patch.protections = protections
  return patch
}

/** Resolve a request without throwing or mutating the family/request. */
export const resolveConfiguration = (
  family: ProductFamily,
  request: ConfigurationRequest
): ConfigurationResolution => {
  const issues: Array<ConfigurationIssue> = [...duplicateDefinitionIssues(family)]
  const uniqueFamilyOptions: Array<ProductOption> = []
  const optionById = new Map<string, ProductOption>()
  for (const option of family.options) {
    if (optionById.has(option.id)) continue
    optionById.set(option.id, option)
    uniqueFamilyOptions.push(option)
  }

  const selectionCounts = new Map<string, number>()
  for (const id of request.optionIds) {
    selectionCounts.set(id, (selectionCounts.get(id) ?? 0) + 1)
  }
  for (const id of [...selectionCounts.keys()].sort(compareText)) {
    const count = selectionCounts.get(id)!
    if (count <= 1) continue
    issues.push({
      code: ConfigurationIssueCodes.DuplicateSelection,
      message: `Configuration selects option ${id} ${count} times.`,
      optionIds: [id]
    })
  }

  const requested = new Set(request.optionIds)
  for (const id of [...requested].filter((id) => !optionById.has(id)).sort(compareText)) {
    issues.push({
      code: ConfigurationIssueCodes.UnknownSelection,
      message: `Configuration selects unknown option ${id}.`,
      optionIds: [id]
    })
  }

  const selected = uniqueFamilyOptions.filter((option) => requested.has(option.id))
  const canonicalIds = selected.map((option) => option.id)
  const canonicalSet = new Set(canonicalIds)
  const familyIndex = new Map(uniqueFamilyOptions.map((option, index) => [option.id, index]))
  const compareOptionId = (left: string, right: string): number => {
    const leftIndex = familyIndex.get(left)
    const rightIndex = familyIndex.get(right)
    if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex
    if (leftIndex !== undefined) return -1
    if (rightIndex !== undefined) return 1
    return compareText(left, right)
  }

  for (const option of selected) {
    const requirements = [...unique(option.requires ?? [])].sort(compareOptionId)
    for (const requirement of requirements) {
      if (canonicalSet.has(requirement)) continue
      issues.push({
        code: ConfigurationIssueCodes.UnsatisfiedRequirement,
        message: `Option ${option.id} requires option ${requirement}.`,
        optionIds: [option.id, requirement]
      })
    }
  }

  const exclusionPairs = new Set<string>()
  for (const option of selected) {
    for (const excluded of [...unique(option.excludes ?? [])].sort(compareOptionId)) {
      if (!canonicalSet.has(excluded)) continue
      const pair = [option.id, excluded].sort(compareOptionId)
      const key = `${pair[0] ?? ""}\0${pair[1] ?? ""}`
      if (exclusionPairs.has(key)) continue
      exclusionPairs.add(key)
      issues.push({
        code: ConfigurationIssueCodes.MutuallyExcluded,
        message: `Options ${pair[0]} and ${pair[1]} cannot be selected together.`,
        optionIds: pair
      })
    }
  }

  issues.push(...conflictIssuesForSection(
    "connectors",
    family.base.connectors,
    (connector) => connector.ref,
    (option) => option.patch.connectors,
    selected
  ))
  issues.push(...conflictIssuesForSection(
    "wires",
    family.base.wires,
    (wire) => wire.id,
    (option) => option.patch.wires,
    selected
  ))
  issues.push(...conflictIssuesForSection(
    "branches",
    family.base.branches,
    (branch) => branch.id,
    (option) => option.patch.branches,
    selected
  ))
  issues.push(...conflictIssuesForSection(
    "labels",
    family.base.labels,
    (label) => label.id,
    (option) => option.patch.labels,
    selected
  ))
  issues.push(...conflictIssuesForSection(
    "splices",
    family.base.splices,
    (splice) => splice.id,
    (option) => option.patch.splices,
    selected
  ))
  issues.push(...conflictIssuesForSection(
    "cables",
    family.base.cables,
    (cable) => cable.id,
    (option) => option.patch.cables,
    selected
  ))
  issues.push(...conflictIssuesForSection(
    "protections",
    family.base.protections,
    (protection) => protection.id,
    (option) => option.patch.protections,
    selected
  ))

  if (issues.length > 0) return { ok: false, optionIds: canonicalIds, issues }

  const patch = mergePatches(selected)
  const metadata = {
    ...request.metadata,
    [CONFIGURATION_METADATA_KEYS.family]: family.id,
    [CONFIGURATION_METADATA_KEYS.options]: JSON.stringify(canonicalIds)
  }
  const design = request.revision === undefined
    ? variant(family.base, { id: request.id, metadata, ...patch })
    : variant(family.base, { id: request.id, revision: request.revision, metadata, ...patch })
  return { ok: true, design, optionIds: canonicalIds, issues: [] }
}

export interface ConfigurationEnumerationOptions {
  /** Maximum candidate subsets to evaluate. Defaults to 4096. */
  readonly maximum?: number
  /** Descriptive alias for `maximum`. */
  readonly maxConfigurations?: number
}

export interface EnumeratedConfigurations {
  readonly ok: true
  readonly configurations: ReadonlyArray<ReadonlyArray<string>>
  readonly issues: readonly []
}

export interface RejectedConfigurationEnumeration {
  readonly ok: false
  readonly configurations: readonly []
  readonly issues: ReadonlyArray<ConfigurationIssue>
}

export type ConfigurationEnumeration =
  | EnumeratedConfigurations
  | RejectedConfigurationEnumeration

/**
 * Enumerate valid subsets in ascending binary order (the first family option
 * is the least-significant bit). The explicit guard applies to candidate
 * subsets, making runtime bounded even when constraints reject most of them.
 */
export const enumerateConfigurations = (
  family: ProductFamily,
  limit: ConfigurationEnumerationOptions = {}
): ConfigurationEnumeration => {
  const familyIssues = duplicateDefinitionIssues(family)
  if (familyIssues.length > 0) {
    return { ok: false, configurations: [], issues: familyIssues }
  }

  const maximum = limit.maximum ?? limit.maxConfigurations ?? 4096
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    return {
      ok: false,
      configurations: [],
      issues: [{
        code: ConfigurationIssueCodes.EnumerationLimit,
        message: `Configuration enumeration maximum must be a positive safe integer; received ${maximum}.`,
        optionIds: []
      }]
    }
  }

  let candidateCount = 1
  for (let index = 0; index < family.options.length; index += 1) {
    if (candidateCount > maximum / 2) {
      return {
        ok: false,
        configurations: [],
        issues: [{
          code: ConfigurationIssueCodes.EnumerationLimit,
          message: `Product family ${family.id} has more than ${maximum} candidate configurations.`,
          optionIds: []
        }]
      }
    }
    candidateCount *= 2
  }

  const configurations: Array<ReadonlyArray<string>> = []
  for (let mask = 0; mask < candidateCount; mask += 1) {
    const optionIds = family.options
      .filter((_option, index) => Math.floor(mask / 2 ** index) % 2 === 1)
      .map((option) => option.id)
    const result = resolveConfiguration(family, {
      id: `${family.id}:configuration`,
      optionIds
    })
    if (result.ok) configurations.push(result.optionIds)
  }
  return { ok: true, configurations, issues: [] }
}

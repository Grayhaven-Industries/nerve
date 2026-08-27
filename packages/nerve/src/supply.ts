/**
 * Deterministic, provenance-preserving supply registry and snapshots.
 *
 * Providers are queried synchronously in caller priority order. This module
 * performs no discovery or network I/O: live data belongs in provider setup,
 * while a snapshot captures the exact records supplied to this pure layer.
 */
import type { AutocompleteString } from "./domain.js"
import type { DiagnosticSeverity } from "./diagnostics.js"
import type { PartLifecycle } from "./config.js"

export const SUPPLY_SNAPSHOT_SCHEMA_VERSION = "1.0.0" as const

export type SupplyItemKind =
  | "connector"
  | "terminal"
  | "seal"
  | "wire"
  | "protection"
  | "tool"
  | "process-recipe"

/** Source qualification is intentionally extensible for organization-specific schemes. */
export type SupplyQualification = AutocompleteString<
  "unverified" | "inspired-by" | "manufacturer-verified" | "qualified" | "verified"
>

export type SupplyApproval = "approved" | "conditional" | "unapproved"

export interface SupplyProvenance {
  /** Exact URI, document id, database release, or other source reference. */
  readonly source: string
  /** Caller/provider supplied timestamp; this module never generates one. */
  readonly retrievedAt: string
  readonly qualification: SupplyQualification
}

export interface PriceBreak {
  /** Smallest order quantity eligible for this unit price. */
  readonly minimumQuantity: number
  readonly unitCost: number
}

export interface SupplyOffer {
  readonly supplier: string
  readonly currency: string
  readonly priceBreaks: ReadonlyArray<PriceBreak>
  readonly availableQuantity?: number
  readonly leadTimeDays?: number
  readonly minimumOrderQuantity?: number
  readonly contractReference?: string
  readonly sourceReference?: string
  /** Exact timestamp supplied with this offer. */
  readonly retrievedAt: string
}

interface SupplyRecordFields {
  readonly manufacturer?: string
  readonly description?: string
  readonly lifecycle: PartLifecycle
  readonly approval: SupplyApproval
  /** MPN or record ids of approved alternates. */
  readonly alternates: ReadonlyArray<string>
  readonly compatibleTooling: ReadonlyArray<string>
  readonly compatibleProcesses: ReadonlyArray<string>
  readonly provenance: SupplyProvenance
  readonly offers: ReadonlyArray<SupplyOffer>
}

export type CatalogSupplyItemKind = Exclude<SupplyItemKind, "process-recipe">

export type SupplyRecord = SupplyRecordFields & (
  | {
      readonly kind: CatalogSupplyItemKind
      /** Optional registry identity when it differs from the orderable MPN. */
      readonly id?: string
      readonly mpn: string
    }
  | {
      readonly kind: "process-recipe"
      readonly id: string
      readonly mpn?: string
    }
)

interface SupplyRequestFields {
  /** Quantity used when selecting an offer; defaults to one. */
  readonly quantity?: number
  readonly preferredSupplier?: string
  readonly preferredCurrency?: string
}

export type SupplyRequest = SupplyRequestFields & (
  | {
      readonly kind: CatalogSupplyItemKind
      readonly mpn: string
    }
  | {
      readonly kind: "process-recipe"
      readonly id: string
    }
)

export interface SupplyProvider {
  readonly id: string
  get(request: SupplyRequest): SupplyRecord | undefined
}

export const SupplyDiagnosticCodes = {
  Conflict: "HK-SUPPLY-001",
  InvalidPriceBreak: "HK-SUPPLY-002",
  Unresolved: "HK-SUPPLY-003",
  InvalidRecord: "HK-SUPPLY-004",
  InvalidQuantity: "HK-SUPPLY-005",
  InvalidAvailability: "HK-SUPPLY-006",
  AmbiguousCurrency: "HK-SUPPLY-007"
} as const

export type SupplyDiagnosticCode =
  (typeof SupplyDiagnosticCodes)[keyof typeof SupplyDiagnosticCodes]

export interface SupplyDiagnostic {
  readonly code: SupplyDiagnosticCode
  readonly severity: DiagnosticSeverity
  readonly message: string
  /** Canonical `kind:mpn-or-record-id` key. */
  readonly target: string
  readonly providers?: ReadonlyArray<string>
  readonly fields?: ReadonlyArray<string>
}

export interface SupplyResolution {
  readonly request: SupplyRequest
  readonly record?: SupplyRecord
  readonly provider?: string
  readonly diagnostics: ReadonlyArray<SupplyDiagnostic>
}

export interface SelectedSupplyPrice extends PriceBreak {
  readonly supplier: string
  readonly currency: string
  readonly requestedQuantity: number
  /** Quantity that must actually be ordered after MOQ/first-break handling. */
  readonly orderQuantity: number
  readonly priceBreak: PriceBreak
  readonly offer: SupplyOffer
}

export interface SupplyPriceSelectionOptions {
  readonly preferredSupplier?: string
  readonly preferredCurrency?: string
}

export interface SupplySnapshotOptions {
  /** Required caller-owned capture time; no clock is read by this module. */
  readonly capturedAt: string
  readonly source?: string
  readonly release?: string
  /** Alias accepted when a caller wants to name the field explicitly. */
  readonly releaseLabel?: string
}

export interface SupplySnapshot {
  readonly schemaVersion: typeof SUPPLY_SNAPSHOT_SCHEMA_VERSION
  readonly capturedAt: string
  readonly source?: string
  readonly release?: string
  readonly requests: ReadonlyArray<SupplyRequest>
  readonly records: ReadonlyArray<SupplyRecord>
  readonly unresolvedRequests: ReadonlyArray<SupplyRequest>
  readonly diagnostics: ReadonlyArray<SupplyDiagnostic>
}

interface SupplySnapshotDraft {
  schemaVersion: typeof SUPPLY_SNAPSHOT_SCHEMA_VERSION
  capturedAt: string
  source?: string
  release?: string
  requests: ReadonlyArray<SupplyRequest>
  records: ReadonlyArray<SupplyRecord>
  unresolvedRequests: ReadonlyArray<SupplyRequest>
  diagnostics: ReadonlyArray<SupplyDiagnostic>
}

type SupplyRecords =
  | ReadonlyArray<SupplyRecord>
  | Readonly<Record<string, SupplyRecord>>

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

/** JSON equality/fingerprinting with recursively canonical object-key order. */
const stableJson = <Value>(value: Value): string =>
  JSON.stringify(value, (_key, nested) => {
    if (nested === null || Array.isArray(nested)) return nested
    if (Object.prototype.toString.call(nested) !== "[object Object]") return nested
    return Object.fromEntries(
      Object.entries(nested).sort(([left], [right]) => compareText(left, right))
    )
  }) ?? "undefined"

const KIND_ORDER = {
  connector: 0,
  terminal: 1,
  seal: 2,
  wire: 3,
  protection: 4,
  tool: 5,
  "process-recipe": 6
} as const satisfies Readonly<Record<SupplyItemKind, number>>

const requestIdentifier = (request: SupplyRequest): string =>
  request.kind === "process-recipe" ? request.id : request.mpn

const recordIdentifier = (record: SupplyRecord): string =>
  record.kind === "process-recipe" ? record.id : record.mpn

const requestKey = (request: SupplyRequest): string =>
  `${request.kind}:${requestIdentifier(request)}`

const recordKey = (record: SupplyRecord): string =>
  `${record.kind}:${recordIdentifier(record)}`

const comparePriceBreak = (left: PriceBreak, right: PriceBreak): number =>
  left.minimumQuantity - right.minimumQuantity || left.unitCost - right.unitCost

const offerFingerprint = (offer: SupplyOffer): string => stableJson({
  ...offer,
  priceBreaks: [...offer.priceBreaks].sort(comparePriceBreak)
})

const compareOffer = (left: SupplyOffer, right: SupplyOffer): number =>
  compareText(left.supplier, right.supplier) ||
  compareText(left.currency, right.currency) ||
  compareText(offerFingerprint(left), offerFingerprint(right))

const compareRequest = (left: SupplyRequest, right: SupplyRequest): number =>
  KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
  compareText(requestIdentifier(left), requestIdentifier(right)) ||
  (left.quantity ?? 1) - (right.quantity ?? 1) ||
  compareText(left.preferredSupplier ?? "", right.preferredSupplier ?? "") ||
  compareText(left.preferredCurrency ?? "", right.preferredCurrency ?? "")

const compareRecord = (left: SupplyRecord, right: SupplyRecord): number =>
  KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
  compareText(recordIdentifier(left), recordIdentifier(right))

const cloneRequest = (request: SupplyRequest): SupplyRequest => ({ ...request })

const clonePriceBreak = (price: PriceBreak): PriceBreak => ({
  minimumQuantity: price.minimumQuantity,
  unitCost: price.unitCost
})

const cloneOffer = (offer: SupplyOffer): SupplyOffer => ({
  ...offer,
  priceBreaks: offer.priceBreaks.map(clonePriceBreak).sort(comparePriceBreak),
})

const cloneRecord = (record: SupplyRecord): SupplyRecord => ({
  ...record,
  alternates: [...record.alternates].sort(compareText),
  compatibleTooling: [...record.compatibleTooling].sort(compareText),
  compatibleProcesses: [...record.compatibleProcesses].sort(compareText),
  provenance: { ...record.provenance },
  offers: record.offers.map(cloneOffer).sort(compareOffer)
})

/** Build an in-memory provider. Input arrays/maps are never mutated. */
export const staticSupplyProvider = (
  id: string,
  records: SupplyRecords
): SupplyProvider => {
  const values = Array.isArray(records) ? records : Object.values(records)
  const byKey = new Map<string, SupplyRecord>()
  for (const record of values) {
    const key = recordKey(record)
    if (!byKey.has(key)) byKey.set(key, record)
  }
  return {
    id,
    get: (request) => byKey.get(requestKey(request))
  }
}

const isPositiveQuantity = (value: number): boolean =>
  Number.isSafeInteger(value) && value > 0

const isValidPriceBreak = (price: PriceBreak): boolean =>
  isPositiveQuantity(price.minimumQuantity) &&
  Number.isFinite(price.unitCost) &&
  price.unitCost >= 0

const isValidAvailability = (quantity: number): boolean =>
  Number.isSafeInteger(quantity) && quantity >= 0

interface SupplyPriceSelectionDraft {
  preferredSupplier?: string
  preferredCurrency?: string
}

interface PriceCandidate {
  readonly offer: SupplyOffer
  readonly priceBreak: PriceBreak
  readonly orderQuantity: number
}

type PriceEvaluation =
  | { readonly kind: "selected"; readonly candidate: PriceCandidate }
  | { readonly kind: "ambiguous-currency"; readonly currencies: ReadonlyArray<string> }
  | { readonly kind: "unavailable" }

const normalizePriceSelection = (
  preference: string | SupplyPriceSelectionOptions | undefined,
  preferredCurrency: string | undefined
): SupplyPriceSelectionOptions => {
  const normalized: SupplyPriceSelectionDraft = {}
  if (preference instanceof Object) {
    if (preference.preferredSupplier !== undefined) {
      normalized.preferredSupplier = preference.preferredSupplier
    }
    if (preference.preferredCurrency !== undefined) {
      normalized.preferredCurrency = preference.preferredCurrency
    }
  } else if (preference !== undefined) {
    normalized.preferredSupplier = preference
  }
  if (preferredCurrency !== undefined) normalized.preferredCurrency = preferredCurrency
  return normalized
}

const evaluateSupplyPrice = (
  record: SupplyRecord,
  quantity: number,
  preference?: string | SupplyPriceSelectionOptions,
  preferredCurrency?: string
): PriceEvaluation => {
  if (!isPositiveQuantity(quantity)) return { kind: "unavailable" }
  const candidates: Array<PriceCandidate> = []
  for (const offer of record.offers) {
    if (
      offer.minimumOrderQuantity !== undefined &&
      !isPositiveQuantity(offer.minimumOrderQuantity)
    ) continue
    if (
      offer.availableQuantity !== undefined &&
      !isValidAvailability(offer.availableQuantity)
    ) continue
    const breaks = offer.priceBreaks.filter(isValidPriceBreak).sort(comparePriceBreak)
    if (breaks.length === 0) continue
    let orderQuantity = Math.max(quantity, offer.minimumOrderQuantity ?? 1)
    if (orderQuantity < breaks[0]!.minimumQuantity) {
      orderQuantity = breaks[0]!.minimumQuantity
    }
    if (
      offer.availableQuantity !== undefined &&
      offer.availableQuantity < orderQuantity
    ) continue
    const eligible = breaks.filter((price) => price.minimumQuantity <= orderQuantity)
    const priceBreak = eligible[eligible.length - 1]!
    candidates.push({ offer, priceBreak, orderQuantity })
  }

  const options = normalizePriceSelection(preference, preferredCurrency)
  let pool = candidates
  if (options.preferredSupplier !== undefined) {
    const matchingSupplier = pool.filter(
      (candidate) => candidate.offer.supplier === options.preferredSupplier
    )
    if (matchingSupplier.length > 0) pool = matchingSupplier
  }
  if (options.preferredCurrency !== undefined) {
    const matchingCurrency = pool.filter(
      (candidate) => candidate.offer.currency === options.preferredCurrency
    )
    if (matchingCurrency.length > 0) pool = matchingCurrency
  }

  const currencies = [...new Set(pool.map((candidate) => candidate.offer.currency))]
    .sort(compareText)
  if (currencies.length > 1) return { kind: "ambiguous-currency", currencies }
  const selected = [...pool].sort((left, right) =>
    left.priceBreak.unitCost - right.priceBreak.unitCost ||
    compareText(left.offer.supplier, right.offer.supplier) ||
    right.priceBreak.minimumQuantity - left.priceBreak.minimumQuantity ||
    compareText(left.offer.retrievedAt, right.offer.retrievedAt)
  )[0]
  return selected === undefined
    ? { kind: "unavailable" }
    : { kind: "selected", candidate: selected }
}

const validateWinner = (
  request: SupplyRequest,
  record: SupplyRecord,
  provider: string
): ReadonlyArray<SupplyDiagnostic> => {
  const target = requestKey(request)
  const diagnostics: Array<SupplyDiagnostic> = []
  if (record.kind !== request.kind || recordIdentifier(record) !== requestIdentifier(request)) {
    diagnostics.push({
      code: SupplyDiagnosticCodes.InvalidRecord,
      severity: "error",
      message: `Provider ${provider} returned ${recordKey(record)} for request ${target}.`,
      target,
      providers: [provider],
      fields: ["kind", record.kind === "process-recipe" ? "id" : "mpn"]
    })
  }
  if (
    record.provenance.source.length === 0 ||
    record.provenance.retrievedAt.length === 0 ||
    String(record.provenance.qualification).length === 0
  ) {
    diagnostics.push({
      code: SupplyDiagnosticCodes.InvalidRecord,
      severity: "error",
      message: `Supply record ${target} has incomplete provenance.`,
      target,
      providers: [provider],
      fields: ["provenance"]
    })
  }
  const offers = [...record.offers].sort(compareOffer)
  for (const offer of offers) {
    if (
      offer.availableQuantity !== undefined &&
      !isValidAvailability(offer.availableQuantity)
    ) {
      diagnostics.push({
        code: SupplyDiagnosticCodes.InvalidAvailability,
        severity: "error",
        message: `Supplier ${offer.supplier} has invalid availability ${offer.availableQuantity} for ${target}.`,
        target,
        providers: [provider],
        fields: ["offers.availableQuantity"]
      })
    }
    const breaks = [...offer.priceBreaks].sort(comparePriceBreak)
    for (const price of breaks) {
      if (isValidPriceBreak(price)) continue
      diagnostics.push({
        code: SupplyDiagnosticCodes.InvalidPriceBreak,
        severity: "error",
        message: `Supplier ${offer.supplier} has an invalid price break (${price.minimumQuantity}, ${price.unitCost}) for ${target}.`,
        target,
        providers: [provider],
        fields: ["offers.priceBreaks"]
      })
    }
  }
  const quantity = request.quantity
  if (quantity !== undefined && !isPositiveQuantity(quantity)) {
    diagnostics.push({
      code: SupplyDiagnosticCodes.InvalidQuantity,
      severity: "error",
      message: `Supply request ${target} has invalid quantity ${quantity}.`,
      target,
      fields: ["quantity"]
    })
  } else {
    const evaluated = evaluateSupplyPrice(
      record,
      quantity ?? 1,
      request.preferredSupplier,
      request.preferredCurrency
    )
    if (evaluated.kind === "ambiguous-currency") {
      diagnostics.push({
        code: SupplyDiagnosticCodes.AmbiguousCurrency,
        severity: "warning",
        message: `Supply request ${target} has viable offers in multiple currencies (${evaluated.currencies.join(", ")}); select a supplier or currency.`,
        target,
        providers: [provider],
        fields: ["offers.currency"]
      })
    }
  }
  return diagnostics
}

const normalizedConflictFields = (
  winner: SupplyRecord,
  other: SupplyRecord
): ReadonlyArray<string> => {
  const left = cloneRecord(winner)
  const right = cloneRecord(other)
  const fields: Array<string> = []
  if (left.manufacturer !== right.manufacturer) fields.push("manufacturer")
  if (left.lifecycle !== right.lifecycle) fields.push("lifecycle")
  if (left.approval !== right.approval) fields.push("approval")
  if (stableJson(left.alternates) !== stableJson(right.alternates)) {
    fields.push("alternates")
  }
  if (stableJson(left.compatibleTooling) !== stableJson(right.compatibleTooling)) {
    fields.push("compatibleTooling")
  }
  if (stableJson(left.compatibleProcesses) !== stableJson(right.compatibleProcesses)) {
    fields.push("compatibleProcesses")
  }
  if (left.provenance.source !== right.provenance.source) fields.push("provenance.source")
  if (left.provenance.retrievedAt !== right.provenance.retrievedAt) {
    fields.push("provenance.retrievedAt")
  }
  if (left.provenance.qualification !== right.provenance.qualification) {
    fields.push("provenance.qualification")
  }
  if (stableJson(left.offers) !== stableJson(right.offers)) fields.push("offers")
  return fields
}

/**
 * Resolve in priority order. The first provider wins as one whole record;
 * later divergent records are diagnosed and never merged field-by-field.
 */
export const resolveSupplyRecord = (
  providers: ReadonlyArray<SupplyProvider>,
  request: SupplyRequest
): SupplyResolution => {
  const answers = providers
    .map((provider) => ({ provider: provider.id, record: provider.get(request) }))
    .filter(
      (answer): answer is { readonly provider: string; readonly record: SupplyRecord } =>
        answer.record !== undefined
    )
  const requestCopy = cloneRequest(request)
  if (answers.length === 0) {
    return {
      request: requestCopy,
      diagnostics: [{
        code: SupplyDiagnosticCodes.Unresolved,
        severity: "warning",
        message: `No supply provider resolved ${requestKey(request)}.`,
        target: requestKey(request)
      }]
    }
  }

  const winner = answers[0]!
  const diagnostics: Array<SupplyDiagnostic> = [
    ...validateWinner(request, winner.record, winner.provider)
  ]
  for (const other of answers.slice(1)) {
    const fields = normalizedConflictFields(winner.record, other.record)
    if (fields.length === 0) continue
    diagnostics.push({
      code: SupplyDiagnosticCodes.Conflict,
      severity: "warning",
      message: `Supply providers disagree on ${requestKey(request)}: ${winner.provider} vs ${other.provider} differ on ${fields.join(", ")} (using ${winner.provider}).`,
      target: requestKey(request),
      providers: [winner.provider, other.provider],
      fields
    })
  }
  return {
    request: requestCopy,
    record: winner.record,
    provider: winner.provider,
    diagnostics
  }
}

/**
 * Select the deepest eligible price break, then the lowest unit cost within
 * one currency. The existing supplier string remains supported; the options
 * form adds explicit supplier/currency narrowing. Mixed viable currencies are
 * ambiguous and return `undefined` because this pure layer performs no FX.
 */
export const selectSupplyPrice = (
  record: SupplyRecord,
  quantity: number,
  preference?: string | SupplyPriceSelectionOptions,
  preferredCurrency?: string
): SelectedSupplyPrice | undefined => {
  const evaluated = evaluateSupplyPrice(record, quantity, preference, preferredCurrency)
  if (evaluated.kind !== "selected") return undefined
  const selected = evaluated.candidate
  return {
    supplier: selected.offer.supplier,
    currency: selected.offer.currency,
    minimumQuantity: selected.priceBreak.minimumQuantity,
    unitCost: selected.priceBreak.unitCost,
    requestedQuantity: quantity,
    orderQuantity: selected.orderQuantity,
    priceBreak: selected.priceBreak,
    offer: selected.offer
  }
}

const compareDiagnostic = (left: SupplyDiagnostic, right: SupplyDiagnostic): number =>
  compareText(left.target, right.target) ||
  compareText(left.code, right.code) ||
  compareText(left.message, right.message)

const uniqueDiagnostics = (
  diagnostics: ReadonlyArray<SupplyDiagnostic>
): ReadonlyArray<SupplyDiagnostic> => {
  const byValue = new Map<string, SupplyDiagnostic>()
  for (const diagnostic of diagnostics) {
    const key = stableJson(diagnostic)
    if (!byValue.has(key)) byValue.set(key, diagnostic)
  }
  return [...byValue.values()].sort(compareDiagnostic)
}

/**
 * Capture canonical registry inputs/results for a repeatable estimate. Every
 * timestamp is caller/provider supplied, unresolved requests remain explicit,
 * and returned records own cloned/sorted arrays.
 */
export const createSupplySnapshot = (
  requests: ReadonlyArray<SupplyRequest>,
  providers: ReadonlyArray<SupplyProvider>,
  options: SupplySnapshotOptions
): SupplySnapshot => {
  const canonicalRequests = requests.map(cloneRequest).sort(compareRequest)
  const records = new Map<string, SupplyRecord>()
  const unresolvedRequests: Array<SupplyRequest> = []
  const diagnostics: Array<SupplyDiagnostic> = []

  for (const request of canonicalRequests) {
    const resolution = resolveSupplyRecord(providers, request)
    diagnostics.push(...resolution.diagnostics)
    if (resolution.record === undefined) {
      unresolvedRequests.push(cloneRequest(request))
      continue
    }
    const record = cloneRecord(resolution.record)
    const key = recordKey(record)
    const prior = records.get(key)
    if (prior === undefined) {
      records.set(key, record)
      continue
    }
    const fields = normalizedConflictFields(prior, record)
    if (fields.length === 0) continue
    diagnostics.push({
      code: SupplyDiagnosticCodes.Conflict,
      severity: "warning",
      message: `Resolved requests produced divergent records for ${key}; the first canonical record is retained.`,
      target: key,
      fields
    })
  }

  const release = options.release ?? options.releaseLabel
  const snapshot: SupplySnapshotDraft = {
    schemaVersion: SUPPLY_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: options.capturedAt,
    requests: canonicalRequests,
    records: [...records.values()].sort(compareRecord),
    unresolvedRequests,
    diagnostics: uniqueDiagnostics(diagnostics)
  }
  if (options.source !== undefined) snapshot.source = options.source
  if (release !== undefined) snapshot.release = release
  return snapshot
}

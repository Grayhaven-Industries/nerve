/**
 * How much of a clean report rests on data nobody has checked.
 *
 * Coverage and soundness are independent quantities. Coverage — what fraction
 * of real failure modes the rule set speaks to — is counted honestly in
 * docs/content/docs/reference/rule-coverage.mdx. Soundness — of the claims
 * it makes, how many are correct — has never been measured at all, and the gap is not hypothetical:
 * four errors in this repository's own reference data surfaced in one batch,
 * and every one surfaced as a side effect of modelling terminals rather than
 * because anything was looking. Two JST contact ranges recorded backwards, a
 * DEUTSCH range that belonged to a larger contact, and Mega-Fit terminals that
 * were kit part numbers from an unrelated family.
 *
 * All four sat in parts marked `inspired-by`, which is the dangerous tier
 * precisely because it sounds checked. `unverified` warns you. `verified`
 * means a human compared it against a primary source. `inspired-by` means
 * someone transcribed a catalogue and nobody went back.
 *
 * This audit does not judge whether a value is right — nothing here can. It
 * reports which parts a design's verdict depends on and what evidence stands
 * behind each, so "no errors" can be read with the right amount of confidence
 * rather than as a fact about the harness.
 */
import type {
  Hir,
  HirConnector,
  HirProvenance,
  HirSealPart,
  HirTerminalPart
} from "@grayhaven/nerve"

/** Ordered weakest to strongest; `none` is a part carrying no provenance. */
export type EvidenceTier = "none" | "unverified" | "inspired-by" | "verified"

const TIER_ORDER: ReadonlyArray<EvidenceTier> = [
  "none",
  "unverified",
  "inspired-by",
  "verified"
]

export interface AuditedPart {
  readonly mpn: string
  /** `connector`, `terminal`, `seal` or `wire` — what role it plays here. */
  readonly kind: string
  readonly tier: EvidenceTier
  readonly datasheet?: string
  /** HIR refs that depend on this part, sorted. */
  readonly usedBy: ReadonlyArray<string>
  /**
   * Fields on this part that a rule can turn into a verdict. A part with
   * limits and no evidence is the case worth seeing: the checks run, they
   * pass, and the numbers they passed against are unsourced.
   */
  readonly decisiveFields: ReadonlyArray<string>
}

export interface ProvenanceAudit {
  readonly auditVersion: "0.1.0"
  readonly parts: ReadonlyArray<AuditedPart>
  readonly summary: {
    readonly parts: number
    readonly byTier: Readonly<Record<EvidenceTier, number>>
    /** Parts carrying at least one decisive field below `verified`. */
    readonly decisiveUnverified: number
    /** Weakest tier any decisive field in this design rests on. */
    readonly weakestDecisiveTier?: EvidenceTier
  }
}

/** Fields a rule reads as a limit, and therefore turns into a pass or fail. */
const DECISIVE = [
  "wireGaugeRange",
  "currentLimitA",
  "voltageLimitV",
  "currentRatingA",
  "insulationDiameterRange",
  "crimpHeight",
  "pullForceN",
  "stripLength",
  "cavityLayout",
  "reservedPins",
  "pinout",
  "compatibleTerminals",
  "compatibleSeals",
  "sealed",
  "ohmsPerKm",
  "temperatureRating"
] as const

const tierOf = (p: HirProvenance | undefined): EvidenceTier =>
  p === undefined ? "none" : p.verification

/** Every part a compiled harness can rest a verdict on. */
type AuditablePart =
  | HirConnector
  | HirTerminalPart
  | HirSealPart
  | NonNullable<Hir["wires"][number]["part"]>

const decisiveOn = (part: AuditablePart): ReadonlyArray<string> => {
  const present = new Set(
    Object.entries(part)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field)
  )
  return DECISIVE.filter((f) => present.has(f))
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Audit every part a compiled harness depends on.
 *
 * Deterministic: parts sort by kind then MPN, `usedBy` sorts within each, and
 * nothing here reads a clock or the filesystem.
 */
export const auditProvenance = (hir: Hir): ProvenanceAudit => {
  const found = new Map<
    string,
    { mpn: string; kind: string; tier: EvidenceTier; datasheet?: string; usedBy: Set<string>; decisive: ReadonlyArray<string> }
  >()

  const add = (
    mpn: string,
    kind: string,
    provenance: HirProvenance | undefined,
    part: AuditablePart,
    usedBy: string
  ): void => {
    const key = `${kind} ${mpn}`
    const existing = found.get(key)
    if (existing !== undefined) {
      existing.usedBy.add(usedBy)
      return
    }
    const identity = { mpn, kind, tier: tierOf(provenance) }
    const sourced =
      provenance?.datasheet === undefined
        ? identity
        : { ...identity, datasheet: provenance.datasheet }
    found.set(key, { ...sourced, usedBy: new Set([usedBy]), decisive: decisiveOn(part) })
  }

  for (const c of hir.connectors) {
    add(c.mpn, "connector", c.provenance, c, `connector:${c.ref}`)
    for (const pin of c.pins) {
      const ref = `connector:${c.ref}.pin:${pin.pin}`
      if (pin.terminalPart !== undefined) {
        add(pin.terminalPart.mpn, "terminal", pin.terminalPart.provenance, pin.terminalPart, ref)
      }
      if (pin.sealPart !== undefined) {
        add(pin.sealPart.mpn, "seal", pin.sealPart.provenance, pin.sealPart, ref)
      }
    }
  }
  for (const w of hir.wires) {
    if (w.part !== undefined) {
      add(w.part.mpn, "wire", w.part.provenance, w.part, `wire:${w.id}`)
    }
  }

  const parts: ReadonlyArray<AuditedPart> = [...found.values()]
    .map((p) => {
      const identity = { mpn: p.mpn, kind: p.kind, tier: p.tier }
      const sourced = p.datasheet === undefined ? identity : { ...identity, datasheet: p.datasheet }
      return { ...sourced, usedBy: [...p.usedBy].sort(cmp), decisiveFields: p.decisive }
    })
    .sort((a, b) => cmp(a.kind, b.kind) || cmp(a.mpn, b.mpn))

  // Keys in TIER_ORDER, so the JSON reads weakest to strongest.
  const byTier = { none: 0, unverified: 0, "inspired-by": 0, verified: 0 } satisfies Record<
    EvidenceTier,
    number
  >
  for (const p of parts) byTier[p.tier] += 1

  const decisive = parts.filter((p) => p.decisiveFields.length > 0 && p.tier !== "verified")
  const weakest = decisive
    .map((p) => p.tier)
    .sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b))[0]

  const counts = { parts: parts.length, byTier, decisiveUnverified: decisive.length }
  const summary = weakest === undefined ? counts : { ...counts, weakestDecisiveTier: weakest }
  return { auditVersion: "0.1.0", parts, summary }
}

export const provenanceAuditJson = (audit: ProvenanceAudit): string =>
  JSON.stringify(audit, null, 2) + "\n"

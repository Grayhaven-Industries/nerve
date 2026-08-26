/**
 * Numeric view of rule codes, for computation: sorting, bitsets, category
 * math, compact storage. Derived — not a registry — so it can never drift
 * from the codes and never needs maintenance when rules are added.
 *
 * Scheme: HK-<CATEGORY>-<NNN> → band(category) + NNN.
 *   HK-DOC-001  → 1001
 *   HK-MFG-004  → 2004
 *   HK-WIRE-004 → 3004
 *   HK-ELEC-003 → 4003
 *   HK-CONN-011 → 5011
 *
 * The string code remains the public contract (CI gates, waivers, docs);
 * numbers are an internal computational view. Custom rule codes (ORG-*,
 * SHOP-*) deliberately return undefined — callers fall back to strings.
 */

export const RULE_CATEGORY_BANDS = {
  DOC: 1000,
  MFG: 2000,
  WIRE: 3000,
  ELEC: 4000,
  CONN: 5000
} as const

export type RuleCategory = keyof typeof RULE_CATEGORY_BANDS

const CODE_PATTERN = /^HK-(DOC|MFG|WIRE|ELEC|CONN)-(\d{3})$/

/** `"HK-CONN-011"` → `5011`. Undefined for non-HK codes. */
export const ruleCodeNumber = (code: string): number | undefined => {
  const m = CODE_PATTERN.exec(code)
  if (m === null) return undefined
  // SAFETY: the first capture group is the alternation of exactly the
  // RULE_CATEGORY_BANDS keys, so a match binds a RuleCategory.
  return RULE_CATEGORY_BANDS[m[1] as RuleCategory] + Number(m[2])
}

/** Category whose band is `band`, or undefined between the bands. */
const categoryForBand = (band: number): RuleCategory | undefined => {
  // SAFETY: Object.entries erases the key literal type; RULE_CATEGORY_BANDS
  // is a closed `as const` object, so its keys are exactly RuleCategory.
  const entries = Object.entries(RULE_CATEGORY_BANDS) as ReadonlyArray<
    readonly [RuleCategory, number]
  >
  return entries.find(([, b]) => b === band)?.[0]
}

/** `5011` → `"HK-CONN-011"`. Undefined for numbers outside the bands. */
export const ruleCodeFromNumber = (n: number): string | undefined => {
  if (!Number.isInteger(n)) return undefined
  const band = Math.floor(n / 1000) * 1000
  const suffix = n - band
  if (suffix < 1 || suffix > 999) return undefined
  const category = categoryForBand(band)
  if (category === undefined) return undefined
  return `HK-${category}-${String(suffix).padStart(3, "0")}`
}

/** Category of a code (or its number): `"HK-MFG-004"` / `2004` → `"MFG"`. */
export const ruleCategory = (code: string | number): RuleCategory | undefined => {
  // A finite number is already the numeric view; anything else (a string, or
  // NaN/Infinity, which never sit in a band) goes through the code parser.
  const n = Number.isFinite(code) ? Number(code) : ruleCodeNumber(String(code))
  if (n === undefined) return undefined
  const band = Math.floor(n / 1000) * 1000
  return categoryForBand(band)
}

/** Compact set of fired rules for telemetry / waiver storage. */
export const codesToNumbers = (codes: ReadonlyArray<string>): ReadonlyArray<number> =>
  [...new Set(codes.map(ruleCodeNumber).filter((n): n is number => n !== undefined))].sort(
    (a, b) => a - b
  )

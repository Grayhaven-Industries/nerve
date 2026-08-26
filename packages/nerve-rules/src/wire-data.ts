/**
 * Wire reference data shared by electrical rules.
 *
 * Ampacities are conservative bundled-harness values (chassis-wiring tables
 * derated for bundling). Rule packs can override with stricter
 * standards-informed data later (PRD §38).
 */

// Gauge parsing lives in core: compileDesign canonicalizes gauges into HIR
// with the same parser, so rules and compiler can never disagree.
import { parseAwg } from "@grayhaven/nerve"
export { parseAwg }

/** A per-gauge figure keyed by AWG number: the contract a shop profile's
 * override tables and the bundled defaults share. */
export type GaugeTable = Readonly<Record<number, number>>

/** Max continuous current (A) per AWG, bundled/derated. */
export const AMPACITY_BY_AWG = {
  30: 0.3,
  28: 0.5,
  26: 0.8,
  24: 1.4,
  22: 2.3,
  20: 3.7,
  18: 5.9,
  16: 9.4,
  14: 15,
  12: 24,
  10: 38
} satisfies Readonly<Record<number, number>>

/**
 * Bundle derating: how much of a conductor's ampacity survives being one of
 * many conductors in the same bundle.
 *
 * `AMPACITY_BY_AWG` is a single flat table, and one flat table cannot be right
 * for both cases it gets asked about. A conductor in a pair sheds heat into
 * still air over most of its surface; a conductor in the interior of a 30-way
 * trunk can only convect into the conductors touching it, each of which is
 * also dissipating. So every wire in a dense bundle can pass individually
 * while the bundle still cooks — the failure the flat table cannot see.
 *
 * PROVENANCE — READ THIS BEFORE RELYING ON THESE NUMBERS.
 *
 * 0.7 for four to six conductors, 0.6 for seven to 24, and 0.5 above 25 are
 * the factors reproduced across widely-published secondary sources (wiring
 * guides and vendor application notes that paraphrase automotive bundle
 * derating). They are NOT quoted from a standard. ISO 6722, SAE J1128,
 * NEC 310.15, ABYC E-11 and MIL-STD-975 are all paywalled, none of them is
 * present in this repository, and nothing here has been checked against a
 * primary text. Confirm them against the purchased standard before this rule
 * is used in a process control plan.
 *
 * That is also why HK-WIRE-004 still carries no `standard` field. A citation
 * claims the rule implements a document a reviewer can go and read; the
 * evidence for that claim does not exist in this repository, and a fabricated
 * one would destroy exactly the auditability the field exists to create.
 * See the provenance note at the top of `rules.ts`.
 */
export const BUNDLE_DERATING_FACTORS: ReadonlyArray<readonly [number, number]> = [
  [4, 0.7],
  [7, 0.6],
  [25, 0.5]
]

/**
 * Fraction of table ampacity a conductor keeps in a bundle of `conductorCount`
 * current-carrying conductors.
 *
 * `conductorCount` is a count of CURRENT-CARRYING conductors, not of wires:
 * the tables these factors come from count the conductors that put heat into
 * the bundle, and a bundle's twenty signal wires do not raise its temperature
 * the way twenty loaded conductors do. `isCurrentCarrying` below is the test
 * that decides which wires the caller counts, and it is the only place that
 * definition lives.
 *
 * 1 below the first threshold, and 1 for any count that is not a finite
 * number: an unknown bundle size is not a reason to derate, and a fabricated
 * factor is worse than a missing one.
 */
export const bundleDeratingFactor = (conductorCount: number): number => {
  if (!Number.isFinite(conductorCount)) return 1
  let factor = 1
  for (const [threshold, derated] of BUNDLE_DERATING_FACTORS) {
    if (conductorCount >= threshold) factor = derated
  }
  return factor
}

/**
 * An ampacity table with every entry scaled by a bundle derating factor.
 *
 * Returns the input table itself at factor 1, so an underated wire is judged
 * against byte-identical numbers to the ones it saw before derating existed.
 */
export const deratedAmpacityTable = (
  table: Readonly<Record<number, number>>,
  factor: number
): Readonly<Record<number, number>> =>
  factor === 1
    ? table
    : Object.fromEntries(
        Object.entries(table).map(([awg, amps]) => [Number(awg), amps * factor])
      )

/** Smallest (thickest-allowed) AWG number that carries `current` amps, or undefined if off-table. */
export const requiredAwgForCurrent = (
  current: number,
  table: Readonly<Record<number, number>> = AMPACITY_BY_AWG
): number | undefined => {
  const candidates = Object.entries(table)
    .map(([awg, amps]) => [Number(awg), amps] as const)
    .filter(([, amps]) => amps >= current)
    .map(([awg]) => awg)
  return candidates.length > 0 ? Math.max(...candidates) : undefined
}

// Ground is token-aware (signal treated as _-separated tokens): prefixed
// and suffixed grounds (AGND, DGND, PGND, MOTOR_GND) are unambiguous.
// Power stays ANCHORED on purpose: token-matching "5V" anywhere would
// misclassify enable/sense lines (EN_5V, SENSE_24V) as rails and fire
// false ground-return errors.
const POWER_SIGNAL = /^(VBAT|VCC|VDD|VIN|VSYS|PWR|\+?\d+(\.\d+)?V)/i
const GROUND_SIGNAL = /(^|_)([ADPSC]?GND|GROUND|0V|RTN|RETURN|VSS)(_|$)/i
const SHIELD_SIGNAL = /(SHIELD|DRAIN|SHLD)/i

export const isPowerSignal = (signal: string): boolean => POWER_SIGNAL.test(signal)
export const isGroundSignal = (signal: string): boolean => GROUND_SIGNAL.test(signal)
export const isShieldSignal = (signal: string): boolean => SHIELD_SIGNAL.test(signal)

/** The wire fields `isCurrentCarrying` reads — structural, so it can be asked
 * about an HIR wire, a design wire, or a test fixture without a type import. */
export interface ConductorLoad {
  // `| undefined` spelled out on each: under `exactOptionalPropertyTypes` an
  // HIR wire's optional fields are `T | undefined`, and an interface whose
  // keys are merely optional would not accept one.
  readonly gauge?: string | undefined
  readonly signal?: string | undefined
  readonly currentEstimate?: number | undefined
}

/**
 * Share of its own gauge's table ampacity below which a declared load stops
 * counting as a current-carrying conductor.
 *
 * Heat is I²R, so a conductor drawing a tenth of what its gauge is rated for
 * dissipates about a hundredth of the per-conductor heat the ampacity table
 * assumes when it sets that rating. Ten percent is therefore a threshold on
 * the table already in this file — the point at which a conductor's own
 * contribution to bundle temperature is two orders of magnitude below the
 * budget the derating factors were written against — and not a figure lifted
 * from a standard. No standard is cited for it, exactly as none is cited for
 * BUNDLE_DERATING_FACTORS above, and for the same reason: the primary texts
 * are not in this repository, so an authority claim could not be checked.
 */
export const NEGLIGIBLE_LOAD_FRACTION = 0.1

/**
 * Whether a wire counts as a current-carrying conductor for bundle derating.
 *
 * Derating tables count the conductors that heat the bundle. Counting every
 * wire instead inflates the factor — a 36-wire trunk of which six carry load
 * gets judged as a 36-conductor bundle, and the 26AWG encoder pair that
 * dissipates almost nothing is what pushed a real conductor across a band
 * boundary. But the error in the other direction is the dangerous one: a wire
 * that declares no current is UNKNOWN, not zero, and quietly dropping it would
 * remove derating from exactly the sparsely-annotated dense bundles the rule
 * exists for. So the test is deliberately asymmetric — a wire is excluded only
 * on positive evidence, never on absence of evidence.
 *
 * The three things HIR actually models, in the order they are consulted:
 *
 *  1. `currentEstimate`, when it is declared and non-negative, is the author's
 *     own claim about the load and is believed. Zero means zero. Anything at
 *     or above `NEGLIGIBLE_LOAD_FRACTION` of the conductor's own table
 *     ampacity counts; below that it is thermally negligible (see the
 *     constant). A negative or non-finite figure is not a declaration and
 *     falls through to (3).
 *  2. `gauge`, but only ever as the denominator in (1). Gauge alone never
 *     decides: a 26AWG wire is not a signal wire because it is thin, and
 *     assuming so would drop a genuinely loaded thin conductor.
 *  3. Signal role, for undeclared wires, and only for shields. A shield or
 *     drain conductor carries no operating current by construction — that is
 *     what makes it a shield — so it is excluded even undeclared. Ground is
 *     deliberately NOT excluded: a return leg carries every amp the feed does,
 *     and a rule that dropped grounds would halve the count of a DC harness.
 *     Every other undeclared wire counts.
 */
export const isCurrentCarrying = (
  wire: ConductorLoad,
  table: Readonly<Record<number, number>> = AMPACITY_BY_AWG
): boolean => {
  const declared = wire.currentEstimate
  if (declared !== undefined && Number.isFinite(declared) && declared >= 0) {
    if (declared === 0) return false
    const awg = wire.gauge !== undefined ? parseAwg(wire.gauge) : undefined
    const ampacity = awg !== undefined ? table[awg] : undefined
    // No table entry for this gauge means no basis for calling the load
    // negligible, and a declared load is evidence of current either way.
    if (ampacity === undefined) return true
    return declared >= ampacity * NEGLIGIBLE_LOAD_FRACTION
  }
  return !(wire.signal !== undefined && isShieldSignal(wire.signal))
}

/**
 * Known differential / twisted-pair signal pairs (PRD §9.4: CAN, RS-485,
 * USB, Ethernet). Each entry maps a signal to its expected partner.
 */
export const differentialPartner = (signal: string): string | undefined => {
  const s = signal.toUpperCase()
  const table: ReadonlyArray<readonly [RegExp, (s: string) => string]> = [
    // Bus index allowed: CAN_H, CANH, CAN1_H, MOTOR_CAN2_H all pair.
    [/^(.*)CAN\d*_?H$/, (m) => m.slice(0, -1) + "L"],
    [/^(.*)CAN\d*_?L$/, (m) => m.slice(0, -1) + "H"],
    [/^(.*)RS485_?A$/, (m) => m.slice(0, -1) + "B"],
    [/^(.*)RS485_?B$/, (m) => m.slice(0, -1) + "A"],
    [/^(.*)_P$/, (m) => m.slice(0, -2) + "_N"],
    [/^(.*)_N$/, (m) => m.slice(0, -2) + "_P"],
    [/^(.*)USB_?DP$/, (m) => m.replace(/DP$/, "DM")],
    [/^(.*)USB_?DM$/, (m) => m.replace(/DM$/, "DP")]
  ]
  for (const [pattern, partner] of table) {
    if (pattern.test(s)) return partner(s)
  }
  return undefined
}

/** Typical insulated OD (mm) per AWG — PVC hookup wire, conservative. */
export const INSULATED_OD_MM_BY_AWG = {
  30: 1.0,
  28: 1.1,
  26: 1.3,
  24: 1.6,
  22: 1.8,
  20: 2.1,
  18: 2.4,
  16: 2.8,
  14: 3.3,
  12: 3.9,
  10: 4.8
} satisfies Readonly<Record<number, number>>

/**
 * Estimated bundle diameter (mm) for a set of wire ODs: area-equivalent
 * circle with a packing factor (default 1.155, hex-pack practical fill).
 */
export const estimateBundleDiameterMm = (
  odsMm: ReadonlyArray<number>,
  packingFactor = 1.155
): number => {
  const area = odsMm.reduce((sum, d) => sum + d * d, 0)
  return Math.sqrt(area) * packingFactor
}

/** Sleeve capacity in mm from seed naming ("braided-pet-12" -> 12). */
export const sleeveCapacityMm = (sleeve: string): number | undefined => {
  const m = /-(\d+(?:\.\d+)?)$/.exec(sleeve)
  return m !== undefined && m !== null ? Number(m[1]) : undefined
}

/** Nominal volts implied by a signal name token ("VBAT_24V" -> 24, "3.3V" -> 3.3). */
export const signalNominalVolts = (signal: string): number | undefined => {
  const m = /(?:^|_|\+)(\d+(?:\.\d+)?)\s*V(?:_|$)/i.exec(signal)
  return m !== undefined && m !== null ? Number(m[1]) : undefined
}

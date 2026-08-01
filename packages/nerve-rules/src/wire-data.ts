/**
 * Wire reference data shared by electrical rules.
 *
 * Ampacities are conservative bundled-harness values (chassis-wiring tables
 * derated for bundling). Rule packs can override with stricter
 * standards-informed data later (PRD §38).
 */

// Gauge parsing lives in core: compileDesign canonicalizes gauges into HIR
// with the same parser, so rules and compiler can never disagree.
export { parseAwg } from "@grayhaven/nerve"

/** Max continuous current (A) per AWG, bundled/derated. */
export const AMPACITY_BY_AWG: Readonly<Record<number, number>> = {
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
}

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
export const INSULATED_OD_MM_BY_AWG: Readonly<Record<number, number>> = {
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
}

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

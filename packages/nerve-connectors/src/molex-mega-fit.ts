/**
 * Molex Mega-Fit power connector family (5.70mm pitch, 23A/circuit).
 * Provenance: Molex catalog data, inspired-by tier — terminal series
 * 76650 (female) per catalog; verify crimp specs before production.
 *
 * OPEN, and load-bearing: the 23AWG-12AWG range below is not confirmed for
 * the 76650 terminals. Molex's own Mega-Fit product specifications put female
 * crimp terminals at 12-16 AWG, and the Mega-Fit hand-crimp-tool application
 * spec scopes to the 76823 and 172063 series without mentioning 76650 at all.
 * If 16 AWG is really the thin end, then anything finer than that cannot be
 * crimped into these housings, and this entry's 23 AWG floor is letting such
 * designs pass. Nothing here is changed on that basis because the exact part
 * numbers could not be confirmed against a Molex document — but this range
 * should be checked against the terminals actually being bought before it is
 * trusted, and `examples/robot-platform` runs 20 AWG through 76650-0117.
 */
import type { ConnectorPart } from "@grayhaven/nerve"

const provenance = {
  source: "Molex catalog",
  datasheet: "https://www.molex.com/en-us/products/part-detail/768290008",
  verification: "inspired-by",
  lastVerified: "2026-06-07"
} as const

export const MolexMegaFit = {
  /** Mega-Fit dual-row receptacle, 8 circuits. */
  "76829-0008": {
    mpn: "76829-0008",
    manufacturer: "Molex",
    family: "Mega-Fit",
    description: "Mega-Fit dual-row receptacle, 8 circuits",
    gender: "receptacle",
    pinCount: 8,
    cavityLayout: { rows: 2, columns: 4 },
    matingMpn: "76825-0008",
    compatibleTerminals: ["76650-0117", "76650-0118"],
    wireGaugeRange: { min: "23AWG", max: "12AWG" },
    currentLimitA: 23,
    voltageLimitV: 600,
    provenance
  },
  /** Mega-Fit dual-row plug, 8 circuits. */
  "76825-0008": {
    mpn: "76825-0008",
    manufacturer: "Molex",
    family: "Mega-Fit",
    description: "Mega-Fit dual-row plug, 8 circuits",
    gender: "plug",
    pinCount: 8,
    cavityLayout: { rows: 2, columns: 4 },
    matingMpn: "76829-0008",
    compatibleTerminals: ["76650-0117", "76650-0118"],
    wireGaugeRange: { min: "23AWG", max: "12AWG" },
    currentLimitA: 23,
    voltageLimitV: 600,
    provenance
  }
} satisfies Record<string, ConnectorPart>

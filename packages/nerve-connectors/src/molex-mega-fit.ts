/**
 * Molex Mega-Fit power connector family (5.70mm pitch, 23A/circuit).
 * Provenance: Molex catalog data, inspired-by tier — female crimp terminals
 * 76823-0321 (14/16AWG) and 76823-0322 (12AWG); verify crimp specs before
 * production.
 *
 * This entry previously named 76650-0117 / 76650-0118 as its terminals and
 * declared a 23AWG-12AWG range. Neither was right. Molex's datasheet for the
 * sibling 76650-0125 shows that block to be *kit* part numbers in the
 * PicoBlade family — 1.25mm pitch, 32-28AWG — and the Mega-Fit tooling
 * document names only the 76823 and 172063 series. The system is specified
 * for 16-12AWG.
 *
 * The bogus 23AWG floor was load-bearing: it let a 20AWG drive feed pass into
 * a connector that cannot crimp anything thinner than 16AWG, while the far
 * end of the same wire sat in a Micro-Fit that tops out at 20AWG. Two ranges
 * with no overlap, and no gauge that satisfies both.
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
    compatibleTerminals: ["76823-0321", "76823-0322"],
    wireGaugeRange: { min: "16AWG", max: "12AWG" },
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
    compatibleTerminals: ["76823-0321", "76823-0322"],
    wireGaugeRange: { min: "16AWG", max: "12AWG" },
    currentLimitA: 23,
    voltageLimitV: 600,
    provenance
  }
} satisfies Record<string, ConnectorPart>

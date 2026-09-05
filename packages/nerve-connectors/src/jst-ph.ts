/**
 * JST PH family (2.00mm pitch, 2A). Crimp contacts: SPH-004T-P0.5S
 * (#32-#28) and SPH-002T-P0.5S (#30-#24), per the contact table in JST's
 * ePH.pdf. These two were previously documented the other way round; the
 * housing range below is their union and was unaffected. The per-contact
 * ranges now live on the terminal records in `terminals.ts`, which is what
 * the gauge rules read when a design fits a specific contact.
 * Provenance: JST catalog data, inspired-by tier.
 */
import type { ConnectorPart } from "@grayhaven/nerve"
import { jstKiCadAssets } from "./kicad-assets.js"

const provenance = {
  source: "JST catalog",
  datasheet: "https://www.jst-mfg.com/product/detail_e.php?series=199",
  verification: "inspired-by",
  lastVerified: "2026-06-07"
} as const

const housing = (circuits: number): ConnectorPart => ({
  mpn: `PHR-${circuits}`,
  manufacturer: "JST",
  family: "PH",
  description: `JST PH housing, ${circuits} circuits`,
  gender: "receptacle",
  pinCount: circuits,
  cavityLayout: { rows: 1, columns: circuits },
  matingMpn: `B${circuits}B-PH-K-S`,
  compatibleTerminals: ["SPH-002T-P0.5S", "SPH-004T-P0.5S"],
  wireGaugeRange: { min: "32AWG", max: "24AWG" },
  currentLimitA: 2,
  voltageLimitV: 100,
  kicadAssets: jstKiCadAssets("PH", circuits, `B${circuits}B-PH-K-S`),
  provenance
})

export const JstPH = {
  "PHR-2": housing(2),
  "PHR-3": housing(3),
  "PHR-4": housing(4),
  "PHR-6": housing(6)
} satisfies Record<string, ConnectorPart>

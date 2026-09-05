/**
 * JST XH family (2.50mm pitch, 3A). Crimp contact: SXH-001T-P0.6
 * (#28-#22), per the contact table in JST's eXH.pdf. Previously recorded as
 * 30-22; #30 belongs to SXH-002T-P0.6 (#30-#26), which these housings do not
 * list as compatible. Provenance: JST catalog data, inspired-by tier.
 */
import type { ConnectorPart } from "@grayhaven/nerve"
import { jstKiCadAssets } from "./kicad-assets.js"

const provenance = {
  source: "JST catalog",
  datasheet: "https://www.jst-mfg.com/product/detail_e.php?series=277",
  verification: "inspired-by",
  lastVerified: "2026-06-07"
} as const

const housing = (circuits: number): ConnectorPart => ({
  mpn: `XHP-${circuits}`,
  manufacturer: "JST",
  family: "XH",
  description: `JST XH housing, ${circuits} circuits`,
  gender: "receptacle",
  pinCount: circuits,
  cavityLayout: { rows: 1, columns: circuits },
  matingMpn: `B${circuits}B-XH-A`,
  compatibleTerminals: ["SXH-001T-P0.6"],
  wireGaugeRange: { min: "28AWG", max: "22AWG" },
  currentLimitA: 3,
  voltageLimitV: 250,
  kicadAssets: jstKiCadAssets("XH", circuits, `B${circuits}B-XH-A`),
  provenance
})

export const JstXH = {
  "XHP-2": housing(2),
  "XHP-3": housing(3),
  "XHP-4": housing(4)
} satisfies Record<string, ConnectorPart>

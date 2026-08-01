/**
 * TE Deutsch DT family (size-16 contacts, 13A, IP68 with integral
 * silicone seals — no per-cavity seal parts, so `sealed` stays unset
 * for the missingSeal rule). Contacts: 0462-201-16141 socket /
 * 0460-202-16141 pin, 16-20 AWG. Wedgelocks required per housing
 * (W2S/W3S/W4S sockets, W2P/W3P/W4P pins).
 * Provenance: TE catalog data, inspired-by tier.
 *
 * The range was previously recorded as 14-20 AWG. Both size-16 contacts take
 * 16-20; 14 AWG needs a larger contact (0462-209-16141 is the 14 AWG socket,
 * a different part number). Corrected against agreeing listings from Newark,
 * Del City, WireCare, BuyDeutsch and others, since te.com returns 403 to
 * automated fetches. The 13A current limit is unchanged and consistent
 * across the same sources.
 */
import type { ConnectorPart } from "@grayhaven/nerve"

const provenance = {
  source: "TE Connectivity DT catalog",
  datasheet: "https://www.te.com/en/products/brands/deutsch/dt.html",
  verification: "inspired-by",
  lastVerified: "2026-06-07"
} as const

const plug = (circuits: number): ConnectorPart => ({
  mpn: `DT06-${circuits}S`,
  manufacturer: "TE Connectivity / Deutsch",
  family: "DT",
  description: `Deutsch DT plug, ${circuits} sockets, integrally sealed`,
  gender: "plug",
  pinCount: circuits,
  cavityLayout: { rows: 1, columns: circuits },
  matingMpn: `DT04-${circuits}P`,
  compatibleTerminals: ["0462-201-16141"],
  wireGaugeRange: { min: "20AWG", max: "16AWG" },
  currentLimitA: 13,
  voltageLimitV: 250,
  provenance
})

const receptacle = (circuits: number): ConnectorPart => ({
  mpn: `DT04-${circuits}P`,
  manufacturer: "TE Connectivity / Deutsch",
  family: "DT",
  description: `Deutsch DT receptacle, ${circuits} pins, integrally sealed`,
  gender: "receptacle",
  pinCount: circuits,
  cavityLayout: { rows: 1, columns: circuits },
  matingMpn: `DT06-${circuits}S`,
  compatibleTerminals: ["0460-202-16141"],
  wireGaugeRange: { min: "20AWG", max: "16AWG" },
  currentLimitA: 13,
  voltageLimitV: 250,
  provenance
})

export const DeutschDT = {
  "DT06-2S": plug(2),
  "DT06-3S": plug(3),
  "DT06-4S": plug(4),
  "DT04-2P": receptacle(2),
  "DT04-3P": receptacle(3),
  "DT04-4P": receptacle(4)
} satisfies Record<string, ConnectorPart>

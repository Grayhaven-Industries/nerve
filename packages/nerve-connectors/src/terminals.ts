/**
 * Crimp terminals referenced by the housings in this library.
 *
 * Housings carry `compatibleTerminals` as bare MPN strings, so until now the
 * contact that actually holds the wire had no record of its own. That gap is
 * not cosmetic: a gauge check on a pin falls back to the housing's family
 * range (Micro-Fit 3.0 spans 20-30 AWG) when the real limit is the contact's
 * own range (43030-0007 is 20-24 AWG and nothing else), and no crimp process
 * data — die, strip length, crimp height — can be emitted at all.
 *
 * Every field below was read off a manufacturer document; the URL that was
 * read is in `provenance.datasheet`. Fields that could not be sourced are
 * ABSENT rather than estimated, and the per-part comments say why. Three
 * categories are absent throughout on purpose:
 *
 * - `pullForceN`. Manufacturers publish a minimum per gauge, not per part
 *   (Micro-Fit alone is quoted at both 57.8 N and 58.8 N for 20 AWG in two
 *   different Molex documents). One scalar on a part that crimps three
 *   gauges would be wrong for at least two of them.
 * - `crimpHeight`. Same problem, worse consequence — it is the acceptance
 *   criterion, so a window carried across gauges silently passes bad crimps
 *   or rejects good ones. Where a manufacturer publishes it, it is indexed
 *   by gauge AND by tooling.
 * - `currentRatingA`. The ratings reachable for these contacts are stated
 *   for the mated connector at one reference gauge, not for the contact.
 *
 * `TerminalPart` is not re-exported from the package entry yet
 * (packages/nerve/src/index.ts is owned elsewhere), so reach the module
 * directly rather than restating the contract here.
 */
import type { TerminalPart } from "../../nerve/src/domain.js"

/**
 * molex.com was unreachable from the machine that assembled this file, so the
 * Molex catalog page and Micro-Fit product specification behind these entries
 * were read from a distributor-hosted copy. That is why these four stay at
 * `unverified` while the JST and DEUTSCH entries do not.
 */
const microFitProvenance = {
  source:
    "Molex 43030/43031 catalog page and Micro-Fit product specification, read via a distributor-hosted copy",
  datasheet: "https://datasheet.octopart.com/43030-0006-Molex-datasheet-17720638.pdf",
  verification: "unverified"
} as const

const jstPhProvenance = {
  source: "JST PH connector catalog, contact table",
  datasheet: "https://www.jst-mfg.com/product/pdf/eng/ePH.pdf",
  verification: "inspired-by",
  lastVerified: "2026-08-01"
} as const

const jstXhProvenance = {
  source: "JST XH connector catalog, contact table",
  datasheet: "https://www.jst-mfg.com/product/pdf/eng/eXH.pdf",
  verification: "inspired-by",
  lastVerified: "2026-08-01"
} as const

const deutschProvenance = {
  source:
    "TE Connectivity DEUTSCH solid contact application specification, plus the size-16 pin and socket customer drawings",
  datasheet:
    "https://www.te.com/commerce/DocumentDelivery/DDEController?Action=showdoc&DocId=Specification+Or+Standard%7F114-151004%7FB2%7Fpdf%7FEnglish%7FENG_SS_114-151004_B2.pdf%7FN-A",
  verification: "inspired-by",
  lastVerified: "2026-08-01"
} as const

/**
 * Micro-Fit 3.0 crimp terminals (43030 female, 43031 male).
 *
 * The catalog splits each series by gauge band and plating: 20-24 AWG tin is
 * the -0007 part, 26-30 AWG tin is the -0010 part. Contact metal is phosphor
 * bronze in both.
 *
 * Insulation diameter is published as a maximum only (1.85 mm for 20-24 AWG,
 * 1.27 mm for 26-30 AWG) with no floor, so `insulationDiameterRange` — which
 * needs both ends — is absent rather than half-invented.
 */
export const MolexMicroFitTerminals = {
  "43030-0007": {
    mpn: "43030-0007",
    manufacturer: "Molex",
    family: "Micro-Fit 3.0",
    description: "Micro-Fit 3.0 female crimp terminal, tin-plated phosphor bronze",
    wireGaugeRange: { min: "24AWG", max: "20AWG" },
    plating: "Tin",
    // The only one of the four whose hand tool is confirmed: the Molex part
    // page for the reel-packaged sibling of this exact terminal lists hand
    // crimp tool 0638190000. The 26-30 AWG parts are tooled differently and
    // the 43031 pages were not reachable, so they carry no `crimpTool`.
    crimpTool: "63819-0000",
    provenance: microFitProvenance
  },
  "43030-0010": {
    mpn: "43030-0010",
    manufacturer: "Molex",
    family: "Micro-Fit 3.0",
    description: "Micro-Fit 3.0 female crimp terminal, fine wire, tin-plated phosphor bronze",
    wireGaugeRange: { min: "30AWG", max: "26AWG" },
    plating: "Tin",
    provenance: microFitProvenance
  },
  "43031-0007": {
    mpn: "43031-0007",
    manufacturer: "Molex",
    family: "Micro-Fit 3.0",
    description: "Micro-Fit 3.0 male crimp terminal, tin-plated phosphor bronze",
    wireGaugeRange: { min: "24AWG", max: "20AWG" },
    plating: "Tin",
    provenance: microFitProvenance
  },
  "43031-0010": {
    mpn: "43031-0010",
    manufacturer: "Molex",
    family: "Micro-Fit 3.0",
    description: "Micro-Fit 3.0 male crimp terminal, fine wire, tin-plated phosphor bronze",
    wireGaugeRange: { min: "30AWG", max: "26AWG" },
    plating: "Tin",
    provenance: microFitProvenance
  }
} as const satisfies Readonly<Record<string, TerminalPart>>

/**
 * JST PH crimp contacts.
 *
 * The catalog's own contact table puts SPH-004T-P0.5S on the FINE wires
 * (#32 to #28) and SPH-002T-P0.5S on the coarse ones (#30 to #24) — the
 * opposite of how the two are described in this package's PH housing file.
 * The catalog is what is recorded here.
 *
 * `crimpTool` is the crimping machine the catalog names for these contacts
 * and `dieId` the matching applicator-with-dies; JST publishes no crimp
 * height, strip length or pull force in this document, so none appear.
 */
export const JstPHTerminals = {
  "SPH-002T-P0.5S": {
    mpn: "SPH-002T-P0.5S",
    manufacturer: "JST",
    family: "PH",
    description: "PH crimp contact, tin-plated copper alloy",
    wireGaugeRange: { min: "30AWG", max: "24AWG" },
    insulationDiameterRange: { min: 0.8, max: 1.5 },
    plating: "Tin",
    crimpTool: "AP-K2N",
    dieId: "APLMK SPH002-05S",
    provenance: jstPhProvenance
  },
  "SPH-004T-P0.5S": {
    mpn: "SPH-004T-P0.5S",
    manufacturer: "JST",
    family: "PH",
    description: "PH crimp contact, fine wire, tin-plated copper alloy",
    wireGaugeRange: { min: "32AWG", max: "28AWG" },
    insulationDiameterRange: { min: 0.5, max: 0.9 },
    plating: "Tin",
    crimpTool: "AP-K2N",
    dieId: "APLMK SPH004-05S",
    provenance: jstPhProvenance
  }
} as const satisfies Readonly<Record<string, TerminalPart>>

/**
 * JST XH crimp contact.
 *
 * The catalog range for SXH-001T-P0.6 is #28 to #22 — narrower at the thin
 * end than the 30-22 AWG this package's XH housings advertise, which is
 * exactly the kind of gap a contact record exists to close.
 */
export const JstXHTerminals = {
  "SXH-001T-P0.6": {
    mpn: "SXH-001T-P0.6",
    manufacturer: "JST",
    family: "XH",
    description: "XH crimp contact, tin-plated phosphor bronze",
    wireGaugeRange: { min: "28AWG", max: "22AWG" },
    insulationDiameterRange: { min: 0.9, max: 1.9 },
    plating: "Tin",
    crimpTool: "AP-K2N",
    dieId: "APLMK SXH001-06",
    provenance: jstXhProvenance
  }
} as const satisfies Readonly<Record<string, TerminalPart>>

/**
 * DEUTSCH DT size-16 solid contacts.
 *
 * The 141 suffix is the plating code, and the customer drawing for each of
 * these two part numbers names it outright: nickel. The application
 * specification's wire-range column puts both at 16, 18 and 20 AWG — the DT
 * housings in this package advertise 14 AWG as well, which these contacts do
 * not take (that is a different size-16 contact).
 *
 * Absent and worth naming, because all three ARE published — just not as one
 * number per part:
 * - `stripLength`: given as a 6.35-7.92 mm window for the size, not a value.
 * - `crimpHeight`: indexed by gauge and by tool, and the two tools disagree.
 * - `pullForceN`: 156 / 111 / 67 N for 16 / 18 / 20 AWG on the same part.
 * - `dieId`: the die changes with gauge (a 20 AWG crimp uses a different one).
 */
export const DeutschDTTerminals = {
  "0460-202-16141": {
    mpn: "0460-202-16141",
    manufacturer: "TE Connectivity / Deutsch",
    family: "DT",
    description: "DEUTSCH size 16 solid pin contact, nickel plated",
    wireGaugeRange: { min: "20AWG", max: "16AWG" },
    plating: "Nickel",
    crimpTool: "HDT-48-00",
    provenance: deutschProvenance
  },
  "0462-201-16141": {
    mpn: "0462-201-16141",
    manufacturer: "TE Connectivity / Deutsch",
    family: "DT",
    description: "DEUTSCH size 16 solid socket contact, nickel plated",
    wireGaugeRange: { min: "20AWG", max: "16AWG" },
    plating: "Nickel",
    crimpTool: "HDT-48-00",
    provenance: deutschProvenance
  }
} as const satisfies Readonly<Record<string, TerminalPart>>

/** Every terminal in the bundled library, keyed by MPN. */
export const allTerminals: Readonly<Record<string, TerminalPart>> = {
  ...MolexMicroFitTerminals,
  ...JstPHTerminals,
  ...JstXHTerminals,
  ...DeutschDTTerminals
}

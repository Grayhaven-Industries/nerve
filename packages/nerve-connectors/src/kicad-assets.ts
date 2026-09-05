import type { KiCadAsset } from "@grayhaven/nerve"

// Checked against the official GitLab libraries on 2026-09-05. The model
// paths are the STEP references in these exact footprint revisions.
const revisions = {
  "kicad-symbols": "b705e03a5b374ec0700469011805bf1fd5102df2",
  "kicad-footprints": "26542f0da7dad64165930e6d1e74c32037b6b1ce",
  "kicad-packages3D": "e62ed1fc7862da83f789bd562671b5e4b82afcdf"
} as const

const license = {
  spdxId: "CC-BY-SA-4.0",
  exception: "KiCad libraries exception",
  url: "https://www.kicad.org/libraries/license/",
  attribution: "KiCad library contributors"
} as const

const sourceUrl = (repository: keyof typeof revisions, path: string): string =>
  `https://gitlab.com/kicad/libraries/${repository}/-/blob/${revisions[repository]}/${path}`

/** References for the existing PH/XH housings and their straight PCB mates. */
export const jstKiCadAssets = (
  family: "PH" | "XH",
  circuits: number,
  matingMpn: string
): ReadonlyArray<KiCadAsset> => {
  const count = String(circuits).padStart(2, "0")
  const symbol = `Conn_01x${count}`
  const header = family === "PH" ? `B${circuits}B-PH-K` : `B${circuits}B-XH-A`
  const pitch = family === "PH" ? "2.00" : "2.50"
  const footprint = `JST_${family}_${header}_1x${count}_P${pitch}mm_Vertical`
  const model = `Connector_JST.3dshapes/${footprint}.step`
  return [
    {
      kind: "symbol",
      identifier: `Connector_Generic:${symbol}`,
      relationship: "generic",
      sourceUrl: sourceUrl("kicad-symbols", `Connector_Generic.kicad_symdir/${symbol}.kicad_sym`),
      libraryRevision: revisions["kicad-symbols"],
      lastVerified: "2026-09-05",
      license,
      notes: "Generic passive connector symbol; does not specify the housing pinout."
    },
    {
      kind: "footprint",
      identifier: `Connector_JST:${footprint}`,
      relationship: "mate",
      mpn: matingMpn,
      sourceUrl: sourceUrl("kicad-footprints", `Connector_JST.pretty/${footprint}.kicad_mod`),
      libraryRevision: revisions["kicad-footprints"],
      lastVerified: "2026-09-05",
      license,
      notes: "Straight PCB header mate. Confirm the manufacturer drawing and cavity-to-pad mapping for your assembly."
    },
    {
      kind: "model3d",
      identifier: model,
      relationship: "mate",
      mpn: matingMpn,
      sourceUrl: sourceUrl("kicad-packages3D", model),
      libraryRevision: revisions["kicad-packages3D"],
      lastVerified: "2026-09-05",
      license,
      notes: "PCB header geometry referenced by the footprint; does not depict the wire-side housing."
    }
  ]
}

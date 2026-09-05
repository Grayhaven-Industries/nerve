import { describe, expect, it } from "vitest"
import { compileDesign, connector, decodeHir, encodeHir, harness } from "@grayhaven/nerve"
import { JstPH, JstXH, nerveConnectorsProvider, partInfo } from "../src/index.js"

describe("KiCad catalog references", () => {
  it("exposes all seven JST housings through both part lookup and the provider", () => {
    for (const part of [...Object.values(JstPH), ...Object.values(JstXH)]) {
      const assets = nerveConnectorsProvider.get(part.mpn)?.kicadAssets
      expect(assets).toHaveLength(3)
      expect(partInfo(part.mpn)?.part.kicadAssets).toEqual(assets)
      expect(assets?.map((asset) => asset.kind).sort()).toEqual(["footprint", "model3d", "symbol"])
      for (const asset of assets!) {
        expect(asset.sourceUrl).toContain(`/blob/${asset.libraryRevision}/`)
        expect(asset.libraryRevision).toMatch(/^[a-f0-9]{40}$/)
        expect(asset.license.spdxId).toBe("CC-BY-SA-4.0")
        expect(asset.license.exception).toBe("KiCad libraries exception")
        if (asset.kind === "symbol") {
          expect(asset.relationship).toBe("generic")
          expect(asset.mpn).toBeUndefined()
        } else {
          expect(asset.relationship).toBe("mate")
          expect(asset.mpn).toBe(part.matingMpn)
        }
      }
      // Geometry enrichment must not promote the original electrical evidence.
      expect(part.provenance?.verification).toBe("inspired-by")
      expect(part.pinout).toBeUndefined()
    }
  })

  it("preserves the actual selected part's links through compile and HIR serialization", () => {
    const part = nerveConnectorsProvider.get("PHR-2")!
    const { hir, diagnostics } = compileDesign(harness("kicad-parts", {
      revision: "A", units: "mm",
      connectors: [connector("J1", part, { pins: { 1: "V+", 2: "GND" } })],
      wires: []
    }))
    expect(diagnostics).toEqual([])
    const decoded = decodeHir(JSON.parse(JSON.stringify(encodeHir(hir))))
    expect(decoded).toEqual(hir)
    expect(decoded.connectors[0]?.kicadAssets).toEqual(expect.arrayContaining(part.kicadAssets!))
    expect(decoded.connectors[0]?.kicadAssets?.find((a) => a.kind === "footprint")?.identifier)
      .toBe("Connector_JST:JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical")
  })
})

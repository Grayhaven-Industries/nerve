import { describe, expect, it } from "vitest"
import { compileDesign, connector, decodeHir, harness, type ConnectorPart, type KiCadAsset } from "../src/index.js"

const asset: KiCadAsset = {
  kind: "footprint", identifier: "Connector:BoardHeader", relationship: "mate", mpn: "HEADER",
  sourceUrl: "https://example.com/footprint", libraryRevision: "revision-a", lastVerified: "2026-09-05",
  license: { spdxId: "CC-BY-SA-4.0", exception: "KiCad libraries exception", url: "https://www.kicad.org/libraries/license/", attribution: "KiCad library contributors" },
  notes: "Board header only"
}
const bare: ConnectorPart = { mpn: "HOUSING", pinCount: 2 }
const compilePart = (part: ConnectorPart) => compileDesign(harness("assets", {
  revision: "A", units: "mm", connectors: [connector("J1", part, { pins: { 1: "V+", 2: "GND" } })], wires: []
})).hir

describe("KiCad asset HIR contract", () => {
  it("retains absent and empty metadata as absence, preserving existing output", () => {
    const original = compilePart(bare)
    expect(compilePart({ ...bare, kicadAssets: [] })).toStrictEqual(original)
    expect("kicadAssets" in decodeHir(original).connectors[0]!).toBe(false)
  })

  it("canonicalizes metadata keys and list order without retaining aliases", () => {
    const symbol: KiCadAsset = { ...asset, kind: "symbol", relationship: "generic", identifier: "Connector_Generic:Conn_01x02" }
    const reordered: KiCadAsset = {
      notes: asset.notes!, license: { attribution: asset.license.attribution, url: asset.license.url, exception: asset.license.exception!, spdxId: asset.license.spdxId },
      lastVerified: asset.lastVerified!, libraryRevision: asset.libraryRevision!, sourceUrl: asset.sourceUrl,
      mpn: asset.mpn!, relationship: asset.relationship, identifier: asset.identifier, kind: asset.kind
    }
    const first = compilePart({ ...bare, kicadAssets: [asset, symbol] })
    expect(JSON.stringify(compilePart({ ...bare, kicadAssets: [symbol, reordered] }))).toBe(JSON.stringify(first))
    expect(first.connectors[0]?.kicadAssets?.find((a) => a.kind === "footprint")).not.toBe(asset)
    expect(first.connectors[0]?.kicadAssets?.[0]?.license).not.toBe(asset.license)
    expect(decodeHir(JSON.parse(JSON.stringify(first)))).toEqual(first)
  })

  it("rejects unsupported asset kinds and missing license metadata at the HIR boundary", () => {
    const hir = compilePart({ ...bare, kicadAssets: [asset] })
    const invalidKind = { ...hir, connectors: [{ ...hir.connectors[0], kicadAssets: [{ ...asset, kind: "image" }] }] }
    expect(() => decodeHir(invalidKind)).toThrow()
    const { license: _license, ...unlicensed } = asset
    expect(() => decodeHir({ ...hir, connectors: [{ ...hir.connectors[0], kicadAssets: [unlicensed] }] })).toThrow()
  })
})

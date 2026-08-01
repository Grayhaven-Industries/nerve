/**
 * Wire material and cut-length arithmetic (PRD §9.2, §20.2, §30).
 *
 * Wire was modelled as free text while connectors were modelled as parts,
 * so nothing in the system could be ordered by the metre and the cut list
 * printed the finished length twice. These tests pin the two halves of the
 * fix: `part` is what puts a wire on the BOM (opt-in, so harnesses that
 * declare no wire material keep their byte-identical output), and the cut
 * length is finished length plus the allowances that actually consume
 * copper — service loop and terminations, never the strip.
 *
 * Runs on vitest 4.1.10 (root devDependency; the runner for every
 * workspace package) — plain `describe`/`it`/`expect`, unchanged from v3.
 */
import { describe, expect, it } from "vitest"
import { compileDesign, connector, decodeHir, harness, wire } from "@grayhaven/nerve"
import type { WireDef, WirePart } from "../src/domain.js"
// Relative: the cut-list arithmetic lives with the exporter that prints it,
// and @grayhaven/nerve-exporters is not a dependency of core.
import { wireCutLength } from "../../nerve-exporters/src/csv.js"

const housing = { mpn: "H-4", pinCount: 4 }
const pinMap = { 1: "SIG", 2: "GND", 3: "PWR", 4: "RTN" }
const j1 = connector("J1", housing, { pins: pinMap })
const j2 = connector("J2", housing, { pins: pinMap })

/** M22759/16 with every optional field populated — the round-trip fixture. */
const etfe18: WirePart = {
  mpn: "M22759/16-18-9",
  manufacturer: "Carlisle IT",
  family: "M22759/16",
  description: "18AWG tinned copper, ETFE insulated",
  gauge: "18AWG",
  strands: 19,
  conductorMaterial: "tinned-copper",
  insulation: "ETFE",
  outerDiameter: 2.06,
  voltageRating: 600,
  temperatureRating: 150,
  ohmsPerKm: 21.8,
  gramsPerMeter: 12.4,
  availableColors: ["white", "black", "red"],
  provenance: {
    source: "test fixture",
    datasheet: "https://example.invalid/m22759-16",
    verification: "inspired-by",
    lastVerified: "2026-01-01"
  }
}

const txl20: WirePart = {
  mpn: "TXL-20-BLK",
  manufacturer: "Generic",
  gauge: "20AWG"
}

const design = (wires: ReadonlyArray<WireDef>) =>
  harness("wire-parts", {
    revision: "A",
    units: "mm",
    connectors: [j1, j2],
    wires
  })

const wireBom = (wires: ReadonlyArray<WireDef>) => {
  const { hir, diagnostics } = compileDesign(design(wires))
  expect(diagnostics).toEqual([])
  return hir.bom.filter((item) => item.category === "wire")
}

describe("wire parts on the BOM (opt-in)", () => {
  it("keeps a partless wire off the BOM and cuts it at its finished length", () => {
    const w = wire("W1", j1.pin(1), j2.pin(1), { gauge: "18AWG", length: 1000 })
    const { hir, diagnostics } = compileDesign(design([w]))

    expect(diagnostics).toEqual([])
    expect(hir.bom.filter((item) => item.category === "wire")).toEqual([])
    const compiled = hir.wires[0]!
    expect(compiled.part).toBeUndefined()
    expect(wireCutLength(compiled)).toBe(1000)
    expect(wireCutLength(compiled)).toBe(compiled.length)
  })

  it("rolls a wire that declares a part into exactly one BOM line", () => {
    const items = wireBom([
      wire("W1", j1.pin(1), j2.pin(1), {
        part: etfe18,
        gauge: "18AWG",
        length: 1200,
        serviceLoop: 50,
        terminationAllowance: { from: 10, to: 10 }
      })
    ])

    expect(items).toEqual([
      {
        mpn: "M22759/16-18-9",
        manufacturer: "Carlisle IT",
        description: "18AWG tinned copper, ETFE insulated",
        category: "wire",
        quantity: 1270,
        unitOfMeasure: "mm",
        usedBy: ["wire:W1"]
      }
    ])
  })

  it("sums cut lengths of wires sharing one MPN into a single line", () => {
    const items = wireBom([
      // Authored out of order: usedBy must still come back sorted.
      wire("W2", j1.pin(2), j2.pin(2), { part: etfe18, length: 800 }),
      wire("W1", j1.pin(1), j2.pin(1), { part: etfe18, length: 1200 }),
      wire("W3", j1.pin(3), j2.pin(3), { part: txl20, length: 500 })
    ])

    expect(items.map((i) => [i.mpn, i.quantity, i.usedBy])).toEqual([
      ["M22759/16-18-9", 2000, ["wire:W1", "wire:W2"]],
      ["TXL-20-BLK", 500, ["wire:W3"]]
    ])
  })
})

describe("cut length arithmetic", () => {
  const w = wire("W1", j1.pin(1), j2.pin(1), {
    part: etfe18,
    length: 1000,
    serviceLoop: 25,
    terminationAllowance: { from: 8, to: 12 },
    stripLength: { from: 6, to: 6 }
  })

  it("adds the service loop and both termination allowances, never the strip", () => {
    const { hir } = compileDesign(design([w]))
    const compiled = hir.wires[0]!

    // 1000 + 25 + 8 + 12; the 6mm strips would make it 1057 if counted.
    expect(wireCutLength(compiled)).toBe(1045)
    expect(compiled.length).toBe(1000)
    expect(compiled.stripLength).toEqual({ from: 6, to: 6 })
  })

  it("bills the BOM by cut length, matching the exporter's arithmetic", () => {
    expect(wireBom([w]).map((i) => i.quantity)).toEqual([1045])
  })

  it("cuts at the finished length when no allowance is declared", () => {
    const plain = wire("W1", j1.pin(1), j2.pin(1), { part: etfe18, length: 750 })
    const { hir } = compileDesign(design([plain]))

    expect(wireCutLength(hir.wires[0]!)).toBe(750)
    expect(wireBom([plain]).map((i) => i.quantity)).toEqual([750])
  })
})

describe("HIR contract", () => {
  const wires = [
    wire("W1", j1.pin(1), j2.pin(1), {
      part: etfe18,
      gauge: "awg 18",
      color: "white",
      length: 1000,
      lengthTolerance: 10,
      serviceLoop: 25,
      stripLength: { from: 6, to: 7 },
      terminationAllowance: { from: 8, to: 12 }
    }),
    wire("W2", j1.pin(2), j2.pin(2), { part: txl20, length: 400 })
  ]

  it("round-trips every new field through the schema", () => {
    const { hir } = compileDesign(design(wires))
    const decoded = decodeHir(JSON.parse(JSON.stringify(hir)))

    expect(decoded).toEqual(hir)
    expect(decoded.wires[0]).toMatchObject({
      // The part's gauge is canonicalized the same way the wire's is.
      part: { ...etfe18, gauge: "18AWG" },
      gauge: "18AWG",
      serviceLoop: 25,
      stripLength: { from: 6, to: 7 },
      terminationAllowance: { from: 8, to: 12 }
    })
  })

  it("compiles the same design to byte-identical HIR twice", () => {
    const first = JSON.stringify(compileDesign(design(wires)).hir)
    const second = JSON.stringify(compileDesign(design([...wires].reverse())).hir)

    expect(second).toBe(first)
  })
})

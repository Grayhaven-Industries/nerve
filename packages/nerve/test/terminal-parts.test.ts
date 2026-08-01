/**
 * Terminal and seal master data through the compiler (PRD §9.2, §30).
 *
 * A terminal was an MPN string with nothing behind it: the contact that
 * actually crimps the wire reached the BOM as a bare part number with no
 * manufacturer and no description, so a harness BOM was not a purchasable
 * BOM. These tests pin the three halves of the fix — the record reaches HIR
 * beside the MPN, the BOM line it produces is orderable, and one MPN
 * described two different ways is reported rather than silently resolved —
 * and, just as importantly, that a design naming bare MPNs compiles to
 * exactly the bytes it always did.
 *
 * Runs on vitest 4.1.10 (root devDependency, confirmed in bun.lock; the
 * runner for every workspace package). `toStrictEqual` is used where a key
 * has to be *absent* rather than merely undefined — v4 documents it as the
 * matcher that checks undefined-valued keys, which `toEqual` ignores.
 * Compiled HIR decodes through effect 3.22.0 Schema (the version bun.lock
 * resolves from `effect@^3.16.0`), whose `Schema.optional` fields are exactly
 * the ones the compiler omits.
 */
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { compileDesign, connector, decodeHir, harness, wire } from "@grayhaven/nerve"
import type { ConnectorPart, SealPart, TerminalPart } from "../src/domain.js"
import type { PinPartAssignment } from "../src/dsl.js"
import robotPlatform from "../../../examples/robot-platform/src/main.harness.js"

const housing: ConnectorPart = {
  mpn: "43025-0400",
  manufacturer: "Molex",
  description: "Micro-Fit 3.0 receptacle, 4 circuit",
  pinCount: 4,
  sealed: true
}
const pinMap = { 1: "SIG", 2: "GND", 3: "PWR", 4: "RTN" }

const TERMINAL_MPN = "43030-0007"
const SEAL_MPN = "43031-0001"

/** Every optional field populated — the round-trip and deep-equality fixture. */
const terminalRecord: TerminalPart = {
  mpn: TERMINAL_MPN,
  manufacturer: "Molex",
  family: "Micro-Fit 3.0",
  description: "Female crimp terminal, 20-24AWG, gold",
  wireGaugeRange: { min: "24AWG", max: "20AWG" },
  insulationDiameterRange: { min: 1.35, max: 2.0 },
  plating: "gold",
  currentRatingA: 5,
  crimpTool: "63819-0000",
  dieId: "63819-0900",
  stripLength: 3.2,
  crimpHeight: { min: 0.94, max: 1.02 },
  pullForceN: 45,
  provenance: {
    source: "test fixture",
    datasheet: "https://example.invalid/43030",
    verification: "inspired-by",
    lastVerified: "2026-01-01"
  }
}

const sealRecord: SealPart = {
  mpn: SEAL_MPN,
  manufacturer: "Molex",
  family: "Micro-Fit 3.0",
  description: "Cavity seal, 1.7-2.4mm insulation",
  insulationDiameterRange: { min: 1.7, max: 2.4 },
  provenance: { verification: "inspired-by" }
}

/**
 * One connector, one wire, parameterized only by how the terminals and seals
 * are spelled. The string form and the record form must differ in nothing but
 * the descriptive fields, so the comparison has to hold everything else fixed.
 */
const compileWith = (opts: {
  readonly terminals?: PinPartAssignment<TerminalPart>
  readonly seals?: PinPartAssignment<SealPart>
}) => {
  const j1 = connector("J1", housing, { pins: pinMap, ...opts })
  const j2 = connector("J2", housing, { pins: pinMap })
  return compileDesign(
    harness("terminal-parts", {
      revision: "A",
      units: "mm",
      connectors: [j1, j2],
      wires: [wire("W1", j1.pin(1), j2.pin(1), { gauge: "22AWG", length: 300 })]
    })
  )
}

const pinsOf = (hir: ReturnType<typeof compileWith>["hir"], ref: string) =>
  hir.connectors.find((c) => c.ref === ref)!.pins

const bomLine = (hir: ReturnType<typeof compileWith>["hir"], mpn: string) =>
  hir.bom.find((item) => item.mpn === mpn)

describe("terminals given as bare MPNs", () => {
  const { hir, diagnostics } = compileWith({ terminals: TERMINAL_MPN })

  it("compiles clean", () => {
    expect(diagnostics).toEqual([])
  })

  it("sets the pin's terminal and carries no terminalPart key at all", () => {
    const pin1 = pinsOf(hir, "J1")[0]!
    expect(pin1.terminal).toBe(TERMINAL_MPN)
    // Absence, not undefined: the key must never appear in serialized HIR.
    expect(Object.keys(pin1)).toStrictEqual(["pin", "signal", "terminal"])
    expect("terminalPart" in pin1).toBe(false)
    expect(JSON.stringify(hir)).not.toContain("terminalPart")
  })

  it("puts the terminal on the BOM with nothing behind the part number", () => {
    expect(bomLine(hir, TERMINAL_MPN)).toStrictEqual({
      mpn: TERMINAL_MPN,
      category: "terminal",
      unitOfMeasure: "ea",
      quantity: 4,
      usedBy: [
        "connector:J1.pin:1",
        "connector:J1.pin:2",
        "connector:J1.pin:3",
        "connector:J1.pin:4"
      ]
    })
  })
})

describe("terminals given as records", () => {
  const { hir, diagnostics } = compileWith({ terminals: terminalRecord })

  it("compiles clean", () => {
    expect(diagnostics).toEqual([])
  })

  it("keeps the MPN identical to the string form and adds the record beside it", () => {
    const stringForm = pinsOf(compileWith({ terminals: TERMINAL_MPN }).hir, "J1")
    const recordForm = pinsOf(hir, "J1")

    expect(recordForm.map((p) => p.terminal)).toStrictEqual(
      stringForm.map((p) => p.terminal)
    )
    expect(recordForm[0]!.terminalPart).toStrictEqual(terminalRecord)
  })

  it("round-trips the record through the HIR schema", () => {
    const decoded = decodeHir(JSON.parse(JSON.stringify(hir)))
    expect(decoded).toEqual(hir)
    expect(decoded.connectors[0]!.pins[0]!.terminalPart).toEqual(terminalRecord)
  })

  it("makes the BOM line orderable — manufacturer and description", () => {
    expect(bomLine(hir, TERMINAL_MPN)).toStrictEqual({
      mpn: TERMINAL_MPN,
      category: "terminal",
      unitOfMeasure: "ea",
      manufacturer: "Molex",
      description: "Female crimp terminal, 20-24AWG, gold",
      quantity: 4,
      usedBy: [
        "connector:J1.pin:1",
        "connector:J1.pin:2",
        "connector:J1.pin:3",
        "connector:J1.pin:4"
      ]
    })
  })

  it("changes only the descriptive fields — quantity, UoM and usedBy hold", () => {
    const asString = bomLine(compileWith({ terminals: TERMINAL_MPN }).hir, TERMINAL_MPN)!
    const asRecord = bomLine(hir, TERMINAL_MPN)!

    expect(asRecord.quantity).toBe(asString.quantity)
    expect(asRecord.unitOfMeasure).toBe(asString.unitOfMeasure)
    expect(asRecord.usedBy).toStrictEqual(asString.usedBy)
    expect(asRecord.category).toBe(asString.category)
    // …and the rest of the BOM is untouched by the spelling.
    expect(hir.bom.map((i) => i.mpn)).toStrictEqual(
      compileWith({ terminals: TERMINAL_MPN }).hir.bom.map((i) => i.mpn)
    )
  })
})

describe("seals behave as terminals do", () => {
  it("carries no sealPart key for a bare MPN", () => {
    const { hir, diagnostics } = compileWith({ seals: SEAL_MPN })
    const pin1 = pinsOf(hir, "J1")[0]!

    expect(diagnostics).toEqual([])
    expect(pin1.seal).toBe(SEAL_MPN)
    expect("sealPart" in pin1).toBe(false)
    expect(bomLine(hir, SEAL_MPN)).toStrictEqual({
      mpn: SEAL_MPN,
      category: "seal",
      unitOfMeasure: "ea",
      quantity: 4,
      usedBy: [
        "connector:J1.pin:1",
        "connector:J1.pin:2",
        "connector:J1.pin:3",
        "connector:J1.pin:4"
      ]
    })
  })

  it("carries the record and enriches the BOM line for a record", () => {
    const { hir, diagnostics } = compileWith({ seals: sealRecord })
    const asString = compileWith({ seals: SEAL_MPN }).hir

    expect(diagnostics).toEqual([])
    expect(pinsOf(hir, "J1")[0]!.sealPart).toStrictEqual(sealRecord)
    expect(pinsOf(hir, "J1")[0]!.seal).toBe(pinsOf(asString, "J1")[0]!.seal)
    expect(bomLine(hir, SEAL_MPN)).toStrictEqual({
      ...bomLine(asString, SEAL_MPN)!,
      manufacturer: "Molex",
      description: "Cavity seal, 1.7-2.4mm insulation"
    })
  })

  it("carries terminals and seals together on one pin", () => {
    const { hir, diagnostics } = compileWith({
      terminals: terminalRecord,
      seals: sealRecord
    })
    const pin1 = pinsOf(hir, "J1")[0]!

    expect(diagnostics).toEqual([])
    expect(Object.keys(pin1)).toStrictEqual([
      "pin",
      "signal",
      "terminal",
      "seal",
      "terminalPart",
      "sealPart"
    ])
  })
})

describe("one MPN described two ways (HK-CONN-006)", () => {
  /** Same part number, different crimp height — the press setting an operator
   * would read off the wrong one of these. */
  const conflicting: TerminalPart = {
    ...terminalRecord,
    crimpHeight: { min: 1.1, max: 1.2 }
  }

  it("reports the contradiction, naming both pins", () => {
    const { diagnostics } = compileWith({
      terminals: { 1: terminalRecord, 2: conflicting, 3: TERMINAL_MPN, 4: TERMINAL_MPN }
    })

    expect(diagnostics).toEqual([
      {
        code: "HK-CONN-006",
        severity: "error",
        message: `Part ${TERMINAL_MPN} is described as a terminal at connector:J1.pin:2 and differently as a terminal at connector:J1.pin:1; one part number cannot describe two different parts.`,
        target: "connector:J1.pin:2",
        targets: ["connector:J1.pin:1"],
        data: {
          mpn: TERMINAL_MPN,
          kind: "terminal",
          firstTarget: "connector:J1.pin:1"
        }
      }
    ])
  })

  it("stays silent when both pins declare the identical record", () => {
    // Distinct object identities, equal contents: the rule is deep equality,
    // not reference equality.
    const clone: TerminalPart = JSON.parse(JSON.stringify(terminalRecord))
    const { diagnostics } = compileWith({
      terminals: { 1: terminalRecord, 2: clone, 3: clone, 4: terminalRecord }
    })

    expect(diagnostics).toEqual([])
  })

  it("stays silent when equal records differ only in authored key order", () => {
    // `terminalRecord` written back to front, values unchanged.
    const reordered: TerminalPart = {
      description: "Female crimp terminal, 20-24AWG, gold",
      mpn: TERMINAL_MPN,
      provenance: {
        lastVerified: "2026-01-01",
        verification: "inspired-by",
        datasheet: "https://example.invalid/43030",
        source: "test fixture"
      },
      pullForceN: 45,
      crimpHeight: { max: 1.02, min: 0.94 },
      stripLength: 3.2,
      dieId: "63819-0900",
      crimpTool: "63819-0000",
      currentRatingA: 5,
      plating: "gold",
      insulationDiameterRange: { max: 2.0, min: 1.35 },
      wireGaugeRange: { max: "20AWG", min: "24AWG" },
      family: "Micro-Fit 3.0",
      manufacturer: "Molex"
    }
    const { diagnostics } = compileWith({
      terminals: { 1: terminalRecord, 2: reordered, 3: reordered, 4: reordered }
    })

    expect(diagnostics).toEqual([])
  })

  it("reports a seal contradicting itself the same way", () => {
    const otherSeal: SealPart = {
      ...sealRecord,
      insulationDiameterRange: { min: 2.4, max: 3.0 }
    }
    const { diagnostics } = compileWith({ seals: { 1: sealRecord, 2: otherSeal } })

    expect(diagnostics.map((d) => [d.code, d.target, d.data?.kind])).toEqual([
      ["HK-CONN-006", "connector:J1.pin:2", "seal"]
    ])
  })
})

describe("determinism", () => {
  it("compiles the same design to byte-identical HIR twice", () => {
    const opts = { terminals: terminalRecord, seals: sealRecord } as const
    expect(JSON.stringify(compileWith(opts).hir)).toBe(
      JSON.stringify(compileWith(opts).hir)
    )
  })

  /**
   * The hard constraint on this feature: no bundled example passes a record,
   * so every existing harness must compile to the bytes it compiled to before
   * terminal records existed.
   *
   * The digest below was captured by compiling `examples/robot-platform`
   * against the tree immediately before the compiler changes landed
   * (`bun run` over `compileDesign(design)`, sha256 of `JSON.stringify(hir)`)
   * and re-checked after. Asserting the literal rather than "the snapshot did
   * not move" is deliberate: a snapshot that is regenerated in the same commit
   * proves nothing.
   */
  // Pins the compiled harness so an unintended change to the compiler fails
  // loudly rather than regenerating a snapshot. The digest moved once, on
  // purpose: robot-platform now declares each wire's branch (its breakouts
  // previously counted zero conductors) and states the drives' continuous
  // 1.5A draw rather than their 3A peak.
  // Moved again when PDB_OUT went from Mega-Fit to Micro-Fit: Mega-Fit
  // bottoms out at 16AWG and the driver end tops out at 20AWG, so no gauge
  // crimped into both.
  it("compiles examples/robot-platform to its pinned output", () => {
    const json = JSON.stringify(compileDesign(robotPlatform).hir)

    expect(createHash("sha256").update(json).digest("hex")).toBe(
      "be5fdc5a430920aa266e606a22a3726b12ecf134fbe44475f5585664ab528205"
    )
    expect(Buffer.byteLength(json)).toBe(36139)
  })
})

import { describe, expect, it } from "vitest"
import { compileDesign, connector, harness, runRules, splice, wire } from "@grayhaven/nerve"
import { builtinRules } from "@grayhaven/nerve-rules"
import {
  assemblyInstructions,
  boardSvg,
  coverage,
  cutListCsv,
  generateTestPlan,
  schematicSvg
} from "@grayhaven/nerve-exporters"
import design from "../../../examples/sensor-splice/src/main.harness.js"

const { hir } = compileDesign(design)

describe("sensor-splice example under built-in rules", () => {
  it("has no errors", () => {
    const diags = runRules(hir, builtinRules)
    expect(diags.filter((d) => d.severity === "error")).toEqual([])
  })
})

describe("test plan with splices (PRD §9.9)", () => {
  const plan = generateTestPlan(hir)

  it("generates splice verification tests across each splice", () => {
    const spliceTests = plan.tests.filter((t) => t.type === "splice")
    // S1: pins J1.1, P1.1, P2.1 → hub + 2; S2 likewise.
    expect(spliceTests).toHaveLength(4)
    expect(spliceTests[0]).toMatchObject({
      type: "splice",
      splice: "S1",
      from: { connector: "J1", pin: "1" },
      expected: "closed",
      net: "V5"
    })
  })

  it("nets span splices: every net is covered", () => {
    const { nets, covered } = coverage(hir, plan)
    expect(covered).toBe(nets)
    // V5, GND, CAN_H, CAN_L = 4 nets.
    expect(nets).toBe(4)
  })

  it("no-short tests treat spliced wires as one net", () => {
    const noShort = plan.tests.filter((t) => t.type === "no-short")
    // J1 has 4 distinct nets → 6 pairs; P1 and P2 have 3 nets each → 3 pairs each.
    expect(noShort).toHaveLength(12)
  })
})

describe("test plan across chained splices", () => {
  const part = { mpn: "P", pinCount: 1 }
  const a = connector("J1", part, { pins: { 1: "SIG" } })
  const b = connector("J2", part, { pins: { 1: "SIG" } })
  const s1 = splice("S1", { type: "crimp" })
  const s2 = splice("S2", { type: "crimp" })
  const chained = compileDesign(
    harness("chained-splices", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      splices: [s1, s2],
      wires: [
        wire("W1", a.pin(1), s1, { signal: "SIG" }),
        wire("W2", s1, s2, { signal: "SIG" }),
        wire("W3", s2, b.pin(1), { signal: "SIG" })
      ]
    })
  ).hir

  it("adds a traceable end-to-end continuity test", () => {
    const plan = generateTestPlan(chained)
    expect(plan.tests).toContainEqual({
      id: "T-001",
      type: "net-continuity",
      from: { connector: "J1", pin: "1" },
      to: { connector: "J2", pin: "1" },
      expected: "closed",
      net: "SIG",
      wires: ["W1", "W2", "W3"],
      splices: ["S1", "S2"]
    })
    expect(coverage(chained, plan)).toEqual({ nets: 1, covered: 1 })
  })
})

describe("splice rendering and outputs", () => {
  it("schematic shows splice symbols", () => {
    const svg = schematicSvg(hir)
    // Rail-seated splices carry short id-only labels (type lives in the
    // BOM); the symbol itself still renders with its data-splice tag.
    expect(svg).toContain('data-splice="S1"')
    expect(svg).toContain(">S1</text>")
    expect(svg).toContain('data-splice="S2"')
    expect(svg).toContain(">S2</text>")
  })

  it("board shows splices at their branch locations", () => {
    const svg = boardSvg(hir)
    expect(svg).toContain("S1 (crimp)")
  })

  it("cut list shows splice endpoints and cable membership", () => {
    const csv = cutListCsv(hir, { defaultWireTolerance: 5 })
    expect(csv).toContain("W2,V5,26AWG,red,,180,180,,,,,,5,mm,S1,,P1,1")
    expect(csv).toContain(
      "W7,CAN_H,26AWG,white,,300,300,,,,,,5,mm,J1,3,P1,3,SPH-004T-P0.5S,SPH-004T-P0.5S,C1"
    )
  })

  it("assembly instructions include the splice section", () => {
    const text = assemblyInstructions(hir)
    expect(text).toContain("Splice S1: join W1 + W2 + W3 (crimp, GT-0.5) at 120 mm along main")
  })
})

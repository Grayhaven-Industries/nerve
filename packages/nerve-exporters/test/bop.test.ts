import { describe, expect, it } from "vitest"
import { compileDesign } from "@grayhaven/nerve"
import { bopCsv, generateBop } from "@grayhaven/nerve-exporters"
import motor from "../../../examples/motor-controller/src/main.harness.js"
import robot from "../../../examples/robot-platform/src/main.harness.js"

describe("Bill of Process (PRD §28)", () => {
  const { hir } = compileDesign(motor)
  const bop = generateBop(hir)

  it("sequences operations in router order: prep → assembly → finishing → qa", () => {
    const stations = bop.operations.map((o) => o.workstation)
    const firstAssembly = stations.indexOf("assembly")
    const firstQa = stations.indexOf("qa")
    expect(stations.slice(0, firstAssembly).every((s) => s === "wire-prep")).toBe(true)
    expect(stations.slice(firstQa).every((s) => s === "qa")).toBe(true)
    expect(bop.operations.map((o) => o.seq)).toEqual(
      bop.operations.map((_, i) => (i + 1) * 10)
    )
  })

  it("every step links back to HIR objects (PRD §28 acceptance)", () => {
    const validRefs = new Set([
      ...hir.wires.map((w) => `wire:${w.id}`),
      ...hir.connectors.map((c) => `connector:${c.ref}`),
      ...hir.branches.map((b) => `branch:${b.id}`),
      ...hir.labels.map((l) => `label:${l.id}`),
      ...hir.splices.map((s) => `splice:${s.id}`),
      "test-plan"
    ])
    for (const op of bop.operations) {
      expect(op.targets.length).toBeGreaterThan(0)
      for (const target of op.targets) {
        expect(validRefs.has(target), `${op.op} target ${target}`).toBe(true)
      }
    }
  })

  it("covers cut, twist, crimp, populate, sleeve, label, inspect, test", () => {
    const ops = new Set(bop.operations.map((o) => o.op))
    for (const expected of ["cut-strip", "twist", "crimp", "populate", "sleeve", "label", "inspect", "test"]) {
      // SAFETY: the set holds Operation["op"] literals; the probe is a plain
      // string on purpose, so a renamed op fails the assertion, not the build.
      expect(ops.has(expected as never), expected).toBe(true)
    }
  })

  it("estimates labor time and is deterministic", () => {
    expect(bop.totalEstimatedSeconds).toBeGreaterThan(0)
    expect(bop.estimatedLaborMinutes).toBeCloseTo(bop.totalEstimatedSeconds / 60, 0)
    expect(generateBop(hir)).toEqual(bop)
    expect(bopCsv(hir)).toMatchSnapshot()
  })

  it("includes splice operations with tooling on the robot platform", () => {
    const { hir: robotHir } = compileDesign(robot)
    const robotBop = generateBop(robotHir)
    const spliceOps = robotBop.operations.filter((o) => o.op === "splice")
    expect(spliceOps).toHaveLength(4)
    expect(spliceOps.find((o) => o.targets.includes("splice:S_CANH"))?.tools).toEqual(["heat gun"])
    // A realistic platform is roughly an hour-plus of bench time.
    expect(robotBop.estimatedLaborMinutes).toBeGreaterThan(45)
  })
})

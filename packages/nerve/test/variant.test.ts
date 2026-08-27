import { describe, expect, it } from "vitest"
import { compileDesign, diffHir, runRules, variant } from "@grayhaven/nerve"
import { builtinRules } from "@grayhaven/nerve-rules"
import base from "../../../examples/motor-controller/src/main.harness.js"
import long from "../../../examples/motor-controller/src/variants/long.js"

describe("variants (PRD §8.4)", () => {
  const baseHir = compileDesign(base).hir
  const longHir = compileDesign(long).hir

  it("shares definitions with the base and records lineage", () => {
    // Connectors are literally shared objects, not copies.
    expect(long.connectors).toEqual(base.connectors)
    expect(long.metadata["variantOf"]).toBe("motor-controller-harness")
    expect(longHir.harness.metadata["variantOf"]).toBe("motor-controller-harness")
  })

  it("does not mutate the base design", () => {
    expect(base.wires.find((w) => w.id === "W1")?.length).toBe(420)
    expect(base.labels[0]?.text).toBe("MOTOR CTRL A")
  })

  it("applies overrides, removals, and additions", () => {
    expect(longHir.wires.find((w) => w.id === "W1")?.length).toBe(800)
    expect(longHir.branches[0]?.nominalLength).toBe(800)
    expect(longHir.labels[0]?.text).toBe("MOTOR CTRL A LONG")
  })

  it("differences are visible in generated diffs (PRD §8.4 success criteria)", () => {
    const d = diffHir(baseHir, longHir)
    expect(d.harness).toContainEqual({
      field: "id",
      from: "motor-controller-harness",
      to: "motor-controller-harness-long"
    })
    expect(d.wires.changed.map((c) => c.id)).toEqual(["W1", "W2", "W3", "W4"])
    expect(d.labels.changed[0]?.changes).toContainEqual({
      field: "text",
      from: "MOTOR CTRL A",
      to: "MOTOR CTRL A LONG"
    })
  })

  it("validation rules apply consistently across variants", () => {
    const baseDiags = runRules(baseHir, builtinRules)
    const longDiags = runRules(longHir, builtinRules)
    // The long variant assigns W3/W4 lengths, so it has FEWER warnings —
    // and gains none.
    expect(longDiags.filter((d) => d.severity === "error")).toEqual([])
    expect(longDiags.filter((d) => d.code === "HK-MFG-001")).toHaveLength(0)
    expect(baseDiags.filter((d) => d.code === "HK-MFG-001")).toHaveLength(2)
  })

  it("adds, overrides, and removes protection devices without mutating the base", () => {
    const added = variant(base, {
      id: "motor-controller-protected",
      protections: {
        add: [{ id: "F1", kind: "fuse", ratingA: 5, protects: ["W1"] }]
      }
    })
    const changed = variant(added, {
      id: "motor-controller-protected-3a",
      protections: { override: { F1: { ratingA: 3 } } }
    })
    const removed = variant(changed, {
      id: "motor-controller-unprotected",
      protections: { remove: ["F1"] }
    })

    expect(base.protections).toEqual([])
    expect(added.protections[0]?.ratingA).toBe(5)
    expect(changed.protections[0]?.ratingA).toBe(3)
    expect(removed.protections).toEqual([])
  })
})

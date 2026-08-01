// vitest 4.1.10 (root devDependency, resolved in bun.lock) — describe/it/expect
// and the toEqual / toBeCloseTo matchers used below.
import { describe, expect, it } from "vitest"
import type { Margin } from "@grayhaven/nerve"
import { diffMargins, MARGIN_EPSILON } from "../src/margin-diff.js"

/** Build a margin the way the rule runner would, deriving the ratios. */
const measure = (
  target: string,
  quantity: string,
  measured: number,
  limit: number,
  options: { readonly code?: string; readonly unit?: string } = {}
): Margin => ({
  code: options.code ?? "HK-TEST-001",
  target,
  quantity,
  measured,
  limit,
  unit: options.unit ?? "mm",
  utilization: measured / limit,
  margin: 1 - measured / limit
})

describe("diffMargins", () => {
  it("reports no movement for identical inputs", () => {
    const margins = [
      measure("wire:W1", "stub length", 40, 100),
      measure("wire:W2", "derated ampacity", 3, 10)
    ]
    const d = diffMargins(margins, [...margins])
    expect(d.unchanged).toBe(true)
    expect(d.worstRegression).toBeUndefined()
    expect(d.changes.map((c) => c.kind)).toEqual(["unchanged", "unchanged"])
  })

  it("classifies a worsening margin with a signed utilization delta", () => {
    const d = diffMargins(
      [measure("wire:W1", "stub length", 40, 100)],
      [measure("wire:W1", "stub length", 70, 100)]
    )
    const change = d.changes[0]
    expect(change?.kind).toBe("worsened")
    expect(change?.utilizationDelta).toBeCloseTo(0.3, 12)
    expect(change?.before?.margin).toBeCloseTo(0.6, 12)
    expect(change?.after?.margin).toBeCloseTo(0.3, 12)
    expect(d.unchanged).toBe(false)
    expect(d.worstRegression?.target).toBe("wire:W1")
  })

  it("classifies an improving margin", () => {
    const d = diffMargins(
      [measure("wire:W1", "stub length", 70, 100)],
      [measure("wire:W1", "stub length", 40, 100)]
    )
    expect(d.changes[0]?.kind).toBe("improved")
    expect(d.changes[0]?.utilizationDelta).toBeCloseTo(-0.3, 12)
    // An improvement is movement, and it is not a regression.
    expect(d.unchanged).toBe(false)
    expect(d.worstRegression).toBeUndefined()
  })

  it("classifies measurements that appear and disappear without a delta", () => {
    const d = diffMargins(
      [measure("wire:W1", "stub length", 40, 100)],
      [measure("wire:W2", "bend radius", 20, 50)]
    )
    const byTarget = new Map(d.changes.map((c) => [c.target, c]))
    expect(byTarget.get("wire:W1")?.kind).toBe("disappeared")
    expect(byTarget.get("wire:W1")?.after).toBeUndefined()
    expect(byTarget.get("wire:W1")?.utilizationDelta).toBeUndefined()
    expect(byTarget.get("wire:W2")?.kind).toBe("appeared")
    expect(byTarget.get("wire:W2")?.before).toBeUndefined()
    expect(byTarget.get("wire:W2")?.utilizationDelta).toBeUndefined()
    // Neither side can be ranked as a headroom loss: one half is missing.
    expect(d.worstRegression).toBeUndefined()
  })

  it("picks the largest headroom loss across differing targets and quantities", () => {
    const before = [
      measure("wire:W1", "stub length", 10, 100),
      measure("wire:W2", "derated ampacity", 1, 10),
      measure("bundle:B1", "bend radius", 20, 50)
    ]
    const after = [
      measure("wire:W1", "stub length", 20, 100), // +0.10
      measure("wire:W2", "derated ampacity", 5, 10), // +0.40
      measure("bundle:B1", "bend radius", 30, 50) // +0.20
    ]
    const d = diffMargins(before, after)
    expect(d.worstRegression?.target).toBe("wire:W2")
    expect(d.worstRegression?.quantity).toBe("derated ampacity")
    expect(d.worstRegression?.utilizationDelta).toBeCloseTo(0.4, 12)
  })

  it("treats a sub-epsilon float wobble as unchanged, not worsened", () => {
    const before = measure("wire:W1", "stub length", 40, 100)
    const wobble: Margin = {
      ...before,
      utilization: before.utilization + MARGIN_EPSILON / 10,
      margin: before.margin - MARGIN_EPSILON / 10
    }
    const d = diffMargins([before], [wobble])
    expect(d.changes[0]?.kind).toBe("unchanged")
    expect(d.unchanged).toBe(true)
    expect(d.worstRegression).toBeUndefined()
    // The delta is still reported; only the classification ignores it.
    expect(d.changes[0]?.utilizationDelta).toBeGreaterThan(0)

    // Just above the floor it counts as real movement.
    const real: Margin = {
      ...before,
      utilization: before.utilization + MARGIN_EPSILON * 10,
      margin: before.margin - MARGIN_EPSILON * 10
    }
    expect(diffMargins([before], [real]).changes[0]?.kind).toBe("worsened")
  })

  it("flags a crossing into over-budget while still classifying it as worsened", () => {
    const d = diffMargins(
      [measure("wire:W1", "stub length", 90, 100)],
      [measure("wire:W1", "stub length", 120, 100)]
    )
    const change = d.changes[0]
    expect(change?.kind).toBe("worsened")
    expect(change?.crossedLimit).toBe(true)
    expect(change?.after?.margin).toBeLessThan(0)

    // Worsening while already over budget is not a fresh crossing.
    const deeper = diffMargins(
      [measure("wire:W1", "stub length", 120, 100)],
      [measure("wire:W1", "stub length", 150, 100)]
    )
    expect(deeper.changes[0]?.kind).toBe("worsened")
    expect(deeper.changes[0]?.crossedLimit).toBeUndefined()

    // Recovering back under the limit is an improvement, never a crossing.
    const recovered = diffMargins(
      [measure("wire:W1", "stub length", 120, 100)],
      [measure("wire:W1", "stub length", 80, 100)]
    )
    expect(recovered.changes[0]?.kind).toBe("improved")
    expect(recovered.changes[0]?.crossedLimit).toBeUndefined()
  })

  it("is deterministic: identical inputs produce identical output", () => {
    const before = [
      measure("wire:W9", "stub length", 10, 100),
      measure("wire:W1", "derated ampacity", 1, 10, { code: "HK-TEST-002" }),
      measure("wire:W1", "derated ampacity", 1, 10, { code: "HK-TEST-001" }),
      measure("bundle:B1", "bend radius", 20, 50)
    ]
    const after = [
      measure("bundle:B1", "bend radius", 40, 50),
      measure("wire:W1", "derated ampacity", 3, 10, { code: "HK-TEST-001" }),
      measure("wire:W1", "derated ampacity", 1, 10, { code: "HK-TEST-002" }),
      measure("wire:W5", "stub length", 10, 100)
    ]
    const a = diffMargins(before, after)
    const b = diffMargins(before, after)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    // Canonical order: target, then code, then quantity.
    expect(a.changes.map((c) => `${c.target}|${c.code}`)).toEqual([
      "bundle:B1|HK-TEST-001",
      "wire:W1|HK-TEST-001",
      "wire:W1|HK-TEST-002",
      "wire:W5|HK-TEST-001",
      "wire:W9|HK-TEST-001"
    ])
  })
})

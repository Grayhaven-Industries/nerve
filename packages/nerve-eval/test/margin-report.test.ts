// vitest 4.1.10 (root devDependency, resolved in bun.lock) — describe/it/expect
// with the toEqual / toBeCloseTo matchers used below.
import { describe, expect, it } from "vitest"
import { HIR_SCHEMA_VERSION, type Hir, type Margin } from "@grayhaven/nerve"
import { createReviewReport, type ReviewReportOptions } from "@grayhaven/nerve-eval"

const hir: Hir = {
  schemaVersion: HIR_SCHEMA_VERSION,
  harness: { id: "HN-1", revision: "A", units: "mm", metadata: {} },
  connectors: [],
  wires: [],
  cables: [],
  branches: [],
  splices: [],
  labels: [],
  bom: [],
  diagnostics: [],
  layoutHints: [],
  exports: {}
}

const options: ReviewReportOptions = {
  source: { name: "main.harness.ts", format: "nerve-typescript" },
  hirFingerprint: "sha256:abc",
  toolVersion: "6.2.0",
  rules: { package: "@grayhaven/nerve-rules", version: "6.2.0", codes: ["HK-CONN-011"] },
  limitations: ["Checks can use only facts present in the submitted design."]
}

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

describe("review report margins", () => {
  it("omits the section entirely when no margins are supplied", () => {
    const report = createReviewReport(hir, [], options)
    // Pinned key list: the exact shape a report had before margins existed.
    expect(Object.keys(report)).toEqual([
      "reportVersion",
      "reportType",
      "source",
      "harness",
      "engine",
      "summary",
      "findings",
      "limitations",
      "disclaimer"
    ])
    expect("margins" in report).toBe(false)
    expect(JSON.stringify(report)).toBe(
      JSON.stringify(createReviewReport(hir, [], { ...options }))
    )
  })

  it("summarizes measurement count, worst margin, and over-budget count", () => {
    const report = createReviewReport(hir, [], {
      ...options,
      margins: [
        measure("wire:W1", "stub length", 40, 100),
        measure("wire:W2", "derated ampacity", 12, 10, { unit: "A" }),
        measure("bundle:B1", "bend radius", 96, 100),
        measure("wire:W3", "voltage drop", 110, 100, { unit: "V" })
      ]
    })
    expect(report.margins?.summary.measured).toBe(4)
    expect(report.margins?.summary.overBudget).toBe(2)
    expect(report.margins?.summary.worst?.margin).toBeCloseTo(-0.2, 12)
    expect(report.margins?.measurements).toHaveLength(4)
  })

  it("names the target and quantity that owns the worst margin", () => {
    const report = createReviewReport(hir, [], {
      ...options,
      margins: [
        measure("wire:W1", "stub length", 40, 100),
        measure("wire:W2", "derated ampacity", 9.9, 10, { unit: "A", code: "HK-TEST-002" }),
        measure("bundle:B1", "bend radius", 20, 50)
      ]
    })
    expect(report.margins?.summary.worst).toEqual({
      target: "wire:W2",
      quantity: "derated ampacity",
      code: "HK-TEST-002",
      margin: expect.closeTo(0.01, 12),
      utilization: expect.closeTo(0.99, 12),
      unit: "A"
    })
  })

  it("sorts measurements canonically and produces identical bytes across runs", () => {
    const margins = [
      measure("wire:W9", "stub length", 10, 100),
      measure("bundle:B1", "bend radius", 20, 50),
      measure("wire:W1", "voltage drop", 1, 10, { code: "HK-TEST-002" }),
      measure("wire:W1", "derated ampacity", 1, 10, { code: "HK-TEST-001" })
    ]
    const a = createReviewReport(hir, [], { ...options, margins })
    const b = createReviewReport(hir, [], { ...options, margins: [...margins].reverse() })
    expect(a.margins?.measurements.map((m) => `${m.target}|${m.code}`)).toEqual([
      "bundle:B1|HK-TEST-001",
      "wire:W1|HK-TEST-001",
      "wire:W1|HK-TEST-002",
      "wire:W9|HK-TEST-001"
    ])
    // Input order must not leak into the output.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(a)).toBe(
      JSON.stringify(createReviewReport(hir, [], { ...options, margins }))
    )
  })

  it("keeps the section when margins were collected but nothing was measured", () => {
    const report = createReviewReport(hir, [], { ...options, margins: [] })
    expect(report.margins?.summary.measured).toBe(0)
    expect(report.margins?.summary.overBudget).toBe(0)
    expect(report.margins?.summary.worst).toBeUndefined()
  })
})

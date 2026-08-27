/* oxlint-disable anti-slop/no-conditional-empty-object-spread -- Test fixtures conditionally omit exact optional fields. */
import { compileDesign, connector, harness, wire } from "@grayhaven/nerve"
import { describe, expect, it } from "vitest"
import {
  evaluateAutomationReadiness,
  evaluateHighVoltageProfile,
  type AutomationReadinessProfile,
  type HighVoltageDesignProfile
} from "../src/index.js"

const makeHir = (rating?: number) => {
  const j1 = connector("J1", { mpn: "H1", pinCount: 1 }, {
    pins: { 1: "HV+" },
    terminals: "TERM-1"
  })
  const j2 = connector("J2", { mpn: "H2", pinCount: 1 }, {
    pins: { 1: "HV+" },
    terminals: "TERM-2"
  })
  return compileDesign(
    harness("hv-demo", {
      revision: "A",
      units: "mm",
      connectors: [j1, j2],
      wires: [
        wire("HV1", j1.pin(1), j2.pin(1), {
          part: {
            mpn: "HV-WIRE",
            gauge: "12AWG",
            ...(rating === undefined ? {} : { voltageRating: rating })
          },
          gauge: "12AWG",
          length: 700,
          terminationAllowance: { from: 3, to: 3 },
          ...(rating === undefined ? {} : { voltageRating: rating })
        })
      ]
    })
  ).hir
}

describe("automation readiness", () => {
  it("evaluates only caller-selected data requirements and reports evidence", () => {
    const profile: AutomationReadinessProfile = {
      id: "robot-cell-data",
      revision: "3",
      citation: {
        documentId: "customer-automation-guide",
        revision: "2026-04",
        reference: "plm://guide/automation"
      },
      requirements: [
        { id: "LENGTH", fact: "wire.finished-length", entityIds: ["HV1"] },
        { id: "STRIP", fact: "wire.strip-length-both-ends", entityIds: ["HV1"] },
        { id: "UNKNOWN", fact: "system.robot-grip-orientation" }
      ]
    }
    const result = evaluateAutomationReadiness(makeHir(600), profile)
    expect(result.determination).toBe("data-readiness-only")
    expect(result.counts).toEqual({ satisfied: 1, failed: 1, unassessed: 1 })
    expect(result.findings.find((entry) => entry.requirementId === "LENGTH")?.evidence).toEqual([
      "wire:HV1.length"
    ])
    expect(result.findings.map((entry) => entry.code)).toContain("NI-AUTO-003")
  })

  it("has no built-in requirements or normative defaults", () => {
    const result = evaluateAutomationReadiness(makeHir(), {
      id: "empty",
      revision: "1",
      requirements: []
    })
    expect(result.findings).toEqual([])
    expect(result.counts).toEqual({ satisfied: 0, failed: 0, unassessed: 0 })
  })

  it("leaves unknown requested entities unassessed", () => {
    const result = evaluateAutomationReadiness(makeHir(), {
      id: "selection",
      revision: "1",
      requirements: [
        { id: "MATERIAL", fact: "wire.material-reference", entityIds: ["MISSING"] }
      ]
    })
    expect(result.findings[0]).toMatchObject({
      code: "NI-AUTO-004",
      status: "unassessed",
      target: "wire:MISSING"
    })
  })
})

const hvProfile = (maximumOperatingVoltageV: number): HighVoltageDesignProfile => ({
  id: "customer-hv-zones",
  revision: "2026.2",
  parameterAuthority: {
    name: "Customer approved electrical design specification",
    reference: "plm://spec/HV-17",
    revision: "D"
  },
  domains: [
    {
      id: "TRACTION",
      nominalVoltageV: 400,
      maximumOperatingVoltageV,
      authorityReference: "plm://spec/HV-17#domain-traction"
    }
  ],
  assignments: [{ wireId: "HV1", domainId: "TRACTION" }]
})

describe("high-voltage design readiness", () => {
  it("compares only caller-declared voltage domains with declared HIR ratings", () => {
    const passing = evaluateHighVoltageProfile(makeHir(600), hvProfile(500))
    const failing = evaluateHighVoltageProfile(makeHir(600), hvProfile(700))
    expect(passing.findings).toContainEqual(
      expect.objectContaining({ code: "NI-HV-007", status: "satisfied" })
    )
    expect(failing.findings).toContainEqual(
      expect.objectContaining({ code: "NI-HV-006", status: "failed" })
    )
    expect(JSON.stringify(passing)).not.toMatch(/hipot|dwell|clearance/i)
  })

  it("reports missing ratings and unknown assignments as unassessed", () => {
    const missingRating = evaluateHighVoltageProfile(makeHir(), hvProfile(500))
    expect(missingRating.findings).toContainEqual(
      expect.objectContaining({ code: "NI-HV-005", status: "unassessed" })
    )

    const unknown = evaluateHighVoltageProfile(makeHir(600), {
      ...hvProfile(500),
      assignments: [
        { wireId: "MISSING", domainId: "TRACTION" },
        { wireId: "HV1", domainId: "MISSING" }
      ]
    })
    expect(unknown.findings.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["NI-HV-003", "NI-HV-004"])
    )
    expect(unknown.findings.every((entry) => entry.status === "unassessed")).toBe(true)
  })

  it("refuses non-finite and non-positive wire ratings without comparing them", () => {
    for (const rating of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1]) {
      const result = evaluateHighVoltageProfile(makeHir(rating), hvProfile(500))
      expect(result.findings).toContainEqual(
        expect.objectContaining({ code: "NI-HV-012", status: "unassessed" })
      )
      expect(result.findings.some((entry) => entry.code === "NI-HV-007")).toBe(false)
    }
  })

  it("keeps HVIL, segregation, and shield grounding unassessed", () => {
    const result = evaluateHighVoltageProfile(makeHir(600), {
      ...hvProfile(500),
      hvil: {
        required: true,
        authorityReference: "plm://spec/HV-17#hvil",
        evidenceRefs: ["review:hvil-3"]
      },
      segregation: {
        required: true,
        authorityReference: "plm://spec/HV-17#segregation"
      },
      shieldGround: {
        required: true,
        authorityReference: "plm://spec/HV-17#shield"
      }
    })
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "NI-HV-008", status: "unassessed" }),
        expect.objectContaining({ code: "NI-HV-009", status: "unassessed" }),
        expect.objectContaining({ code: "NI-HV-010", status: "unassessed" })
      ])
    )
    expect(result.determination).toBe("design-data-readiness-only")
  })
})

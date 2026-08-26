import { describe, expect, it } from "vitest"
import {
  createCorpusReport,
  decodeEvalManifest,
  evaluateCase,
  type EvalCase
} from "@grayhaven/nerve-eval"

// An object literal rather than an `EvalCase` binding so the same value can
// be handed to the decoder as parsed JSON.
const testCase = {
  id: "synthetic-signal-mismatch",
  title: "Signal assignment mismatch",
  fixture: "mismatch.harness.ts",
  rationale: "A wire signal and assigned cavity signal disagree.",
  provenance: {
    kind: "synthetic",
    source: "Nerve regression case",
    rights: "public"
  },
  expectedFindings: [{ code: "HK-CONN-011", target: "connector:J2.pin:1" }]
} satisfies EvalCase

describe("evaluation primitives", () => {
  it("distinguishes asserted findings from findings that still need adjudication", () => {
    const result = evaluateCase(testCase, [
      {
        code: "HK-CONN-011",
        severity: "error",
        message: "Mismatch",
        target: "connector:J2.pin:1"
      },
      { code: "HK-CONN-010", severity: "warning", message: "Unconnected" }
    ])
    expect(result.passed).toBe(true)
    expect(result.unassertedFindings.map((finding) => finding.code)).toEqual([
      "HK-CONN-010"
    ])
  })

  it("reports provenance counts without upgrading synthetic cases", () => {
    const report = createCorpusReport([evaluateCase(testCase, [])])
    expect(report.summary).toMatchObject({
      total: 1,
      passed: 0,
      byProvenance: { synthetic: 1, "field-verified": 0 }
    })
  })

  it("decodes a valid manifest before fixtures are executed", () => {
    const manifest = decodeEvalManifest({
      corpusVersion: "0.1.0",
      cases: [testCase]
    })
    expect(manifest.cases[0]?.id).toBe("synthetic-signal-mismatch")
  })

  it("requires adjudication metadata for field-verified cases", () => {
    expect(() =>
      decodeEvalManifest({
        corpusVersion: "0.1.0",
        cases: [
          {
            ...testCase,
            provenance: {
              kind: "field-verified",
              source: "Private intake record",
              rights: "restricted"
            }
          }
        ]
      })
    ).toThrow(/reviewedByRole and reviewedOn/)
  })

  it("rejects duplicate case IDs and fixtures outside the corpus", () => {
    expect(() =>
      decodeEvalManifest({
        corpusVersion: "0.1.0",
        cases: [testCase, testCase]
      })
    ).toThrow(/repeats case ID/)
    expect(() =>
      decodeEvalManifest({
        corpusVersion: "0.1.0",
        cases: [{ ...testCase, fixture: "../customer.harness.ts" }]
      })
    ).toThrow(/within the corpus directory/)
  })
})

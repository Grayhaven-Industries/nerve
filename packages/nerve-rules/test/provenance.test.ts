/**
 * Rule provenance: what each built-in rule claims, and on whose authority.
 *
 * These tests exist to protect one property — that a citation in this rule
 * pack can be trusted. A missing `standard` is honest; a plausible-looking but
 * unsourced one is worse than nothing, because it converts "we did not
 * establish this" into "a standard requires this" without anyone noticing.
 * So the assertions below are mostly negative: they police what a rule is
 * allowed to claim, not how much it claims.
 *
 * vitest 4.1.10 (root package.json pins ^4.1.10; describe/it/expect API
 * confirmed against the v4.1.x docs).
 */
import { describe, expect, it } from "vitest"
import {
  compileDesign,
  connector,
  harness,
  wire,
  type ConnectorPart,
  type Rule
} from "@grayhaven/nerve"
import { builtinRules } from "@grayhaven/nerve-rules"
// Relative, not "@grayhaven/nerve-eval": nerve-rules does not depend on the
// eval package and must not grow a dependency on it just to assert the report
// contract. The path stays inside the monorepo.
import {
  createReviewReport,
  type ReviewReportOptions,
  type ReviewRuleProvenance
} from "../../nerve-eval/src/index.js"

const SEMVER = /^\d+\.\d+\.\d+$/

/**
 * A "standard" that is really a pointer at Nerve's own planning documents.
 * PRD §38 lists IPC/WHMA-A-620 and friends as intended future inputs; citing
 * a PRD section as the governing document would launder a roadmap entry into
 * an authority claim.
 */
const PRD_REFERENCE = /\bPRD\b|^\s*§|\bGOAL\.md\b/i

const part: ConnectorPart = { mpn: "PROV-2", pinCount: 2 }

const fixture = () => {
  const a = connector("J1", part, { pins: { 1: "SIG" } })
  const b = connector("J2", part, { pins: { 1: "SIG" } })
  return compileDesign(
    harness("report-fixture", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      wires: [
        wire("W1", a.pin(1), b.pin(1), {
          gauge: "20AWG",
          color: "red",
          length: 100,
          signal: "SIG"
        })
      ]
    })
  )
}

const baseOptions = (
  provenance?: ReadonlyArray<ReviewRuleProvenance>
): ReviewReportOptions => ({
  // Deliberately not named after this test file: the byte-identity assertion
  // below searches the serialized report for the word "provenance".
  source: { name: "fixture-harness.ts", format: "nerve-typescript" },
  hirFingerprint: "sha256:deadbeef",
  toolVersion: "0.0.0-test",
  rules: {
    package: "@grayhaven/nerve-rules",
    version: "0.0.0-test",
    codes: builtinRules.map((r) => r.code),
    ...(provenance !== undefined ? { provenance } : {})
  }
})

/** Provenance entries derived from the rules themselves, shuffled so the
 * sorting assertion cannot pass by accident of input order. */
const entriesFrom = (rules: ReadonlyArray<Rule>): ReadonlyArray<ReviewRuleProvenance> =>
  [...rules]
    .reverse()
    .map((r) => ({
      code: r.code,
      ...(r.ruleVersion !== undefined ? { ruleVersion: r.ruleVersion } : {}),
      ...(r.standard !== undefined ? { standard: r.standard } : {}),
      ...(r.clause !== undefined ? { clause: r.clause } : {})
    }))

describe("built-in rule provenance", () => {
  it("gives every built-in rule an addressable rule version", () => {
    const missing = builtinRules
      .filter((r) => r.ruleVersion === undefined || !SEMVER.test(r.ruleVersion))
      .map((r) => `${r.code} (${r.name})`)
    expect(missing).toEqual([])
  })

  it("never declares a clause without the document it belongs to", () => {
    // A clause number with no standard names a section of nothing.
    const orphaned = builtinRules
      .filter((r) => r.clause !== undefined && r.standard === undefined)
      .map((r) => `${r.code} cites clause ${r.clause} with no standard`)
    expect(orphaned).toEqual([])
  })

  it("never cites an empty or PRD-section 'standard'", () => {
    const bogus = builtinRules
      .filter(
        (r) =>
          r.standard !== undefined &&
          (r.standard.trim() === "" || PRD_REFERENCE.test(r.standard))
      )
      .map((r) => `${r.code} cites ${JSON.stringify(r.standard)}`)
    expect(bogus).toEqual([])
  })
})

describe("review report provenance", () => {
  it("stays byte-identical when no provenance is supplied", () => {
    const { hir, diagnostics } = fixture()
    const report = createReviewReport(hir, diagnostics, baseOptions())
    // Key set AND key order: the report is serialized and fingerprinted, so an
    // extra or reordered key is a change to the artifact, not to a type.
    expect(Object.keys(report.engine.rules)).toEqual(["package", "version", "codes"])
    expect(JSON.stringify(report)).not.toContain("provenance")
  })

  it("sorts supplied provenance by code and reports every code", () => {
    const { hir, diagnostics } = fixture()
    const report = createReviewReport(
      hir,
      diagnostics,
      baseOptions(entriesFrom(builtinRules))
    )
    const provenance = report.engine.rules.provenance
    expect(provenance).toBeDefined()
    const codes = provenance!.map((entry) => entry.code)
    expect(codes).toEqual([...codes].sort())
    // Every code the report lists is accounted for, and nothing extra rides in.
    expect(codes).toEqual([...report.engine.rules.codes])
    expect(provenance!.every((entry) => entry.ruleVersion !== undefined)).toBe(true)
  })

  it("produces identical JSON across runs", () => {
    const first = createReviewReport(
      ...([fixture().hir, fixture().diagnostics] as const),
      baseOptions(entriesFrom(builtinRules))
    )
    const second = createReviewReport(
      ...([fixture().hir, fixture().diagnostics] as const),
      baseOptions(entriesFrom(builtinRules))
    )
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})

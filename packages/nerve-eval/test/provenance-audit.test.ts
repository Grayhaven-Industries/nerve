/**
 * The soundness counterpart to coverage.
 *
 * docs/content/docs/reference/rule-coverage.mdx counts what the rule set
 * checks. Nothing counted what those checks rest on, and the cost of that
 * showed up as four wrong entries in this repository's own reference data,
 * all found as a side effect of other work rather than because anything was
 * looking.
 *
 * These tests pin the distinction the audit exists to make: a clean report
 * over verified limits and a clean report over transcribed ones are not the
 * same result, and the audit must never let the second read as the first.
 */
import { describe, expect, it } from "vitest"
import { compileDesign, connector, harness, wire } from "@grayhaven/nerve"
import type { ConnectorPart } from "@grayhaven/nerve"
import { auditProvenance, provenanceAuditJson } from "../src/index.js"

const housing = (mpn: string, provenance?: ConnectorPart["provenance"]): ConnectorPart => {
  const part = {
    mpn,
    pinCount: 2,
    // A limit a rule turns into a verdict — the whole point of the audit.
    wireGaugeRange: { min: "24AWG", max: "20AWG" }
  }
  return provenance === undefined ? part : { ...part, provenance }
}

const compile = (parts: ReadonlyArray<ConnectorPart>) => {
  const [a, b] = [
    connector("J1", parts[0]!, { pins: { 1: "SIG", 2: "GND" } }),
    connector("J2", parts[1] ?? parts[0]!, { pins: { 1: "SIG", 2: "GND" } })
  ]
  return compileDesign(
    harness("audit", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      wires: [wire("W1", a.pin(1), b.pin(1), { gauge: "22AWG", length: 100 })]
    })
  ).hir
}

describe("provenance audit", () => {
  it("counts every part a verdict depends on, by evidence tier", () => {
    const audit = auditProvenance(
      compile([
        housing("VERIFIED-1", { verification: "verified", datasheet: "https://example.invalid/a" }),
        housing("TRANSCRIBED-1", { verification: "inspired-by" })
      ])
    )

    expect(audit.summary.parts).toBe(2)
    expect(audit.summary.byTier).toEqual({
      none: 0,
      unverified: 0,
      "inspired-by": 1,
      verified: 1
    })
  })

  // The headline number. A part with limits and no evidence is the case worth
  // seeing: the checks run, they pass, and nobody confirmed what they passed
  // against.
  it("counts parts supplying a limit without being verified", () => {
    const audit = auditProvenance(
      compile([
        housing("VERIFIED-1", { verification: "verified" }),
        housing("TRANSCRIBED-1", { verification: "inspired-by" })
      ])
    )

    expect(audit.summary.decisiveUnverified).toBe(1)
    expect(audit.summary.weakestDecisiveTier).toBe("inspired-by")
  })

  it("treats a missing provenance record as weaker than an unverified one", () => {
    const audit = auditProvenance(
      compile([housing("NO-RECORD"), housing("SAID-SO", { verification: "unverified" })])
    )

    expect(audit.summary.byTier.none).toBe(1)
    // `none` is the floor: a part that never claimed anything is not better
    // evidenced than one that explicitly says it is unverified.
    expect(audit.summary.weakestDecisiveTier).toBe("none")
  })

  it("says so plainly when every limit is verified", () => {
    const audit = auditProvenance(
      compile([
        housing("VERIFIED-1", { verification: "verified" }),
        housing("VERIFIED-2", { verification: "verified" })
      ])
    )

    expect(audit.summary.decisiveUnverified).toBe(0)
    expect(audit.summary.weakestDecisiveTier).toBeUndefined()
  })

  // A part carrying no limit cannot make a rule decide anything, so it must
  // not inflate the count that a reader uses to judge the verdict.
  it("ignores an unverified part that supplies no limit at all", () => {
    const bare: ConnectorPart = { mpn: "BARE", pinCount: 2, provenance: { verification: "unverified" } }
    const audit = auditProvenance(compile([bare, bare]))

    expect(audit.summary.parts).toBe(1)
    expect(audit.summary.decisiveUnverified).toBe(0)
  })

  it("names which fields make a part decisive, and who depends on it", () => {
    const audit = auditProvenance(
      compile([housing("TRANSCRIBED-1", { verification: "inspired-by" })])
    )
    const part = audit.parts[0]!

    expect(part.decisiveFields).toContain("wireGaugeRange")
    expect(part.usedBy).toEqual(["connector:J1", "connector:J2"])
  })

  it("is deterministic", () => {
    const build = () =>
      provenanceAuditJson(
        auditProvenance(
          compile([housing("B", { verification: "verified" }), housing("A", { verification: "unverified" })])
        )
      )

    expect(build()).toBe(build())
  })
})

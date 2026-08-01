import { describe, expect, it } from "vitest"
import {
  analyzeElectricalConstraints,
  compileDesign,
  computeNets,
  connector,
  harness,
  runRules,
  wire,
  type Hir,
  type PinElectrical,
  type Rule,
  type RuleReport
} from "@grayhaven/nerve"
import {
  builtinRules,
  differentialSemanticConflict,
  multipleElectricalSources,
  protocolMismatch,
  sourceCurrentExceeded,
  undrivenElectricalLoad,
  voltageDomainMismatch
} from "@grayhaven/nerve-rules"

const part = { mpn: "SEMANTIC-1", pinCount: 1 }

const semanticNet = (
  left?: PinElectrical,
  right?: PinElectrical
): Hir => {
  const a = connector("J1", part, {
    pins: { 1: "NET" },
    ...(left !== undefined ? { electrical: { 1: left } } : {})
  })
  const b = connector("J2", part, {
    pins: { 1: "NET" },
    ...(right !== undefined ? { electrical: { 1: right } } : {})
  })
  return compileDesign(
    harness("electrical-semantics", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      wires: [
        wire("W1", a.pin(1), b.pin(1), {
          gauge: "24AWG",
          color: "red",
          length: 100,
          signal: "NET"
        })
      ]
    })
  ).hir
}

const cases = [
  {
    kind: "multiple-sources",
    rule: multipleElectricalSources,
    code: "HK-ELEC-012",
    severity: "error",
    hir: semanticNet({ role: "source" }, { role: "source" })
  },
  {
    kind: "undriven-load",
    rule: undrivenElectricalLoad,
    code: "HK-ELEC-013",
    severity: "warning",
    hir: semanticNet({ role: "sink" }, { role: "passive" })
  },
  {
    kind: "voltage-incompatible",
    rule: voltageDomainMismatch,
    code: "HK-ELEC-014",
    severity: "error",
    hir: semanticNet(
      { role: "source", voltage: { minV: 10, maxV: 12 } },
      { role: "sink", voltage: { minV: 11, maxV: 11 } }
    )
  },
  {
    kind: "protocol-mismatch",
    rule: protocolMismatch,
    code: "HK-ELEC-015",
    severity: "error",
    hir: semanticNet({ protocol: "CAN" }, { protocol: "LIN" })
  },
  {
    kind: "differential-conflict",
    rule: differentialSemanticConflict,
    code: "HK-ELEC-016",
    severity: "error",
    hir: semanticNet(
      { differential: { pair: "CAN", polarity: "positive" } },
      { differential: { pair: "RS485", polarity: "positive" } }
    )
  },
  {
    kind: "source-current-exceeded",
    rule: sourceCurrentExceeded,
    code: "HK-ELEC-017",
    severity: "error",
    hir: semanticNet(
      { role: "source", currentA: 1 },
      { role: "sink", currentA: 1.5 }
    )
  }
] as const satisfies ReadonlyArray<{
  kind: string
  rule: Rule
  code: string
  severity: "error" | "warning"
  hir: Hir
}>

describe("typed electrical semantic rules", () => {
  for (const fixture of cases) {
    it(`${fixture.code}: maps only ${fixture.kind} findings`, () => {
      const finding = analyzeElectricalConstraints(fixture.hir).findings.find(
        (candidate) => candidate.kind === fixture.kind
      )
      expect(finding).toBeDefined()

      const diagnostics = runRules(fixture.hir, [fixture.rule])
      expect(diagnostics).toEqual([
        {
          code: fixture.code,
          severity: fixture.severity,
          message: finding!.message,
          target: finding!.pins[0],
          ...(finding!.pins.length > 1 ? { targets: finding!.pins.slice(1) } : {}),
          ...(finding!.data !== undefined ? { data: finding!.data } : {})
        }
      ])
    })
  }

  it("keeps all six built-ins independently addressable with unique codes", () => {
    expect(builtinRules).toHaveLength(49)
    expect(cases.map(({ rule }) => rule.name)).toEqual([
      "multipleElectricalSources",
      "undrivenElectricalLoad",
      "voltageDomainMismatch",
      "protocolMismatch",
      "differentialSemanticConflict",
      "sourceCurrentExceeded"
    ])
    expect(cases.map(({ rule }) => rule.code)).toEqual([
      "HK-ELEC-012",
      "HK-ELEC-013",
      "HK-ELEC-014",
      "HK-ELEC-015",
      "HK-ELEC-016",
      "HK-ELEC-017"
    ])
    expect(new Set(builtinRules.map((rule) => rule.code)).size).toBe(49)
  })

  it("honors severity overrides and disabling by rule name", () => {
    const hir = semanticNet({ role: "source" }, { role: "source" })
    expect(
      runRules(hir, [multipleElectricalSources], {
        multipleElectricalSources: "warning"
      })[0]?.severity
    ).toBe("warning")
    expect(
      runRules(hir, [multipleElectricalSources], {
        multipleElectricalSources: "off"
      })
    ).toEqual([])
  })

  it("does not infer constraints when electrical semantics are unknown", () => {
    const hir = semanticNet()
    expect(analyzeElectricalConstraints(hir).findings).toEqual([])
    expect(runRules(hir, cases.map(({ rule }) => rule))).toEqual([])
  })

  it("reports an analyzer finding defensively when it has no pin refs", () => {
    const hir = semanticNet()
    const reports: Array<RuleReport> = []
    multipleElectricalSources.run({
      hir,
      nets: computeNets(hir),
      electrical: {
        nets: [],
        findings: [{
          kind: "multiple-sources",
          net: "NET",
          pins: [],
          message: "Analyzer finding without a physical anchor.",
          data: { sourceCount: 2 }
        }]
      },
      report: (report) => reports.push(report),
      // This rule is a discrete claim and takes no measurement; the runner
      // always supplies `measure`, so a no-op keeps the hand-built context
      // honest to the real one.
      measure: () => {}
    })

    expect(reports).toEqual([{
      severity: "error",
      message: "Analyzer finding without a physical anchor.",
      data: { sourceCount: 2 }
    }])
  })
})

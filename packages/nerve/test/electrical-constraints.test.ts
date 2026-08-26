import { describe, expect, it } from "vitest"
import {
  Codes,
  analyzeElectricalConstraints,
  compileDesign,
  connector,
  decodeHir,
  harness,
  rule,
  runRules,
  wire,
  type ConnectorInstance,
  type Hir,
  type PinElectrical
} from "@grayhaven/nerve"

const part = { mpn: "ELECTRICAL-TEST", pinCount: 4 }

const compilePair = (
  leftElectrical: PinElectrical,
  rightElectrical: PinElectrical,
  signal = "SIG"
): Hir => {
  const left = connector("J1", part, {
    pins: { 1: signal },
    electrical: { 1: leftElectrical }
  })
  const right = connector("J2", part, {
    pins: { 1: signal },
    electrical: { 1: rightElectrical }
  })
  return compileDesign(
    harness("electrical-pair", {
      revision: "A",
      units: "mm",
      connectors: [left, right],
      wires: [wire("W1", left.pin(1), right.pin(1), { signal })]
    })
  ).hir
}

const compileSingle = (
  connectorInstance: ConnectorInstance
): ReturnType<typeof compileDesign> => {
  const peer = connector("J2", part, { pins: { 1: "SIG" } })
  return compileDesign(
    harness("electrical-structure", {
      revision: "A",
      units: "mm",
      connectors: [connectorInstance, peer],
      wires: [wire("W1", connectorInstance.pin(1), peer.pin(1), { signal: "SIG" })]
    })
  )
}

describe("pin electrical compiler invariants", () => {
  it("keeps designs without semantics byte-compatible", () => {
    const left = connector("J1", part, { pins: { 1: "SIG" } })
    const right = connector("J2", part, { pins: { 1: "SIG" } })
    const { hir } = compileDesign(
      harness("legacy", {
        revision: "A",
        units: "mm",
        connectors: [left, right],
        wires: [wire("W1", left.pin(1), right.pin(1))]
      })
    )

    expect(left.electrical).toEqual({})
    expect(hir.connectors.flatMap((item) => item.pins)).not.toContainEqual(
      expect.objectContaining({ electrical: expect.anything() })
    )
  })

  it("round-trips valid semantics and trims identifiers", () => {
    const hir = compilePair(
      {
        role: "source",
        voltage: { minV: 11, maxV: 13 },
        currentA: 2,
        protocol: "  CAN FD ",
        differential: { pair: " CAN1 ", polarity: "positive" }
      },
      { role: "sink", voltage: { minV: 10, maxV: 14 } }
    )

    expect(hir.connectors[0]?.pins[0]?.electrical).toEqual({
      role: "source",
      voltage: { minV: 11, maxV: 13 },
      currentA: 2,
      protocol: "CAN FD",
      differential: { pair: "CAN1", polarity: "positive" }
    })
    expect(decodeHir(JSON.parse(JSON.stringify(hir)))).toEqual(hir)
  })

  it("rejects semantics assigned to a pin absent from pin assignments", () => {
    const instance = connector("J1", part, {
      pins: { 1: "SIG" },
      electrical: { 2: { role: "source" } }
    })
    const { hir, diagnostics } = compileSingle(instance)

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: Codes.InvalidPinElectrical,
        target: "connector:J1.pin:2"
      })
    )
    expect(hir.connectors[0]?.pins[0]?.electrical).toBeUndefined()
  })

  it("rejects non-finite voltage bounds and omits only those bounds", () => {
    const instance = connector("J1", part, {
      pins: { 1: "SIG" },
      electrical: { 1: { voltage: { minV: Number.NaN, maxV: Infinity } } }
    })
    const { hir, diagnostics } = compileSingle(instance)

    expect(
      diagnostics.filter((item) => item.code === Codes.InvalidPinElectrical)
    ).toHaveLength(2)
    expect(hir.connectors[0]?.pins[0]?.electrical).toEqual({ voltage: {} })
    expect(() => analyzeElectricalConstraints(hir)).not.toThrow()
  })

  it("rejects an inverted voltage range", () => {
    const instance = connector("J1", part, {
      pins: { 1: "SIG" },
      electrical: { 1: { voltage: { minV: 13, maxV: 11 } } }
    })
    const { hir, diagnostics } = compileSingle(instance)

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: Codes.InvalidPinElectrical })
    )
    expect(hir.connectors[0]?.pins[0]?.electrical).toEqual({})
  })

  it("rejects non-positive and non-finite current", () => {
    const zero = connector("J1", part, {
      pins: { 1: "SIG" },
      electrical: { 1: { role: "source", currentA: 0 } }
    })
    const infinite = connector("J1", part, {
      pins: { 1: "SIG" },
      electrical: { 1: { role: "source", currentA: Infinity } }
    })

    for (const instance of [zero, infinite]) {
      const { hir, diagnostics } = compileSingle(instance)
      expect(diagnostics).toContainEqual(
        expect.objectContaining({ code: Codes.InvalidPinElectrical })
      )
      expect(hir.connectors[0]?.pins[0]?.electrical).toEqual({ role: "source" })
    }
  })

  it("rejects a blank protocol", () => {
    const instance = connector("J1", part, {
      pins: { 1: "SIG" },
      electrical: { 1: { protocol: "  " } }
    })
    const { hir, diagnostics } = compileSingle(instance)

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: Codes.InvalidPinElectrical })
    )
    expect(hir.connectors[0]?.pins[0]?.electrical).toEqual({})
  })

  it("rejects a blank differential pair", () => {
    const instance = connector("J1", part, {
      pins: { 1: "SIG" },
      electrical: {
        1: { differential: { pair: "  ", polarity: "positive" } }
      }
    })
    const { hir, diagnostics } = compileSingle(instance)

    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: Codes.InvalidPinElectrical })
    )
    expect(hir.connectors[0]?.pins[0]?.electrical).toEqual({})
  })

  /** Pin semantics as a build without the type contract would hand them over. */
  interface ForeignRole {
    readonly role: string
    readonly protocol: string
  }
  const foreignRole: ForeignRole = { role: "generator", protocol: "CAN" }
  interface ForeignPolarity {
    readonly differential: { readonly pair: string; readonly polarity: string }
  }
  const foreignPolarity: ForeignPolarity = { differential: { pair: "CAN1", polarity: "+" } }

  it("rejects a runtime-invalid electrical role and preserves valid fields", () => {
    const instance = connector("J1", part, {
      pins: { 1: "SIG" },
      electrical: {
        // SAFETY: deliberately not a PinElectrical. The compiler's runtime
        // validation is under test and must reject this role with a diagnostic.
        1: foreignRole as PinElectrical
      }
    })
    const { hir, diagnostics } = compileSingle(instance)

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: Codes.InvalidPinElectrical,
        data: { field: "role" }
      })
    )
    expect(hir.connectors[0]?.pins[0]?.electrical).toEqual({ protocol: "CAN" })
    expect(decodeHir(JSON.parse(JSON.stringify(hir)))).toEqual(hir)
  })

  it("rejects a runtime-invalid differential polarity", () => {
    const instance = connector("J1", part, {
      pins: { 1: "SIG" },
      electrical: {
        // SAFETY: deliberately not a PinElectrical. The compiler's runtime
        // validation is under test and must reject this polarity with a diagnostic.
        1: foreignPolarity as PinElectrical
      }
    })
    const { hir, diagnostics } = compileSingle(instance)

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: Codes.InvalidPinElectrical,
        data: { field: "differential.polarity" }
      })
    )
    expect(hir.connectors[0]?.pins[0]?.electrical).toEqual({})
    expect(decodeHir(JSON.parse(JSON.stringify(hir)))).toEqual(hir)
  })
})

describe("analyzeElectricalConstraints", () => {
  it("detects multiple declared sources", () => {
    const analysis = analyzeElectricalConstraints(
      compilePair({ role: "source" }, { role: "source" }, "POWER")
    )
    expect(analysis.findings.map((item) => item.kind)).toEqual(["multiple-sources"])
    expect(analysis.findings[0]?.pins).toEqual([
      "connector:J1.pin:1",
      "connector:J2.pin:1"
    ])
  })

  it("detects an undriven sink but treats bidirectional pins as drivers", () => {
    expect(
      analyzeElectricalConstraints(
        compilePair({ role: "sink" }, { role: "passive" }, "LOAD")
      ).findings.map((item) => item.kind)
    ).toEqual(["undriven-load"])
    expect(
      analyzeElectricalConstraints(
        compilePair({ role: "sink" }, { role: "bidirectional" }, "LOAD")
      ).findings
    ).toEqual([])
  })

  it("does not prove an undriven load while any wired pin role is unknown", () => {
    for (const peerElectrical of [undefined, {}] as const) {
      const sink = connector("J1", part, {
        pins: { 1: "LOAD" },
        electrical: { 1: { role: "sink" } }
      })
      const peer = connector(
        "J2",
        part,
        peerElectrical !== undefined
          ? { pins: { 1: "LOAD" }, electrical: { 1: peerElectrical } }
          : { pins: { 1: "LOAD" } }
      )
      const hir = compileDesign(
        harness("unknown-role", {
          revision: "A",
          units: "mm",
          connectors: [sink, peer],
          wires: [wire("W1", sink.pin(1), peer.pin(1), { signal: "LOAD" })]
        })
      ).hir

      expect(
        analyzeElectricalConstraints(hir).findings.filter(
          (item) => item.kind === "undriven-load"
        )
      ).toEqual([])
    }
  })

  it("requires a source voltage range to fit wholly inside each sink range", () => {
    const analysis = analyzeElectricalConstraints(
      compilePair(
        { role: "source", voltage: { minV: 10, maxV: 13 } },
        { role: "sink", voltage: { minV: 11, maxV: 14 } },
        "POWER"
      )
    )
    expect(analysis.findings.map((item) => item.kind)).toEqual([
      "voltage-incompatible"
    ])
  })

  it("checks source voltage against ground and bidirectional port ranges", () => {
    const ground = analyzeElectricalConstraints(
      compilePair(
        { role: "source", voltage: { minV: 24, maxV: 24 } },
        { role: "ground", voltage: { minV: 0, maxV: 0 } },
        "POWER"
      )
    )
    const incompatibleBidirectional = analyzeElectricalConstraints(
      compilePair(
        { role: "source", voltage: { minV: 24, maxV: 24 } },
        { role: "bidirectional", voltage: { minV: 3, maxV: 5 } },
        "IO"
      )
    )
    const compatibleBidirectional = analyzeElectricalConstraints(
      compilePair(
        { role: "source", voltage: { minV: 4, maxV: 5 } },
        { role: "bidirectional", voltage: { minV: 3, maxV: 5 } },
        "IO"
      )
    )

    expect(ground.findings.map((item) => item.kind)).toEqual([
      "voltage-incompatible"
    ])
    expect(incompatibleBidirectional.findings.map((item) => item.kind)).toEqual([
      "voltage-incompatible"
    ])
    expect(compatibleBidirectional.findings).toEqual([])
  })

  it("detects disjoint complete ranges without a source", () => {
    const analysis = analyzeElectricalConstraints(
      compilePair(
        { role: "passive", voltage: { minV: 0, maxV: 5 } },
        { role: "bidirectional", voltage: { minV: 12, maxV: 24 } },
        "IO"
      )
    )

    expect(analysis.findings.map((item) => item.kind)).toEqual([
      "voltage-incompatible"
    ])
  })

  it("does not infer voltage incompatibility from incomplete ranges", () => {
    const analysis = analyzeElectricalConstraints(
      compilePair(
        { role: "source", voltage: { minV: 24 } },
        { role: "ground", voltage: { minV: 0, maxV: 0 } },
        "POWER"
      )
    )

    expect(analysis.findings).toEqual([])
  })

  it("detects distinct declared protocols", () => {
    const analysis = analyzeElectricalConstraints(
      compilePair({ protocol: "CAN" }, { protocol: "LIN" }, "DATA")
    )
    expect(analysis.findings.map((item) => item.kind)).toEqual([
      "protocol-mismatch"
    ])
  })

  it("detects conflicting differential pair names or polarities", () => {
    const pairNames = analyzeElectricalConstraints(
      compilePair(
        { differential: { pair: "CAN", polarity: "positive" } },
        { differential: { pair: "RS485", polarity: "positive" } },
        "DATA"
      )
    )
    const polarities = analyzeElectricalConstraints(
      compilePair(
        { differential: { pair: "CAN", polarity: "positive" } },
        { differential: { pair: "CAN", polarity: "negative" } },
        "DATA"
      )
    )
    expect(pairNames.findings.map((item) => item.kind)).toEqual([
      "differential-conflict"
    ])
    expect(polarities.findings.map((item) => item.kind)).toEqual([
      "differential-conflict"
    ])
  })

  it("detects definitely-known current overload despite an unknown sink", () => {
    const source = connector("J1", part, {
      pins: { 1: "POWER" },
      electrical: { 1: { role: "source", currentA: 1 } }
    })
    const knownSink = connector("J2", part, {
      pins: { 1: "POWER" },
      electrical: { 1: { role: "sink", currentA: 1.25 } }
    })
    const unknownSink = connector("J3", part, {
      pins: { 1: "POWER" },
      electrical: { 1: { role: "sink" } }
    })
    const hir = compileDesign(
      harness("overload", {
        revision: "A",
        units: "mm",
        connectors: [source, knownSink, unknownSink],
        wires: [
          wire("W1", source.pin(1), knownSink.pin(1), { signal: "POWER" }),
          wire("W2", knownSink.pin(1), unknownSink.pin(1), { signal: "POWER" })
        ]
      })
    ).hir
    const analysis = analyzeElectricalConstraints(hir)

    expect(analysis.findings.map((item) => item.kind)).toEqual([
      "source-current-exceeded"
    ])
    expect(analysis.findings[0]?.data).toEqual({ capacityA: 1, demandA: 1.25 })
  })

  it("keeps the source as the primary voltage and current finding anchor", () => {
    const source = connector("Z1", part, {
      pins: { 1: "POWER" },
      electrical: {
        1: {
          role: "source",
          voltage: { minV: 24, maxV: 24 },
          currentA: 1
        }
      }
    })
    const sink = connector("A1", part, {
      pins: { 1: "POWER" },
      electrical: {
        1: {
          role: "sink",
          voltage: { minV: 0, maxV: 5 },
          currentA: 2
        }
      }
    })
    const hir = compileDesign(
      harness("primary-source", {
        revision: "A",
        units: "mm",
        connectors: [sink, source],
        wires: [wire("W1", sink.pin(1), source.pin(1), { signal: "POWER" })]
      })
    ).hir
    const findings = analyzeElectricalConstraints(hir).findings

    expect(findings.find((item) => item.kind === "voltage-incompatible")?.pins).toEqual([
      "connector:Z1.pin:1",
      "connector:A1.pin:1"
    ])
    expect(findings.find((item) => item.kind === "source-current-exceeded")?.pins).toEqual([
      "connector:Z1.pin:1",
      "connector:A1.pin:1"
    ])
  })

  it("skips conclusions that depend on unknown facts and ignores unwired pins", () => {
    const left = connector("J1", part, {
      pins: { 1: "SIG", 2: "UNWIRED" },
      electrical: {
        1: { role: "source", voltage: { minV: 5 } },
        2: { role: "source", protocol: "CAN" }
      }
    })
    const right = connector("J2", part, {
      pins: { 1: "SIG" },
      electrical: { 1: { role: "sink", voltage: { minV: 10, maxV: 12 } } }
    })
    const hir = compileDesign(
      harness("unknowns", {
        revision: "A",
        units: "mm",
        connectors: [left, right],
        wires: [wire("W1", left.pin(1), right.pin(1), { signal: "SIG" })]
      })
    ).hir
    const analysis = analyzeElectricalConstraints(hir)

    expect(analysis.findings).toEqual([])
    expect(analysis.nets).toHaveLength(1)
    expect(analysis.nets[0]?.pins.map((pin) => pin.ref)).toEqual([
      "connector:J1.pin:1",
      "connector:J2.pin:1"
    ])
  })

  it("returns canonical output regardless of authoring order", () => {
    const j1 = connector("J1", part, {
      pins: { 1: "DATA" },
      electrical: { 1: { role: "source", protocol: "CAN" } }
    })
    const j2 = connector("J2", part, {
      pins: { 1: "DATA" },
      electrical: { 1: { role: "source", protocol: "LIN" } }
    })
    const make = (reverse: boolean): Hir =>
      compileDesign(
        harness("ordering", {
          revision: "A",
          units: "mm",
          connectors: reverse ? [j2, j1] : [j1, j2],
          wires: [
            wire(
              "W1",
              reverse ? j2.pin(1) : j1.pin(1),
              reverse ? j1.pin(1) : j2.pin(1),
              { signal: "DATA" }
            )
          ]
        })
      ).hir

    expect(analyzeElectricalConstraints(make(true))).toEqual(
      analyzeElectricalConstraints(make(false))
    )
  })
})

describe("RuleContext.electrical", () => {
  it("shares one lazily cached analysis across rules", () => {
    const hir = compilePair({ role: "source" }, { role: "source" })
    let first: ReturnType<typeof analyzeElectricalConstraints> | undefined
    const capture = rule("capture-electrical", (ctx) => {
      first = ctx.electrical
    })
    const compare = rule("compare-electrical", (ctx) => {
      if (ctx.electrical === first) {
        ctx.report({ severity: "info", message: "shared analysis" })
      }
    })

    expect(runRules(hir, [capture, compare]).map((item) => item.message)).toEqual([
      "shared analysis"
    ])
  })
})

/**
 * Margins: the continuous channel the built-in rules emit alongside findings.
 *
 * The property under test is not "does the rule fail correctly" — the other
 * suites own that — but "does a PASSING design still say how close it is".
 * A margin that only shows up on failure is a finding with extra steps.
 *
 * vitest 4.1.10 (root devDependency; `bunx vitest --version` agrees).
 */
import { describe, expect, it } from "vitest"
import {
  branch,
  compileDesign,
  connector,
  harness,
  protection,
  runRules,
  runRulesWithMargins,
  wire,
  type ConnectorPart,
  type Hir,
  type Rule
} from "@grayhaven/nerve"
import {
  AMPACITY_BY_AWG,
  breakoutTighterThanBendRadius,
  bundleOverSleeveCapacity,
  cableConductorOverflow,
  connectorCurrentExceeded,
  connectorVoltageExceeded,
  contactCountExceedsPinCount,
  gaugeCurrentMismatch,
  gaugeOutsideConnectorRange,
  missingWireColor,
  missingWireGauge,
  overcurrentExceedsConductor,
  sourceCurrentExceeded,
  twistGroupTooSmall,
  uncoveredNet,
  unconnectedAssignedPin,
  voltageRatingBelowSignal,
  wireTempBelowAmbient
} from "@grayhaven/nerve-rules"
import design from "../../../examples/motor-controller/src/main.harness.js"

/** Every rule in `rules.ts` that takes a measurement. */
const instrumented: ReadonlyArray<Rule> = [
  gaugeCurrentMismatch,
  connectorCurrentExceeded,
  connectorVoltageExceeded,
  voltageRatingBelowSignal,
  breakoutTighterThanBendRadius,
  bundleOverSleeveCapacity,
  wireTempBelowAmbient,
  overcurrentExceedsConductor,
  sourceCurrentExceeded
]

const part: ConnectorPart = {
  mpn: "MARGIN-4",
  pinCount: 4,
  currentLimitA: 10,
  voltageLimitV: 48
}

const j1 = connector("J1", part, { pins: { 1: "VBAT_24V", 2: "GND" } })
const j2 = connector("J2", part, { pins: { 1: "VBAT_24V", 2: "GND" } })

const AMPACITY_16AWG = AMPACITY_BY_AWG[16]!

/** One 16AWG power wire carrying `currentEstimate` amps, nothing else. */
const wireCarrying = (
  props: Parameters<typeof wire>[3]
): Hir =>
  compileDesign(
    harness("margin-fixture", {
      revision: "A",
      units: "mm",
      connectors: [j1, j2],
      wires: [
        wire("W1", j1.pin(1), j2.pin(1), {
          color: "red",
          length: 250,
          signal: "VBAT_24V",
          ...props
        })
      ]
    })
  ).hir

const conductorCurrent = (hir: Hir) =>
  runRulesWithMargins(hir, [gaugeCurrentMismatch]).margins

describe("a passing design still reports its margin", () => {
  it("emits a full margin for a wire well inside its ampacity", () => {
    const measured = AMPACITY_16AWG * 0.4
    const { diagnostics, margins } = runRulesWithMargins(
      wireCarrying({ gauge: "16AWG", currentEstimate: measured }),
      [gaugeCurrentMismatch]
    )

    expect(diagnostics).toEqual([])
    expect(margins).toEqual([
      {
        code: "HK-WIRE-004",
        target: "wire:W1",
        quantity: "conductor current",
        measured,
        limit: AMPACITY_16AWG,
        unit: "A",
        utilization: measured / AMPACITY_16AWG,
        margin: 1 - measured / AMPACITY_16AWG
      }
    ])
  })

  it("separates 40% from 99% of the same limit, both passing", () => {
    const relaxed = conductorCurrent(
      wireCarrying({ gauge: "16AWG", currentEstimate: AMPACITY_16AWG * 0.4 })
    )
    const marginal = conductorCurrent(
      wireCarrying({ gauge: "16AWG", currentEstimate: AMPACITY_16AWG * 0.99 })
    )

    expect(relaxed[0]!.utilization).toBeCloseTo(0.4, 10)
    expect(marginal[0]!.utilization).toBeCloseTo(0.99, 10)
    expect(marginal[0]!.utilization).toBeGreaterThan(relaxed[0]!.utilization)
    // The whole point: a boolean verifier cannot tell these two apart.
    expect(
      runRules(
        wireCarrying({ gauge: "16AWG", currentEstimate: AMPACITY_16AWG * 0.99 }),
        [gaugeCurrentMismatch]
      )
    ).toEqual([])
  })

  it("keeps the golden example measurable even though it passes", () => {
    const { hir } = compileDesign(design)
    const { diagnostics, margins } = runRulesWithMargins(hir, instrumented)

    expect(diagnostics).toEqual([])
    expect(margins.length).toBeGreaterThan(0)
    expect(margins.every((m) => m.utilization < 1)).toBe(true)
  })
})

describe("an over-budget design reports both channels", () => {
  const hir = wireCarrying({ gauge: "16AWG", currentEstimate: AMPACITY_16AWG * 1.5 })
  const { diagnostics, margins } = runRulesWithMargins(hir, [gaugeCurrentMismatch])

  it("still fails", () => {
    expect(diagnostics.map((d) => d.code)).toEqual(["HK-WIRE-004"])
  })

  it("and says by how much", () => {
    expect(margins).toHaveLength(1)
    expect(margins[0]!.utilization).toBeCloseTo(1.5, 10)
    expect(margins[0]!.margin).toBeCloseTo(-0.5, 10)
  })
})

describe("absent inputs produce no measurement", () => {
  it("no declared current: no margin, not a zero", () => {
    expect(conductorCurrent(wireCarrying({ gauge: "16AWG" }))).toEqual([])
  })

  it("no gauge: no margin, no substituted default limit", () => {
    expect(conductorCurrent(wireCarrying({ currentEstimate: 3 }))).toEqual([])
  })

  it("a gauge off the ampacity table: no fabricated limit", () => {
    expect(
      conductorCurrent(wireCarrying({ gauge: "0.5mm2", currentEstimate: 3 }))
    ).toEqual([])
  })

  it("a branch ambient with no wire temperature rating: nothing to divide by", () => {
    const hir = compileDesign(
      harness("no-temp-rating", {
        revision: "A",
        units: "mm",
        connectors: [j1, j2],
        wires: [
          wire("W1", j1.pin(1), j2.pin(1), {
            gauge: "16AWG",
            color: "red",
            length: 250,
            signal: "VBAT_24V"
          })
        ],
        branches: [branch("main", { path: [j1, j2], ambientTemperatureC: 85 })]
      })
    ).hir

    expect(runRulesWithMargins(hir, [wireTempBelowAmbient]).margins).toEqual([])
  })

  it("sinks that declare no current are unknown demand, not zero demand", () => {
    const source = connector("J1", part, {
      pins: { 1: "VBAT_24V" },
      electrical: { 1: { role: "source", currentA: 10 } }
    })
    const sink = connector("J2", part, {
      pins: { 1: "VBAT_24V" },
      electrical: { 1: { role: "sink" } }
    })
    const hir = compileDesign(
      harness("unknown-demand", {
        revision: "A",
        units: "mm",
        connectors: [source, sink],
        wires: [
          wire("W1", source.pin(1), sink.pin(1), {
            gauge: "16AWG",
            color: "red",
            length: 250,
            signal: "VBAT_24V"
          })
        ]
      })
    ).hir

    expect(runRulesWithMargins(hir, [sourceCurrentExceeded]).margins).toEqual([])
  })
})

describe("discrete rules stay out of the margin channel", () => {
  it("contributes nothing, however loudly it fails", () => {
    const discrete: ReadonlyArray<Rule> = [
      missingWireColor,
      missingWireGauge,
      gaugeOutsideConnectorRange,
      contactCountExceedsPinCount,
      cableConductorOverflow,
      uncoveredNet,
      twistGroupTooSmall,
      unconnectedAssignedPin
    ]
    const hir = compileDesign(
      harness("discrete-fixture", {
        revision: "A",
        units: "mm",
        connectors: [j1, j2],
        wires: [
          wire("W1", j1.pin(1), j2.pin(1), { length: 250, signal: "VBAT_24V" }),
          wire("W2", j1.pin(2), j2.pin(2), {
            length: 250,
            signal: "GND",
            twistGroup: "T1"
          })
        ]
      })
    ).hir
    const { diagnostics, margins } = runRulesWithMargins(hir, discrete)

    // A count, an identity, or a compatibility list has no gradient: an
    // invented denominator would give an optimizer a slope to follow into
    // a worse design.
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(margins).toEqual([])
  })
})

/**
 * A design that passes every instrumented rule while exercising all nine of
 * them — the case that proves measurement is not gated on failure.
 */
const passingRich = (): Hir => {
  const source = connector("J1", { ...part, pinCount: 8, currentLimitA: 13, voltageLimitV: 60 }, {
    pins: { 1: "VBAT_24V", 2: "GND" },
    electrical: { 1: { role: "source", currentA: 10 } }
  })
  const sink = connector("J2", { ...part, pinCount: 8, currentLimitA: 13, voltageLimitV: 60 }, {
    pins: { 1: "VBAT_24V", 2: "GND" },
    electrical: { 1: { role: "sink", currentA: 4 } }
  })
  return compileDesign(
    harness("margin-rich", {
      revision: "A",
      units: "mm",
      connectors: [source, sink],
      wires: [
        wire("W1", source.pin(1), sink.pin(1), {
          gauge: "16AWG",
          color: "red",
          length: 400,
          signal: "VBAT_24V",
          currentEstimate: 4,
          voltageRating: 60,
          temperatureRating: 105
        }),
        wire("W2", source.pin(2), sink.pin(2), {
          gauge: "18AWG",
          color: "black",
          length: 400,
          signal: "GND",
          currentEstimate: 4,
          temperatureRating: 105
        })
      ],
      branches: [
        branch("main", {
          path: [source, sink],
          sleeve: "braided-pet-12",
          breakoutDistance: 40,
          minBendRadius: 25,
          ambientTemperatureC: 85
        })
      ],
      protections: [protection("F1", { kind: "fuse", ratingA: 7.5, protects: ["W1"] })]
    })
  ).hir
}

describe("the whole instrumented set on a passing design", () => {
  const { diagnostics, margins } = runRulesWithMargins(passingRich(), instrumented)

  it("reports no findings at all", () => {
    expect(diagnostics).toEqual([])
  })

  it("still measures every continuous quantity", () => {
    expect([...new Set(margins.map((m) => m.quantity))].sort()).toEqual([
      "bend radius",
      "conductor current",
      "conductor temperature",
      "contact current",
      "contact voltage",
      "insulation voltage",
      "overcurrent rating",
      "sleeve fill",
      "source current"
    ])
  })

  it("holds the margin invariants on every emission", () => {
    for (const m of margins) {
      expect(Number.isFinite(m.measured)).toBe(true)
      expect(m.limit).toBeGreaterThan(0)
      expect(m.unit).not.toBe("")
      expect(m.quantity).not.toBe("")
      expect(m.code).not.toBe("")
      expect(m.target).not.toBe("")
      expect(m.utilization).toBe(m.measured / m.limit)
      expect(m.margin).toBe(1 - m.utilization)
    }
  })

  it("is deterministic across runs of the same HIR", () => {
    const hir = passingRich()
    expect(runRulesWithMargins(hir, instrumented).margins).toEqual(
      runRulesWithMargins(hir, instrumented).margins
    )
    // And across two separately compiled but identical designs.
    expect(runRulesWithMargins(passingRich(), instrumented).margins).toEqual(margins)
  })
})

describe("findings are untouched by the measurement channel", () => {
  it("keeps message, target, targets, and data byte-identical", () => {
    const hir = wireCarrying({ gauge: "22AWG", currentEstimate: 12 })

    expect(runRules(hir, [gaugeCurrentMismatch, connectorCurrentExceeded])).toEqual([
      {
        code: "HK-CONN-016",
        severity: "error",
        message:
          "Wire W1 estimates 12A but connector J1 (MARGIN-4) contacts are rated 10A.",
        target: "connector:J1.pin:1",
        targets: ["wire:W1"],
        data: { currentEstimateA: 12, currentLimitA: 10 }
      },
      {
        code: "HK-CONN-016",
        severity: "error",
        message:
          "Wire W1 estimates 12A but connector J2 (MARGIN-4) contacts are rated 10A.",
        target: "connector:J2.pin:1",
        targets: ["wire:W1"],
        data: { currentEstimateA: 12, currentLimitA: 10 }
      },
      {
        code: "HK-WIRE-004",
        severity: "error",
        message: "Wire W1 uses 22AWG but its 12A estimate requires at least 14AWG.",
        target: "wire:W1",
        data: {
          gauge: "22AWG",
          currentEstimateA: 12,
          ampacityA: AMPACITY_BY_AWG[22]!,
          requiredGauge: "14AWG"
        }
      }
    ])
  })

  it("leaves runRules identical to the diagnostics half of runRulesWithMargins", () => {
    const hir = passingRich()
    expect(runRules(hir, instrumented)).toEqual(
      runRulesWithMargins(hir, instrumented).diagnostics
    )
  })
})

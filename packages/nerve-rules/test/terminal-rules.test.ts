/**
 * The contact, not the housing — and the conductors that actually carry
 * current, not the wires that happen to be in the sleeve.
 *
 * Two changes are under test here, and both have the same shape: a rule that
 * had to substitute a number it could reach for the number it meant. HK-MFG-004
 * and HK-CONN-016 judged a wire against the housing because the terminal was an
 * MPN string with nothing behind it, and HK-WIRE-004 derated by a wire count
 * because "current-carrying conductor" was not a thing the model would answer.
 * A substitute limit fails in the direction that matters: a wire inside the
 * housing's span and outside its fitted contact's passes, and a bundle of
 * signal wires derates a real conductor it never heated.
 *
 * So most of what is asserted below is not "does it fail" but "does it fail
 * against the right number, and does it say which number that was" — a
 * diagnostic naming the housing when it judged the contact would send a
 * reviewer to the wrong page of the drawing.
 *
 * vitest 4.1.10 (root devDependency `^4.1.10`; `node_modules/vitest` agrees).
 * `toEqual` is deep recursive structural equality and `toMatchObject` a subset
 * match — confirmed against the v4.1.6 expect API docs via Context7
 * (/vitest-dev/vitest/v4.1.6, docs/api/expect.md).
 */
import { describe, expect, it } from "vitest"
import {
  branch,
  compileDesign,
  connector,
  harness,
  runRules,
  runRulesWithMargins,
  wire,
  type ConnectorPart,
  type HarnessDesign,
  type Hir
} from "@grayhaven/nerve"
import { builtinRules, connectorCurrentExceeded, gaugeCurrentMismatch } from "@grayhaven/nerve-rules"
// Relative: the two new rules ship inside `builtinRules` but the package index
// is owned elsewhere, so they are imported from the module that defines them.
import {
  gaugeOutsideConnectorRange,
  insulationOutsideSealRange,
  insulationOutsideTerminalRange
} from "../src/rules.js"
import { AMPACITY_BY_AWG, isCurrentCarrying } from "../src/wire-data.js"
import motorController from "../../../examples/motor-controller/src/main.harness.js"
import sensorSplice from "../../../examples/sensor-splice/src/main.harness.js"
import robotPlatform from "../../../examples/robot-platform/src/main.harness.js"

const compile = (d: HarnessDesign): Hir => {
  const { hir, diagnostics } = compileDesign(d)
  // A fixture that does not compile cleanly would make every assertion below a
  // statement about the compiler rather than about the rule.
  expect(diagnostics.filter((x) => x.severity === "error")).toEqual([])
  return hir
}

// --- HK-MFG-004: the terminal's range, or the housing's --------------------

/**
 * A housing family spanning 24AWG to 16AWG. Nothing about this is unusual —
 * the range covers every contact series the family sells, which is exactly why
 * it cannot stand in for the one that was fitted.
 */
const housing: ConnectorPart = {
  mpn: "HSG-2",
  pinCount: 2,
  wireGaugeRange: { min: "24AWG", max: "16AWG" }
}

/** A contact series inside that housing that only crimps 20AWG to 18AWG. */
const narrowContact = {
  mpn: "CT-2018",
  wireGaugeRange: { min: "20AWG", max: "18AWG" }
}

/** `terminals` on J1 only: J2 is the same wire landing in the same housing
 * with no contact record, so one fixture exercises both paths. */
const gaugeFixture = (gauge: string, opts: { terminal: boolean }): Hir => {
  const a = connector("J1", housing, {
    pins: { 1: "VBAT_24V", 2: "GND" },
    ...(opts.terminal ? { terminals: { 1: narrowContact, 2: narrowContact } } : {})
  })
  const b = connector("J2", housing, { pins: { 1: "VBAT_24V", 2: "GND" } })
  return compile(
    harness("gauge-fixture", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      wires: [
        wire("W1", a.pin(1), b.pin(1), { gauge, color: "red", length: 100, signal: "VBAT_24V" })
      ]
    })
  )
}

describe("HK-MFG-004 judges the contact when the design fitted one", () => {
  it("catches a wire inside the housing range and outside its terminal's", () => {
    // 22AWG is comfortably inside 24..16, and outside 20..18.
    const diags = runRules(gaugeFixture("22AWG", { terminal: true }), [gaugeOutsideConnectorRange])

    // Exactly one: J1 has the contact record, J2 falls back to the housing
    // range and passes — the same wire, judged twice, on two authorities.
    expect(diags).toEqual([
      {
        code: "HK-MFG-004",
        severity: "error",
        message:
          "Wire W1 uses 22AWG but terminal CT-2018 at J1.1 accepts 18AWG to 20AWG.",
        target: "connector:J1.pin:1",
        data: {
          gauge: "22AWG",
          rangeSource: "terminal",
          terminal: "CT-2018",
          acceptsMin: "20AWG",
          acceptsMax: "18AWG"
        }
      }
    ])
  })

  it("passes the identical wire when no terminal record exists", () => {
    expect(runRules(gaugeFixture("22AWG", { terminal: false }), [gaugeOutsideConnectorRange]))
      .toEqual([])
  })

  it("keeps the housing wording, byte for byte, on the fallback path", () => {
    // 14AWG is outside the housing range itself, so both ends fire and both
    // read exactly as they did before terminals were modelled.
    const diags = runRules(gaugeFixture("14AWG", { terminal: false }), [gaugeOutsideConnectorRange])
    expect(diags.map((d) => d.message)).toEqual([
      "Wire W1 uses 14AWG but connector J1 accepts 16AWG to 24AWG.",
      "Wire W1 uses 14AWG but connector J2 accepts 16AWG to 24AWG."
    ])
    // No `data` key at all on the housing path: the finding is the object it
    // has always been.
    expect(diags.every((d) => d.data === undefined)).toBe(true)
  })

  it("distinguishes a terminal judgment from a housing judgment in the message", () => {
    const byTerminal = runRules(gaugeFixture("14AWG", { terminal: true }), [
      gaugeOutsideConnectorRange
    ])
    // Same wire, same housing, both ends failing — and the two findings name
    // different authorities because they ARE different claims.
    expect(byTerminal.map((d) => d.message)).toEqual([
      "Wire W1 uses 14AWG but terminal CT-2018 at J1.1 accepts 18AWG to 20AWG.",
      "Wire W1 uses 14AWG but connector J2 accepts 16AWG to 24AWG."
    ])
    expect(byTerminal[0]?.data?.rangeSource).toBe("terminal")
    expect(byTerminal[1]?.data).toBeUndefined()
  })

  it("falls back when the terminal record states no gauge range", () => {
    // A record is not a range. A contact that makes no claim about gauge
    // leaves the housing as the only authority there is, which is strictly
    // more checking than falling silent.
    const a = connector("J1", housing, {
      pins: { 1: "VBAT_24V" },
      terminals: { 1: { mpn: "CT-NORANGE" } }
    })
    const b = connector("J2", housing, { pins: { 1: "VBAT_24V" } })
    const hir = compile(
      harness("no-range", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [
          wire("W1", a.pin(1), b.pin(1), {
            gauge: "14AWG",
            color: "red",
            length: 100,
            signal: "VBAT_24V"
          })
        ]
      })
    )
    expect(runRules(hir, [gaugeOutsideConnectorRange]).map((d) => d.message)).toEqual([
      "Wire W1 uses 14AWG but connector J1 accepts 16AWG to 24AWG.",
      "Wire W1 uses 14AWG but connector J2 accepts 16AWG to 24AWG."
    ])
  })
})

// --- HK-MFG-012 / HK-MFG-013: insulation OD against the parts that grip it ---

const sealedHousing: ConnectorPart = { ...housing, mpn: "HSG-SEALED-2", sealed: true }

/** Contact with an insulation-barrel window, and a cavity seal with a bore. */
const barrelContact = {
  mpn: "CT-BARREL",
  wireGaugeRange: { min: "24AWG", max: "16AWG" },
  insulationDiameterRange: { min: 1.2, max: 1.8 }
}
const cavitySeal = { mpn: "SL-BORE", insulationDiameterRange: { min: 1.4, max: 2.0 } }

const odFixture = (outerDiameter: number | undefined): Hir => {
  const a = connector("J1", sealedHousing, {
    pins: { 1: "VBAT_24V" },
    terminals: { 1: barrelContact },
    seals: { 1: cavitySeal }
  })
  const b = connector("J2", housing, { pins: { 1: "VBAT_24V" } })
  return compile(
    harness("od-fixture", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      wires: [
        wire("W1", a.pin(1), b.pin(1), {
          part: {
            mpn: "WIRE-20-PVC",
            gauge: "20AWG",
            ...(outerDiameter !== undefined ? { outerDiameter } : {})
          },
          gauge: "20AWG",
          color: "red",
          length: 100,
          signal: "VBAT_24V"
        })
      ]
    })
  )
}

describe("HK-MFG-012 checks insulation OD against the crimp barrel", () => {
  it("passes a wire inside the barrel window", () => {
    expect(runRules(odFixture(1.6), [insulationOutsideTerminalRange])).toEqual([])
  })

  it("fails a wire too thick to enter the barrel", () => {
    expect(runRules(odFixture(2.1), [insulationOutsideTerminalRange])).toEqual([
      {
        code: "HK-MFG-012",
        severity: "error",
        message: "Wire W1 insulation is 2.1mm but terminal CT-BARREL at J1.1 grips 1.2mm to 1.8mm.",
        target: "connector:J1.pin:1",
        targets: ["wire:W1"],
        data: {
          insulationDiameterMm: 2.1,
          terminal: "CT-BARREL",
          rangeMinMm: 1.2,
          rangeMaxMm: 1.8
        }
      }
    ])
  })

  it("fails a wire too thin for the barrel to hold — the strain-relief end", () => {
    const diags = runRules(odFixture(0.9), [insulationOutsideTerminalRange])
    expect(diags.map((d) => d.code)).toEqual(["HK-MFG-012"])
    expect(diags[0]?.message).toContain("insulation is 0.9mm")
  })

  it("skips a wire whose insulation OD is not modelled rather than guessing it", () => {
    // 20AWG has an entry in INSULATED_OD_MM_BY_AWG (2.1mm, which would fail
    // this barrel). That table is typical PVC hookup wire — honest enough to
    // aggregate for a sleeve-fill estimate, not to fail a named part against a
    // 0.6mm-wide window. An undeclared OD is unknown, so nothing is reported.
    expect(runRules(odFixture(undefined), [insulationOutsideTerminalRange])).toEqual([])
  })
})

describe("HK-MFG-013 checks insulation OD against the cavity seal", () => {
  it("passes a wire inside the seal's bore range", () => {
    expect(runRules(odFixture(1.6), [insulationOutsideSealRange])).toEqual([])
  })

  it("fails a wire the seal cannot close on", () => {
    expect(runRules(odFixture(2.1), [insulationOutsideSealRange])).toEqual([
      {
        code: "HK-MFG-013",
        severity: "error",
        message: "Wire W1 insulation is 2.1mm but seal SL-BORE at J1.1 seals 1.4mm to 2mm.",
        target: "connector:J1.pin:1",
        targets: ["wire:W1"],
        data: {
          insulationDiameterMm: 2.1,
          seal: "SL-BORE",
          rangeMinMm: 1.4,
          rangeMaxMm: 2.0
        }
      }
    ])
  })

  it("separates the two windows: 1.3mm grips but does not seal", () => {
    // The reason these are two codes. The contact is happy and the connector's
    // IP rating is void, and one wire can be in exactly that state.
    expect(runRules(odFixture(1.3), [insulationOutsideTerminalRange])).toEqual([])
    expect(runRules(odFixture(1.3), [insulationOutsideSealRange]).map((d) => d.code)).toEqual([
      "HK-MFG-013"
    ])
  })

  it("skips a wire with no modelled insulation OD", () => {
    expect(runRules(odFixture(undefined), [insulationOutsideSealRange])).toEqual([])
  })
})

// --- Margins -----------------------------------------------------------------

const ratedContact = { mpn: "CT-RATED", currentRatingA: 4 }

const currentFixture = (opts: { terminal: boolean }): Hir => {
  const part: ConnectorPart = { ...housing, mpn: "HSG-RATED-2", currentLimitA: 10 }
  const a = connector("J1", part, {
    pins: { 1: "VBAT_24V" },
    ...(opts.terminal ? { terminals: { 1: ratedContact } } : {})
  })
  const b = connector("J2", part, { pins: { 1: "VBAT_24V" } })
  return compile(
    harness("current-fixture", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      wires: [
        wire("W1", a.pin(1), b.pin(1), {
          gauge: "18AWG",
          color: "red",
          length: 100,
          signal: "VBAT_24V",
          currentEstimate: 5
        })
      ]
    })
  )
}

describe("HK-CONN-016 margins follow the limit the finding used", () => {
  it("measures against the fitted contact's rating when there is one", () => {
    const { diagnostics, margins } = runRulesWithMargins(currentFixture({ terminal: true }), [
      connectorCurrentExceeded
    ])
    const j1 = margins.find((m) => m.target === "connector:J1.pin:1")!
    expect(j1).toMatchObject({
      code: "HK-CONN-016",
      quantity: "contact current",
      measured: 5,
      limit: 4,
      unit: "A"
    })
    expect(j1.utilization).toBeGreaterThan(1)
    // J2 has no contact record and keeps the housing's 10A.
    expect(margins.find((m) => m.target === "connector:J2.pin:1")?.limit).toBe(10)

    // The finding and the margin cannot disagree about the number.
    const finding = diagnostics.find((d) => d.target === "connector:J1.pin:1")
    expect(finding?.message).toBe(
      "Wire W1 estimates 5A but terminal CT-RATED at J1.1 is rated 4A."
    )
    expect(finding?.data?.currentLimitA).toBe(j1.limit)
    expect(finding?.data?.limitSource).toBe("terminal")
  })

  it("measures against the housing when no contact record exists", () => {
    const { diagnostics, margins } = runRulesWithMargins(currentFixture({ terminal: false }), [
      connectorCurrentExceeded
    ])
    expect(diagnostics).toEqual([])
    expect(margins.map((m) => m.limit)).toEqual([10, 10])
    expect(margins.every((m) => m.utilization < 1)).toBe(true)
  })
})

describe("the range rules stay out of the margin channel", () => {
  it("emits no margin for a gauge or an insulation window, however it fails", () => {
    const rules = [
      gaugeOutsideConnectorRange,
      insulationOutsideTerminalRange,
      insulationOutsideSealRange
    ]
    const gauge = runRulesWithMargins(gaugeFixture("22AWG", { terminal: true }), rules)
    const od = runRulesWithMargins(odFixture(2.1), rules)

    expect(gauge.diagnostics.length).toBeGreaterThan(0)
    expect(od.diagnostics.length).toBeGreaterThan(0)
    // AWG is an inverted logarithmic scale, so a ratio of gauge numbers is not
    // a physical quantity; an insulation window is two-sided, so a ratio
    // against its upper bound would read as slack on a wire failing the lower
    // one. Both would hand an optimizer a slope pointing away from the fix.
    expect(gauge.margins).toEqual([])
    expect(od.margins).toEqual([])
  })
})

// --- HK-WIRE-004: what counts as a current-carrying conductor ----------------

const AMP_20 = AMPACITY_BY_AWG[20]!

/**
 * A bundle of `loaded` power conductors plus `extra` more, straddling the
 * 6→7 conductor band boundary (0.7× below seven, 0.6× from seven).
 *
 * `HirWire.branch` is the bundle association the derating counts and today's
 * DSL does not populate it, so the fixture writes it onto compiled HIR — HIR
 * is the rules' input contract, which is exactly what a rule sees in
 * production.
 */
const straddle = (
  loaded: number,
  extra: ReadonlyArray<{ readonly gauge: string; readonly currentEstimate?: number }>
): Hir => {
  const count = loaded + extra.length
  const a = connector("J1", { mpn: "BND-A", pinCount: count }, {
    pins: Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, `NET_${i + 1}`]))
  })
  const b = connector("J2", { mpn: "BND-B", pinCount: count }, {
    pins: Object.fromEntries(Array.from({ length: count }, (_, i) => [i + 1, `NET_${i + 1}`]))
  })
  const hir = compile(
    harness("straddle", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      wires: [
        // W01 is the conductor under test: 2.4A on 20AWG clears 0.7× (2.59A)
        // and does not clear 0.6× (2.22A).
        ...Array.from({ length: loaded }, (_, i) =>
          wire(`W${String(i + 1).padStart(2, "0")}`, a.pin(i + 1), b.pin(i + 1), {
            gauge: "20AWG",
            color: "red",
            length: 100,
            signal: `NET_${i + 1}`,
            currentEstimate: 2.4
          })
        ),
        ...extra.map((e, i) =>
          wire(`X${String(i + 1).padStart(2, "0")}`, a.pin(loaded + i + 1), b.pin(loaded + i + 1), {
            gauge: e.gauge,
            color: "white",
            length: 100,
            signal: `NET_${loaded + i + 1}`,
            ...(e.currentEstimate !== undefined ? { currentEstimate: e.currentEstimate } : {})
          })
        )
      ],
      branches: [branch("main", { path: [a, b], nominalLength: 100 })]
    })
  )
  return { ...hir, wires: hir.wires.map((w) => ({ ...w, branch: "main" })) }
}

/** Two 26AWG encoder lines drawing 20mA — 2.5% of what 26AWG is rated for. */
const ENCODER_PAIR = [
  { gauge: "26AWG", currentEstimate: 0.02 },
  { gauge: "26AWG", currentEstimate: 0.02 }
] as const

const limitOfW01 = (hir: Hir): number =>
  runRulesWithMargins(hir, [gaugeCurrentMismatch]).margins.find((m) => m.target === "wire:W01")!
    .limit

describe("HK-WIRE-004 derates by current-carrying conductors", () => {
  it("moves a bundle across a band boundary when signal wires stop counting", () => {
    const withSignals = straddle(6, ENCODER_PAIR) // 8 wires, 6 conductors
    const allLoaded = straddle(8, []) // 8 wires, 8 conductors

    // Same eight wires in the same sleeve, same copper on W01 — and the two
    // bundles land on different sides of the seven-conductor threshold.
    expect(withSignals.wires).toHaveLength(8)
    expect(allLoaded.wires).toHaveLength(8)
    expect(limitOfW01(withSignals)).toBeCloseTo(AMP_20 * 0.7, 10)
    expect(limitOfW01(allLoaded)).toBeCloseTo(AMP_20 * 0.6, 10)

    // And the verdict follows the count, which is the whole point.
    expect(runRules(withSignals, [gaugeCurrentMismatch])).toEqual([])
    const failed = runRules(allLoaded, [gaugeCurrentMismatch])
    expect(failed.map((d) => d.code)).toEqual(Array(8).fill("HK-WIRE-004"))
    expect(failed[0]?.data).toMatchObject({ bundleConductors: 8, deratingFactor: 0.6 })
  })

  it("treats an undeclared current as unknown, not as zero", () => {
    // The dangerous direction. These two fixtures differ only in whether the
    // two extra wires declare a tiny current or declare nothing at all; if
    // absence were read as zero they would derate identically.
    const declaredNegligible = straddle(6, ENCODER_PAIR)
    const undeclared = straddle(6, [{ gauge: "26AWG" }, { gauge: "26AWG" }])

    expect(limitOfW01(declaredNegligible)).toBeCloseTo(AMP_20 * 0.7, 10)
    expect(limitOfW01(undeclared)).toBeCloseTo(AMP_20 * 0.6, 10)
    expect(runRules(undeclared, [gaugeCurrentMismatch]).map((d) => d.target)).toContain("wire:W01")
  })

  it("counts on positive evidence only", () => {
    // Undeclared counts, whatever the gauge — thin is not the same as unloaded.
    expect(isCurrentCarrying({ gauge: "26AWG" })).toBe(true)
    expect(isCurrentCarrying({ gauge: "26AWG", signal: "ENC1_A" })).toBe(true)
    // A ground return carries every amp the feed does.
    expect(isCurrentCarrying({ gauge: "20AWG", signal: "GND_MD1" })).toBe(true)
    // A drain carries no operating current by construction.
    expect(isCurrentCarrying({ gauge: "26AWG", signal: "SHIELD1_DRAIN" })).toBe(false)
    // A declared load is believed in both directions.
    expect(isCurrentCarrying({ gauge: "26AWG", signal: "SHIELD1_DRAIN", currentEstimate: 0.5 }))
      .toBe(true)
    expect(isCurrentCarrying({ gauge: "20AWG", currentEstimate: 0 })).toBe(false)
    expect(isCurrentCarrying({ gauge: "20AWG", currentEstimate: 0.02 })).toBe(false)
    expect(isCurrentCarrying({ gauge: "20AWG", currentEstimate: AMP_20 * 0.1 })).toBe(true)
    // Off-table or unparseable gauge: no basis for calling a load negligible.
    expect(isCurrentCarrying({ gauge: "0.5mm2", currentEstimate: 0.001 })).toBe(true)
  })
})

// --- Determinism --------------------------------------------------------------

describe("determinism", () => {
  it("produces byte-identical diagnostics and margins for the same HIR", () => {
    const rules = [
      gaugeOutsideConnectorRange,
      insulationOutsideTerminalRange,
      insulationOutsideSealRange,
      connectorCurrentExceeded,
      gaugeCurrentMismatch
    ]
    const build = (): Hir => {
      const a = connector("J1", { ...sealedHousing, currentLimitA: 10 }, {
        pins: { 1: "VBAT_24V", 2: "GND" },
        terminals: { 1: { ...barrelContact, ...narrowContact, currentRatingA: 4 } },
        seals: { 1: cavitySeal }
      })
      const b = connector("J2", housing, { pins: { 1: "VBAT_24V", 2: "GND" } })
      const hir = compile(
        harness("determinism", {
          revision: "A",
          units: "mm",
          connectors: [a, b],
          wires: [
            wire("W1", a.pin(1), b.pin(1), {
              part: { mpn: "WIRE-22-PVC", gauge: "22AWG", outerDiameter: 2.1 },
              gauge: "22AWG",
              color: "red",
              length: 100,
              signal: "VBAT_24V",
              currentEstimate: 5
            }),
            wire("W2", a.pin(2), b.pin(2), {
              gauge: "26AWG",
              color: "black",
              length: 100,
              signal: "SHIELD_DRAIN"
            })
          ],
          branches: [branch("main", { path: [a, b], nominalLength: 100 })]
        })
      )
      return { ...hir, wires: hir.wires.map((w) => ({ ...w, branch: "main" })) }
    }

    const first = runRulesWithMargins(build(), rules)
    const second = runRulesWithMargins(build(), rules)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    // Not vacuous: this fixture exercises every path changed here.
    expect([...new Set(first.diagnostics.map((d) => d.code))].sort()).toEqual([
      "HK-CONN-016",
      "HK-MFG-004",
      "HK-MFG-012",
      "HK-MFG-013",
      "HK-WIRE-004"
    ])
    expect(first.margins.length).toBeGreaterThan(0)
  })
})

// --- The shipped examples ------------------------------------------------------

describe("the shipped examples are unchanged", () => {
  for (const [name, design] of [
    ["motor-controller", motorController],
    ["sensor-splice", sensorSplice],
    ["robot-platform", robotPlatform]
  ] as const) {
    it(`${name} still validates with zero rule errors`, () => {
      const { hir, diagnostics } = compileDesign(design)
      expect(diagnostics.filter((d) => d.severity === "error")).toEqual([])
      const found = runRules(hir, builtinRules)
      expect(found.filter((d) => d.severity === "error")).toEqual([])
      // All three supply terminals as bare MPNs and declare no wire part ODs,
      // so every new path above is inert on them: HK-MFG-004 still reads the
      // housing and the two insulation rules have nothing to measure.
      expect(found.filter((d) => d.code === "HK-MFG-012" || d.code === "HK-MFG-013")).toEqual([])
    })
  }
})

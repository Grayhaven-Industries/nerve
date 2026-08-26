import { describe, expect, it } from "vitest"
import {
  compileDesign,
  connector,
  harness,
  hasErrors,
  rule,
  runRules,
  wire,
  type ConnectorPart,
  type HarnessDesign,
  type Hir
} from "@grayhaven/nerve"
import {
  breakoutTighterThanBendRadiusWith,
  builtinRules,
  builtinRulesWith,
  bundleOverSleeveCapacityWith,
  gaugeCurrentMismatchWith,
  parseAwg,
  requiredAwgForCurrent
} from "@grayhaven/nerve-rules"
import design from "../../../examples/motor-controller/src/main.harness.js"

const part: ConnectorPart = {
  mpn: "TEST-4",
  pinCount: 4,
  wireGaugeRange: { min: "30AWG", max: "18AWG" }
}

const compile = (d: HarnessDesign): Hir => compileDesign(d).hir

const make = (
  wires: Parameters<typeof harness>[1]["wires"],
  overrides: Partial<Parameters<typeof harness>[1]> = {}
): Hir => {
  const a = connector("J1", part, { pins: { 1: "VBAT_24V", 2: "GND" } })
  const b = connector("J2", part, { pins: { 1: "VBAT_24V", 2: "GND" } })
  return compile(
    harness("rule-fixture", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      wires,
      ...overrides
    })
  )
}

// Connectors used by tests that need custom pin assignments.
const j1 = connector("J1", part, { pins: { 1: "VBAT_24V", 2: "GND" } })
const j2 = connector("J2", part, { pins: { 1: "VBAT_24V", 2: "GND" } })

const codesOf = (hir: Hir, names?: ReadonlyArray<string>) =>
  runRules(hir, builtinRules, Object.fromEntries(
    names === undefined
      ? []
      : builtinRules.filter((r) => !names.includes(r.name)).map((r) => [r.name, "off"] as const)
  )).map((d) => d.code)

describe("golden fixture under built-in rules", () => {
  const { hir } = compileDesign(design)
  const diagnostics = runRules(hir, builtinRules)

  it("has no errors (PRD §8.1: compiles without errors)", () => {
    expect(hasErrors(diagnostics)).toBe(false)
  })

  it("warns about known incompleteness, deterministically", () => {
    // ENC_A/ENC_B/MOTOR_TEMP assigned but unwired (×2 connectors),
    // SHIELD_DRAIN unconnected (×2), W3/W4 missing length, and the CAN pair
    // declares no termination — info, not a defect, because the 120Ω
    // resistors legitimately live off-harness in the end nodes.
    const counts = diagnostics.reduce<Record<string, number>>((acc, d) => {
      acc[d.code] = (acc[d.code] ?? 0) + 1
      return acc
    }, {})
    expect(counts).toEqual({
      "HK-CONN-010": 6,
      "HK-ELEC-004": 2,
      "HK-ELEC-018": 1,
      "HK-MFG-001": 2
    })
    expect(runRules(hir, builtinRules)).toEqual(diagnostics)
  })
})

describe("documentation rules", () => {
  it("HK-DOC-001: missing revision", () => {
    const hir = compile(
      harness("no-rev", { revision: "  ", units: "mm", connectors: [], wires: [] })
    )
    expect(codesOf(hir, ["missingRevision"])).toEqual(["HK-DOC-001"])
  })

  it("HK-DOC-002: branch without label", () => {
    const { hir } = compileDesign({
      ...design,
      labels: []
    })
    expect(codesOf(hir, ["branchMissingLabel"])).toEqual(["HK-DOC-002"])
  })
})

describe("manufacturing rules", () => {
  it("HK-MFG-001/002/003: missing length, color, gauge", () => {
    const hir = make([wire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })])
    expect(
      codesOf(hir, ["missingWireLength", "missingWireColor", "missingWireGauge"]).sort()
    ).toEqual(["HK-MFG-001", "HK-MFG-002", "HK-MFG-003"])
  })

  it("HK-MFG-004: gauge outside connector range", () => {
    const hir = make([
      wire("W1", j1.pin(1), j2.pin(1), { gauge: "14AWG", signal: "VBAT_24V" })
    ])
    const diags = runRules(
      hir,
      builtinRules.filter((r) => r.name === "gaugeOutsideConnectorRange")
    )
    expect(diags.map((d) => d.code)).toEqual(["HK-MFG-004", "HK-MFG-004"])
    expect(diags[0]?.message).toContain("accepts 18AWG to 30AWG")
  })

  it("HK-MFG-007: a genuine non-AWG typo is a visible warning, not a silent skip", () => {
    const hir = make([
      wire("W1", j1.pin(1), j2.pin(1), { gauge: "18AGW", signal: "VBAT_24V" })
    ])
    const diags = runRules(
      hir,
      builtinRules.filter((r) => r.name === "unparseableGauge")
    )
    expect(diags.map((d) => d.code)).toEqual(["HK-MFG-007"])
    expect(diags[0]?.severity).toBe("warning")
    expect(diags[0]?.message).toContain('"18AGW"')
    // The codes are the point of this warning: they name which checks the
    // unreadable gauge silenced. A wire that skips them still passes the run.
    expect(diags[0]?.message).toContain("HK-MFG-004")
    expect(diags[0]?.message).toContain("do not run on this wire")
  })

  it("HK-MFG-007: a well-formed metric gauge is Info, not a forever-Warning", () => {
    const hir = make([
      wire("W1", j1.pin(1), j2.pin(1), { gauge: "0.5mm2", signal: "VBAT_24V" })
    ])
    const diags = runRules(
      hir,
      builtinRules.filter((r) => r.name === "unparseableGauge")
    )
    expect(diags.map((d) => d.code)).toEqual(["HK-MFG-007"])
    expect(diags[0]?.severity).toBe("info")
    expect(diags[0]?.message).toContain("metric gauge")
  })

  it("HK-MFG-007: canonicalized AWG spellings never fire", () => {
    // "20" canonicalizes to "20AWG" in compileDesign, so gauge-based
    // rules see it — the original silent-skip bug.
    const hir = make([
      wire("W1", j1.pin(1), j2.pin(1), { gauge: "20", signal: "VBAT_24V" })
    ])
    expect(hir.wires[0]?.gauge).toBe("20AWG")
    expect(
      runRules(hir, builtinRules.filter((r) => r.name === "unparseableGauge"))
    ).toEqual([])
  })
})

describe("ShopProfile-parameterized manufacturing rules", () => {
  it("shop ampacity table overrides the bundled defaults", () => {
    const hir = make([
      wire("W1", j1.pin(1), j2.pin(1), { gauge: "24AWG", currentEstimate: 2, signal: "VBAT_24V" })
    ])
    // Bundled table: 24AWG carries 1.4A → fires.
    expect(
      runRules(hir, [gaugeCurrentMismatchWith()]).map((d) => d.code)
    ).toEqual(["HK-WIRE-004"])
    // This shop derates less: 24AWG carries 2.5A → clean.
    expect(
      runRules(hir, [gaugeCurrentMismatchWith({ ampacityByAwg: { 24: 2.5 } })])
    ).toEqual([])
  })

  it("shop sleeve capacities beat name-derived capacity", () => {
    const mk = (rulesArg: Parameters<typeof runRules>[1]) => {
      const hir = compile(
        harness("sleeves", {
          revision: "A",
          units: "mm",
          connectors: [j1, j2],
          wires: [
            wire("W1", j1.pin(1), j2.pin(1), { gauge: "10AWG", signal: "VBAT_24V" }),
            wire("W2", j1.pin(2), j2.pin(2), { gauge: "10AWG", signal: "GND" })
          ],
          branches: [
            { kind: "branch", id: "B1", path: ["J1", "J2"], sleeve: "shop-loom-A" }
          ]
        })
      )
      return runRules(hir, rulesArg)
    }
    // Name yields no capacity → bundled rule silent.
    expect(mk([bundleOverSleeveCapacityWith()])).toEqual([])
    // The shop knows its loom takes 5mm; two 10AWG (~4.8mm OD each) overflow.
    const diags = mk([bundleOverSleeveCapacityWith({ sleeveCapacityMm: { "shop-loom-A": 5 } })])
    expect(diags.map((d) => d.code)).toEqual(["HK-MFG-006"])
    expect(diags[0]?.data).toMatchObject({ sleeveCapacityMm: 5 })
  })

  it("shop default bend radius applies to branches that declare none", () => {
    const hir = compile(
      harness("bend", {
        revision: "A",
        units: "mm",
        connectors: [j1, j2],
        wires: [wire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })],
        branches: [
          { kind: "branch", id: "trunk", path: ["J1", "J2"] },
          { kind: "branch", id: "drop", path: ["J2"], parent: "trunk", breakoutDistance: 10 }
        ]
      })
    )
    expect(runRules(hir, [breakoutTighterThanBendRadiusWith()])).toEqual([])
    const diags = runRules(hir, [
      breakoutTighterThanBendRadiusWith({ defaultMinBendRadiusMm: 25 })
    ])
    expect(diags.map((d) => d.code)).toEqual(["HK-MFG-005"])
  })

  it("builtinRulesWith keeps names/codes so severity overrides still apply", () => {
    const withShop = builtinRulesWith({ ampacityByAwg: { 24: 2.5 } })
    expect(withShop.map((r) => r.name)).toEqual(builtinRules.map((r) => r.name))
    expect(withShop.map((r) => r.code)).toEqual(builtinRules.map((r) => r.code))
    expect(builtinRulesWith(undefined)).toBe(builtinRules)
  })
})

describe("electrical rules", () => {
  it("HK-WIRE-004: gauge below current requirement", () => {
    const hir = make([
      wire("W1", j1.pin(1), j2.pin(1), {
        gauge: "24AWG",
        currentEstimate: 5,
        signal: "VBAT_24V"
      })
    ])
    const diags = runRules(
      hir,
      builtinRules.filter((r) => r.name === "gaugeCurrentMismatch")
    )
    expect(diags.map((d) => d.code)).toEqual(["HK-WIRE-004"])
    expect(diags[0]?.message).toContain("requires at least 18AWG")
  })

  it("HK-CONN-016: wire current above connector contact rating", () => {
    const rated: ConnectorPart = { mpn: "PH-2", pinCount: 2, currentLimitA: 2 }
    const a = connector("J1", rated, { pins: { 1: "VBAT_24V", 2: "GND" } })
    const b = connector("J2", part, { pins: { 1: "VBAT_24V", 2: "GND" } })
    const hir = compile(
      harness("overcurrent", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [
          wire("W1", a.pin(1), b.pin(1), { signal: "VBAT_24V", currentEstimate: 5 })
        ]
      })
    )
    const diags = runRules(
      hir,
      builtinRules.filter((r) => r.name === "connectorCurrentExceeded")
    )
    // Only the rated connector end fires — J2's part declares no limit.
    expect(diags.map((d) => d.code)).toEqual(["HK-CONN-016"])
    expect(diags[0]?.target).toBe("connector:J1.pin:1")
    expect(diags[0]?.data).toMatchObject({ currentEstimateA: 5, currentLimitA: 2 })
  })

  it("HK-CONN-017: rail nominal volts above connector rating (Warning, inferred)", () => {
    const rated: ConnectorPart = { mpn: "PH-2", pinCount: 2, voltageLimitV: 100 }
    const a = connector("J1", rated, { pins: { 1: "VBAT_400V", 2: "GND" } })
    const b = connector("J2", part, { pins: { 1: "VBAT_400V", 2: "GND" } })
    const hir = compile(
      harness("overvoltage", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [wire("W1", a.pin(1), b.pin(1), { signal: "VBAT_400V" })]
      })
    )
    const diags = runRules(
      hir,
      builtinRules.filter((r) => r.name === "connectorVoltageExceeded")
    )
    expect(diags.map((d) => d.code)).toEqual(["HK-CONN-017"])
    // Inferred from the name → Warning, not a fail-closed Error.
    expect(diags[0]?.severity).toBe("warning")
    expect(diags[0]?.data).toMatchObject({ nominalV: 400, voltageLimitV: 100 })
  })

  it("HK-CONN-017: does NOT fire on non-rail names with a volt token (FB_400V, EN_48V)", () => {
    const rated: ConnectorPart = { mpn: "PH-2", pinCount: 2, voltageLimitV: 100 }
    const a = connector("J1", rated, { pins: { 1: "FB_400V", 2: "EN_48V" } })
    const b = connector("J2", part, { pins: { 1: "FB_400V", 2: "EN_48V" } })
    const hir = compile(
      harness("logic-lines", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [
          wire("W1", a.pin(1), b.pin(1), { signal: "FB_400V" }),
          wire("W2", a.pin(2), b.pin(2), { signal: "EN_48V" })
        ]
      })
    )
    expect(
      runRules(hir, builtinRules.filter((r) => r.name === "connectorVoltageExceeded"))
    ).toEqual([])
  })

  it("HK-ELEC-001: differential pair not twisted", () => {
    const a = connector("J1", part, { pins: { 1: "CAN_H", 2: "CAN_L" } })
    const b = connector("J2", part, { pins: { 1: "CAN_H", 2: "CAN_L" } })
    const hir = compile(
      harness("untwisted", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [
          wire("W1", a.pin(1), b.pin(1), { signal: "CAN_H" }),
          wire("W2", a.pin(2), b.pin(2), { signal: "CAN_L" })
        ]
      })
    )
    expect(codesOf(hir, ["differentialPairNotTwisted"])).toEqual(["HK-ELEC-001"])
  })

  it("HK-ELEC-002: twist group with a single wire", () => {
    const hir = make([
      wire("W1", j1.pin(1), j2.pin(1), { twistGroup: "LONELY", signal: "VBAT_24V" })
    ])
    expect(codesOf(hir, ["twistGroupTooSmall"])).toEqual(["HK-ELEC-002"])
  })

  it("HK-ELEC-003: power without ground return", () => {
    const hir = make([
      wire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })
    ])
    expect(codesOf(hir, ["missingGroundReturn"])).toEqual(["HK-ELEC-003"])
  })

  it("HK-ELEC-004: shield drain unconnected", () => {
    const a = connector("J1", part, { pins: { 1: "SIG", 4: "SHIELD_DRAIN" } })
    const b = connector("J2", part, { pins: { 1: "SIG" } })
    const hir = compile(
      harness("shield", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [wire("W1", a.pin(1), b.pin(1), { signal: "SIG" })]
      })
    )
    expect(codesOf(hir, ["shieldDrainUnconnected"])).toEqual(["HK-ELEC-004"])
  })
})

describe("connectivity rules", () => {
  it("HK-CONN-010: assigned pin with no wire", () => {
    const hir = make([wire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })])
    // GND pins on both connectors are assigned but unwired.
    expect(codesOf(hir, ["unconnectedAssignedPin"])).toEqual([
      "HK-CONN-010",
      "HK-CONN-010"
    ])
  })

  it("HK-CONN-011: wire signal mismatches pin signal", () => {
    const hir = make([
      wire("W1", j1.pin(1), j2.pin(2), { signal: "VBAT_24V" })
    ])
    // j2 pin 2 is GND but the wire claims VBAT_24V.
    expect(codesOf(hir, ["wireSignalMismatch"])).toEqual(["HK-CONN-011"])
  })
})

describe("rule engine", () => {
  it("severity overrides and 'off' work", () => {
    const hir = make([wire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })])
    const raised = runRules(
      hir,
      builtinRules.filter((r) => r.name === "missingWireLength"),
      { missingWireLength: "error" }
    )
    expect(raised[0]?.severity).toBe("error")
    const off = runRules(
      hir,
      builtinRules,
      Object.fromEntries(builtinRules.map((r) => [r.name, "off"] as const))
    )
    expect(off).toEqual([])
  })

  it("custom rules run with a generated stable code", () => {
    const requireMmUnits = rule("require-mm-units", (ctx) => {
      if (ctx.hir.harness.units !== "mm") {
        ctx.report({ severity: "error", message: "Harness must use mm." })
      }
    })
    const hir = compile(
      harness("inches", { revision: "A", units: "in", connectors: [], wires: [] })
    )
    const diags = runRules(hir, [requireMmUnits])
    expect(diags).toEqual([
      {
        code: "HK-RULE-REQUIRE-MM-UNITS",
        severity: "error",
        message: "Harness must use mm."
      }
    ])
  })
})

describe("wire data helpers", () => {
  it("parses gauges and computes required AWG", () => {
    expect(parseAwg("18AWG")).toBe(18)
    expect(parseAwg("awg 24")).toBe(24)
    expect(parseAwg("2.5mm2")).toBeUndefined()
    expect(requiredAwgForCurrent(5)).toBe(18)
    expect(requiredAwgForCurrent(1000)).toBeUndefined()
  })
})

/**
 * Comprehensive rule coverage: for every rule, the three faces —
 * fires (positive), passes (negative), and the boundary between them —
 * plus the wire-data helpers and the rule-engine semantics.
 *
 * Ampacity boundaries encode the shipped AMPACITY_BY_AWG table, which sits
 * in the conservative bundled-harness band (between power-transmission and
 * free-air chassis columns of standard AWG tables; bundling requires
 * derating per NEC 310.15-style guidance).
 */
import { describe, expect, it } from "vitest"
import {
  branch,
  cable,
  compileDesign,
  connector,
  harness,
  label,
  protection,
  splice,
  wire,
  type ConnectorPart,
  type Diagnostic,
  type EndpointInput,
  type HarnessDesign,
  type Hir,
  type WireProps
} from "@grayhaven/nerve"
import { rule, runRules } from "@grayhaven/nerve"
import {
  AMPACITY_BY_AWG,
  builtinRules,
  differentialPartner,
  isGroundSignal,
  isPowerSignal,
  isShieldSignal,
  multipleWiresIntoPin,
  parseAwg,
  requiredAwgForCurrent
} from "@grayhaven/nerve-rules"

const part: ConnectorPart = {
  mpn: "TEST-4",
  pinCount: 4,
  wireGaugeRange: { min: "30AWG", max: "18AWG" }
}

const compile = (d: HarnessDesign): Hir => compileDesign(d).hir

/** Run exactly one built-in rule by name. */
const only = (hir: Hir, name: string): ReadonlyArray<Diagnostic> =>
  runRules(hir, builtinRules.filter((r) => r.name === name))

const fixture = (
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

const fullWire = (id: string, from: EndpointInput, to: EndpointInput, extra: WireProps = {}) =>
  wire(id, from, to, { gauge: "24AWG", color: "red", length: 100, ...extra })

const j1 = connector("J1", part, { pins: { 1: "VBAT_24V", 2: "GND" } })
const j2 = connector("J2", part, { pins: { 1: "VBAT_24V", 2: "GND" } })

// ---------------------------------------------------------------------------
// wire-data helpers
// ---------------------------------------------------------------------------

describe("parseAwg", () => {
  it("accepts the common spellings", () => {
    expect(parseAwg("18AWG")).toBe(18)
    expect(parseAwg("18 AWG")).toBe(18)
    expect(parseAwg("awg18")).toBe(18)
    expect(parseAwg("AWG 18")).toBe(18)
    expect(parseAwg(" 20AWG ")).toBe(20)
    expect(parseAwg("18awg")).toBe(18)
  })

  it("rejects non-gauges", () => {
    expect(parseAwg("AWG")).toBeUndefined()
    expect(parseAwg("")).toBeUndefined()
    expect(parseAwg("red")).toBeUndefined()
    expect(parseAwg("1.5mm2")).toBeUndefined()
  })

  it("rejects zero (and therefore aught sizes — 4/0AWG is out of scope)", () => {
    expect(parseAwg("0AWG")).toBeUndefined()
    // "4/0AWG" finds the trailing 0AWG and rejects it: aught wire is not
    // a harness gauge this library models.
    expect(parseAwg("4/0AWG")).toBeUndefined()
  })

  it("rejects decimal gauges: '20.5AWG' is not 5AWG", () => {
    // The pre-canonicalization parser was unanchored and found "5AWG"
    // inside "20.5AWG". Parsing now anchors on the whole string (it also
    // backs compileDesign's gauge canonicalization), so malformed gauges
    // fall through to HK-MFG-007 instead of becoming a wrong number.
    expect(parseAwg("20.5AWG")).toBeUndefined()
  })
})

describe("ampacity table", () => {
  it("is monotonic: thicker wire always carries more", () => {
    const entries = Object.entries(AMPACITY_BY_AWG)
      .map(([awg, amps]) => [Number(awg), amps] as const)
      .sort(([a], [b]) => b - a) // thinnest (30) -> thickest (10)
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]![1]).toBeGreaterThan(entries[i - 1]![1])
    }
  })

  it("requiredAwgForCurrent picks the thinnest sufficient gauge", () => {
    expect(requiredAwgForCurrent(3.7)).toBe(20) // exactly at 20AWG's limit
    expect(requiredAwgForCurrent(3.71)).toBe(18) // just over -> next size up
    expect(requiredAwgForCurrent(0.1)).toBe(30)
    expect(requiredAwgForCurrent(38)).toBe(10) // top of the table
    expect(requiredAwgForCurrent(38.1)).toBeUndefined() // off-table
  })
})

describe("signal classifiers", () => {
  it("power: rails and voltage names", () => {
    for (const s of ["VBAT_24V", "VCC", "VDD3V3", "VIN", "VSYS", "PWR", "+5V", "5V", "3.3V", "24V_RAIL"]) {
      expect(isPowerSignal(s), s).toBe(true)
    }
    // Deliberately anchored: token-matching "5V" anywhere would classify
    // enable/sense lines (EN_5V) as rails — a false positive with real
    // HK-ELEC-003 consequences. Bare V-prefixed nets (V5) also stay out;
    // the sensor-splice example relies on that.
    for (const s of ["V5", "CAN_H", "GND", "DATA0", "EN_5V", "SENSE_24V"]) {
      expect(isPowerSignal(s), s).toBe(false)
    }
  })

  it("ground is token-aware: prefixed and suffixed grounds classify", () => {
    for (const s of ["GND", "GROUND", "0V", "RTN", "RETURN", "VSS", "gnd",
                     "AGND", "DGND", "PGND", "MOTOR_GND", "GND_SENSE"]) {
      expect(isGroundSignal(s), s).toBe(true)
    }
    for (const s of ["CHASSIS", "VBAT", "GROUNDED_PLANE_X"]) {
      expect(isGroundSignal(s), s).toBe(false)
    }
  })

  it("shield: unanchored, so prefixed drains match", () => {
    for (const s of ["SHIELD", "CABLE_SHIELD", "DRAIN", "SHLD", "SHLD1", "CAN_SHIELD"]) {
      expect(isShieldSignal(s), s).toBe(true)
    }
    expect(isShieldSignal("GND")).toBe(false)
  })
})

describe("differentialPartner", () => {
  it("CAN with and without underscore, with bus prefixes", () => {
    expect(differentialPartner("CAN_H")).toBe("CAN_L")
    expect(differentialPartner("CANH")).toBe("CANL")
    expect(differentialPartner("CAN1_H")).toBe("CAN1_L")
    expect(differentialPartner("MOTOR_CAN_L")).toBe("MOTOR_CAN_H")
  })

  it("RS-485, generic _P/_N, USB", () => {
    expect(differentialPartner("RS485_A")).toBe("RS485_B")
    expect(differentialPartner("RS485B")).toBe("RS485A")
    expect(differentialPartner("LVDS_P")).toBe("LVDS_N")
    expect(differentialPartner("LVDS_N")).toBe("LVDS_P")
    expect(differentialPartner("USB_DP")).toBe("USB_DM")
    expect(differentialPartner("USBDM")).toBe("USBDP")
  })

  it("non-pairs return undefined", () => {
    for (const s of ["GND", "CAN", "DATA_A", "VBAT_24V", "SHIELD"]) {
      expect(differentialPartner(s), s).toBeUndefined()
    }
  })
})

// ---------------------------------------------------------------------------
// documentation rules
// ---------------------------------------------------------------------------

describe("HK-DOC-001 missingRevision", () => {
  it("fires on whitespace-only revision", () => {
    const hir = compile(harness("h", { revision: "  ", units: "mm", connectors: [], wires: [] }))
    expect(only(hir, "missingRevision").map((d) => d.code)).toEqual(["HK-DOC-001"])
  })

  it("passes with a real revision", () => {
    const hir = compile(harness("h", { revision: "A", units: "mm", connectors: [], wires: [] }))
    expect(only(hir, "missingRevision")).toEqual([])
  })
})

describe("HK-DOC-002 branchMissingLabel", () => {
  const withBranch = (labels: ReadonlyArray<ReturnType<typeof label>>) =>
    fixture([fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })], {
      branches: [branch("B1", { path: [j1, j2], nominalLength: 100 })],
      labels
    })

  it("fires for an unlabeled branch with the branch target", () => {
    const diags = only(withBranch([]), "branchMissingLabel")
    expect(diags.map((d) => d.code)).toEqual(["HK-DOC-002"])
    expect(diags[0]?.target).toBe("branch:B1")
  })

  it("passes when a label attaches to the branch", () => {
    const hir = withBranch([label("L1", { text: "MAIN", attachTo: "B1" })])
    expect(only(hir, "branchMissingLabel")).toEqual([])
  })
})

describe("HK-DOC-003 spliceMissingNotes", () => {
  const withSplice = (s: ReturnType<typeof splice>) => {
    const a = connector("J1", part, { pins: { 1: "V5" } })
    return compile(
      harness("h", {
        revision: "A",
        units: "mm",
        connectors: [a],
        wires: [fullWire("W1", a.pin(1), s)],
        splices: [s]
      })
    )
  }

  it("fires when type, part, and notes are all absent", () => {
    expect(only(withSplice(splice("S1")), "spliceMissingNotes").map((d) => d.code)).toEqual([
      "HK-DOC-003"
    ])
  })

  it("passes with any one of type / notes", () => {
    expect(only(withSplice(splice("S1", { type: "crimp" })), "spliceMissingNotes")).toEqual([])
    expect(
      only(withSplice(splice("S1", { notes: "solder and heatshrink" })), "spliceMissingNotes")
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// manufacturing rules
// ---------------------------------------------------------------------------

describe("HK-MFG-001/002/003 missing length/color/gauge", () => {
  it("each fires independently", () => {
    const noLength = fixture([wire("W1", j1.pin(1), j2.pin(1), { gauge: "24AWG", color: "red", signal: "VBAT_24V" })])
    expect(only(noLength, "missingWireLength").map((d) => d.code)).toEqual(["HK-MFG-001"])
    expect(only(noLength, "missingWireColor")).toEqual([])
    expect(only(noLength, "missingWireGauge")).toEqual([])
  })

  it("a fully specified wire passes all three", () => {
    const hir = fixture([fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })])
    for (const name of ["missingWireLength", "missingWireColor", "missingWireGauge"]) {
      expect(only(hir, name), name).toEqual([])
    }
  })

  it("length is a warning; color and gauge are errors", () => {
    const bare = fixture([wire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })])
    expect(only(bare, "missingWireLength")[0]?.severity).toBe("warning")
    expect(only(bare, "missingWireColor")[0]?.severity).toBe("error")
    expect(only(bare, "missingWireGauge")[0]?.severity).toBe("error")
  })
})

describe("HK-MFG-004 gaugeOutsideConnectorRange (range 30AWG..18AWG)", () => {
  const gauge = (g: string) =>
    only(fixture([fullWire("W1", j1.pin(1), j2.pin(1), { gauge: g, signal: "VBAT_24V" })]), "gaugeOutsideConnectorRange")

  it("boundaries are inclusive: exactly min and exactly max pass", () => {
    expect(gauge("30AWG")).toEqual([])
    expect(gauge("18AWG")).toEqual([])
  })

  it("one step outside fires at both endpoints of the wire", () => {
    expect(gauge("32AWG").map((d) => d.code)).toEqual(["HK-MFG-004", "HK-MFG-004"]) // too thin
    expect(gauge("16AWG").map((d) => d.code)).toEqual(["HK-MFG-004", "HK-MFG-004"]) // too thick
  })

  it("skips wires without a parseable gauge and connectors without a range", () => {
    expect(gauge("steel")).toEqual([])
    const noRange = connector("J9", { mpn: "NR", pinCount: 2 }, { pins: { 1: "V5" } })
    const hir = compile(
      harness("h", {
        revision: "A",
        units: "mm",
        connectors: [noRange],
        wires: [fullWire("W1", noRange.pin(1), noRange.pin(1), { gauge: "10AWG" })]
      })
    )
    expect(only(hir, "gaugeOutsideConnectorRange")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// electrical rules
// ---------------------------------------------------------------------------

describe("HK-WIRE-004 gaugeCurrentMismatch", () => {
  const current = (gauge: string, currentEstimate: number) =>
    only(
      fixture([fullWire("W1", j1.pin(1), j2.pin(1), { gauge, currentEstimate, signal: "VBAT_24V" })]),
      "gaugeCurrentMismatch"
    )

  it("exactly at ampacity passes; just over fires", () => {
    expect(current("20AWG", 3.7)).toEqual([]) // 20AWG carries exactly 3.7A
    const diags = current("20AWG", 3.8)
    expect(diags.map((d) => d.code)).toEqual(["HK-WIRE-004"])
    expect(diags[0]?.message).toContain("requires at least 18AWG")
  })

  it("current beyond the whole table says so", () => {
    expect(current("10AWG", 50)[0]?.message).toContain("exceeds the ampacity table")
  })

  it("skips wires without an estimate or with an off-table gauge", () => {
    expect(current("8AWG", 50)).toEqual([]) // 8AWG not in the table
    const noEstimate = fixture([fullWire("W1", j1.pin(1), j2.pin(1), { gauge: "30AWG", signal: "VBAT_24V" })])
    expect(only(noEstimate, "gaugeCurrentMismatch")).toEqual([])
  })
})

describe("HK-ELEC-001 differentialPairNotTwisted", () => {
  const canPair = (twists: { h?: string; l?: string }) => {
    const a = connector("J1", part, { pins: { 1: "CAN_H", 2: "CAN_L" } })
    const b = connector("J2", part, { pins: { 1: "CAN_H", 2: "CAN_L" } })
    return compile(
      harness("h", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [
          fullWire("W1", a.pin(1), b.pin(1), twists.h !== undefined ? { signal: "CAN_H", twistGroup: twists.h } : { signal: "CAN_H" }),
          fullWire("W2", a.pin(2), b.pin(2), twists.l !== undefined ? { signal: "CAN_L", twistGroup: twists.l } : { signal: "CAN_L" })
        ]
      })
    )
  }

  it("fires when neither wire is twisted, and when groups differ", () => {
    expect(only(canPair({}), "differentialPairNotTwisted").length).toBeGreaterThan(0)
    expect(only(canPair({ h: "T1", l: "T2" }), "differentialPairNotTwisted").length).toBeGreaterThan(0)
  })

  it("passes when the pair shares a twist group", () => {
    expect(only(canPair({ h: "T1", l: "T1" }), "differentialPairNotTwisted")).toEqual([])
  })

  it("a lone CAN_H with no CAN_L present is not a pair violation", () => {
    const a = connector("J1", part, { pins: { 1: "CAN_H" } })
    const hir = compile(
      harness("h", {
        revision: "A",
        units: "mm",
        connectors: [a, j2],
        wires: [fullWire("W1", a.pin(1), j2.pin(1), { signal: "CAN_H" })]
      })
    )
    expect(only(hir, "differentialPairNotTwisted")).toEqual([])
  })
})

describe("HK-ELEC-002 twistGroupTooSmall", () => {
  it("a singleton group fires; a pair passes; two singletons sort deterministically", () => {
    const one = fixture([fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V", twistGroup: "T1" })])
    expect(only(one, "twistGroupTooSmall").map((d) => d.code)).toEqual(["HK-ELEC-002"])

    const two = fixture([
      fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V", twistGroup: "T1" }),
      fullWire("W2", j1.pin(2), j2.pin(2), { signal: "GND", twistGroup: "T1" })
    ])
    expect(only(two, "twistGroupTooSmall")).toEqual([])

    const singles = fixture([
      fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V", twistGroup: "TB" }),
      fullWire("W2", j1.pin(2), j2.pin(2), { signal: "GND", twistGroup: "TA" })
    ])
    expect(only(singles, "twistGroupTooSmall").map((d) => d.message)).toEqual([
      expect.stringContaining("TA"),
      expect.stringContaining("TB")
    ])
  })
})

describe("HK-ELEC-003 missingGroundReturn", () => {
  it("power without ground fires, listing unique sorted rails", () => {
    const hir = fixture([
      fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" }),
      fullWire("W2", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" }),
      fullWire("W3", j1.pin(1), j2.pin(1), { signal: "5V" })
    ])
    const diags = only(hir, "missingGroundReturn")
    expect(diags.map((d) => d.code)).toEqual(["HK-ELEC-003"])
    expect(diags[0]?.message).toContain("5V, VBAT_24V")
  })

  it("passes with a ground wire, and with no power at all", () => {
    const grounded = fixture([
      fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" }),
      fullWire("W2", j1.pin(2), j2.pin(2), { signal: "GND" })
    ])
    expect(only(grounded, "missingGroundReturn")).toEqual([])

    const dataOnly = fixture([fullWire("W1", j1.pin(1), j2.pin(1), { signal: "DATA0" })])
    expect(only(dataOnly, "missingGroundReturn")).toEqual([])
  })
})

describe("HK-ELEC-004 shieldDrainUnconnected (+ HK-CONN-010 exclusion)", () => {
  const shieldConn = connector("J1", part, { pins: { 1: "CAN_SHIELD", 2: "V5" } })

  it("fires as a warning for an unwired shield pin; CONN-010 stays silent for it", () => {
    const hir = compile(
      harness("h", {
        revision: "A",
        units: "mm",
        connectors: [shieldConn, j2],
        wires: [fullWire("W1", shieldConn.pin(2), j2.pin(1))]
      })
    )
    const shield = only(hir, "shieldDrainUnconnected")
    expect(shield.map((d) => d.code)).toEqual(["HK-ELEC-004"])
    expect(shield[0]?.severity).toBe("warning")
    // The generic unconnected-pin rule must NOT double-report shield pins.
    expect(only(hir, "unconnectedAssignedPin").map((d) => d.target)).not.toContain(
      "connector:J1.pin:1"
    )
  })

  it("passes once the drain lands on a wire", () => {
    const hir = compile(
      harness("h", {
        revision: "A",
        units: "mm",
        connectors: [shieldConn, j2],
        wires: [
          fullWire("W1", shieldConn.pin(1), j2.pin(1), { signal: "CAN_SHIELD" }),
          fullWire("W2", shieldConn.pin(2), j2.pin(2))
        ]
      })
    )
    expect(only(hir, "shieldDrainUnconnected")).toEqual([])
  })
})

describe("HK-CONN-010 unconnectedAssignedPin", () => {
  it("fires for an assigned, unwired pin; unassigned pins are fine", () => {
    const a = connector("J1", part, { pins: { 1: "V5" } }) // pin 2 unassigned
    const hir = compile(
      harness("h", { revision: "A", units: "mm", connectors: [a], wires: [] })
    )
    const diags = only(hir, "unconnectedAssignedPin")
    expect(diags.map((d) => d.target)).toEqual(["connector:J1.pin:1"])
    expect(diags[0]?.severity).toBe("warning")
  })

  it("a wire to a splice counts as wiring the pin", () => {
    const a = connector("J1", part, { pins: { 1: "V5" } })
    const s = splice("S1", { type: "crimp" })
    const hir = compile(
      harness("h", {
        revision: "A",
        units: "mm",
        connectors: [a],
        wires: [fullWire("W1", a.pin(1), s)],
        splices: [s]
      })
    )
    expect(only(hir, "unconnectedAssignedPin")).toEqual([])
  })
})

describe("HK-CONN-011 wireSignalMismatch", () => {
  it("fires once per mismatched endpoint", () => {
    const hir = fixture([fullWire("W1", j1.pin(1), j2.pin(2), { signal: "VBAT_24V" })])
    // j1.1 = VBAT_24V (match), j2.2 = GND (mismatch)
    const diags = only(hir, "wireSignalMismatch")
    expect(diags.map((d) => d.target)).toEqual(["connector:J2.pin:2"])

    const both = fixture([fullWire("W1", j1.pin(2), j2.pin(2), { signal: "VBAT_24V" })])
    expect(only(both, "wireSignalMismatch")).toHaveLength(2)
  })

  it("passes on matching signals; skips unassigned pins and signalless wires", () => {
    expect(only(fixture([fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })]), "wireSignalMismatch")).toEqual([])
    const a = connector("J8", part, { pins: {} })
    const unassigned = compile(
      harness("h", {
        revision: "A",
        units: "mm",
        connectors: [a],
        wires: [fullWire("W1", a.pin(1), a.pin(2), { signal: "ANYTHING" })]
      })
    )
    expect(only(unassigned, "wireSignalMismatch")).toEqual([])
    expect(only(fixture([fullWire("W1", j1.pin(1), j2.pin(2))]), "wireSignalMismatch")).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// engine semantics
// ---------------------------------------------------------------------------

describe("rule engine", () => {
  const noisy = fixture([wire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })])

  it("severity can be overridden per rule without changing the code", () => {
    const diags = runRules(noisy, builtinRules, {
      missingWireColor: "warning",
      missingWireLength: "off",
      missingWireGauge: "off",
      missingGroundReturn: "off",
      unconnectedAssignedPin: "off"
    })
    const color = diags.find((d) => d.code === "HK-MFG-002")
    expect(color?.severity).toBe("warning")
    expect(diags.some((d) => d.code === "HK-MFG-001")).toBe(false)
  })

  it("output is deterministic and canonically ordered by (target, code, message)", () => {
    const a = runRules(noisy, builtinRules)
    const b = runRules(noisy, builtinRules)
    expect(a).toEqual(b)
    const keys = a.map((d) => [d.target ?? "", d.code, d.message] as const)
    const sorted = [...keys].sort(
      (x, y) =>
        x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]) || x[2].localeCompare(y[2])
    )
    expect(keys).toEqual(sorted)
  })

  it("a report-level code overrides the rule's code", () => {
    const custom = rule(
      "customCode",
      (ctx) => ctx.report({ severity: "warning", message: "x", code: "ORG-042" }),
      { code: "ORG-001" }
    )
    expect(runRules(noisy, [custom]).map((d) => d.code)).toEqual(["ORG-042"])
  })
})

describe("HK-ELEC-005 voltageRatingBelowSignal", () => {
  it("fires when the wire's rating is below the signal's nominal volts", () => {
    const hir = fixture([fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V", voltageRating: 12 })])
    expect(only(hir, "voltageRatingBelowSignal").map((d) => d.code)).toEqual(["HK-ELEC-005"])
  })
  it("passes at exactly nominal and when either field is absent", () => {
    expect(only(fixture([fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V", voltageRating: 24 })]), "voltageRatingBelowSignal")).toEqual([])
    expect(only(fixture([fullWire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })]), "voltageRatingBelowSignal")).toEqual([])
    expect(only(fixture([fullWire("W1", j1.pin(1), j2.pin(1), { signal: "CAN_H", voltageRating: 5 })]), "voltageRatingBelowSignal")).toEqual([])
  })
  it("reads decimal rails", () => {
    const hir = fixture([fullWire("W1", j1.pin(1), j2.pin(1), { signal: "RAIL_3.3V", voltageRating: 3 })])
    expect(only(hir, "voltageRatingBelowSignal")).toHaveLength(1)
  })
})

describe("HK-CONN-015 reservedPinAssigned", () => {
  const part = { mpn: "RP-4", pinCount: 4, reservedPins: [4] }
  it("fires when a reserved pin carries a signal", () => {
    const a = connector("J1", part, { pins: { 1: "SIG", 4: "OOPS" } })
    const b = connector("J2", { mpn: "RP-4B", pinCount: 4 }, { pins: { 1: "SIG", 4: "OOPS" } })
    const { hir } = compileDesign(
      harness("t", { revision: "A", units: "mm", connectors: [a, b], wires: [
        wire("W1", a.pin(1), b.pin(1), { gauge: "24AWG", color: "red", length: 100 }),
        wire("W2", a.pin(4), b.pin(4), { gauge: "24AWG", color: "red", length: 100 })
      ] })
    )
    const diags = only(hir, "reservedPinAssigned")
    expect(diags.map((d) => d.target)).toEqual(["connector:J1.pin:4"])
  })
  it("passes when reserved pins stay empty", () => {
    const a = connector("J1", part, { pins: { 1: "SIG" } })
    const b = connector("J2", { mpn: "RP-4B", pinCount: 4 }, { pins: { 1: "SIG" } })
    const { hir } = compileDesign(
      harness("t", { revision: "A", units: "mm", connectors: [a, b], wires: [
        wire("W1", a.pin(1), b.pin(1), { gauge: "24AWG", color: "red", length: 100 })
      ] })
    )
    expect(only(hir, "reservedPinAssigned")).toEqual([])
  })
})

describe("HK-MFG-005 breakoutTighterThanBendRadius", () => {
  const two = () => {
    const a = connector("J1", { mpn: "BR-2", pinCount: 2 }, { pins: { 1: "S" } })
    const b = connector("J2", { mpn: "BR-2B", pinCount: 2 }, { pins: { 1: "S" } })
    return { a, b, wires: [wire("W1", a.pin(1), b.pin(1), { gauge: "24AWG", color: "red", length: 100 })] }
  }
  it("fires when breakout is inside the bend radius; passes at the boundary", () => {
    const mk = (breakoutDistance: number) => {
      const { a, b, wires } = two()
      return compileDesign(
        harness("t", {
          revision: "A", units: "mm", connectors: [a, b], wires,
          branches: [
            branch("main", { path: [a, b], nominalLength: 100 }),
            branch("drop", { parent: "main", path: [a, b], nominalLength: 50, breakoutDistance, minBendRadius: 30 })
          ]
        })
      ).hir
    }
    expect(only(mk(20), "breakoutTighterThanBendRadius").map((d) => d.code)).toEqual(["HK-MFG-005"])
    expect(only(mk(30), "breakoutTighterThanBendRadius")).toEqual([])
  })
})

describe("HK-MFG-006 bundleOverSleeveCapacity", () => {
  const mk = (sleeve: string, gauges: ReadonlyArray<string>) => {
    const part = { mpn: "BS-16", pinCount: 16 }
    const a = connector("J1", part, { pins: Object.fromEntries(gauges.map((_, i) => [i + 1, `S${i}`])) })
    const b = connector("J2", { ...part, mpn: "BS-16B" }, { pins: Object.fromEntries(gauges.map((_, i) => [i + 1, `S${i}`])) })
    return compileDesign(
      harness("t", {
        revision: "A", units: "mm", connectors: [a, b],
        wires: gauges.map((g, i) => wire(`W${i}`, a.pin(i + 1), b.pin(i + 1), { gauge: g, color: "red", length: 100 })),
        branches: [branch("main", { path: [a, b], sleeve, nominalLength: 100 })]
      })
    ).hir
  }
  it("fires when the estimated bundle exceeds the sleeve, passes inside it", () => {
    // 10x 12AWG (3.9mm OD) ~ 14.2mm bundle > 6mm sleeve
    expect(only(mk("braided-pet-6", Array.from({ length: 10 }, () => "12AWG")), "bundleOverSleeveCapacity").map((d) => d.code)).toEqual(["HK-MFG-006"])
    // 4x 24AWG (1.6mm) ~ 3.7mm < 6mm
    expect(only(mk("braided-pet-6", Array.from({ length: 4 }, () => "24AWG")), "bundleOverSleeveCapacity")).toEqual([])
  })
  it("stays silent for unparseable sleeves or gaugeless wires", () => {
    expect(only(mk("custom-sleeve", ["12AWG"]), "bundleOverSleeveCapacity")).toEqual([])
  })
})

// --- Structural-integrity rules (the well-formedness the compiler leaves) ----

describe("HK-CONN-018 multipleWiresIntoPin (opt-in)", () => {
  // Opt-in rule: run it directly, not via builtinRules.
  const run = (hir: Hir) => runRules(hir, [multipleWiresIntoPin])
  const mk = (gauges: ReadonlyArray<string>) => {
    const a = connector("J1", { mpn: "M-2", pinCount: 2 }, { pins: { 1: "S" } })
    const b = connector("J2", { mpn: "M-2B", pinCount: 4 }, { pins: { 1: "A", 2: "B", 3: "C" } })
    return compileDesign(
      harness("t", {
        revision: "A", units: "mm", connectors: [a, b],
        // All wires land on the SAME pin J1.1 (a forced double/triple-crimp).
        wires: gauges.map((g, i) =>
          wire(`W${i}`, a.pin(1), b.pin(i + 1), { gauge: g, color: "red", length: 100 }))
      })
    ).hir
  }
  it("is not a default built-in (mixed-gauge returns are a valid house pattern)", () => {
    expect(builtinRules.some((r) => r.name === "multipleWiresIntoPin")).toBe(false)
  })
  it("errors on differing gauge crimped into one contact", () => {
    const diags = run(mk(["24AWG", "20AWG"]))
    expect(diags.map((d) => d.code)).toEqual(["HK-CONN-018"])
    expect(diags[0]?.severity).toBe("error")
    expect(diags[0]?.target).toBe("connector:J1.pin:1")
  })
  it("allows a same-gauge double-crimp (power/ground distribution)", () => {
    expect(run(mk(["24AWG", "24AWG"]))).toEqual([])
  })
  it("also catches differing gauge converging on a TO endpoint", () => {
    // Both wires land on J1.1 as their `to` (the rule scans both endpoints).
    const a = connector("J1", { mpn: "M-2", pinCount: 2 }, { pins: { 1: "S" } })
    const b = connector("J2", { mpn: "M-2B", pinCount: 2 }, { pins: { 1: "A", 2: "B" } })
    const { hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [
        wire("W1", b.pin(1), a.pin(1), { gauge: "24AWG", color: "red", length: 10 }),
        wire("W2", b.pin(2), a.pin(1), { gauge: "20AWG", color: "red", length: 10 })
      ]
    }))
    const diags = run(hir)
    expect(diags.map((d) => d.code)).toEqual(["HK-CONN-018"])
    expect(diags[0]?.target).toBe("connector:J1.pin:1")
  })
  it("passes when each contact takes one wire", () => {
    const a = connector("J1", { mpn: "M-2", pinCount: 2 }, { pins: { 1: "A", 2: "B" } })
    const b = connector("J2", { mpn: "M-2B", pinCount: 2 }, { pins: { 1: "A", 2: "B" } })
    const { hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [
        wire("W1", a.pin(1), b.pin(1), { gauge: "24AWG", color: "red", length: 10 }),
        wire("W2", a.pin(2), b.pin(2), { gauge: "24AWG", color: "red", length: 10 })
      ]
    }))
    expect(run(hir)).toEqual([])
  })
})

describe("HK-CONN-019 contactCountExceedsPinCount", () => {
  it("errors when more cavities are populated than the housing has", () => {
    const a = connector("J1", { mpn: "OV-2", pinCount: 2 }, { pins: { 1: "A", 2: "B", 3: "C" } })
    const b = connector("J2", { mpn: "OV-2B", pinCount: 4 }, { pins: { 1: "A", 2: "B" } })
    const { hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [wire("W1", a.pin(1), b.pin(1), { gauge: "24AWG", color: "red", length: 10 })]
    }))
    const diags = only(hir, "contactCountExceedsPinCount")
    expect(diags.map((d) => d.code)).toEqual(["HK-CONN-019"])
    expect(diags[0]?.target).toBe("connector:J1")
    expect(diags[0]?.data).toMatchObject({ declaredPins: 3, pinCount: 2 })
  })
  it("passes at or below the cavity count", () => {
    const a = connector("J1", { mpn: "OK-2", pinCount: 2 }, { pins: { 1: "A", 2: "B" } })
    const b = connector("J2", { mpn: "OK-2B", pinCount: 2 }, { pins: { 1: "A" } })
    const { hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [wire("W1", a.pin(1), b.pin(1), { gauge: "24AWG", color: "red", length: 10 })]
    }))
    expect(only(hir, "contactCountExceedsPinCount")).toEqual([])
  })
})

describe("HK-CONN-020 cavityLayoutMismatch", () => {
  const mk = (rows: number, columns: number, pinCount: number) => {
    const a = connector("J1", { mpn: "CL", pinCount, cavityLayout: { rows, columns } }, { pins: { 1: "A" } })
    const b = connector("J2", { mpn: "CLB", pinCount: 2 }, { pins: { 1: "A" } })
    return compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [wire("W1", a.pin(1), b.pin(1), { gauge: "24AWG", color: "red", length: 10 })]
    })).hir
  }
  it("errors when rows×columns ≠ pinCount", () => {
    const diags = only(mk(2, 3, 4), "cavityLayoutMismatch")
    expect(diags.map((d) => d.code)).toEqual(["HK-CONN-020"])
  })
  it("passes when the grid matches", () => {
    expect(only(mk(2, 2, 4), "cavityLayoutMismatch")).toEqual([])
  })
})

describe("HK-MFG-008 nonPositiveWireLength", () => {
  it("errors on zero or negative length, passes on positive/absent", () => {
    const a = connector("J1", part, { pins: { 1: "VBAT_24V" } })
    const b = connector("J2", part, { pins: { 1: "VBAT_24V" } })
    const mk = (length: number) => compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [wire("W1", a.pin(1), b.pin(1), { gauge: "24AWG", color: "red", length })]
    })).hir
    expect(only(mk(0), "nonPositiveWireLength").map((d) => d.code)).toEqual(["HK-MFG-008"])
    expect(only(mk(-5), "nonPositiveWireLength").map((d) => d.code)).toEqual(["HK-MFG-008"])
    expect(only(mk(100), "nonPositiveWireLength")).toEqual([])
  })
})

describe("HK-MFG-009 branchParentInvalid", () => {
  const two = () => {
    const a = connector("J1", { mpn: "B-2", pinCount: 2 }, { pins: { 1: "S" } })
    const b = connector("J2", { mpn: "B-2B", pinCount: 2 }, { pins: { 1: "S" } })
    return { a, b, w: wire("W1", a.pin(1), b.pin(1), { gauge: "24AWG", color: "red", length: 10 }) }
  }
  it("errors on a parent that names no branch", () => {
    const { a, b, w } = two()
    const { hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b], wires: [w],
      branches: [branch("main", { path: [a, b], parent: "ghost", nominalLength: 100 })]
    }))
    expect(only(hir, "branchParentInvalid").map((d) => d.code)).toEqual(["HK-MFG-009"])
  })
  it("errors on a parent cycle", () => {
    const { a, b, w } = two()
    const { hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b], wires: [w],
      branches: [
        branch("b1", { path: [a, b], parent: "b2", nominalLength: 100 }),
        branch("b2", { path: [a, b], parent: "b1", nominalLength: 100 })
      ]
    }))
    expect(only(hir, "branchParentInvalid").length).toBeGreaterThan(0)
    expect(only(hir, "branchParentInvalid")[0]?.message).toContain("cycle")
  })
  it("passes for a valid parent chain or no parent", () => {
    const { a, b, w } = two()
    const { hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b], wires: [w],
      branches: [
        branch("trunk", { path: [a, b], nominalLength: 100 }),
        branch("leg", { path: [a, b], parent: "trunk", nominalLength: 50 })
      ]
    }))
    expect(only(hir, "branchParentInvalid")).toEqual([])
  })
})

describe("HK-MFG-010 cableConductorOverflow", () => {
  const mk = (conductors: number, wireCount: number) => {
    const a = connector("J1", { mpn: "C-8", pinCount: 8 }, { pins: Object.fromEntries(Array.from({ length: wireCount }, (_, i) => [i + 1, `S${i}`])) })
    const b = connector("J2", { mpn: "C-8B", pinCount: 8 }, { pins: Object.fromEntries(Array.from({ length: wireCount }, (_, i) => [i + 1, `S${i}`])) })
    return compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      cables: [cable("C1", { conductors })],
      wires: Array.from({ length: wireCount }, (_, i) =>
        wire(`W${i}`, a.pin(i + 1), b.pin(i + 1), { cable: "C1", gauge: "24AWG", color: "red", length: 10 }))
    })).hir
  }
  it("errors when members exceed conductors", () => {
    expect(only(mk(2, 3), "cableConductorOverflow").map((d) => d.code)).toEqual(["HK-MFG-010"])
  })
  it("passes at or under the conductor count (spares are legal)", () => {
    expect(only(mk(2, 2), "cableConductorOverflow")).toEqual([])
    expect(only(mk(4, 2), "cableConductorOverflow")).toEqual([])
  })
})

describe("HK-ELEC-006 orphanedDifferentialHalf", () => {
  const mk = (signals: ReadonlyArray<string>) => {
    const a = connector("J1", { mpn: "D-8", pinCount: 8 }, { pins: Object.fromEntries(signals.map((s, i) => [i + 1, s])) })
    const b = connector("J2", { mpn: "D-8B", pinCount: 8 }, { pins: Object.fromEntries(signals.map((s, i) => [i + 1, s])) })
    return compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: signals.map((s, i) => wire(`W${i}`, a.pin(i + 1), b.pin(i + 1), { signal: s, gauge: "24AWG", color: "red", length: 10 }))
    })).hir
  }
  it("errors on a lone CAN_H with no CAN_L anywhere", () => {
    const diags = only(mk(["CAN_H", "GND"]), "orphanedDifferentialHalf")
    expect(diags.map((d) => d.code)).toEqual(["HK-ELEC-006"])
    expect(diags[0]?.data).toMatchObject({ missingPartner: "CAN_L" })
  })
  it("passes when both halves are present", () => {
    expect(only(mk(["CAN_H", "CAN_L"]), "orphanedDifferentialHalf")).toEqual([])
  })
  it("ignores single-ended signals that merely end in _N", () => {
    expect(only(mk(["SENSE_N", "GND"]), "orphanedDifferentialHalf")).toEqual([])
  })
})

describe("HK-ELEC-007 twistGroupGaugeMismatch", () => {
  const mk = (g1: string, g2: string) => {
    const a = connector("J1", { mpn: "T-2", pinCount: 2 }, { pins: { 1: "CAN_H", 2: "CAN_L" } })
    const b = connector("J2", { mpn: "T-2B", pinCount: 2 }, { pins: { 1: "CAN_H", 2: "CAN_L" } })
    return compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [
        wire("W1", a.pin(1), b.pin(1), { signal: "CAN_H", twistGroup: "tp1", gauge: g1, color: "white", length: 10 }),
        wire("W2", a.pin(2), b.pin(2), { signal: "CAN_L", twistGroup: "tp1", gauge: g2, color: "blue", length: 10 })
      ]
    })).hir
  }
  it("warns when a twist group mixes gauges", () => {
    const diags = only(mk("24AWG", "22AWG"), "twistGroupGaugeMismatch")
    expect(diags.map((d) => d.code)).toEqual(["HK-ELEC-007"])
    expect(diags[0]?.severity).toBe("warning")
  })
  it("passes for a matched-gauge pair", () => {
    expect(only(mk("24AWG", "24AWG"), "twistGroupGaugeMismatch")).toEqual([])
  })
  it("does not fire when a group member has no gauge (defensive; HK-MFG-003 owns that)", () => {
    const a = connector("J1", { mpn: "T-2", pinCount: 2 }, { pins: { 1: "CAN_H", 2: "CAN_L" } })
    const b = connector("J2", { mpn: "T-2B", pinCount: 2 }, { pins: { 1: "CAN_H", 2: "CAN_L" } })
    const { hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [
        wire("W1", a.pin(1), b.pin(1), { signal: "CAN_H", twistGroup: "tp1", gauge: "24AWG", color: "white", length: 10 }),
        // No gauge on W2 — the rule skips it, leaving one known gauge in the group.
        wire("W2", a.pin(2), b.pin(2), { signal: "CAN_L", twistGroup: "tp1", color: "blue", length: 10 })
      ]
    }))
    expect(only(hir, "twistGroupGaugeMismatch")).toEqual([])
  })
})

describe("HK-CONN-015 reservedPinAssigned (broadened to terminal/seal/wire)", () => {
  it("fires when a wire lands on a reserved pin carrying no signal", () => {
    const a = connector("J1", { mpn: "RP", pinCount: 4, reservedPins: [4] }, { pins: { 1: "SIG" } })
    const b = connector("J2", { mpn: "RPB", pinCount: 4 }, { pins: { 1: "SIG" } })
    const { hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [
        wire("W1", a.pin(1), b.pin(1), { gauge: "24AWG", color: "red", length: 10 }),
        wire("W2", a.pin(4), b.pin(2), { gauge: "24AWG", color: "red", length: 10 })
      ]
    }))
    const diags = only(hir, "reservedPinAssigned")
    expect(diags.map((d) => d.target)).toEqual(["connector:J1.pin:4"])
    expect(diags[0]?.message).toContain("wire landed")
  })

  // The compiler only attaches terminals/seals to signal-bearing pins, so the
  // terminal/seal branches are exercised against directly-built HIR — the
  // shape a plugin or a cached harness.json could carry.
  const hirWithReservedPin = (pin: { pin: string; terminal?: string; seal?: string }): Hir => ({
    schemaVersion: "0.1.0",
    harness: { id: "t", revision: "A", units: "mm", metadata: {} },
    connectors: [{ ref: "J1", mpn: "RP", pinCount: 4, reservedPins: ["4"], pins: [pin] }],
    wires: [], cables: [], branches: [], splices: [], labels: [], bom: [],
    diagnostics: [], layoutHints: [], exports: {}
  })

  it("fires when a reserved pin has a terminal populated", () => {
    const diags = only(hirWithReservedPin({ pin: "4", terminal: "T-1" }), "reservedPinAssigned")
    expect(diags.map((d) => d.target)).toEqual(["connector:J1.pin:4"])
    expect(diags[0]?.message).toContain("terminal T-1")
  })
  it("fires when a reserved pin has a seal populated", () => {
    const diags = only(hirWithReservedPin({ pin: "4", seal: "S-1" }), "reservedPinAssigned")
    expect(diags.map((d) => d.target)).toEqual(["connector:J1.pin:4"])
    expect(diags[0]?.message).toContain("seal S-1")
  })
  it("stays silent for an empty reserved pin", () => {
    expect(only(hirWithReservedPin({ pin: "4" }), "reservedPinAssigned")).toEqual([])
  })
})

// --- EMC / environment / protection (tier-2 HIR fields) ---------------------

describe("HK-ELEC-008 emcAggressorVictimShareBranch", () => {
  const mk = (c1?: "aggressor" | "victim" | "neutral", c2?: "aggressor" | "victim" | "neutral") => {
    const a = connector("J1", { mpn: "E-2", pinCount: 2 }, { pins: { 1: "A", 2: "B" } })
    const b = connector("J2", { mpn: "E-2B", pinCount: 2 }, { pins: { 1: "A", 2: "B" } })
    return compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [
        wire("W1", a.pin(1), b.pin(1), c1 ? { gauge: "24AWG", color: "red", length: 10, emcClass: c1 } : { gauge: "24AWG", color: "red", length: 10 }),
        wire("W2", a.pin(2), b.pin(2), c2 ? { gauge: "24AWG", color: "black", length: 10, emcClass: c2 } : { gauge: "24AWG", color: "black", length: 10 })
      ],
      branches: [branch("main", { path: [a, b], nominalLength: 10 })]
    })).hir
  }
  it("warns when an aggressor and a victim share a branch", () => {
    const diags = only(mk("aggressor", "victim"), "emcAggressorVictimShareBranch")
    expect(diags.map((d) => d.code)).toEqual(["HK-ELEC-008"])
    expect(diags[0]?.severity).toBe("warning")
  })
  it("stays silent without both roles, or when wires are unclassified", () => {
    expect(only(mk("aggressor", "neutral"), "emcAggressorVictimShareBranch")).toEqual([])
    expect(only(mk(undefined, undefined), "emcAggressorVictimShareBranch")).toEqual([])
    // One classified wire, one unclassified — needs BOTH roles present to fire.
    expect(only(mk("aggressor", undefined), "emcAggressorVictimShareBranch")).toEqual([])
    expect(only(mk(undefined, "victim"), "emcAggressorVictimShareBranch")).toEqual([])
  })
})

describe("HK-ELEC-009 wireTempBelowAmbient", () => {
  const mk = (rating: number | undefined, ambient: number | undefined) => {
    const a = connector("J1", { mpn: "TH-2", pinCount: 2 }, { pins: { 1: "A" } })
    const b = connector("J2", { mpn: "TH-2B", pinCount: 2 }, { pins: { 1: "A" } })
    return compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [wire("W1", a.pin(1), b.pin(1), rating !== undefined ? { gauge: "24AWG", color: "red", length: 10, temperatureRating: rating } : { gauge: "24AWG", color: "red", length: 10 })],
      branches: [branch("main", ambient !== undefined ? { path: [a, b], nominalLength: 10, ambientTemperatureC: ambient } : { path: [a, b], nominalLength: 10 })]
    })).hir
  }
  it("errors when a wire's rating is below the branch ambient", () => {
    expect(only(mk(85, 105), "wireTempBelowAmbient").map((d) => d.code)).toEqual(["HK-ELEC-009"])
  })
  it("passes at or above ambient, or when either value is absent", () => {
    expect(only(mk(125, 105), "wireTempBelowAmbient")).toEqual([])
    expect(only(mk(undefined, 105), "wireTempBelowAmbient")).toEqual([])
    expect(only(mk(85, undefined), "wireTempBelowAmbient")).toEqual([])
  })
})

describe("HK-ELEC-010 overcurrentExceedsConductor", () => {
  // 22AWG bundled ampacity is 2.3A in the shipped table.
  const mk = (ratingA: number, gauge = "22AWG") => {
    const a = connector("J1", { mpn: "F-2", pinCount: 2 }, { pins: { 1: "PWR" } })
    const b = connector("J2", { mpn: "F-2B", pinCount: 2 }, { pins: { 1: "PWR" } })
    return compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [wire("W1", a.pin(1), b.pin(1), { gauge, color: "red", length: 10, signal: "VBAT_12V" })],
      protections: [protection("F1", { kind: "fuse", ratingA, protects: ["W1"] })]
    })).hir
  }
  it("errors when the device out-rates the thinnest protected conductor", () => {
    const diags = only(mk(5), "overcurrentExceedsConductor")
    expect(diags.map((d) => d.code)).toEqual(["HK-ELEC-010"])
    expect(diags[0]?.data).toMatchObject({ ratingA: 5, conductorAmpacityA: 2.3, governingWire: "W1" })
  })
  it("passes when the device protects the conductor", () => {
    expect(only(mk(2), "overcurrentExceedsConductor")).toEqual([])
  })
  it("passes at exactly the conductor ampacity (strict >)", () => {
    expect(only(mk(2.3), "overcurrentExceedsConductor")).toEqual([])
  })
  it("is silent when no protections are declared", () => {
    const a = connector("J1", { mpn: "N-2", pinCount: 2 }, { pins: { 1: "PWR" } })
    const b = connector("J2", { mpn: "N-2B", pinCount: 2 }, { pins: { 1: "PWR" } })
    const { hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [wire("W1", a.pin(1), b.pin(1), { gauge: "22AWG", color: "red", length: 10 })]
    }))
    expect(only(hir, "overcurrentExceedsConductor")).toEqual([])
  })
})

describe("compiler validates protections", () => {
  it("HK-PROT-002 flags a protection guarding an undefined wire", () => {
    const a = connector("J1", { mpn: "P-2", pinCount: 2 }, { pins: { 1: "PWR" } })
    const b = connector("J2", { mpn: "P-2B", pinCount: 2 }, { pins: { 1: "PWR" } })
    const { diagnostics, hir } = compileDesign(harness("t", {
      revision: "A", units: "mm", connectors: [a, b],
      wires: [wire("W1", a.pin(1), b.pin(1), { gauge: "22AWG", color: "red", length: 10 })],
      protections: [protection("F1", { kind: "fuse", ratingA: 2, protects: ["W1", "GHOST"] })]
    }))
    expect(diagnostics.map((d) => d.code)).toContain("HK-PROT-002")
    expect(hir.protections?.[0]).toMatchObject({ id: "F1", kind: "fuse", ratingA: 2 })
  })
})

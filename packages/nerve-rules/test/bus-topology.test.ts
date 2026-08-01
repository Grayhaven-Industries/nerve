/**
 * HK-ELEC-018..021 (CAN bus topology). vitest 4.1.10 at the workspace root
 * (`vitest@3.2.7` inside this package); `describe`/`it`/`expect` per the
 * documented v4 API.
 */
import { describe, expect, it } from "vitest"
import {
  compileDesign,
  connector,
  harness,
  runRules,
  splice,
  wire,
  type ConnectorInstance,
  type ConnectorPart,
  type Hir,
  type PinElectrical,
  type SpliceDef,
  type Units,
  type WireDef
} from "@grayhaven/nerve"
import {
  busTopologyRules,
  canBusNotLinear,
  canStubTooLong,
  canTerminationCountWrong,
  canTerminationNotAtBusEnd
} from "../src/bus-topology.js"

const part: ConnectorPart = { mpn: "CAN-4", pinCount: 4 }

interface NodeOpts {
  /** Pin → signal. Defaults to a CAN_H/CAN_L pair on pins 1 and 2. */
  readonly pins?: Readonly<Record<string, string>>
  /** Termination fitted across the pair at this connector, ohms. An explicit
   * `undefined` overrides a default in a spread, so both are admitted. */
  readonly terminationOhms?: number | undefined
  readonly bitRateKbps?: number | undefined
  /** Pin the termination/bit rate is declared on. */
  readonly on?: string
}

/** A CAN node: a connector carrying one CAN_H/CAN_L pair, optionally terminated. */
const node = (ref: string, opts: NodeOpts = {}): ConnectorInstance => {
  const pins = opts.pins ?? { 1: "CAN_H", 2: "CAN_L" }
  const electrical: PinElectrical = {
    ...(opts.terminationOhms !== undefined ? { terminationOhms: opts.terminationOhms } : {}),
    ...(opts.bitRateKbps !== undefined ? { bitRateKbps: opts.bitRateKbps } : {})
  }
  return connector(ref, part, {
    pins,
    ...(Object.keys(electrical).length > 0
      ? { electrical: { [opts.on ?? "1"]: electrical } }
      : {})
  })
}

const build = (opts: {
  readonly connectors: ReadonlyArray<ConnectorInstance>
  readonly wires: ReadonlyArray<WireDef>
  readonly splices?: ReadonlyArray<SpliceDef>
  readonly units?: Units
}): Hir =>
  compileDesign(
    harness("can-topology-fixture", {
      revision: "A",
      units: opts.units ?? "mm",
      connectors: opts.connectors,
      wires: opts.wires,
      splices: opts.splices ?? []
    })
  ).hir

const findings = (hir: Hir) => runRules(hir, busTopologyRules)
const codes = (hir: Hir): ReadonlyArray<string> => findings(hir).map((d) => d.code)
const codesFor = (hir: Hir, code: string) => findings(hir).filter((d) => d.code === code)

/** J1 =W1/W2= J2: two nodes, one CAN_H and one CAN_L wire, both ends terminated. */
const linearBus = (
  left: NodeOpts = {},
  right: NodeOpts = {}
): Hir => {
  const j1 = node("J1", { terminationOhms: 120, bitRateKbps: 500, ...left })
  const j2 = node("J2", { terminationOhms: 120, ...right })
  return build({
    connectors: [j1, j2],
    wires: [
      wire("W1", j1.pin(1), j2.pin(1), { signal: "CAN_H", length: 1000 }),
      wire("W2", j1.pin(2), j2.pin(2), { signal: "CAN_L", length: 1000 })
    ]
  })
}

/**
 * A tee: trunk J1 — S1 — J2 with a drop S1 — J3.
 * `dropLength` is in mm; `kbps` is declared on J1 unless left undefined.
 */
const teeBus = (dropLength: number | undefined, kbps: number | undefined): Hir => {
  const j1 = node("J1", {
    terminationOhms: 120,
    ...(kbps !== undefined ? { bitRateKbps: kbps } : {})
  })
  const j2 = node("J2", { terminationOhms: 120 })
  const j3 = node("J3", { pins: { 1: "CAN_H" } })
  const s1 = splice("S1", { type: "crimp" })
  return build({
    connectors: [j1, j2, j3],
    splices: [s1],
    wires: [
      wire("W1", j1.pin(1), s1, { signal: "CAN_H", length: 1000 }),
      wire("W2", s1, j2.pin(1), { signal: "CAN_H", length: 1000 }),
      wire("W3", s1, j3.pin(1), {
        signal: "CAN_H",
        ...(dropLength !== undefined ? { length: dropLength } : {})
      }),
      wire("W4", j1.pin(2), j2.pin(2), { signal: "CAN_L", length: 2000 })
    ]
  })
}

describe("HK-ELEC-018 termination count", () => {
  it("passes a correct two-terminator linear bus", () => {
    expect(codes(linearBus())).toEqual([])
  })

  it("fails a bus with one terminator", () => {
    const found = codesFor(linearBus({}, { terminationOhms: undefined }), "HK-ELEC-018")
    expect(found).toHaveLength(1)
    expect(found[0]?.severity).toBe("error")
    expect(found[0]?.data).toMatchObject({ bus: "CAN", terminations: 1, expected: 2 })
  })

  it("fails a bus with no terminator", () => {
    const found = codesFor(
      linearBus({ terminationOhms: undefined }, { terminationOhms: undefined }),
      "HK-ELEC-018"
    )
    expect(found).toHaveLength(1)
    expect(found[0]?.data).toMatchObject({ terminations: 0 })
  })

  it("fails a bus with three terminators", () => {
    // J1 = J2 = J3 daisy chain, every node terminated.
    const j1 = node("J1", { terminationOhms: 120 })
    const j2 = node("J2", {
      pins: { 1: "CAN_H", 2: "CAN_L", 3: "CAN_H", 4: "CAN_L" },
      terminationOhms: 120
    })
    const j3 = node("J3", { terminationOhms: 120 })
    const hir = build({
      connectors: [j1, j2, j3],
      wires: [
        wire("W1", j1.pin(1), j2.pin(1), { signal: "CAN_H", length: 500 }),
        wire("W2", j1.pin(2), j2.pin(2), { signal: "CAN_L", length: 500 }),
        wire("W3", j2.pin(3), j3.pin(1), { signal: "CAN_H", length: 500 }),
        wire("W4", j2.pin(4), j3.pin(2), { signal: "CAN_L", length: 500 })
      ]
    })
    const found = codesFor(hir, "HK-ELEC-018")
    expect(found).toHaveLength(1)
    expect(found[0]?.data).toMatchObject({ terminations: 3, expected: 2 })
    // Count is the only complaint: nothing is misplaced or non-linear.
    expect(codes(hir)).toEqual(["HK-ELEC-018"])
  })

  it("warns when a fitted termination is nowhere near 120 ohms", () => {
    const found = codesFor(linearBus({ terminationOhms: 60 }), "HK-ELEC-018")
    expect(found).toHaveLength(1)
    expect(found[0]?.severity).toBe("warning")
    expect(found[0]?.data).toMatchObject({ terminationOhms: 60, nominalOhms: 120 })
  })

  it("counts a termination declared on both halves at one connector once", () => {
    const j1 = connector("J1", part, {
      pins: { 1: "CAN_H", 2: "CAN_L" },
      electrical: { 1: { terminationOhms: 120 }, 2: { terminationOhms: 120 } }
    })
    const j2 = node("J2", { terminationOhms: 120 })
    const hir = build({
      connectors: [j1, j2],
      wires: [
        wire("W1", j1.pin(1), j2.pin(1), { signal: "CAN_H", length: 800 }),
        wire("W2", j1.pin(2), j2.pin(2), { signal: "CAN_L", length: 800 })
      ]
    })
    expect(codes(hir)).toEqual([])
  })
})

describe("HK-ELEC-019 termination placement", () => {
  it("fails a termination that is not at a degree-1 end of the trunk", () => {
    // J1 — J2 — J3, terminated at J1 (an end) and J2 (the middle).
    const j1 = node("J1", { terminationOhms: 120 })
    const j2 = node("J2", { terminationOhms: 120 })
    const j3 = node("J3")
    const hir = build({
      connectors: [j1, j2, j3],
      wires: [
        wire("W1", j1.pin(1), j2.pin(1), { signal: "CAN_H", length: 500 }),
        wire("W2", j2.pin(1), j3.pin(1), { signal: "CAN_H", length: 500 }),
        wire("W3", j1.pin(2), j2.pin(2), { signal: "CAN_L", length: 500 }),
        wire("W4", j2.pin(2), j3.pin(2), { signal: "CAN_L", length: 500 })
      ]
    })
    const found = codesFor(hir, "HK-ELEC-019")
    expect(found).toHaveLength(1)
    expect(found[0]?.severity).toBe("error")
    expect(found[0]?.target).toBe("connector:J2.pin:1")
    expect(found[0]?.data).toMatchObject({ busWiresOnNode: 2, expected: 1 })
    // The count is right, so 018 stays quiet: only the placement is wrong.
    expect(codes(hir)).toEqual(["HK-ELEC-019"])
  })

  it("passes terminations at both degree-1 ends", () => {
    expect(codesFor(linearBus(), "HK-ELEC-019")).toEqual([])
  })
})

describe("HK-ELEC-020 linear topology", () => {
  it("warns at a tee junction", () => {
    const found = codesFor(teeBus(100, 1000), "HK-ELEC-020")
    expect(found).toHaveLength(1)
    expect(found[0]?.severity).toBe("warning")
    expect(found[0]?.target).toBe("splice:S1")
    expect(found[0]?.data).toMatchObject({ bus: "CAN", busWiresOnNode: 3 })
  })

  it("warns, not errors, at a star junction — degree alone cannot convict a splice pack", () => {
    const j1 = node("J1", { terminationOhms: 120, bitRateKbps: 1000 })
    const j2 = node("J2", { terminationOhms: 120 })
    const j3 = node("J3", { pins: { 1: "CAN_H" } })
    const j4 = node("J4", { pins: { 1: "CAN_H" } })
    const s1 = splice("S1", { type: "crimp" })
    const hir = build({
      connectors: [j1, j2, j3, j4],
      splices: [s1],
      wires: [
        wire("W1", j1.pin(1), s1, { signal: "CAN_H", length: 100 }),
        wire("W2", s1, j2.pin(1), { signal: "CAN_H", length: 100 }),
        wire("W3", s1, j3.pin(1), { signal: "CAN_H", length: 100 }),
        wire("W4", s1, j4.pin(1), { signal: "CAN_H", length: 100 })
      ]
    })
    const found = codesFor(hir, "HK-ELEC-020")
    expect(found).toHaveLength(1)
    // A splice pack and a harmful star are the same graph; only stub length
    // separates them, and that is HK-ELEC-021's judgment. See the rule's JSDoc.
    expect(found[0]?.severity).toBe("warning")
    expect(found[0]?.data).toMatchObject({ busWiresOnNode: 4 })
  })

  it("errors on a ring", () => {
    const j1 = node("J1", { pins: { 1: "CAN_H" } })
    const j2 = node("J2", { pins: { 1: "CAN_H" } })
    const j3 = node("J3", { pins: { 1: "CAN_H" } })
    const hir = build({
      connectors: [j1, j2, j3],
      wires: [
        wire("W1", j1.pin(1), j2.pin(1), { signal: "CAN_H", length: 500 }),
        wire("W2", j2.pin(1), j3.pin(1), { signal: "CAN_H", length: 500 }),
        wire("W3", j3.pin(1), j1.pin(1), { signal: "CAN_H", length: 500 })
      ]
    })
    const found = codesFor(hir, "HK-ELEC-020")
    expect(found).toHaveLength(1)
    expect(found[0]?.severity).toBe("error")
    expect(found[0]?.data).toMatchObject({ bus: "CAN", closingWire: "W3" })
    expect(found[0]?.message).toContain("ring")
  })

  it("passes a linear bus", () => {
    expect(codesFor(linearBus(), "HK-ELEC-020")).toEqual([])
  })
})

describe("HK-ELEC-021 stub length", () => {
  it("fails a 0.5m stub at 1 Mbit/s", () => {
    const found = codesFor(teeBus(500, 1000), "HK-ELEC-021")
    expect(found).toHaveLength(1)
    expect(found[0]?.severity).toBe("error")
    expect(found[0]?.target).toBe("connector:J3.pin:1")
    expect(found[0]?.data).toMatchObject({
      bus: "CAN",
      stubLengthM: 0.5,
      limitM: 0.3,
      bitRateKbps: 1000
    })
  })

  it("passes the same 0.5m stub at 125 kbit/s", () => {
    expect(codesFor(teeBus(500, 125), "HK-ELEC-021")).toEqual([])
  })

  it("resolves an untabulated bit rate to the stricter neighbour", () => {
    // 250 kbit/s takes the 500 kbit/s budget (0.75m), so 800mm fails.
    const found = codesFor(teeBus(800, 250), "HK-ELEC-021")
    expect(found).toHaveLength(1)
    expect(found[0]?.data).toMatchObject({ bitRateKbps: 250, budgetFromKbps: 500, limitM: 0.75 })
  })

  it("reports at info, not error, when the bus declares no bit rate", () => {
    const found = codesFor(teeBus(5000, undefined), "HK-ELEC-021")
    expect(found).toHaveLength(1)
    expect(found[0]?.severity).toBe("info")
    expect(found[0]?.message).toContain("could not be evaluated")
    expect(found[0]?.data).toMatchObject({ bus: "CAN", stubs: 1 })
  })

  it("stays silent on a stub whose wire declares no length", () => {
    expect(codesFor(teeBus(undefined, 1000), "HK-ELEC-021")).toEqual([])
  })

  it("measures stubs in inches when the harness is imperial", () => {
    const j1 = node("J1", { terminationOhms: 120, bitRateKbps: 1000 })
    const j2 = node("J2", { terminationOhms: 120 })
    const j3 = node("J3", { pins: { 1: "CAN_H" } })
    const s1 = splice("S1", { type: "crimp" })
    const hir = build({
      units: "in",
      connectors: [j1, j2, j3],
      splices: [s1],
      wires: [
        wire("W1", j1.pin(1), s1, { signal: "CAN_H", length: 40 }),
        wire("W2", s1, j2.pin(1), { signal: "CAN_H", length: 40 }),
        // 24in = 0.61m, over the 0.3m budget at 1 Mbit/s.
        wire("W3", s1, j3.pin(1), { signal: "CAN_H", length: 24 })
      ]
    })
    const found = codesFor(hir, "HK-ELEC-021")
    expect(found).toHaveLength(1)
    expect(found[0]?.data).toMatchObject({ stubLengthM: 0.61, limitM: 0.3 })
  })

  it("does not treat a terminated trunk end as a stub", () => {
    expect(codesFor(linearBus(), "HK-ELEC-021")).toEqual([])
  })
})

describe("scope and determinism", () => {
  it("produces nothing for a harness with no CAN signals", () => {
    const j1 = node("J1", { pins: { 1: "VBAT_24V", 2: "GND" } })
    const j2 = node("J2", { pins: { 1: "VBAT_24V", 2: "GND" } })
    const hir = build({
      connectors: [j1, j2],
      wires: [
        wire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V", length: 500 }),
        wire("W2", j1.pin(2), j2.pin(2), { signal: "GND", length: 500 })
      ]
    })
    expect(findings(hir)).toEqual([])
  })

  it("ignores a termination on a pin no CAN wire reaches", () => {
    const j1 = node("J1", { pins: { 1: "VBAT_24V" }, terminationOhms: 120 })
    const j2 = node("J2", { pins: { 1: "VBAT_24V" } })
    const hir = build({
      connectors: [j1, j2],
      wires: [wire("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V", length: 500 })]
    })
    expect(findings(hir)).toEqual([])
  })

  it("keys buses independently, so two CAN buses are counted apart", () => {
    // CAN1 correctly terminated; CAN2 has a single terminator.
    const j1 = connector("J1", part, {
      pins: { 1: "CAN1_H", 2: "CAN1_L", 3: "CAN2_H", 4: "CAN2_L" },
      electrical: { 1: { terminationOhms: 120 }, 3: { terminationOhms: 120 } }
    })
    const j2 = connector("J2", part, {
      pins: { 1: "CAN1_H", 2: "CAN1_L", 3: "CAN2_H", 4: "CAN2_L" },
      electrical: { 1: { terminationOhms: 120 } }
    })
    const hir = build({
      connectors: [j1, j2],
      wires: [
        wire("W1", j1.pin(1), j2.pin(1), { signal: "CAN1_H", length: 500 }),
        wire("W2", j1.pin(2), j2.pin(2), { signal: "CAN1_L", length: 500 }),
        wire("W3", j1.pin(3), j2.pin(3), { signal: "CAN2_H", length: 500 }),
        wire("W4", j1.pin(4), j2.pin(4), { signal: "CAN2_L", length: 500 })
      ]
    })
    const found = codesFor(hir, "HK-ELEC-018")
    expect(found).toHaveLength(1)
    expect(found[0]?.data).toMatchObject({ bus: "CAN2", terminations: 1 })
  })

  it("is deterministic: the same design twice yields byte-identical diagnostics", () => {
    const a = findings(teeBus(500, 1000))
    const b = findings(teeBus(500, 1000))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.length).toBeGreaterThan(0)
  })

  it("cites the standard without inventing a clause", () => {
    for (const r of busTopologyRules) {
      expect(r.standard).toBe("ISO 11898-2")
      expect(r.ruleVersion).toBe("1.0.0")
      expect(r.clause).toBeUndefined()
    }
    expect(busTopologyRules.map((r) => r.code)).toEqual([
      "HK-ELEC-018",
      "HK-ELEC-019",
      "HK-ELEC-020",
      "HK-ELEC-021"
    ])
    expect([
      canTerminationCountWrong,
      canTerminationNotAtBusEnd,
      canBusNotLinear,
      canStubTooLong
    ].map((r) => r.name)).toEqual([
      "canTerminationCountWrong",
      "canTerminationNotAtBusEnd",
      "canBusNotLinear",
      "canStubTooLong"
    ])
  })
})

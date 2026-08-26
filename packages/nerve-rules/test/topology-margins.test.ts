/**
 * Margins on the bus and return-path topology rules (HK-ELEC-018..023).
 *
 * These assert the *second* channel: what a rule reports when nothing is wrong.
 * A stub at 95% of budget and one at 20% produce identical diagnostics — both
 * produce none — so the only place that difference can be observed is here.
 *
 * Two properties are load-bearing and each has a test below: margins are
 * emitted on passing evaluations (not only failing ones), and they are emitted
 * ONLY where the underlying quantity is genuinely continuous with a stated
 * budget. Counts (terminators, ground return paths, shield ties) get nothing.
 *
 * vitest 4.1.10, resolved by bun.lock from the root `^4.1.10` range
 * (`vitest@3.2.7` inside this package). `describe`/`it`/`expect` with
 * `toBeCloseTo` for float comparisons, per the documented v4 API.
 */
import { describe, expect, it } from "vitest"
import {
  compileDesign,
  connector,
  harness,
  runRules,
  runRulesWithMargins,
  splice,
  wire,
  type ConnectorInstance,
  type ConnectorPart,
  type Hir,
  type Margin,
  type PinElectrical,
  type Rule,
  type SpliceDef,
  type Units,
  type WireDef
} from "@grayhaven/nerve"
import { busTopologyRules } from "../src/bus-topology.js"
import { groundLoop, shieldTerminationScheme } from "../src/ground-shield.js"

const part: ConnectorPart = { mpn: "CAN-4", pinCount: 4 }

/** Every rule this task owns, so a margin can never leak in from a neighbour. */
const topologyRules: ReadonlyArray<Rule> = [
  ...busTopologyRules,
  groundLoop,
  shieldTerminationScheme
]

interface NodeOpts {
  readonly pins?: Readonly<Record<string, string>>
  readonly terminationOhms?: number | undefined
  readonly bitRateKbps?: number | undefined
  readonly on?: string
}

/** `PinElectrical` with its readonly lifted, so a fixture can add only the
 * semantics it was asked for. */
type PinElectricalDraft = { -readonly [K in keyof PinElectrical]: PinElectrical[K] }

/** A CAN node: a connector carrying one CAN_H/CAN_L pair, optionally terminated. */
const node = (ref: string, opts: NodeOpts = {}): ConnectorInstance => {
  const pins = opts.pins ?? { 1: "CAN_H", 2: "CAN_L" }
  const electrical: PinElectricalDraft = {}
  if (opts.terminationOhms !== undefined) electrical.terminationOhms = opts.terminationOhms
  if (opts.bitRateKbps !== undefined) electrical.bitRateKbps = opts.bitRateKbps
  return Object.keys(electrical).length > 0
    ? connector(ref, part, { pins, electrical: { [opts.on ?? "1"]: electrical } })
    : connector(ref, part, { pins })
}

const build = (opts: {
  readonly connectors: ReadonlyArray<ConnectorInstance>
  readonly wires: ReadonlyArray<WireDef>
  readonly splices?: ReadonlyArray<SpliceDef>
  readonly units?: Units
}): Hir =>
  compileDesign(
    harness("topology-margins-fixture", {
      revision: "A",
      units: opts.units ?? "mm",
      connectors: opts.connectors,
      wires: opts.wires,
      splices: opts.splices ?? []
    })
  ).hir

const run = (hir: Hir) => runRulesWithMargins(hir, topologyRules)
const margins = (hir: Hir): ReadonlyArray<Margin> => run(hir).margins
const quantity = (hir: Hir, q: string): ReadonlyArray<Margin> =>
  margins(hir).filter((m) => m.quantity === q)
const codesFor = (hir: Hir, code: string) =>
  run(hir).diagnostics.filter((d) => d.code === code)

/** J1 =W1/W2= J2: a plain terminated trunk, no drops. */
const linearBus = (left: NodeOpts = {}, right: NodeOpts = {}): Hir => {
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

/** Trunk J1 — S1 — J2 (1 m each) with a drop S1 — J3 of `dropLength` mm. */
const teeBus = (dropLength: number | undefined, kbps: number | undefined): Hir => {
  const j1 = node("J1", { terminationOhms: 120, bitRateKbps: kbps })
  const j2 = node("J2", { terminationOhms: 120 })
  const j3 = node("J3", { pins: { 1: "CAN_H" } })
  const s1 = splice("S1", { type: "crimp" })
  return build({
    connectors: [j1, j2, j3],
    splices: [s1],
    wires: [
      wire("W1", j1.pin(1), s1, { signal: "CAN_H", length: 1000 }),
      wire("W2", s1, j2.pin(1), { signal: "CAN_H", length: 1000 }),
      wire(
        "W3",
        s1,
        j3.pin(1),
        dropLength !== undefined ? { signal: "CAN_H", length: dropLength } : { signal: "CAN_H" }
      ),
      wire("W4", j1.pin(2), j2.pin(2), { signal: "CAN_L", length: 2000 })
    ]
  })
}

/** Trunk J1 — S1 — J2 with two drops off S1, so several stubs coexist. */
const multiDropBus = (dropA: number, dropB: number, kbps: number): Hir => {
  const j1 = node("J1", { terminationOhms: 120, bitRateKbps: kbps })
  const j2 = node("J2", { terminationOhms: 120 })
  const j3 = node("J3", { pins: { 1: "CAN_H" } })
  const j4 = node("J4", { pins: { 1: "CAN_H" } })
  const s1 = splice("S1", { type: "crimp" })
  return build({
    connectors: [j1, j2, j3, j4],
    splices: [s1],
    wires: [
      wire("W1", j1.pin(1), s1, { signal: "CAN_H", length: 1000 }),
      wire("W2", s1, j2.pin(1), { signal: "CAN_H", length: 1000 }),
      wire("W3", s1, j3.pin(1), { signal: "CAN_H", length: dropA }),
      wire("W4", s1, j4.pin(1), { signal: "CAN_H", length: dropB }),
      wire("W5", j1.pin(2), j2.pin(2), { signal: "CAN_L", length: 2000 })
    ]
  })
}

describe("HK-ELEC-021 stub length margin", () => {
  it("measures a comfortably passing stub, which reports no diagnostic at all", () => {
    // 0.1 m drop against the 0.75 m budget at 500 kbit/s.
    const hir = teeBus(100, 500)
    expect(codesFor(hir, "HK-ELEC-021")).toEqual([])

    const stubs = quantity(hir, "stub length")
    expect(stubs).toHaveLength(1)
    expect(stubs[0]).toMatchObject({
      code: "HK-ELEC-021",
      target: "connector:J3.pin:1",
      measured: 0.1,
      limit: 0.75,
      unit: "m"
    })
    expect(stubs[0]!.utilization).toBeCloseTo(0.1333, 4)
    expect(stubs[0]!.margin).toBeCloseTo(0.8667, 4)
  })

  it("puts a just-inside and a just-outside stub either side of 1", () => {
    // 0.3 m budget at 1 Mbit/s.
    const inside = quantity(teeBus(290, 1000), "stub length")
    expect(inside).toHaveLength(1)
    expect(inside[0]!.utilization).toBeCloseTo(0.9667, 4)
    expect(inside[0]!.utilization).toBeLessThan(1)
    expect(inside[0]!.margin).toBeGreaterThan(0)
    expect(codesFor(teeBus(290, 1000), "HK-ELEC-021")).toEqual([])

    const outside = quantity(teeBus(310, 1000), "stub length")
    expect(outside).toHaveLength(1)
    expect(outside[0]!.utilization).toBeCloseTo(1.0333, 4)
    expect(outside[0]!.utilization).toBeGreaterThan(1)
    expect(outside[0]!.margin).toBeLessThan(0)
    // Only the over-budget drop produces a finding; both produce a margin.
    expect(codesFor(teeBus(310, 1000), "HK-ELEC-021")).toHaveLength(1)
  })

  it("measures every stub on a multi-drop bus, not just the worst", () => {
    const hir = multiDropBus(100, 200, 1000)
    const stubs = quantity(hir, "stub length")
    expect(stubs.map((m) => m.target)).toEqual([
      "connector:J3.pin:1",
      "connector:J4.pin:1"
    ])
    expect(stubs.map((m) => m.measured)).toEqual([0.1, 0.2])
    expect(stubs[0]!.utilization).toBeCloseTo(1 / 3, 6)
    expect(stubs[1]!.utilization).toBeCloseTo(2 / 3, 6)
    // Nothing failed, so the margins are the only record of the difference.
    expect(codesFor(hir, "HK-ELEC-021")).toEqual([])
  })

  it("emits no stub margin when the bus declares no bit rate", () => {
    // The budget is unknown, so there is no honest denominator. The rule still
    // says so at info; it does not fall back to the strictest rate.
    const hir = teeBus(500, undefined)
    expect(quantity(hir, "stub length")).toEqual([])
    expect(margins(hir)).toEqual([])
    expect(codesFor(hir, "HK-ELEC-021")).toHaveLength(1)
  })

  it("emits no stub margin when the drop declares no length", () => {
    expect(quantity(teeBus(undefined, 1000), "stub length")).toEqual([])
  })

  it("converts through harness units rather than assuming millimetres", () => {
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
        // 6in = 0.152 m, inside the 0.3 m budget at 1 Mbit/s.
        wire("W3", s1, j3.pin(1), { signal: "CAN_H", length: 6 })
      ]
    })
    const stubs = quantity(hir, "stub length")
    expect(stubs).toHaveLength(1)
    expect(stubs[0]!.measured).toBeCloseTo(0.152, 3)
    expect(stubs[0]!.unit).toBe("m")
    expect(codesFor(hir, "HK-ELEC-021")).toEqual([])
  })
})

describe("HK-ELEC-021 bus length margin", () => {
  it("measures a passing bus against the total-length budget", () => {
    const buses = quantity(linearBus(), "bus length")
    expect(buses).toHaveLength(1)
    expect(buses[0]).toMatchObject({
      code: "HK-ELEC-021",
      target: "wire:W1",
      measured: 1,
      limit: 100, // 500 kbit/s
      unit: "m"
    })
    expect(buses[0]!.utilization).toBeCloseTo(0.01, 6)
  })

  it("takes the longest end-to-end run, not the sum of the wires", () => {
    // Trunk is 1 m + 1 m with a 0.1 m drop, on both a CAN_H and a CAN_L
    // component. Summing every wire would say 5.1 m; the bus is 2 m long.
    const buses = quantity(teeBus(100, 500), "bus length")
    expect(buses).toHaveLength(1)
    expect(buses[0]!.measured).toBe(2)
  })

  it("emits nothing when a bus wire declares no length or the bus is a ring", () => {
    expect(quantity(teeBus(undefined, 1000), "bus length")).toEqual([])

    const j1 = node("J1", { pins: { 1: "CAN_H" }, bitRateKbps: 500 })
    const j2 = node("J2", { pins: { 1: "CAN_H" } })
    const j3 = node("J3", { pins: { 1: "CAN_H" } })
    const ring = build({
      connectors: [j1, j2, j3],
      wires: [
        wire("W1", j1.pin(1), j2.pin(1), { signal: "CAN_H", length: 500 }),
        wire("W2", j2.pin(1), j3.pin(1), { signal: "CAN_H", length: 500 }),
        wire("W3", j3.pin(1), j1.pin(1), { signal: "CAN_H", length: 500 })
      ]
    })
    expect(quantity(ring, "bus length")).toEqual([])
    expect(codesFor(ring, "HK-ELEC-020")).toHaveLength(1)
  })

  it("emits nothing when the bus declares no bit rate", () => {
    const hir = linearBus({ bitRateKbps: undefined })
    expect(quantity(hir, "bus length")).toEqual([])
  })
})

describe("discrete rules stay silent", () => {
  it("HK-ELEC-018 measures neither terminator count nor resistance", () => {
    // One terminator (a count defect) and a 60 ohm value (a band defect):
    // both report, neither has an honest continuous budget.
    const hir = linearBus({ terminationOhms: 60 }, { terminationOhms: undefined })
    expect(codesFor(hir, "HK-ELEC-018").length).toBeGreaterThan(0)
    expect(margins(hir).filter((m) => m.code === "HK-ELEC-018")).toEqual([])
  })

  it("HK-ELEC-019 does not measure termination placement", () => {
    const j1 = node("J1", { terminationOhms: 120, bitRateKbps: 500 })
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
    expect(codesFor(hir, "HK-ELEC-019")).toHaveLength(1)
    expect(margins(hir).filter((m) => m.code === "HK-ELEC-019")).toEqual([])
  })

  it("HK-ELEC-020 does not measure node degree", () => {
    const hir = multiDropBus(100, 200, 1000)
    expect(codesFor(hir, "HK-ELEC-020")).toHaveLength(1)
    expect(margins(hir).filter((m) => m.code === "HK-ELEC-020")).toEqual([])
  })

  it("HK-ELEC-022 does not measure a ground loop", () => {
    const gPart: ConnectorPart = { mpn: "GS-4", pinCount: 4 }
    const g1 = connector("G1", gPart, { pins: { 1: "GND" } })
    const g2 = connector("G2", gPart, { pins: { 1: "GND" } })
    const s1 = splice("S1", { type: "crimp" })
    const hir = build({
      connectors: [g1, g2],
      splices: [s1],
      wires: [
        wire("W1", g1.pin(1), s1, { signal: "GND", length: 100 }),
        wire("W2", g2.pin(1), s1, { signal: "GND", length: 100 }),
        wire("W3", g1.pin(1), g2.pin(1), { signal: "GND", length: 100 })
      ]
    })
    expect(codesFor(hir, "HK-ELEC-022")).toHaveLength(1)
    expect(margins(hir)).toEqual([])
  })

  it("HK-ELEC-023 does not measure the shield termination scheme", () => {
    const gPart: ConnectorPart = { mpn: "GS-4", pinCount: 4 }
    const g1 = connector("G1", gPart, { pins: { 1: "SHIELD_DRAIN" } })
    const g2 = connector("G2", gPart, { pins: { 1: "SHIELD_DRAIN" } })
    const hir = build({
      connectors: [g1, g2],
      wires: [
        wire("W1", g1.pin(1), g2.pin(1), {
          signal: "SHIELD_DRAIN",
          shieldGroup: "CBL1",
          length: 100
        })
      ]
    })
    expect(codesFor(hir, "HK-ELEC-023")).toHaveLength(1)
    expect(margins(hir)).toEqual([])
  })
})

describe("determinism and additivity", () => {
  it("produces byte-identical margins for the same HIR twice", () => {
    const a = margins(multiDropBus(100, 200, 1000))
    const b = margins(multiDropBus(100, 200, 1000))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.length).toBeGreaterThan(0)
  })

  it("orders margins by target, then code, then quantity", () => {
    const keys = margins(multiDropBus(100, 200, 1000)).map(
      (m) => `${m.target}|${m.code}|${m.quantity}`
    )
    expect(keys).toEqual([...keys].sort())
  })

  it("leaves the diagnostics of every fixture exactly as runRules reports them", () => {
    const fixtures = [
      linearBus(),
      teeBus(100, 500),
      teeBus(500, 1000),
      teeBus(undefined, 1000),
      teeBus(500, undefined),
      multiDropBus(100, 200, 1000)
    ]
    for (const hir of fixtures) {
      expect(run(hir).diagnostics).toEqual(runRules(hir, topologyRules))
    }
  })

  it("keeps the failing stub finding's payload untouched", () => {
    const found = codesFor(teeBus(500, 1000), "HK-ELEC-021")
    expect(found).toHaveLength(1)
    expect(found[0]?.severity).toBe("error")
    expect(found[0]?.target).toBe("connector:J3.pin:1")
    expect(found[0]?.data).toMatchObject({
      bus: "CAN",
      stubLengthM: 0.5,
      limitM: 0.3,
      bitRateKbps: 1000,
      budgetFromKbps: 1000
    })
  })
})

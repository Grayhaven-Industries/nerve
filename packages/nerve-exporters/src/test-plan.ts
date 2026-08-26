/**
 * Continuity-test plan generation (PRD §9.9).
 *
 * Generated from the HIR graph:
 *  - one point-to-point continuity test per pin-to-pin wire ("closed"),
 *  - splice verification: for each splice, continuity from a hub pin to every
 *    other pin reachable through that splice ("closed"),
 *  - one no-short isolation test per pair of distinct nets that share a
 *    connector ("open").
 *
 * Nets are computed over the full connectivity graph (wires + splices), so a
 * spliced power feed is one net. IDs are sequential over a canonical
 * ordering: the same HIR always yields the same plan.
 */
import { computeNets, isPinEndpoint, type Hir, type HirEndpoint } from "@grayhaven/nerve"
import { draft } from "./draft.js"

export interface TestPoint {
  readonly connector: string
  readonly pin: string
}

export interface ContinuityTest {
  readonly id: string
  readonly type: "continuity"
  readonly from: TestPoint
  readonly to: TestPoint
  readonly expected: "closed"
  readonly net?: string
  readonly wire: string
  readonly splice?: undefined
}

export interface SpliceTest {
  readonly id: string
  readonly type: "splice"
  readonly from: TestPoint
  readonly to: TestPoint
  readonly expected: "closed"
  readonly net?: string
  readonly wire?: undefined
  readonly splice: string
}

/** Supplemental end-to-end check for a net whose accessible pins are joined
 * through multiple splice nodes. It carries every implicated wire/splice so
 * a failed measurement remains traceable to the physical assembly. */
export interface NetContinuityTest {
  readonly id: string
  readonly type: "net-continuity"
  readonly from: TestPoint
  readonly to: TestPoint
  readonly expected: "closed"
  readonly net: string
  readonly wires: ReadonlyArray<string>
  readonly splices: ReadonlyArray<string>
  readonly wire?: undefined
  readonly splice?: undefined
}

export interface IsolationTest {
  readonly id: string
  readonly type: "no-short"
  readonly from: TestPoint
  readonly to: TestPoint
  readonly expected: "open"
  readonly net: string
  readonly wire?: undefined
  readonly splice?: undefined
}

export type HarnessTest = ContinuityTest | SpliceTest | NetContinuityTest | IsolationTest

export interface TestPlan {
  readonly harness: { readonly id: string; readonly revision: string }
  readonly tests: ReadonlyArray<HarnessTest>
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// Same key format the serialized test points have always used.
const endpointKey = (e: HirEndpoint): string =>
  isPinEndpoint(e) ? `pin:${e.connector}:${e.pin}` : `splice:${e.splice}`

export const generateTestPlan = (hir: Hir): TestPlan => {
  // Shared union-find from core: graph.json and rule authors see the
  // exact same connectivity (it used to be duplicated here).
  const nets = computeNets(hir, endpointKey)
  const tests: Array<HarnessTest> = []
  let n = 0
  const nextId = () => `T-${String(++n).padStart(3, "0")}`

  // Continuity: one per pin-to-pin wire, in canonical wire order.
  for (const w of hir.wires) {
    if (!isPinEndpoint(w.from) || !isPinEndpoint(w.to)) continue
    const net = nets.nameOf(w.from)
    const check = draft<Omit<ContinuityTest, "wire">>({
      id: nextId(),
      type: "continuity",
      from: { connector: w.from.connector, pin: w.from.pin },
      to: { connector: w.to.connector, pin: w.to.pin },
      expected: "closed"
    })
    if (net !== undefined) check.net = net
    tests.push({ ...check, wire: w.id })
  }

  // Splice verification: hub pin ↔ every other pin attached through the splice.
  for (const s of hir.splices) {
    const pins: Array<TestPoint> = []
    for (const wireId of s.wires) {
      const w = hir.wires.find((x) => x.id === wireId)
      if (w === undefined) continue
      for (const e of [w.from, w.to]) {
        if (isPinEndpoint(e)) pins.push({ connector: e.connector, pin: e.pin })
      }
    }
    pins.sort((a, b) => cmp(a.connector, b.connector) || cmp(a.pin, b.pin))
    const hub = pins[0]
    if (hub === undefined) continue
    const net = nets.nameOf({ splice: s.id })
    for (const p of pins.slice(1)) {
      const check = draft<Omit<SpliceTest, "splice">>({
        id: nextId(),
        type: "splice",
        from: hub,
        to: p,
        expected: "closed"
      })
      if (net !== undefined) check.net = net
      tests.push({ ...check, splice: s.id })
    }
  }

  // Existing direct-wire and per-splice checks usually form a spanning tree
  // over every accessible pin on a net. Chained splices are the exception:
  // neither splice alone sees both end pins. Add the minimum end-to-end tests
  // needed to connect the remaining test-point components.
  const records = new Map<
    string,
    {
      name: string
      pins: Map<string, TestPoint>
      wires: Set<string>
      splices: Set<string>
    }
  >()
  const pointKey = (p: TestPoint): string => `${p.connector}\u0000${p.pin}`
  for (const w of hir.wires) {
    const root = nets.rootOf(w.from)
    const record = records.get(root) ?? {
      name: nets.nameOf(w.from) ?? root,
      pins: new Map<string, TestPoint>(),
      wires: new Set<string>(),
      splices: new Set<string>()
    }
    record.wires.add(w.id)
    for (const end of [w.from, w.to]) {
      if (isPinEndpoint(end)) {
        const point = { connector: end.connector, pin: end.pin }
        record.pins.set(pointKey(point), point)
      } else record.splices.add(end.splice)
    }
    records.set(root, record)
  }
  for (const [root, record] of [...records.entries()].sort(([a], [b]) => cmp(a, b))) {
    const pins = [...record.pins.values()].sort(
      (a, b) => cmp(a.connector, b.connector) || cmp(a.pin, b.pin)
    )
    if (pins.length < 2) continue // HK-ELEC-011: no possible point-to-point test.

    const parent = new Map(pins.map((p) => [pointKey(p), pointKey(p)]))
    const find = (key: string): string => {
      const next = parent.get(key) ?? key
      if (next === key) return key
      const resolved = find(next)
      parent.set(key, resolved)
      return resolved
    }
    const union = (a: TestPoint, b: TestPoint): void => {
      const ra = find(pointKey(a))
      const rb = find(pointKey(b))
      if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb)
    }
    for (const test of tests) {
      if (test.expected !== "closed") continue
      const testRoot = nets.rootOf({ connector: test.from.connector, pin: test.from.pin })
      if (testRoot === root) union(test.from, test.to)
    }

    const hub = pins[0]!
    for (const pin of pins.slice(1)) {
      if (find(pointKey(hub)) === find(pointKey(pin))) continue
      tests.push({
        id: nextId(),
        type: "net-continuity",
        from: hub,
        to: pin,
        expected: "closed",
        net: record.name,
        wires: [...record.wires].sort(cmp),
        splices: [...record.splices].sort(cmp)
      })
      union(hub, pin)
    }
  }

  // No-short: for each connector, between the first wired pin of each
  // distinct net present on that connector.
  const netToPin = new Map<string, Map<string, string>>() // connector -> net -> probe pin
  for (const w of hir.wires) {
    for (const end of [w.from, w.to]) {
      if (!isPinEndpoint(end)) continue
      const net = nets.nameOf(end) ?? `wire:${w.id}`
      const pins = netToPin.get(end.connector) ?? new Map<string, string>()
      if (!pins.has(net)) pins.set(net, end.pin)
      netToPin.set(end.connector, pins)
    }
  }
  for (const connector of [...netToPin.keys()].sort(cmp)) {
    const pins = netToPin.get(connector)!
    const nets = [...pins.keys()].sort(cmp)
    for (let i = 0; i < nets.length; i++) {
      for (let j = i + 1; j < nets.length; j++) {
        const netA = nets[i]!
        const netB = nets[j]!
        tests.push({
          id: nextId(),
          type: "no-short",
          from: { connector, pin: pins.get(netA)! },
          to: { connector, pin: pins.get(netB)! },
          expected: "open",
          net: `${netA} <-> ${netB}`
        })
      }
    }
  }

  return {
    harness: { id: hir.harness.id, revision: hir.harness.revision },
    tests
  }
}

/** Serialized `test-plan.json` (PRD §9.3 required HIR outputs). */
export const testPlanJson = (hir: Hir): string =>
  JSON.stringify(generateTestPlan(hir), null, 2) + "\n"

/** Every wired net has at least one closed-circuit test (PRD §9.9 acceptance). */
/** Multi-pin nets in the harness, and how many of them the plan's closed
 * checks join end to end. */
export interface TestCoverage {
  readonly nets: number
  readonly covered: number
}

export const coverage = (hir: Hir, plan: TestPlan): TestCoverage => {
  const netOf = computeNets(hir, endpointKey)
  const pinsByRoot = new Map<string, Map<string, TestPoint>>()
  for (const w of hir.wires) {
    const root = netOf.rootOf(w.from)
    const pins = pinsByRoot.get(root) ?? new Map<string, TestPoint>()
    for (const end of [w.from, w.to]) {
      if (!isPinEndpoint(end)) continue
      const point = { connector: end.connector, pin: end.pin }
      pins.set(`${point.connector}\u0000${point.pin}`, point)
    }
    pinsByRoot.set(root, pins)
  }
  let covered = 0
  for (const [root, byKey] of pinsByRoot) {
    const pins = [...byKey.values()]
    if (pins.length < 2) continue
    const parent = new Map(pins.map((p) => {
      const key = `${p.connector}\u0000${p.pin}`
      return [key, key] as const
    }))
    const find = (key: string): string => {
      const next = parent.get(key) ?? key
      if (next === key) return key
      const resolved = find(next)
      parent.set(key, resolved)
      return resolved
    }
    for (const test of plan.tests) {
      if (test.expected !== "closed") continue
      const from = { connector: test.from.connector, pin: test.from.pin }
      const to = { connector: test.to.connector, pin: test.to.pin }
      if (netOf.rootOf(from) !== root || netOf.rootOf(to) !== root) continue
      const a = find(`${from.connector}\u0000${from.pin}`)
      const b = find(`${to.connector}\u0000${to.pin}`)
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b)
    }
    const first = pins[0]!
    const firstRoot = find(`${first.connector}\u0000${first.pin}`)
    if (pins.every((p) => find(`${p.connector}\u0000${p.pin}`) === firstRoot)) covered++
  }
  return {
    nets: pinsByRoot.size,
    covered
  }
}

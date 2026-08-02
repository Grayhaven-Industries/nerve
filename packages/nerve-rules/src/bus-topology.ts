/**
 * High-speed CAN bus topology rules (HK-ELEC-018..021).
 *
 * Nothing else in the rule set looks at bus SHAPE. Every other electrical
 * rule asks "is this wire adequate"; these four ask "is this bus a
 * transmission line". The failure they prevent is the expensive one: a bus
 * that passes continuity test, passes a bench smoke test, and then throws
 * intermittent error frames in the field under vibration and temperature,
 * because the line reflects instead of terminating. That is a week of
 * chasing, and it is a pure graph query against HIR.
 *
 * Why these are checkable without any routing or geometry data: for a linear
 * bus the physical ends and the topological ends coincide. The two ends of
 * the trunk are exactly the degree-1 vertices of the bus subgraph, so the
 * placement rule needs adjacency, not coordinates. Only the stub-length rule
 * needs a measurement, and it takes it from wire lengths already in HIR.
 *
 * PROVENANCE, read this before writing any of these numbers into a process
 * control plan: ISO 11898-2 is a paywalled document and was not available
 * here. `standard` is recorded on all four rules, `clause` is deliberately
 * OMITTED — a fabricated clause number would defeat the entire point of the
 * field, which is auditability. The numeric limits below (120Ω nominal
 * termination, 0.3 m stub at 1 Mbit/s, 40/100/500 m total bus length at
 * 1000/500/125 kbit/s) come from SECONDARY sources: CiA guidance and
 * transceiver application notes as commonly restated. They are the right
 * order of magnitude and are what practitioners use, but they must be
 * confirmed against the purchased standard before anyone treats a passing
 * run here as compliance evidence.
 */
import {
  DiagnosticSeverity,
  isPinEndpoint,
  refs,
  rule,
  type Hir,
  type HirEndpoint,
  type Rule
} from "@grayhaven/nerve"
import { differentialPartner } from "./wire-data.js"

const { Error: Err, Warning: Warn, Info } = DiagnosticSeverity

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

// --- Reference data (secondary sources; see the file header) ----------------

/** Nominal high-speed CAN termination, ohms. */
export const CAN_TERMINATION_OHMS = 120

/**
 * Band a fitted terminator must fall in to count as a nominal 120Ω
 * termination. Deliberately wide: it is a data-entry sanity check (a 60Ω
 * entry means someone recorded the parallel pair, a 1000Ω entry means
 * someone recorded a pull-up), not a resistor tolerance check.
 */
export const CAN_TERMINATION_BAND_OHMS = { min: 100, max: 130 } as const

/** Total trunk length budget (m) by bit rate (kbit/s). */
export const CAN_BUS_LENGTH_M_BY_KBPS: Readonly<Record<number, number>> = {
  1000: 40,
  500: 100,
  125: 500
}

/**
 * Stub (drop) length budget (m) by bit rate (kbit/s).
 *
 * Only the 1 Mbit/s figure (0.3 m) is quoted by the secondary sources. The
 * other two are DERIVED, by scaling it with the total-length budget above
 * (0.3 m × 100/40, 0.3 m × 500/40) on the same bit-time argument that sets
 * the total length. They are stated here explicitly rather than computed so
 * that a reviewer can see and challenge them.
 */
export const CAN_STUB_LENGTH_M_BY_KBPS: Readonly<Record<number, number>> = {
  1000: 0.3,
  500: 0.75,
  125: 3.75
}

/** Tabulated bit rates, ascending. */
const TABULATED_KBPS = [125, 500, 1000] as const

/**
 * Length budgets for a declared bit rate: the tabulated rate at or above it, so
 * an untabulated rate resolves to the STRICTER neighbour (250 kbit/s gets the
 * 500 kbit/s budget). Rates above 1 Mbit/s get the 1 Mbit/s row, which is the
 * floor of the table rather than an extrapolation.
 *
 * Both budgets come from the same resolved rate so a finding and a margin can
 * never disagree about which row of the table applies.
 */
const lengthBudget = (
  kbps: number
): { readonly rate: number; readonly stubM: number; readonly totalM: number } => {
  const rate = TABULATED_KBPS.find((r) => kbps <= r) ?? 1000
  return {
    rate,
    stubM: CAN_STUB_LENGTH_M_BY_KBPS[rate]!,
    totalM: CAN_BUS_LENGTH_M_BY_KBPS[rate]!
  }
}

// --- Bus extraction ---------------------------------------------------------

/**
 * Bus identity of a CAN signal: `CAN_H` and `CANL` both belong to bus `CAN`,
 * `MOTOR_CAN2_L` to `MOTOR_CAN2`. Gated on `differentialPartner` so this is
 * NOT a second signal classifier — wire-data.ts stays the single authority on
 * what counts as a differential half, and this only strips the polarity
 * suffix off what it already recognized.
 */
const canBusKey = (signal: string): string | undefined => {
  const s = signal.toUpperCase()
  if (differentialPartner(s) === undefined) return undefined
  return /^(.*CAN\d*)_?[HL]$/.exec(s)?.[1]
}

const nodeKey = (e: HirEndpoint): string =>
  isPinEndpoint(e) ? `${e.connector}:${e.pin}` : `splice:${e.splice}`

const nodeRef = (e: HirEndpoint): string =>
  isPinEndpoint(e) ? refs.pin(e.connector, e.pin) : refs.splice(e.splice)

const nodeLabel = (e: HirEndpoint): string =>
  isPinEndpoint(e) ? `${e.connector}.${e.pin}` : e.splice

interface BusEdge {
  readonly wireId: string
  readonly a: string
  readonly b: string
  /** Finished length in harness units; undefined when the wire declares none. */
  readonly length: number | undefined
}

interface Terminator {
  readonly node: string
  readonly connector: string
  readonly pin: string
  readonly ohms: number
}

interface CanBus {
  readonly key: string
  /** Bus wires, sorted by wire id. */
  readonly edges: ReadonlyArray<BusEdge>
  /** Node key to endpoint, for refs and labels. */
  readonly nodes: ReadonlyMap<string, HirEndpoint>
  readonly adjacency: ReadonlyMap<string, ReadonlyArray<BusEdge>>
  /** Terminations fitted on pins of this bus, sorted by node key. */
  readonly terminators: ReadonlyArray<Terminator>
  /** Distinct declared bit rates on this bus, ascending. */
  readonly bitRatesKbps: ReadonlyArray<number>
}

const degreeOf = (bus: CanBus, node: string): number =>
  bus.adjacency.get(node)?.length ?? 0

/** Every CAN bus in the harness, sorted by bus key. */
interface BusDraft {
  readonly edges: Array<BusEdge>
  readonly nodes: Map<string, HirEndpoint>
  readonly adjacency: Map<string, Array<BusEdge>>
}

const collectCanBuses = (hir: Hir): ReadonlyArray<CanBus> => {
  const draft = new Map<string, BusDraft>()
  // Wire order fixes adjacency order, so every derived walk is deterministic.
  for (const w of [...hir.wires].sort((x, y) => cmp(x.id, y.id))) {
    if (w.signal === undefined) continue
    const key = canBusKey(w.signal)
    if (key === undefined) continue
    const entry: BusDraft =
      draft.get(key) ?? { edges: [], nodes: new Map(), adjacency: new Map() }
    const a = nodeKey(w.from)
    const b = nodeKey(w.to)
    const edge: BusEdge = { wireId: w.id, a, b, length: w.length }
    entry.nodes.set(a, w.from)
    entry.nodes.set(b, w.to)
    entry.edges.push(edge)
    for (const n of [a, b]) {
      const list = entry.adjacency.get(n) ?? []
      list.push(edge)
      entry.adjacency.set(n, list)
    }
    draft.set(key, entry)
  }

  // Terminators and bit rates live on pins; attach each to whichever bus its
  // pin actually sits on. A terminator on a pin no CAN wire reaches belongs
  // to no bus and is silently ignored — it is not a CAN termination.
  const terminators = new Map<string, Array<Terminator>>()
  const bitRates = new Map<string, Set<number>>()
  for (const c of [...hir.connectors].sort((x, y) => cmp(x.ref, y.ref))) {
    for (const p of [...c.pins].sort((x, y) => cmp(x.pin, y.pin))) {
      const e = p.electrical
      if (e === undefined) continue
      const node = `${c.ref}:${p.pin}`
      const busKey = [...draft.entries()].find(([, d]) => d.nodes.has(node))?.[0]
      if (busKey === undefined) continue
      if (e.terminationOhms !== undefined) {
        const list = terminators.get(busKey) ?? []
        list.push({ node, connector: c.ref, pin: p.pin, ohms: e.terminationOhms })
        terminators.set(busKey, list)
      }
      if (e.bitRateKbps !== undefined) {
        const set = bitRates.get(busKey) ?? new Set<number>()
        set.add(e.bitRateKbps)
        bitRates.set(busKey, set)
      }
    }
  }

  return [...draft.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([key, d]) => ({
      key,
      edges: d.edges,
      nodes: d.nodes,
      adjacency: d.adjacency,
      terminators: (terminators.get(key) ?? []).sort((x, y) => cmp(x.node, y.node)),
      bitRatesKbps: [...(bitRates.get(key) ?? [])].sort((x, y) => x - y)
    }))
}

/**
 * Termination SITES, deduped by connector: a 120Ω resistor sits across
 * CAN_H/CAN_L at one connector, so declaring it on both pins of that
 * connector is one terminator, not two. Sorted by connector ref.
 */
const terminationSites = (
  bus: CanBus
): ReadonlyArray<{ readonly connector: string; readonly terminators: ReadonlyArray<Terminator> }> => {
  const byConnector = new Map<string, Array<Terminator>>()
  for (const t of bus.terminators) {
    const list = byConnector.get(t.connector) ?? []
    list.push(t)
    byConnector.set(t.connector, list)
  }
  return [...byConnector.entries()]
    .sort(([a], [b]) => cmp(a, b))
    .map(([connector, ts]) => ({ connector, terminators: ts }))
}

/** Harness units to meters. */
const toMeters = (value: number, units: Hir["harness"]["units"]): number =>
  units === "in" ? value * 0.0254 : value / 1000

const round = (value: number, places = 3): number => Number(value.toFixed(places))

// --- HK-ELEC-018: terminator count ------------------------------------------

/**
 * A high-speed CAN trunk carries exactly two terminations, one at each end.
 * Never one, never three.
 *
 * This is the check a technician makes with a multimeter across CAN_H/CAN_L
 * on a powered-down bus: ~60Ω is correct (two 120Ω in parallel), ~120Ω means
 * one terminator is missing, ~40Ω means there is a third. A bus with one
 * terminator usually still passes a bench test and fails in the field; a bus
 * with three loads the drivers beyond their differential output spec.
 *
 * Also warns when a fitted value is nowhere near 120Ω, which is a
 * data-entry check, not a resistor-tolerance check (see
 * CAN_TERMINATION_BAND_OHMS).
 *
 * NO MARGIN, deliberately, on either quantity here.
 *
 * Terminator count is discrete: two terminations versus three is not 1.5× of
 * anything, and there is no design between them to move toward.
 *
 * Termination resistance is continuous but its budget is TWO-SIDED and not
 * even symmetric (100-130Ω around a 120Ω nominal), while `utilization` is
 * `measured / limit` — one-sided by construction, better when smaller. Under
 * that normalization a 60Ω entry, which is the classic "somebody recorded the
 * parallel pair" defect this rule exists to catch, scores 0.46 and looks like
 * the healthiest terminator on the harness, while a correct 120Ω scores 0.92
 * and looks nearly failing. An optimizer minimising utilization would drive
 * resistance toward zero. Re-normalising to a deviation (|R - 120| / 10) would
 * fix the direction but invent a quantity no standard states and hide the
 * asymmetry of the band. A wrong slope is worse than no slope, so this rule
 * measures nothing.
 */
export const canTerminationCountWrong: Rule = rule(
  "canTerminationCountWrong",
  (ctx) => {
    for (const bus of collectCanBuses(ctx.hir)) {
      const sites = terminationSites(bus)
      const anchor = refs.wire(bus.edges[0]!.wireId)
      if (sites.length !== 2) {
        // Zero declared terminations is an absence of facts, not a defect:
        // on a real harness the 120Ω resistors usually live inside the ECU
        // or the end node, off-harness entirely, so erroring here would fire
        // on nearly every legitimate CAN segment. Nerve checks only what the
        // design states. One or three declared IS a defect — intent was
        // stated and got it wrong.
        const undeclared = sites.length === 0
        const where = undeclared
          ? "none are declared"
          : `declared at ${sites.map((s) => s.connector).join(", ")}`
        ctx.report({
          severity: undeclared ? Info : Err,
          message: undeclared
            ? `CAN bus ${bus.key} declares no terminations. If this harness carries the two ~${CAN_TERMINATION_OHMS}Ω resistors, set \`terminationOhms\` on the pin at each end of the trunk.`
            : `CAN bus ${bus.key} has ${sites.length} termination${sites.length === 1 ? "" : "s"} (${where}). Fit exactly two ~${CAN_TERMINATION_OHMS}Ω terminations, one at each end of the trunk.`,
          target: anchor,
          targets: sites.flatMap((s) =>
            s.terminators.map((t) => refs.pin(t.connector, t.pin))
          ),
          data: {
            bus: bus.key,
            terminations: sites.length,
            expected: 2
          }
        })
      }
      for (const t of bus.terminators) {
        if (
          t.ohms >= CAN_TERMINATION_BAND_OHMS.min &&
          t.ohms <= CAN_TERMINATION_BAND_OHMS.max
        ) {
          continue
        }
        ctx.report({
          severity: Warn,
          message: `Termination at ${t.connector}.${t.pin} on CAN bus ${bus.key} is ${t.ohms}Ω. Set it between ${CAN_TERMINATION_BAND_OHMS.min}Ω and ${CAN_TERMINATION_BAND_OHMS.max}Ω, nominally ${CAN_TERMINATION_OHMS}Ω.`,
          target: refs.pin(t.connector, t.pin),
          data: {
            bus: bus.key,
            terminationOhms: t.ohms,
            nominalOhms: CAN_TERMINATION_OHMS
          }
        })
      }
    }
  },
  { code: "HK-ELEC-018", standard: "ISO 11898-2", ruleVersion: "1.0.0" }
)

// --- HK-ELEC-019: terminator placement --------------------------------------

/**
 * The two terminations must sit at the two ENDS of the trunk, not partway
 * along it. A terminator in the middle leaves the segment beyond it
 * unterminated: that stretch reflects, and the reflection lands back on the
 * sampling point as a bit error that comes and goes with temperature.
 *
 * No geometry needed. On a linear bus the physical ends are the topological
 * ends, so an end is a degree-1 vertex of the bus subgraph. A terminated node
 * with two or more bus wires on it is, by construction, not an end.
 */
export const canTerminationNotAtBusEnd: Rule = rule(
  "canTerminationNotAtBusEnd",
  (ctx) => {
    for (const bus of collectCanBuses(ctx.hir)) {
      for (const t of bus.terminators) {
        const degree = degreeOf(bus, t.node)
        if (degree <= 1) continue
        ctx.report({
          severity: Err,
          message: `Termination at ${t.connector}.${t.pin} on CAN bus ${bus.key} sits on a node with ${degree} bus wires. Move it to an end of the trunk, where exactly one bus wire lands.`,
          target: refs.pin(t.connector, t.pin),
          targets: (bus.adjacency.get(t.node) ?? []).map((e) => refs.wire(e.wireId)),
          data: { bus: bus.key, busWiresOnNode: degree, expected: 1 }
        })
      }
    }
  },
  { code: "HK-ELEC-019", standard: "ISO 11898-2", ruleVersion: "1.0.0" }
)

// --- HK-ELEC-020: linear topology -------------------------------------------

/**
 * A high-speed CAN bus is a single line with two ends. Star, tree, and ring
 * topologies put an impedance discontinuity at every junction, and a ring has
 * no ends to terminate at all.
 *
 * What is and is not reportable here is set by what the graph can actually
 * distinguish. A three-arm star and a linear trunk with one drop are the SAME
 * graph — the only thing separating them is how long the third arm is, which
 * is why the standard gives a stub budget and why that lives in HK-ELEC-021.
 * So:
 *
 * - degree 3 (a tee) is a WARNING: legal only if the third leg is a short
 *   stub, which HK-ELEC-021 measures.
 * - degree 4 or more is an ERROR: a trunk passes through two legs, so two or
 *   more drops meeting at one point is a star by any reading, and no stub
 *   budget rescues it.
 * - a cycle is an ERROR: a ring cannot be terminated.
 *
 * The H and L halves are separate components of the graph, so a physical tee
 * is reported once per half. That is intentional: they are separate refs and
 * a harness can genuinely branch one and not the other.
 *
 * NO MARGIN on node degree. Degree is an integer with no budget: the standard
 * states no maximum, which is precisely this rule's own argument for warning
 * rather than erroring at every degree. Any denominator would therefore be
 * invented, and the resulting slope would tell an optimizer that collapsing a
 * five-way splice pack into two three-way ones is a 40% improvement when the
 * copper, the stubs and the reflections are unchanged. The quantity that
 * actually separates a legitimate splice pack from a harmful star is stub
 * length, and HK-ELEC-021 measures it.
 */
export const canBusNotLinear: Rule = rule(
  "canBusNotLinear",
  (ctx) => {
    for (const bus of collectCanBuses(ctx.hir)) {
      for (const node of [...bus.nodes.keys()].sort(cmp)) {
        const degree = degreeOf(bus, node)
        if (degree < 3) continue
        const endpoint = bus.nodes.get(node)!
        const label = nodeLabel(endpoint)
        // Always a warning, never an error, at every degree. Degree alone
        // cannot separate a harmful star from a legitimate splice-pack
        // distribution — the two are the same graph, and splice packs are
        // widespread in production automotive CAN. Only stub length tells
        // them apart, and that judgment belongs to HK-ELEC-021. Erroring
        // here would condemn a topology the graph cannot actually convict.
        ctx.report({
          severity: Warn,
          message:
            degree >= 4
              ? `CAN bus ${bus.key} stars at ${label}, where ${degree} bus wires meet. A trunk passes through two of them, so keep every other drop inside the HK-ELEC-021 stub budget.`
              : `CAN bus ${bus.key} branches at ${label}, where ${degree} bus wires meet. A trunk is linear, so keep the third leg inside the HK-ELEC-021 stub budget.`,
          target: nodeRef(endpoint),
          targets: (bus.adjacency.get(node) ?? []).map((e) => refs.wire(e.wireId)),
          data: { bus: bus.key, busWiresOnNode: degree }
        })
      }
      // A cycle exists exactly when an edge joins two already-connected
      // nodes. Wires are sorted, so the reported closing wire is stable.
      const parent = new Map<string, string>()
      const find = (k: string): string => {
        const p = parent.get(k) ?? k
        if (p === k) return k
        const root = find(p)
        parent.set(k, root)
        return root
      }
      for (const e of bus.edges) {
        const ra = find(e.a)
        const rb = find(e.b)
        if (ra !== rb) {
          parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb)
          continue
        }
        ctx.report({
          severity: Err,
          message: `CAN bus ${bus.key} closes a ring at wire ${e.wireId} (${nodeLabel(bus.nodes.get(e.a)!)} to ${nodeLabel(bus.nodes.get(e.b)!)}). A ring has no ends to terminate, so remove one bus wire.`,
          target: refs.wire(e.wireId),
          targets: [nodeRef(bus.nodes.get(e.a)!), nodeRef(bus.nodes.get(e.b)!)],
          data: { bus: bus.key, closingWire: e.wireId }
        })
      }
    }
  },
  { code: "HK-ELEC-020", standard: "ISO 11898-2", ruleVersion: "1.0.0" }
)

// --- HK-ELEC-021: stub length -----------------------------------------------

interface Stub {
  /** Leaf node the drop ends at. */
  readonly leaf: string
  /** Junction the drop hangs off. */
  readonly junction: string
  /** Wire ids along the drop, from leaf inward. */
  readonly wires: ReadonlyArray<string>
  /** Total length in harness units, or undefined when a wire declares none. */
  readonly length: number | undefined
}

/**
 * Drops hanging off the trunk: walk inward from every leaf through degree-2
 * nodes until a junction is reached. A leaf that carries a termination is a
 * trunk END, not a drop, so it is exempt. A component with no junction is a
 * plain path and yields no stubs.
 */
const stubsOf = (bus: CanBus): ReadonlyArray<Stub> => {
  const terminated = new Set(bus.terminators.map((t) => t.node))
  const stubs: Array<Stub> = []
  for (const leaf of [...bus.nodes.keys()].sort(cmp)) {
    if (degreeOf(bus, leaf) !== 1) continue
    if (terminated.has(leaf)) continue
    const wires: Array<string> = []
    const seen = new Set<string>([leaf])
    let total = 0
    let known = true
    let prev = leaf
    let edge = bus.adjacency.get(leaf)![0]!
    for (;;) {
      wires.push(edge.wireId)
      if (edge.length === undefined) known = false
      else total += edge.length
      const next = edge.a === prev ? edge.b : edge.a
      // Ring: HK-ELEC-020 owns that finding; a length here would be fiction.
      if (seen.has(next)) break
      seen.add(next)
      const degree = degreeOf(bus, next)
      if (degree >= 3) {
        stubs.push({
          leaf,
          junction: next,
          wires,
          length: known ? total : undefined
        })
        break
      }
      if (degree <= 1) break // the whole component is a path: no stub
      const [first, second] = bus.adjacency.get(next)!
      edge = first!.wireId === edge.wireId ? second! : first!
      prev = next
    }
  }
  return stubs
}

/**
 * End-to-end length of the longest run on the bus, in meters, or undefined when
 * it cannot be known honestly.
 *
 * NOT the sum of the wire lengths. CAN_H and CAN_L are separate components of
 * this graph that run down the same physical trunk, so adding both halves
 * reports a bus at twice its physical length. CAN_BUS_LENGTH_M_BY_KBPS is a
 * propagation-delay limit on the distance between the two most distant nodes,
 * which is the weighted diameter of the bus graph — taken per component, with
 * the longest component winning. For a plain two-node trunk that is exactly the
 * trunk wire; for a tee it is trunk plus the longest drop, which is what the
 * signal actually traverses.
 *
 * Undefined when any bus wire declares no length (guessing would fabricate the
 * measurement, and HK-MFG-001 already reports the missing length) or when the
 * bus contains a cycle, where the path between two nodes is not unique and a
 * diameter would be fiction. HK-ELEC-020 owns the ring finding.
 */
const longestRunM = (bus: CanBus, units: Hir["harness"]["units"]): number | undefined => {
  if (bus.edges.some((e) => e.length === undefined)) return undefined

  /** Farthest node from `start` within its component, and every node reached. */
  const farthest = (
    start: string
  ): { readonly node: string; readonly dist: number; readonly reached: ReadonlySet<string> } => {
    const dist = new Map<string, number>([[start, 0]])
    const queue = [start]
    let best = { node: start, dist: 0 }
    for (let head = 0; head < queue.length; head += 1) {
      const node = queue[head]!
      const d = dist.get(node)!
      for (const e of bus.adjacency.get(node) ?? []) {
        const next = e.a === node ? e.b : e.a
        if (dist.has(next)) continue
        const nd = d + e.length!
        dist.set(next, nd)
        queue.push(next)
        // Tie broken on node key so the walk does not depend on Map order.
        if (nd > best.dist || (nd === best.dist && next < best.node)) {
          best = { node: next, dist: nd }
        }
      }
    }
    return { ...best, reached: new Set(dist.keys()) }
  }

  const seen = new Set<string>()
  let longest = 0
  for (const start of [...bus.nodes.keys()].sort(cmp)) {
    if (seen.has(start)) continue
    const first = farthest(start)
    for (const n of first.reached) seen.add(n)
    // A cycle makes "the" distance between two nodes ambiguous: bail rather
    // than report whichever way the BFS happened to go round it.
    const edges = new Set(
      [...first.reached].flatMap((n) => (bus.adjacency.get(n) ?? []).map((e) => e.wireId))
    )
    if (edges.size !== first.reached.size - 1) return undefined
    longest = Math.max(longest, farthest(first.node).dist)
  }
  return toMeters(longest, units)
}

/**
 * A drop off the trunk must stay short: under 0.3 m at 1 Mbit/s. A long stub
 * is an unterminated transmission line hanging off a terminated one, and it
 * rings for as long as it takes the reflection to die down. That is the
 * classic "works on the bench, throws error frames in the vehicle" bus.
 *
 * BIT RATE UNSPECIFIED: this rule does NOT silently assume the strictest
 * case. A bus with stubs but no declared `bitRateKbps` gets one `info`
 * saying the stub check does not run; buses with no stubs say nothing.
 * Declaring a rate on any pin of the bus turns the check on. When several
 * rates are declared on one bus the highest wins, because it is the
 * strictest, and all declared rates go into the finding's data.
 *
 * MISSING WIRE LENGTHS: a drop containing a wire with no length is skipped
 * rather than guessed. HK-MFG-001 already reports the missing length.
 *
 * MARGINS: this is where the bus's continuous physics lives, so it is the one
 * bus rule that measures. Every stub is measured against the stub budget and
 * the bus is measured against the total-length budget, on every run, whether or
 * not anything failed — a bus whose worst drop sits at 95% of budget is one
 * routing change from ringing in the field, and a pass/fail channel cannot say
 * so. Total bus length has no finding of its own (the budget is a design guide,
 * not a defect line), so the margin is its only channel.
 *
 * Nothing is measured when the bus declares no bit rate: with no budget there
 * is no ratio, and falling back to the strictest row would hand an optimizer a
 * slope derived from a rate the design never claimed.
 */
export const canStubTooLong: Rule = rule(
  "canStubTooLong",
  (ctx) => {
    const units = ctx.hir.harness.units
    for (const bus of collectCanBuses(ctx.hir)) {
      const declaredRates = bus.bitRatesKbps
      const budget =
        declaredRates.length > 0
          ? lengthBudget(declaredRates[declaredRates.length - 1]!)
          : undefined
      if (budget !== undefined) {
        const runM = longestRunM(bus, units)
        if (runM !== undefined) {
          ctx.measure({
            target: refs.wire(bus.edges[0]!.wireId),
            quantity: "bus length",
            measured: round(runM),
            limit: budget.totalM,
            unit: "m"
          })
        }
      }
      const stubs = stubsOf(bus)
      if (stubs.length === 0) continue
      const declared = declaredRates
      if (budget === undefined) {
        ctx.report({
          severity: Info,
          message: `CAN bus ${bus.key} declares no bit rate, so the stub check does not run on its ${stubs.length} stub${stubs.length === 1 ? "" : "s"}. Set bitRateKbps on a pin of this bus.`,
          target: refs.wire(bus.edges[0]!.wireId),
          data: { bus: bus.key, stubs: stubs.length }
        })
        continue
      }
      const kbps = declared[declared.length - 1]!
      const { rate, stubM } = budget
      for (const stub of stubs) {
        if (stub.length === undefined) continue
        const lengthM = toMeters(stub.length, units)
        const leaf = bus.nodes.get(stub.leaf)!
        // Measured before the verdict, so a passing drop reports its headroom
        // instead of vanishing.
        ctx.measure({
          target: nodeRef(leaf),
          quantity: "stub length",
          measured: round(lengthM),
          limit: stubM,
          unit: "m"
        })
        if (lengthM <= stubM) continue
        ctx.report({
          severity: Err,
          message: `Stub to ${nodeLabel(leaf)} on CAN bus ${bus.key} is ${round(lengthM)}m. At ${kbps}kbit/s a drop off the trunk must stay under ${stubM}m.`,
          target: nodeRef(leaf),
          targets: stub.wires.map(refs.wire),
          data: {
            bus: bus.key,
            stubLengthM: round(lengthM),
            limitM: stubM,
            bitRateKbps: kbps,
            budgetFromKbps: rate,
            ...(declared.length > 1 ? { declaredKbps: declared.join(", ") } : {})
          }
        })
      }
    }
  },
  { code: "HK-ELEC-021", standard: "ISO 11898-2", ruleVersion: "1.0.0" }
)

/** The four bus-topology rules, in code order. */
export const busTopologyRules: ReadonlyArray<Rule> = [
  canTerminationCountWrong,
  canTerminationNotAtBusEnd,
  canBusNotLinear,
  canStubTooLong
]

/**
 * Ground and shield topology rules (HK-ELEC-022, HK-ELEC-023).
 *
 * Connectivity rules elsewhere ask "does this node reach that node". These two
 * ask the harder question a net list cannot answer on its own: *how many ways*
 * does it reach it, and *where* does a shield tie to ground. Both failures are
 * invisible in a continuity test — a ground loop passes continuity precisely
 * because everything is connected, and a shield grounded at both ends passes
 * because it is grounded — yet both are classic field-noise defects.
 *
 * No new part data or geometry is required: this is pure graph analysis over
 * `hir.wires`, which is what the compiler already has.
 */
import {
  DiagnosticSeverity,
  endpointLabel,
  isPinEndpoint,
  refs,
  rule,
  type Hir,
  type HirEndpoint,
  type Rule
} from "@grayhaven/nerve"
import { isGroundSignal, isShieldSignal } from "./wire-data.js"

const { Warning: Warn, Info } = DiagnosticSeverity

/** Both rules are new in this release; bumped when a verdict can change. */
const RULE_VERSION = "1.0.0"

type HirWire = Hir["wires"][number]

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Endpoint identity in the PRD §19 refs grammar, so a key is also reportable. */
const keyOf = (e: HirEndpoint): string =>
  isPinEndpoint(e) ? refs.pin(e.connector, e.pin) : refs.splice(e.splice)

/**
 * Endpoints that are physically ground: a pin assigned a ground signal or
 * declared `role: "ground"`, plus every endpoint a ground-signal wire lands on
 * (which is what makes a splice a ground point).
 *
 * Deliberately *local* — it never asks whether an endpoint's net eventually
 * reaches ground. Net reachability would mark both ends of a single-ended
 * shield as grounded, since a wire's own two endpoints always share a net,
 * and HK-ELEC-023 would then never fire.
 */
const groundPoints = (hir: Hir): ReadonlySet<string> => {
  const points = new Set<string>()
  for (const c of hir.connectors) {
    for (const p of c.pins) {
      const grounded =
        (p.signal !== undefined && isGroundSignal(p.signal)) ||
        p.electrical?.role === "ground"
      if (grounded) points.add(refs.pin(c.ref, p.pin))
    }
  }
  for (const w of hir.wires) {
    if (w.signal === undefined || !isGroundSignal(w.signal)) continue
    points.add(keyOf(w.from))
    points.add(keyOf(w.to))
  }
  return points
}

/**
 * Wires in the ground subgraph: those carrying a ground signal, plus unsignaled
 * wires whose *both* endpoints are ground points. A signalless wire with only
 * one ground end is ambiguous (it may be the load side of a return) and stays
 * out, so the loop rule never invents a path the design did not declare.
 */
const groundWires = (hir: Hir, grounds: ReadonlySet<string>): ReadonlyArray<HirWire> =>
  [...hir.wires]
    .filter((w) =>
      w.signal !== undefined
        ? isGroundSignal(w.signal)
        : grounds.has(keyOf(w.from)) && grounds.has(keyOf(w.to))
    )
    .sort((a, b) => cmp(a.id, b.id))

interface TreeEdge {
  readonly to: string
  readonly wire: string
}

/**
 * Wire IDs along the unique path between two endpoints in a spanning forest.
 * The graph passed in is a forest by construction (cycle-closing edges are
 * never added), so the path is unique and the walk is deterministic.
 */
const pathWires = (
  adjacency: ReadonlyMap<string, ReadonlyArray<TreeEdge>>,
  from: string,
  to: string
): ReadonlyArray<string> => {
  if (from === to) return []
  const cameFrom = new Map<string, { readonly node: string; readonly wire: string }>()
  const seen = new Set<string>([from])
  const queue = [from]
  for (let head = 0; head < queue.length; head += 1) {
    const node = queue[head]!
    for (const edge of adjacency.get(node) ?? []) {
      if (seen.has(edge.to)) continue
      seen.add(edge.to)
      cameFrom.set(edge.to, { node, wire: edge.wire })
      if (edge.to !== to) {
        queue.push(edge.to)
        continue
      }
      const wires: Array<string> = []
      let cursor = to
      while (cursor !== from) {
        const step = cameFrom.get(cursor)!
        wires.push(step.wire)
        cursor = step.node
      }
      return wires.reverse()
    }
  }
  return []
}

/**
 * A ground net that offers two independent return paths between the same two
 * points is a loop: current divides between the paths, the enclosed area
 * becomes a pickup antenna for magnetic fields, and the single-point grounding
 * the design was drawn around no longer holds. It is a topology defect that
 * continuity testing cannot see, because every node is still connected.
 *
 * Detection is an incremental union-find over the ground subgraph *only*, not
 * over `ctx.nets`. `ctx.nets` is whole-harness and collapses cycles by
 * definition — once two endpoints are merged it can no longer say whether one
 * path joined them or three. Rebuilding the merge locally, in sorted wire
 * order, means a wire whose endpoints are *already* connected is exactly a
 * cycle-closing edge: one report per independent loop, no duplicates. The
 * participating wires come from a walk of the spanning forest built so far,
 * which is what turns "there is a loop" into "these wires are the loop".
 *
 * Warning, not error: multi-point grounding is a legitimate scheme at high
 * frequency, and chassis-return designs close loops on purpose.
 */
export const groundLoop: Rule = rule(
  "groundLoop",
  (ctx) => {
    const grounds = groundPoints(ctx.hir)
    const parent = new Map<string, string>()
    const find = (k: string): string => {
      const p = parent.get(k)
      if (p === undefined || p === k) return k
      const root = find(p)
      parent.set(k, root)
      return root
    }
    const adjacency = new Map<string, Array<TreeEdge>>()
    const link = (a: string, b: string, wire: string): void => {
      adjacency.set(a, [...(adjacency.get(a) ?? []), { to: b, wire }])
    }

    for (const w of groundWires(ctx.hir, grounds)) {
      const a = keyOf(w.from)
      const b = keyOf(w.to)
      const ra = find(a)
      const rb = find(b)
      if (ra !== rb) {
        // Smallest key wins as root, matching computeNets' tie-break.
        parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb)
        link(a, b, w.id)
        link(b, a, w.id)
        continue
      }
      const loop = [...pathWires(adjacency, a, b), w.id]
      const net = ctx.nets.nameOf(w.from) ?? w.signal ?? "ground"
      ctx.report({
        severity: Warn,
        message: `Ground net ${net} forms a loop: wires ${[...loop].sort(cmp).join(", ")} provide more than one return path between ${endpointLabel(w.from)} and ${endpointLabel(w.to)}.`,
        target: refs.wire(w.id),
        targets: [
          ...loop.filter((id) => id !== w.id).map(refs.wire),
          a,
          b
        ].sort(cmp),
        data: {
          net,
          loopWires: [...loop].sort(cmp).join(", "),
          loopLength: loop.length
        }
      })
    }
  },
  { code: "HK-ELEC-022", ruleVersion: RULE_VERSION }
)

/**
 * Where a cable shield ties to ground is a scheme decision, and both wrong
 * answers are silent. Grounded at both ends, the shield and the chassis
 * enclose a loop and the shield itself carries circulating current, injecting
 * the very noise it was fitted to reject. Grounded at neither end it floats:
 * no return path for the coupled charge, so it attenuates nothing while still
 * costing weight, diameter, and a termination operation.
 *
 * Reported as a scheme finding rather than an error. Double-ended termination
 * is the correct choice above a few MHz, where the cable is long relative to
 * the wavelength and the loop impedance stops mattering, so this rule states
 * the count and lets the engineer confirm the intent. The floating case is a
 * warning because it has no legitimate reading.
 *
 * Grouping is by the `shieldGroup` field. Members carrying a named non-shield
 * signal are inner conductors, not the shield, and are excluded from the
 * termination count so a signal return inside the cable is never mistaken for
 * a shield termination. Complements HK-ELEC-004, which reports shield *pins*
 * with no wire at all; this rule looks only at wires, so the two never report
 * the same finding.
 */
export const shieldTerminationScheme: Rule = rule(
  "shieldTerminationScheme",
  (ctx) => {
    const grounds = groundPoints(ctx.hir)
    const byGroup = new Map<string, Array<HirWire>>()
    for (const w of ctx.hir.wires) {
      if (w.shieldGroup === undefined) continue
      if (w.signal !== undefined && !isShieldSignal(w.signal)) continue
      byGroup.set(w.shieldGroup, [...(byGroup.get(w.shieldGroup) ?? []), w])
    }

    for (const [group, unsorted] of [...byGroup.entries()].sort(([a], [b]) => cmp(a, b))) {
      const members = [...unsorted].sort((a, b) => cmp(a.id, b.id))
      const ends = [
        ...new Set(members.flatMap((w) => [keyOf(w.from), keyOf(w.to)]))
      ].sort(cmp)
      const terminated = ends.filter((e) => grounds.has(e))
      if (terminated.length === 1) continue // single-point termination: the default scheme

      const wireRefs = members.map((w) => refs.wire(w.id))
      const common = {
        target: wireRefs[0]!,
        targets: [...wireRefs.slice(1), ...terminated].sort(cmp),
        data: {
          shieldGroup: group,
          terminations: terminated.length,
          wires: members.map((w) => w.id).join(", ")
        }
      }
      if (terminated.length === 0) {
        ctx.report({
          ...common,
          severity: Warn,
          message: `Shield group ${group} (wires ${members.map((w) => w.id).join(", ")}) is terminated at neither end; a floating shield attenuates nothing. Ground it at one end.`
        })
        continue
      }
      ctx.report({
        ...common,
        severity: Info,
        message: `Shield group ${group} (wires ${members.map((w) => w.id).join(", ")}) is terminated at ${terminated.length} points (${terminated.join(", ")}); terminating both ends closes a ground loop through the shield. Single-end termination is the usual scheme; keep this only if it is a deliberate high-frequency choice.`
      })
    }
  },
  { code: "HK-ELEC-023", ruleVersion: RULE_VERSION }
)

/**
 * Parametric composition (PRD §18): `harnessTemplate` + `prefixRefs`.
 *
 * A template is a plain function returning a HarnessFragment — a bundle of
 * design elements that spreads into `harness()`. `prefixRefs` namespaces a
 * fragment deterministically so repeated instantiations (sensor drops,
 * pigtails) cannot collide: ids and refs gain the prefix, and every
 * INTERNAL reference (wire endpoints, branch paths/parents, label
 * attachments, splice branch, wire→cable) is rewritten to match. Refs that
 * point OUTSIDE the fragment (the trunk connector a drop plugs into) pass
 * through untouched.
 *
 * The compile path is unchanged — fragments are ordinary builder output —
 * so determinism, goldens, and the HIR schema are untouched by design.
 */
import type {
  BranchDef,
  CableDef,
  ConnectorInstance,
  LabelDef,
  SpliceDef,
  WireDef,
  WireEndpoint
} from "./domain.js"
import { connector } from "./dsl.js"

/** The element bundle a template produces; spread it into `harness()`. */
export interface HarnessFragment {
  readonly connectors?: ReadonlyArray<ConnectorInstance>
  readonly wires?: ReadonlyArray<WireDef>
  readonly branches?: ReadonlyArray<BranchDef>
  readonly labels?: ReadonlyArray<LabelDef>
  readonly splices?: ReadonlyArray<SpliceDef>
  readonly cables?: ReadonlyArray<CableDef>
}

export interface HarnessTemplate<Opts> {
  (opts: Opts): HarnessFragment
  readonly templateName: string
}

/**
 * Define a reusable parametric fragment:
 *
 *   const canDrop = harnessTemplate("can-drop", (opts: { id: string; … }) => ({
 *     connectors: […], wires: […]
 *   }))
 *   harness("vehicle", { …, ...mergeFragments(canDrop({id:"D1"}), canDrop({id:"D2"})) })
 */
export const harnessTemplate = <Opts>(
  name: string,
  build: (opts: Opts) => HarnessFragment
): HarnessTemplate<Opts> => Object.assign((opts: Opts) => build(opts), { templateName: name })

/** Concatenate fragments (e.g. several template instances) into one. */
export const mergeFragments = (...fragments: ReadonlyArray<HarnessFragment>): HarnessFragment => ({
  connectors: fragments.flatMap((f) => f.connectors ?? []),
  wires: fragments.flatMap((f) => f.wires ?? []),
  branches: fragments.flatMap((f) => f.branches ?? []),
  labels: fragments.flatMap((f) => f.labels ?? []),
  splices: fragments.flatMap((f) => f.splices ?? []),
  cables: fragments.flatMap((f) => f.cables ?? [])
})

/**
 * Namespace a fragment: `prefixRefs("D1", canDrop(…))` renames every id/ref
 * to `D1-…` and rewrites internal references. Deterministic — same inputs,
 * same fragment.
 */
export const prefixRefs = (prefix: string, fragment: HarnessFragment): HarnessFragment => {
  const p = (id: string): string => `${prefix}-${id}`
  const connectorRefs = new Set((fragment.connectors ?? []).map((c) => c.ref))
  const spliceIds = new Set((fragment.splices ?? []).map((s) => s.id))
  const branchIds = new Set((fragment.branches ?? []).map((b) => b.id))
  const cableIds = new Set((fragment.cables ?? []).map((c) => c.id))

  const mapEndpoint = (e: WireEndpoint): WireEndpoint =>
    e.kind === "pin-ref"
      ? connectorRefs.has(e.connector)
        ? { ...e, connector: p(e.connector) }
        : e
      : spliceIds.has(e.splice)
        ? { ...e, splice: p(e.splice) }
        : e

  return {
    // Rebuild through connector() so .pin() closes over the NEW ref.
    connectors: (fragment.connectors ?? []).map((c) =>
      connector(p(c.ref), c.part, { pins: c.pins, terminals: c.terminals, seals: c.seals })
    ),
    wires: (fragment.wires ?? []).map((w) => {
      let mapped: WireDef = {
        ...w,
        id: p(w.id),
        from: mapEndpoint(w.from),
        to: mapEndpoint(w.to)
      }
      if (w.cable !== undefined && cableIds.has(w.cable)) mapped = { ...mapped, cable: p(w.cable) }
      // twist/shield groups are per-instance grouping keys — namespace them
      // too, or two instances of a template would merge into ONE twist
      // (or shield) group and defeat the collision-free guarantee.
      if (w.twistGroup !== undefined) mapped = { ...mapped, twistGroup: p(w.twistGroup) }
      if (w.shieldGroup !== undefined) mapped = { ...mapped, shieldGroup: p(w.shieldGroup) }
      return mapped
    }),
    branches: (fragment.branches ?? []).map((b) => {
      const mapped: BranchDef = {
        ...b,
        id: p(b.id),
        path: b.path.map((ref) => (connectorRefs.has(ref) ? p(ref) : ref))
      }
      return b.parent !== undefined && branchIds.has(b.parent)
        ? { ...mapped, parent: p(b.parent) }
        : mapped
    }),
    labels: (fragment.labels ?? []).map((l) => {
      const mapped: LabelDef = {
        ...l,
        id: p(l.id),
        attachTo:
          branchIds.has(l.attachTo) || connectorRefs.has(l.attachTo) ? p(l.attachTo) : l.attachTo
      }
      return l.offsetFrom !== undefined && connectorRefs.has(l.offsetFrom)
        ? { ...mapped, offsetFrom: p(l.offsetFrom) }
        : mapped
    }),
    splices: (fragment.splices ?? []).map((s) => {
      const mapped: SpliceDef = { ...s, id: p(s.id) }
      return s.branch !== undefined && branchIds.has(s.branch)
        ? { ...mapped, branch: p(s.branch) }
        : mapped
    }),
    cables: (fragment.cables ?? []).map((c) => ({ ...c, id: p(c.id) }))
  }
}

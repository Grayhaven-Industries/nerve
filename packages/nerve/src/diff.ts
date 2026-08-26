/**
 * Revision diff (PRD §21, DoD #9).
 *
 * Pure structural comparison of two HIR documents. Identifies added,
 * removed, and changed connectors, pinouts, wires, branches, labels, and
 * BOM rows — the categories §21 requires. Deterministic: output order
 * follows canonical HIR ordering.
 */
import { endpointLabel } from "./hir/core.js"
import type { Hir } from "./hir/schema.js"
import { isString } from "./is-string.js"

export interface FieldChange {
  readonly field: string
  readonly from: string
  readonly to: string
}

export interface EntityChange {
  readonly id: string
  readonly changes: ReadonlyArray<FieldChange>
}

export interface SectionDiff {
  readonly added: ReadonlyArray<string>
  readonly removed: ReadonlyArray<string>
  readonly changed: ReadonlyArray<EntityChange>
}

export interface PinoutChange {
  readonly connector: string
  readonly pin: string
  readonly from: string | undefined
  readonly to: string | undefined
}

export interface HirDiff {
  readonly harness: ReadonlyArray<FieldChange>
  readonly connectors: SectionDiff
  readonly pinouts: ReadonlyArray<PinoutChange>
  readonly wires: SectionDiff
  readonly splices: SectionDiff
  readonly cables: SectionDiff
  readonly branches: SectionDiff
  readonly labels: SectionDiff
  readonly bom: SectionDiff
}

/** What a compared HIR field can hold: scalars, or a joined list rendered by its getter. */
type FieldValue = string | number | undefined

const show = (v: FieldValue): string =>
  v === undefined ? "(none)" : isString(v) ? v : JSON.stringify(v)

const fieldChanges = <T>(
  a: T,
  b: T,
  fields: ReadonlyArray<readonly [string, (x: T) => FieldValue]>
): Array<FieldChange> => {
  const changes: Array<FieldChange> = []
  for (const [field, get] of fields) {
    const from = get(a)
    const to = get(b)
    if (show(from) !== show(to)) changes.push({ field, from: show(from), to: show(to) })
  }
  return changes
}

const sectionDiff = <T>(
  as: ReadonlyArray<T>,
  bs: ReadonlyArray<T>,
  key: (x: T) => string,
  fields: ReadonlyArray<readonly [string, (x: T) => FieldValue]>
): SectionDiff => {
  const aMap = new Map(as.map((x) => [key(x), x]))
  const bMap = new Map(bs.map((x) => [key(x), x]))
  const added = [...bMap.keys()].filter((k) => !aMap.has(k))
  const removed = [...aMap.keys()].filter((k) => !bMap.has(k))
  const changed: Array<EntityChange> = []
  for (const [k, a] of aMap) {
    const b = bMap.get(k)
    if (b === undefined) continue
    const changes = fieldChanges(a, b, fields)
    if (changes.length > 0) changed.push({ id: k, changes })
  }
  return { added, removed, changed }
}

export const diffHir = (a: Hir, b: Hir): HirDiff => {
  const pinouts: Array<PinoutChange> = []
  const bConnectors = new Map(b.connectors.map((c) => [c.ref, c]))
  for (const ca of a.connectors) {
    const cb = bConnectors.get(ca.ref)
    if (cb === undefined) continue
    const aPins = new Map(ca.pins.map((p) => [p.pin, p.signal]))
    const bPins = new Map(cb.pins.map((p) => [p.pin, p.signal]))
    for (const pin of new Set([...aPins.keys(), ...bPins.keys()])) {
      const from = aPins.get(pin)
      const to = bPins.get(pin)
      if (from !== to) pinouts.push({ connector: ca.ref, pin, from, to })
    }
  }

  return {
    harness: fieldChanges(a.harness, b.harness, [
      ["id", (h) => h.id],
      ["revision", (h) => h.revision],
      ["units", (h) => h.units]
    ]),
    connectors: sectionDiff(a.connectors, b.connectors, (c) => c.ref, [
      ["mpn", (c) => c.mpn],
      ["pinCount", (c) => c.pinCount],
      ["gender", (c) => c.gender]
    ]),
    pinouts,
    wires: sectionDiff(a.wires, b.wires, (w) => w.id, [
      ["from", (w) => endpointLabel(w.from)],
      ["to", (w) => endpointLabel(w.to)],
      ["gauge", (w) => w.gauge],
      ["color", (w) => w.color],
      ["length", (w) => w.length],
      ["signal", (w) => w.signal],
      ["twistGroup", (w) => w.twistGroup],
      ["cable", (w) => w.cable]
    ]),
    splices: sectionDiff(a.splices, b.splices, (s) => s.id, [
      ["type", (s) => s.type],
      ["part", (s) => s.part],
      ["branch", (s) => s.branch],
      ["location", (s) => s.location],
      ["wires", (s) => s.wires.join(", ")]
    ]),
    cables: sectionDiff(a.cables, b.cables, (c) => c.id, [
      ["type", (c) => c.type],
      ["conductors", (c) => c.conductors],
      ["cutLength", (c) => c.cutLength],
      ["wires", (c) => c.wires.join(", ")]
    ]),
    branches: sectionDiff(a.branches, b.branches, (br) => br.id, [
      ["path", (br) => br.path.join(" → ")],
      ["sleeve", (br) => br.sleeve],
      ["nominalLength", (br) => br.nominalLength],
      ["parent", (br) => br.parent]
    ]),
    labels: sectionDiff(a.labels, b.labels, (l) => l.id, [
      ["text", (l) => l.text],
      ["attachTo", (l) => l.attachTo],
      ["offsetFrom", (l) => l.offsetFrom],
      ["distance", (l) => l.distance]
    ]),
    bom: sectionDiff(a.bom, b.bom, (i) => i.mpn, [
      ["quantity", (i) => i.quantity],
      ["usedBy", (i) => i.usedBy.join(", ")]
    ])
  }
}

export const isEmptyDiff = (d: HirDiff): boolean =>
  d.harness.length === 0 &&
  d.pinouts.length === 0 &&
  [d.connectors, d.wires, d.splices, d.cables, d.branches, d.labels, d.bom].every(
    (s) => s.added.length === 0 && s.removed.length === 0 && s.changed.length === 0
  )

/** Human-readable diff (git-diff-flavored prefixes). */
export const formatDiff = (d: HirDiff): string => {
  const lines: Array<string> = []
  const section = (
    title: string,
    s: SectionDiff,
    prefix: string
  ): void => {
    if (s.added.length === 0 && s.removed.length === 0 && s.changed.length === 0) return
    lines.push(`${title}:`)
    for (const id of s.added) lines.push(`  + ${prefix}:${id}`)
    for (const id of s.removed) lines.push(`  - ${prefix}:${id}`)
    for (const c of s.changed) {
      lines.push(`  ~ ${prefix}:${c.id}`)
      for (const f of c.changes) lines.push(`      ${f.field}: ${f.from} -> ${f.to}`)
    }
  }

  if (d.harness.length > 0) {
    lines.push("harness:")
    for (const f of d.harness) lines.push(`  ~ ${f.field}: ${f.from} -> ${f.to}`)
  }
  section("connectors", d.connectors, "connector")
  if (d.pinouts.length > 0) {
    lines.push("pinouts:")
    for (const p of d.pinouts) {
      lines.push(`  ~ connector:${p.connector}.pin:${p.pin}: ${show(p.from)} -> ${show(p.to)}`)
    }
  }
  section("wires", d.wires, "wire")
  section("splices", d.splices, "splice")
  section("cables", d.cables, "cable")
  section("branches", d.branches, "branch")
  section("labels", d.labels, "label")
  section("bom", d.bom, "bom")
  return lines.length === 0 ? "No differences.\n" : lines.join("\n") + "\n"
}

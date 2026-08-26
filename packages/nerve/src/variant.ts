/**
 * Harness variants (PRD §8.4).
 *
 * A variant derives a new `HarnessDesign` from a base by adding, removing,
 * and overriding entities. The base is never mutated; shared definitions
 * stay shared. Lineage is recorded in `metadata.variantOf` so exports and
 * diffs can trace a variant back to its base. Validation applies to
 * variants exactly as to any harness — they compile through the same
 * pipeline.
 */
import type {
  BranchDef,
  CableDef,
  ConnectorInstance,
  HarnessDesign,
  LabelDef,
  SpliceDef,
  WireDef,
  WireProps
} from "./domain.js"

interface SectionMods<T> {
  readonly add?: ReadonlyArray<T>
  readonly remove?: ReadonlyArray<string>
}

export interface VariantOptions {
  readonly id: string
  readonly revision?: string
  readonly metadata?: Readonly<Record<string, string>>
  readonly connectors?: SectionMods<ConnectorInstance>
  readonly wires?: SectionMods<WireDef> & {
    /** Per-wire property overrides, e.g. `{ W1: { length: 800 } }`. */
    readonly override?: Readonly<Record<string, WireProps>>
  }
  readonly branches?: SectionMods<BranchDef> & {
    readonly override?: Readonly<Record<string, Partial<Omit<BranchDef, "kind" | "id">>>>
  }
  readonly labels?: SectionMods<LabelDef> & {
    readonly override?: Readonly<Record<string, Partial<Omit<LabelDef, "kind" | "id">>>>
  }
  readonly splices?: SectionMods<SpliceDef>
  readonly cables?: SectionMods<CableDef>
}

const apply = <T extends { readonly id: string }>(
  items: ReadonlyArray<T>,
  mods:
    | (SectionMods<T> & { readonly override?: Readonly<Record<string, Partial<NoInfer<T>>>> })
    | undefined
): ReadonlyArray<T> => {
  if (mods === undefined) return items
  const removed = new Set(mods.remove ?? [])
  const out = items
    .filter((item) => !removed.has(item.id))
    .map((item) =>
      mods.override?.[item.id] !== undefined ? { ...item, ...mods.override[item.id] } : item
    )
  return [...out, ...(mods.add ?? [])]
}

const applyConnectors = (
  items: ReadonlyArray<ConnectorInstance>,
  mods: SectionMods<ConnectorInstance> | undefined
): ReadonlyArray<ConnectorInstance> => {
  if (mods === undefined) return items
  const removed = new Set(mods.remove ?? [])
  return [...items.filter((c) => !removed.has(c.ref)), ...(mods.add ?? [])]
}

/** Derive a variant: `variant(base, { id: "...-long", wires: { override: { W1: { length: 800 } } } })`. */
export const variant = (base: HarnessDesign, opts: VariantOptions): HarnessDesign => ({
  kind: "harness",
  id: opts.id,
  revision: opts.revision ?? base.revision,
  units: base.units,
  metadata: {
    ...base.metadata,
    ...opts.metadata,
    variantOf: base.id
  },
  connectors: applyConnectors(base.connectors, opts.connectors),
  wires: apply(base.wires, opts.wires),
  branches: apply(base.branches, opts.branches),
  labels: apply(base.labels, opts.labels),
  splices: apply(base.splices, opts.splices),
  cables: apply(base.cables, opts.cables),
  // Carried through unchanged; protection edits aren't a variant axis yet.
  protections: base.protections
})

/**
 * Technician redline workflow (PRD §39).
 *
 * Manufacturing feedback flows back into source control instead of living
 * in PDF markups: every redline maps to an HIR object, engineers accept or
 * reject with a recorded reason, and accepted redlines yield a structured
 * patch (the same shape `variant()` consumes) so the fix is a reviewable
 * code change, not a verbal agreement.
 *
 * The bench feeds this directly: a build record's as-built length evidence
 * (PRD §36) becomes one redline per out-of-tolerance wire, and a whole
 * build's worth of accepted redlines merges into a single patch, so the
 * design change an engineer reviews is one diff rather than N.
 */
import { DiagnosticSeverity, type Diagnostic, type Hir, type VariantOptions } from "@grayhaven/nerve"
import type { BuildRecord } from "./build-record.js"
import { draft } from "./draft.js"

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export type RedlineType =
  | "ambiguity"
  | "incorrect-length"
  | "incorrect-label"
  | "orientation"
  | "process"
  | "other"

export interface Redline {
  readonly id: string
  /** HIR object reference, e.g. `wire:W7` or `label:L2`. */
  readonly target: string
  readonly type: RedlineType
  readonly description: string
  /** Proposed corrected value (length in harness units, label text, ...). */
  readonly proposedValue?: string
  readonly release: string
  readonly serial?: string
  readonly reportedBy?: string
  readonly status: "open" | "accepted" | "rejected"
  readonly resolution?: {
    readonly by?: string
    readonly reason: string
    readonly resolvedAt: string
  }
}

/** Validate that a redline's target exists in the HIR. */
export const validateRedlineTarget = (hir: Hir, target: string): Diagnostic | undefined => {
  const [kind, id] = target.split(":")
  const exists =
    (kind === "wire" && hir.wires.some((w) => w.id === id)) ||
    (kind === "label" && hir.labels.some((l) => l.id === id)) ||
    (kind === "branch" && hir.branches.some((b) => b.id === id)) ||
    (kind === "splice" && hir.splices.some((s) => s.id === id)) ||
    (kind === "connector" && hir.connectors.some((c) => c.ref === (id ?? "").split(".")[0]))
  return exists
    ? undefined
    : {
        code: "HK-RED-001",
        severity: DiagnosticSeverity.Error,
        message: `Redline target ${target} does not exist in this harness.`,
        target
      }
}

export const createRedline = (
  opts: Omit<Redline, "status" | "resolution">
): Redline => ({ ...opts, status: "open" })

/** Accept or reject. Rejected redlines are retained with their reason (PRD §39). */
export const resolveRedline = (
  redline: Redline,
  resolution: {
    readonly accept: boolean
    readonly reason: string
    readonly by?: string
    readonly resolvedAt: string
  }
): Redline => ({
  ...redline,
  status: resolution.accept ? "accepted" : "rejected",
  resolution:
    resolution.by !== undefined
      ? { by: resolution.by, reason: resolution.reason, resolvedAt: resolution.resolvedAt }
      : { reason: resolution.reason, resolvedAt: resolution.resolvedAt }
})

/**
 * Bulk-generate technician redlines from a build record's out-of-tolerance
 * length verdicts.
 *
 * One redline per out-of-tolerance wire; in-tolerance and no-design-length
 * verdicts produce nothing, since neither is a finding against the design.
 * Ids are `${idPrefix}-${wire}` so regenerating from the same record yields
 * the same ids and a re-run never duplicates an already-resolved redline.
 * Every redline opens as `"open"`: the measurement proposes, an engineer
 * still has to accept.
 */
export const redlinesFromBuildRecord = (
  record: BuildRecord,
  options?: {
    readonly idPrefix?: string
    readonly reportedBy?: string
  }
): ReadonlyArray<Redline> =>
  (record.lengths ?? [])
    .filter((verdict) => verdict.verdict === "out-of-tolerance")
    .map((verdict) => {
      const delta = verdict.measuredLength - (verdict.designLength ?? 0)
      const finding = draft<Omit<Redline, "status" | "resolution">>({
        id: `${options?.idPrefix ?? "RL"}-${verdict.wire}`,
        target: `wire:${verdict.wire}`,
        type: "incorrect-length",
        description:
          `Design length ${verdict.designLength ?? "unspecified"}, ` +
          `measured ${verdict.measuredLength} on ${record.serial} ` +
          `(${delta > 0 ? "+" : ""}${delta}).`,
        proposedValue: String(verdict.measuredLength),
        release: record.release,
        serial: record.serial
      })
      if (options?.reportedBy !== undefined) finding.reportedBy = options.reportedBy
      return createRedline(finding)
    })
    .sort((a, b) => cmp(a.id, b.id))

/**
 * Structured patch for an accepted redline — `VariantOptions`-shaped so it
 * can be applied with `variant()` or hand-translated into the source edit.
 */
export const suggestPatch = (
  redline: Redline
): Partial<VariantOptions> | undefined => {
  const [kind, id] = redline.target.split(":")
  if (id === undefined || redline.proposedValue === undefined) return undefined
  if (kind === "wire" && redline.type === "incorrect-length") {
    const length = Number(redline.proposedValue)
    if (!Number.isFinite(length)) return undefined
    return { wires: { override: { [id]: { length } } } }
  }
  if (kind === "label" && redline.type === "incorrect-label") {
    return { labels: { override: { [id]: { text: redline.proposedValue } } } }
  }
  if (kind === "branch" && redline.type === "incorrect-length") {
    const nominalLength = Number(redline.proposedValue)
    if (!Number.isFinite(nominalLength)) return undefined
    return { branches: { override: { [id]: { nominalLength } } } }
  }
  return undefined
}

/** Merge one section's override maps; later patches win, keys come out sorted. */
const mergeOverrides = <T extends object>(
  overrides: ReadonlyArray<Readonly<Record<string, T>> | undefined>
): Readonly<Record<string, T>> | undefined => {
  const merged = new Map<string, T>()
  for (const override of overrides) {
    if (override === undefined) continue
    for (const [id, props] of Object.entries(override)) {
      merged.set(id, { ...merged.get(id), ...props })
    }
  }
  if (merged.size === 0) return undefined
  const out: Record<string, T> = {}
  for (const id of [...merged.keys()].sort(cmp)) {
    const props = merged.get(id)!
    // SAFETY: the entries are exactly those of `props: T`, re-inserted in
    // sorted key order; no key or value is added, dropped, or changed.
    out[id] = Object.fromEntries(Object.entries(props).sort(([a], [b]) => cmp(a, b))) as T
  }
  return out
}

/**
 * Deep-merge accepted-redline patches into one `VariantOptions`-shaped patch.
 *
 * A build's worth of accepted redlines becomes a single reviewable change
 * instead of N. Overrides merge per object and per property, later patches
 * winning on collision, and every key is emitted sorted so the same
 * redlines always produce the same patch.
 */
export const mergePatches = (
  patches: ReadonlyArray<Partial<VariantOptions>>
): Partial<VariantOptions> => {
  const branches = mergeOverrides(patches.map((p) => p.branches?.override))
  const labels = mergeOverrides(patches.map((p) => p.labels?.override))
  const wires = mergeOverrides(patches.map((p) => p.wires?.override))
  const patch = draft<Partial<VariantOptions>>({})
  if (branches !== undefined) patch.branches = { override: branches }
  if (labels !== undefined) patch.labels = { override: labels }
  if (wires !== undefined) patch.wires = { override: wires }
  return patch
}

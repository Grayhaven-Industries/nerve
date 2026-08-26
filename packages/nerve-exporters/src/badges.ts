/**
 * Diagnostic badges (PRD §11.2 made visible on drawings).
 *
 * Every view (schematic, board, faces) already lays out pins, splices, and
 * branches; this helper turns `hir.diagnostics` into positioned badge
 * DrawItems via a per-view anchor resolver. The exported packet becomes
 * self-describing: a reviewer who only opens the PDF sees the finding at
 * the entity, not in a side list.
 *
 * Badges carry the same data-* attributes the underlying element uses, so
 * cross-view selection (nerve-web selection.ts) works on badge click, plus
 * `data-diagnostic` listing the codes anchored there.
 */
import type { Hir } from "@grayhaven/nerve"
import type { DrawItem } from "./drawing.js"

export interface ParsedRef {
  readonly kind: "connector" | "pin" | "wire" | "branch" | "splice" | "label" | "bom"
  readonly ref: string
  readonly pin?: string
}

/** Parse a PRD §19 object ref ("wire:W2", "connector:P1.pin:1"). */
export const parseRef = (target: string): ParsedRef | undefined => {
  const pin = /^connector:([^.]+)\.pin:(.+)$/.exec(target)
  if (pin !== null) return { kind: "pin", ref: pin[1]!, pin: pin[2]! }
  const m = /^(wire|connector|splice|branch|label|bom):(.+)$/.exec(target)
  if (m === null) return undefined
  // SAFETY: the first capture group is the alternation
  // wire|connector|splice|branch|label|bom, which is exactly the set of
  // `ParsedRef["kind"]` values other than "pin" (handled above).
  return { kind: m[1] as ParsedRef["kind"], ref: m[2]! }
}

export interface BadgeAnchor {
  readonly x: number
  readonly y: number
  /** data-* attributes matching the badged element (selection click-through). */
  readonly data?: Readonly<Record<string, string>>
}

const ERROR_FILL = "#d11"
const WARNING_FILL = "#d97706"

/**
 * Resolve every diagnostic's `target` + `targets` refs through the view's
 * anchor resolver and emit one badge per distinct anchor: "!" (or a count
 * when several diagnostics share the anchor), red for errors, amber for
 * warnings. Deterministic: groups form in diagnostics order.
 */
export const diagnosticBadges = (
  diagnostics: Hir["diagnostics"],
  resolve: (ref: ParsedRef) => BadgeAnchor | undefined
): Array<DrawItem> => {
  interface Group {
    readonly anchor: BadgeAnchor
    readonly codes: Array<string>
    error: boolean
    diagnostics: number
  }
  const groups = new Map<string, Group>()
  for (const d of diagnostics) {
    if (d.severity === "info") continue
    const refsOf = [...new Set([d.target, ...(d.targets ?? [])])].filter(
      (r): r is string => r !== undefined
    )
    // A single diagnostic counts ONCE per anchor even if several of its
    // refs resolve to the same point — the badge number is "how many
    // findings sit here", not "how many refs".
    const anchored = new Set<string>()
    for (const r of refsOf) {
      const parsed = parseRef(r)
      if (parsed === undefined) continue
      const anchor = resolve(parsed)
      if (anchor === undefined) continue
      const key = `${anchor.x},${anchor.y}`
      const g = groups.get(key) ?? { anchor, codes: [], error: false, diagnostics: 0 }
      if (!anchored.has(key)) {
        g.diagnostics += 1
        anchored.add(key)
      }
      if (!g.codes.includes(d.code)) g.codes.push(d.code)
      if (d.severity === "error") g.error = true
      groups.set(key, g)
    }
  }
  const items: Array<DrawItem> = []
  for (const g of groups.values()) {
    const data = { ...g.anchor.data, diagnostic: g.codes.join(" ") }
    items.push(
      {
        kind: "circle",
        cx: g.anchor.x,
        cy: g.anchor.y,
        r: 7,
        fill: g.error ? ERROR_FILL : WARNING_FILL,
        data
      },
      {
        kind: "text",
        x: g.anchor.x,
        y: g.anchor.y + 3.5,
        text: g.diagnostics > 1 ? String(g.diagnostics) : "!",
        size: 10,
        weight: "bold",
        fill: "#ffffff",
        anchor: "middle",
        data
      }
    )
  }
  return items
}

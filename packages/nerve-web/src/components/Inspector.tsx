/**
 * Selected-object inspector (PRD §11.3): a quiet overlay card describing
 * whatever is selected in any sheet, with a jump to its source definition.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react"
import type { Hir, HirKiCadAsset } from "@grayhaven/nerve"
import { Button } from "@/components/ui/button"
// shadcn/ui 4.13.1, "radix-nova" style: Card owns the surface, radius, and
// padding; CardHeader switches to a [1fr_auto] grid when a CardAction is
// present, which is what used to be the hand-rolled .inspector-head flex row.
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card"
import { jumpToSource } from "../lib/editor-registry.js"
import { setSelection, useSelection, type Selection } from "../lib/selection.js"

const rows = (hir: Hir, sel: Selection): Array<readonly [string, string]> => {
  if (sel.kind === "wire") {
    const w = hir.wires.find((x) => x.id === sel.ref)
    if (w === undefined) return []
    const end = (e: typeof w.from): string =>
      "connector" in e ? `${e.connector}.${e.pin}` : e.splice
    return [
      ["wire", w.id],
      ["from", end(w.from)],
      ["to", end(w.to)],
      ...(w.signal !== undefined ? [["signal", w.signal] as const] : []),
      ...(w.gauge !== undefined ? [["gauge", w.gauge] as const] : []),
      ...(w.color !== undefined ? [["color", w.color] as const] : []),
      ...(w.length !== undefined ? [["length", `${w.length} ${hir.harness.units}`] as const] : []),
      ...(w.twistGroup !== undefined ? [["twist", w.twistGroup] as const] : [])
    ]
  }
  if (sel.kind === "connector" || sel.kind === "pin") {
    const c = hir.connectors.find((x) => x.ref === sel.ref)
    if (c === undefined) return []
    const base: Array<readonly [string, string]> = [
      ["connector", c.ref],
      ["mpn", c.mpn],
      ...(c.family !== undefined ? [["family", c.family] as const] : []),
      ...(c.gender !== undefined ? [["gender", c.gender] as const] : []),
      ["pins", String(c.pinCount)]
    ]
    if (sel.kind === "pin") {
      const p = c.pins.find((x) => x.pin === sel.pin)
      return [
        ["pin", `${c.ref}.${sel.pin ?? ""}`],
        ...(p?.signal !== undefined ? [["signal", p.signal] as const] : []),
        ["mpn", c.mpn]
      ]
    }
    return base
  }
  const s = hir.splices.find((x) => x.id === sel.ref)
  if (s === undefined) return []
  return [
    ["splice", s.id],
    ...(s.type !== undefined ? [["type", s.type] as const] : []),
    ...(s.branch !== undefined ? [["branch", s.branch] as const] : [])
  ]
}

const webUrl = (value: string): string | undefined => {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined
  } catch {
    return undefined
  }
}

function KiCadAssets({ assets }: { assets: ReadonlyArray<HirKiCadAsset> }) {
  if (assets.length === 0) return null
  return (
    <details className="mb-2">
      <summary className="cursor-pointer">KiCad library assets ({assets.length})</summary>
      <ul className="mt-2 max-h-64 space-y-3 overflow-y-auto" aria-label="KiCad library assets">
        {assets.map((asset, index) => (
          <li key={`${asset.kind}:${asset.identifier}:${index}`} className="break-words">
            <p>
              {asset.kind === "model3d" ? "3D model" : asset.kind}
              {asset.relationship === "mate" ? ` · mate ${asset.mpn ?? ""}` : asset.relationship === "generic" ? " · generic" : " · this part"}
            </p>
            <a href={webUrl(asset.sourceUrl)} target="_blank" rel="noreferrer" className="underline">
              {asset.identifier}
            </a>
            {asset.notes && <p className="text-muted-foreground">{asset.notes}</p>}
            <p className="text-muted-foreground">
              {asset.license.attribution}{" · "}
              <a href={webUrl(asset.license.url)} target="_blank" rel="noreferrer" className="underline">
                {asset.license.spdxId}{asset.license.exception ? ` (${asset.license.exception})` : ""}
              </a>
            </p>
          </li>
        ))}
      </ul>
    </details>
  )
}

export function Inspector({
  hir,
  focusOnClose
}: {
  hir: Hir
  /**
   * Stable focusable element to hand focus back to when the card closes —
   * the sheet the selection was made in. The clicked SVG geometry itself is
   * not focusable and is destroyed on every recompile, so the sheet's
   * tabIndex=0 region is the predictable landing spot.
   */
  focusOnClose?: RefObject<HTMLElement | null>
}) {
  const sel = useSelection()
  const cardRef = useRef<HTMLDivElement | null>(null)
  // Closing unmounts this card, so whatever was focused inside it is
  // destroyed and focus silently falls to <body>. Move focus out first.
  // Only when focus is actually inside the card: Escape pressed elsewhere
  // must not yank the caret across the app.
  // React 19.1 — function components receive `ref` as an ordinary prop, so
  // Card's {...props} spread lands it on the underlying div (no forwardRef).
  const close = useCallback(() => {
    const active = document.activeElement
    if (active !== null && cardRef.current?.contains(active) === true) {
      focusOnClose?.current?.focus()
    }
    setSelection(undefined)
  }, [focusOnClose])
  // Escape clears the selection while the inspector is showing — unless a
  // text field has focus (Escape there belongs to the field/editor).
  useEffect(() => {
    if (sel === undefined) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      const t = e.target
      if (
        t instanceof HTMLElement &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      ) {
        return
      }
      close()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [sel, close])
  if (sel === undefined) return null
  const data = rows(hir, sel)
  if (data.length === 0) return null
  const assets = sel.kind === "connector" || sel.kind === "pin"
    ? hir.connectors.find((connector) => connector.ref === sel.ref)?.kicadAssets
    : undefined
  const sourceId = sel.kind === "pin" ? sel.ref : sel.ref
  return (
    // size="sm" keeps --card-spacing at 3 (12px) so the overlay stays compact.
    // bg-popover holds the raised surface .inspector used to set by hand —
    // Card's own bg-card is one luminance step lower than a floating overlay
    // wants. No CardTitle: the kind label is a quiet .spec-tag, not a heading.
    <Card
      ref={cardRef}
      size="sm"
      className="inspector bg-popover"
      role="region"
      aria-label="Selected object"
    >
      <CardHeader>
        <span className="spec-tag">{sel.kind}</span>
        <CardAction>
          <Button
            variant="ghost"
            size="xs"
            aria-label="Close inspector"
            onClick={close}
          >
            ✕
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <dl>
          {data.map(([k, v]) => (
            <div key={k + v}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {assets && <KiCadAssets assets={assets} />}
        <Button variant="ghost" size="xs" onClick={() => jumpToSource(sourceId)}>
          View source ↗
        </Button>
      </CardContent>
    </Card>
  )
}

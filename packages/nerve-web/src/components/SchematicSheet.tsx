import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { Hir } from "@grayhaven/nerve"
import { Button } from "@/components/ui/button"
import { Inspector } from "./Inspector.js"
import { selectionFromElement, selectorFor, setSelection, useSelection } from "../lib/selection.js"

/**
 * Interactive sheet wrapper for exporter-generated SVG (diagram + board).
 * All interactivity is view-layer only — the SVG string stays the
 * byte-deterministic artifact.
 *
 * - Hover net-highlighting: delegated pointer events (one listener pair
 *   survives every dangerouslySetInnerHTML swap) toggle .hl on elements
 *   sharing the hovered data-wire and .dimmed on the sheet.
 * - Zoom: ctrl/cmd+wheel scales the SVG via CSS width (zoom-to-cursor by
 *   adjusting the scroll container); native scrollbars keep panning calm.
 * - Copy SVG: the deterministic markup pastes into Figma/Inkscape as vectors.
 */
export function SchematicSheet({
  svg,
  filename,
  hir,
  kind
}: {
  svg: string
  filename: string
  hir: Hir
  kind: "schematic" | "board" | "faces"
}) {
  const paneRef = useRef<HTMLDivElement | null>(null)
  const zoomRef = useRef(1)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  // Zoom is a ref written straight onto the SVG element's style, but the
  // markup is replaced wholesale by dangerouslySetInnerHTML on every
  // recompile — which drops the inline style while zoomRef still reads e.g.
  // 2x, so the next tick jumps. React 19.1: a callback ref only re-runs on
  // attach/detach, never when a prop like __html changes, so `attach` cannot
  // notice the swap. Hoisted out of `attach` so the swap effect below can
  // re-apply it too.
  const applyZoom = useCallback((z: number) => {
    const svgEl = paneRef.current?.querySelector("svg")
    if (svgEl === null || svgEl === undefined) return
    const natural = Number(svgEl.getAttribute("width"))
    if (Number.isNaN(natural)) return
    svgEl.style.width = `${natural * z}px`
    svgEl.style.height = "auto"
  }, [])

  // Re-apply the held zoom to the freshly injected markup. Layout effect, so
  // it lands before paint and the sheet never flashes back to natural size.
  useLayoutEffect(() => {
    applyZoom(zoomRef.current)
  }, [svg, applyZoom])

  const attach = useCallback((pane: HTMLDivElement | null) => {
    paneRef.current = pane
    if (pane === null) return

    const clear = () => {
      pane.classList.remove("net-hover")
      for (const el of pane.querySelectorAll(".hl")) el.classList.remove("hl")
    }
    const over = (e: PointerEvent) => {
      const ref =
        e.target instanceof Element
          ? e.target.closest("[data-wire]")?.getAttribute("data-wire")
          : undefined
      clear()
      if (ref === null || ref === undefined) return
      pane.classList.add("net-hover")
      for (const el of pane.querySelectorAll(`[data-wire="${CSS.escape(ref)}"]`)) {
        el.classList.add("hl")
      }
    }
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const scroller = pane.closest(".render-pane") ?? pane
      const rect = pane.getBoundingClientRect()
      const prev = zoomRef.current
      const next = Math.min(4, Math.max(0.4, prev * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      if (next === prev) return
      // Zoom-to-cursor: keep the point under the pointer stationary.
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      zoomRef.current = next
      applyZoom(next)
      scroller.scrollLeft += px * (next / prev - 1)
      scroller.scrollTop += py * (next / prev - 1)
    }
    const click = (e: MouseEvent) => {
      if (e.target instanceof Element) setSelection(selectionFromElement(e.target))
    }
    // Keyboard parity for the focusable pane: ± zoom, 0 resets, Escape
    // clears the selection. Same clamp as the wheel handler.
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        setSelection(undefined)
        return
      }
      if (e.key === "0") {
        e.preventDefault()
        zoomRef.current = 1
        applyZoom(1)
        return
      }
      const factor = e.key === "+" || e.key === "=" ? 1.15 : e.key === "-" ? 1 / 1.15 : undefined
      if (factor === undefined) return
      e.preventDefault()
      const next = Math.min(4, Math.max(0.4, zoomRef.current * factor))
      zoomRef.current = next
      applyZoom(next)
    }
    pane.addEventListener("pointerover", over)
    pane.addEventListener("pointerleave", clear)
    pane.addEventListener("click", click)
    pane.addEventListener("keydown", keydown)
    pane.addEventListener("wheel", wheel, { passive: false })
    applyZoom(zoomRef.current)
    // React 19 ref cleanup: colocated teardown.
    return () => {
      pane.removeEventListener("pointerover", over)
      pane.removeEventListener("pointerleave", clear)
      pane.removeEventListener("click", click)
      pane.removeEventListener("keydown", keydown)
      pane.removeEventListener("wheel", wheel)
    }
  }, [applyZoom])

  // Persistent cross-view selection highlight (PRD §11.3): survives both
  // selection changes and innerHTML swaps on recompile.
  const selection = useSelection()
  useEffect(() => {
    const pane = paneRef.current
    if (pane === null) return
    pane.classList.toggle("has-sel", selection !== undefined)
    const marked = selection !== undefined ? [...pane.querySelectorAll(selectorFor(selection))] : []
    for (const el of marked) el.classList.add("sel")
    return () => {
      pane.classList.remove("has-sel")
      for (const el of marked) el.classList.remove("sel")
    }
  }, [selection, svg])

  const copy = () => {
    void navigator.clipboard.writeText(svg).then(() => {
      setCopied(true)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 2000)
    })
  }
  const downloadBlob = (contents: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type }))
    const a = document.createElement("a")
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  }
  const download = () => downloadBlob(svg, filename, "image/svg+xml")
  // Self-contained interactive viewer (hover nets, zoom, pan) — opens
  // anywhere, no app needed. Lazy: shares the exporters chunk with the
  // packet export.
  const downloadHtml = async () => {
    const { schematicHtml, boardHtml, facesHtml } = await import("@grayhaven/nerve-exporters")
    const html =
      kind === "schematic" ? schematicHtml(hir) : kind === "board" ? boardHtml(hir) : facesHtml(hir)
    downloadBlob(html, filename.replace(/\.svg$/, ".html"), "text/html")
  }

  return (
    <div className="sheet-wrap" style={{ position: "relative" }}>
      <div className="sheet-actions">
        <Button variant="ghost" size="xs" onClick={copy}>
          {copied ? "Copied ✓" : "Copy SVG"}
        </Button>
        <Button variant="ghost" size="xs" onClick={download}>
          Download SVG
        </Button>
        <Button variant="ghost" size="xs" onClick={() => void downloadHtml()}>
          Download HTML
        </Button>
        <span className="sheet-hint">⌘+scroll or ± to zoom · hover a wire</span>
      </div>
      {/* Closing the inspector sends focus back to the sheet the selection
          came from, not to <body>. */}
      <Inspector hir={hir} focusOnClose={paneRef} />
      <div
        className="diagram-pane"
        ref={attach}
        // axe scrollable-region-focusable: keyboard users must be able to
        // scroll the sheet.
        tabIndex={0}
        role="region"
        aria-label={`${kind} drawing`}
        // The SVG is generated by our own deterministic renderer from HIR.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  )
}

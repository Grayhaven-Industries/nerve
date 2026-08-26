/**
 * Connector face views (PRD §9.5.2): physical cavity layout for assembly
 * and inspection. For every connector: FRONT (mating side, mirrored) and
 * REAR (wire side) views with pin numbering, population state, wire color
 * per cavity, signal names, and an orientation marker. Deterministic
 * DrawingIR like every exporter.
 *
 * Cavity grid comes from the part's cavityLayout; without one, a derived
 * grid is used (single row up to 6 cavities, dual row above) and the
 * drawing says so — face views are only as physical as the part data.
 */
import { isPinEndpoint, type Hir, type HirConnector, type HirWire } from "@grayhaven/nerve"
import { diagnosticBadges } from "./badges.js"
import { renderSvg, textWidth, type DrawItem, type DrawPath, type Drawing } from "./drawing.js"
import { draft } from "./draft.js"

const CAV_R = 9
const PITCH = 26
const VIEW_GAP = 70
const CARD_PAD = 18
const HEADER = 46
const MARGIN = 40
const TITLE_H = 64
const MIN_SIGNAL_COL = 150

/** Authored color names that need a visible stroke; anything else is used as written. */
const NAMED_STROKES = new Map([
  ["white", "#b8b8b8"],
  ["yellow", "#c9a800"],
  ["black", "#222222"]
])

const strokeFor = (color: string | undefined): string => {
  if (color === undefined) return "#888888"
  return NAMED_STROKES.get(color.toLowerCase()) ?? color
}

interface CavityState {
  readonly pin: string
  readonly signal?: string | undefined
  readonly wire?: HirWire | undefined
  readonly reserved: boolean
}

/** data-* attributes for a cavity: the wire lands only when one is populated. */
type CavityData = { connector: string; pin: string; wire?: string }

const cavityData = (connector: string, cav: CavityState): CavityData => {
  const data: CavityData = { connector, pin: cav.pin }
  if (cav.wire !== undefined) data.wire = cav.wire.id
  return data
}

const layoutOf = (c: HirConnector): { rows: number; columns: number; derived: boolean } =>
  c.cavityLayout !== undefined
    ? { ...c.cavityLayout, derived: false }
    : c.pinCount <= 6
      ? { rows: 1, columns: c.pinCount, derived: true }
      : { rows: 2, columns: Math.ceil(c.pinCount / 2), derived: true }

export const connectorFacesDrawing = (hir: Hir): Drawing => {
  // Wire per pin (first wire touching the cavity claims its color).
  const wireAt = new Map<string, HirWire>()
  for (const w of hir.wires) {
    for (const e of [w.from, w.to]) {
      if (isPinEndpoint(e)) {
        const key = `${e.connector}:${e.pin}`
        if (!wireAt.has(key)) wireAt.set(key, w)
      }
    }
  }

  const items: Array<DrawItem> = [
    { kind: "text", x: MARGIN, y: 28, text: `${hir.harness.id} — connector faces`, size: 18, weight: "bold", fill: "#111" },
    {
      kind: "text",
      x: MARGIN,
      y: 48,
      text: `rev ${hir.harness.revision} · units ${hir.harness.units} · HIR ${hir.schemaVersion}`,
      fill: "#555"
    }
  ]

  let y = TITLE_H + 8
  let maxRight = 0

  // Badge anchors: connector card headers and REAR-view cavity centers
  // (the wire side is where a technician acts on a finding).
  const cardAt = new Map<string, { x: number; y: number }>()
  const cavityAt = new Map<string, { x: number; y: number }>()

  for (const c of hir.connectors) {
    const { rows, columns, derived } = layoutOf(c)
    const reserved = new Set(c.reservedPins ?? [])
    // Numeric connectors number cavities 1..pinCount; named connectors
    // (pins like "A1") have no numeric cavity index, so cells follow the
    // declared pin order — their data shows instead of an empty "—".
    const numeric = c.pins.every((p) => /^\d+$/.test(p.pin))
    const cellCount = numeric ? c.pinCount : Math.max(c.pinCount, c.pins.length)
    const cavities: Array<CavityState> = Array.from({ length: cellCount }, (_, i) => {
      const pin = numeric ? String(i + 1) : c.pins[i]?.pin ?? String(i + 1)
      const assigned = c.pins.find((p) => p.pin === pin)
      return {
        pin,
        signal: assigned?.signal,
        wire: wireAt.get(`${c.ref}:${pin}`),
        reserved: reserved.has(pin)
      }
    })

    const gridW = columns * PITCH
    const gridH = rows * PITCH
    const viewW = gridW + 2 * CARD_PAD
    const viewH = gridH + 2 * CARD_PAD
    // Legend column sized to its longest measured row (was a fixed 150px
    // that long signal names silently overran).
    const legendRows = cavities
      .filter((cv) => cv.signal !== undefined)
      .map(
        (cv) =>
          `${cv.pin}  ${cv.signal ?? ""}${cv.wire?.gauge !== undefined ? ` · ${cv.wire.gauge}` : ""}`
      )
    const signalCol = Math.max(
      MIN_SIGNAL_COL,
      ...legendRows.map((t) => textWidth(t, 9) + 32)
    )
    const cardW = viewW * 2 + VIEW_GAP + signalCol
    // The card must contain whichever is taller: the views or the legend.
    const cardH = Math.max(HEADER + viewH + 26, HEADER + 10 + legendRows.length * 13 + 16)

    // Card frame + header.
    items.push(
      { kind: "rect", x: MARGIN, y, w: cardW, h: cardH, rx: 6, fill: "#ffffff", stroke: "#333", strokeWidth: 1.5, data: { connector: c.ref } },
      { kind: "text", x: MARGIN + 12, y: y + 20, text: c.ref, weight: "bold", fill: "#111", data: { connector: c.ref } },
      {
        kind: "text",
        x: MARGIN + 12,
        y: y + 36,
        text: `${c.mpn}${c.gender !== undefined ? ` · ${c.gender}` : ""}${c.sealed === true ? " · sealed" : ""}${derived ? " · derived grid" : ""}`,
        size: 10,
        fill: "#777"
      }
    )

    cardAt.set(c.ref, { x: MARGIN + cardW, y: y + 14 })

    const drawView = (originX: number, mirrored: boolean, caption: string): void => {
      const gy = y + HEADER
      items.push(
        { kind: "rect", x: originX, y: gy, w: viewW, h: viewH, rx: 10, fill: "#f4f2ee", stroke: "#999", strokeWidth: 1 },
        // Orientation marker: keying notch at top-left of THIS view.
        {
          kind: "path",
          d: `M ${originX + 14} ${gy} L ${originX + 26} ${gy} L ${originX + 20} ${gy + 8} Z`,
          stroke: "#666",
          strokeWidth: 1
        },
        { kind: "text", x: originX + viewW / 2, y: gy + viewH + 16, text: caption, size: 10, fill: "#555", anchor: "middle" }
      )
      cavities.forEach((cav, i) => {
        const row = Math.floor(i / columns)
        const col = i % columns
        const drawCol = mirrored ? columns - 1 - col : col
        const cx = originX + CARD_PAD + drawCol * PITCH + PITCH / 2
        const cy = gy + CARD_PAD + row * PITCH + PITCH / 2
        if (!mirrored) cavityAt.set(`${c.ref}:${cav.pin}`, { x: cx, y: cy })
        const populated = cav.wire !== undefined
        const data = cavityData(c.ref, cav)
        if (populated) {
          items.push({ kind: "circle", cx, cy, r: CAV_R, fill: strokeFor(cav.wire?.color), data })
        }
        const ring = draft<DrawPath>({
          kind: "path",
          d: `M ${cx - CAV_R} ${cy} A ${CAV_R} ${CAV_R} 0 1 0 ${cx + CAV_R} ${cy} A ${CAV_R} ${CAV_R} 0 1 0 ${cx - CAV_R} ${cy} Z`,
          stroke: cav.reserved ? "#b3261e" : cav.signal !== undefined && !populated ? "#666" : "#333",
          strokeWidth: cav.signal !== undefined && !populated ? 1.8 : 1.2
        })
        if (cav.reserved) ring.dash = [3, 2]
        ring.data = data
        items.push(ring)
        items.push({
          kind: "text",
          x: cx,
          y: cy + 3.5,
          text: cav.pin,
          size: 9,
          weight: populated ? "bold" : "normal",
          fill: populated && (cav.wire?.color === "black" || cav.wire?.color === "blue" || cav.wire?.color === "red") ? "#ffffff" : "#333",
          anchor: "middle",
          data
        })
      })
    }

    drawView(MARGIN + 12, true, "FRONT · mating side")
    drawView(MARGIN + 12 + viewW + VIEW_GAP, false, "REAR · wire side")

    // Signal legend beside the rear view (rear order = harness pin order).
    // Every assigned cavity gets a row — the old slice(0, rows*8) silently
    // dropped legend rows on fully-populated connectors (data loss), so
    // the card now grows instead.
    const legendX = MARGIN + 12 + viewW * 2 + VIEW_GAP + 16
    const populatedCavs = cavities.filter((cv) => cv.signal !== undefined)
    populatedCavs.forEach((cav, i) => {
      items.push({
        kind: "text",
        x: legendX,
        y: y + HEADER + 10 + i * 13,
        text: `${cav.pin}  ${cav.signal ?? ""}${cav.wire?.gauge !== undefined ? ` · ${cav.wire.gauge}` : ""}`,
        size: 9,
        fill: "#444",
        ...(cav.wire !== undefined ? { data: { connector: c.ref, pin: cav.pin, wire: cav.wire.id } } : { data: { connector: c.ref, pin: cav.pin } })
      })
    })

    maxRight = Math.max(maxRight, MARGIN + cardW)
    y += cardH + 16
  }

  // Diagnostic badges: pin findings sit at the REAR cavity (offset to the
  // cavity rim so the pin number stays legible); connector findings sit
  // at the card's top-right corner.
  items.push(
    ...diagnosticBadges(hir.diagnostics, (r) => {
      switch (r.kind) {
        case "pin": {
          const p = cavityAt.get(`${r.ref}:${r.pin}`)
          if (p === undefined) return undefined
          return {
            x: p.x + CAV_R + 4,
            y: p.y - CAV_R - 2,
            data: { connector: r.ref, pin: r.pin! }
          }
        }
        case "connector": {
          const c = cardAt.get(r.ref)
          if (c === undefined) return undefined
          return { x: c.x - 12, y: c.y, data: { connector: r.ref } }
        }
        default:
          return undefined
      }
    })
  )

  return { width: maxRight + MARGIN, height: y + MARGIN, background: "#fafafa", items }
}

export const connectorFacesSvg = (hir: Hir): string => renderSvg(connectorFacesDrawing(hir))

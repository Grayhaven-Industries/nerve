/**
 * SPIKE (not public API): ELK-layered schematic layout.
 * Same visual language as svg.ts, but node placement and orthogonal wire
 * routing come from elkjs (the engine behind netlistsvg/d3-hwschematic).
 */
import { createRequire } from "node:module"
// elkjs's bundled entry can't self-require its fake worker under bun;
// use the api entry and wire the in-process worker explicitly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const require_ = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const ELKApi: any = require_("elkjs/lib/elk-api.js")
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ELK: any = ELKApi.default ?? ELKApi
// Bun has real Web Workers — run ELK's worker script in one.
const workerUrl = require_.resolve("elkjs/lib/elk-worker.min.js")
import { isPinEndpoint, type Hir, type HirEndpoint } from "@grayhaven/nerve"
import { renderSvg, type DrawItem, type DrawPath, type Drawing } from "../src/drawing.js"
import { draft } from "../src/draft.js"

const BOX_W = 180
const ROW_H = 20
const HEADER_H = 40
const TITLE_H = 64
const MARGIN = 48

const NAMED_STROKES = new Map([
  ["white", "#b8b8b8"],
  ["yellow", "#c9a800"],
  ["black", "#222222"]
])

const strokeFor = (color: string | undefined): string => {
  if (color === undefined) return "#888888"
  return NAMED_STROKES.get(color.toLowerCase()) ?? color
}

/** An ELK edge between two nodes, attached to ports where the ends are pins. */
interface ElkEdge {
  readonly id: string
  readonly sources: ReadonlyArray<string>
  readonly targets: ReadonlyArray<string>
  readonly sourcePort?: string
  readonly targetPort?: string
}

export const schematicDrawingElk = async (hir: Hir): Promise<Drawing> => {
  const elk = new ELK({
    workerUrl,
    workerFactory: (url: string) => new Worker(url)
  })

  // Side pre-pass: anchor pins toward the column the connector sat in
  // under the legacy layout (even index -> ports EAST, odd -> WEST).
  const sideOf = new Map(hir.connectors.map((c, i) => [c.ref, i % 2 === 0 ? "E" : "W"]))

  const nodes = hir.connectors.map((c) => {
    const height = HEADER_H + c.pins.length * ROW_H + 8
    const east = sideOf.get(c.ref) === "E"
    return {
      id: c.ref,
      width: BOX_W,
      height,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: c.pins.map((p, i) => ({
        id: `${c.ref}::${p.pin}`,
        width: 1,
        height: 1,
        x: east ? BOX_W : 0,
        y: HEADER_H + (i + 0.5) * ROW_H
      }))
    }
  })
  const spliceNodes = hir.splices.map((s) => ({ id: `splice:${s.id}`, width: 14, height: 14 }))

  const portRef = (e: HirEndpoint): { node: string; port?: string } =>
    isPinEndpoint(e)
      ? { node: e.connector, port: `${e.connector}::${e.pin}` }
      : { node: `splice:${e.splice}` }

  const edges = hir.wires.map((w): ElkEdge => {
    const a = portRef(w.from)
    const b = portRef(w.to)
    const edge = draft<ElkEdge>({ id: `wire:${w.id}`, sources: [a.node], targets: [b.node] })
    if (a.port !== undefined) edge.sourcePort = a.port
    if (b.port !== undefined) edge.targetPort = b.port
    return edge
  })

  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "48",
      "elk.layered.spacing.nodeNodeBetweenLayers": "140",
      "elk.spacing.edgeNode": "24",
      "elk.spacing.edgeEdge": "12",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]"
    },
    children: [...nodes, ...spliceNodes],
    edges
  })

  const pos = new Map(
    (graph.children ?? []).map((n) => [n.id, { x: (n.x ?? 0) + MARGIN, y: (n.y ?? 0) + TITLE_H + MARGIN }])
  )
  const errorWires = new Set(
    hir.diagnostics
      .filter((d) => d.severity === "error" && d.target?.startsWith("wire:"))
      .map((d) => d.target!.slice("wire:".length))
  )

  const items: Array<DrawItem> = [
    { kind: "text", x: MARGIN, y: 28, text: hir.harness.id, size: 18, weight: "bold", fill: "#111" },
    {
      kind: "text",
      x: MARGIN,
      y: 48,
      text: `rev ${hir.harness.revision} · units ${hir.harness.units} · HIR ${hir.schemaVersion} · ELK spike`,
      fill: "#555"
    }
  ]

  // Wires from ELK's orthogonal sections.
  for (const e of graph.edges ?? []) {
    const wid = e.id.replace(/^wire:/, "")
    const w = hir.wires.find((x) => x.id === wid)
    const isError = errorWires.has(wid)
    for (const s of e.sections ?? []) {
      const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({
        x: p.x + MARGIN,
        y: p.y + TITLE_H + MARGIN
      }))
      const route = draft<DrawPath>({
        kind: "path",
        d: pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" "),
        stroke: isError ? "#d11" : strokeFor(w?.color),
        strokeWidth: 2
      })
      if (isError) route.dash = [6, 3]
      items.push(route)
      const mid = pts[Math.floor(pts.length / 2)]!
      const annotation = [w?.id, w?.gauge, w?.twistGroup !== undefined ? "twisted" : undefined]
        .filter((x): x is string => x !== undefined)
        .join(" · ")
      items.push({
        kind: "text",
        x: mid.x,
        y: mid.y - 6,
        text: annotation,
        fill: isError ? "#d11" : "#333",
        anchor: "middle"
      })
    }
  }

  // Connector blocks (same visual language as svg.ts).
  for (const c of hir.connectors) {
    const p = pos.get(c.ref)
    if (p === undefined) continue
    const height = HEADER_H + c.pins.length * ROW_H + 8
    const east = sideOf.get(c.ref) === "E"
    items.push(
      { kind: "rect", x: p.x, y: p.y, w: BOX_W, h: height, rx: 6, fill: "#ffffff", stroke: "#333", strokeWidth: 1.5 },
      { kind: "text", x: p.x + 10, y: p.y + 18, text: c.ref, weight: "bold", fill: "#111" },
      { kind: "text", x: p.x + 10, y: p.y + 33, text: `${c.mpn}${c.gender !== undefined ? ` · ${c.gender}` : ""}`, size: 10, fill: "#777" },
      { kind: "line", x1: p.x, y1: p.y + HEADER_H - 2, x2: p.x + BOX_W, y2: p.y + HEADER_H - 2, stroke: "#ddd" }
    )
    c.pins.forEach((pin, i) => {
      const y = p.y + HEADER_H + (i + 0.5) * ROW_H
      items.push(
        { kind: "circle", cx: east ? p.x + BOX_W : p.x, cy: y, r: 3, fill: "#333" },
        { kind: "text", x: p.x + 10, y: y + 4, text: pin.pin, fill: "#111" },
        { kind: "text", x: p.x + 34, y: y + 4, text: pin.signal ?? "", fill: "#555" }
      )
    })
  }

  for (const s of hir.splices) {
    const p = pos.get(`splice:${s.id}`)
    if (p === undefined) continue
    items.push(
      { kind: "circle", cx: p.x + 7, cy: p.y + 7, r: 6, fill: "#333" },
      { kind: "text", x: p.x + 7, y: p.y - 6, text: `${s.id}${s.type !== undefined ? ` · ${s.type}` : ""}`, size: 11, fill: "#333", anchor: "middle" }
    )
  }

  const width = (graph.width ?? 600) + 2 * MARGIN
  const height = (graph.height ?? 400) + TITLE_H + 2 * MARGIN
  return { width, height, background: "#fafafa", items }
}

export const schematicSvgElk = async (hir: Hir): Promise<string> =>
  renderSvg(await schematicDrawingElk(hir))

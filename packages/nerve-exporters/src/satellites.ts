/**
 * HIR satellite outputs (PRD §9.3): machine-readable JSON views derived
 * from HIR. Pure, deterministic (2-space JSON, canonical HIR ordering).
 *
 * - graph.json: connectivity graph — nodes (connectors, pins, splices),
 *   edges (wires), and computed nets for tooling that wants topology
 *   without parsing the full HIR.
 * - render-layout.json: the DrawingIR for every sheet — the exact layout
 *   the SVG/PDF renderers consumed, so external tools can re-render or
 *   diff geometry.
 * - bom/cut-list/label-schedule/diagnostics.json: JSON twins of the CSVs.
 */
import {
  analyzeElectricalConstraints,
  computeNets,
  isPinEndpoint,
  type ElectricalAnalysis,
  type Hir,
  type HirEndpoint,
  type HirPinElectrical
} from "@grayhaven/nerve"
import { schematicDrawing } from "./svg.js"
import { boardDrawing } from "./board.js"
import { connectorFacesDrawing } from "./faces.js"
import { pinoutDrawing } from "./pinout.js"
import { bomTable, cutListTable, labelScheduleTable, type Cell, type CutListOptions, type TableData } from "./csv.js"
import { draft } from "./draft.js"
import type { Drawing } from "./drawing.js"

/** The satellites, as serialized. Every document names its harness. */
interface GraphConnectorNode {
  readonly id: string
  readonly kind: "connector"
  readonly ref: string
  readonly mpn: string
}

interface GraphPinNode {
  readonly id: string
  readonly kind: "pin"
  readonly connector: string
  readonly pin: string
  readonly signal?: string
  readonly electrical?: HirPinElectrical
}

interface GraphSpliceNode {
  readonly id: string
  readonly kind: "splice"
  readonly splice: string
}

interface GraphEdge {
  readonly id: string
  readonly from: string
  readonly to: string
  readonly signal?: string
}

interface GraphDocument {
  readonly schemaVersion: string
  readonly harness: Hir["harness"]
  readonly nodes: ReadonlyArray<GraphConnectorNode | GraphPinNode | GraphSpliceNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly nets: ReadonlyArray<{ readonly id: string; readonly nodes: ReadonlyArray<string> }>
  readonly electrical: ElectricalAnalysis
}

interface RenderLayoutDocument {
  readonly schemaVersion: string
  readonly harness: Hir["harness"]
  readonly sheets: {
    readonly schematic: Drawing
    readonly board: Drawing
    readonly connectorFaces: Drawing
    readonly pinout: Drawing
  }
}

interface DiagnosticsDocument {
  readonly schemaVersion: string
  readonly harness: Hir["harness"]
  readonly diagnostics: Hir["diagnostics"]
}

/** JSON twin of a CSV table: one object per row, keyed by header. */
interface TableDocument {
  readonly harness: Hir["harness"]
  readonly rows: ReadonlyArray<Readonly<Record<string, Cell>>>
}

type SatelliteDocument = GraphDocument | RenderLayoutDocument | DiagnosticsDocument | TableDocument

const stringify = (value: SatelliteDocument): string => JSON.stringify(value, null, 2) + "\n"

const endpointNode = (e: HirEndpoint): string =>
  isPinEndpoint(e) ? `connector:${e.connector}.pin:${e.pin}` : `splice:${e.splice}`

export const graphJson = (hir: Hir): string => {
  const nodes = [
    ...hir.connectors.flatMap((c) => [
      { id: `connector:${c.ref}`, kind: "connector", ref: c.ref, mpn: c.mpn } as const,
      ...c.pins.map((p): GraphPinNode => {
        const node = draft<GraphPinNode>({
          id: `connector:${c.ref}.pin:${p.pin}`,
          kind: "pin",
          connector: c.ref,
          pin: p.pin
        })
        if (p.signal !== undefined) node.signal = p.signal
        if (p.electrical !== undefined) node.electrical = p.electrical
        return node
      })
    ]),
    ...hir.splices.map((s) => ({ id: `splice:${s.id}`, kind: "splice", splice: s.id }) as const)
  ]
  const edges = hir.wires.map((w): GraphEdge => {
    const edge = draft<GraphEdge>({
      id: `wire:${w.id}`,
      from: endpointNode(w.from),
      to: endpointNode(w.to)
    })
    if (w.signal !== undefined) edge.signal = w.signal
    return edge
  })
  // Nets: shared splice-transitive union-find from core — the test plan
  // and rule authors see the exact same connectivity (it used to be
  // duplicated here, with drift risk between graph.json and tests.csv).
  const nets = computeNets(hir, endpointNode).groups.map((m, i) => ({
    id: `net-${i + 1}`,
    nodes: m
  }))
  const electrical = analyzeElectricalConstraints(hir)
  return stringify({ schemaVersion: hir.schemaVersion, harness: hir.harness, nodes, edges, nets, electrical })
}

export const renderLayoutJson = (hir: Hir): string =>
  stringify({
    schemaVersion: hir.schemaVersion,
    harness: hir.harness,
    // Every rendered sheet, at its native DrawingIR geometry (board is
    // 1:1 mm; boardSvg applies a display scale at the SVG boundary, not
    // here — the IR is the source of truth callers should mirror).
    sheets: {
      schematic: schematicDrawing(hir),
      board: boardDrawing(hir),
      connectorFaces: connectorFacesDrawing(hir),
      pinout: pinoutDrawing(hir)
    }
  })

export const diagnosticsJson = (hir: Hir): string =>
  stringify({ schemaVersion: hir.schemaVersion, harness: hir.harness, diagnostics: hir.diagnostics })

const tableJson = (hir: Hir, t: TableData): string =>
  stringify({
    harness: hir.harness,
    rows: t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i]])))
  })

export const bomJsonSatellite = (hir: Hir): string => tableJson(hir, bomTable(hir))

export const cutListJsonSatellite = (hir: Hir, options: CutListOptions = {}): string =>
  tableJson(hir, cutListTable(hir, options))

export const labelScheduleJsonSatellite = (hir: Hir): string =>
  tableJson(hir, labelScheduleTable(hir))

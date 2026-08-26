/**
 * HIR → WireViz YAML (PRD §27.2).
 *
 * Exports the representable subset: connectors with pinlabels, one WireViz
 * cable per Nerve cable (loose wires become single-conductor cables), and
 * connection rows. Splice endpoints have no WireViz equivalent and produce
 * diagnostics.
 */
import { stringify } from "yaml"
import {
  DiagnosticSeverity,
  isPinEndpoint,
  refs,
  type Diagnostic,
  type Hir,
  type HirWire
} from "@grayhaven/nerve"
import { colorToWireViz } from "./colors.js"

export interface ExportResult {
  readonly yaml: string
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

/**
 * The WireViz `connectors` entry the export writes. Property order is the
 * YAML key order; `yaml.stringify` drops properties whose value is
 * undefined (`keepUndefined` is off), so an absent optional simply
 * does not appear.
 */
interface WireVizConnectorOut {
  readonly type: string
  readonly subtype: "female" | "male" | undefined
  readonly pincount: number
  readonly pinlabels: ReadonlyArray<string> | undefined
}

/** The WireViz `cables` entry the export writes; same ordering and undefined rules. */
interface WireVizCableOut {
  readonly wirecount: number
  readonly gauge: string | undefined
  /** Metres — WireViz reads a unitless length as metres. */
  readonly length: number | undefined
  readonly colors: ReadonlyArray<string>
  readonly shield: true | undefined
}

const metres = (lengthMm: number | undefined): number | undefined =>
  lengthMm === undefined ? undefined : lengthMm / 1000

export const exportWireViz = (hir: Hir): ExportResult => {
  const diagnostics: Array<Diagnostic> = []

  const connectors: Record<string, WireVizConnectorOut> = {}
  for (const c of hir.connectors) {
    const pinlabels = Array.from({ length: c.pinCount }, (_, i) => {
      const pin = c.pins.find((p) => p.pin === String(i + 1))
      return pin?.signal ?? ""
    })
    connectors[c.ref] = {
      type: c.family ?? c.mpn,
      subtype: c.gender === "receptacle" ? "female" : c.gender === "plug" ? "male" : undefined,
      pincount: c.pinCount,
      pinlabels: pinlabels.some((l) => l !== "") ? pinlabels : undefined
    }
  }

  // Group exportable wires: members of a Nerve cable stay together; loose
  // wires become single-conductor WireViz cables.
  const exportable: Array<HirWire> = []
  for (const w of hir.wires) {
    if (!isPinEndpoint(w.from) || !isPinEndpoint(w.to)) {
      diagnostics.push({
        code: "HK-WV-002",
        severity: DiagnosticSeverity.Warning,
        message: `Wire ${w.id} terminates on a splice; WireViz cannot represent splices — wire omitted.`,
        target: refs.wire(w.id)
      })
      continue
    }
    exportable.push(w)
  }

  const cables: Record<string, WireVizCableOut> = {}
  const connections: Array<Array<Record<string, Array<string | number>>>> = []

  const cableMembers = new Map<string, Array<HirWire>>()
  for (const w of exportable) {
    if (w.cable !== undefined) {
      const list = cableMembers.get(w.cable) ?? []
      list.push(w)
      cableMembers.set(w.cable, list)
    }
  }

  for (const c of hir.cables) {
    const members = cableMembers.get(c.id) ?? []
    if (members.length === 0) continue
    cables[c.id] = {
      wirecount: c.conductors ?? members.length,
      gauge: members[0]?.gauge,
      length: metres(c.cutLength),
      colors: members.map((w) => colorToWireViz(w.color ?? "BK")),
      shield: c.shield !== undefined ? true : undefined
    }
    for (const [i, w] of members.entries()) {
      if (!isPinEndpoint(w.from) || !isPinEndpoint(w.to)) continue
      connections.push([
        { [w.from.connector]: [Number(w.from.pin) || w.from.pin] },
        { [c.id]: [Number(w.conductor ?? i + 1)] },
        { [w.to.connector]: [Number(w.to.pin) || w.to.pin] }
      ])
    }
  }

  for (const w of exportable) {
    if (w.cable !== undefined) continue
    if (!isPinEndpoint(w.from) || !isPinEndpoint(w.to)) continue
    cables[w.id] = {
      wirecount: 1,
      gauge: w.gauge,
      length: metres(w.length),
      colors: [colorToWireViz(w.color ?? "BK")],
      shield: undefined
    }
    connections.push([
      { [w.from.connector]: [Number(w.from.pin) || w.from.pin] },
      { [w.id]: [1] },
      { [w.to.connector]: [Number(w.to.pin) || w.to.pin] }
    ])
  }

  for (const s of hir.splices) {
    diagnostics.push({
      code: "HK-WV-002",
      severity: DiagnosticSeverity.Warning,
      message: `Splice ${s.id} cannot be represented in WireViz and was omitted.`,
      target: refs.splice(s.id)
    })
  }

  const yaml = stringify(
    { connectors, cables, connections },
    { defaultKeyType: "PLAIN", defaultStringType: "PLAIN" }
  )
  return { yaml, diagnostics }
}

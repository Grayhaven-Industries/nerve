/**
 * Engineering analysis (PRD §34).
 *
 * Useful checks without SPICE: per-wire resistance and voltage drop,
 * per-branch bundle diameter estimates, splice current aggregation, and
 * harness totals (wire length, copper weight). Planning-grade reference
 * data; standards rule packs can override with stricter tables (§38).
 */
import { isPinEndpoint, refs, type Hir } from "@grayhaven/nerve"
import { toCsv, type TableData } from "./csv.js"
import { draft } from "./draft.js"

/** Copper resistance, ohms per meter at 20°C, by AWG. */
const OHMS_PER_M = new Map([
  [10, 0.00328], [12, 0.00521], [14, 0.00829], [16, 0.0132], [18, 0.021],
  [20, 0.0333], [22, 0.053], [24, 0.0842], [26, 0.134], [28, 0.213], [30, 0.339]
])

/** Typical insulated wire outer diameter, mm, by AWG (PVC hookup wire). */
const OD_MM = new Map([
  [10, 4.2], [12, 3.5], [14, 3.0], [16, 2.4], [18, 2.1],
  [20, 1.8], [22, 1.6], [24, 1.4], [26, 1.2], [28, 1.0], [30, 0.9]
])

/** Copper conductor weight, grams per meter, by AWG. */
const COPPER_G_PER_M = new Map([
  [10, 46.8], [12, 29.4], [14, 18.5], [16, 11.6], [18, 7.32],
  [20, 4.61], [22, 2.89], [24, 1.82], [26, 1.14], [28, 0.72], [30, 0.45]
])

/** Insulation adds roughly 35% over bare copper for hookup wire. */
const INSULATION_FACTOR = 1.35

const parseAwg = (gauge: string | undefined): number | undefined => {
  if (gauge === undefined) return undefined
  const m = /(\d+)\s*AWG/i.exec(gauge)
  return m !== null ? Number(m[1]) : undefined
}

const toMeters = (length: number, units: string): number =>
  units === "in" ? (length * 25.4) / 1000 : length / 1000

const round = (n: number, places: number): number => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

export interface WireAnalysis {
  readonly id: string
  readonly gauge?: string
  readonly lengthM?: number
  readonly resistanceOhms?: number
  /** Round-trip drop assumed single-conductor: V = I × R. */
  readonly voltageDropV?: number
  readonly currentA?: number
}

export interface BranchAnalysis {
  readonly id: string
  readonly wireCount: number
  /** sqrt(Σd²) × 1.155 packing estimate. */
  readonly bundleDiameterMm: number
}

export interface SpliceAnalysis {
  readonly id: string
  /** Sum of current estimates on attached wires (worst-case aggregation). */
  readonly aggregateCurrentA: number
  readonly wires: ReadonlyArray<string>
}

export interface AnalysisReport {
  readonly harness: { readonly id: string; readonly revision: string }
  readonly wires: ReadonlyArray<WireAnalysis>
  readonly branches: ReadonlyArray<BranchAnalysis>
  readonly splices: ReadonlyArray<SpliceAnalysis>
  readonly totals: {
    readonly wireLengthM: number
    readonly estimatedWeightG: number
    readonly wiresWithoutLength: number
    readonly wiresOffTable: number
  }
}

export const analyzeHarness = (hir: Hir): AnalysisReport => {
  let totalLength = 0
  let totalWeight = 0
  let noLength = 0
  let offTable = 0

  const wires: Array<WireAnalysis> = hir.wires.map((w) => {
    const awg = parseAwg(w.gauge)
    const lengthM = w.length !== undefined ? toMeters(w.length, hir.harness.units) : undefined
    if (lengthM === undefined) noLength += 1
    else totalLength += lengthM

    const ohmsPerM = awg !== undefined ? OHMS_PER_M.get(awg) : undefined
    if (awg !== undefined && ohmsPerM === undefined) offTable += 1
    const resistance =
      ohmsPerM !== undefined && lengthM !== undefined ? ohmsPerM * lengthM : undefined
    const gPerM = awg !== undefined ? COPPER_G_PER_M.get(awg) : undefined
    if (gPerM !== undefined && lengthM !== undefined) {
      totalWeight += gPerM * INSULATION_FACTOR * lengthM
    }
    const drop =
      resistance !== undefined && w.currentEstimate !== undefined
        ? resistance * w.currentEstimate
        : undefined
    const analysis = draft<WireAnalysis>({ id: w.id })
    if (w.gauge !== undefined) analysis.gauge = w.gauge
    if (lengthM !== undefined) analysis.lengthM = round(lengthM, 3)
    if (resistance !== undefined) analysis.resistanceOhms = round(resistance, 4)
    if (drop !== undefined) analysis.voltageDropV = round(drop, 3)
    if (w.currentEstimate !== undefined) analysis.currentA = w.currentEstimate
    return analysis
  })

  // Branch bundle diameter: wires whose pin endpoints land on the branch's
  // path connectors (approximation of bundle membership).
  const branches: Array<BranchAnalysis> = hir.branches.map((b) => {
    const path = new Set(b.path)
    const members = hir.wires.filter((w) =>
      [w.from, w.to].some((e) => isPinEndpoint(e) && path.has(e.connector))
    )
    const sumSquares = members.reduce((sum, w) => {
      const awg = parseAwg(w.gauge)
      const od = awg !== undefined ? (OD_MM.get(awg) ?? 1.5) : 1.5
      return sum + od * od
    }, 0)
    return {
      id: b.id,
      wireCount: members.length,
      bundleDiameterMm: round(Math.sqrt(sumSquares) * 1.155, 1)
    }
  })

  const splices: Array<SpliceAnalysis> = hir.splices.map((s) => {
    const attached = hir.wires.filter((w) => s.wires.includes(w.id))
    return {
      id: s.id,
      aggregateCurrentA: round(
        attached.reduce((sum, w) => sum + (w.currentEstimate ?? 0), 0),
        2
      ),
      wires: s.wires
    }
  })

  return {
    harness: { id: hir.harness.id, revision: hir.harness.revision },
    wires,
    branches,
    splices,
    totals: {
      wireLengthM: round(totalLength, 2),
      estimatedWeightG: round(totalWeight, 1),
      wiresWithoutLength: noLength,
      wiresOffTable: offTable
    }
  }
}

export const analysisTable = (report: AnalysisReport): TableData => ({
  headers: ["Object", "Metric", "Value", "Unit"],
  rows: [
    ...report.wires.flatMap((w) => [
      ...(w.resistanceOhms !== undefined
        ? [[refs.wire(w.id), "resistance", w.resistanceOhms, "ohm"] as const]
        : []),
      ...(w.voltageDropV !== undefined
        ? [[refs.wire(w.id), "voltage drop", w.voltageDropV, "V"] as const]
        : [])
    ]),
    ...report.branches.map(
      (b) => [refs.branch(b.id), "bundle diameter", b.bundleDiameterMm, "mm"] as const
    ),
    ...report.splices
      .filter((s) => s.aggregateCurrentA > 0)
      .map((s) => [refs.splice(s.id), "aggregate current", s.aggregateCurrentA, "A"] as const),
    ["harness", "total wire length", report.totals.wireLengthM, "m"],
    ["harness", "estimated weight", report.totals.estimatedWeightG, "g"]
  ]
})

export const analysisCsv = (hir: Hir): string => {
  const table = analysisTable(analyzeHarness(hir))
  return toCsv([table.headers, ...table.rows])
}

export const analysisJson = (hir: Hir): string =>
  JSON.stringify(analyzeHarness(hir), null, 2) + "\n"

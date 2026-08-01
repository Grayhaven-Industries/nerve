/**
 * CSV exporters (PRD §9.8, §20).
 *
 * Column sets follow the PRD §20 specs exactly so output drops into
 * spreadsheet and ERP workflows. All output is deterministic: rows follow
 * HIR's canonical ordering, line endings are `\n`, and there are no
 * timestamps.
 */
import { isPinEndpoint, type Hir, type HirEndpoint, type HirWire } from "@grayhaven/nerve"
import type { TestPlan } from "./test-plan.js"

/** CSV cell pair for an endpoint: connector + pin, or splice id + "". */
const endpointCells = (e: HirEndpoint): readonly [string, string] =>
  isPinEndpoint(e) ? [e.connector, e.pin] : [e.splice, ""]

export type Cell = string | number | undefined

export interface TableData {
  readonly headers: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ReadonlyArray<Cell>>
}

const escapeCell = (cell: Cell): string => {
  if (cell === undefined) return ""
  const s = String(cell)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const toCsv = (rows: ReadonlyArray<ReadonlyArray<Cell>>): string =>
  rows.map((row) => row.map(escapeCell).join(",")).join("\n") + "\n"

const tableCsv = (table: TableData): string => toCsv([table.headers, ...table.rows])

/** BOM table data (PRD §20.1 columns) — shared by CSV and PDF exporters. */
export const bomTable = (hir: Hir): TableData => ({
  headers: [
    "Item number",
    "Quantity",
    "Unit of measure",
    "Internal part number",
    "Manufacturer",
    "Manufacturer part number",
    "Description",
    "Category",
    "Used by",
    "Approved alternates",
    "Notes"
  ],
  rows: hir.bom.map((item, i) => [
    i + 1,
    item.quantity,
    item.unitOfMeasure,
    item.internalPartId,
    item.manufacturer,
    item.mpn,
    item.description,
    item.category,
    item.usedBy.join("; "),
    "",
    item.notes
  ])
})

/** BOM CSV (PRD §20.1). */
export const bomCsv = (hir: Hir): string => tableCsv(bomTable(hir))

export interface CutListOptions {
  /** Default length tolerance when a wire does not specify one (PRD §10.5). */
  readonly defaultWireTolerance?: number
}

/** Terminal MPN at an endpoint, from per-pin assignments (PRD §30). */
const terminalAt = (hir: Hir, e: HirEndpoint): string => {
  if (!isPinEndpoint(e)) return ""
  return (
    hir.connectors
      .find((c) => c.ref === e.connector)
      ?.pins.find((p) => p.pin === e.pin)?.terminal ?? ""
  )
}

/**
 * Length of wire to cut, in harness units: the finished length plus every
 * allowance that consumes copper.
 *
 *   cut = length + serviceLoop + terminationAllowance.from + terminationAllowance.to
 *
 * Strip length is NOT part of it — stripping removes insulation from wire
 * that is already there, so adding it would over-order every conductor.
 * A wire with no declared allowances cuts at exactly its finished length,
 * and a wire with no length has no computable cut length.
 *
 * (Mirrored by `cutLengthOf` in @grayhaven/nerve's compiler, which needs the
 * same number for the wire BOM rollup but cannot depend on this package.)
 */
export const wireCutLength = (wire: HirWire): number | undefined =>
  wire.length === undefined
    ? undefined
    : wire.length +
      (wire.serviceLoop ?? 0) +
      (wire.terminationAllowance?.from ?? 0) +
      (wire.terminationAllowance?.to ?? 0)

/** Wire cut list table data (PRD §20.2 columns). */
export const cutListTable = (hir: Hir, options: CutListOptions = {}): TableData => ({
  headers: [
    "Wire ID",
    "Signal",
    "Gauge",
    "Color",
    "Stripe",
    "Cut length",
    "Finished length",
    "Service loop",
    "Termination allowance (from)",
    "Termination allowance (to)",
    "Strip (from)",
    "Strip (to)",
    "Tolerance",
    "Units",
    "From connector",
    "From pin",
    "To connector",
    "To pin",
    "Terminal A",
    "Terminal B",
    "Branch",
    "Notes"
  ],
  rows: hir.wires.map((w) => [
    w.id,
    w.signal,
    w.gauge,
    w.color,
    w.stripe,
    wireCutLength(w),
    w.length,
    w.serviceLoop,
    w.terminationAllowance?.from,
    w.terminationAllowance?.to,
    w.stripLength?.from,
    w.stripLength?.to,
    w.lengthTolerance ?? options.defaultWireTolerance,
    hir.harness.units,
    ...endpointCells(w.from),
    ...endpointCells(w.to),
    terminalAt(hir, w.from),
    terminalAt(hir, w.to),
    w.branch ?? w.cable,
    w.notes
  ])
})

/** Wire cut list CSV (PRD §20.2). */
export const cutListCsv = (hir: Hir, options: CutListOptions = {}): string =>
  tableCsv(cutListTable(hir, options))

/** Label schedule table data (PRD §20.3 columns). */
export const labelScheduleTable = (hir: Hir): TableData => ({
  headers: [
    "Label ID",
    "Text",
    "Quantity",
    "Material",
    "Printer profile",
    "Target object",
    "Placement offset",
    "Orientation",
    "Notes"
  ],
  rows: hir.labels.map((l) => [
    l.id,
    l.text,
    l.quantity ?? 1,
    l.material,
    "",
    l.attachTo,
    l.offsetFrom !== undefined && l.distance !== undefined
      ? `${l.distance} from ${l.offsetFrom}`
      : l.distance,
    "",
    ""
  ])
})

/** Label schedule CSV (PRD §20.3). */
export const labelScheduleCsv = (hir: Hir): string => tableCsv(labelScheduleTable(hir))

/** Test plan table data (PRD §9.9). */
export const testPlanTable = (plan: TestPlan): TableData => ({
  headers: [
    "Test ID",
    "Type",
    "From connector",
    "From pin",
    "To connector",
    "To pin",
    "Expected",
    "Net",
    "Wire"
  ],
  rows: plan.tests.map((t) => [
    t.id,
    t.type,
    t.from.connector,
    t.from.pin,
    t.to.connector,
    t.to.pin,
    t.expected,
    t.net,
    t.type === "net-continuity" ? t.wires.join(" + ") : t.wire
  ])
})

/** Test plan CSV (PRD §9.9: human-trackable form of the JSON plan). */
export const testPlanCsv = (plan: TestPlan): string => tableCsv(testPlanTable(plan))

/**
 * Shop-floor machine adapters (PRD §31).
 *
 * Typed adapter boundary defined early, with deliberately simple first
 * implementations (CSV/JSON). The contract the PRD requires:
 *  - adapters compile from HIR (and its derived manufacturing IR), never
 *    from UI state,
 *  - output carries design revision + export metadata,
 *  - every machine row maps back to HIR objects,
 *  - failures are structured diagnostics, not throws.
 */
import {
  DiagnosticSeverity,
  HIR_SCHEMA_VERSION,
  isPinEndpoint,
  refs,
  type Diagnostic,
  type Hir
} from "@grayhaven/nerve"
import { toCsv } from "./csv.js"
import { hirFingerprint } from "./release.js"
import { generateTestPlan, type HarnessTest, type TestPoint } from "./test-plan.js"

export type AdapterKind =
  | "wire-cut"
  | "wire-cut-strip"
  | "label-printer"
  | "continuity-tester"

export interface AdapterResult {
  /** File name → contents. */
  readonly files: ReadonlyMap<string, string>
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

export interface MachineAdapter {
  readonly id: string
  readonly kind: AdapterKind
  readonly description: string
  /** HIR schema versions this adapter understands (PRD §40 plugin contract). */
  readonly hirSchemaVersions: ReadonlyArray<string>
  /**
   * What this adapter does not promise. An adapter aimed at a proprietary
   * machine format we cannot test against says so here, in the artifact, so
   * nobody mistakes "it imports" for "it is certified".
   */
  readonly limitations?: ReadonlyArray<string>
  generate(hir: Hir): AdapterResult
}

const metadataHeader = (hir: Hir, adapter: MachineAdapter): string =>
  [
    `# adapter: ${adapter.id}`,
    `# harness: ${hir.harness.id}`,
    `# revision: ${hir.harness.revision}`,
    `# hir-schema: ${hir.schemaVersion}`
  ].join("\n") + "\n"

const checkSchema = (hir: Hir, adapter: MachineAdapter): Diagnostic | undefined =>
  adapter.hirSchemaVersions.includes(hir.schemaVersion)
    ? undefined
    : {
        code: "HK-ADAPT-001",
        severity: DiagnosticSeverity.Error,
        message: `Adapter ${adapter.id} supports HIR ${adapter.hirSchemaVersions.join(", ")}, got ${hir.schemaVersion}.`
      }

/** Wire cut/strip machine: one row per wire with cut length and strip allowances. */
export const genericCutStripCsv: MachineAdapter = {
  id: "generic-cut-strip-csv",
  kind: "wire-cut-strip",
  description: "Generic cut/strip machine CSV (one row per wire).",
  hirSchemaVersions: [HIR_SCHEMA_VERSION],
  generate(hir) {
    const diagnostics: Array<Diagnostic> = []
    const schemaIssue = checkSchema(hir, this)
    if (schemaIssue !== undefined) return { files: new Map(), diagnostics: [schemaIssue] }

    const rows: Array<ReadonlyArray<string | number>> = []
    for (const w of hir.wires) {
      if (w.length === undefined || w.gauge === undefined) {
        diagnostics.push({
          code: "HK-ADAPT-002",
          severity: DiagnosticSeverity.Warning,
          message: `Wire ${w.id} skipped: cut/strip machine rows need both length and gauge.`,
          target: refs.wire(w.id)
        })
        continue
      }
      rows.push([
        w.id,
        w.gauge,
        w.color ?? "",
        w.length,
        w.lengthTolerance ?? "",
        5, // strip A (mm) — process default until §28 carries per-end data
        5, // strip B (mm)
        1, // quantity
        refs.wire(w.id)
      ])
    }
    const csv =
      metadataHeader(hir, this) +
      toCsv([
        ["Wire ID", "Gauge", "Color", "Cut length", "Tolerance", "Strip A", "Strip B", "Qty", "HIR ref"],
        ...rows
      ])
    return { files: new Map([["cut-strip.machine.csv", csv]]), diagnostics }
  }
}

/** Label printer: one row per printed label. */
export const genericLabelPrinterCsv: MachineAdapter = {
  id: "generic-label-printer-csv",
  kind: "label-printer",
  description: "Generic label printer CSV (one row per label copy).",
  hirSchemaVersions: [HIR_SCHEMA_VERSION],
  generate(hir) {
    const schemaIssue = checkSchema(hir, this)
    if (schemaIssue !== undefined) return { files: new Map(), diagnostics: [schemaIssue] }
    const csv =
      metadataHeader(hir, this) +
      toCsv([
        ["Label ID", "Text", "Qty", "Material", "HIR ref"],
        ...hir.labels.map((l) => [
          l.id,
          l.text,
          l.quantity ?? 1,
          l.material ?? "",
          refs.label(l.id)
        ])
      ])
    return { files: new Map([["labels.machine.csv", csv]]), diagnostics: [] }
  }
}

/** Continuity tester: machine-readable program derived from the test plan. */
export const genericTesterJson: MachineAdapter = {
  id: "generic-tester-json",
  kind: "continuity-tester",
  description: "Generic continuity tester program (JSON, one step per test).",
  hirSchemaVersions: [HIR_SCHEMA_VERSION],
  generate(hir) {
    const schemaIssue = checkSchema(hir, this)
    if (schemaIssue !== undefined) return { files: new Map(), diagnostics: [schemaIssue] }
    const plan = generateTestPlan(hir)
    const program = {
      adapter: this.id,
      harness: hir.harness.id,
      revision: hir.harness.revision,
      hirSchema: hir.schemaVersion,
      steps: plan.tests.map((t) => ({
        id: t.id,
        mode: t.expected === "closed" ? "continuity" : "isolation",
        from: t.from,
        to: t.to,
        thresholdOhms: t.expected === "closed" ? 2 : 100000,
        hirRef:
          t.type === "continuity"
            ? refs.wire(t.wire)
            : t.type === "splice"
              ? refs.splice(t.splice)
              : t.type === "net-continuity"
                ? refs.wire(t.wires[0]!)
                : null,
        ...(t.type === "net-continuity"
          ? { hirRefs: [...t.wires.map(refs.wire), ...t.splices.map(refs.splice)] }
          : {})
      }))
    }
    return {
      files: new Map([["tester.program.json", JSON.stringify(program, null, 2) + "\n"]]),
      diagnostics: []
    }
  }
}

/** Verdict thresholds the exported program declares, in ohms. Same numbers
 * `createBuildRecord` judges the returned measurements against (PRD §36), so
 * the tester and the record never disagree about what "pass" means. */
const CONTINUITY_MAX_OHMS = 2
const ISOLATION_MIN_OHMS = 100_000

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Test-point label as a technician reads it off the fixture: `J1-3`. */
const pointLabel = (p: TestPoint): string => `${p.connector}-${p.pin}`

/** Net a closed-circuit test proves. Falls back to the implicated object when
 * the net carries no signal name, matching how the test plan names nets. */
const netOf = (t: HarnessTest): string =>
  t.net ??
  (t.type === "continuity"
    ? refs.wire(t.wire)
    : t.type === "splice"
      ? refs.splice(t.splice)
      : t.id)

/** Every HIR object a test implicates, so a failed step stays traceable. */
const hirRefsOf = (t: HarnessTest): string =>
  t.type === "continuity"
    ? refs.wire(t.wire)
    : t.type === "splice"
      ? refs.splice(t.splice)
      : t.type === "net-continuity"
        ? [...t.wires.map(refs.wire), ...t.splices.map(refs.splice)].join(" + ")
        : ""

/**
 * Cirris Easy-Wire net list — best effort, unvalidated (PRD §31).
 *
 * Cirris 8100/8250 testers run Easy-Wire, which imports test data from a
 * delimited text file and connectors from ASCII text, and whose recommended
 * workflow for a large assembly is importing a known-good electronic file
 * rather than learning the harness from a golden sample. A compiled harness
 * is exactly that known-good file, so the derivation Nerve already performs
 * for `test-plan.csv` should reach the tester instead of a clipboard.
 *
 * Honest scope: Easy-Wire's import schema is proprietary and we do not have
 * it. This emits a deterministic net list in the documented SHAPE — test
 * points, expected connections, expected isolation — with Nerve's own section
 * markers and column names. It is a mapping target, not a certified format:
 * the adapter says so in its `limitations`, in the file header, and in a
 * diagnostic on every run. Validate the import against a real tester before
 * it gates production.
 */
export const cirrisEasyWireNetlist: MachineAdapter = {
  id: "cirris-easywire-netlist",
  kind: "continuity-tester",
  description: "Cirris Easy-Wire style net list (test points, connections, isolation).",
  hirSchemaVersions: [HIR_SCHEMA_VERSION],
  limitations: [
    "The file layout is a best-effort target modeled on Easy-Wire's documented delimited-text import. It is NOT validated against real Cirris hardware — verify it on a tester before production use.",
    "Section markers and column names are Nerve's own convention and will likely need remapping in Easy-Wire's import utility.",
    "Connector graphic files, which ship alongside a real Easy-Wire export package, are not generated.",
    "CTL (Cirris Test Language) serial/USB control is out of scope; this is a file handoff only."
  ],
  generate(hir) {
    const schemaIssue = checkSchema(hir, this)
    if (schemaIssue !== undefined) return { files: new Map(), diagnostics: [schemaIssue] }
    const plan = generateTestPlan(hir)

    const points = new Map<string, TestPoint>()
    for (const t of plan.tests) {
      for (const p of [t.from, t.to]) points.set(pointLabel(p), p)
    }
    const pointRows = [...points.values()]
      .sort((a, b) => cmp(a.connector, b.connector) || cmp(a.pin, b.pin))
      .map((p) => [pointLabel(p), p.connector, p.pin, refs.pin(p.connector, p.pin)])

    const connectRows = plan.tests
      .filter((t) => t.expected === "closed")
      .map((t) => [
        netOf(t),
        pointLabel(t.from),
        pointLabel(t.to),
        t.id,
        CONTINUITY_MAX_OHMS,
        hirRefsOf(t)
      ])

    const isolateRows = plan.tests
      .filter((t) => t.expected === "open")
      .map((t) => [
        netOf(t),
        pointLabel(t.from),
        pointLabel(t.to),
        t.id,
        ISOLATION_MIN_OHMS
      ])

    const text =
      metadataHeader(hir, this) +
      `# hir-fingerprint: ${hirFingerprint(hir)}\n` +
      "# format: best-effort Easy-Wire-style net list. The real import schema\n" +
      "# is proprietary and this file is unvalidated against Cirris hardware.\n" +
      "[POINTS]\n" +
      toCsv([["Point", "Connector", "Pin", "HIR ref"], ...pointRows]) +
      "[CONNECT]\n" +
      toCsv([["Net", "Point A", "Point B", "Test ID", "Max ohms", "HIR ref"], ...connectRows]) +
      "[ISOLATE]\n" +
      toCsv([["Nets", "Point A", "Point B", "Test ID", "Min ohms"], ...isolateRows])

    return {
      files: new Map([["cirris-easywire.netlist.txt", text]]),
      diagnostics: [
        {
          code: "HK-ADAPT-003",
          severity: DiagnosticSeverity.Info,
          message:
            "cirris-easywire-netlist emits a best-effort net list modeled on Easy-Wire's documented delimited-text import; the exact schema is proprietary and unverified. Validate the import on a real tester before letting it gate production.",
          data: { adapter: this.id, tests: plan.tests.length }
        }
      ]
    }
  }
}

export const builtinAdapters: ReadonlyArray<MachineAdapter> = [
  genericCutStripCsv,
  genericLabelPrinterCsv,
  genericTesterJson,
  cirrisEasyWireNetlist
]

export const findAdapter = (id: string): MachineAdapter | undefined =>
  builtinAdapters.find((a) => a.id === id)

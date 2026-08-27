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
  refs,
  type Diagnostic,
  type Hir
} from "@grayhaven/nerve"
import { toCsv, wireCutLength } from "./csv.js"
import { draft } from "./draft.js"
import { hirFingerprint } from "./release.js"
import {
  testSpecificationMatchesPlan,
  validateTestSpecification,
  type ElectricalTestStep,
  type TestSpecification
} from "./test-spec.js"
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

export interface AdapterGenerateOptions {
  /** Optional caller-authorized limits for tester program adapters. */
  readonly testSpecification?: TestSpecification
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
  generate(hir: Hir, options?: AdapterGenerateOptions): AdapterResult
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
      const cutLength = wireCutLength(w)
      if (cutLength === undefined || w.gauge === undefined) {
        diagnostics.push({
          code: "HK-ADAPT-002",
          severity: DiagnosticSeverity.Warning,
          message: `Wire ${w.id} skipped: cut/strip machine rows need both length and gauge.`,
          target: refs.wire(w.id)
        })
        continue
      }
      if (w.stripLength === undefined) {
        diagnostics.push({
          code: "HK-ADAPT-005",
          severity: DiagnosticSeverity.Warning,
          message: `Wire ${w.id} has no declared per-end strip lengths; machine strip fields were left blank.`,
          target: refs.wire(w.id)
        })
      }
      rows.push([
        w.id,
        w.gauge,
        w.color ?? "",
        cutLength,
        w.lengthTolerance ?? "",
        w.stripLength?.from ?? "",
        w.stripLength?.to ?? "",
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

/** One tester program step. `hirRefs` lists every implicated object for a
 * net-continuity check; single-object checks carry only `hirRef`. */
interface TesterStep {
  readonly id: string
  readonly mode: "continuity" | "isolation"
  readonly from: TestPoint
  readonly to: TestPoint
  readonly hirRef: string | null
  readonly hirRefs?: ReadonlyArray<string>
  readonly method?: ElectricalTestStep["method"]
  readonly maxOhms?: number
  readonly minOhms?: number
  readonly testVoltageV?: number
  readonly testVoltageToleranceV?: number
  readonly maxLeakageMilliAmps?: number
  readonly dwellSeconds?: number
  readonly rampSeconds?: number
  readonly waveform?: "ac" | "dc"
}

const copyAuthorizedLimits = (target: ReturnType<typeof draft<TesterStep>>, source: ElectricalTestStep): void => {
  target.method = source.method
  switch (source.method) {
    case "continuity":
    case "four-wire-resistance":
      target.maxOhms = source.maxOhms
      break
    case "insulation-resistance":
      target.testVoltageV = source.testVoltageV
      if (source.testVoltageToleranceV !== undefined) {
        target.testVoltageToleranceV = source.testVoltageToleranceV
      }
      target.minOhms = source.minOhms
      if (source.dwellSeconds !== undefined) target.dwellSeconds = source.dwellSeconds
      if (source.rampSeconds !== undefined) target.rampSeconds = source.rampSeconds
      target.waveform = "dc"
      break
    case "dielectric-withstand":
      target.testVoltageV = source.testVoltageV
      if (source.testVoltageToleranceV !== undefined) {
        target.testVoltageToleranceV = source.testVoltageToleranceV
      }
      target.maxLeakageMilliAmps = source.maxLeakageMilliAmps
      target.dwellSeconds = source.dwellSeconds
      if (source.rampSeconds !== undefined) target.rampSeconds = source.rampSeconds
      target.waveform = source.waveform
      break
  }
}

/** Continuity tester: machine-readable program derived from the test plan. */
export const genericTesterJson: MachineAdapter = {
  id: "generic-tester-json",
  kind: "continuity-tester",
  description: "Generic continuity tester program (JSON, one step per test).",
  hirSchemaVersions: [HIR_SCHEMA_VERSION],
  generate(hir, options) {
    const schemaIssue = checkSchema(hir, this)
    if (schemaIssue !== undefined) return { files: new Map(), diagnostics: [schemaIssue] }
    const plan = generateTestPlan(hir)
    const requestedSpecification = options?.testSpecification
    const specification =
      requestedSpecification !== undefined &&
      requestedSpecification.status === "approved" &&
      validateTestSpecification(requestedSpecification).length === 0 &&
      testSpecificationMatchesPlan(requestedSpecification, plan)
        ? requestedSpecification
        : undefined
    const authorized = new Map((specification?.steps ?? []).map((step) => [step.id, step]))
    const program = draft<{
      readonly adapter: string
      readonly harness: string
      readonly revision: string
      readonly hirSchema: string
      readonly testSpecification?: {
        readonly schemaVersion: string
        readonly id: string
        readonly revision: string
      }
      readonly steps: ReadonlyArray<TesterStep>
    }>({
      adapter: this.id,
      harness: hir.harness.id,
      revision: hir.harness.revision,
      hirSchema: hir.schemaVersion,
      steps: plan.tests.map((t): TesterStep => {
        const step = draft<TesterStep>({
          id: t.id,
          mode: t.expected === "closed" ? "continuity" : "isolation",
          from: t.from,
          to: t.to,
          hirRef:
            t.type === "continuity"
              ? refs.wire(t.wire)
              : t.type === "splice"
                ? refs.splice(t.splice)
                : t.type === "net-continuity"
                  ? refs.wire(t.wires[0]!)
                  : null
        })
        if (t.type === "net-continuity") {
          step.hirRefs = [...t.wires.map(refs.wire), ...t.splices.map(refs.splice)]
        }
        const limit = authorized.get(t.id)
        if (limit !== undefined) copyAuthorizedLimits(step, limit)
        return step
      })
    })
    if (specification !== undefined) {
      program.testSpecification = {
        schemaVersion: specification.schemaVersion,
        id: specification.id,
        revision: specification.revision
      }
    }
    const diagnostics: Array<Diagnostic> = []
    if (requestedSpecification !== undefined && specification === undefined) {
      diagnostics.push({
        code: "HK-ADAPT-004",
        severity: DiagnosticSeverity.Warning,
        message:
          "The supplied test specification is not approved, valid, and trace-matched to this harness; no acceptance limits were exported.",
        data: { adapter: this.id, specification: requestedSpecification.id }
      })
    }
    return {
      files: new Map([["tester.program.json", JSON.stringify(program, null, 2) + "\n"]]),
      diagnostics
    }
  }
}

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
  description: "Experimental Cirris Easy-Wire style net list (unvalidated pseudo-format).",
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
        hirRefsOf(t)
      ])

    const isolateRows = plan.tests
      .filter((t) => t.expected === "open")
      .map((t) => [
        netOf(t),
        pointLabel(t.from),
        pointLabel(t.to),
        t.id
      ])

    const text =
      metadataHeader(hir, this) +
      `# hir-fingerprint: ${hirFingerprint(hir)}\n` +
      "# format: best-effort Easy-Wire-style net list. The real import schema\n" +
      "# is proprietary and this file is unvalidated against Cirris hardware.\n" +
      "[POINTS]\n" +
      toCsv([["Point", "Connector", "Pin", "HIR ref"], ...pointRows]) +
      "[CONNECT]\n" +
      toCsv([["Net", "Point A", "Point B", "Test ID", "HIR ref"], ...connectRows]) +
      "[ISOLATE]\n" +
      toCsv([["Nets", "Point A", "Point B", "Test ID"], ...isolateRows])

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

/** Explicit production-discovery opt-out alias for the retained compatibility export. */
export const experimentalCirrisEasyWireNetlist = cirrisEasyWireNetlist

export const builtinAdapters: ReadonlyArray<MachineAdapter> = [
  genericCutStripCsv,
  genericLabelPrinterCsv,
  genericTesterJson
]

export const findAdapter = (id: string): MachineAdapter | undefined =>
  builtinAdapters.find((a) => a.id === id)

/**
 * Tester result ingest (PRD §31 shop-floor adapters, §36 as-built records).
 *
 * The test plan already leaves Nerve as a machine program; the results came
 * back as numbers a technician retyped. A build record signed by a test
 * machine is traceability — a build record typed by a person is paperwork.
 * This closes the loop: it parses a tester's own result file into the exact
 * `Measurement` shape `createBuildRecord` consumes, so nothing between the
 * fixture and the record is transcribed by hand.
 *
 * The load-bearing check is provenance, not parsing. A results file from a
 * different design that silently mints a passing record is the failure this
 * exists to prevent, so results are verified against the release's
 * `hirFingerprint` before anything downstream trusts them. Nerve's exported
 * tester programs print that fingerprint in their header precisely so the
 * shop floor can hand it back. Mismatches surface as structured diagnostics
 * and a `false` flag, never a throw — the same boundary every other exporter
 * uses to report problems.
 */
import { DiagnosticSeverity, type Diagnostic } from "@grayhaven/nerve"
import type { Measurement } from "./build-record.js"
import type { Release } from "./release.js"
import type { TestPlan } from "./test-plan.js"

export interface TesterIngestResult {
  readonly measurements: ReadonlyArray<Measurement>
  readonly diagnostics: ReadonlyArray<Diagnostic>
  /** False when the results do not belong to this release. */
  readonly fingerprintMatches: boolean
}

export interface TesterIngestOptions {
  /**
   * The plan the results claim to have executed — `generateTestPlan(hir)`.
   * Supplied, ingest reconciles ids against it; omitted, it parses and
   * verifies provenance but has nothing to reconcile against.
   */
  readonly plan?: TestPlan
  /**
   * Fingerprint the results claim, for testers whose export cannot carry a
   * `# hir-fingerprint:` header — read off the work order or the file name
   * instead. The file's own header wins when it has one. This is the claim,
   * not the expectation: the expectation is always the release's fingerprint.
   */
  readonly expectFingerprint?: string
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const metaLine = /^#\s*([\w-]+)\s*:\s*(.+)$/

/**
 * Ingest a tester result file.
 *
 * Accepted shape — plain CSV, one row per executed test:
 *
 * ```
 * # hir-fingerprint: 3f2a1c09d84b7e55
 * Test ID,Measured ohms
 * T-001,0.42
 * T-002,5000000
 * ```
 *
 * Column one is the test id from the plan, column two the measured
 * resistance in ohms; further columns are ignored, so a tester that also
 * prints timestamps or point labels needs no preprocessing. A leading header
 * row is optional and detected by its non-numeric ohms cell. `#` lines are
 * comments, and `# key: value` comments are read as metadata —
 * `hir-fingerprint` is the one that matters. Blank lines and CRLF endings are
 * tolerated. A row whose ohms cell is not a finite number is reported and
 * skipped rather than guessed at.
 *
 * Rows that name a test the plan does not contain are kept in `measurements`
 * (the machine did measure something) and reported; `createBuildRecord`
 * judges only what the plan asked for. Planned tests with no result are
 * reported as a count only — they already become `not-run` verdicts
 * downstream, and that judgment belongs there, not here.
 */
export const ingestTesterResults = (
  source: string,
  release: Release,
  options: TesterIngestOptions = {}
): TesterIngestResult => {
  const meta = new Map<string, string>()
  const rows: Array<ReadonlyArray<string>> = []
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.length === 0) continue
    if (line.startsWith("#")) {
      const match = metaLine.exec(line)
      if (match !== null) meta.set(match[1]!.toLowerCase(), match[2]!.trim())
      continue
    }
    rows.push(line.split(",").map((cell) => cell.trim()))
  }
  // A header row announces itself: its ohms cell cannot be a number.
  const body = Number.isFinite(Number(rows[0]?.[1])) ? rows : rows.slice(1)

  const diagnostics: Array<Diagnostic> = []
  const claimed = meta.get("hir-fingerprint") ?? options.expectFingerprint
  const fingerprintMatches = claimed !== undefined && claimed === release.hirFingerprint
  if (claimed === undefined) {
    diagnostics.push({
      code: "HK-TEST-001",
      severity: DiagnosticSeverity.Warning,
      message: `Results declare no HIR fingerprint, so they cannot be proven to come from release ${release.releaseId}. Export the tester program from Nerve, or pass the fingerprint the results claim.`,
      data: { release: release.releaseId, expected: release.hirFingerprint }
    })
  } else if (!fingerprintMatches) {
    diagnostics.push({
      code: "HK-TEST-002",
      severity: DiagnosticSeverity.Error,
      message: `Results claim HIR ${claimed}, but release ${release.releaseId} is ${release.hirFingerprint}. These results were taken against a different design.`,
      data: { release: release.releaseId, claimed, expected: release.hirFingerprint }
    })
  }

  const measurements: Array<Measurement> = []
  for (const [index, row] of body.entries()) {
    const id = row[0] ?? ""
    const ohms = row[1]
    const value = Number(ohms)
    if (id === "" || ohms === undefined || ohms === "" || !Number.isFinite(value)) {
      diagnostics.push({
        code: "HK-TEST-003",
        severity: DiagnosticSeverity.Warning,
        message: `Result row ${index + 1} is not "test id,measured ohms" and was skipped: ${row.join(",")}`,
        data: { row: index + 1 }
      })
      continue
    }
    measurements.push({ id, measuredOhms: value })
  }
  measurements.sort((a, b) => cmp(a.id, b.id))

  const plan = options.plan
  if (plan !== undefined) {
    const planned = new Set(plan.tests.map((t) => t.id))
    const measured = new Set(measurements.map((m) => m.id))
    for (const m of measurements) {
      if (planned.has(m.id)) continue
      diagnostics.push({
        code: "HK-TEST-004",
        severity: DiagnosticSeverity.Warning,
        message: `Result ${m.id} is not a test in release ${release.releaseId}'s plan; it will not be judged.`,
        data: { test: m.id, release: release.releaseId }
      })
    }
    const missing = plan.tests.filter((t) => !measured.has(t.id)).length
    if (missing > 0) {
      diagnostics.push({
        code: "HK-TEST-005",
        severity: DiagnosticSeverity.Info,
        message: `${missing} of ${plan.tests.length} planned tests have no result in this file.`,
        data: { missing, planned: plan.tests.length }
      })
    }
  }

  return { measurements, diagnostics, fingerprintMatches }
}

/**
 * Nerve Build Record — as-built traceability (PRD §36).
 *
 * Captures evidence, not intent: which serial was built, by whom, with what
 * material lots and tools, and what the tester actually measured. Verdicts
 * are computed by replaying measured values against the release's generated
 * test plan, so a pass means "the physical harness matches the design
 * graph," traceable test-by-test.
 *
 * As-built wire lengths ride along the same way. A technician measures the
 * harness that actually came off the board; the record judges each measured
 * length against the design length and its tolerance and stops there. It
 * never amends the design — an out-of-tolerance length is an observation
 * that a human turns into a redline (PRD §39), reviews, and accepts.
 */
import type { Hir } from "@grayhaven/nerve"
import { generateTestPlan, type HarnessTest } from "./test-plan.js"
import type { Release } from "./release.js"
import { draft } from "./draft.js"

export interface Measurement {
  readonly id: string
  /** Measured resistance for the step, ohms. */
  readonly measuredOhms: number
}

export interface TestVerdict {
  readonly id: string
  readonly type: HarnessTest["type"]
  readonly expected: "closed" | "open"
  readonly measuredOhms?: number
  readonly verdict: "pass" | "fail" | "not-run"
}

export interface LengthObservation {
  /** Wire id, matching HIR `wires[].id`. */
  readonly wire: string
  /** Measured end-to-end length in harness units. */
  readonly measuredLength: number
}

export interface LengthVerdict {
  readonly wire: string
  readonly designLength?: number
  readonly tolerance?: number
  readonly measuredLength: number
  /** measured - design, present only when a design length exists. */
  readonly delta?: number
  readonly verdict: "in-tolerance" | "out-of-tolerance" | "no-design-length"
}

export interface BuildRecord {
  readonly recordVersion: "0.1.0"
  readonly release: string
  readonly hirFingerprint: string
  readonly serial: string
  readonly lot?: string
  readonly operator: string
  readonly workstation?: string
  readonly buildDate: string
  readonly materialLots?: Readonly<Record<string, string>>
  readonly tools?: Readonly<Record<string, string>>
  readonly testProgramVersion: string
  readonly results: ReadonlyArray<TestVerdict>
  readonly summary: {
    readonly pass: number
    readonly fail: number
    readonly notRun: number
    readonly status: "pass" | "fail" | "incomplete"
  }
  /** As-built length evidence. Omitted entirely when nothing was measured. */
  readonly lengths?: ReadonlyArray<LengthVerdict>
  readonly lengthSummary?: {
    readonly inTolerance: number
    readonly outOfTolerance: number
    readonly noDesignLength: number
  }
  readonly rework?: ReadonlyArray<string>
  readonly deviations?: ReadonlyArray<string>
}

/** Continuity passes below this, isolation passes above (ohms). */
const CONTINUITY_MAX_OHMS = 2
const ISOLATION_MIN_OHMS = 100_000

export interface BuildRecordOptions {
  readonly serial: string
  readonly operator: string
  readonly buildDate: string
  readonly lot?: string
  readonly workstation?: string
  readonly materialLots?: Readonly<Record<string, string>>
  readonly tools?: Readonly<Record<string, string>>
  /** As-built wire lengths measured on the bench. */
  readonly lengths?: ReadonlyArray<LengthObservation>
  /**
   * Tolerance applied to wires that declare no `lengthTolerance` of their
   * own. Without it, an exact match is the only thing in tolerance.
   */
  readonly defaultLengthTolerance?: number
  readonly rework?: ReadonlyArray<string>
  readonly deviations?: ReadonlyArray<string>
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Judge measured lengths against the design.
 *
 * Tolerance resolution runs wire `lengthTolerance` first, then
 * `defaultLengthTolerance`, then zero — with no tolerance declared anywhere,
 * any nonzero delta is out of tolerance.
 *
 * A wire the design gives no `length` is `"no-design-length"`: there is
 * nothing to judge against, so it is reported, not failed. An observation
 * naming a wire id that is not in the HIR lands in the same bucket rather
 * than throwing, matching how `createBuildRecord` already treats a
 * measurement id with no matching test — unknown ids are surfaced in the
 * output as unjudgeable, never fatal and never counted as a failure.
 */
const judgeLengths = (
  hir: Hir,
  observations: ReadonlyArray<LengthObservation>,
  defaultLengthTolerance: number | undefined
): ReadonlyArray<LengthVerdict> => {
  const wires = new Map(hir.wires.map((w) => [w.id, w]))
  return [...observations]
    .sort((a, b) => cmp(a.wire, b.wire))
    .map((obs): LengthVerdict => {
      const designLength = wires.get(obs.wire)?.length
      if (designLength === undefined) {
        return {
          wire: obs.wire,
          measuredLength: obs.measuredLength,
          verdict: "no-design-length"
        }
      }
      const tolerance = wires.get(obs.wire)?.lengthTolerance ?? defaultLengthTolerance
      const delta = obs.measuredLength - designLength
      const design = draft<Pick<LengthVerdict, "wire" | "designLength" | "tolerance">>({
        wire: obs.wire,
        designLength
      })
      if (tolerance !== undefined) design.tolerance = tolerance
      return {
        ...design,
        measuredLength: obs.measuredLength,
        delta,
        verdict: Math.abs(delta) <= (tolerance ?? 0) ? "in-tolerance" : "out-of-tolerance"
      }
    })
}

export const createBuildRecord = (
  hir: Hir,
  release: Release,
  measurements: ReadonlyArray<Measurement>,
  options: BuildRecordOptions
): BuildRecord => {
  const measured = new Map(measurements.map((m) => [m.id, m.measuredOhms]))
  const plan = generateTestPlan(hir)
  const results: Array<TestVerdict> = plan.tests.map((t) => {
    const ohms = measured.get(t.id)
    if (ohms === undefined) {
      return { id: t.id, type: t.type, expected: t.expected, verdict: "not-run" }
    }
    const pass =
      t.expected === "closed" ? ohms <= CONTINUITY_MAX_OHMS : ohms >= ISOLATION_MIN_OHMS
    return {
      id: t.id,
      type: t.type,
      expected: t.expected,
      measuredOhms: ohms,
      verdict: pass ? "pass" : "fail"
    }
  })
  const pass = results.filter((r) => r.verdict === "pass").length
  const fail = results.filter((r) => r.verdict === "fail").length
  const notRun = results.filter((r) => r.verdict === "not-run").length
  // Omitted wholesale when nothing was measured: a record with no length
  // evidence must serialize exactly as it always has.
  const lengths =
    options.lengths !== undefined
      ? judgeLengths(hir, options.lengths, options.defaultLengthTolerance)
      : undefined
  // Assembled in serialized key order: each optional field is added only
  // when present, in the position the record has always carried it.
  const identity = draft<
    Pick<BuildRecord, "recordVersion" | "release" | "hirFingerprint" | "serial" | "lot">
  >({
    recordVersion: "0.1.0",
    release: release.releaseId,
    hirFingerprint: release.hirFingerprint,
    serial: options.serial
  })
  if (options.lot !== undefined) identity.lot = options.lot
  const station = draft<Pick<BuildRecord, "operator" | "workstation">>({
    operator: options.operator
  })
  if (options.workstation !== undefined) station.workstation = options.workstation
  const materials = draft<Pick<BuildRecord, "buildDate" | "materialLots" | "tools">>({
    buildDate: options.buildDate
  })
  if (options.materialLots !== undefined) materials.materialLots = options.materialLots
  if (options.tools !== undefined) materials.tools = options.tools
  const record = draft<BuildRecord>({
    ...identity,
    ...station,
    ...materials,
    testProgramVersion: `${release.releaseId}#${plan.tests.length}`,
    results,
    summary: {
      pass,
      fail,
      notRun,
      status: fail > 0 ? "fail" : notRun > 0 ? "incomplete" : "pass"
    }
  })
  if (lengths !== undefined) {
    record.lengths = lengths
    record.lengthSummary = {
      inTolerance: lengths.filter((l) => l.verdict === "in-tolerance").length,
      outOfTolerance: lengths.filter((l) => l.verdict === "out-of-tolerance").length,
      noDesignLength: lengths.filter((l) => l.verdict === "no-design-length").length
    }
  }
  if (options.rework !== undefined) record.rework = options.rework
  if (options.deviations !== undefined) record.deviations = options.deviations
  return record
}

export const buildRecordJson = (record: BuildRecord): string =>
  JSON.stringify(record, null, 2) + "\n"

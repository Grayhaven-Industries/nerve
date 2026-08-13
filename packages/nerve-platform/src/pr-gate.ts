/**
 * Pull-request gate (PRD §9.5, Workflow E).
 *
 * This module turns a finished review into the payload a repository check
 * expects. It deliberately builds a value and returns it rather than calling
 * GitHub: the transport, the app credentials, and the retry policy belong to
 * the deployment layer, while what the check *says* is a product decision that
 * has to be testable without a network.
 *
 * §9.5 asks for four things — a conclusion, a compact summary, annotations on
 * the blocking findings that have a source location, and a link back to the
 * hosted review. The fourth is why `detailsUrl` is required rather than
 * optional: a red check with no route to the evidence is the failure mode this
 * workflow exists to prevent, since the PR can only ever show a summary and
 * dispositioning happens in the product (§9.3).
 *
 * Field names below are snake_case because they are serialized straight to the
 * REST body. Verified against the GitHub REST API "Create a check run"
 * documentation (docs.github.com/en/rest/checks/runs, retrieved via Context7):
 * `conclusion` accepts action_required | cancelled | failure | neutral |
 * success | skipped | stale | timed_out; `annotation_level` accepts notice |
 * warning | failure; `start_line`/`end_line` are required integers starting at
 * 1; and a single request carries at most 50 annotations.
 */
import type { Finding, Policy } from "./objects.js"
import { effectiveSeverity } from "./policy.js"
import type { GateResult } from "./review.js"

/** Conclusions this gate can produce. The wider API set is not all reachable. */
export type CheckConclusion = "success" | "failure" | "action_required" | "neutral"

export type AnnotationLevel = "notice" | "warning" | "failure"

/**
 * The documented per-request annotation ceiling. Exceeding it is rejected by
 * the API, so `checkRunForReview` splits rather than truncates — a finding
 * dropped for being 51st would be invisible in exactly the place the reviewer
 * is looking.
 */
export const MAX_ANNOTATIONS_PER_REQUEST = 50

export interface CheckAnnotation {
  readonly path: string
  readonly start_line: number
  readonly end_line: number
  readonly annotation_level: AnnotationLevel
  readonly message: string
  readonly title: string
}

export interface CheckRunOutput {
  readonly title: string
  readonly summary: string
  /** The first batch only; the rest ride in follow-up updates. */
  readonly annotations: ReadonlyArray<CheckAnnotation>
}

export interface CheckRun {
  readonly name: string
  readonly status: "completed"
  readonly conclusion: CheckConclusion
  readonly details_url: string
  readonly external_id: string
  readonly output: CheckRunOutput
}

export interface CheckRunPlan {
  readonly checkRun: CheckRun
  /**
   * Every annotation batch, in order, each within
   * `MAX_ANNOTATIONS_PER_REQUEST`. The first is already inside
   * `checkRun.output`; the caller PATCHes the remainder onto the same run.
   */
  readonly annotationBatches: ReadonlyArray<ReadonlyArray<CheckAnnotation>>
  /**
   * Blocking findings that could not be annotated because they carry no source
   * line. They are named in the summary instead. Surfaced here as well so a
   * caller can assert nothing was quietly lost.
   */
  readonly unanchoredFindingIds: ReadonlyArray<string>
}

export interface CheckRunInput {
  /** The gate verdict from `evaluateReadyForApproval` (§10.2). */
  readonly gate: GateResult
  readonly findings: ReadonlyArray<Finding>
  readonly policy: Policy
  /** §9.5 step 5: the hosted review, for full evidence and disposition. */
  readonly detailsUrl: string
  /** Correlates the check back to the run that produced it. */
  readonly reviewRunId: string
  /**
   * True when the run itself failed to execute (§10.1 `review-failed`). Kept
   * separate from the gate because a failed execution holds no design verdict:
   * reporting it as `failure` would tell the author their harness is wrong
   * when the truth is that nothing was judged.
   */
  readonly executionFailed?: boolean | undefined
  readonly name?: string | undefined
}

const DEFAULT_CHECK_NAME = "nerve review"

/** GitHub's three levels, from our severities. `info` never blocks. */
const annotationLevel = (severity: "error" | "warning" | "info"): AnnotationLevel =>
  severity === "error" ? "failure" : severity === "warning" ? "warning" : "notice"

/**
 * Split into API-sized batches. Chunking rather than capping is the whole
 * point; see `MAX_ANNOTATIONS_PER_REQUEST`.
 */
const batch = (
  annotations: ReadonlyArray<CheckAnnotation>
): ReadonlyArray<ReadonlyArray<CheckAnnotation>> => {
  if (annotations.length === 0) return []
  const batches: Array<ReadonlyArray<CheckAnnotation>> = []
  for (let i = 0; i < annotations.length; i += MAX_ANNOTATIONS_PER_REQUEST) {
    batches.push(annotations.slice(i, i + MAX_ANNOTATIONS_PER_REQUEST))
  }
  return batches
}

/**
 * Build one annotation, or `undefined` when the finding cannot be anchored.
 *
 * A row is required: §9.5 step 4 says blocking findings annotate the source
 * file "where a source location exists", and the API requires an integer line.
 * The column is deliberately not mapped — a `Finding` records the *name* of the
 * offending column (`"From Pin"`), while `start_column` is a character offset.
 * Inventing an offset from a name would put the marker on arbitrary text, so
 * the column name goes in the message where it is accurate.
 */
const annotationFor = (
  finding: Finding,
  level: AnnotationLevel
): CheckAnnotation | undefined => {
  const location = finding.sourceLocation
  if (location === undefined || location.row === undefined) return undefined
  const column = location.column === undefined ? "" : ` (column ${location.column})`
  return {
    path: location.filename,
    start_line: location.row,
    end_line: location.row,
    annotation_level: level,
    // Truncation guard: the API caps titles at 255 characters.
    title: `${finding.code}${column}`.slice(0, 255),
    message: finding.message
  }
}

/**
 * Compose the check payload for a finished review (§9.5).
 *
 * Findings are classified on their *effective* severity so a rule the
 * organization promoted or demoted (ORG-004) reads the same way in the PR as
 * it does in the product. Anything the org demoted to `info` neither blocks
 * nor annotates.
 */
export const checkRunForReview = (input: CheckRunInput): CheckRunPlan => {
  const { gate, findings, policy } = input

  const blocking = findings.filter(
    (finding) => effectiveSeverity(finding.code, finding.ruleSeverity, policy) === "error"
  )
  const warnings = findings.filter(
    (finding) => effectiveSeverity(finding.code, finding.ruleSeverity, policy) === "warning"
  )

  const annotations: Array<CheckAnnotation> = []
  const unanchored: Array<string> = []
  for (const finding of [...blocking, ...warnings]) {
    const level = annotationLevel(
      effectiveSeverity(finding.code, finding.ruleSeverity, policy)
    )
    const annotation = annotationFor(finding, level)
    if (annotation === undefined) {
      // Only blocking findings are promised an annotation, so only their
      // absence is worth reporting back to the caller.
      if (level === "failure") unanchored.push(finding.id)
      continue
    }
    annotations.push(annotation)
  }

  const conclusion: CheckConclusion =
    input.executionFailed === true
      ? "action_required"
      : gate.ready
        ? "success"
        : "failure"

  const batches = batch(annotations)

  const headline =
    input.executionFailed === true
      ? "The review did not finish. Correct the source or the configuration and run it again."
      : gate.ready
        ? "Ready for approval. No blocking findings."
        : `${gate.blockers.length} item(s) block approval.`

  // Compact by design (§9.5 step 3): the PR carries the verdict and the route
  // to the evidence, not the evidence.
  const lines = [
    headline,
    "",
    `Blocking findings: ${blocking.length}`,
    `Warnings: ${warnings.length}`
  ]
  if (gate.blockers.length > 0) {
    lines.push("", "Gate:")
    for (const blocker of gate.blockers) lines.push(`- ${blocker.code}: ${blocker.message}`)
  }
  if (unanchored.length > 0) {
    lines.push(
      "",
      `${unanchored.length} blocking finding(s) have no source line and are not annotated: ${unanchored.join(", ")}.`
    )
  }
  lines.push("", `Full evidence and disposition: ${input.detailsUrl}`)

  return {
    checkRun: {
      name: input.name ?? DEFAULT_CHECK_NAME,
      status: "completed",
      conclusion,
      details_url: input.detailsUrl,
      external_id: input.reviewRunId,
      output: {
        title: headline,
        summary: lines.join("\n"),
        annotations: batches[0] ?? []
      }
    },
    annotationBatches: batches,
    unanchoredFindingIds: unanchored
  }
}

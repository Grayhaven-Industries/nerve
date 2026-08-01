import type { Diagnostic, Hir } from "@grayhaven/nerve"

export type EvalProvenanceKind =
  | "synthetic"
  | "datasheet-derived"
  | "field-verified"

export interface EvalProvenance {
  readonly kind: EvalProvenanceKind
  readonly source: string
  readonly rights: "public" | "restricted"
  readonly reviewedByRole?: string
  readonly reviewedOn?: string
}

export interface EvalAssertion {
  readonly code: string
  readonly target?: string
  readonly minimumCount?: number
}

export interface EvalCase {
  readonly id: string
  readonly title: string
  readonly fixture: string
  readonly rationale: string
  readonly provenance: EvalProvenance
  readonly expectedFindings: ReadonlyArray<EvalAssertion>
  readonly forbiddenFindings?: ReadonlyArray<EvalAssertion>
}

export interface EvalManifest {
  readonly $schema?: string
  readonly corpusVersion: "0.1.0"
  readonly cases: ReadonlyArray<EvalCase>
}

const record = (value: unknown, path: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`)
  }
  return value as Record<string, unknown>
}

const string = (value: unknown, path: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string.`)
  }
  return value
}

const array = (value: unknown, path: string): ReadonlyArray<unknown> => {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`)
  return value
}

const onlyKeys = (
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlyArray<string>,
  path: string
): void => {
  const allowedSet = new Set(allowed)
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key))
  if (unknown.length > 0) {
    throw new Error(`${path} contains unknown field(s): ${unknown.sort().join(", ")}.`)
  }
}

const optionalString = (value: unknown, path: string): string | undefined =>
  value === undefined ? undefined : string(value, path)

const assertion = (value: unknown, path: string): EvalAssertion => {
  const input = record(value, path)
  onlyKeys(input, ["code", "target", "minimumCount"], path)
  const code = string(input["code"], `${path}.code`)
  if (!/^HK-[A-Z0-9]+-[0-9]{3}$/.test(code)) {
    throw new Error(`${path}.code must be a stable HK-* diagnostic code.`)
  }
  const target = optionalString(input["target"], `${path}.target`)
  const count = input["minimumCount"]
  if (
    count !== undefined &&
    (typeof count !== "number" || !Number.isInteger(count) || count < 1)
  ) {
    throw new Error(`${path}.minimumCount must be a positive integer.`)
  }
  return {
    code,
    ...(target !== undefined ? { target } : {}),
    ...(count !== undefined ? { minimumCount: Number(count) } : {})
  }
}

const provenance = (value: unknown, path: string): EvalProvenance => {
  const input = record(value, path)
  onlyKeys(input, ["kind", "source", "rights", "reviewedByRole", "reviewedOn"], path)
  const kind = string(input["kind"], `${path}.kind`)
  if (kind !== "synthetic" && kind !== "datasheet-derived" && kind !== "field-verified") {
    throw new Error(`${path}.kind is not a supported provenance kind.`)
  }
  const rights = string(input["rights"], `${path}.rights`)
  if (rights !== "public" && rights !== "restricted") {
    throw new Error(`${path}.rights must be public or restricted.`)
  }
  const reviewedByRole = optionalString(input["reviewedByRole"], `${path}.reviewedByRole`)
  const reviewedOn = optionalString(input["reviewedOn"], `${path}.reviewedOn`)
  if (reviewedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(reviewedOn)) {
    throw new Error(`${path}.reviewedOn must be an ISO date in YYYY-MM-DD form.`)
  }
  if (kind === "field-verified" && (reviewedByRole === undefined || reviewedOn === undefined)) {
    throw new Error(
      `${path} must name reviewedByRole and reviewedOn before a case can be field-verified.`
    )
  }
  return {
    kind,
    source: string(input["source"], `${path}.source`),
    rights,
    ...(reviewedByRole !== undefined ? { reviewedByRole } : {}),
    ...(reviewedOn !== undefined ? { reviewedOn } : {})
  }
}

const evalCase = (value: unknown, path: string): EvalCase => {
  const input = record(value, path)
  onlyKeys(
    input,
    [
      "id",
      "title",
      "fixture",
      "rationale",
      "provenance",
      "expectedFindings",
      "forbiddenFindings"
    ],
    path
  )
  const id = string(input["id"], `${path}.id`)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`${path}.id must be a lowercase, hyphenated stable ID.`)
  }
  const fixture = string(input["fixture"], `${path}.fixture`)
  if (fixture.startsWith("/") || fixture.split(/[\\/]/).includes("..")) {
    throw new Error(`${path}.fixture must stay within the corpus directory.`)
  }
  const expected = array(input["expectedFindings"], `${path}.expectedFindings`).map(
    (item, index) => assertion(item, `${path}.expectedFindings[${index}]`)
  )
  const forbidden =
    input["forbiddenFindings"] === undefined
      ? undefined
      : array(input["forbiddenFindings"], `${path}.forbiddenFindings`).map(
          (item, index) => assertion(item, `${path}.forbiddenFindings[${index}]`)
        )
  if (expected.length === 0 && (forbidden?.length ?? 0) === 0) {
    throw new Error(`${path} must contain at least one expected or forbidden finding.`)
  }
  return {
    id,
    title: string(input["title"], `${path}.title`),
    fixture,
    rationale: string(input["rationale"], `${path}.rationale`),
    provenance: provenance(input["provenance"], `${path}.provenance`),
    expectedFindings: expected,
    ...(forbidden !== undefined ? { forbiddenFindings: forbidden } : {})
  }
}

/** Decode an untrusted JSON manifest before any fixture module is executed. */
export const decodeEvalManifest = (value: unknown): EvalManifest => {
  const input = record(value, "manifest")
  onlyKeys(input, ["$schema", "corpusVersion", "cases"], "manifest")
  if (input["corpusVersion"] !== "0.1.0") {
    throw new Error("manifest.corpusVersion must be 0.1.0.")
  }
  const cases = array(input["cases"], "manifest.cases").map((item, index) =>
    evalCase(item, `manifest.cases[${index}]`)
  )
  const ids = new Set<string>()
  for (const testCase of cases) {
    if (ids.has(testCase.id)) throw new Error(`manifest repeats case ID ${testCase.id}.`)
    ids.add(testCase.id)
  }
  const schema = optionalString(input["$schema"], "manifest.$schema")
  return {
    ...(schema !== undefined ? { $schema: schema } : {}),
    corpusVersion: "0.1.0",
    cases
  }
}

export interface AssertionResult extends EvalAssertion {
  readonly observedCount: number
  readonly passed: boolean
}

export interface EvalCaseResult {
  readonly id: string
  readonly title: string
  readonly provenance: EvalProvenance
  readonly passed: boolean
  readonly expected: ReadonlyArray<AssertionResult>
  readonly forbidden: ReadonlyArray<AssertionResult>
  /** Findings not asserted by the case. They are not labeled false positives without adjudication. */
  readonly unassertedFindings: ReadonlyArray<Diagnostic>
}

const assertionCount = (
  assertion: EvalAssertion,
  diagnostics: ReadonlyArray<Diagnostic>
): number =>
  diagnostics.filter(
    (finding) =>
      finding.code === assertion.code &&
      (assertion.target === undefined || finding.target === assertion.target)
  ).length

const asserted = (
  finding: Diagnostic,
  assertions: ReadonlyArray<EvalAssertion>
): boolean =>
  assertions.some(
    (assertion) =>
      assertion.code === finding.code &&
      (assertion.target === undefined || assertion.target === finding.target)
  )

export const evaluateCase = (
  testCase: EvalCase,
  diagnostics: ReadonlyArray<Diagnostic>
): EvalCaseResult => {
  const expected = testCase.expectedFindings.map((assertion) => {
    const observedCount = assertionCount(assertion, diagnostics)
    return {
      ...assertion,
      observedCount,
      passed: observedCount >= (assertion.minimumCount ?? 1)
    }
  })
  const forbidden = (testCase.forbiddenFindings ?? []).map((assertion) => {
    const observedCount = assertionCount(assertion, diagnostics)
    return {
      ...assertion,
      observedCount,
      passed: observedCount === 0
    }
  })
  const allAssertions = [
    ...testCase.expectedFindings,
    ...(testCase.forbiddenFindings ?? [])
  ]
  return {
    id: testCase.id,
    title: testCase.title,
    provenance: testCase.provenance,
    passed: [...expected, ...forbidden].every((assertion) => assertion.passed),
    expected,
    forbidden,
    unassertedFindings: diagnostics.filter(
      (finding) => !asserted(finding, allAssertions)
    )
  }
}

export interface EvalCorpusReport {
  readonly reportVersion: "0.1.0"
  readonly cases: ReadonlyArray<EvalCaseResult>
  readonly summary: {
    readonly total: number
    readonly passed: number
    readonly failed: number
    readonly byProvenance: Readonly<Record<EvalProvenanceKind, number>>
  }
}

export const createCorpusReport = (
  cases: ReadonlyArray<EvalCaseResult>
): EvalCorpusReport => ({
  reportVersion: "0.1.0",
  cases: [...cases].sort((a, b) => a.id.localeCompare(b.id)),
  summary: {
    total: cases.length,
    passed: cases.filter((testCase) => testCase.passed).length,
    failed: cases.filter((testCase) => !testCase.passed).length,
    byProvenance: {
      synthetic: cases.filter((testCase) => testCase.provenance.kind === "synthetic")
        .length,
      "datasheet-derived": cases.filter(
        (testCase) => testCase.provenance.kind === "datasheet-derived"
      ).length,
      "field-verified": cases.filter(
        (testCase) => testCase.provenance.kind === "field-verified"
      ).length
    }
  }
})

/**
 * What one rule claimed, and on whose authority.
 *
 * A reviewer auditing a report needs to separate "the tool ran a check" from
 * "a standard requires this check". `standard` is present only where the rule
 * pack could establish the governing document; its absence means the basis was
 * not established, never that the check is unaudited-but-fine.
 */
export interface ReviewRuleProvenance {
  readonly code: string
  readonly ruleVersion?: string
  readonly standard?: string
  readonly clause?: string
}

export interface ReviewReportOptions {
  readonly source: {
    readonly name: string
    readonly format: string
  }
  readonly hirFingerprint: string
  readonly toolVersion: string
  readonly rules: {
    readonly package: string
    readonly version: string
    readonly codes: ReadonlyArray<string>
    /**
     * Per-code provenance, sorted by code. Codes with no established governing
     * standard appear with only `ruleVersion`. Optional so a report produced
     * without it stays byte-identical to reports predating this field.
     */
    readonly provenance?: ReadonlyArray<ReviewRuleProvenance>
  }
  readonly limitations?: ReadonlyArray<string>
}

export interface ReviewReport {
  readonly reportVersion: "0.1.0"
  readonly reportType: "deterministic-harness-review"
  readonly source: ReviewReportOptions["source"]
  readonly harness: {
    readonly id: string
    readonly revision: string
    readonly hirSchema: string
    readonly fingerprint: string
  }
  readonly engine: {
    readonly tool: "@grayhaven/nerve-cli"
    readonly version: string
    readonly rules: ReviewReportOptions["rules"]
  }
  readonly summary: {
    readonly errors: number
    readonly warnings: number
    readonly info: number
    readonly findings: number
  }
  readonly findings: ReadonlyArray<Diagnostic>
  readonly limitations: ReadonlyArray<string>
  readonly disclaimer: string
}

/**
 * Canonicalize per-code provenance: deduped by code (first wins), sorted with
 * the same plain lexicographic order as `codes` so the two arrays line up, and
 * rebuilt in a fixed key order with absent fields omitted rather than null.
 * Two runs over the same rule set must produce identical bytes.
 */
const sortedProvenance = (
  entries: ReadonlyArray<ReviewRuleProvenance>
): ReadonlyArray<ReviewRuleProvenance> => {
  const byCode = new Map<string, ReviewRuleProvenance>()
  for (const entry of entries) {
    if (!byCode.has(entry.code)) byCode.set(entry.code, entry)
  }
  return [...byCode.values()]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((entry) => ({
      code: entry.code,
      ...(entry.ruleVersion !== undefined ? { ruleVersion: entry.ruleVersion } : {}),
      ...(entry.standard !== undefined ? { standard: entry.standard } : {}),
      ...(entry.clause !== undefined ? { clause: entry.clause } : {})
    }))
}

export const createReviewReport = (
  hir: Hir,
  diagnostics: ReadonlyArray<Diagnostic>,
  options: ReviewReportOptions
): ReviewReport => {
  // Split provenance off so an unsupplied field never reaches the output at
  // all — reports made without it stay byte-identical to pre-provenance ones.
  const { provenance: ruleProvenance, ...ruleIdentity } = options.rules
  const findings = [...diagnostics].sort(
    (a, b) =>
      (a.target ?? "").localeCompare(b.target ?? "") ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message)
  )
  return {
    reportVersion: "0.1.0",
    reportType: "deterministic-harness-review",
    source: options.source,
    harness: {
      id: hir.harness.id,
      revision: hir.harness.revision,
      hirSchema: hir.schemaVersion,
      fingerprint: options.hirFingerprint
    },
    engine: {
      tool: "@grayhaven/nerve-cli",
      version: options.toolVersion,
      rules: {
        ...ruleIdentity,
        codes: [...new Set(options.rules.codes)].sort(),
        ...(ruleProvenance !== undefined
          ? { provenance: sortedProvenance(ruleProvenance) }
          : {})
      }
    },
    summary: {
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      info: findings.filter((finding) => finding.severity === "info").length,
      findings: findings.length
    },
    findings,
    limitations: [...(options.limitations ?? [])],
    disclaimer:
      "This report records deterministic checks performed on the supplied facts. It is not a certification and does not replace qualified engineering review."
  }
}

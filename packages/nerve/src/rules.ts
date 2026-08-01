/**
 * Validation rule primitives (PRD §9.4).
 *
 * Rules are plain TypeScript functions that run against HIR — never against
 * user source. Built-in rules live in `@grayhaven/nerve-rules`; users define
 * custom rules with `rule()` and package them like any other TypeScript.
 */
import type { Diagnostic, DiagnosticSeverity } from "./diagnostics.js"
import {
  analyzeElectricalConstraints,
  type ElectricalAnalysis
} from "./electrical.js"
import type { Hir } from "./hir/schema.js"
import { computeNets, type HarnessNets } from "./nets.js"

export interface RuleReport {
  readonly severity: DiagnosticSeverity
  readonly message: string
  readonly target?: string
  /** Additional involved refs (PRD §19 grammar) — multi-entity findings. */
  readonly targets?: ReadonlyArray<string>
  /** Structured values behind the message (measured vs. limit, counts). */
  readonly data?: Readonly<Record<string, string | number>>
  /** Override the rule's stable code for this report. Rarely needed. */
  readonly code?: string
}

export interface RuleContext {
  readonly hir: Hir
  /**
   * Electrical nets (splice-transitive, PRD §9.4): the same union-find
   * the test plan and graph.json use. Computed lazily, once per run.
   */
  readonly nets: HarnessNets
  /** Typed electrical semantics and constraint findings, computed on demand. */
  readonly electrical: ElectricalAnalysis
  report(report: RuleReport): void
}

/**
 * What a rule claims, and on whose authority.
 *
 * A rule is a claim about the physical world that can be wrong — unlike a
 * type check, which *defines* its own correctness. `HK-MFG-005` does not
 * determine whether a bundle survives a bend, it models it. Recording the
 * governing standard and clause per rule is what lets a reviewer audit the
 * claim instead of trusting it, and lets a field failure be attributed to a
 * rule-set state rather than a toolchain release.
 */
export interface RuleProvenance {
  /** Governing document, e.g. "ISO 11898-2:2016". Omitted when the rule is
   * a structural invariant of the model rather than a standards claim. */
  readonly standard?: string
  /** Clause or section within the standard, e.g. "§5.4". */
  readonly clause?: string
  /** Semver for this rule's logic, bumped when its verdict can change.
   * Addressable independently of the toolchain release. */
  readonly ruleVersion?: string
}

export interface Rule extends RuleProvenance {
  readonly name: string
  /** Stable diagnostic code attached to this rule's reports. */
  readonly code: string
  run(ctx: RuleContext): void
}

export interface RuleOptions extends RuleProvenance {
  readonly code?: string
}

/** Define a validation rule: `rule("require-can-pairs-twisted", (ctx) => {...})`. */
export const rule = (
  name: string,
  run: (ctx: RuleContext) => void,
  options: RuleOptions = {}
): Rule => ({
  name,
  code: options.code ?? `HK-RULE-${name.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
  ...(options.standard !== undefined ? { standard: options.standard } : {}),
  ...(options.clause !== undefined ? { clause: options.clause } : {}),
  ...(options.ruleVersion !== undefined ? { ruleVersion: options.ruleVersion } : {}),
  run
})

/**
 * Per-rule severity configuration (PRD §10.5 config example):
 * `{ missingWireColor: "error", missingLabel: "warning", noisyRule: "off" }`.
 */
export type RuleConfig = Readonly<Record<string, DiagnosticSeverity | "off">>

/**
 * Run rules against HIR, producing canonically ordered diagnostics.
 * Deterministic: output depends only on (hir, rules, config).
 */
export const runRules = (
  hir: Hir,
  rules: ReadonlyArray<Rule>,
  config: RuleConfig = {}
): ReadonlyArray<Diagnostic> => {
  const diagnostics: Array<Diagnostic> = []
  // Lazy + shared: rules that never touch nets pay nothing; rules that do
  // all see one computation.
  let netsCache: HarnessNets | undefined
  const nets = (): HarnessNets => (netsCache ??= computeNets(hir))
  let electricalCache: ElectricalAnalysis | undefined
  const electrical = (): ElectricalAnalysis =>
    (electricalCache ??= analyzeElectricalConstraints(hir))
  for (const r of rules) {
    const override = config[r.name]
    if (override === "off") continue
    r.run({
      hir,
      get nets() {
        return nets()
      },
      get electrical() {
        return electrical()
      },
      report: ({ severity, message, target, targets, data, code }) => {
        diagnostics.push({
          code: code ?? r.code,
          severity: override ?? severity,
          message,
          ...(target !== undefined ? { target } : {}),
          ...(targets !== undefined && targets.length > 0 ? { targets } : {}),
          ...(data !== undefined && Object.keys(data).length > 0 ? { data } : {})
        })
      }
    })
  }
  diagnostics.sort(
    (a, b) =>
      cmp(a.target ?? "", b.target ?? "") ||
      cmp(a.code, b.code) ||
      cmp(a.message, b.message)
  )
  return diagnostics
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

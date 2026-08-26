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

/**
 * A continuous measurement, emitted whether or not the rule failed.
 *
 * Findings are a failure-only channel: `report()` is called when something is
 * wrong, so a wire at 99% of its derated ampacity and one at 40% are
 * indistinguishable — both simply produce nothing. That compresses a scalar
 * into a bit and discards the rest, which for a human is a small loss and for
 * an optimizing agent is most of the signal: a boolean verifier offers a wall
 * to satisfy, never a direction to improve in. So an agent converges on the
 * first passing design rather than a good one, which is a property of the
 * verifier, not of the model.
 *
 * `utilization` is deliberately dimensionless (`measured / limit`, under 1
 * passes) so margins from unrelated physics — thermal, voltage drop, bundle
 * diameter — are commensurable and can be minimised over. Without a shared
 * scale and direction an objective function is just a pile of numbers.
 */
export interface Margin {
  /** Rule code that took the measurement. */
  readonly code: string
  /** HIR object measured, PRD §19 refs grammar, e.g. `wire:W12`. */
  readonly target: string
  /** What was measured, e.g. `"stub length"`. Stable per rule. */
  readonly quantity: string
  readonly measured: number
  /** The budget `measured` is judged against. Same unit; must be finite and > 0. */
  readonly limit: number
  readonly unit: string
  /** `measured / limit`. < 1 passes. */
  readonly utilization: number
  /** `1 - utilization`. Negative when over budget. */
  readonly margin: number
}

/** What a rule passes to `ctx.measure`; the runner derives the ratios. */
export interface MarginReport {
  readonly target: string
  readonly quantity: string
  readonly measured: number
  readonly limit: number
  readonly unit: string
  /** Override the rule's code, matching `report`'s escape hatch. */
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
  /**
   * Record a continuous measurement. Call this on EVERY evaluation, passing
   * or failing — a margin that only appears on failure is just a finding.
   *
   * Sparse by design: only call it where the underlying quantity is genuinely
   * continuous. Discrete claims (a pin exists, an id is unique, a terminal
   * family matches) have no meaningful gradient, and inventing one is worse
   * than omitting it because an optimizer will follow the fake slope.
   */
  measure(margin: MarginReport): void
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
): Rule => {
  let provenance: RuleProvenance = {}
  if (options.standard !== undefined) provenance = { ...provenance, standard: options.standard }
  if (options.clause !== undefined) provenance = { ...provenance, clause: options.clause }
  if (options.ruleVersion !== undefined) {
    provenance = { ...provenance, ruleVersion: options.ruleVersion }
  }
  return {
    name,
    code: options.code ?? `HK-RULE-${name.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}`,
    ...provenance,
    run
  }
}

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
): ReadonlyArray<Diagnostic> => runRulesWithMargins(hir, rules, config).diagnostics

export interface RuleRun {
  readonly diagnostics: ReadonlyArray<Diagnostic>
  /** Sparse: only rules measuring a continuous budget contribute. */
  readonly margins: ReadonlyArray<Margin>
}

/**
 * Run rules, keeping both channels: findings (what is wrong) and margins (how
 * close to wrong everything else is). `runRules` is this with the margins
 * dropped, so every existing caller is unaffected.
 */
export const runRulesWithMargins = (
  hir: Hir,
  rules: ReadonlyArray<Rule>,
  config: RuleConfig = {}
): RuleRun => {
  const diagnostics: Array<Diagnostic> = []
  const margins: Array<Margin> = []
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
        let diagnostic: Diagnostic = {
          code: code ?? r.code,
          severity: override ?? severity,
          message
        }
        if (target !== undefined) diagnostic = { ...diagnostic, target }
        if (targets !== undefined && targets.length > 0) diagnostic = { ...diagnostic, targets }
        if (data !== undefined && Object.keys(data).length > 0) diagnostic = { ...diagnostic, data }
        diagnostics.push(diagnostic)
      },
      measure: ({ target, quantity, measured, limit, unit, code }) => {
        // A non-finite or non-positive limit cannot be normalised, and a
        // fabricated ratio would poison any aggregate computed over it.
        // Drop the measurement rather than emit a meaningless one.
        if (!Number.isFinite(measured) || !Number.isFinite(limit) || limit <= 0) return
        const utilization = measured / limit
        margins.push({
          code: code ?? r.code,
          target,
          quantity,
          measured,
          limit,
          unit,
          utilization,
          margin: 1 - utilization
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
  margins.sort(
    (a, b) => cmp(a.target, b.target) || cmp(a.code, b.code) || cmp(a.quantity, b.quantity)
  )
  return { diagnostics, margins }
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

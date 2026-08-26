import type { Diagnostic } from "@grayhaven/nerve"
import { Link } from "@tanstack/react-router"
import rulesMeta from "../docs/rules-meta.json"
import { RULE_SUMMARIES } from "../docs/rule-summaries.js"
import { jumpToSource } from "../lib/editor-registry.js"
import { selectionFromTarget, setSelection } from "../lib/selection.js"

// Inline remedy per HK code: the JSON carries code -> rule name, the
// one-line summaries are keyed by name (same join as the rules reference).
const ruleSummaries = new Map(rulesMeta.map((r) => [r.code, RULE_SUMMARIES.get(r.name) ?? r.name]))

export function DiagnosticsPanel({
  diagnostics
}: {
  diagnostics: ReadonlyArray<Diagnostic>
}) {
  // React 19.2.7: keys must be unique among siblings and stable across
  // renders. This list is rebuilt per keystroke under auto-compile and it
  // reorders and filters, so an index key reattaches the row's focused button
  // to a different diagnostic. `Diagnostic` (packages/nerve/src/diagnostics.ts)
  // carries no id, so the key is its identifying content — the same `code`
  // recurs across many `target`s, and one `target` collects several findings
  // whose `message` names the specific refs and measured values. `occurrences`
  // then suffixes any exact content repeat, so siblings can never collide.
  const occurrences = new Map<string, number>()
  const keyFor = (d: Diagnostic): string => {
    const base = `${d.code}|${d.target ?? ""}|${d.message}`
    const seen = occurrences.get(base) ?? 0
    occurrences.set(base, seen + 1)
    return seen === 0 ? base : `${base}#${seen}`
  }

  return (
    <div
      className="diagnostics-panel"
      // axe scrollable-region-focusable: keyboard users scroll the list.
      tabIndex={0}
      role="region"
      aria-label="Issues"
    >
      <h3>Issues ({diagnostics.length})</h3>
      {diagnostics.length === 0 && <div className="diag">No issues found.</div>}
      {diagnostics.map((d) => {
        const sel = d.target !== undefined ? selectionFromTarget(d.target) : undefined
        const refChips =
          d.targets !== undefined
            ? [...new Set([d.target, ...d.targets])].filter((t): t is string => t !== undefined)
            : []
        return (
          // The row itself is never interactive (the code link inside it is
          // focusable, and axe forbids nested interactive controls) — the
          // target becomes a real button instead (§11.3: selecting a
          // diagnostic selects its object everywhere).
          <div key={keyFor(d)} className={`diag ${d.severity}`}>
            <Link to="/docs/rules" className="code" title={ruleSummaries.get(d.code)}>
              {d.code}
            </Link>
            {sel !== undefined && refChips.length === 0 && d.target !== undefined ? (
              <button
                type="button"
                className="target"
                onClick={() => {
                  setSelection(sel)
                  jumpToSource(d.target ?? "")
                }}
              >
                {d.target}
              </button>
            ) : (
              <span className="target">{d.target ?? ""}</span>
            )}
            <span className="message">{d.message}</span>
            {(refChips.length > 0 || d.data !== undefined) && (
              <span className="diag-detail">
                {/* Every involved ref is selectable. */}
                {refChips.map((t) => {
                  const tSel = selectionFromTarget(t)
                  return (
                    <button
                      key={t}
                      type="button"
                      className="diag-chip ref"
                      disabled={tSel === undefined}
                      onClick={() => {
                        if (tSel !== undefined) setSelection(tSel)
                        jumpToSource(t)
                      }}
                    >
                      {t}
                    </button>
                  )
                })}
                {/* Structured values behind the message (measured vs limit). */}
                {d.data !== undefined &&
                  Object.entries(d.data).map(([k, v]) => (
                    <span key={k} className="diag-chip">
                      {k}={String(v)}
                    </span>
                  ))}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

import { createFileRoute } from "@tanstack/react-router"
// Extracted at build time by scripts/gen-llms.ts from the shipped
// builtinRules array (importing the package here would pull the effect
// runtime into this route chunk).
import rulesMeta from "../docs/rules-meta.json"
import { RULE_SUMMARIES } from "../docs/rule-summaries.js"

export const Route = createFileRoute("/docs/rules")({
  head: () => ({ meta: [{ title: "Validation rules · Grayhaven Nerve" }] }),
  component: RulesReference
})

function RulesReference() {
  return (
    <>
      <span className="spec-tag">Validation Rules</span>
      <h1>{rulesMeta.length} built-in rules.</h1>
      <p>
        Stable <code>HK-*</code> codes, suitable for CI gating and waivers. This table renders
        extracted at build time from the shipped <code>builtinRules</code> array.
        Custom rules use the same <code>rule()</code> API and get their own codes.
      </p>
      <table className="data">
        <thead>
          <tr>
            <th>Code</th>
            <th>Rule</th>
            <th>Checks</th>
          </tr>
        </thead>
        <tbody>
          {rulesMeta.map((r) => (
            <tr key={r.code}>
              <td className="cell-code">{r.code}</td>
              <td className="cell-code">{r.name}</td>
              <td className="cell-text">{RULE_SUMMARIES.get(r.name) ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Example diagnostic</h2>
      <pre className="doc-code">{`HK-CONN-011 Error  connector:P1.pin:1
  Wire W2 carries V5 but pin P1.1 is assigned V9.`}</pre>
      <p>
        Severity drives exit codes: errors fail <code>nerve validate</code> (exit 1), warnings
        pass with notice. Releases fail closed on any error.
      </p>
    </>
  )
}

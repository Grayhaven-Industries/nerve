/**
 * DSL completion source for the editor. Function entries are curated to
 * match the worker sandbox surface (compile.worker.ts SANDBOX_MODULES);
 * property entries are GENERATED from @grayhaven/nerve source via
 * dsl-meta.json (scripts/extract-dsl.ts), so they cannot drift from the
 * shipped props.
 */
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import dslMeta from "../docs/dsl-meta.json"
import { PARTS_META, type PartMetaRow } from "../docs/parts-meta.js"

const fn = (label: string, detail: string, info: string): Completion => ({
  label,
  type: "function",
  detail,
  info
})

const FUNCTIONS: ReadonlyArray<Completion> = [
  fn("harness", "(id, options)", "Root design object. revision and units are required; releases fail closed without them."),
  fn("connector", "(id, part, { pins })", "Place a connector from a part definition. pins maps pin numbers to signal names."),
  fn("wire", "(id, from, to, options)", "Point-to-point conductor. Endpoints are connector.pin(n) or a splice. gauge/color/length feed the rules."),
  fn("splice", "(id, { type, notes? })", 'Junction node ("crimp" | "solder" | "ultrasonic"). Wires may terminate on it; nets compute across it.'),
  fn("cable", "(id, { conductors, shield? })", "Group wires into a multi-conductor cable; shield drains must land on a pin."),
  fn("branch", "(id, { path, nominalLength })", "Physical bundle segment for the board view and cut-length math."),
  fn("label", "(id, { text, attachTo })", "Printed loom label; exported to the label schedule."),
  fn("protection", "(id, { kind, ratingA, protects })", "Overcurrent device (fuse/breaker); its rating must not exceed the ampacity of the wires it protects."),
  fn("variant", "(base, overrides)", "Derive a configuration from a base harness without forking the file."),
  fn("rule", "(name, run, { code })", "Author a custom validation rule with a stable diagnostic code."),
  fn("defineConfig", "(config)", "Project config: plugins, rule severity overrides."),
  fn("compileDesign", "(design)", "Pure, deterministic compile to HIR."),
  fn("runRules", "(hir, rules, config?)", "Run rules; returns canonically ordered diagnostics."),
  fn("diffHir", "(before, after)", "Semantic diff between two revisions.")
]

// Every prop of every builder options interface, deduped; docs become
// completion info. Plus `pins`/`terminals`/`seals` from connector()'s
// inline opts object (not a named interface).
const OPTIONS: ReadonlyArray<Completion> = (() => {
  const seen = new Map<string, Completion>()
  for (const i of dslMeta.interfaces) {
    for (const p of i.props) {
      if (!seen.has(p.name)) {
        seen.set(
          p.name,
          p.doc === ""
            ? { label: p.name, type: "property" }
            : { label: p.name, type: "property", info: p.doc }
        )
      }
    }
  }
  for (const extra of ["pins", "terminals", "seals"]) {
    if (!seen.has(extra)) seen.set(extra, { label: extra, type: "property" })
  }
  return [...seen.values()]
})()

// Inside part("…"): complete the spec menu (generated from the shipped
// library). label=spec, detail=MPN, info=description — the editor teaches
// the catalog.
const PART_SPECS: ReadonlyArray<Completion> = PARTS_META
  .filter((p): p is PartMetaRow & { readonly spec: string } => p.spec !== undefined)
  .map((p) => ({
    label: p.spec,
    type: "constant",
    detail: p.mpn,
    info: [p.description, p.family, p.verification].filter(Boolean).join(" · ")
  }))

export const dslCompletions = (ctx: CompletionContext): CompletionResult | null => {
  // String position inside part("…") gets the spec menu.
  const inPart = ctx.matchBefore(/part\(\s*["'][\w-]*/)
  if (inPart !== null) {
    const quote = inPart.text.search(/["']/)
    return {
      from: inPart.from + quote + 1,
      options: PART_SPECS,
      validFor: /^[\w-]*$/
    }
  }
  const word = ctx.matchBefore(/[A-Za-z_]\w*/)
  if (word === null || (word.from === word.to && !ctx.explicit)) return null
  return {
    from: word.from,
    options: [...FUNCTIONS, ...OPTIONS],
    validFor: /^\w*$/
  }
}

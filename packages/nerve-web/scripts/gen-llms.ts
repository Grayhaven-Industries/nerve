/**
 * Agent-readable docs (AX pass): generates at build time so the variants
 * can never go stale relative to the app.
 *   public/docs/<page>.md   — markdown mirror of each docs page
 *   public/llms.txt         — index: H1 + blockquote + H2 link sections
 *   public/llms-full.txt    — the entire docs embedded, no fetches needed
 * The rules page is generated from the live builtinRules array.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { builtinRules } from "../../nerve-rules/src/index.ts"
import { allParts, partSpecs } from "../../nerve-connectors/src/index.ts"
import { hirJsonSchema, HIR_SCHEMA_VERSION } from "../../nerve/src/index.ts"
import { RULE_SUMMARIES } from "../src/docs/rule-summaries.ts"
import type { PartMetaRow } from "../src/docs/parts-meta.ts"
import type { JsonSchema7, JsonSchema7Root } from "effect/JSONSchema"
import { dslReferenceMd, extractDslMeta } from "./extract-dsl.ts"

const ROOT = join(import.meta.dir, "..")
const OUT = join(ROOT, "public")
import { SITE } from "./site.js"

const PAGES = [
  { slug: "quickstart", title: "Quickstart" },
  { slug: "dsl", title: "DSL Reference" },
  { slug: "sdk", title: "TypeScript SDK" },
  { slug: "cli", title: "CLI" },
  { slug: "artifacts", title: "Artifacts" },
  { slug: "ai", title: "AI Copilot" },
  { slug: "lifecycle", title: "Production Lifecycle" }
] as const

const indexNote = `> Grayhaven Nerve docs index: ${SITE}/llms.txt. Fetch it to discover all pages before exploring further.\n\n`

const rulesMd = (): string => {
  const rows = builtinRules
    .map((r) => `| \`${r.code}\` | \`${r.name}\` | ${RULE_SUMMARIES.get(r.name) ?? "-"} |`)
    .join("\n")
  return `# ${builtinRules.length} built-in validation rules.

Stable \`HK-*\` codes, suitable for CI gating and waivers. This table is generated from the shipped \`builtinRules\` array in \`@grayhaven/nerve-rules\`; it cannot drift from the code. Custom rules use the same \`rule()\` API and get their own codes.

| Code | Rule | Checks |
| --- | --- | --- |
${rows}

## Example diagnostic

\`\`\`
HK-CONN-011 Error  connector:P1.pin:1
  Wire W2 carries V5 but pin P1.1 is assigned V9.
\`\`\`

Severity drives exit codes: errors fail \`nerve validate\` (exit 1), warnings pass with notice. Releases fail closed on any error.
`
}

/** Any node the walk can reach: a schema, an `anyOf` member (Effect encodes
 * Schema.Object / `{}` with bare `{ type }` members), an `items` tuple, or an
 * absent/boolean slot. */
type SchemaNode = JsonSchema7 | { type: "object" } | Array<JsonSchema7> | boolean | undefined

/** HIR contract page, generated from the live Effect schema. */
const hirMd = (): string => {
  // SAFETY: hirJsonSchema() is JSONSchema.make(Hir) round-tripped through
  // JSON.stringify/parse, so its structure is Effect's JsonSchema7Root (the
  // round trip only drops undefined-valued keys).
  const schema = hirJsonSchema() as JsonSchema7Root
  // Effect emits Schema.Unknown as { $id: "/schemas/unknown" } (or {}).
  // Match it precisely — a stringify-includes check would mis-flag any
  // struct that merely CONTAINS an unknown field as wholly unknown.
  const isUnknownSchema = (s: JsonSchema7 | { type: "object" }): boolean =>
    ("$id" in s && s.$id === "/schemas/unknown") ||
    ("$ref" in s && s.$ref.endsWith("/unknown")) ||
    Object.keys(s).length === 0
  // A record (Schema.Record) is an object with NO declared properties but
  // an additionalProperties value-schema — distinct from a struct.
  const isRecord = (s: JsonSchema7 | { type: "object" }): boolean =>
    "type" in s &&
    s.type === "object" &&
    (!("properties" in s) || Object.keys(s.properties).length === 0)
  const typeOf = (s: SchemaNode): string => {
    if (s === undefined || s === true || s === false || Array.isArray(s)) return "unknown"
    if ("enum" in s) return s.enum.map((e) => JSON.stringify(e)).join(" \\| ")
    if ("anyOf" in s) return s.anyOf.map(typeOf).join(" \\| ")
    if ("type" in s && s.type === "array") return `Array<${typeOf(s.items)}>`
    // Record before the unknown check: a record-of-unknown is
    // Record<string, unknown>, not bare "unknown".
    if (isRecord(s)) {
      const values = "additionalProperties" in s ? s.additionalProperties : undefined
      const valueType =
        values !== undefined && values !== true && values !== false ? typeOf(values) : "unknown"
      return `Record<string, ${valueType}>`
    }
    if (isUnknownSchema(s)) return "unknown"
    if ("type" in s && s.type === "object" && "properties" in s) {
      return `{ ${Object.keys(s.properties).join(", ")} }`
    }
    return String(("type" in s ? s.type : undefined) ?? "unknown")
  }
  const table = (name: string, s: JsonSchema7): string => {
    // Arrays of structs document the element shape.
    const target =
      "type" in s &&
      s.type === "array" &&
      s.items !== undefined &&
      s.items !== false &&
      !Array.isArray(s.items)
        ? s.items
        : s
    // Records and property-less objects have no field table — render the
    // single-line type form instead of an empty header-only table.
    if (
      isRecord(target) ||
      !("properties" in target) ||
      Object.keys(target.properties).length === 0
    ) {
      return `## ${name}\n\nType: \`${typeOf(s)}\`\n`
    }
    const req = new Set(target.required)
    const rows = Object.entries(target.properties)
      .map(([k, v]) => {
        const desc = v.description ?? ""
        return `| \`${k}\` | \`${typeOf(v)}\` | ${req.has(k) ? "yes" : "no"} | ${desc} |`
      })
      .join("\n")
    const prefix = "type" in s && s.type === "array" ? "Array of:" : ""
    return `## ${name}\n\n${prefix}\n\n| Field | Type | Required | Notes |\n| --- | --- | --- | --- |\n${rows}\n`
  }
  const props = "properties" in schema ? schema.properties : {}
  const sections = Object.entries(props)
    .map(([k, v]) => table(k, v))
    .join("\n")
  return `# HIR ${HIR_SCHEMA_VERSION} — the compiled harness contract.

Generated from the live Effect schema in \`@grayhaven/nerve\` (\`hirJsonSchema()\`); it cannot drift from the code. \`harness.json\` in every exported packet validates against this. Renderers and rules consume HIR only — never user TypeScript. Optional fields are omitted when absent (never \`null\`), and all collections are canonically sorted, so output is byte-deterministic.

${sections}
## Versioning

\`schemaVersion\` is \`${HIR_SCHEMA_VERSION}\`. Additive optional fields may appear without a version bump (guarded by the shape-snapshot test); removals, type changes, or new required fields bump the version.
`
}

/** Part-library metadata: specs first (the way users should reach parts),
 * then the remaining MPNs. Effect-free JSON for the client + the page
 * (`PartMetaRow` is the client's contract, in src/docs/parts-meta.ts). */
type PartMetaRowDraft = { -readonly [K in keyof PartMetaRow]: PartMetaRow[K] }

/** One row with optional fields present only when the part declares them,
 * so the JSON carries no undefined-valued keys. Keys are inserted in the
 * column order the JSON has always used (spec, mpn, family, description,
 * pinCount, gender, verification); the final spread only fills the required
 * keys' types — they already exist, so their positions are kept. */
const partMetaRow = (mpn: string, spec: string | undefined): PartMetaRow => {
  const p = allParts[mpn]!
  const row: Partial<PartMetaRowDraft> = {}
  if (spec !== undefined) row.spec = spec
  row.mpn = mpn
  if (p.family !== undefined) row.family = p.family
  if (p.description !== undefined) row.description = p.description
  row.pinCount = p.pinCount
  if (p.gender !== undefined) row.gender = p.gender
  const verification = p.provenance?.verification
  if (verification !== undefined) row.verification = verification
  return { ...row, mpn, pinCount: p.pinCount }
}

const partsMeta = (): Array<PartMetaRow> => {
  const rows: Array<PartMetaRow> = []
  const bySpec = new Map<string, string>()
  for (const [spec, mpn] of Object.entries(partSpecs)) {
    // First spec for an MPN wins the row; aliases noted by their own rows.
    if (!bySpec.has(mpn)) bySpec.set(mpn, spec)
  }
  const speced = new Set(bySpec.keys())
  for (const [mpn, spec] of [...bySpec.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    rows.push(partMetaRow(mpn, spec))
  }
  for (const mpn of Object.keys(allParts).sort()) {
    if (speced.has(mpn)) continue
    rows.push(partMetaRow(mpn, undefined))
  }
  return rows
}

const libraryMd = (rows: ReadonlyArray<PartMetaRow>): string => {
  const table = rows
    .map(
      (r) =>
        `| ${r.spec !== undefined ? `\`${r.spec}\`` : ""} | \`${r.mpn}\` | ${r.family ?? ""} | ${r.pinCount} | ${r.gender ?? ""} | ${r.verification ?? ""} | ${r.description ?? ""} |`
    )
    .join("\n")
  return `# Part library — ${Object.keys(allParts).length} connectors, ${Object.keys(partSpecs).length} compact specs.

Generated from \`@grayhaven/nerve-connectors\` at build time; it cannot drift from the shipped library. Reach parts with \`part("spec")\` — compact specs beat memorizing MPNs — or any raw MPN (case-insensitive, common vendor spellings normalize).

| Spec | MPN | Family | Pins | Gender | Verification | Description |
| --- | --- | --- | --- | --- | --- | --- |
${table}

Aliases: ${Object.entries(partSpecs)
    .filter(([, mpn], i, all) => all.findIndex(([, m]) => m === mpn) !== i)
    .map(([s]) => `\`${s}\``)
    .join(", ")} resolve to the same housings as their primary specs.
`
}

mkdirSync(join(OUT, "docs"), { recursive: true })

// ── Part library: emit client JSON + generated page ─────────────────────
const parts = partsMeta()
writeFileSync(
  join(ROOT, "src", "docs", "parts-meta.json"),
  JSON.stringify(parts, null, 2) + "\n"
)

// ── DSL surface: extract from source, inject into the authored page ──────
const dslMeta = extractDslMeta()
writeFileSync(
  join(ROOT, "src", "docs", "dsl-meta.json"),
  JSON.stringify(dslMeta, null, 2) + "\n"
)
{
  const dslPath = join(ROOT, "docs-content", "dsl.md")
  const dslSrc = readFileSync(dslPath, "utf8")
  const START = "<!-- generated:dsl-reference:start -->"
  const END = "<!-- generated:dsl-reference:end -->"
  const s = dslSrc.indexOf(START)
  const e = dslSrc.indexOf(END)
  if (s === -1 || e === -1) throw new Error("dsl.md is missing the generated-reference markers")
  const next =
    dslSrc.slice(0, s + START.length) + "\n" + dslReferenceMd(dslMeta) + dslSrc.slice(e)
  if (next !== dslSrc) writeFileSync(dslPath, next)
}

const sections: string[] = []
const fullParts: string[] = []
for (const page of PAGES) {
  const md = readFileSync(join(ROOT, "docs-content", `${page.slug}.md`), "utf8")
  writeFileSync(join(OUT, "docs", `${page.slug}.md`), indexNote + md)
  sections.push(`- [${page.title}](${SITE}/docs/${page.slug}.md)`)
  fullParts.push(md)
}
// Rules page is generated, not authored.
const rules = rulesMd()
writeFileSync(join(OUT, "docs", "rules.md"), indexNote + rules)
sections.splice(3, 0, `- [Validation Rules](${SITE}/docs/rules.md) (generated from the shipped rule set)`)
fullParts.splice(3, 0, rules)

// HIR contract page is generated from the live schema, not authored.
const hir = hirMd()
writeFileSync(join(OUT, "docs", "hir.md"), indexNote + hir)
// Also emit the raw markdown into docs-content so the in-app /docs/hir
// route renders it through the same glob the authored pages use.
writeFileSync(join(ROOT, "docs-content", "hir.md"), hir)
sections.splice(4, 0, `- [HIR Schema](${SITE}/docs/hir.md) (generated from the live Effect schema)`)
fullParts.splice(4, 0, hir)

// Part library page is generated from the shipped library, not authored.
const library = libraryMd(parts)
writeFileSync(join(OUT, "docs", "library.md"), indexNote + library)
sections.splice(5, 0, `- [Part Library](${SITE}/docs/library.md) (generated from the shipped connector library)`)
fullParts.splice(5, 0, library)

const llms = `# Grayhaven Nerve

> Harnesses as code: typed wiring-harness design in TypeScript, compiled deterministically into schematics, BOMs, cut lists, labels, continuity tests, and build records. Validation rules with stable HK-* codes gate releases fail-closed.

## Docs

${sections.join("\n")}

Everything above embedded in one file: ${SITE}/llms-full.txt

## Packages (npm)

- [@grayhaven/nerve](https://www.npmjs.com/package/@grayhaven/nerve): DSL, HIR schema, compileDesign, diff, rule API
- [@grayhaven/nerve-rules](https://www.npmjs.com/package/@grayhaven/nerve-rules): ${builtinRules.length} built-in validation rules (HK-* codes)
- [@grayhaven/nerve-compiler](https://www.npmjs.com/package/@grayhaven/nerve-compiler): .harness.ts loading, fail-closed gate
- [@grayhaven/nerve-exporters](https://www.npmjs.com/package/@grayhaven/nerve-exporters): SVG/PDF/CSV/test-plan/packet generation
- [@grayhaven/nerve-wireviz](https://www.npmjs.com/package/@grayhaven/nerve-wireviz): WireViz YAML import/export
- [@grayhaven/nerve-cli](https://www.npmjs.com/package/@grayhaven/nerve-cli): nerve init/compile/validate/export/diff/release…
- [@grayhaven/nerve-connectors](https://www.npmjs.com/package/@grayhaven/nerve-connectors): verified connector part library

## Source

- [GitHub repository](https://github.com/tylergibbs1/nerve): Apache-2.0, monorepo with golden-fixture examples
- [Live editor](${SITE}/projects): compiles in the browser (note: the app routes are client-rendered; use the .md variants above)
`
writeFileSync(join(OUT, "llms.txt"), llms)

const full = `# Grayhaven Nerve: complete documentation

> Harnesses as code. This file embeds every docs page; no further fetches needed. Index: ${SITE}/llms.txt

${fullParts.join("\n\n---\n\n")}
`
writeFileSync(join(OUT, "llms-full.txt"), full)

// ── Sitemap: core routes + docs pages, all under the canonical domain ────
const sitemapPaths = ["/", "/docs", "/showcase", "/projects", ...PAGES.map((p) => `/docs/${p.slug}`)]
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapPaths.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join("\n")}
</urlset>
`
writeFileSync(join(OUT, "sitemap.xml"), sitemap)
// Effect-free rules metadata for the docs page (importing builtinRules in
// the client would drag the effect runtime into the route chunk).
writeFileSync(
  join(ROOT, "src", "docs", "rules-meta.json"),
  JSON.stringify(builtinRules.map((r) => ({ code: r.code, name: r.name })), null, 2) + "\n"
)
// Count what was actually written rather than trusting a hand-kept
// formula (it drifted to "+1" while the script grew rules/hir/library).
const mirrorCount = readdirSync(join(OUT, "docs")).filter((f) => f.endsWith(".md")).length
console.log(`generated llms.txt, llms-full.txt, sitemap.xml, ${mirrorCount} page mirrors`)

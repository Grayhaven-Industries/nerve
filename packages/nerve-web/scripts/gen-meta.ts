/**
 * Editor metadata, generated at build time so it cannot go stale relative to
 * the packages it describes:
 *   src/docs/rules-meta.json   — HK-* codes and names for the diagnostics panel
 *   src/docs/parts-meta.json   — the connector library for completions
 *   src/docs/dsl-meta.json     — the DSL surface for completions and the copilot
 *   public/sitemap.xml         — the app's own routes
 *
 * Prose documentation lives in the docs site (docs/), which generates its own
 * reference tables from the same sources via docs/scripts/generate-reference.ts.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { allParts, partSpecs } from "../../nerve-connectors/src/index.ts"
import { builtinRules } from "../../nerve-rules/src/index.ts"
import type { PartMetaRow } from "../src/docs/parts-meta.ts"
import { extractDslMeta } from "./extract-dsl.ts"
import { SITE } from "./site.js"

const ROOT = join(import.meta.dir, "..")
const OUT = join(ROOT, "public")

/** Part-library metadata: specs first (the way users should reach parts),
 * then the remaining MPNs. Effect-free JSON for the client
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

writeFileSync(
  join(ROOT, "src", "docs", "parts-meta.json"),
  JSON.stringify(partsMeta(), null, 2) + "\n"
)

writeFileSync(
  join(ROOT, "src", "docs", "dsl-meta.json"),
  JSON.stringify(extractDslMeta(), null, 2) + "\n"
)

// Effect-free rules metadata for the diagnostics panel (importing
// builtinRules in the client would drag the effect runtime into the chunk).
writeFileSync(
  join(ROOT, "src", "docs", "rules-meta.json"),
  JSON.stringify(builtinRules.map((r) => ({ code: r.code, name: r.name })), null, 2) + "\n"
)

const sitemapPaths = ["/", "/showcase", "/projects"]
writeFileSync(
  join(OUT, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapPaths.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join("\n")}
</urlset>
`
)

console.log(
  `generated editor metadata (${builtinRules.length} rules, ${Object.keys(allParts).length} parts) and sitemap.xml`
)

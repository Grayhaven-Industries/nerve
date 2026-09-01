# Code review — tscircuit-inspo wave (d02eb15..HEAD)

56 agents (8 area reviewers → adversarial verifiers → synthesis). 13 findings confirmed against the real code, 34 refuted. Synthesis hit the weekly limit; findings recovered from transcripts.

## 1. 🟠 [major/bug] WireViz import reinterprets unitless metric gauges (mm² by WireViz default) as AWG
**`packages/nerve-wireviz/src/import.ts:79`** · verifier confidence high, severity keep

- **Evidence:** normalizeGauge now calls `canonicalGauge(String(gauge).trim())`, and core parseAwg accepts bare integers 1–40 as AWG (gauge.ts BARE_AWG_MIN/MAX). WireViz treats a unitless `gauge:` number as mm². So an imported cable with `gauge: 16` (16 mm² ≈ 5 AWG, ~85 A) becomes the string "16AWG" (1.3 mm², 9.4 A in AMPACITY_BY_AWG). Standard metric cross-sections 1, 4, 6, 10, 16, 25, 35 mm² are all integers inside the 1–40 bare-AWG window. The old normalizeGauge only rewrote explicit "NN AWG" and passed bare numbers through (rules then skipped them — unchecked but never misinterpreted).
- **Impact:** Importing a metric WireViz harness silently corrupts gauge data: BOM/cut-list/SVG show "16AWG" for a 16 mm² conductor, and HK-WIRE-004/HK-MFG-004/HK-MFG-006 evaluate against tables for a wire ~16x smaller — false hard Errors (or, worse, false confidence) on every imported metric power cable.
- **Fix:** In normalizeGauge, only canonicalize when the source string mentions AWG (e.g. `/awg/i.test(s) ? canonicalGauge(s) : s`), or append the WireViz-default unit to bare numbers ("16" → "16mm2") before canonicalizing. Add an import test with `gauge: 16`.

## 2. 🟠 [major/test-gap] Wave's new rules (HK-MFG-007, HK-CONN-016/017) ship with blank 'Checks' column in generated rules docs; no coverage guard
**`packages/nerve-web/scripts/gen-llms.ts:35`** · verifier confidence high, severity downgrade

- **Evidence:** rulesMd() renders `RULE_SUMMARIES[r.name] ?? "-"` and the page header claims 'it cannot drift from the code'. Verified via bun: 7 of 24 builtinRules have no RULE_SUMMARIES entry, including all three rules added in this wave (HK-MFG-007 unparseableGauge from 7411e09, HK-CONN-016/017 connectorCurrent/VoltageExceeded from beadc59 — rules-meta.json grew by exactly these 3, rule-summaries.ts untouched in d02eb15..HEAD). tests/generated-docs.test.ts passes anyway (4/4 green) because it only guards the DSL extraction, not summary coverage.
- **Impact:** The wave's headline features (gauge canonicalization warning, connector electrical limits) appear in public/docs/rules.md, llms-full.txt, AND the in-app /docs/rules page (docs.rules.tsx uses the same `?? "-"` fallback) with an empty '-' description. Agents consuming llms.txt and users reading the rules reference get no explanation of what these rules check, on a page that explicitly advertises it cannot drift. Every future rule addition silently repeats this.
- **Fix:** Add RULE_SUMMARIES entries for unparseableGauge, connectorCurrentExceeded, connectorVoltageExceeded (and the 4 pre-existing gaps: voltageRatingBelowSignal, reservedPinAssigned, breakoutTighterThanBendRadius, bundleOverSleeveCapacity). Add one assertion to tests/generated-docs.test.ts: every builtinRules name has a RULE_SUMMARIES entry (and optionally no orphan keys).

## 3. 🟠 [major/bug] Generated reproduce workflow can never fire on an init-scaffolded project: init's .gitignore excludes dist/, the workflow only checks dist/harness.json
**`packages/nerve-cli/src/scaffold.ts:178`** · verifier confidence high, severity keep

- **Evidence:** REPRODUCE_YML: `if [ -f dist/harness.json ]; then npx nerve compile --out /tmp/fresh; npx nerve diff ...; else echo "No committed dist/harness.json — nothing to reproduce."; fi` — while INIT_GITIGNORE (scaffold.ts:104) is `node_modules/\ndist/\n` and INIT_CONFIG sets outputDir: "dist". The same `nerve init` + `nerve setup` pairing the commit ships makes dist/harness.json uncommittable.
- **Impact:** The headline feature of commit 563603b ('the byte-reproducibility check nobody else can offer') is a permanent no-op for every project scaffolded by the tool itself: checkout never contains dist/harness.json, the else-branch echoes and the job passes green. Users believe reproducibility is being verified when nothing is ever compared.
- **Fix:** Pick a committed, non-ignored baseline path (e.g. have the workflow check a `release/harness.json` or `*.baseline.json` that `nerve compile`/a future `nerve release` writes outside dist/), or stop ignoring the harness.json artifact in INIT_GITIGNORE (`dist/*` + `!dist/harness.json`). At minimum, make the no-op branch a visible warning (e.g. GitHub `::notice::`) rather than a plain pass.

## 4. 🟠 [major/bug] Anchored parseAwg silently downgrades over-current Errors to Warnings for suffixed gauge strings
**`packages/nerve/src/gauge.ts:26`** · verifier confidence high, severity downgrade

- **Evidence:** New parser: `/^(\d+)\s*AWG$/i.exec(s) ?? /^AWG\s*(\d+)$/i.exec(s) ?? /^(\d+)$/.exec(s)` is fully anchored. The old nerve-rules parser `/(\d+)\s*AWG|AWG\s*(\d+)/i` matched anywhere. Verified: parseAwg("18 AWG TXL") old=18, new=undefined; parseAwg("AWG18 (TEW)") old=18, new=undefined. nerve-rules now re-exports this parser (packages/nerve-rules/src/wire-data.ts:11), so HK-MFG-004, HK-WIRE-004, and HK-MFG-006 all skip such wires.
- **Impact:** A design with `gauge: "18 AWG TXL", currentEstimate: 10` previously failed CI with HK-WIRE-004 Error (ampacity 5.9A exceeded). After upgrade it passes the fail-closed gate (`failOnErrors`) with only an HK-MFG-007 Warning — an over-current wire ships. The wave's tests only acknowledge the intentional "20.5AWG" fix, not this regression for material/spec-suffixed catalog gauge strings.
- **Fix:** Anchor start only with a word boundary: `/^(\d+)\s*AWG\b/i` (this still rejects "20.5AWG" since '.' follows the digits) and keep canonicalGauge strict (rewrite only full matches so "18 AWG TXL" keeps its suffix). Add tests for suffixed gauges pinning that ampacity checks still run.

## 5. 🟠 [major/bug] HK-CONN-017 fires hard Errors from token-matched volt suffixes in non-rail signal names (FB_400V, EN_48V)
**`packages/nerve-rules/src/rules.ts:456`** · verifier confidence high, severity keep

- **Evidence:** connectorVoltageExceeded reports severity Err using `signalNominalVolts(w.signal)`, whose regex `/(?:^|_|\+)(\d+(?:\.\d+)?)\s*V(?:_|$)/i` matches the volt token anywhere. Verified: "FB_400V" → 400, "EN_24V" → 24, "SENSE_48V" → 48. wire-data.ts's own POWER_SIGNAL comment (lines 42-44) states exactly why token-matching "would misclassify enable/sense lines (EN_5V, SENSE_24V)" and deliberately anchors — but the new Error-severity rule uses the unanchored extractor. Seed connector parts ship voltageLimitV (e.g. JST-PH 100V), which this wave activated into HIR.
- **Impact:** A feedback-divider or enable line named FB_400V/EN_48V (actually carrying logic-level volts) landing on a JST-PH pin (voltageLimitV 100) produces an HK-CONN-017 Error that fails the fail-closed CI gate, with no declared data wrong anywhere in the design. Pre-existing HK-ELEC-005 had the same helper but required an explicit wire voltageRating; this rule fires from catalog data alone, greatly widening the false-positive surface.
- **Fix:** Either restrict the inference to rail-shaped names (reuse the anchored POWER_SIGNAL approach: volts only when the V-token is the leading token or the signal matches a rail pattern, excluding EN_/FB_/SENSE_ prefixes), or default HK-CONN-017 to Warning when the voltage is inferred from the name rather than declared.

## 6. 🟠 [major/test-gap] nerve snapshot --ci writes missing snapshots and exits 0 — generated snapshot workflow is green-by-creation forever
**`packages/nerve-cli/src/snapshot.ts:95`** · verifier confidence high, severity keep

- **Evidence:** `if (!existed || update) { mkdirSync(...); writeFileSync(snapPath, actual); written += 1; ...; continue }` — the `ci` flag is never consulted on the missing-snapshot path, and the command returns 0 when drifted === 0. The generated SNAPSHOT_YML (scaffold.ts:152) runs bare `npx nerve snapshot --ci`.
- **Impact:** A consumer repo that runs `nerve setup` but never commits __snapshots__/ gets a permanently green 'Nerve snapshot' check: every CI run freshly writes snapshots into the ephemeral runner, compares nothing, and passes. The advertised byte-exact drawing gate ('any drawing change fails until deliberately refreshed') silently enforces nothing, and nobody is told. Same hole if a single new view/file is added: its snapshot is auto-created in CI and never reviewed.
- **Fix:** In --ci mode, treat a missing snapshot as a failure: `if (!existed) { if (ci) { drifted += 1; io.err(`missing snapshot ${snapPath} — run nerve snapshot locally and commit it`); continue } ... }`, keeping write-on-missing only for local/--update runs.

## 7. 🟠 [major/bug] publish-all.ts keeps publishing dependents after a dependency's publish fails — partial release ships phantom pins
**`scripts/publish-all.ts:70`** · verifier confidence high, severity keep

- **Evidence:** In the per-package loop: `if (r.status !== 0) { console.error(...); failed = true }` then the loop continues to the next package. PACKAGES is ordered dependencies-first, so e.g. a transient npm 5xx while publishing nerve-rules is followed by publishing nerve-compiler…nerve-cli, all of whose tarballs pin nerve-rules@<new-version> which never reached the registry.
- **Impact:** One flaky publish mid-run produces exactly the consumer breakage class this wave exists to retire: packages on npm whose internal deps resolve to a version that does not exist (`npm install @grayhaven/nerve-cli` fails with ETARGET). Related: re-running the tag after a partial release makes already-published packages fail with 'previously published version', so recovery runs stay red. Also note release.yml's tag check only validates packages/nerve's version (lockstep unenforced) — a forgotten bump in any other package triggers this same mid-run failure path.
- **Fix:** In publish mode, abort immediately on the first non-zero exit (process.exit(1) after restoring package.json) so dependents never publish past a failed dependency; add `--tolerate-republish` to the bun publish args so a re-run of the tag is idempotent. Keep the accumulate-and-report behavior for --pack only.

## 8. 🟡 [minor/bug] hirMd walker mis-renders record schemas as '{  }' and emits an empty table for exports
**`packages/nerve-web/scripts/gen-llms.ts:69`** · verifier confidence high, severity keep

- **Evidence:** typeOf(): `if (s["type"] === "object" && isObj(s["properties"])) return "{ " + keys.join(", ") + " }"` — Effect emits records as `{type:"object", properties:{}, additionalProperties:{type:"string"}}` (verified by dumping hirJsonSchema()), so `properties` is a present-but-empty object and the record branch (`"object (record)"`) is unreachable. Shipped public/docs/hir.md shows `| metadata | \`{  }\` | yes |`, `| data | \`{  }\` | no |`, and '## exports' renders a markdown table header with zero rows.
- **Impact:** The generated HIR contract page — the canonical agent-facing schema reference, advertised as 'generated from the live Effect schema; it cannot drift' — documents harness.metadata, diagnostics.data, and the entire exports section as the meaningless type `{  }` or an empty table. Agents reading llms-full.txt cannot learn these are string/unknown records.
- **Fix:** In typeOf(), treat `type==="object"` with zero `properties` keys as a record: `Record<string, ${typeOf(s.additionalProperties)}>` (mapping the unknown-schema `{$id:"/schemas/unknown"}` to `unknown`). In table(), fall back to the `Type: ...` single-line form when `properties` has no keys instead of emitting a rowless table.

## 9. 🟡 [minor/api-contract] release.yml claims npm provenance via id-token: write, but bun publish does not support provenance — nothing is attested
**`.github/workflows/release.yml:22`** · verifier confidence high, severity keep

- **Evidence:** `id-token: write # npm provenance` — but the publish step runs `bun scripts/publish-all.ts` → `bun publish`. Current Bun docs for `bun publish` list --access/--tag/--dry-run/--otp/--auth-type/--tolerate-republish and confirm NPM_CONFIG_TOKEN auth (so the token wiring is fine), but there is no --provenance support and publishConfig.provenance is in publish-all.ts's NPM_KEYS skip-set anyway.
- **Impact:** Packages publish without provenance attestations while the workflow (and anyone auditing it) believes provenance is on — a false supply-chain-security signal on the npm pages. The id-token permission is dead weight that also widens the workflow's OIDC surface for no benefit.
- **Fix:** Either drop `id-token: write` and the provenance comment, or publish via `npm publish --provenance` (npm respects the merged package.json that publish-all.ts already writes) inside the release job where OIDC is available.

## 10. 🟡 [minor/api-contract] HK-MFG-007 warns on every wire of every legitimately-metric design, permanently
**`packages/nerve-rules/src/rules.ts:173`** · verifier confidence high, severity keep

- **Evidence:** unparseableGauge reports Warn for any gauge where `parseAwg(w.gauge) === undefined`, with no distinction between a typo ("18AGW") and a well-formed metric gauge ("0.5mm2") — the exact spelling the WireViz importer passes through via canonicalGauge. The rule also fires even when none of the three named checks (HK-MFG-004/HK-WIRE-004/HK-MFG-006) would apply to the wire (no currentEstimate, no gauge range, no sleeve).
- **Impact:** Every WireViz-imported or metric-authored harness carries one un-fixable Warning per wire forever (the gauge is correct; it just isn't AWG). Teams that gate CI on warnings, or simply read the diagnostics panel, get persistent noise; the only escape is `unparseableGauge: "off"`, which also silences real typo detection.
- **Fix:** Split severities: recognize well-formed metric gauges (`/^\d+(\.\d+)?\s*mm2$/i`) and report them as Info ("metric gauge — AWG tables don't apply"), reserving Warn for strings that match neither AWG nor metric (likely typos). Optionally skip wires where no gauge-based check is even applicable.

## 11. 🟡 [minor/bug] extract-dsl flat() silently corrupts multi-line unions, line comments, and comma-separated members in extracted type spans
**`packages/nerve-web/scripts/extract-dsl.ts:80`** · verifier confidence high, severity keep

- **Evidence:** flat() blindly replaces every newline with '; '. Verified with bun eval: a formatter-wrapped union `| "red"\n| "blue"` flattens to `| "red"; | "blue"` (invalid type syntax); a line comment inside an object type flattens to `{ // keying pins; readonly a: string }` (the comment swallows the rest of the single-line signature); comma-separated members flatten to `a: string,; b: number`. Current nerve/src happens to use newline-separated members with no inline comments, so today's output is clean — but the source style is one dprint union-wrap or one inline `//` comment away from any of these.
- **Impact:** Garbage propagates silently into dsl-meta.json, the dsl.md reference block, the copilot prompt, and editor completions — and the drift guard in tests/generated-docs.test.ts cannot catch it because it compares the committed output to a fresh extraction of the same corrupted text. The failure is invisible until a user or agent reads a broken signature.
- **Fix:** Don't regex raw source text: print the node with the TS printer (`ts.createPrinter({removeComments:true})` + `printer.printNode(EmitHint.Unspecified, node, src)` then collapse whitespace), which normalizes separators and strips comments correctly. Alternatively, at minimum strip `//.*` line comments before flattening and join newlines with ' ' when the preceding char is `,`, `|`, or `{`. Also escape pipes in `p.doc` (only `p.type` is escaped in dslReferenceMd line 139) so a future JSDoc containing '|' doesn't break the table row.

## 12. 🟡 [minor/determinism] Generated workflows' `npm ci || npm install` silently swallows lockfile-drift failures and installs floating deps in the gate jobs
**`packages/nerve-cli/src/scaffold.ts:131`** · verifier confidence high, severity keep

- **Evidence:** All three generated workflows (VALIDATE_YML:131, SNAPSHOT_YML:149, REPRODUCE_YML:176) run `npm ci || npm install`. When package-lock.json exists but is out of sync with package.json, npm ci fails by design — and the fallback npm install resolves fresh (potentially newer) versions and proceeds green.
- **Impact:** The exact error npm ci exists to surface (lockfile drift) is converted into a silent floating install, so the validate/snapshot/reproduce gates run against dependency versions the developer never tested. For a tool whose generated snapshot job promises byte-exact comparison, a transitively bumped renderer dep in CI can cause snapshot reds (or greens) that don't reproduce locally, and nobody sees why because the npm ci failure was eaten by `||`.
- **Fix:** Branch on lockfile presence instead of on failure: `run: |\n  if [ -f package-lock.json ]; then npm ci; else npm install; fi` — npm ci failures then fail the job loudly while fresh repos without a lockfile still work.

## 13. ⚪ [nit/maintainability] gen-llms completion message reports '8 page mirrors' while writing 10; generated-page positions held by magic splice indices
**`packages/nerve-web/scripts/gen-llms.ts:269`** · verifier confidence high, severity keep

- **Evidence:** `console.log(\`generated llms.txt, llms-full.txt, ${PAGES.length + 1} page mirrors\`)` — PAGES.length is 7 and the script writes 7 authored + rules + hir + library = 10 mirrors (confirmed by running it: prints '8 page mirrors', public/docs/ contains 10 .md files). The `+ 1` predates the hir.md and library.md mirrors added this wave. Relatedly, `sections.splice(3,0,…)` / `splice(4,0,…)` / `splice(5,0,…)` hardcode the generated pages' positions relative to PAGES order in three places.
- **Impact:** The count lie misleads anyone eyeballing build logs for missing mirrors (the exact signal the message exists to give). The splice indices mean adding/reordering an authored page before index 3 silently shifts the rules/HIR/library entries to wrong positions in llms.txt and llms-full.txt without any test failing.
- **Fix:** Build one ordered array of {slug, title, content, note?} covering authored and generated pages, derive the writes, llms.txt sections, llms-full.txt parts, and the count from it; log the array length.

---

# Triage of the 34 rate-limited findings (2026-06-08)

The review's verifier phase hit the weekly limit mid-run, leaving 34
reviewer findings un-adjudicated. All 34 were recovered from the
transcripts and triaged against the post-fix code.

## Fixed in the triage wave (17)
- #1 prefixRefs now namespaces twistGroup/shieldGroup
- #6 per-(project,path) debouncer (was dropping cross-file persists)
- #7 Reset hidden for projects with no bundled source (was wiping shared)
- #9/#25 supersession guard now also checks the active tab
- #11 shared project no longer persists to localStorage
- #13 boolean CLI flags no longer consume the next positional
- #16 dev watcher rebuild has .catch (no more unhandled-rejection crash)
- #17 dev server binds 127.0.0.1
- #19 dev serves an auto-reloading error page on first-compile failure
- #21 pinout card width includes the header MPN line
- #23 badge count counts diagnostics, not refs
- #26 formboard true 1:1 mm (removed the 120mm floor)
- #29/#3 hir-shape guard recurses into additionalProperties (records)
- #31/#15 dev watches the config/project root
- #32 renovate: removed invalid "bunInstall" postUpdateOption
- #33 renovate: dropped platformAutomerge (Renovate's own automerge gates on CI)
- #34 tarball smoke scans all dependency blocks

## Already fixed in the first review wave / 6.0.0 (4)
- #2 canonicalGauge metric, #5 anchored parseAwg, #12 snapshot --ci,
  #30 .gitignore dist reproduce

## Refuted (2)
- #4 "canonicalization phantom diff under same schemaVersion" — inherent
  to any compile-output improvement; recompile both sides before diffing.
- #10 "fs-eval/share untested" — false; tests/fs-eval.test.ts and
  tests/share.test.ts both exist.

## Deferred items — now all resolved (2026-06-08)

All 7 were tackled in a follow-up pass:
- #8 share links encode the whole project (v2 multi-file format; v1 still
  round-trips); the /shared route restores every file as a tab.
- #14 loadPlugins honors compileFile's `fresh` — plugin packs reload in
  watch mode.
- #18 config.outputDir resolves relative to the config dir, not cwd
  (bare compile from a subdir lands dist/ next to the config).
- #20 pinout leaders are crossing-free for 3+ row grids (lane offset).
- #22 render-layout.json includes the pinout sheet.
- #24 pinout/faces render named (non-numeric) cavities instead of "—".
- #27 byte-goldens added for the packet zip + share-link encoding.
- #28 the dev watcher path (fs.watch/filter/debounce) is now tested.

(Original deferral notes preserved in git history.)

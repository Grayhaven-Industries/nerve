
## 6.1.0 — 2026-06-08

New validation rules from a first-principles gap review, cross-referenced
against the compiler's existing structural diagnostics (HK-CONN-001/002/003,
HK-WIRE/BRANCH/SPLICE/CABLE) so only genuinely-missing, defect-only checks
ship. All HIR changes are additive optional fields — no `HIR_SCHEMA_VERSION`
bump; old `harness.json` still decodes and golden HIR stays byte-identical.

### Validation — structural integrity
- HK-CONN-019 `contactCountExceedsPinCount`: a connector can't populate
  more cavities than its housing has.
- HK-CONN-020 `cavityLayoutMismatch`: a cavity grid must multiply to the
  pin count.
- HK-MFG-008 `nonPositiveWireLength`: wire length must be greater than zero.
- HK-MFG-009 `branchParentInvalid`: a branch `parent` must exist and the
  branch tree must be acyclic (the compiler validated `path` but never
  `parent`).
- HK-MFG-010 `cableConductorOverflow`: a cable can't carry more wires than
  it has conductors (under-fill is legal — those are spares).
- HK-CONN-015 `reservedPinAssigned` broadened: now also fires on a
  terminal, seal, or landed wire on a reserved pin, not just a signal.

### Validation — electrical / EMC / thermal
- HK-ELEC-006 `orphanedDifferentialHalf`: a CAN/RS-485/USB half with no
  partner anywhere (HK-ELEC-001 only fires once both halves exist).
- HK-ELEC-007 `twistGroupGaugeMismatch`: wires in one twist group should
  share a gauge to limit skew.
- HK-ELEC-008 `emcAggressorVictimShareBranch`: warns when wires marked
  `emcClass: "aggressor"` and `"victim"` share a branch (new `wire.emcClass`).
- HK-ELEC-009 `wireTempBelowAmbient`: a wire's `temperatureRating` must
  meet its branch's `ambientTemperatureC` (new `branch.ambientTemperatureC`).
- HK-ELEC-010 `overcurrentExceedsConductor`: a fuse/breaker rating may not
  exceed the ampacity of the thinnest wire it protects ("the wire becomes
  the fuse"). Shop-parameterizable via the ampacity table.
- HK-CONN-018 `multipleWiresIntoPin` ships **opt-in** (not a built-in):
  differing-gauge wires crimped into one contact. Off by default because
  same-gauge return/power consolidation onto one contact is a valid house
  pattern.

### DSL & HIR
- New `protection("F1", { kind, ratingA, protects })` primitive and
  optional `Hir.protections` collection. The fuse→wire link is explicit
  (`protects: [wireId]`), so the overcurrent rule never infers current-flow
  direction from the undirected wire graph. Exposed in the editor sandbox
  and completions.
- New optional fields: `wire.emcClass`, `branch.ambientTemperatureC`.
- Compiler validates protections: HK-PROT-001 (duplicate id), HK-PROT-002
  (guards an undefined wire); the collection is omitted when empty.

## 6.0.1 — 2026-06-08

Fixes from a multi-agent code review of the 6.0.0 wave (13 confirmed +
34 rate-limited findings, all adjudicated) plus a dogfooding pass.

### Correctness
- Gauge parser regression fixed: spec-suffixed catalog gauges
  ("18 AWG TXL") parse again (over-current errors no longer downgraded);
  canonicalGauge only rewrites whole-string AWG.
- WireViz unitless gauges import as mm², not misread as AWG; HK-MFG-007
  reports metric as Info, not a forever-warning.
- HK-CONN-017 only fires on rail-shaped signal names, at Warning
  severity — no more false errors on FB_400V/EN_48V logic lines.
- `prefixRefs` namespaces twistGroup/shieldGroup so template instances
  don't merge into one group.
- `nerve dev`: watcher rebuild can't crash the process (.catch), binds
  127.0.0.1, watches the config/project root, serves an auto-reloading
  page on first-compile failure; watch mode reloads plugin packs.
- `nerve snapshot --ci` fails on a missing snapshot (no green-by-creation);
  boolean flags no longer swallow the next positional.
- `nerve compile` resolves config.outputDir relative to the config dir.
- publish-all aborts on first failure (no partial release); dropped the
  bun-incompatible --tolerate-republish.
- Web: per-file localStorage debounce (no dropped edits); shared project
  is ephemeral and can't be Reset to empty; compile supersession ignores
  superseded tabs.

### Views & docs
- pinout/faces render named (non-numeric) cavities; pinout leaders are
  crossing-free for 3+ row grids; pinout card width includes the header;
  formboard is true 1:1 (no 120mm floor).
- HIR schema docs: records render as Record<…>; the in-app /docs/hir
  page now exists (was agent-only, 404 in the app).
- Generated rules page: the new rules carry descriptions; the doc
  generator's mirror count is honest.

### Release safety / CI
- Tarball smoke scans all dependency blocks and flags over-packing;
  @grayhaven/nerve-react ships dist only (was leaking src/tests).
- Byte-goldens for the packet zip and share-link encoding.
- render-layout.json includes the pinout sheet.
- renovate.json fixed (the invalid "bunInstall" option made it open zero
  PRs; automerge now gates on CI without needing branch protection).
- release.yml dropped its false npm-provenance claim.

## 6.0.0 — 2026-06-08

The tscircuit ecosystem deep-dive, implemented end to end (24 items,
one commit each — see `git log` for the per-item rationale).

### Release safety
- Pack-and-install tarball smoke test in CI (`scripts/smoke-tarballs.ts`):
  pins, artifact paths, and a real npm-install consumer run. Caught two
  consumer-breaking bugs the day it landed.
- Tag-triggered `release.yml`: publishing happens from a frozen-lockfile
  CI build, never a laptop (requires `NPM_TOKEN` secret).
- Renovate: weekly grouped bumps auto-merged only when the determinism
  suite stays green; bun.lock regenerates in the same PR.

### Validation
- Gauge canonicalization: every AWG spelling compiles to `"20AWG"` in
  HIR; `gauge: "20"` no longer silently disables three safety rules.
  New HK-MFG-007 flags unparseable gauges.
- Diagnostics are renderable data: optional `targets` + `data` on every
  diagnostic; badges on schematic/board/faces anchored at pins, splices,
  branches, and cards; DiagnosticsPanel ref/data chips; error-state
  pixel baselines.
- Connector electrical limits activated: `currentLimitA`/`voltageLimitV`
  now land in HIR and gate wires (HK-CONN-016/017).
- ShopProfile in config: ampacity/OD tables, sleeve capacities, packing
  factor, default bend radius — capability-parameterized HK-MFG rules.
- `computeNets()` in core + lazy `ctx.nets` for custom rules; test plan
  and graph.json share one connectivity computation.
- HIR shape-snapshot guard: additive-optional changes need a deliberate
  refresh; anything else needs a schemaVersion bump. `hirJsonSchema()`
  exported.

### Authoring & docs
- `harnessTemplate` + `prefixRefs` + `mergeFragments`: the PRD §18
  parametric composition surface, collision-free by construction.
- Generated DSL + HIR reference: docs tables, copilot prompt, and editor
  completions all extract from source (the old dsl.md documented three
  props that never existed); drift fails CI.
- `AutocompleteString<T>` for gauges, colors, part specs; lenient
  `part()` normalization ("JST PH-3", "dt06-4s") with a pinned error
  contract; `partInfo()` + generated Part Library docs page +
  `nerve parts [--json]`.

### Views
- New pinout-card view: per-cavity elbow leaders (crossing-free, tested)
  with wire/gauge/terminal/seal rows — `nerve render --view pinout`,
  packet `pinout.svg`, html viewer.
- Deterministic `textWidth()`: boxes/legends/flags size to measured
  text; the faces legend no longer silently truncates past 8 rows.
- Board lays out mm-native (1 unit = 1 mm); formboard windows it with
  no rescale; `scaleDrawing` output is float-artifact-free.

### DX
- `nerve dev`: watch → fresh recompile → live browser preview at
  / /board /faces /pinout with fingerprint-poll reload and fail-soft
  errors. (compileFile gains `fresh` — the jiti cache trap.)
- `nerve snapshot [--update] [--ci]`: committed byte-exact visual
  snapshots per harness file, pixel-diff artifacts in CI.
- `nerve init` scaffolds a complete runnable project; `nerve setup`
  writes validate/snapshot/byte-reproducibility CI workflows.
- `config.entry`/`config.harnessFiles`: bare `nerve compile` works;
  `config.exports` toggles are real now.

### Web
- Multi-file projects: fsMap evaluation in the worker (NodeNext-style
  resolution, cycle chains), file tabs with compile-what-you-look-at —
  motor-controller's variants/long.ts opens and renders the long SKU.
- Zero-backend share links: source gzipped into the URL fragment,
  decoded client-side; a share link is a bug report.

## 0.5.2 — 2026-06-07
- `nerve export` loose files now derive from the packet itself — the
  hand-maintained list had silently drifted (no connector faces, HTML
  viewers, or JSON satellites in loose output; the zip was complete).
  One source of truth; loose output now matches the zip exactly.
- Caught by the registry smoke test after the 0.5.1 publish.

## 0.5.1 — 2026-06-07
**Fixes a broken install for every 0.5.0 package with internal deps.**
`bun publish` rewrites `workspace:*` from bun.lock, and the 0.5.0 bump
shipped with a stale lockfile — so every internal dependency was pinned
to an unpublished `0.4.0` (only `@grayhaven/nerve` itself installed).
0.5.1 republishes everything with correct pins, adds a release-integrity
test (lockfile workspace versions must match package.json versions), and
ships the new per-package READMEs. Found by dress-rehearsing the full
production lifecycle against the published registry. No code changes.

## 0.5.0 — 2026-06-07
(Supersedes the unpublished 0.4.0 tag; both changelogs ship together.)

### tscircuit interop (PRD §37, both directions)
- `importTscircuitPinout`: validate the harness against a tscircuit
  board's Circuit JSON (`nerve contract --against board.circuit.json`) —
  catches swapped pins across the PCB/harness seam.
- `exportTscircuitCircuitJson` + `nerve contract --format circuit-json`:
  hand tscircuit the harness side. Round-trip proven in tests.
- `validateContract` is mating-aware: a contract naming the harness
  part's `matingMpn` (what a board file contains) is correct, not a
  mismatch. `matingMpn` now flows into HIR.

### New package: @grayhaven/nerve-react (experimental)
- JSX authoring with a 2KB custom runtime (no React): `<Harness>`,
  `<Connector>`, `<Wire from="J1.1">` are pure function application over
  the typed DSL. Compiles to byte-identical HIR vs the function style.

### Library ergonomics
- Compact part specs: `part("microfit-2x8")`, `part("dt-4s")`,
  `part("xt60-f")` — 26 specs across all families, raw-MPN passthrough,
  unknown specs fail with the full menu.

## 0.4.0 — 2026-06-07
### Connector face views (PRD §9.5.2)
- New deterministic exporter: per connector, FRONT (mating side, mirrored) and
  REAR (wire side) cavity views with population state, wire colors, reserved
  cavities, orientation markers, and a pin/signal/gauge legend. In the packet
  (`connector-faces.svg` + a PDF page), the web workspace (Connectors tab with
  interactive HTML download), and `nerve render --view faces`.

### Rules (17 -> 21, + provider conflicts)
- `HK-ELEC-005` wire voltage rating below the signal's nominal volts.
- `HK-CONN-015` signal assigned to a part-reserved cavity.
- `HK-MFG-005` branch breakout tighter than its `minBendRadius`.
- `HK-MFG-006` estimated bundle diameter exceeds sleeve capacity (per-AWG
  insulated-OD table, hex-pack estimate).
- `HK-LIB-001` part-data providers disagree on load-bearing fields.

### Part-data providers + library (PRD §42/§30)
- `PartProvider` / `staticProvider` / `resolvePart` in `@grayhaven/nerve`:
  priority resolution with conflict diagnostics, never silent overwrites.
- `@grayhaven/nerve-connectors`: 5 families / 21 parts (Molex Micro-Fit 3.0
  incl. new 16-circuit housings, Mega-Fit, JST PH, JST XH, TE Deutsch DT,
  AMASS XT60) with cavity layouts, mating pairs, gauge ranges, provenance.
  `allParts` + `nerveConnectorsProvider` exports. Examples now import their
  parts from the library.

### HIR satellites + PNG (PRD §9.3/§9.8)
- `graph.json` (nodes/edges/nets), `render-layout.json` (DrawingIR per
  sheet), `diagnostics.json`, and JSON twins of the BOM/cut-list/label CSVs,
  all in the packet. `nerve render --format png`.

### Schema (additive)
- `ConnectorPart.reservedPins`, `BranchProps.minBendRadius`; `cavityLayout`
  now flows through to HIR connectors.

### Web
- Cross-view traceability: click any rendered object for a persistent
  highlight + inspector (with View Source jump); diagnostics rows select
  their target; workspace search across wires/signals/connectors/pins.
- AI copilot now uses OpenAI (gpt-5.5, Responses API), browser-direct.

## 0.3.0 — 2026-06-07
### Rules
- HK-ELEC-001 now recognizes bus-indexed differential pairs: `CAN1_H`/`CAN1_L`,
  `MOTOR_CAN2_H` pair correctly (previously skipped silently — untwisted
  multi-bus CAN shipped without a diagnostic).
- Ground classification is token-aware: `AGND`, `DGND`, `PGND`, `MOTOR_GND`
  classify as grounds, eliminating false HK-ELEC-003 errors. Power matching
  deliberately stays anchored so enable/sense lines (`EN_5V`) are not
  misclassified as rails.
- New numeric code API: `ruleCodeNumber` / `ruleCodeFromNumber` /
  `ruleCategory` / `codesToNumbers` / `RULE_CATEGORY_BANDS` — a derived
  (zero-maintenance) numeric view of `HK-*` codes for sorting, bitsets, and
  compact storage. String codes remain the public contract.
- Test suite: 22 -> 96 rule tests including property-based invariants
  (~1,750 generated designs per run via fast-check).

### Exporters
- Schematic and board SVGs carry deterministic, sorted `data-*` attributes
  (`data-wire`, `data-connector`, `data-pin`, `data-splice`): artifacts are
  now machine-addressable for tooling and interactive viewers. `DrawItem`
  types gain an optional `data` record.

## 0.2.1 — 2026-06-06
### Tree-shaking
- `@grayhaven/nerve` and `@grayhaven/nerve-exporters` declare `sideEffects: false`:
  bundlers now drop unused exporters (notably the pdf-lib manufacturing-packet
  machinery, ~418KB) from consumer bundles when only SVG/CSV/test-plan paths
  are imported. Verified: a worker importing only `schematicSvg`/`boardSvg`/
  `generateTestPlan` shrinks from 842KB to 41KB.
- Effect-free HIR values (`endpointLabel`, `isPinEndpoint`, `refs`,
  `HIR_SCHEMA_VERSION`) moved to a pure internal module so consumers that never
  decode/encode HIR no longer retain the Effect Schema runtime. Public API
  unchanged — everything still exports from the package root.

## 0.2.0 — 2026-06-06

The expansion release: from manufacturing packets to the full engineering →
manufacturing → test → feedback loop.

### Domain & compiler
- **Splices and cables** (PRD §9.2): wire endpoints are `PinRef | SpliceRef`;
  `splice()`/`cable()` builders; nets computed across splices; splice-verification
  tests; `HK-SPLICE-*`/`HK-CABLE-*` checks
- **Variants** (§8.4): `variant(base, mods)` with add/remove/override and
  `metadata.variantOf` lineage
- **Per-pin terminals and seals** (§30): `connector(..., { terminals, seals })`
  flow into HIR pins and BOM lines; compatibility rules `HK-CONN-012/013/014`;
  `requireApprovedParts` org-approval gate; `PartProvenance` + crimp/insertion
  tooling on parts
- **Plugin SDK** (§40): `definePlugin` rule packs loaded from `config.plugins`,
  HIR schema-version gating (`HK-PLUGIN-001`)
- **Verified library data**: Molex Micro-Fit 3.0 verified against catalog
  sources (20–30 AWG — the family does not accept 18 AWG; 8.5 A / 600 V)

### Manufacturing outputs
- **Bill of Process** (§28): sequenced operations with workstations, tooling,
  labor estimates, HIR-linked targets — `bop.csv`/`bop.json` + PDF page
- **Costing & quotes** (§29): `CostModel` in config; material + labor + scrap +
  yield rollup; long-lead / NRND / unpriced flags; `quoteDiff`; `nerve quote`
- **Formboard 1:1 tiling** (§33): mm-true SVG sheets with fiducials, stitch
  borders, and a calibration ruler — `nerve render --view formboard`
- **Shop-floor adapters** (§31): typed `MachineAdapter` boundary; generic
  cut/strip CSV, label-printer CSV, continuity-tester JSON — `nerve machine`
- **Engineering analysis** (§34): resistance, voltage drop, bundle diameters,
  splice current aggregation, weight totals — `nerve analyze`

### Workflow
- **WireViz adapter** (§27.2): YAML import with diagnostics for unmapped
  concepts; export with round-trip tests — `nerve import`
- **Interface contracts** (§37): connector pinout contracts, swapped-pin
  detection (`HK-IFC-*`) — `nerve contract`
- **ECO/releases** (§35): HIR fingerprint, impact + change-risk score vs the
  previous release, fail-closed — `nerve release`
- **Build Records** (§36): as-built evidence with measured-resistance verdicts
  replayed against the test plan — `nerve record`
- **Technician redlines** (§39): HIR-targeted feedback, accept/reject with
  retained reasons, accepted → `variant()`-shaped structured patch —
  `nerve redline`

### Web editor
- In-browser authoring (§9.6): Source tab with worker-sandboxed TS compile
- Board tab; three demo projects including the 22-connector robot platform
- Grayhaven monochrome brand

## 0.1.0 — 2026-06-06

Initial release: TypeScript DSL → deterministic compiler → versioned HIR →
validation rules with stable `HK-*` codes → schematic/board SVG → BOM, cut
list, label schedule, continuity test plan → PDF manufacturing packet →
`nerve` CLI → web editor.

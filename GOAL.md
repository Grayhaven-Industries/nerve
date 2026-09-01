# Grayhaven Nerve — Project Goal

> Source PRD: `~/Downloads/grayhaven_nerve_prd.md`
> Stack validated against current docs (Context7, 2026-06): Effect (Layer services, Data.TaggedError, Schema), TanStack Router v1 (file-based routing via `@tanstack/router-plugin/vite`), TanStack Query v5, Vite.

## North Star

A small hardware team can replace their spreadsheet-plus-drawing workflow for one real
harness: author it in TypeScript, compile it, fix validation errors, and hand the
generated packet to a technician. (PRD §25 "critical product test", §26 Definition of Done.)

## The Goal (first milestone — vertical slice)

**Compile the PRD's example `motor-controller-harness` end-to-end:**

```
TypeScript DSL  →  HIR (harness.json)  →  validation diagnostics  →  SVG schematic
                                        →  bom.csv, cut-list.csv, labels.csv, tests.csv
```

…runnable two ways:

1. `nerve compile ./src/main.harness.ts` — CLI, deterministic output, nonzero exit on errors.
2. A Vite/React web editor showing the schematic + data tables for the same project.

### Success criteria — ALL MET ✅

- [x] The PRD §9.1 example harness compiles unmodified (`examples/motor-controller`, golden fixture + snapshot).
- [x] HIR is an Effect `Schema`-validated, versioned JSON document (`schemaVersion: "0.1.0"`) — round-trip tested without executing user code.
- [x] 13 built-in validation rules + 6 structural checks, all with stable `HK-*` codes (`@grayhaven/nerve-rules`, severity-configurable, custom `rule()` API).
- [x] Same input ⇒ byte-identical HIR, CSVs, SVG, and zip (determinism tests at every layer; authoring order never changes output).
- [x] SVG schematic renders connectors, pins, wires, colors, gauges, twist annotations, and error highlighting from HIR only.
- [x] CSV exporters for BOM, cut list, label schedule, continuity test plan (PRD §20 columns; §9.9 plan covers every wired net).
- [x] Web editor: `/projects/$projectId/{diagram,bom,cut-list,labels,tests}` routes, TanStack Table views, diagnostics panel, Web Worker compile — verified in Chrome.

## Architecture commitments (from PRD §10 + current library docs)

- **Monorepo** (pnpm workspaces): `@grayhaven/nerve` (domain + HIR types), `nerve-compiler`,
  `nerve-rules`, `nerve-exporters`, `nerve-cli`, `nerve-web`.
- **Effect**: services as `Effect.Service`/Layers (`CompilerService`, `ValidationService`,
  `ExportService`…), typed errors via `Data.TaggedError` (`CompileError`, `ValidationError`,
  `ExportError`), HIR codec via Effect `Schema` (`Schema.validate` / decode at every boundary).
- **Web**: Vite + React, file-based routing with `tanstackRouter({ target: 'react' })` plugin,
  `createRouter` with `queryClient` in context, `defaultPreload: 'intent'`; compile runs in a
  Web Worker, TanStack Query manages worker job state; TanStack Table for all data views.
- **Renderers consume HIR, never user TypeScript** (PRD §6.3, §9.3).

## Explicitly deferred (don't build yet)

PDF packet, harness-board/nailboard view, WireViz import, variants/diff, BOP/costing,
Registry, Build Record, AI features, plugin SDK. (PRD §7.2, §25 — wedge first.)

## Milestones

1. ✅ **M0 — Skeleton**: pnpm monorepo, core domain types + DSL builders, HIR Schema, golden fixture from PRD example.
2. ✅ **M1 — Compiler + rules**: deterministic HIR emit, 13 rules, diagnostics with stable codes, CLI `compile`/`validate`.
3. ✅ **M2 — Exports**: CSV BOM/cut-list/labels/test-plan, SVG schematic, zip packet, CLI `render`/`export`/`inspect`/`init`.
4. ✅ **M3 — Web editor**: project view, schematic canvas, data tables, diagnostics panel, worker-based compile.

**First milestone complete (2026-06-06).**

5. ✅ **M4 — Definition-of-Done sprint** (2026-06-06): every PRD §26 item now met.
   - PDF manufacturing packet (DoD #6, §9.8): cover, schematic + board pages, BOM/cut-list/labels/tests tables, assembly instructions (§20.4) — byte-deterministic via pdf-lib with pinned metadata.
   - Harness-board/nailboard view (DoD #3, §9.5.3): branch trunks, endpoints, sleeve/length callouts, label flags — in SVG, PDF, web Board tab, and `nerve render --view board`.
   - `nerve diff` (DoD #9, §21): connectors/pinouts/wires/branches/labels/BOM changes across harness.json, `.harness.ts`, or revision dirs; git-style exit codes; `--json`.
   - DrawingIR (§27.4): one deterministic layout feeding both SVG and PDF renderers.

6. ✅ **M5 — Splice + cable depth** (§9.2): SpliceRef endpoints, cable grouping, HK-SPLICE/HK-CABLE checks, splice symbols in schematic/board, splice-verification tests, net computation across splices; `examples/sensor-splice` fixture.
7. ✅ **M6 — Variants** (§8.4): `variant(base, mods)` with add/remove/override, lineage metadata, diff-visible differences, consistent validation; `variants/long.ts` example.
8. ✅ **M7 — WireViz adapter** (§27.2): YAML subset import with diagnostics for unmapped concepts, export with round-trip test, fixture corpus, `nerve import` / `nerve export --target wireviz`.
9. ✅ **M8 — In-browser authoring** (§9.6): Source tab (CodeMirror), sucrase TS compile in the worker sandbox, edits update every tab live.
10. ✅ **M9 — Publish prep**: tsup `dist` builds with types for all 7 library packages, GitHub Actions CI, Apache-2.0 license (user-confirmed 2026-06-06) + NOTICE, `publishConfig` ready (packages stay `private: true` until a deliberate publish).

**Roadmap complete (2026-06-06).** Post-roadmap shipped same day: dogfood example
(`examples/robot-platform`, 22 connectors / 65 wires, validates clean), TensorPoint Spec
brand applied to the web editor, live deploys (demo: nerve-demo.vercel.app, landing:
nerve-demo.vercel.app, with nerve-site aliasing the same app), and the first expansion wedge — **§28 Bill of Process**
(Manufacturing Operations IR: sequenced cut/twist/crimp/populate/splice/sleeve/label/
inspect/test operations with workstations, tooling, labor estimates, HIR-linked targets;
bop.csv/bop.json in every packet + PDF page).

Also shipped (2026-06-06, second expansion pass): **§29 costing/quotes** (CostModel in
config, material+labor+scrap+yield quote with long-lead/lifecycle/unpriced flags, quote
diff, `nerve quote`, quote.csv/json/PDF page) and **§30 registry depth** (per-pin
terminals/seals into HIR + BOM, HK-CONN-012/013/014 compatibility rules, part provenance
+ crimp/insertion tooling on library data, `requireApprovedParts` org-approval rule).

Third expansion pass (2026-06-06): **§34 engineering analysis** (per-wire resistance +
voltage drop, branch bundle diameters, splice current aggregation, harness length/weight
totals; `nerve analyze`), **§31 shop-floor adapters** (typed MachineAdapter boundary with
HIR-schema declaration + structured diagnostics; generic cut/strip CSV, label printer CSV,
continuity tester JSON; `nerve machine <id>`), **§37 interface contracts**
(`nerve contract --connector J1 [--against pcb.json|pinout.csv]` — swapped-pin detection
between PCB and harness, HK-IFC-* codes).

Fourth expansion pass (2026-06-06) — the workflow tier: **§33 formboard 1:1 tiling**
(mm-true SVG sheets with fiducials, calibration ruler, stitch borders; `nerve render
--view formboard`), **§35 ECO/releases** (HIR fingerprint, impact + change-risk score vs
previous release, fail-closed; `nerve release`), **§36 Build Records** (as-built evidence
with measured-resistance verdicts replayed against the test plan; `nerve record`),
**§39 redlines** (HIR-targeted technician feedback, accept/reject with retained reasons,
accepted → variant()-shaped structured patch; `nerve redline add/resolve`), **§40 plugin
SDK** (`definePlugin` rule packs loaded from config.plugins with HIR schema-version
gating, HK-PLUGIN-001 on mismatch).

Verification pass (2026-06-06): Micro-Fit 3.0 library data verified against Molex
catalog sources and stamped `verified` — and the verification caught that **the PRD's own
§9.1 example specifies 18AWG into a housing whose contact series max out at 20AWG**
(43030-0007: 20–24, 43030-0010: 26–30, RMF 46235: 20–24; 8.5A/600V). The golden fixture
carries one sanctioned deviation (20AWG) documenting this. A real-Grayhaven-harness
pipeline run still needs actual hardware specs from the team — none exist in local repos.

PRD coverage is now effectively complete (§32 label depth and §42 part-data providers
remain as data-model deepening). The "remaining ideas" that used to close this file —
registry (§30), shop-floor adapters (§31), formboard printing (§33), engineering analysis
(§34), ECO/release (§35), Build Record (§36), interface contracts (§37), redlines (§39),
plugin SDK (§40) — have all since shipped.

## Where the roadmap lives now

This file is a delivery record and stops here. What to build next is no longer a
list of features; it is [the rule coverage page](./docs/content/docs/reference/rule-coverage.mdx), which
states every failure mode as a row, the information needed to decide it as a
column, and what Nerve does and does not check in each cell. That turns the
question into arithmetic instead of preference, and its most useful column is
the one naming what no design representation can decide at all.

The short version as of the terminal and pinout work: the netlist tier is
exhausted, so every remaining gain carries a data-acquisition cost rather than
a coding one.

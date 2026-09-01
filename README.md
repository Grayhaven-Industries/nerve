# Grayhaven Nerve

**The open harness verification compiler.**

[![CI](https://github.com/tylergibbs1/nerve/actions/workflows/ci.yml/badge.svg)](https://github.com/tylergibbs1/nerve/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40grayhaven%2Fnerve)](https://www.npmjs.com/package/@grayhaven/nerve)
[![license](https://img.shields.io/badge/license-Apache--2.0-white)](./LICENSE)

A harness review is a schematic PDF, a wire list in a spreadsheet, and a
connector datasheet in somebody's downloads folder.

The wire list says J1 pin 3 is CAN_H. The datasheet says pin 3 is CAN_L. Both
documents are internally consistent. Both have been signed. Nothing in that
process is capable of noticing.

Nerve compiles the harness instead:

```text
existing data or Nerve source
  → versioned HIR
  → stable HK-* findings
  → review report, diffs, drawings, test plans, and manufacturing artifacts
```

```text
error  connector:J1.pin:1  HK-MFG-004
  Wire W1 uses 10AWG but connector J1 accepts 24AWG to 32AWG.
```

That range came from the connector's data, not from the design's claims about
itself. A wire is judged against the contact that crimps it. A pin is judged
against the pinout its part fixes.

![Nerve reviews a 22-connector harness: no errors, a sleeve at 95% fill, and a pinout swap caught against the part](./docs/assets/nerve-demo.gif)

The demo runs against the bundled `examples/robot-platform`. It calls the real
CLI, so the recording fails when the output no longer matches. The tape is
[`docs/assets/nerve.tape`](./docs/assets/nerve.tape).

The same harness in the browser workspace. The Margins tab reports how close
each passing check came to its limit. The Provenance tab reports what the
verdict rests on.

![The Nerve workspace on the Margins tab: 53 measurements, none over budget, the spine sleeve at 95.2% fill](./docs/assets/nerve-web-demo.gif)

The TypeScript API is one input format, not an adoption requirement. Nerve
imports WireViz, mapped CSV wire lists, and mapped Excel wire lists. It also
imports connector contracts from KiCad boards, pinout CSV, tscircuit, and its
own JSON format.

[Harness modeling principles](./docs/content/docs/(index)/concepts/harness-modeling.mdx)
explains the domain boundaries and the owner of each check, and
[rule coverage](./docs/content/docs/reference/rule-coverage.mdx) says what the
rule set is as a fraction of the problem.

Full documentation: [docs.grayhavenindustries.com](https://docs.grayhavenindustries.com).
The site is the `docs/` directory in this repository.

## What it checks

53 built-in consistency, electrical, component, and manufacturing checks, each
with a stable `HK-*` code you can gate a pull request on or cite in a waiver.
Four properties matter more than the count:

- **Margins, not just verdicts.** A wire at 99% of its derated ampacity and a
  wire at 40% both pass. They are not the same design, so a report says how
  close each passing check came to its limit.
- **Measured, not asserted.** The length of a routed branch is computed from
  its centerline rather than read from a number somebody typed.
- **Accounted for.** Every mapped CSV or Excel row comes back as accepted or
  rejected, with row and column diagnostics. Nothing is silently dropped.
- **Reproducible.** The same source produces byte-identical drawings, tables,
  PDF and zip, so a revision reads as a diff instead of a re-read.

## What it will not claim

Nerve does not certify a harness. It does not claim compliance with an industry
standard or with a customer standard. A report records the checks that ran
against the facts the design supplied, and says so inside the report.

Two commands exist only to tell you where you actually stand:

```bash
nerve parts ph-2     # which checks this part's data enables, and which stay inactive
nerve provenance     # which limits a clean report rests on that nobody has verified
```

```text
1 part(s) supply a limit a rule judges against without being verified.
A clean report is only as good as these.
```

[Rule coverage](./docs/content/docs/reference/rule-coverage.mdx) counts the rule
set as a fraction of the problem, by failure mode, including the failure modes
that no design representation can catch. Read it before a clean compile becomes
an argument.

## Product and factory foundations

- **Approved electrical test authority.** A caller-authored, plan-matched `TestSpecification` must be approved before a generic tester program carries acceptance limits or an ingested measurement receives a pass or fail verdict. Build records retain the approved specification, measurements, raw-result references and hashes, tester and calibration identity, as-built lengths, and crimp-process evidence.
- **Headless shop-floor execution.** `@grayhaven/nerve-platform` models released work orders and replays immutable unit events for required evidence, step completion, deviation disposition, rework, reopening, and final closure. Callers supply every identity and timestamp; unit starts require authoritative progress or build context, and the caller owns atomic reservation and persistence.
- **Product-family configuration.** A family can define ordered options, requirements, exclusions, and deterministic patches. Nerve rejects unknown or conflicting selections, supports bounded enumeration of valid combinations, and lets variants add, override, or remove protection devices.
- **Supply snapshots.** Core supply records retain provenance, lifecycle, approval, alternates, compatible tooling and processes, availability, lead time, minimum order quantity, and price breaks. Canonical snapshots keep unresolved requests and provider conflicts visible.
- **Standards and factory interoperability.** `@grayhaven/nerve-interop` provides exact-authority standards profiles, a loss-aware normalized VEC 2.2 subset, transport-neutral OPC UA 40570 cut/strip/crimp/seal job and result mappings, and caller-parameterized automation and high-voltage fact checks.

These APIs describe software records and mappings. They do not certify
standards conformance, operate or authenticate tester hardware, or prove that a
physical process occurred. The Cirris Easy-Wire-style exporter remains an
explicit experimental compatibility export and is excluded from built-in
production adapter discovery. The shop-floor layer is a headless reducer, not
a user interface, MES service, or device gateway. The VEC adapter is not a full
XML parser or validator, and the OPC mapping does not include an OPC UA
transport client.

The browser workspace at [nerve.grayhavenindustries.com](https://nerve.grayhavenindustries.com) shows the examples and the authoring API.

## Review a harness

```bash
npm install @grayhaven/nerve @grayhaven/nerve-connectors @grayhaven/nerve-cli

npx --package=@grayhaven/nerve-cli nerve review ./src/main.harness.ts
# dist/review-report.json

npx --package=@grayhaven/nerve-cli nerve eval ./eval-corpus/manifest.json
# dist/eval/eval-report.json
```

`review-report.json` includes the harness revision, HIR schema, content fingerprint, tool and rule versions, findings, and limitations. The command exits nonzero when the report contains errors.

## Import an existing wire list

Create an explicit column map:

```json
{
  "wireId": "Wire",
  "fromConnector": "From",
  "fromPin": "From Pin",
  "toConnector": "To",
  "toPin": "To Pin",
  "signal": "Signal",
  "gauge": "Gauge",
  "color": "Color",
  "length": "Length",
  "lengthUnit": "Unit"
}
```

Then run:

```bash
npx --package=@grayhaven/nerve-cli nerve import ./wire-list.xlsx \
  --sheet "Wire List" \
  --map ./columns.json \
  --id my-harness \
  --out ./migration
```

The output is a complete editable project: `src/main.harness.ts`, `nerve.config.ts`, `package.json`, `tsconfig.json`, the reusable normalized `column-map.json`, `harness.json`, `diagnostics.json`, and `import-report.json`. The CLI immediately compiles the emitted source before reporting success. Unknown connector parts are marked `unverified`; missing signals stay missing; and every accepted or rejected source row remains visible in the report with row/column diagnostics.

WireViz projects can be reviewed directly, including projects that keep reusable YAML anchors in a separate prepend file:

```bash
npx --package=@grayhaven/nerve-cli nerve import ./harness.yml \
  --prepend-file ./templates.yml \
  --id my-harness \
  --out ./migration
```

The adapter resolves named template instances, ranges, pin labels, wire labels, unique color references, and explicit length units. Concepts that cannot be represented without loss remain visible as `HK-WV-001` diagnostics.

## Compare a board connector

```bash
npx --package=@grayhaven/nerve-cli nerve contract ./src/main.harness.ts \
  --connector J1 \
  --against ./controller.kicad_pcb \
  --component J7 \
  --out ./dist/contracts
```

The adapter reads footprint reference properties, pad-to-net assignments, and explicit no-connect pads from a KiCad 6+ board file. It writes `contract-J1.normalized.json` with the board revision, ECAD component, generator/version, and a content fingerprint so the normalized input can be reviewed or committed. It does not infer graphical connectivity from a schematic.

## Authoring quick start

```bash
npx --package=@grayhaven/nerve-cli nerve init .
npx --package=@grayhaven/nerve-cli nerve compile ./src/main.harness.ts
npx --package=@grayhaven/nerve-cli nerve export ./src/main.harness.ts
```

```ts
import { connector, harness, wire } from "@grayhaven/nerve"
import { MolexMicroFit } from "@grayhaven/nerve-connectors"

const j1 = connector("J1", MolexMicroFit["43025-0800"], {
  pins: { 1: "VBAT_24V", 2: "GND", 3: "CAN_H", 4: "CAN_L" }
})

// See examples/motor-controller for a complete design.
```

## Questions you probably have

**"We already use WireViz."** Good. Point Nerve at the YAML, including a project
that keeps reusable anchors in a separate prepend file. Anything that cannot be
represented without loss becomes an `HK-WV-001` diagnostic instead of quietly
disappearing, and `nerve export --target wireviz` translates back.

**"Our harnesses aren't complicated enough for this."** The errors that cost
money usually are not complicated. A swapped pair. A gauge at the edge of a
contact's range. A wire that arrives 30mm short of its bracket.

**"I'm not rewriting our wire lists in TypeScript."** Don't. `nerve import`
takes CSV and Excel through a column map you write, and emits a complete
editable project. The TypeScript API is one input format, not an adoption
requirement.

**"This is just a linter."** It is also the packet. One compile writes the
drawings, BOM, cut list, labels, bill of process, continuity tests, assembly
instructions and PDF build book, byte-identically.

**"How do I know the checks are any good?"** You do not have to take it on
faith. [Rule coverage](./docs/content/docs/reference/rule-coverage.mdx) counts
what the rule set is and is not, and `nerve provenance` names the part data a
clean report currently depends on.

**"Would our designs leave our machines?"** No. The CLI runs locally and the
browser workspace compiles in the browser. Apache-2.0.

## Packages

| Package | Purpose |
| --- | --- |
| [`@grayhaven/nerve`](./packages/nerve) | Domain model, authoring API, product-family configuration, supply snapshots, versioned HIR, diagnostics, rules API, and deterministic `compileDesign` |
| [`@grayhaven/nerve-compiler`](./packages/nerve-compiler) | Trusted local `.harness.ts` loading, configuration, plugins, and fail-closed validation |
| [`@grayhaven/nerve-rules`](./packages/nerve-rules) | 53 generic built-in rules with stable diagnostic codes |
| [`@grayhaven/nerve-importers`](./packages/nerve-importers) | Deterministic CSV and Excel wire-list migration with source-row accounting |
| [`@grayhaven/nerve-eval`](./packages/nerve-eval) | Provenance-aware evaluation and stable review-report primitives |
| [`@grayhaven/nerve-exporters`](./packages/nerve-exporters) | Review, drawing, manufacturing, release, contract, approved test-specification, generic tester, and build-record artifacts |
| [`@grayhaven/nerve-wireviz`](./packages/nerve-wireviz) | WireViz YAML import and export |
| [`@grayhaven/nerve-connectors`](./packages/nerve-connectors) | 21 connector housings and 9 crimp terminals with provenance fields, plus a bundled provider |
| [`@grayhaven/nerve-platform`](./packages/nerve-platform) | Review and release governance plus headless, event-sourced work orders and serialized unit-build evidence |
| [`@grayhaven/nerve-interop`](./packages/nerve-interop) | Exact-authority standards profiles, normalized VEC 2.2 subset exchange, transport-neutral OPC UA 40570 mappings, and automation/high-voltage fact checks |
| [`@grayhaven/nerve-cli`](./packages/nerve-cli) | Local and CI workflows for import, review, evaluation, validation, export, and approved-specification tester evidence |
| [`@grayhaven/nerve-web`](./packages/nerve-web) | Browser workspace, examples, and documentation |
| [`@grayhaven/nerve-react`](./packages/nerve-react) | Experimental JSX authoring runtime |

## Verification

```bash
bun install
bun run test
bun run typecheck
bun run build
```

The repository also contains property, visual regression, mutation, browser, and accessibility tests. See [the historical delivery record](./GOAL.md) and [the changelog](./CHANGELOG.md) for implementation history.

Licensed under Apache-2.0.

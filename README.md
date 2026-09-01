# Grayhaven Nerve

**The open harness verification compiler.**

[![CI](https://github.com/Grayhaven-Industries/nerve/actions/workflows/ci.yml/badge.svg)](https://github.com/Grayhaven-Industries/nerve/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40grayhaven%2Fnerve)](https://www.npmjs.com/package/@grayhaven/nerve)
[![license](https://img.shields.io/badge/license-Apache--2.0-white)](./LICENSE)

A harness review often uses a schematic PDF, a wire-list spreadsheet, and a connector datasheet.

The wire list can identify J1 pin 3 as CAN_H. The datasheet can identify the same pin as CAN_L.
Each document can be internally consistent. A document review can miss the conflict.

Nerve compiles the harness data and finds conflicts across its sources:

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

The connector data supplies this range. The design does not judge its own claims.
Nerve compares each wire with its contact. It compares each pin with the pinout for its part.

![Nerve reviews a 22-connector harness: no errors, a sleeve at 95% fill, and a pinout swap caught against the part](./docs/assets/nerve-demo.gif)

This demo uses the bundled `examples/robot-platform` project. It calls the real CLI.
If the output changes, the recording fails. The source tape is [`docs/assets/nerve.tape`](./docs/assets/nerve.tape).

The browser workspace uses the same harness. The Margins tab shows how close each passing check is to its limit.
The Provenance tab shows the data that supports the result.

![The Nerve workspace on the Margins tab: 53 measurements, none over budget, the spine sleeve at 95.2% fill](./docs/assets/nerve-web-demo.gif)

Use the browser workspace at [nerve.grayhavenindustries.com](https://nerve.grayhavenindustries.com).
Read the full documentation at [docs.grayhavenindustries.com](https://docs.grayhavenindustries.com).

## Quick start

Install the packages:

```bash
npm install @grayhaven/nerve @grayhaven/nerve-connectors @grayhaven/nerve-cli
```

Review a harness:

```bash
npx --package=@grayhaven/nerve-cli nerve review ./src/main.harness.ts
# dist/review-report.json
```

Run the evaluation corpus:

```bash
npx --package=@grayhaven/nerve-cli nerve eval ./eval-corpus/manifest.json
# dist/eval/eval-report.json
```

The review report contains the harness revision, HIR schema, content fingerprint, tool versions, rule versions, findings, and limitations.
If the report contains errors, the command returns a nonzero exit code.

## Input formats

The TypeScript API is one input format. You do not have to rewrite existing harness data.

Nerve imports these formats:

- WireViz projects
- Mapped CSV wire lists
- Mapped Excel wire lists
- Connector contracts from KiCad boards
- Pinout CSV
- tscircuit
- Nerve JSON

Nerve also exports WireViz projects.

## What Nerve checks

Nerve has 53 built-in consistency, electrical, component, and manufacturing checks.
Each check has a stable `HK-*` code for pull-request gates and waivers.

Four properties define the results:

- **Margins, not only verdicts.** A wire at 99% of its derated ampacity is different from a wire at 40%.
  The report shows the remaining margin for each passing check.
- **Measured, not asserted.** Nerve calculates a routed branch length from its centerline.
  It does not use an authored length for this result.
- **Accounted for.** Each mapped CSV or Excel row is accepted or rejected.
  The diagnostics identify the source row and column.
- **Reproducible.** The same source creates byte-identical drawings, tables, PDFs, and zip files.
  As a result, a revision produces a useful diff.

[Harness modeling principles](./docs/content/docs/(index)/concepts/harness-modeling.mdx) explains the domain boundaries and the owner of each check.
[Rule coverage](./docs/content/docs/reference/rule-coverage.mdx) identifies the supported and unsupported failure modes.

## What Nerve does not claim

Nerve does not certify a harness. It does not claim compliance with an industry or customer standard.
A report records the supplied facts and the checks that ran against them.

Use these commands to examine the limits of a result:

```bash
nerve parts ph-2     # which checks this part's data enables, and which stay inactive
nerve provenance     # which limits a clean report rests on that nobody has verified
```

```text
1 part(s) supply a limit a rule judges against without being verified.
A clean report is only as good as these.
```

Read [rule coverage](./docs/content/docs/reference/rule-coverage.mdx) before you use a clean compile as approval evidence.
This page includes failure modes that no design representation can find.

## Import a wire list

Create a column map:

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

Run the import:

```bash
npx --package=@grayhaven/nerve-cli nerve import ./wire-list.xlsx \
  --sheet "Wire List" \
  --map ./columns.json \
  --id my-harness \
  --out ./migration
```

The command creates an editable project with these files:

- `src/main.harness.ts`
- `nerve.config.ts`
- `package.json`
- `tsconfig.json`
- `column-map.json`
- `harness.json`
- `diagnostics.json`
- `import-report.json`

The CLI compiles the new source before it reports success.
Unknown connector parts receive the `unverified` status. Missing signals stay missing.
The report contains each accepted or rejected source row and its diagnostics.

### Import WireViz

If the WireViz project keeps reusable YAML anchors in a separate prepend file, run this command:

```bash
npx --package=@grayhaven/nerve-cli nerve import ./harness.yml \
  --prepend-file ./templates.yml \
  --id my-harness \
  --out ./migration
```

The adapter resolves template instances, ranges, pin labels, wire labels, color references, and explicit length units.
An `HK-WV-001` diagnostic identifies each concept that the adapter cannot represent without data loss.

## Compare a board connector

Run the contract command:

```bash
npx --package=@grayhaven/nerve-cli nerve contract ./src/main.harness.ts \
  --connector J1 \
  --against ./controller.kicad_pcb \
  --component J7 \
  --out ./dist/contracts
```

The adapter reads footprint references, pad-to-net assignments, and explicit no-connect pads from a KiCad 6+ board file.
It writes `contract-J1.normalized.json` for review or source control.

The file contains the board revision, ECAD component, generator version, and content fingerprint.
The adapter does not infer graphical connectivity from a schematic.

## Author a harness

Create a project:

```bash
npx --package=@grayhaven/nerve-cli nerve init .
npx --package=@grayhaven/nerve-cli nerve compile ./src/main.harness.ts
npx --package=@grayhaven/nerve-cli nerve export ./src/main.harness.ts
```

Use the TypeScript API to define the harness:

```ts
import { connector, harness, wire } from "@grayhaven/nerve"
import { MolexMicroFit } from "@grayhaven/nerve-connectors"

const j1 = connector("J1", MolexMicroFit["43025-0800"], {
  pins: { 1: "VBAT_24V", 2: "GND", 3: "CAN_H", 4: "CAN_L" }
})

// See examples/motor-controller for a complete design.
```

## Product and factory APIs

Nerve includes APIs for product configuration, supply data, release control, and factory records.

- **Electrical test authority.** An approved `TestSpecification` supplies acceptance limits to a generic tester program.
  Build records retain the specification, measurements, source hashes, tester identity, calibration identity, lengths, and crimp evidence.
- **Shop-floor execution.** `@grayhaven/nerve-platform` models released work orders and immutable unit events.
  The caller supplies each identity and timestamp. The caller also owns atomic reservation and persistence.
- **Product configuration.** A product family defines ordered options, requirements, exclusions, and deterministic patches.
  Nerve rejects unknown or conflicting selections. A variant can add, override, or remove protection devices.
- **Supply snapshots.** Supply records include provenance, lifecycle, approval, alternates, tooling, processes, availability, lead time, quantity, and price breaks.
  A canonical snapshot retains unresolved requests and provider conflicts.
- **Standards and factory interoperability.** `@grayhaven/nerve-interop` supplies standards profiles and a normalized VEC 2.2 subset.
  It also supplies OPC UA 40570 mappings and caller-defined automation checks.

These APIs describe software records and mappings. They do not prove that a physical process occurred.
They do not certify standards compliance or authenticate tester hardware.

The shop-floor layer is a headless reducer. It is not a user interface, MES service, or device gateway.
The VEC adapter is not a complete XML parser or validator. The OPC mapping does not include an OPC UA transport client.

The Cirris Easy-Wire-style exporter is experimental. Built-in production adapter discovery excludes it.

## Common questions

### Can Nerve use an existing WireViz project?

Yes. Give Nerve the YAML file and an optional prepend file.
Nerve reports unsupported data with `HK-WV-001`. It does not silently remove the data.

Use `nerve export --target wireviz` to translate a Nerve project to WireViz.

### Is Nerve useful for a small harness?

Yes. Expensive harness errors can be simple.
A swapped pair, an invalid wire gauge, or a short wire can stop production.

### Must a team rewrite its wire lists in TypeScript?

No. `nerve import` converts CSV and Excel data through an explicit column map.
The command creates a complete editable project.

### Is Nerve only a linter?

No. One compile creates drawings, a BOM, a cut list, labels, and a bill of process.
It also creates continuity tests, assembly instructions, and a PDF build book.

### How can a team examine the checks?

Read [rule coverage](./docs/content/docs/reference/rule-coverage.mdx) to see what the rule set includes.
Run `nerve provenance` to find the part data that supports a clean report.

### Does Nerve send designs to a remote service?

No. The CLI runs locally. The browser workspace compiles the harness in the browser.
The project uses the Apache-2.0 license.

## Packages

| Package | Purpose |
| --- | --- |
| [`@grayhaven/nerve`](./packages/nerve) | Domain model, authoring API, product configuration, supply snapshots, versioned HIR, diagnostics, rules API, and deterministic `compileDesign` |
| [`@grayhaven/nerve-compiler`](./packages/nerve-compiler) | Trusted local `.harness.ts` loading, configuration, plugins, and fail-closed validation |
| [`@grayhaven/nerve-rules`](./packages/nerve-rules) | 53 built-in rules with stable diagnostic codes |
| [`@grayhaven/nerve-importers`](./packages/nerve-importers) | Deterministic CSV and Excel migration with source-row accounting |
| [`@grayhaven/nerve-eval`](./packages/nerve-eval) | Provenance-aware evaluation and stable review reports |
| [`@grayhaven/nerve-exporters`](./packages/nerve-exporters) | Review, drawing, manufacturing, release, contract, tester, and build-record artifacts |
| [`@grayhaven/nerve-wireviz`](./packages/nerve-wireviz) | WireViz YAML import and export |
| [`@grayhaven/nerve-connectors`](./packages/nerve-connectors) | 21 connector housings and 9 crimp terminals with provenance data |
| [`@grayhaven/nerve-platform`](./packages/nerve-platform) | Review governance, release governance, work orders, and unit-build evidence |
| [`@grayhaven/nerve-interop`](./packages/nerve-interop) | Standards profiles, VEC 2.2 exchange, OPC UA 40570 mappings, and automation checks |
| [`@grayhaven/nerve-cli`](./packages/nerve-cli) | Local and CI workflows for import, review, evaluation, validation, export, and tester evidence |
| [`@grayhaven/nerve-web`](./packages/nerve-web) | Browser workspace, examples, and documentation |
| [`@grayhaven/nerve-react`](./packages/nerve-react) | Experimental JSX authoring runtime |

## Repository checks

Install the dependencies:

```bash
bun install
```

Run the repository checks:

```bash
bun run test
bun run typecheck
bun run build
```

The repository includes property, visual regression, mutation, browser, and accessibility tests.
Read the [delivery record](./GOAL.md) and [changelog](./CHANGELOG.md) for the implementation history.

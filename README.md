# Grayhaven Nerve

**The open harness verification compiler.**

[![CI](https://github.com/tylergibbs1/nerve/actions/workflows/ci.yml/badge.svg)](https://github.com/tylergibbs1/nerve/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/%40grayhaven%2Fnerve)](https://www.npmjs.com/package/@grayhaven/nerve)
[![license](https://img.shields.io/badge/license-Apache--2.0-white)](./LICENSE)

Nerve turns structured harness data into deterministic review evidence:

```text
existing data or Nerve source
  → versioned HIR
  → stable HK-* findings
  → review report, diffs, drawings, test plans, and manufacturing artifacts
```

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

Nerve does not certify a harness. It does not claim compliance with an industry
standard or a customer standard. A Nerve report records the checks that ran
against the facts the design supplied.

[Harness modeling principles](./docs/modeling-principles.md) explains the domain
boundaries and the owner of each check.

## What it does

- Runs 53 built-in consistency, electrical, component, and manufacturing checks with stable `HK-*` diagnostic codes.
- Reports how close a passing design came to each limit, not only that it passed. A wire at 99% of its derated ampacity and a wire at 40% both pass. They are not the same design.
- Judges a wire against the contact that crimps it, not against the housing. Judges a pin against the pinout its part fixes, not against what the design says about itself.
- Measures the length of a routed branch from its centerline, rather than from a number somebody typed.
- Writes a versioned machine-readable review report with the HIR fingerprint, the rule coverage, the findings, and the limitations.
- Accounts for every mapped CSV or Excel row as accepted or rejected. Then writes editable Nerve source and HIR.
- Compares harness connector assignments against the pad nets of a KiCad 6+ board footprint, or against another interface contract.
- Writes reproducible HIR, drawings, BOM, cut list, labels, continuity tests, assembly instructions, PDF packet, and release records.
- Evaluates rules against a provenance-aware public corpus. It does not present synthetic regressions as field evidence.

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

## Packages

| Package | Purpose |
| --- | --- |
| [`@grayhaven/nerve`](./packages/nerve) | Domain model, authoring API, versioned HIR, diagnostics, rules API, and deterministic `compileDesign` |
| [`@grayhaven/nerve-compiler`](./packages/nerve-compiler) | Trusted local `.harness.ts` loading, configuration, plugins, and fail-closed validation |
| [`@grayhaven/nerve-rules`](./packages/nerve-rules) | 53 generic built-in rules with stable diagnostic codes |
| [`@grayhaven/nerve-importers`](./packages/nerve-importers) | Deterministic CSV and Excel wire-list migration with source-row accounting |
| [`@grayhaven/nerve-eval`](./packages/nerve-eval) | Provenance-aware evaluation and stable review-report primitives |
| [`@grayhaven/nerve-exporters`](./packages/nerve-exporters) | Review, drawing, manufacturing, release, contract, and test artifacts |
| [`@grayhaven/nerve-wireviz`](./packages/nerve-wireviz) | WireViz YAML import and export |
| [`@grayhaven/nerve-connectors`](./packages/nerve-connectors) | 21 connector housings and 9 crimp terminals with provenance fields, plus a bundled provider |
| [`@grayhaven/nerve-cli`](./packages/nerve-cli) | Local and CI workflows for import, review, evaluation, validation, and export |
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

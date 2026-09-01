# The TypeScript SDK.

Everything the CLI does is a library call. Use the packages directly to embed harness compilation in your own tools: CI checks, generators, PLM integrations, or a build step.

## Compile and validate

`compileDesign` is pure and deterministic: same design in, same HIR out. Run the rule set against the result and gate on errors exactly like `nerve validate` does.

```ts
import { compileDesign, runRules, hasErrors } from "@grayhaven/nerve"
import { builtinRules } from "@grayhaven/nerve-rules"
import design from "./src/main.harness.js"

const { hir } = compileDesign(design)
const diagnostics = runRules(hir, builtinRules)

if (hasErrors(diagnostics)) {
  for (const d of diagnostics) console.error(`${d.code} ${d.severity}: ${d.message}`)
  process.exit(1)
}
```

Severities are tunable per rule without forking it: `runRules(hir, builtinRules, { missingWireColor: "error", spliceMissingNotes: "off" })`.

## Generate artifacts

Every exporter is a function from HIR to bytes or strings. Pick what you need:

```ts
import {
  bomCsv, cutListCsv, labelScheduleCsv,
  schematicSvg, boardSvg,
  generateTestPlan, testPlanCsv,
  assemblyInstructions, manufacturingPacketPdf, buildPacket,
} from "@grayhaven/nerve-exporters"

const bom = bomCsv(hir)                      // string
const schematic = schematicSvg(hir)          // string (SVG)
const tests = testPlanCsv(generateTestPlan(hir))
const pdf = await manufacturingPacketPdf(hir)  // Uint8Array, byte-deterministic
const packet = await buildPacket(hir)          // the whole dist/ set + zip
```

## Diff two revisions

```ts
import { diffHir, formatDiff, isEmptyDiff } from "@grayhaven/nerve"

const diff = diffHir(previousHir, currentHir)
if (!isEmptyDiff(diff)) console.log(formatDiff(diff))
// → "wire W1: gauge 20AWG -> 16AWG", down to a single pin swap
```

## Custom rules

A rule is a named function over the HIR with a stable code. Ship your shop's policy as a package:

```ts
import { rule } from "@grayhaven/nerve"

export const maxBundleLength = rule(
  "maxBundleLength",
  (ctx) => {
    for (const b of ctx.hir.branches) {
      if (b.length > 2000) {
        ctx.report({
          severity: "error",
          target: `branch:${b.id}`,
          message: `Branch ${b.id} is ${b.length}mm; shop limit is 2000mm.`,
        })
      }
    }
  },
  { code: "SHOP-001" },
)
```

Wire it in via `nerve.config.ts` and the CLI picks it up; severities live in the same config:

```ts
import { defineConfig } from "@grayhaven/nerve"
import { maxBundleLength } from "./rules/shop-rules.js"

export default defineConfig({
  plugins: [{ rules: [maxBundleLength] }],
  rules: { missingWireColor: "error" },
})
```

## Part data through providers

Part data is pluggable: the bundled library, your PLM, a distributor API, anything that answers an MPN. Providers are consulted in priority order, and disagreement on load-bearing fields is a diagnostic, never a silent overwrite.

```ts
import { resolvePart, staticProvider } from "@grayhaven/nerve"
import { nerveConnectorsProvider } from "@grayhaven/nerve-connectors"

const plm = staticProvider("acme-plm", loadFromPlm())
const { part, provider, diagnostics } = resolvePart([plm, nerveConnectorsProvider], "PHR-4")
// diagnostics: HK-LIB-001 warnings when providers disagree (pinCount, gender, limits)
```

The bundled library ships verified families with cavity layouts, gauge ranges, mating pairs, crimp tooling, and dated provenance: Molex Micro-Fit 3.0 and Mega-Fit, JST PH and XH, TE Deutsch DT, AMASS XT60.

## JSX authoring (experimental)

`@grayhaven/nerve-react` is a 2KB custom JSX runtime (no React): elements are plain functions over the same DSL, so the JSX form compiles to byte-identical HIR. Purely a style choice.

```tsx
/** @jsxImportSource @grayhaven/nerve-react */
import { Connector, Harness, Wire } from "@grayhaven/nerve-react"

export default (
  <Harness id="drop" revision="A" units="mm">
    <Connector ref="J1" part={part("ph-4")} pins={{ 1: "V5", 2: "GND" }} />
    <Wire id="W1" from="J1.1" to="M1.1" gauge="24AWG" color="red" length={120} />
  </Harness>
)
```

## tscircuit interop

Harness and PCB check each other across ecosystems (PRD §37):

```bash
# Validate the harness against a tscircuit board (catches swapped pins):
nerve contract ./src/main.harness.ts --connector J1 --against board.circuit.json

# Or hand tscircuit the harness side as Circuit JSON:
nerve contract ./src/main.harness.ts --connector J1 --format circuit-json
```

Compact part specs resolve library parts without memorizing MPNs:

```ts
import { part } from "@grayhaven/nerve-connectors"

const mcu = connector("MCU1", part("microfit-2x8"))   // 43025-1600
const drop = connector("S1", part("dt-4s"))           // Deutsch DT06-4S
```

## The HIR is a schema, not a guess

`harness.json` round-trips through a versioned Effect Schema: decode untrusted input, encode canonically:

```ts
import { decodeHir, encodeHir, HIR_SCHEMA_VERSION } from "@grayhaven/nerve"

const hir = decodeHir(JSON.parse(fileContents))  // throws on schema mismatch
const canonical = encodeHir(hir)                 // stable field order, diffs cleanly
```

Types for every node (`HirWire`, `HirConnector`, `HirEndpoint`, and the rest) ship with the package, so downstream tools are typed end to end.

## Loading .harness.ts files

The CLI loads design files through `@grayhaven/nerve-compiler` (jiti under the hood, no build step needed). Use it when your tool takes a file path rather than an imported module; everything in this page works in any bundler, Node 20.6+, or Bun.

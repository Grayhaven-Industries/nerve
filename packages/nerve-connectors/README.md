# @grayhaven/nerve-connectors

The verified connector library: 5 families / 21 parts (Molex Micro-Fit 3.0 + Mega-Fit, JST PH + XH, TE Deutsch DT, AMASS XT60) with cavity layouts, mating pairs, gauge ranges, crimp tooling, and dated provenance — plus compact specs and the bundled `PartProvider`.

```ts
import { part, nerveConnectorsProvider } from "@grayhaven/nerve-connectors"

part("microfit-2x8")  // -> Molex 43025-1600, full verified record
part("dt-4s")         // -> Deutsch DT06-4S
```

Part of [Grayhaven Nerve](https://github.com/tylergibbs1/nerve) — harnesses as code. [Live demo + docs](https://nerve.grayhavenindustries.com) · [llms.txt](https://nerve.grayhavenindustries.com/llms.txt) · Apache-2.0

## KiCad library references

The seven bundled JST PH/XH housings include `kicadAssets`, available from
`part()`, `partInfo()`, and `nerveConnectorsProvider.get()`. Each includes a
generic connector symbol plus the straight mating PCB header's footprint and
STEP model. References identify their relationship (`generic`, `mate`, or
`part`), the represented MPN where applicable, upstream revision, verification
date, and license attribution. The web connector inspector shows these links.

```ts
import { part } from "@grayhaven/nerve-connectors"

const housing = part("ph-2")
const footprint = housing.kicadAssets?.find((asset) => asset.kind === "footprint")
// Connector_JST:JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical
// relationship: "mate", mpn: "B2B-PH-K-S"
```

These links survive compilation and HIR serialization. Adding assets to your
own `ConnectorPart` uses the exported `KiCadAsset` type from `@grayhaven/nerve`.
An omitted or empty list produces no additional HIR field. They do not declare
a harness pinout, establish a cavity-to-pad mapping, or verify electrical
ratings. Confirm the exact header variant and mating orientation against the
manufacturer drawing when mapping board interfaces.

The references point to revision-pinned files in the official
[KiCad libraries](https://gitlab.com/kicad/libraries), checked on 2026-09-05.
Geometry and symbol files are not bundled or downloaded at runtime. Their
[CC-BY-SA-4.0 license with the KiCad libraries exception](https://www.kicad.org/libraries/license/)
and attribution remain attached to each reference.

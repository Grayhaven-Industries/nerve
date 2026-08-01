# HIR 0.1.0 — the compiled harness contract.

Generated from the live Effect schema in `@grayhaven/nerve` (`hirJsonSchema()`); it cannot drift from the code. `harness.json` in every exported packet validates against this. Renderers and rules consume HIR only — never user TypeScript. Optional fields are omitted when absent (never `null`), and all collections are canonically sorted, so output is byte-deterministic.

## schemaVersion

Type: `"0.1.0"`

## harness



| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes |  |
| `revision` | `string` | yes |  |
| `units` | `"mm" \| "in"` | yes |  |
| `metadata` | `Record<string, string>` | yes |  |

## connectors

Array of:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `ref` | `string` | yes |  |
| `mpn` | `string` | yes |  |
| `manufacturer` | `string` | no |  |
| `family` | `string` | no |  |
| `description` | `string` | no |  |
| `gender` | `"plug" \| "receptacle" \| "hermaphroditic"` | no |  |
| `pinCount` | `number` | yes |  |
| `wireGaugeRange` | `{ min, max }` | no |  |
| `cavityLayout` | `{ rows, columns }` | no |  |
| `matingMpn` | `string` | no |  |
| `reservedPins` | `Array<string>` | no |  |
| `sealed` | `boolean` | no |  |
| `compatibleTerminals` | `Array<string>` | no |  |
| `compatibleSeals` | `Array<string>` | no |  |
| `currentLimitA` | `number` | no |  |
| `voltageLimitV` | `number` | no |  |
| `crimpTool` | `string` | no |  |
| `provenance` | `{ source, datasheet, verification, lastVerified }` | no |  |
| `pins` | `Array<{ pin, signal, terminal, seal, electrical }>` | yes |  |

## wires

Array of:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes |  |
| `from` | `{ connector, pin } \| { splice }` | yes |  |
| `to` | `{ connector, pin } \| { splice }` | yes |  |
| `part` | `{ mpn, manufacturer, family, description, gauge, strands, conductorMaterial, insulation, outerDiameter, voltageRating, temperatureRating, ohmsPerKm, gramsPerMeter, availableColors, provenance }` | no |  |
| `gauge` | `string` | no |  |
| `color` | `string` | no |  |
| `stripe` | `string` | no |  |
| `length` | `number` | no |  |
| `lengthTolerance` | `number` | no |  |
| `serviceLoop` | `number` | no |  |
| `stripLength` | `{ from, to }` | no |  |
| `terminationAllowance` | `{ from, to }` | no |  |
| `signal` | `string` | no |  |
| `insulation` | `string` | no |  |
| `voltageRating` | `number` | no |  |
| `temperatureRating` | `number` | no |  |
| `currentEstimate` | `number` | no |  |
| `emcClass` | `"aggressor" \| "victim" \| "neutral"` | no |  |
| `twistGroup` | `string` | no |  |
| `shieldGroup` | `string` | no |  |
| `cable` | `string` | no |  |
| `conductor` | `string` | no |  |
| `branch` | `string` | no |  |
| `notes` | `string` | no |  |

## cables

Array of:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes |  |
| `type` | `string` | no |  |
| `conductors` | `number` | no |  |
| `shield` | `string` | no |  |
| `jacket` | `string` | no |  |
| `outerDiameter` | `number` | no |  |
| `cutLength` | `number` | no |  |
| `notes` | `string` | no |  |
| `wires` | `Array<string>` | yes |  |

## branches

Array of:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes |  |
| `path` | `Array<string>` | yes |  |
| `parent` | `string` | no |  |
| `sleeve` | `string` | no |  |
| `nominalLength` | `number` | no |  |
| `breakoutDistance` | `number` | no |  |
| `minBendRadius` | `number` | no |  |
| `ambientTemperatureC` | `number` | no |  |
| `waypoints` | `Array<{ x, y, z }>` | no |  |
| `routedLength` | `number` | no |  |
| `routedMinBendRadius` | `number` | no |  |

## splices

Array of:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes |  |
| `type` | `string` | no |  |
| `part` | `string` | no |  |
| `branch` | `string` | no |  |
| `location` | `number` | no |  |
| `notes` | `string` | no |  |
| `wires` | `Array<string>` | yes |  |

## labels

Array of:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes |  |
| `text` | `string` | yes |  |
| `attachTo` | `string` | yes |  |
| `offsetFrom` | `string` | no |  |
| `distance` | `number` | no |  |
| `material` | `string` | no |  |
| `quantity` | `number` | no |  |

## bom

Array of:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `internalPartId` | `string` | no |  |
| `mpn` | `string` | yes |  |
| `manufacturer` | `string` | no |  |
| `description` | `string` | no |  |
| `category` | `string` | no |  |
| `quantity` | `number` | yes |  |
| `unitOfMeasure` | `string` | yes |  |
| `usedBy` | `Array<string>` | yes |  |
| `notes` | `string` | no |  |

## protections

Array of:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `id` | `string` | yes |  |
| `kind` | `"fuse" \| "breaker"` | yes |  |
| `ratingA` | `number` | yes |  |
| `protects` | `Array<string>` | yes |  |
| `notes` | `string` | no |  |

## diagnostics

Array of:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `code` | `string` | yes |  |
| `severity` | `"error" \| "warning" \| "info"` | yes |  |
| `message` | `string` | yes |  |
| `target` | `string` | no |  |
| `targets` | `Array<string>` | no |  |
| `data` | `Record<string, string \| number>` | no |  |

## layoutHints

Type: `Array<unknown>`

## exports

Type: `Record<string, unknown>`

## Versioning

`schemaVersion` is `0.1.0`. Additive optional fields may appear without a version bump (guarded by the shape-snapshot test); removals, type changes, or new required fields bump the version.

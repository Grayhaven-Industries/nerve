> Grayhaven Nerve docs index: https://nerve.grayhavenindustries.com/llms.txt. Fetch it to discover all pages before exploring further.

# The design surface.

Everything imports from `@grayhaven/nerve`. The DSL builds a typed design graph; `compileDesign` lowers it to the versioned HIR that every exporter and rule consumes.

Recent additions: parts accept `reservedPins` (cavities that must stay empty, enforced by HK-CONN-015) and `cavityLayout` (drives the connector face views); branches accept `minBendRadius` (breakouts tighter than it fail HK-MFG-005); sleeves named with a trailing capacity (`braided-pet-12`) are checked against the estimated bundle diameter (HK-MFG-006); connector parts with `currentLimitA`/`voltageLimitV` gate wire current and signal voltage (HK-CONN-016/017).

## harness(id, options)

The root design object. `revision` and `units` are required; releases fail closed without them.

## connector(id, part, { pins })

Place a connector from a part definition. `pins` maps pin numbers to signal names; parts declare `pinCount`, `gender`, and `wireGaugeRange`, and the rules hold wires to them. Per-pin `terminals` and `seals` feed the compatibility rules.

## wire(id, from, to, options)

Point-to-point conductor. Endpoints are `connector.pin(n)` references or splice ids. Gauge strings like `"20AWG"` are checked against ampacity (`currentEstimate`) and the connector range; any spelling (`"20 AWG"`, `"awg 20"`, `"20"`) canonicalizes to `"20AWG"` in HIR.

## splice(id, options)

A junction node (`type: "crimp"`, `"solder"`, …). Wires may terminate on a splice; nets are computed across it and splice-verification tests are generated. `branch` + `location` place it physically.

## cable(id, options)

Groups wires into a multi-conductor cable (wires opt in via their `cable`/`conductor` props), optionally shielded. Shield drains must land on a pin or the rules flag it.

## branch(id, { path, … })

Physical bundle segment: `path` lists the connectors it runs between, `nominalLength` drives the board view and cut-length math, `sleeve`/`breakoutDistance`/`minBendRadius` feed the manufacturing rules.

## label(id, { text, attachTo })

Printed label on the loom, attached to a branch or connector with an optional `offsetFrom`/`distance`; exported to the label schedule CSV.

## variant(base, overrides)

Derive a configuration from a base harness: add/remove wires per option code without forking the file.

## rule(name, run, { code })

Author a custom validation rule; `report()` diagnostics with a stable code. Plug in via `defineConfig({ rules })`.

<!-- generated:dsl-reference:start -->
## Reference (generated from source)

This section is extracted from `@grayhaven/nerve` at build time; it cannot drift from the code.

```ts
harness(id: string, props: HarnessProps)
connector(ref: string, part: ConnectorPart, opts: ConnectorProps)
wire(id: string, from: EndpointInput, to: EndpointInput, props: WireProps = {})
splice(id: string, props: SpliceProps = {})
cable(id: string, props: CableProps = {})
branch(id: string, props: BranchProps)
label(id: string, props: LabelProps)
protection(id: string, props: ProtectionProps)
variant(base: HarnessDesign, opts: VariantOptions)
rule(name: string, run: (ctx: RuleContext) => void, options: RuleOptions = {})
defineConfig(config: NerveConfig)
```

### HarnessProps

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `revision` | `string` | yes |  |
| `units` | `Units` | yes |  |
| `metadata` | `Readonly<Record<string, string>>` | no |  |
| `connectors` | `ReadonlyArray<ConnectorInstance>` | yes |  |
| `wires` | `ReadonlyArray<WireDef>` | yes |  |
| `branches` | `ReadonlyArray<BranchDef>` | no |  |
| `labels` | `ReadonlyArray<LabelDef>` | no |  |
| `splices` | `ReadonlyArray<SpliceDef>` | no |  |
| `cables` | `ReadonlyArray<CableDef>` | no |  |
| `protections` | `ReadonlyArray<ProtectionDef>` | no |  |

### ConnectorPart

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `mpn` | `string` | yes |  |
| `manufacturer` | `string` | no |  |
| `family` | `string` | no |  |
| `description` | `string` | no |  |
| `gender` | `ConnectorGender` | no |  |
| `pinCount` | `number` | yes |  |
| `pinNumbering` | `string` | no |  |
| `cavityLayout` | `{ readonly rows: number; readonly columns: number }` | no |  |
| `reservedPins` | `ReadonlyArray<number \| string>` | no | Pins that must stay unassigned (keying, future use, no-connects). |
| `matingMpn` | `string` | no |  |
| `compatibleTerminals` | `ReadonlyArray<string>` | no |  |
| `compatibleSeals` | `ReadonlyArray<string>` | no |  |
| `compatibleBackshells` | `ReadonlyArray<string>` | no |  |
| `wireGaugeRange` | `{ readonly min: string; readonly max: string }` | no |  |
| `sealed` | `boolean` | no | Environmentally sealed housing: every populated cavity needs a seal. |
| `currentLimitA` | `number` | no |  |
| `voltageLimitV` | `number` | no |  |
| `crimpTool` | `string` | no |  |
| `insertionTool` | `string` | no |  |
| `extractionTool` | `string` | no |  |
| `provenance` | `PartProvenance` | no |  |

### ConnectorProps

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `pins` | `PinAssignments` | yes |  |
| `terminals` | `PinPartAssignment` | no |  |
| `seals` | `PinPartAssignment` | no |  |
| `electrical` | `PinElectricalAssignments` | no |  |

### PinElectrical

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `role` | `ElectricalRole` | no |  |
| `voltage` | `VoltageRange` | no |  |
| `currentA` | `number` | no | Role-relative: source capacity or sink demand. |
| `protocol` | `string` | no |  |
| `differential` | `DifferentialSemantics` | no |  |
| `terminationOhms` | `number` | no | Bus termination fitted at this pin, ohms. A high-speed CAN trunk carries exactly two (~120Ω), one at each end — the only thing that makes the line look like its own characteristic impedance instead of a reflector (HK-ELEC-018/019). |
| `bitRateKbps` | `number` | no | Bus bit rate, kbit/s. Sets the stub-length and total-length budgets: both shrink as the bit time shrinks (HK-ELEC-021). |

### WireProps

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `part` | `WirePart` | no | Wire material this conductor is cut from; the only thing that puts a wire on the BOM. |
| `gauge` | `AutocompleteString<KnownGauge>` | no |  |
| `color` | `AutocompleteString<KnownWireColor>` | no |  |
| `stripe` | `AutocompleteString<KnownWireColor>` | no |  |
| `length` | `number` | no | Finished (installed) length between the two endpoints. |
| `lengthTolerance` | `number` | no |  |
| `serviceLoop` | `number` | no | Extra length added to the cut so the wire can be dressed/serviced. |
| `stripLength` | `{ readonly from: number; readonly to: number }` | no | Insulation removed at each end — a machine parameter, NOT added to cut length. |
| `terminationAllowance` | `{ readonly from: number; readonly to: number }` | no | Length consumed inside each termination — IS added to cut length. |
| `signal` | `string` | no |  |
| `insulation` | `string` | no |  |
| `voltageRating` | `number` | no |  |
| `temperatureRating` | `number` | no |  |
| `currentEstimate` | `number` | no |  |
| `emcClass` | `"aggressor" \| "victim" \| "neutral"` | no | Crosstalk role for EMC segregation: "aggressor" (noisy source), "victim" (sensitive sink), or "neutral". |
| `twistGroup` | `string` | no |  |
| `shieldGroup` | `string` | no |  |
| `cable` | `string` | no | Cable this wire is a conductor of (see `cable()`). |
| `conductor` | `string \| number` | no | Conductor number/name within the cable. |
| `notes` | `string` | no |  |

### SpliceProps

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | `string` | no | crimp, solder-sleeve, ultrasonic-weld, ... |
| `part` | `string` | no | Crimp or solder-sleeve part number. |
| `branch` | `string` | no | Branch the splice sits on. |
| `location` | `number` | no | Distance along the branch from its start, in harness units. |
| `notes` | `string` | no | Seal / heat-shrink / inspection notes (PRD §9.2). |

### CableProps

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | `string` | no | Catalog type, e.g. "2x24AWG twisted shielded". |
| `conductors` | `number` | no |  |
| `shield` | `string` | no |  |
| `jacket` | `string` | no |  |
| `outerDiameter` | `number` | no |  |
| `notes` | `string` | no |  |

### BranchProps

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `path` | `ReadonlyArray<ConnectorInstance \| string>` | yes |  |
| `parent` | `string` | no |  |
| `sleeve` | `string` | no |  |
| `nominalLength` | `number` | no |  |
| `breakoutDistance` | `number` | no |  |
| `minBendRadius` | `number` | no | Tightest bend the bundle tolerates (mm) — breakouts must clear it. |
| `ambientTemperatureC` | `number` | no | Ambient temperature the bundle runs in (°C); member wires need a temperature rating at or above it. |

### LabelProps

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `text` | `string` | yes |  |
| `attachTo` | `ConnectorInstance \| string` | yes |  |
| `offsetFrom` | `ConnectorInstance \| string` | no |  |
| `distance` | `number` | no |  |
| `material` | `string` | no |  |
| `quantity` | `number` | no |  |

### ProtectionProps

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `kind` | `"fuse" \| "breaker"` | yes | Overcurrent device kind. |
| `ratingA` | `number` | yes | Device rating in amps; must not exceed the ampacity of any wire it guards. |
| `protects` | `ReadonlyArray<string>` | yes | Wire IDs this device protects (explicit, so no current-flow inference). |
| `notes` | `string` | no |  |
<!-- generated:dsl-reference:end -->

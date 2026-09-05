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
| `pinout` | `Readonly<Record<string, string>>` | no | The signal each pin carries on the part itself, where the part fixes it.  A bare housing has no pinout — pin 1 of a Micro-Fit receptacle is whatever you crimp into it. A device does: a sensor, a module, a board header have their pinout defined by the thing, not by the harness. Declaring it turns pin assignment into a claim that can be contradicted by an outside authority.  That matters because it is the one thing HK-CONN-011 cannot do. It compares a wire's signal against a pin assignment, but both are written by the same author in the same file, so a consistently wrong pinout — the mistake people actually make — agrees with itself and compiles clean. `matingMpn` does not help: it is a part number with nothing behind it. |
| `reservedPins` | `ReadonlyArray<number \| string>` | no |  |
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
| `kicadAssets` | `ReadonlyArray<KiCadAsset>` | no | Optional KiCad references; they do not establish pin mapping or electrical limits. |

### ConnectorProps

| Prop | Type | Required | Notes |
| --- | --- | --- | --- |
| `pins` | `PinAssignments` | yes |  |
| `terminals` | `PinPartAssignment<TerminalPart>` | no |  |
| `seals` | `PinPartAssignment<SealPart>` | no |  |
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
| `currentEstimate` | `number` | no | Expected **continuous** current, amps — not peak, not inrush, not stall.  Every rule reading this is thermal: ampacity and bundle derating (HK-WIRE-004), contact rating (HK-CONN-016), source capacity (HK-ELEC-017). Conductor heating is I²R integrated over time, so a brief peak does not size a wire and putting one here over-sizes the harness or fails a design that is fine. Size for what the load draws continuously and handle inrush as a separate concern. |
| `emcClass` | `"aggressor" \| "victim" \| "neutral"` | no | Crosstalk role for EMC segregation: "aggressor" (noisy source), "victim" (sensitive sink), or "neutral". |
| `twistGroup` | `string` | no |  |
| `shieldGroup` | `string` | no |  |
| `branch` | `string` | no | The bundle segment this wire runs in, by branch id.  Membership is otherwise inferred from whether both of a wire's endpoints appear in a branch's `path`, which makes it depend on an authoring accident: two physically identical bundles disagree if one path happens to name the shared source connector and the other does not. Anything counting conductors in a bundle — derating, sleeve fill, ambient — is only as good as that count, so say it outright when it matters. |
| `cable` | `string` | no |  |
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
| `waypoints` | `ReadonlyArray<Point3>` | no | Routed centerline through space, in harness units. Present means lengths and curvature are computed rather than asserted. |

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

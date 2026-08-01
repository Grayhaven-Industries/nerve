> Grayhaven Nerve docs index: https://nerve.grayhavenindustries.com/llms.txt. Fetch it to discover all pages before exploring further.

# 51 built-in validation rules.

Stable `HK-*` codes, suitable for CI gating and waivers. This table is generated from the shipped `builtinRules` array in `@grayhaven/nerve-rules`; it cannot drift from the code. Custom rules use the same `rule()` API and get their own codes.

| Code | Rule | Checks |
| --- | --- | --- |
| `HK-DOC-001` | `missingRevision` | Harness must declare a revision; releases fail closed without one. |
| `HK-DOC-002` | `branchMissingLabel` | Bundle branches should carry a printed label. |
| `HK-DOC-003` | `spliceMissingNotes` | Splices should document their joint (type/notes) for the build book. |
| `HK-MFG-001` | `missingWireLength` | Every wire should declare a length; cut lists need real numbers. |
| `HK-MFG-002` | `missingWireColor` | Every wire should declare a color for the cut list and loom work. |
| `HK-MFG-003` | `missingWireGauge` | Every wire must declare a gauge. |
| `HK-MFG-004` | `gaugeOutsideConnectorRange` | Wire gauge must sit inside the fitted terminal's wireGaugeRange, or the housing's when no terminal record exists. |
| `HK-MFG-012` | `insulationOutsideTerminalRange` | Wire insulation OD must sit inside the terminal's insulation-barrel range. |
| `HK-MFG-013` | `insulationOutsideSealRange` | Wire insulation OD must sit inside the cavity seal's diameter range. |
| `HK-MFG-007` | `unparseableGauge` | Flags gauges that aren't AWG, so the gauge-based checks can't verify them (metric is Info, not a warning). |
| `HK-WIRE-004` | `gaugeCurrentMismatch` | Wire gauge must carry the declared or estimated current (ampacity table). |
| `HK-ELEC-001` | `differentialPairNotTwisted` | Differential pairs (CAN_H/CAN_L…) must share a twist group. |
| `HK-ELEC-002` | `twistGroupTooSmall` | A twist group needs at least two wires. |
| `HK-ELEC-003` | `missingGroundReturn` | Power signals need a ground return path in the same harness. |
| `HK-ELEC-004` | `shieldDrainUnconnected` | Cable shields must land their drain on a pin. |
| `HK-CONN-010` | `unconnectedAssignedPin` | A pin assigned a signal must be touched by at least one wire. |
| `HK-CONN-011` | `wireSignalMismatch` | A wire's endpoints must agree on the signal it carries. |
| `HK-CONN-012` | `terminalIncompatible` | Terminal MPN must appear in the connector family's compatible-terminal list. |
| `HK-CONN-021` | `missingTerminal` | A wired cavity in a crimp-contact housing needs an explicit terminal MPN. |
| `HK-CONN-013` | `missingSeal` | Sealed connector families require a seal part on each wired cavity. |
| `HK-CONN-014` | `sealIncompatible` | Seal MPN must appear in the connector family's compatible-seal list. |
| `HK-CONN-016` | `connectorCurrentExceeded` | Wire current estimate must stay within the connector contact's rated amps. |
| `HK-CONN-017` | `connectorVoltageExceeded` | A rail's nominal voltage (from its name) must stay within the connector's rated volts. |
| `HK-ELEC-005` | `voltageRatingBelowSignal` | A wire's voltage rating must meet the nominal volts its signal carries. |
| `HK-CONN-015` | `reservedPinAssigned` | Reserved/keyed pins must stay unassigned. |
| `HK-MFG-005` | `breakoutTighterThanBendRadius` | A branch breakout must clear the bundle's minimum bend radius. |
| `HK-MFG-006` | `bundleOverSleeveCapacity` | A branch bundle must fit inside its sleeve's capacity. |
| `HK-CONN-019` | `contactCountExceedsPinCount` | A connector can't populate more cavities than its housing has. |
| `HK-CONN-020` | `cavityLayoutMismatch` | A connector's cavity grid must multiply to its pin count. |
| `HK-MFG-008` | `nonPositiveWireLength` | A wire length must be greater than zero. |
| `HK-MFG-009` | `branchParentInvalid` | A branch's parent must exist and the branch tree must be acyclic. |
| `HK-MFG-010` | `cableConductorOverflow` | A cable can't carry more wires than it has conductors. |
| `HK-MFG-011` | `missingCableConductor` | Every cable member should identify its physical conductor. |
| `HK-ELEC-006` | `orphanedDifferentialHalf` | A bus differential half (CAN/RS-485/USB) needs its partner present. |
| `HK-ELEC-007` | `twistGroupGaugeMismatch` | Wires in one twist group should share a gauge to limit skew. |
| `HK-ELEC-008` | `emcAggressorVictimShareBranch` | Aggressor and victim wires shouldn't share a bundle. |
| `HK-ELEC-009` | `wireTempBelowAmbient` | A wire's temperature rating must meet its branch's ambient. |
| `HK-ELEC-010` | `overcurrentExceedsConductor` | A fuse/breaker rating can't exceed the ampacity of the thinnest wire it protects. |
| `HK-ELEC-011` | `uncoveredNet` | Every electrical net needs at least two accessible connector pins for continuity testing. |
| `HK-ELEC-012` | `multipleElectricalSources` | A net must not join multiple declared electrical sources. |
| `HK-ELEC-013` | `undrivenElectricalLoad` | Only a fully role-typed net can be undriven; each sink needs a source or bidirectional driver. |
| `HK-ELEC-014` | `voltageDomainMismatch` | A source output range must be wholly accepted by connected typed ports; explicitly incompatible complete ranges are rejected. |
| `HK-ELEC-015` | `protocolMismatch` | Declared protocol identities must agree across an electrical net. |
| `HK-ELEC-016` | `differentialSemanticConflict` | A differential pair must preserve its declared pair identity and polarity semantics. |
| `HK-ELEC-017` | `sourceCurrentExceeded` | The total declared sink demand on a net must not exceed its source capacity. |
| `HK-ELEC-018` | `canTerminationCountWrong` | A high-speed CAN bus needs exactly two ~120Ω terminations; declaring one or three is a defect, declaring none is only reported for information. |
| `HK-ELEC-019` | `canTerminationNotAtBusEnd` | A CAN termination belongs at an end of the trunk, on a node with a single bus wire. |
| `HK-ELEC-020` | `canBusNotLinear` | A CAN trunk is linear; junctions are reported so their drops can be checked against the stub budget. |
| `HK-ELEC-021` | `canStubTooLong` | A CAN drop must stay inside the stub budget for the bus's declared bit rate. |
| `HK-ELEC-022` | `groundLoop` | A ground net offering more than one return path between the same points forms a circulating-current loop. |
| `HK-ELEC-023` | `shieldTerminationScheme` | A cable shield should be terminated deliberately: one end normally, both only by intent, neither never. |

## Example diagnostic

```
HK-CONN-011 Error  connector:P1.pin:1
  Wire W2 carries V5 but pin P1.1 is assigned V9.
```

Severity drives exit codes: errors fail `nerve validate` (exit 1), warnings pass with notice. Releases fail closed on any error.

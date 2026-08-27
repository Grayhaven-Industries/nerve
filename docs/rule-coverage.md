# Rule coverage

This document exists so that someone who has to sign a process control plan can
determine what Nerve actually checks, on whose authority, and — more
importantly — what it does not check. A clean compile is evidence that a
specific list of deterministic checks passed over the facts that were supplied.
It is not a certification, and it is not a substitute for the review activities
listed under [What Nerve does not check](#what-nerve-does-not-check).

The rule tables say what the checks are.
[The coverage matrix](#the-coverage-matrix) says how much of the problem they
are, by failure mode, and which failure modes no design representation can
decide at all.

This document measures compiler-rule coverage. Nerve can also retain external
process authority and evidence: an approved electrical `TestSpecification`,
tester results, crimp observations, serialized unit-build events, deviations,
and rework. Those records do not become design checks and do not add to the 53
built-in rules. They show what a caller recorded about a physical process; they
do not prove that Nerve performed, witnessed, or certified that process.

## How to read the table

Each built-in rule carries three provenance fields, surfaced in
`review-report.json` under `engine.rules.provenance` and on the `Rule` object
itself:

- **standard** — the governing document, when the rule implements one.
- **clause** — the section within that document. Never present without a
  standard, because a clause number with no document names a section of
  nothing.
- **ruleVersion** — semver for the rule's own logic, bumped when the same HIR
  can get a different verdict. It is addressable independently of the toolchain
  release, so a field failure can be attributed to a rule-set state rather than
  to "whatever version of the CLI was installed that week."

**Every rule in the built-in table below reads "not established" in the
standard column.** That is a statement about evidence, not a gap in effort.
These rules are structural and engineering-consistency invariants of Nerve's
own model: a cavity count against a housing, a reserved pin put into service,
a differential half with no partner.
They derive from the model described in
[modeling principles](./modeling-principles.md), not from a governing document,
and most of them have no governing document to derive from.

The two rules that look standards-shaped are not. `HK-WIRE-004` and
`HK-ELEC-010` consult the ampacity table in `packages/nerve-rules/src/wire-data.ts`,
which documents itself as "conservative bundled-harness values (chassis-wiring
tables derated for bundling)" with standards-informed data explicitly deferred
to a future rule pack. That table is the rule's basis; no standard is. Naming
one would convert an in-house engineering table into an authority claim.

Four rules do carry a standard, and they are the exception that shows what the
field costs. `HK-ELEC-018` through `HK-ELEC-021` in
`packages/nerve-rules/src/bus-topology.ts` record `standard: "ISO 11898-2"` and
deliberately record no clause. The file says why in its own header: the
document is paywalled and was not available, so the numeric limits it uses
(120Ω nominal termination, a 0.3 m stub at 1 Mbit/s, 40/100/500 m of bus at
1000/500/125 kbit/s) come from secondary sources, and two of the three stub
figures are derived by scaling rather than quoted at all. The rules name the
document they are about. They are not evidence of conformance to it, and the
header says so in the same words a reviewer would need.

A `standard` is added to a rule only when this repository contains the evidence
that the rule implements that document. Guessing a plausible standard name,
revision, or clause would destroy the one property this table exists to
provide, so where the basis is not established the field is left empty.

## Built-in rules

47 rules are defined in `packages/nerve-rules/src/rules.ts`. 45 are active by
default in `builtinRules`; two (marked *opt-in*) must be registered
deliberately. Eight more are defined in sibling modules and appended to the
same `builtinRules` array, so the pack ships 53 active rules over 55 defined
codes; they are tabulated under
[bus and return-path topology](#bus-and-return-path-topology) and
[part pinout](#part-pinout) below. A rule added to the pack in another module
belongs in this table too — the table is the coverage claim, and a rule missing
from it is a check nobody outside the codebase knows exists. Both counts are
read from `builtinRules` itself, so a rule that exists in the tree but is not
registered would not be counted here, because it does not run for anyone.

| Code | Rule | What it checks | Governing standard | Rule version |
| --- | --- | --- | --- | --- |
| HK-DOC-001 | missingRevision | The harness declares a non-empty revision. | Not established | 1.0.0 |
| HK-DOC-002 | branchMissingLabel | Every branch has a label attached to it. | Not established | 1.0.0 |
| HK-DOC-003 | spliceMissingNotes | Every splice declares a type, part, or manufacturing note. | Not established | 1.0.0 |
| HK-DOC-004 | requireApprovedParts *(opt-in)* | Every BOM part appears on the approved-MPN list the caller supplies. | Not established | 1.0.0 |
| HK-MFG-001 | missingWireLength | Every wire has a length, so the cut list can include it. | Not established | 1.0.0 |
| HK-MFG-002 | missingWireColor | Every wire has a color. | Not established | 1.0.0 |
| HK-MFG-003 | missingWireGauge | Every wire has a gauge. | Not established | 1.0.0 |
| HK-MFG-004 | gaugeOutsideConnectorRange | Wire gauge falls inside the accepted gauge range of the fitted contact, or of the housing when no contact record was supplied. | Not established | 1.1.0 |
| HK-MFG-005 | breakoutTighterThanBendRadius | A branch's declared breakout distance is not shorter than the bend radius it needs: the compiler's routed curvature where the branch has waypoints, otherwise the declared (or shop-profile) radius. | Not established | 1.1.0 |
| HK-MFG-006 | bundleOverSleeveCapacity | Estimated bundle diameter, from member wire ODs and a packing factor, fits the declared sleeve. Membership honours a wire's declared `branch` before falling back to path adjacency. | Not established | 1.0.0 |
| HK-MFG-007 | unparseableGauge | Flags gauges the AWG-keyed checks cannot read, so a silently unchecked wire is visible. Well-formed metric gauges report as info. | Not established | 1.0.0 |
| HK-MFG-008 | nonPositiveWireLength | A supplied wire length is greater than zero. | Not established | 1.0.0 |
| HK-MFG-009 | branchParentInvalid | A branch's parent names a defined branch and the parent chain is acyclic. | Not established | 1.0.0 |
| HK-MFG-010 | cableConductorOverflow | A cable does not carry more member wires than it has conductors. | Not established | 1.0.0 |
| HK-MFG-011 | missingCableConductor | A wire that belongs to a cable identifies which conductor it uses. | Not established | 1.0.0 |
| HK-MFG-012 | insulationOutsideTerminalRange | A wire part's outer diameter falls inside the insulation-barrel window of the contact crimped onto it. | Not established | 1.0.0 |
| HK-MFG-013 | insulationOutsideSealRange | A wire part's outer diameter falls inside the diameter window of the cavity seal around it. | Not established | 1.0.0 |
| HK-WIRE-004 | gaugeCurrentMismatch | A wire's declared current estimate is within the pack's ampacity value for its AWG, derated by the number of current-carrying conductors declaring the same branch (shop profiles may override the table). | Not established — in-house bundled-harness table, see above | 1.2.0 |
| HK-ELEC-001 | differentialPairNotTwisted | Both halves of a differential pair share a twist group. | Not established | 1.0.0 |
| HK-ELEC-002 | twistGroupTooSmall | A twist group contains at least two wires. | Not established | 1.0.0 |
| HK-ELEC-003 | missingGroundReturn | A harness carrying power signals also carries a ground return. | Not established | 1.0.0 |
| HK-ELEC-004 | shieldDrainUnconnected | A pin assigned a shield or drain signal has a wire landed on it. | Not established | 1.0.0 |
| HK-ELEC-005 | voltageRatingBelowSignal | A wire's declared voltage rating is at least the nominal voltage implied by its signal name. | Not established | 1.0.0 |
| HK-ELEC-006 | orphanedDifferentialHalf | A named bus half (CAN, RS-485, USB) has its partner somewhere in the harness. | Not established | 1.0.0 |
| HK-ELEC-007 | twistGroupGaugeMismatch | Wires in one twist group share a gauge. | Not established | 1.0.0 |
| HK-ELEC-008 | emcAggressorVictimShareBranch | Wires explicitly classified as aggressor and victim do not share a branch. Fires only on declared `emcClass`. | Not established | 1.0.0 |
| HK-ELEC-009 | wireTempBelowAmbient | A wire's declared temperature rating meets the declared ambient of every branch it runs through. | Not established | 1.0.0 |
| HK-ELEC-010 | overcurrentExceedsConductor | A protection device's rating does not exceed the ampacity of the thinnest conductor it protects, counting both the declared `protects` list and everything reached by walking splices downstream of it. | Not established — same in-house table as HK-WIRE-004 | 1.1.0 |
| HK-ELEC-011 | uncoveredNet | Every net reaches at least two accessible connector pins, so continuity can be tested point to point. | Not established | 1.0.0 |
| HK-ELEC-012 | multipleElectricalSources | A net driven by more than one declared source port. | Not established | 1.0.0 |
| HK-ELEC-013 | undrivenElectricalLoad | A net of declared sinks with no declared source. Suppressed when any peer role on the net is unknown. | Not established | 1.0.0 |
| HK-ELEC-014 | voltageDomainMismatch | Declared accepted voltage ranges on one net are compatible. | Not established | 1.0.0 |
| HK-ELEC-015 | protocolMismatch | Declared protocol identities on one net agree. | Not established | 1.0.0 |
| HK-ELEC-016 | differentialSemanticConflict | Declared differential-pair identity and polarity are consistent across a net. | Not established | 1.0.0 |
| HK-ELEC-017 | sourceCurrentExceeded | Declared sink demand on a net stays within declared source capacity. | Not established | 1.0.0 |
| HK-CONN-010 | unconnectedAssignedPin | A pin assigned a signal has a wire landed on it. | Not established | 1.0.0 |
| HK-CONN-011 | wireSignalMismatch | A wire's signal matches the signal assigned to the pin it lands on. | Not established | 1.0.0 |
| HK-CONN-012 | terminalIncompatible | A selected terminal appears on the housing's compatible-terminal list. | Not established | 1.0.0 |
| HK-CONN-013 | missingSeal | Every populated cavity of a sealed connector has a seal assigned. | Not established | 1.0.0 |
| HK-CONN-014 | sealIncompatible | A selected seal appears on the housing's compatible-seal list. | Not established | 1.0.0 |
| HK-CONN-015 | reservedPinAssigned | A cavity marked reserved carries no signal, wire, terminal, or seal. | Not established | 1.0.0 |
| HK-CONN-016 | connectorCurrentExceeded | A wire's declared current estimate stays within the current rating of the fitted contact, or of the housing's per-contact figure when no contact record was supplied. | Not established | 1.1.0 |
| HK-CONN-017 | connectorVoltageExceeded | Voltage inferred from a rail-shaped signal name stays within the connector's declared voltage limit. Inference, so it warns. | Not established | 1.0.0 |
| HK-CONN-018 | multipleWiresIntoPin *(opt-in)* | Two or more wires of differing gauge crimped into one contact. Same-gauge double-crimps are legitimate and are not flagged. | Not established | 1.0.0 |
| HK-CONN-019 | contactCountExceedsPinCount | A connector declares no more pins than the housing has cavities. | Not established | 1.0.0 |
| HK-CONN-020 | cavityLayoutMismatch | A declared cavity grid multiplies out to exactly the housing's cavity count. | Not established | 1.0.0 |
| HK-CONN-021 | missingTerminal | Every wired cavity of a connector that publishes a terminal allow-list has a terminal MPN. | Not established | 1.0.0 |

Five rules have left the 1.0.0 baseline, and every one of them left it for the
same reason: the rule stopped deciding on a number the author typed and started
deciding on one the compiler or a part record supplies. HK-WIRE-004 derates
ampacity by the conductors sharing a bundle, HK-ELEC-010 walks the splice graph
past the declared `protects` list, HK-MFG-005 prefers a routed centerline's
computed curvature to the asserted bend radius, and HK-MFG-004 and HK-CONN-016
judge a wire against the contact fitted to the cavity rather than against the
housing that was standing in for it. Each can return a different verdict on HIR
that has not changed by a byte, which is exactly what `ruleVersion` exists to
record. HK-WIRE-004 is at 1.2.0 because it moved twice: the conductor count it
derates by is now a count of current-carrying conductors rather than of every
wire on the branch, which can change a verdict in the passing direction.

### Bus and return-path topology

Six rules live outside `rules.ts` and are appended to `builtinRules` from
`bus-topology.ts` and `ground-shield.ts`. They are the only rules in the pack
that ask about the shape of the graph rather than the adequacy of one part, and
the four CAN rules are the only ones carrying a `standard` at all. See
[how to read the table](#how-to-read-the-table) for what that citation does and
does not mean.

| Code | Rule | What it checks | Governing standard | Rule version |
| --- | --- | --- | --- | --- |
| HK-ELEC-018 | canTerminationCountWrong | A CAN bus declares exactly two terminations, and each declared value sits in a 100-130Ω band. Zero declared terminations reports as info, because the resistors usually live off-harness. | ISO 11898-2, no clause; limits from secondary sources | 1.0.0 |
| HK-ELEC-019 | canTerminationNotAtBusEnd | A declared termination sits on a degree-1 node of the bus subgraph, which is what an end of a linear trunk is. | ISO 11898-2, no clause; limits from secondary sources | 1.0.0 |
| HK-ELEC-020 | canBusNotLinear | A CAN bus has no node where three or more bus wires meet (warning) and closes no ring (error). | ISO 11898-2, no clause; limits from secondary sources | 1.0.0 |
| HK-ELEC-021 | canStubTooLong | Each drop off the trunk stays inside the stub budget for the highest declared bit rate, from declared wire lengths. Silent when no bit rate is declared. | ISO 11898-2, no clause; limits from secondary sources | 1.0.0 |
| HK-ELEC-022 | groundLoop | The ground subgraph offers no second return path between the same two endpoints. Union-find over the wires, not over `ctx.nets`, which has already collapsed the cycles. | Not established | 1.0.0 |
| HK-ELEC-023 | shieldTerminationScheme | A `shieldGroup` is grounded at exactly one end. Zero ends warns; two ends reports as info, because double-ended termination is a deliberate high-frequency choice. | Not established | 1.0.0 |

### Part pinout

Two rules live in `pinout.ts` and are appended to `builtinRules` from there.
They are the only rules in the pack that judge a design against something other
than the design, which is why they are worth separating out rather than folding
into the connector block above.

| Code | Rule | What it checks | Governing standard | Rule version |
| --- | --- | --- | --- | --- |
| HK-CONN-023 | pinoutSignalContradiction | A pin's assigned signal matches the signal the part's own `pinout` fixes on that pin. Errors, including where the part declares the pin a no-connect. | Not established | 1.0.0 |
| HK-CONN-024 | pinoutPinUnassigned | A pin the part's `pinout` fixes a signal on is assigned one by the design. Warns, because leaving a device pin unused is often deliberate. No-connect pins are exempt. | Not established | 1.0.0 |

Neither carries a standard, and the file says why in the same terms this
document uses: the authority is the part's own datasheet, which is per-part and
already recorded on `provenance.datasheet`. Naming a standards document would
launder "the sensor vendor says so" into "the standard says so". Neither rule
emits a margin either, because a pin either carries the signal the part fixes
or it does not, and a fraction-of-pins-matching score would let a harness with
one catastrophically wrong pin in forty read as 0.975 correct.

Comparison is by trimmed, case-folded signal name and nothing else, which is a
deliberate choice with a stated cost. `AGND` does not match `GND` and `CAN_H`
does not match `CAN_L`, because those are the swaps the rule exists to catch;
the price is that a design which legitimately calls the part's `GND` net
`GND_SIG` is reported as a contradiction it will have to rename or waive.

Structural codes such as `HK-CONN-001`, `HK-WIRE-001`, `HK-BRANCH-001`,
`HK-SPLICE-001`, `HK-CABLE-001`, `HK-BRANCH-004`, and `HK-CONN-007` also appear
in a review report. They are compiler-owned invariants — reference integrity,
unique identity, valid quantities, an authored length that contradicts its own
waypoints, a part pinout naming a pin the part does not have or reserves — not
rules, so they carry no rule version and are not configurable. One of them,
`HK-BRANCH-004`, is cited in the matrix below, because a coverage table is
about what the tool decides and not about which module decides it.
Plugins and rule packs registered by a project can contribute further codes
beyond this table; the report lists the codes that were actually run.

## The coverage matrix

The rule list says what Nerve checks. It cannot say how much of the problem
that is. Those are two different quantities, and only one of them is currently
countable:

- **Coverage** is what fraction of the ways harnesses actually fail the rule
  set speaks to at all.
- **Soundness** is what fraction of the claims it does make are correct.

Neither is measured here. Soundness needs field data mapped back to rule
verdicts, and no such data exists in this repository. Coverage can at least be
laid out honestly, which is what this section does. What the repository does
contain is two direct pieces of evidence that a covered cell is not the same
thing as a correct one; they are recorded under
[what covered does not mean](#what-covered-does-not-mean) rather than folded
into the table, because they change no cell.

The matrix has one row per harness failure mode as it occurs in the field, and
one column per class of information required to decide it. The columns are a
ladder in increasing cost of acquisition. A cell says what Nerve does with the
information at that tier for that failure mode, not what the tier could support
in principle for someone else's tool.

Cell vocabulary, and the reason it has four words rather than two:

- **checked**: every input the tier's question needs is in the model, and a
  rule decides the question completely.
- **partial**: a rule fires here, but decides less than the row's name
  implies. The specific shortfall is named under the row.
- **declared**: the rule reads an author-supplied assertion rather than
  deriving the answer from the graph or the physics. An `emcClass` label, an
  `ambientTemperatureC`, and a declared minimum bend radius are all inputs
  somebody typed. See
  [declarations versus derivations](#declarations-versus-derivations).
- **none**: the tier's information would decide it and nothing checks it.
- **n/a**: the tier contributes nothing this row needs.

A cell records what the rule set can decide, not how often it gets the chance.
Three cells rest on checks nothing in this repository currently exercises,
because the data they need is absent from the bundled library and from the
examples: the part-data cell of wrong pin, and the geometry cells of wrong
length and over-bend at a breakout. Each says so under its row.

A partial cell reported as a full one is the failure mode this table exists to
prevent, so the shortfalls are spelled out rather than left to the word.

| Failure mode | Netlist alone | Plus full part data | Plus geometry | Plus thermal state | Undecidable from any design representation |
| --- | --- | --- | --- | --- | --- |
| Abrasion and chafe | n/a | partial: HK-MFG-006 | none | n/a | contact with surrounding structure, installation damage |
| Connector seal and corrosion | n/a | partial: HK-CONN-013, HK-CONN-014, HK-MFG-013 | none | n/a | seating and latch at build, service exposure |
| Crimp failure | n/a | partial: HK-CONN-012, HK-CONN-021, HK-MFG-004, HK-MFG-012, HK-CONN-018 | n/a | n/a | crimp height and width, pull force, applicator setup, operator |
| Thermal degradation | n/a | partial: HK-WIRE-004, HK-CONN-016 | none | declared: HK-ELEC-009 | duty cycle, airflow, soak in service |
| Vibration fatigue | n/a | none | none | n/a | excitation spectrum, mount stiffness, life |
| Wrong pin | checked: HK-CONN-010, HK-CONN-011, HK-CONN-015, HK-ELEC-006, HK-ELEC-012 to HK-ELEC-017 | partial: HK-CONN-023, HK-CONN-024 | n/a | n/a | whether the interface specification is itself correct |
| Wrong length | partial: HK-MFG-001, HK-MFG-008 | n/a | partial: HK-BRANCH-004 | n/a | dressing and slack chosen at install |
| Wrong terminal | n/a | partial: HK-CONN-012, HK-CONN-021, HK-MFG-004, HK-MFG-012 | n/a | n/a | substitution at the bench, supplier lot variance |
| Bus reflection | partial: HK-ELEC-018 to HK-ELEC-021 | none | none | n/a | transceiver margin over temperature |
| Ground loop | partial: HK-ELEC-003, HK-ELEC-022, HK-ELEC-023 | n/a | none | n/a | chassis impedance, external field |
| Protection coordination | partial: HK-ELEC-010 | none | n/a | none | available fault current, source impedance |
| EMC coupling and crosstalk | declared: HK-ELEC-001, HK-ELEC-004, HK-ELEC-007, HK-ELEC-008 | none | none | n/a | measured emissions and immunity |
| Insulation breakdown | partial: HK-ELEC-005 | partial: HK-CONN-017 | none | n/a | contamination, insulation damaged in service |
| Over-bend at a breakout | declared: HK-MFG-005 | n/a | partial: HK-MFG-005 | n/a | how tightly the bundle is dressed at install |

### What each partial is short of

- **Abrasion and chafe.** HK-MFG-006 estimates a bundle diameter from an
  insulated-OD table and a packing factor and compares it to the declared
  sleeve. It answers "does the declared sleeve fit", never "is abrasion
  protection present where the route needs it". Nothing in the model represents
  what the harness touches, so the geometry tier stays empty even after routing
  exists.
- **Connector seal and corrosion.** HK-CONN-013 fires only when the housing
  declares `sealed: true`, and only for cavities a wire lands on. HK-CONN-014
  checks membership of a `compatibleSeals` list. HK-MFG-013 checks the one
  physical fit that matters, the wire's insulation diameter against the seal's
  own window, but it needs two part records to fire: a `SealPart` on the pin
  and a `WirePart` carrying an `outerDiameter`. A seal named as a bare MPN
  still checks nothing dimensional, and `packages/nerve-connectors` ships no
  seal records at all, so nothing in the bundled library exercises it. Nothing
  checks that unused cavities of a sealed housing are plugged, because cavity
  plugs are not modeled at all.
- **Crimp failure and wrong terminal.** HK-CONN-021 checks a terminal is
  named and HK-CONN-012 checks it appears on the housing's allow-list; both
  read the housing's lists and neither has changed. HK-MFG-004 now prefers the
  fitted contact's own `wireGaugeRange` and falls back to the housing's only
  when no contact record was supplied, which retires the category error
  [modeling principles](./modeling-principles.md) warns about for designs that
  supply the record and leaves it in place for designs that do not. HK-MFG-012
  adds the insulation-barrel fit, the grip that is the harness's strain relief.
  What is still absent is the crimp itself: `TerminalPart` carries
  `crimpHeight`, `pullForceN`, and `stripLength` fields, no rule reads any of
  them, and the nine contacts in `packages/nerve-connectors/src/terminals.ts`
  populate none of them, on the stated grounds that manufacturers publish those
  figures per gauge and per tool rather than per part. A crimp is still
  measured on the shop floor. HK-CONN-018 catches two wires of differing gauge
  in one contact, and is opt-in.
- **Thermal degradation.** HK-WIRE-004 divides a declared current estimate by
  an ampacity table derated for the bundle the wire runs in. The count is of
  current-carrying conductors rather than of wires, because the derating
  factors count what puts heat into a bundle and twenty signal wires do not
  (`isCurrentCarrying` in `wire-data.ts` owns that test, and excludes a wire
  only on positive evidence: a declared zero, a declared load under a tenth of
  its own gauge's ampacity, or a shield). Membership for this rule is the
  wire's explicit `branch` and nothing else, so a wire that names no branch is
  not derated at all, exactly as it was before derating existed. HK-CONN-016
  now judges against the fitted contact's own current rating where one exists.
  Mutual heating, duty cycle, and altitude remain outside the model. HK-ELEC-009
  compares a wire's rating to a branch's `ambientTemperatureC`, which is a
  number the author typed; nothing computes a temperature.
- **Wrong pin.** The netlist cell is the one cell in the table that is
  complete, and it is complete about a narrow question: whether the design's
  own declarations agree with each other. HK-CONN-011 compares a wire's signal
  to the signal assigned to the pin it lands on, and both were written by the
  same author, so a consistently wrong pinout agrees with itself and compiles
  clean. No rule reads `matingMpn`, and `matingMpn` carries no pinout to read.
  The part-data cell is what addresses that, and it is now occupied.
  `ConnectorPart.pinout` carries the signals a part itself fixes per pin, the
  compiler carries it into `HirConnector.pinout` and rejects a pinout naming a
  pin the part does not have or reserves (`HK-CONN-007`), and HK-CONN-023 and
  HK-CONN-024 decide the design against it. That is the first thing in the
  table that judges a harness against a claim originating outside it.

  It is partial, for three reasons worth separating. A part that declares no
  pinout produces nothing, which is correct rather than a shortfall — a bare
  housing genuinely fixes no signal on any pin — but it means the check applies
  only to device-shaped parts. A partial pinout is a partial claim, judged pin
  by pin, so a header fixing pins 1 to 4 leaves 5 to 8 unexamined. And the
  pinout is still a record in this repository: nothing verifies it against the
  manufacturer's datasheet, so the rules relocate the authority from the
  harness author to the part library rather than importing an external one,
  which is the same trust boundary
  [what covered does not mean](#what-covered-does-not-mean) is about.

  No part in `packages/nerve-connectors` declares a pinout and no example
  supplies one, so nothing in this repository currently exercises either rule.
  The mechanism exists and is registered; the data that would make it fire does
  not ship yet, and a cell that is covered by a mechanism nothing uses is worth
  reading as capability rather than as practice.
- **Wrong length.** HK-MFG-001 checks a length is present and HK-MFG-008 checks
  it is positive; neither checks a length is right. The geometry tier now
  decides part of it. `waypoints`, `routedLength`, and `routedMinBendRadius`
  are on `HirBranch`, the compiler measures them off an authored centerline,
  and `HK-BRANCH-004` reports a branch whose authored `nominalLength`
  contradicts its own waypoints by more than a relative tolerance. Two caveats
  keep the cell partial. `HK-BRANCH-004` is a compiler-owned structural code,
  not a configurable rule, so it carries no rule version and no severity
  override. And it decides a branch's length, not a wire's: wire lengths stay
  authored numbers with nothing to check them against, which is the larger half
  of the row and where a cut list actually goes wrong. No example in
  `examples/` declares waypoints today, so nothing ships that exercises it.
- **Bus reflection.** HK-ELEC-018 to HK-ELEC-021 are the deepest checks in the
  pack and they cover one bus family. `canBusKey` matches CAN signal names
  only, so RS-485, USB, LVDS, and Ethernet get nothing beyond the pairing and
  twist rules. The checks are topological plus two declared quantities:
  termination resistance has to be declared per pin, and the stub budget stays
  silent unless a `bitRateKbps` is declared somewhere on the bus. No
  characteristic impedance, twist pitch, or connector discontinuity is
  represented anywhere in HIR.
- **Ground loop.** HK-ELEC-022 is a genuine traversal: an incremental union-find
  over the ground subgraph, which finds a second return path that continuity
  testing cannot see. It is partial because membership of that subgraph is
  decided by a signal-name regex and a declared `role: "ground"`, so a return
  conductor named outside the convention is not in the graph the rule walks.
  HK-ELEC-003 is weaker still: it reports that no wire anywhere in the harness
  has a ground-shaped name, which is a harness-wide presence check and not a
  per-net return check. Loop area, the quantity that actually governs pickup,
  needs geometry.
- **Protection coordination.** HK-ELEC-010 was a pure declaration check and is
  not one any more: it takes the author's `protects` list as a seed and walks
  the splice graph downstream of it, so a run that necks down three splices
  past the fuse is caught even though nobody listed it. The traversal stops at
  any splice reaching a conductor another device declares, which keeps the rule
  from reporting a wire it does not protect. It is partial rather than derived
  because the walk still starts from a declaration: a device whose `protects`
  list is empty, or a conductor fed from a run nobody listed, is unprotected
  and unreported. The thermal cell beside it, derating the device itself, is
  still empty.
- **Insulation breakdown.** HK-ELEC-005 and HK-CONN-017 both compare a rating
  to a voltage inferred from the signal name by a regex. HK-CONN-017 warns
  rather than errors for exactly that reason. Creepage and clearance are
  geometry and are absent.
- **Over-bend at a breakout.** HK-MFG-005 occupies two cells because it decides
  the same question from two different tiers. Given only a netlist it compares
  two authored numbers, a declared breakout distance against a declared or
  shop-profile bend radius. Given waypoints it prefers the curvature the
  compiler measured off the centerline, which is the bend the bundle is
  actually being asked to take rather than the one somebody believed it would
  take. The geometry cell is partial because an absent `routedMinBendRadius`
  means a straight run or an unrouted branch and falls back to the assertion,
  and because the radius a bundle can survive is a function of its
  construction, which is not modeled.

### Declarations versus derivations

Some rules traverse the model and derive a conclusion. Others read a fact the
author asserted and check it for internal consistency. Both are useful, and
they carry different weight in a review, so the distinction is worth stating
per rule rather than leaving it to be discovered.

Rules that derive: HK-ELEC-022 walks the ground subgraph, HK-ELEC-020 and
HK-ELEC-021 walk the bus graph for degree, rings, stubs, and weighted diameter,
HK-ELEC-011 walks nets to accessible pins, HK-MFG-009 walks the branch parent
chain for cycles, HK-MFG-006 computes a bundle diameter from member wires,
HK-ELEC-010 walks splices downstream of a protected run.

Rules whose subject is a declaration:

- **HK-ELEC-008** reports that a wire labeled `aggressor` and a wire labeled
  `victim` share a branch. It is a bookkeeping check on labels a human applied.
- **HK-ELEC-012 to HK-ELEC-017** propagate declared port semantics and report
  contradictions. An unknown role suppresses the undriven-load conclusion by
  design, so silence here means unknown, not clear.
- **HK-CONN-012, HK-CONN-014, HK-CONN-021** check membership of allow-lists
  that arrive with the connector part, so the check is only as good as the
  library entry. That qualifier is not hypothetical; see
  [what covered does not mean](#what-covered-does-not-mean).
- **HK-CONN-013** depends on a `sealed: true` flag, and **HK-ELEC-018** and
  **HK-ELEC-019** depend on a `terminationOhms` declared per pin.
- **HK-MFG-005** compares two authored numbers when the branch has no route,
  and prefers the compiler's `routedMinBendRadius` when it has one. It was the
  first rule in the pack to judge a branch on a measured quantity rather than a
  claimed one, and it is bumped to 1.1.0 for that reason. Because no example
  declares waypoints, every evaluation that ships today still takes the
  declared path.
- **HK-MFG-004, HK-CONN-016, HK-MFG-012, HK-MFG-013, HK-CONN-023,
  HK-CONN-024** read part records rather than harness assertions, which moves
  the trust from the design to the library. That is the better place for it,
  since a library entry is checked once and used by everyone and a harness is
  typed once per project, and the pinout rules are the strongest form of it,
  since the record they read describes the device the harness has to satisfy.
  It is still not the same as deriving the answer: an incorrect part record
  produces a confident, wrong verdict, and four of them were found here.

### What covered does not mean

The matrix is a coverage table, and a covered cell says only that a rule speaks
to the question. It says nothing about whether the rule answers correctly. Two
things found in this repository are worth recording, because they are the only
soundness evidence there is and both point the same way.

The first is a membership defect. Anything that counts conductors in a bundle
depends on knowing which wires are in it, and that count was inferred from
whether both of a wire's endpoints appeared in a branch's `path`. That is a
statement about how the path was authored, not about what is inside the sleeve.
On `examples/robot-platform` it counted four conductors on one drive bundle and
zero on its physically identical twin, because one path named the distribution
connector and the other did not. Zero conductors is a sleeve that always fits
and a bundle that never derates, so the rules fed by that count were passing
designs on an empty set. `WireProps.branch` now lets a wire state its bundle,
`wiresOnBranch` honours it before falling back to path adjacency, and
HK-MFG-006 no longer keeps its own copy of the adjacency test. Nothing about
that changed which cells are covered. It changed how many of the answers in
those cells were right, and nobody knows what that number was.

The second is reference data. Modelling the contacts meant reading the contact
ranges rather than inheriting the housing's, and doing so turned up four errors
in `packages/nerve-connectors`: two JST contact ranges recorded from the wrong
column of the catalog (the PH pair documented the wrong way round, and XH's
housing range claiming a 30 AWG floor that belongs to a contact these housings
do not accept), a DEUTSCH size-16 range published as 14-20 AWG when both listed
contacts take 16-20, and Molex Mega-Fit housings whose `compatibleTerminals`
were kit part numbers from PicoBlade, an unrelated 1.25mm family, carrying that
family's 23 AWG floor with them. Every one was a housing range standing in for
a contact range. The last was load-bearing: with the real 16 AWG floor in
place, a drive feed in `examples/robot-platform` had a Micro-Fit end and a
Mega-Fit end whose gauge ranges do not overlap, so the harness could not be
built as drawn and nothing said so.

Both are the same finding from different directions. A rule that reads a
declaration inherits every error in the declaration, and the tool's own
reference library was wrong in four places until modelling the contacts forced
it to be read. What each entry was corrected against is in its own file header,
including which sources were used where a manufacturer site refused automated
fetches, because a correction on unnamed authority is the same problem again.
Soundness is not measured here and these are not a measurement, but they are
the reason the table's covered cells should not be read as settled.

### What the matrix implies about what to build next

The table has 14 rows and 5 columns. One column is the undecidable residue and
is not a work item, leaving 56 decision cells, of which 25 are n/a for their
row. That leaves 31 live cells. Nerve fires in 18 of them: one checked, fourteen
partial, three declared. Thirteen live cells have nothing.

Sorted by column, the shape of the remaining work is not a matter of opinion:

- **Netlist alone: 8 live cells, and Nerve is in all 8.** One checked, five
  partial, two declared. The cheap tier is exhausted by coverage and is not
  exhausted by depth: five of the eight rest on quantities the author asserted,
  so the work left here is turning declarations into derivations rather than
  filling empty cells. Everything else has an acquisition cost attached, and
  the ranking below is a ranking of those costs.
- **Full part data: 11 live cells, 7 partial, 4 empty.** This tier moved more
  than any other and is now the best-covered tier after the netlist. The
  asymmetry that used to explain its partials is gone: `TerminalPart` and
  `SealPart` are full records, `HirPin` carries `terminalPart` and `sealPart`
  beside the MPN strings, and the three cells blocked on it have moved, with
  HK-MFG-004 and HK-CONN-016 judging against the fitted contact, HK-MFG-012
  checking the insulation-barrel fit and HK-MFG-013 the seal fit. A fourth cell
  moved for a different reason: a part can now declare the pinout it fixes, and
  the wrong-pin row is decided against it. None of the four became complete,
  and the crimp specification is the clearest gap left. `TerminalPart` has
  `crimpHeight` and `pullForceN` fields, but the bundled library does not
  populate them and no generic rule reads them. Separate build records can
  retain caller-supplied target and actual crimp height, width, and pull-force
  evidence. That improves process traceability without filling the design-rule
  cell.
- **Geometry: 10 live cells, 2 partial and 8 empty.** The largest single jump,
  and the table argues against taking it first for coverage reasons. A routed
  centerline is one kind of geometry and the cells want three. The waypoint
  work converted exactly two of the ten, wrong length and over-bend at a
  breakout, and both are partial. Four more need the structure the harness is
  installed in (chafe, seal and mating access, vibration mounts, loop area) and
  four need the bundle's internal cross-section (mutual heating, conductor
  spacing, creepage, sleeve fit along the route). Neither of those follows from
  a centerline through space. The two the centerline does convert are worth
  having on their own merits, since a cut list is where a wrong number gets
  expensive, but they should not be counted as an entry into chafe, fit,
  vibration, or signal integrity. No example in the repository declares
  waypoints, so both converted cells are capability rather than practice.
- **Thermal state: 2 live cells.** One is served by a declared ambient, and the
  other, thermal derating of the protection device itself, is empty. It is the
  smallest tier in the table. The bundle derating that landed improves the part
  data cell it sits next to rather than adding a cell here, because a conductor
  count is not a temperature.

Two counts about the rule set itself follow from the same exercise. Of the 55
defined codes, 41 appear somewhere in the matrix. The other 14 make no claim
about a field failure mode at all: HK-DOC-001 to HK-DOC-004, HK-MFG-002,
HK-MFG-003, HK-MFG-007, HK-MFG-009, HK-MFG-010, HK-MFG-011, HK-ELEC-002,
HK-ELEC-011, HK-CONN-019, and HK-CONN-020 keep the model well formed, keep the
harness documented, or keep it testable. That is not padding, and HK-MFG-007
earns its place twice over: it reports gauges the AWG-keyed rules cannot read,
which makes a silently unchecked wire visible instead of letting it pass as a
checked one.

And no row of the matrix is fully decided. Fourteen failure modes, 53 active
rules, and every row still has an open cell or a residue in the last column.
That is the honest state of the theory, and it is the number a roadmap should
be written against.

### On the undecidable column

The last column is the most valuable one in the table, and it is the reason the
table is worth publishing rather than an inflated one.

Everything in it belongs to externally executed test and process control, not
to a compiler verdict. Nerve can now retain evidence from those activities,
but it cannot perform them. Crimp height and pull force are measured on the
shop floor. Supplier lot variance is caught by incoming inspection.
Installation damage and how tightly a bundle is dressed are caught by build
inspection. Emissions and immunity are measured in a chamber. Available fault
current is a property of the vehicle's power system, not of the harness
drawing.

No amount of additional design modeling moves these cells. Recording the
result makes a unit history traceable; it does not make a clean compile a
substitute for the activity that produced the result. A tool that claimed
otherwise would be claiming to replace the inspection or test that catches the
failure. This column is the list of physical activities that a passing compile
says nothing about.

## What Nerve does not check

This section matters more than the table above. Every item here is a physical
review, inspection, qualification, or test that Nerve cannot perform. A clean
Nerve compile provides no evidence about any of them. Where a process record
can represent an external result, its meaning remains bounded by the supplied
authority, identity, and evidence.

- **Thermal derating of bundles.** The ampacity check derates its table by the
  number of current-carrying conductors that declare the same branch, which is
  a count and not a thermal model. It does not model bundle geometry, mutual
  heating, duty cycle, altitude, or ambient outside the one declared branch
  temperature, and a wire that declares no branch is not derated at all. A
  bundle in which every wire passes HK-WIRE-004 individually may still overheat.
- **Geometry and routing.** A branch can carry routed centerline waypoints, but
  Nerve has no model of the vehicle or enclosure around that line. There is no
  clearance analysis, interference or collision check, sag, vibration,
  chafe-point analysis, or proof that a route is physically achievable.
- **Mechanical fit and reach.** A branch length can be authored or measured
  from a routed centerline. Nerve does not verify that its wires reach their
  destinations in the installed system, compute service loops or dressing
  slack, or verify connector mating access, backshell clearance, or tooling
  reach.
- **EMC coupling.** HK-ELEC-008 reports that a wire classified `aggressor` and
  a wire classified `victim` share a branch. That is a bookkeeping check on
  labels a human applied. There is no field solving, no coupling or crosstalk
  calculation, no impedance, no shielding-effectiveness model, and no immunity
  or emissions prediction.
- **Crimp process verification.** Generic rules check that a terminal is
  selected, is compatible with the housing, accepts the wire's gauge, and
  closes on its insulation diameter. Build records and shop-floor events can
  retain caller-supplied height, width, pull force, force-curve references,
  material and tool lots, setup, operator, and disposition. Nerve does not take
  those measurements, establish their limits, authenticate their source, or
  inspect bell-mouth, brush position, insulation-support form, strand damage,
  applicator setup, or operator qualification. `TerminalPart` has fields for a
  crimp-height window and a pull force; no generic rule reads them and the
  bundled contact library populates neither.
- **Terminator and stub checks only where declared.** Bus topology conclusions
  follow from declared facts. Where a design does not declare a terminator, a
  port role, a stub length, or a protocol identity, the corresponding rules are
  silent. Silence is not a pass.
- **Physical part and supply data.** Nerve trusts the connector, terminal,
  seal, wire, and supply records it is given. The supply registry can preserve
  caller- or provider-supplied provenance, lifecycle, approval, availability,
  lead time, alternates, and price breaks in a deterministic snapshot. It does
  not query a distributor or manufacturer, verify an MPN against a datasheet,
  discover a lifecycle change, convert currencies, or confirm that a declared
  current, voltage, or gauge range matches the real component. The library
  that ships with Nerve is not exempt from that: four of its entries were wrong
  until they were read against manufacturer documents, and the record is under
  [what covered does not mean](#what-covered-does-not-mean).
- **Assembly, inspection, and test execution.** Nerve can generate a topology
  test plan, bind caller-supplied limits to it through an approved
  `TestSpecification`, export a generic tester program, ingest named-column
  result evidence, and preserve the result in a build record or unit event
  log. It does not operate a tester, perform continuity, hipot,
  insulation-resistance, or functional testing, validate a generic artifact
  against a specific machine, or prove that supplied evidence came from the
  named hardware. Measurements receive verdicts only against an approved,
  valid specification matched to the exact plan; otherwise they remain
  unassessed. The Cirris Easy-Wire-style pseudo-format is experimental,
  unvalidated against hardware, and excluded from built-in production adapter
  discovery.
- **Environmental and lifetime qualification.** No sealing or ingress-protection
  verification beyond "a seal is assigned, and where a seal record and a wire
  record both exist, its diameter window contains the wire". No fluid or
  chemical compatibility, no abrasion, no thermal or vibration cycling, no life
  prediction.
- **Anything absent from the model.** A fact that was never supplied cannot be
  checked. Nerve distinguishes unknown from absent-by-design precisely so that
  an unsupplied fact never reads as a verified one, but the practical
  consequence stands: coverage is bounded by what the design declares.

The evidence APIs change what Nerve can retain, not what a clean compile proves.
A measured centerline is not a model of the vehicle around it, a conductor
count is not a temperature, a contact's gauge range is not a crimp, an ingested
result is not proof of hardware execution, and a part's declared pinout is an
authority about pin assignment and nothing else on this list.

## On mapping to IPC/WHMA-A-620

A clause-by-clause coverage map against IPC/WHMA-A-620 is not provided here,
and its absence is deliberate.

IPC/WHMA-A-620 is a paywalled, purchase-only document. This repository does not
contain it, and neither the standard's text nor its clause numbering can be
established from anything in the repository. `docs/prd.md` §38 names
IPC/WHMA-A-620, IPC-D-620, NASA-STD-8739.4, and SAE-AS50881 as intended inputs
to future standards-informed rule packs, which is a roadmap entry and not
authority; the PRD does not name a revision, so the applicable revision is not
established here either. Publishing a mapping to clause numbers nobody here has
read would fabricate exactly the traceability this document exists to make
auditable.

Producing a real mapping requires the purchased standard and a qualified
reviewer working from it. `@grayhaven/nerve-interop` now provides a separate
profile for recording an exact issuer, document id, revision, addendum, scope,
source identity, applicability decision, parameter authority, reviewer, and
expected evidence. It distinguishes design requirements, workmanship
observations, and process evidence. The profile contains no licensed text,
tables, clause prose, acceptance values, or built-in compliant rule pack, and
it rejects vague `latest` revisions and compliance or certification claims.
Populating that profile does not establish that a built-in rule implements the
named document.

What can be said without the document is which A-620 subject areas have no
built-in acceptance rule or physical execution capability:

- **Crimp height and crimp width verification.** No built-in dimensional
  acceptance rule or physical measurement. A process record can retain values
  supplied by the caller.
- **Pull testing.** No built-in test criterion or physical test. A build
  record can retain caller-supplied target and actual pull force.
- **Inspection conditions.** No magnification, illumination, or inspection
  method requirements.
- **Soldering criteria.** No solder joint representation, wetting, or fillet
  acceptance.
- **Workmanship acceptance classes.** No class 1/2/3 distinction and no
  acceptance-condition photography or criteria.

Organizations that hold the standard can map their internal rule codes onto it
themselves. Exact-authority standards profiles are the vehicle for layered
requirements and evidence; per-rule provenance remains the vehicle for a claim
that a specific rule implements a named document.

## Changing a rule

When a rule's logic changes such that the same HIR can produce a different
verdict, bump that rule's `ruleVersion`. Reports pin the version that ran, so a
harness that passed under `1.0.0` and fails under `1.1.0` is a traceable event
rather than an unexplained regression.

Adding a `standard` or `clause` to a rule requires evidence in this repository
that the rule implements that document. `packages/nerve-rules/test/provenance.test.ts`
enforces the mechanical part of that: no clause without a standard, no empty
standard, and no PRD section masquerading as one. The judgment part is not
automatable, which is why the default is to leave the field empty.

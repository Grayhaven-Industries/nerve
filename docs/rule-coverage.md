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

45 rules are defined in `packages/nerve-rules/src/rules.ts`. 43 are active by
default in `builtinRules`; two (marked *opt-in*) must be registered
deliberately. Six more are defined in sibling modules and appended to the same
`builtinRules` array, so the pack ships 49 active rules over 51 defined codes;
they are tabulated under
[bus and return-path topology](#bus-and-return-path-topology) below. A rule
added to the pack in another module belongs in this table too — the table is
the coverage claim, and a rule missing from it is a check nobody outside the
codebase knows exists.

| Code | Rule | What it checks | Governing standard | Rule version |
| --- | --- | --- | --- | --- |
| HK-DOC-001 | missingRevision | The harness declares a non-empty revision. | Not established | 1.0.0 |
| HK-DOC-002 | branchMissingLabel | Every branch has a label attached to it. | Not established | 1.0.0 |
| HK-DOC-003 | spliceMissingNotes | Every splice declares a type, part, or manufacturing note. | Not established | 1.0.0 |
| HK-DOC-004 | requireApprovedParts *(opt-in)* | Every BOM part appears on the approved-MPN list the caller supplies. | Not established | 1.0.0 |
| HK-MFG-001 | missingWireLength | Every wire has a length, so the cut list can include it. | Not established | 1.0.0 |
| HK-MFG-002 | missingWireColor | Every wire has a color. | Not established | 1.0.0 |
| HK-MFG-003 | missingWireGauge | Every wire has a gauge. | Not established | 1.0.0 |
| HK-MFG-004 | gaugeOutsideConnectorRange | Wire gauge falls inside the connector's declared accepted gauge range. | Not established | 1.0.0 |
| HK-MFG-005 | breakoutTighterThanBendRadius | A branch's declared breakout distance is not shorter than its declared (or shop-profile) minimum bend radius. | Not established | 1.0.0 |
| HK-MFG-006 | bundleOverSleeveCapacity | Estimated bundle diameter, from member wire ODs and a packing factor, fits the declared sleeve. | Not established | 1.0.0 |
| HK-MFG-007 | unparseableGauge | Flags gauges the AWG-keyed checks cannot read, so a silently unchecked wire is visible. Well-formed metric gauges report as info. | Not established | 1.0.0 |
| HK-MFG-008 | nonPositiveWireLength | A supplied wire length is greater than zero. | Not established | 1.0.0 |
| HK-MFG-009 | branchParentInvalid | A branch's parent names a defined branch and the parent chain is acyclic. | Not established | 1.0.0 |
| HK-MFG-010 | cableConductorOverflow | A cable does not carry more member wires than it has conductors. | Not established | 1.0.0 |
| HK-MFG-011 | missingCableConductor | A wire that belongs to a cable identifies which conductor it uses. | Not established | 1.0.0 |
| HK-WIRE-004 | gaugeCurrentMismatch | A wire's declared current estimate is within the pack's ampacity value for its AWG (shop profiles may override the table). | Not established — in-house bundled-harness table, see above | 1.0.0 |
| HK-ELEC-001 | differentialPairNotTwisted | Both halves of a differential pair share a twist group. | Not established | 1.0.0 |
| HK-ELEC-002 | twistGroupTooSmall | A twist group contains at least two wires. | Not established | 1.0.0 |
| HK-ELEC-003 | missingGroundReturn | A harness carrying power signals also carries a ground return. | Not established | 1.0.0 |
| HK-ELEC-004 | shieldDrainUnconnected | A pin assigned a shield or drain signal has a wire landed on it. | Not established | 1.0.0 |
| HK-ELEC-005 | voltageRatingBelowSignal | A wire's declared voltage rating is at least the nominal voltage implied by its signal name. | Not established | 1.0.0 |
| HK-ELEC-006 | orphanedDifferentialHalf | A named bus half (CAN, RS-485, USB) has its partner somewhere in the harness. | Not established | 1.0.0 |
| HK-ELEC-007 | twistGroupGaugeMismatch | Wires in one twist group share a gauge. | Not established | 1.0.0 |
| HK-ELEC-008 | emcAggressorVictimShareBranch | Wires explicitly classified as aggressor and victim do not share a branch. Fires only on declared `emcClass`. | Not established | 1.0.0 |
| HK-ELEC-009 | wireTempBelowAmbient | A wire's declared temperature rating meets the declared ambient of every branch it runs through. | Not established | 1.0.0 |
| HK-ELEC-010 | overcurrentExceedsConductor | A protection device's rating does not exceed the ampacity of the thinnest conductor it protects. | Not established — same in-house table as HK-WIRE-004 | 1.0.0 |
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
| HK-CONN-016 | connectorCurrentExceeded | A wire's declared current estimate stays within the connector's declared contact current limit. | Not established | 1.0.0 |
| HK-CONN-017 | connectorVoltageExceeded | Voltage inferred from a rail-shaped signal name stays within the connector's declared voltage limit. Inference, so it warns. | Not established | 1.0.0 |
| HK-CONN-018 | multipleWiresIntoPin *(opt-in)* | Two or more wires of differing gauge crimped into one contact. Same-gauge double-crimps are legitimate and are not flagged. | Not established | 1.0.0 |
| HK-CONN-019 | contactCountExceedsPinCount | A connector declares no more pins than the housing has cavities. | Not established | 1.0.0 |
| HK-CONN-020 | cavityLayoutMismatch | A declared cavity grid multiplies out to exactly the housing's cavity count. | Not established | 1.0.0 |
| HK-CONN-021 | missingTerminal | Every wired cavity of a connector that publishes a terminal allow-list has a terminal MPN. | Not established | 1.0.0 |

The rule versions above are the committed ones. Two are being bumped to 1.1.0
in the working tree, both because the rule started deciding on a quantity the
compiler measures rather than one the author asserted: HK-WIRE-004 derates
ampacity by the conductor count of the branch, and HK-MFG-005 prefers a routed
centerline's computed curvature to the declared bend radius. Same HIR,
different verdict, which is exactly what `ruleVersion` exists to record.

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

Structural codes such as `HK-CONN-001`, `HK-WIRE-001`, `HK-BRANCH-001`,
`HK-SPLICE-001`, and `HK-CABLE-001` also appear in a review report. They are
compiler-owned invariants — reference integrity, unique identity, valid
quantities — not rules, so they carry no rule version and are not configurable.
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
laid out honestly, which is what this section does.

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
  deriving the answer from the graph or the physics. A `protects` list, an
  `emcClass` label, and a `compatibleTerminals` allow-list are all inputs
  somebody typed. See
  [declarations versus derivations](#declarations-versus-derivations).
- **none**: the tier's information would decide it and nothing checks it.
- **n/a**: the tier contributes nothing this row needs.

A partial cell reported as a full one is the failure mode this table exists to
prevent, so the shortfalls are spelled out rather than left to the word.

| Failure mode | Netlist alone | Plus full part data | Plus geometry | Plus thermal state | Undecidable from any design representation |
| --- | --- | --- | --- | --- | --- |
| Abrasion and chafe | n/a | partial: HK-MFG-006 | none | n/a | contact with surrounding structure, installation damage |
| Connector seal and corrosion | n/a | partial: HK-CONN-013, HK-CONN-014 | none | n/a | seating and latch at build, service exposure |
| Crimp failure | n/a | partial: HK-CONN-012, HK-CONN-021, HK-MFG-004, HK-CONN-018 | n/a | n/a | crimp height and width, pull force, applicator setup, operator |
| Thermal degradation | n/a | partial: HK-WIRE-004, HK-CONN-016 | none | declared: HK-ELEC-009 | duty cycle, airflow, soak in service |
| Vibration fatigue | n/a | none | none | n/a | excitation spectrum, mount stiffness, life |
| Wrong pin | checked: HK-CONN-010, HK-CONN-011, HK-CONN-015, HK-ELEC-006, HK-ELEC-012 to HK-ELEC-017 | none | n/a | n/a | whether the interface specification is itself correct |
| Wrong length | partial: HK-MFG-001, HK-MFG-008 | n/a | none, in flight | n/a | dressing and slack chosen at install |
| Wrong terminal | n/a | partial: HK-CONN-012, HK-CONN-021, HK-MFG-004 | n/a | n/a | substitution at the bench, supplier lot variance |
| Bus reflection | partial: HK-ELEC-018 to HK-ELEC-021 | none | none | n/a | transceiver margin over temperature |
| Ground loop | partial: HK-ELEC-003, HK-ELEC-022, HK-ELEC-023 | n/a | none | n/a | chassis impedance, external field |
| Protection coordination | declared: HK-ELEC-010 | none | n/a | none | available fault current, source impedance |
| EMC coupling and crosstalk | declared: HK-ELEC-001, HK-ELEC-004, HK-ELEC-007, HK-ELEC-008 | none | none | n/a | measured emissions and immunity |
| Insulation breakdown | partial: HK-ELEC-005 | partial: HK-CONN-017 | none | n/a | contamination, insulation damaged in service |
| Over-bend at a breakout | declared: HK-MFG-005 | n/a | none, in flight | n/a | how tightly the bundle is dressed at install |

### What each partial is short of

- **Abrasion and chafe.** HK-MFG-006 estimates a bundle diameter from an
  insulated-OD table and a packing factor and compares it to the declared
  sleeve. It answers "does the declared sleeve fit", never "is abrasion
  protection present where the route needs it". Nothing in the model represents
  what the harness touches, so the geometry tier stays empty even after routing
  exists.
- **Connector seal and corrosion.** HK-CONN-013 fires only when the housing
  declares `sealed: true`, and only for cavities a wire lands on. HK-CONN-014
  checks membership of a `compatibleSeals` list. Neither checks the seal
  against the wire's outer diameter, because a seal in HIR is a bare MPN string
  with no part record behind it, and nothing checks that unused cavities of a
  sealed housing are plugged, because cavity plugs are not modeled at all.
- **Crimp failure and wrong terminal.** HK-CONN-021 checks a terminal is
  named, HK-CONN-012 checks it appears on the housing's allow-list, and
  HK-MFG-004 checks the wire gauge against `wireGaugeRange`. That range belongs
  to the housing family, not to the selected terminal, which is exactly the
  category error [modeling principles](./modeling-principles.md) warns about: a
  housing's family gauge range cannot prove that a particular terminal accepts
  that wire. HK-CONN-018 catches two wires of differing gauge in one contact,
  and is opt-in.
- **Thermal degradation.** As committed, HK-WIRE-004 divides a declared current
  estimate by a single-value ampacity table that has bundling derating folded
  in as a constant, so conductor count is not an input and every wire in a
  bundle can pass individually. Work in flight in the working tree derates that
  table by the number of conductors declaring the same `branch`, and bumps the
  rule to 1.1.0 for it. Mutual heating, duty cycle, and altitude remain outside
  the model either way. HK-ELEC-009 compares a wire's rating to a branch's
  `ambientTemperatureC`, which is a number the author typed; nothing computes a
  temperature.
- **Wrong pin.** This is the one cell in the table that is complete, and it is
  complete about a narrow question: whether the design's own declarations agree
  with each other. HK-CONN-011 compares a wire's signal to the signal assigned
  to the pin it lands on, and both were written by the same author. The
  intended pinout of the device on the other side of the connector is not in
  the model, since `matingMpn` is a bare string with no pinout behind it. A
  consistently wrong pinout compiles clean.
- **Wrong length.** HK-MFG-001 checks a length is present and HK-MFG-008 checks
  it is positive. Nothing checks a length is right, because until a route
  exists there is nothing to check it against. Work is in flight in the working
  tree: `waypoints`, `routedLength`, and `routedMinBendRadius` are on
  `HirBranch`, the compiler measures them off an authored centerline, and
  `HK-BRANCH-004` reports a branch whose authored `nominalLength` contradicts
  its own waypoints. That closes the gap for a branch's length. Wire lengths
  stay authored numbers, so the row stays open.
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
- **Insulation breakdown.** HK-ELEC-005 and HK-CONN-017 both compare a rating
  to a voltage inferred from the signal name by a regex. HK-CONN-017 warns
  rather than errors for exactly that reason. Creepage and clearance are
  geometry and are absent.

### Declarations versus derivations

Some rules traverse the model and derive a conclusion. Others read a fact the
author asserted and check it for internal consistency. Both are useful, and
they carry different weight in a review, so the distinction is worth stating
per rule rather than leaving it to be discovered.

Rules that derive: HK-ELEC-022 walks the ground subgraph, HK-ELEC-020 and
HK-ELEC-021 walk the bus graph for degree, rings, stubs, and weighted diameter,
HK-ELEC-011 walks nets to accessible pins, HK-MFG-009 walks the branch parent
chain for cycles, HK-MFG-006 computes a bundle diameter from member wires.

Rules whose subject is a declaration:

- **HK-ELEC-010** compares a device rating to the thinnest wire in the author's
  `protects` list. The schema says the link is explicit so the rule never has to
  infer current direction from an undirected graph, which is sound as a design
  choice and means a conductor left out of the list is unprotected and
  unreported. Traversal past the declared list is planned in the working tree
  and is not implemented in the rule as read, so the cell stays declared.
- **HK-ELEC-008** reports that a wire labeled `aggressor` and a wire labeled
  `victim` share a branch. It is a bookkeeping check on labels a human applied.
- **HK-ELEC-012 to HK-ELEC-017** propagate declared port semantics and report
  contradictions. An unknown role suppresses the undriven-load conclusion by
  design, so silence here means unknown, not clear.
- **HK-CONN-012, HK-CONN-014, HK-CONN-021** check membership of allow-lists
  that arrive with the connector part, so the check is only as good as the
  library entry.
- **HK-CONN-013** depends on a `sealed: true` flag, and **HK-ELEC-018** and
  **HK-ELEC-019** depend on a `terminationOhms` declared per pin.
- **HK-MFG-005** compares two authored numbers as committed. In the working
  tree it prefers the compiler's `routedMinBendRadius` when the branch is
  routed and falls back to the asserted radius otherwise, which is the first
  rule in the pack to judge a branch on a measured quantity rather than a
  claimed one. It is bumped to 1.1.0 for that reason.

### What the matrix implies about what to build next

The table has 14 rows and 5 columns. One column is the undecidable residue and
is not a work item, leaving 56 decision cells, of which 25 are n/a for their
row. That leaves 31 live cells. Nerve fires in 15 of them: one checked, ten
partial, four declared. Sixteen live cells have nothing.

Sorted by column, the shape of the remaining work is not a matter of opinion:

- **Netlist alone: 8 live cells, and Nerve is in all 8.** The cheap tier is
  exhausted. Nothing further is available at this tier without new information,
  which means every remaining improvement has an acquisition cost attached, and
  the ranking below is a ranking of those costs.
- **Full part data: 11 live cells, 6 partial, 5 empty.** This is the cheapest
  remaining tier and the partials share one cause. `HirConnector` and
  `HirWirePart` are full part records; a terminal and a seal are bare MPN
  strings on `HirPin`. That single asymmetry is what blocks the terminal wire
  range, the seal-to-wire-OD fit, and the crimp specification, so one schema
  change moves three cells at once. A mating-connector pinout, also part data,
  is what would close the wrong-pin row against something other than the
  design's own restatement of itself.
- **Geometry: 10 live cells, none covered as committed.** The largest single
  jump, and the table argues against taking it first for coverage reasons. A
  routed centerline is one kind of geometry and the cells want three. The
  in-flight waypoint work converts exactly two of the ten, wrong length and
  over-bend at a breakout. Four more need the structure the harness is
  installed in (chafe, seal and mating access, vibration mounts, loop area) and
  four need the bundle's internal cross-section (mutual heating, conductor
  spacing, creepage, sleeve fit along the route). Neither of those follows from
  a centerline through space. The two the centerline does convert are worth
  having on their own merits, since a cut list is where a wrong number gets
  expensive, but they should not be counted as an entry into chafe, fit,
  vibration, or signal integrity.
- **Thermal state: 2 live cells.** One is served by a declared ambient, and the
  other, thermal derating of the protection device itself, is empty. It is the
  smallest tier in the table. The in-flight bundle derating improves the part
  data cell it sits next to rather than adding a cell here, because a conductor
  count is not a temperature.

Two counts about the rule set itself follow from the same exercise. Of the 51
defined codes, 37 appear somewhere in the matrix. The other 14 make no claim
about a field failure mode at all: HK-DOC-001 to HK-DOC-004, HK-MFG-002,
HK-MFG-003, HK-MFG-007, HK-MFG-009, HK-MFG-010, HK-MFG-011, HK-ELEC-002,
HK-ELEC-011, HK-CONN-019, and HK-CONN-020 keep the model well formed, keep the
harness documented, or keep it testable. That is not padding, and HK-MFG-007
earns its place twice over: it reports gauges the AWG-keyed rules cannot read,
which makes a silently unchecked wire visible instead of letting it pass as a
checked one.

And no row of the matrix is fully decided. Fourteen failure modes, 49 active
rules, and every row still has an open cell or a residue in the last column.
That is the honest state of the theory, and it is the number a roadmap should
be written against.

### On the undecidable column

The last column is the most valuable one in the table, and it is the reason the
table is worth publishing rather than an inflated one.

Everything in it belongs to test and process control, not to a compiler. Crimp
height and pull force are measured on the shop floor. Supplier lot variance is
caught by incoming inspection. Installation damage and how tightly a bundle is
dressed are caught by build inspection. Emissions and immunity are measured in
a chamber. Available fault current is a property of the vehicle's power system,
not of the harness drawing.

No amount of additional modeling moves these cells. A tool that claimed them
would be claiming to replace the activities that actually catch them, and the
first person harmed by that claim is whoever writes a clean compile into a
process control plan as evidence that the corresponding inspection is no longer
required. It is not, and this column is the list of inspections that a passing
Nerve run says nothing about.

## What Nerve does not check

This section matters more than the table above. Every item here is a review
activity that Nerve cannot perform and does not attempt. A clean Nerve compile
provides no evidence about any of them.

- **Thermal derating of bundles.** The ampacity check compares one wire's
  declared current estimate against a single-value table. It does not model
  conductor count, bundle geometry, mutual heating, duty cycle, altitude, or
  ambient outside the one declared branch temperature. A bundle in which every
  wire passes HK-WIRE-004 individually may still overheat.
- **Geometry and routing.** Nerve has no 3D model. Branch paths are topology,
  not curves. There is no clearance analysis, no interference or collision
  check, no sag, no vibration, no chafe-point analysis, and no check that a
  route is physically achievable in the vehicle or enclosure.
- **Mechanical fit and reach.** Wire lengths are numbers on a cut list. Nerve
  does not verify that a length reaches its destination along the real route,
  does not compute service loops or slack, and does not verify connector
  mating access, backshell clearance, or tooling reach.
- **EMC coupling.** HK-ELEC-008 reports that a wire classified `aggressor` and
  a wire classified `victim` share a branch. That is a bookkeeping check on
  labels a human applied. There is no field solving, no coupling or crosstalk
  calculation, no impedance, no shielding-effectiveness model, and no immunity
  or emissions prediction.
- **Crimp process verification.** Nerve checks that a terminal is selected and
  compatible with the housing. It says nothing about crimp height, crimp width,
  pull-off force, bell-mouth, brush position, insulation-support form, wire
  strand damage, applicator setup, or operator certification. Those are
  measured on the shop floor, not derived from a model.
- **Terminator and stub checks only where declared.** Bus topology conclusions
  follow from declared facts. Where a design does not declare a terminator, a
  port role, a stub length, or a protocol identity, the corresponding rules are
  silent. Silence is not a pass.
- **Physical part data.** Nerve trusts the connector, terminal, seal, and wire
  data it is given. It does not verify an MPN against a manufacturer datasheet,
  does not detect obsolete or superseded parts, and does not confirm that a
  declared current, voltage, or gauge range matches the real component.
- **Assembly, inspection, and test execution.** Nerve generates a test plan
  from the model's accessible endpoints. It does not perform continuity,
  hipot, insulation-resistance, or functional testing, and it has no knowledge
  of whether any test was run or passed.
- **Environmental and lifetime qualification.** No sealing or ingress-protection
  verification beyond "a seal is assigned", no fluid or chemical compatibility,
  no abrasion, no thermal or vibration cycling, no life prediction.
- **Anything absent from the model.** A fact that was never supplied cannot be
  checked. Nerve distinguishes unknown from absent-by-design precisely so that
  an unsupplied fact never reads as a verified one, but the practical
  consequence stands: coverage is bounded by what the design declares.

These items describe committed behavior. Two of them are moving in the working
tree and neither moves far: a branch can now carry an authored 3D centerline
that the compiler measures for length and curvature, and the ampacity table can
now be derated by the conductor count on a branch. A measured centerline is
still not a model of the vehicle around it, and a conductor count is still not
a temperature, so every bullet above stands as written.

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
reviewer working from it, and it belongs in a licensed standards rule pack that
records the standard name, revision, and clause per rule — the mechanism the
`standard` and `clause` fields already provide.

What can be said without the document is which A-620 subject areas Nerve
provably does not touch, because Nerve has no representation of them at all:

- **Crimp height and crimp width verification** — no dimensional measurement of
  a formed crimp.
- **Pull testing** — no pull-force values, criteria, or results anywhere in the
  model.
- **Inspection conditions** — no magnification, illumination, or inspection
  method requirements.
- **Soldering criteria** — no solder joint representation, wetting, or fillet
  acceptance.
- **Workmanship acceptance classes** — no class 1/2/3 distinction, and no
  acceptance-condition photography or criteria.

Organizations that hold the standard can map their internal rule codes onto it
themselves; the per-rule provenance fields are the intended vehicle for that.

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

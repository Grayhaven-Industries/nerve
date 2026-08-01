# Rule coverage

This document exists so that someone who has to sign a process control plan can
determine what Nerve actually checks, on whose authority, and — more
importantly — what it does not check. A clean compile is evidence that a
specific list of deterministic checks passed over the facts that were supplied.
It is not a certification, and it is not a substitute for the review activities
listed under [What Nerve does not check](#what-nerve-does-not-check).

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

**Every rule below reads "not established" in the standard column.** That is a
statement about evidence, not a gap in effort. These rules are structural and
engineering-consistency invariants of Nerve's own model: a cavity count against
a housing, a reserved pin put into service, a differential half with no partner.
They derive from the model described in
[modeling principles](./modeling-principles.md), not from a governing document,
and most of them have no governing document to derive from.

The two rules that look standards-shaped are not. `HK-WIRE-004` and
`HK-ELEC-010` consult the ampacity table in `packages/nerve-rules/src/wire-data.ts`,
which documents itself as "conservative bundled-harness values (chassis-wiring
tables derated for bundling)" with standards-informed data explicitly deferred
to a future rule pack. That table is the rule's basis; no standard is. Naming
one would convert an in-house engineering table into an authority claim.

A `standard` is added to a rule only when this repository contains the evidence
that the rule implements that document. Guessing a plausible standard name,
revision, or clause would destroy the one property this table exists to
provide, so where the basis is not established the field is left empty.

## Built-in rules

45 rules are defined in `packages/nerve-rules/src/rules.ts`. 43 are active by
default in `builtinRules`; two (marked *opt-in*) must be registered
deliberately. A rule added to the pack in another module belongs in this table
too — the table is the coverage claim, and a rule missing from it is a check
nobody outside the codebase knows exists.

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

Structural codes such as `HK-CONN-001`, `HK-WIRE-001`, `HK-BRANCH-001`,
`HK-SPLICE-001`, and `HK-CABLE-001` also appear in a review report. They are
compiler-owned invariants — reference integrity, unique identity, valid
quantities — not rules, so they carry no rule version and are not configurable.
Plugins and rule packs registered by a project can contribute further codes
beyond this table; the report lists the codes that were actually run.

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

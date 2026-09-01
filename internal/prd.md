# PRD: Grayhaven Nerve - Wiring Harnesses as Code

## 1. Summary

Nerve is a TypeScript-first product for designing, validating, rendering, documenting, and manufacturing wiring harnesses from code. It turns harness design into a version-controlled, composable, type-safe workflow that produces visual diagrams, BOMs, cut lists, label schedules, connector pinout tables, build instructions, and continuity-test procedures.

The core product thesis is simple:

```text
Typed harness specification -> compiler -> validation -> visual rendering -> manufacturing outputs -> test artifacts
```

The initial product should focus on engineering teams building robotics, drones, industrial automation systems, lab automation equipment, test fixtures, vehicle subsystems, and low-to-mid-volume electronics products.

Nerve is not intended to replace every electrical CAD or MCAD system. It should become the code-native source of truth for harness topology, connectivity, documentation, and repeatable production outputs.

### 1.1 Brand Architecture and Naming

The product should use a sharper Grayhaven-native name rather than a generic enterprise label. The public product name is **Grayhaven Nerve**. The short name is **Nerve**.

Rationale:

1. Grayhaven Industries already positions wire harnesses and cable assemblies as the nervous system of machines. The software should make that metaphor concrete.
2. The name is short, industrial, memorable, and closer to defense-tech product naming than “Interconnect Studio.”
3. “Nerve” can cover design, manufacturing, test, traceability, component data, and future machine integration without sounding like a narrow CAD plugin.
4. “Interconnect” should remain a category descriptor, not the primary product brand.

Recommended brand hierarchy:

```text
Grayhaven Industries
  └─ Grayhaven Nerve
       ├─ Nerve: web application and visual editor
       ├─ Nerve Compiler: deterministic TypeScript-to-HIR compiler
       ├─ Nerve CLI: local and CI command-line tooling
       ├─ Nerve Registry: connectors, terminals, wire, labels, rule packs, templates, and process data
       ├─ Nerve Harness IR: canonical intermediate representation
       └─ Nerve Build Record: release, manufacturing, test, and as-built traceability record
```

Naming rules:

1. Use **Grayhaven Nerve** on first mention in public product, sales, website, and documentation contexts.
2. Use **Nerve** as the short product name after first mention.
3. Use **Nerve Compiler** for the deterministic compiler/runtime that converts source designs into HIR and generated artifacts.
4. Use **Nerve Registry** for reusable components, verified connector data, rule packs, process templates, and package distribution.
5. Use **Nerve Build Record** for serialized release and as-built manufacturing evidence.
6. Use **nerve** as the default CLI binary name.
7. Use the npm namespace **@grayhaven/nerve** and related packages such as **@grayhaven/nerve-connectors**.
8. Avoid generic external naming such as “Harness App,” “Wire Harness Tool,” “Cable Builder,” “HarnessKit,” or “Interconnect Studio.”
9. Use “interconnect” only as a category word, for example “spec-driven interconnect,” “interconnect manufacturing,” or “machine interconnect.”

Primary positioning:

```text
Grayhaven Nerve
Harnesses as code for machines that need a nervous system.
```

Secondary positioning:

```text
From pinout to production: wiring, BOMs, labels, tests, and build records from one typed source of truth.
```

Long-form positioning:

```text
Grayhaven Nerve turns a machine's electrical nervous system into typed, validated, manufacturable infrastructure. Define the harness once, then generate the drawings, cut lists, labels, tests, build records, and shop-floor outputs needed to ship it.
```

The phrase “harnesses as code” should remain the technical thesis. The external brand should be **Grayhaven Nerve**: terse, industrial, and tied directly to Grayhaven Industries.

## 2. Product Goals

### 2.1 Primary goals

1. Allow engineers to describe wiring harnesses in TypeScript using a clear, composable domain model.
2. Generate high-quality harness drawings and connector pinout views from the same source of truth.
3. Catch wiring mistakes before manufacturing through strict validation and domain-specific linting.
4. Generate production-ready artifacts: BOMs, Bills of Process, wire cut lists, label schedules, assembly instructions, tester outputs, as-built templates, and test procedures.
5. Make harness designs reusable through packages, templates, typed libraries, and parametric components.
6. Support Git-native hardware workflows: reviewable diffs, CI validation, generated artifacts, and versioned releases.
7. Provide a modern web editor built with React, TanStack, Vite, and Effect.
8. Treat verified component compatibility, process planning, release impact analysis, and as-built traceability as core product capabilities rather than afterthoughts.
9. Model shop-floor outputs and system interface contracts as first-class product artifacts.

### 2.2 Secondary goals

1. Support interactive editing without sacrificing code-first workflows.
2. Enable import and export to common file formats used by technicians, contract manufacturers, and procurement teams.
3. Provide a path toward automated testing with continuity testers, relay boards, and production fixtures.
4. Support AI-assisted harness generation and repair later, but keep deterministic compiler behavior as the foundation.

## 3. Non-goals

1. Full MCAD routing inside mechanical assemblies.
2. Full SPICE-level electrical simulation.
3. Replacing enterprise PLM, ERP, or procurement systems.
4. Building a complete automotive-grade harness suite in the first product scope.
5. Real-time collaborative editing in the first product scope.
6. Automatic harness routing through complex 3D geometry.
7. Replacing PCB CAD systems.
8. Owning supplier purchasing or fulfillment directly.

## 4. Target Users

### 4.1 Hardware engineer

Designs the electrical topology of a product or subsystem. Needs confidence that connectors, pins, wires, shielding, and labels are correct.

Primary jobs:

- Define connectors and pinouts.
- Map signals to physical wires.
- Review harness diagrams.
- Validate current, voltage, gauge, color, and shield constraints.
- Export manufacturing packets.

### 4.2 Robotics or embedded systems engineer

Works across electronics, firmware, mechanical integration, and test rigs. Needs fast iteration and reproducibility.

Primary jobs:

- Create harnesses for sensors, motors, batteries, actuators, controllers, and test fixtures.
- Version harnesses alongside firmware and mechanical design.
- Generate build instructions for lab technicians.
- Build repeatable variants of the same base harness.

### 4.3 Manufacturing technician

Builds harnesses from generated instructions. Needs clear drawings, label placement, wire lengths, connector orientations, and test steps.

Primary jobs:

- Read a build book.
- Cut wires to length.
- Crimp terminals.
- Assemble connectors.
- Apply labels and heat shrink.
- Run continuity and pinout tests.

### 4.4 Operations or procurement user

Needs reliable BOMs, part alternates, supplier metadata, and revision traceability.

Primary jobs:

- Export BOMs.
- Review required terminals, connectors, wire, tubing, labels, and tooling.
- Track approved parts and alternates.
- Compare revisions.

### 4.5 Contract manufacturer

Receives the manufacturing packet and needs unambiguous instructions.

Primary jobs:

- Manufacture from drawings and cut lists.
- Verify against continuity-test procedures.
- Report build issues with exact design references.

## 5. Core User Problems

### 5.1 Harness designs are split across too many artifacts

A single harness often lives across spreadsheets, screenshots, connector datasheets, CAD drawings, PDF markups, wire lists, and technician notes. These artifacts drift out of sync.

Nerve should create one typed source of truth that can generate all derived artifacts.

### 5.2 Existing tools are either too manual or too enterprise-heavy

Many teams either use manual diagrams and spreadsheets or heavyweight enterprise electrical CAD. Small and mid-sized teams need something lighter, programmable, and Git-native.

### 5.3 Wiring errors are expensive

Common mistakes include swapped pins, incorrect terminal part numbers, missing shields, inconsistent colors, insufficient wire gauge, unlabeled branches, bad splice definitions, missing strain relief, and stale build instructions.

Nerve should detect these issues before a technician starts building.

### 5.4 Reusable harness design is hard

Teams repeatedly build similar harnesses for sensors, motors, CAN devices, test fixtures, and controller boards. Without a composable design system, reuse happens through copy-paste.

Nerve should make harness templates, connector libraries, signal conventions, and validation rules reusable TypeScript packages.

## 6. Product Principles

1. Code is the source of truth.
2. Visuals are generated, inspectable, and editable through structured changes.
3. Every generated artifact must trace back to a typed object in the design graph.
4. Errors should be precise, actionable, and linked to both code and rendered views.
5. The product should support professional manufacturing outputs, not just pretty diagrams.
6. Libraries and templates should feel like npm packages, not copied reference files.
7. The compiler must be deterministic.
8. The UI should never hide domain logic in opaque state.
9. All core operations should work locally before cloud services are required.
10. AI assistance can accelerate design, but deterministic validation owns correctness.

## 7. Product Scope

### 7.1 In scope

- TypeScript DSL for harness design.
- Connector, pin, terminal, seal, backshell, wire, cable, splice, shield, branch, bundle, label, and BOM modeling.
- Harness compiler that produces an intermediate representation.
- Static validation and linting.
- 2D schematic rendering.
- Connector face and pinout rendering.
- Harness board or nailboard-style rendering.
- BOM generation.
- Wire cut list generation.
- Label schedule generation.
- Assembly instruction generation.
- Continuity-test procedure generation.
- Web editor with code, diagram, data tables, diagnostics, and export views.
- CLI for compile, validate, render, and export.
- Package/library system using normal TypeScript and npm-compatible workflows.

### 7.2 Out of scope for initial product

- 3D routing inside CAD assemblies.
- Native ECAD integration beyond imports and exports.
- Automated supplier quoting.
- Multi-user live editing.
- Full PLM approvals.
- Automotive OEM-specific compliance suites.
- Safety certification workflows.

## 8. Key Use Cases

### 8.1 Create a harness from code

An engineer writes a TypeScript file defining connectors, signals, wires, branches, labels, and parts. The compiler validates the design and renders diagrams.

Success criteria:

- The harness compiles without errors.
- The UI shows a schematic and harness-board view.
- Generated outputs are consistent with the code.

### 8.2 Generate a manufacturing packet

An engineer exports a revisioned zip containing drawings, BOM, cut list, label schedule, assembly instructions, and continuity tests.

Success criteria:

- The exported packet can be handed to a technician or contract manufacturer.
- Every artifact includes design revision metadata.
- Every BOM and instruction line traces back to a design object.

### 8.3 Validate connector pinouts

An engineer defines connectors and pin assignments. Nerve checks missing pins, duplicate assignments, incompatible terminals, undefined mating connectors, swapped differential pairs, and reserved pins.

Success criteria:

- Errors identify the exact connector, pin, signal, and source location.
- The rendered connector view highlights the issue.

### 8.4 Build variants

An engineer creates a base harness and derives variants for different product SKUs or sensor configurations.

Success criteria:

- Variants share reusable definitions.
- Differences are visible in generated diff views and exported artifacts.
- Validation rules apply consistently across variants.

### 8.5 Run production tests

A technician runs a generated test procedure that verifies continuity, shorts, resistance limits, and expected pin mappings.

Success criteria:

- The test procedure maps each logical connection to physical connector pins.
- Pass/fail results can be exported as JSON or CSV.
- Failed tests reference exact wires and endpoints.

## 9. Functional Requirements

## 9.1 TypeScript authoring model

Nerve must provide a TypeScript library for defining harnesses. The API should support both declarative object definitions and composable helper functions.

Example target authoring style:

```ts
import { harness, connector, wire, branch, label, bom } from "@grayhaven/nerve";
import { MolexMicroFit } from "@grayhaven/nerve-connectors";

const controller = connector("J1", MolexMicroFit["43025-0800"], {
  pins: {
    1: "VBAT_24V",
    2: "GND",
    3: "CAN_H",
    4: "CAN_L",
    5: "ENC_A",
    6: "ENC_B",
    7: "MOTOR_TEMP",
    8: "SHIELD_DRAIN",
  },
});

const motor = connector("M1", MolexMicroFit["43020-0800"], {
  pins: {
    1: "VBAT_24V",
    2: "GND",
    3: "CAN_H",
    4: "CAN_L",
    5: "ENC_A",
    6: "ENC_B",
    7: "MOTOR_TEMP",
    8: "SHIELD_DRAIN",
  },
});

export default harness("motor-controller-harness", {
  revision: "A",
  units: "mm",
  connectors: [controller, motor],
  wires: [
    wire("W1", controller.pin(1), motor.pin(1), {
      gauge: "18AWG",
      color: "red",
      length: 420,
      signal: "VBAT_24V",
    }),
    wire("W2", controller.pin(2), motor.pin(2), {
      gauge: "18AWG",
      color: "black",
      length: 420,
      signal: "GND",
    }),
    wire("W3", controller.pin(3), motor.pin(3), {
      gauge: "24AWG",
      color: "white",
      twistGroup: "CAN_PAIR",
      signal: "CAN_H",
    }),
    wire("W4", controller.pin(4), motor.pin(4), {
      gauge: "24AWG",
      color: "blue",
      twistGroup: "CAN_PAIR",
      signal: "CAN_L",
    }),
  ],
  branches: [
    branch("main", {
      path: [controller, motor],
      sleeve: "braided-pet",
      nominalLength: 420,
    }),
  ],
  labels: [
    label("L1", {
      text: "MOTOR CTRL A",
      attachTo: "main",
      offsetFrom: controller,
      distance: 50,
    }),
  ],
});
```

### Acceptance criteria

- Users can define a complete harness in TypeScript.
- Definitions are type-checked by TypeScript before compilation.
- Runtime validation still catches invalid values that TypeScript cannot prove.
- Source maps link diagnostics to exact source locations where practical.
- The same design can be compiled by the CLI and the web editor.

## 9.2 Domain model

Nerve must model the following entities.

### Harness

Fields:

- ID
- Name
- Revision
- Units
- Metadata
- Connectors
- Wires
- Cables
- Branches
- Bundles
- Splices
- Labels
- Shielding
- Looming
- BOM overrides
- Validation rules
- Export options

### Connector

Fields:

- Reference designator
- Manufacturer part number
- Family
- Housing type
- Gender
- Pin count
- Pin numbering scheme
- Cavity layout
- Mating connector
- Compatible terminals
- Compatible seals
- Compatible backshells
- Orientation metadata
- Mounting metadata

### Pin or cavity

Fields:

- Pin number
- Signal name
- Electrical role
- Terminal part number
- Seal part number
- Wire gauge constraints
- Current limit
- Voltage limit
- Reserved status
- Required status
- Notes

### Wire

Fields:

- Wire ID
- Source endpoint
- Destination endpoint
- Gauge
- Color
- Stripe color
- Length
- Length tolerance
- Signal name
- Insulation type
- Voltage rating
- Temperature rating
- Current estimate
- Twist group
- Shield group
- Branch membership
- Label references
- Notes

### Cable

Fields:

- Cable ID
- Cable type
- Number of conductors
- Conductor map
- Shield type
- Jacket material
- Outer diameter
- Bend radius
- Cut length
- Breakout definitions

### Splice

Fields:

- Splice ID
- Joined wires
- Splice type
- Crimp or solder sleeve part
- Location along branch
- Seal or heat shrink requirements
- Inspection notes

### Branch

Fields:

- Branch ID
- Parent branch
- Child branches
- Length
- Path endpoints
- Bundle diameter estimate
- Sleeve or conduit
- Breakout distance
- Label positions
- Bend radius constraints

### Label

Fields:

- Label ID
- Text
- Format
- Placement target
- Offset
- Material
- Printer profile
- Quantity
- Orientation

### BOM item

Fields:

- Internal part ID
- Manufacturer part number
- Description
- Quantity
- Unit of measure
- Approved alternates
- Supplier links
- Lifecycle status
- Notes

## 9.3 Compiler and intermediate representation

Nerve must compile TypeScript definitions into a normalized harness intermediate representation, hereafter called HIR.

The HIR should be deterministic, serializable, and suitable for rendering, validation, exporting, and testing.

Required HIR outputs:

- `harness.json`
- `graph.json`
- `diagnostics.json`
- `bom.json`
- `cut-list.json`
- `label-schedule.json`
- `test-plan.json`
- `render-layout.json`

### Acceptance criteria

- Given the same input and dependency lockfile, compilation produces the same HIR.
- HIR can be serialized to JSON and reloaded without executing user code.
- Renderers and exporters consume HIR, not arbitrary user TypeScript.
- Diagnostics include stable error codes.

## 9.4 Validation and linting

Nerve must provide built-in validation rules and allow users to define custom rules.

### Required built-in validation rules

Connectivity:

- Undefined connector reference.
- Undefined pin reference.
- Duplicate wire ID.
- Duplicate connector reference.
- Duplicate branch ID.
- Wire endpoint mismatch.
- Unconnected required pin.
- Signal assigned to incompatible pin role.
- Duplicate signal on mutually exclusive pins.

Electrical sanity:

- Wire gauge below configured current requirement.
- Voltage rating below signal requirement.
- Missing ground return for power group.
- CAN, RS-485, USB, Ethernet, or differential pair not twisted where required.
- Shield drain missing or connected incorrectly.
- High-current wire assigned to incompatible terminal.

Manufacturing:

- Missing wire length.
- Missing wire color.
- Missing terminal part number.
- Missing seal for sealed connector.
- Wire gauge incompatible with terminal.
- Missing label on branch or connector where label rules require it.
- Bend radius violation.
- Bundle diameter exceeds sleeve capacity.

Documentation:

- Missing revision.
- Missing part metadata.
- Missing connector orientation.
- Missing manufacturing notes for splice.
- Missing test coverage for required nets.

### Custom rule API

Custom rules should be normal TypeScript functions that run against HIR.

```ts
import { rule, DiagnosticSeverity } from "@grayhaven/nerve";

export const requireAllCanPairsTwisted = rule("require-can-pairs-twisted", (ctx) => {
  for (const pair of ctx.harness.signalGroups.byProtocol("CAN")) {
    if (!pair.twistGroup) {
      ctx.report({
        severity: DiagnosticSeverity.Error,
        message: `CAN pair ${pair.id} must be assigned to a twist group`,
        target: pair.id,
      });
    }
  }
});
```

### Acceptance criteria

- Validation errors are shown in the CLI and web editor.
- Diagnostics link to rendered elements where possible.
- Users can suppress or configure specific rules.
- Custom rules can be packaged and reused.

## 9.5 Rendering requirements

Nerve must generate multiple visual representations from HIR.

### 9.5.1 Schematic wiring diagram

Purpose:

- Show logical connectivity between connectors, splices, cables, shields, and branches.

Required features:

- Connector blocks.
- Pin labels.
- Wire labels.
- Signal names.
- Wire colors.
- Gauge annotations.
- Splice symbols.
- Shield groups.
- Cable jackets.
- Error highlighting.
- Pan, zoom, search, and selection.

### 9.5.2 Connector face view

Purpose:

- Show physical pin/cavity layout for assembly and inspection.

Required features:

- Front and rear orientation.
- Pin numbering.
- Cavity population state.
- Wire color per cavity.
- Signal per cavity.
- Terminal and seal part metadata.
- Orientation markers.

### 9.5.3 Harness board or nailboard view

Purpose:

- Show approximate physical branch layout for technicians.

Required features:

- Branch paths.
- Breakout lengths.
- Connector endpoints.
- Labels and label offsets.
- Splice locations.
- Sleeve and conduit callouts.
- Cut lengths and tolerances.
- Printable scale mode where supported.

### 9.5.4 Data table views

Purpose:

- Let users inspect generated structured outputs.

Required tables:

- Connector table.
- Pinout table.
- Wire list.
- Cut list.
- BOM.
- Label schedule.
- Test plan.
- Diagnostics.

### Rendering technology direction

The web app should use modern React libraries and a Vite build pipeline.

Recommended approach:

- React for component architecture.
- TanStack Router for application routing.
- TanStack Query for server and worker-state synchronization.
- TanStack Table for BOM, cut list, label schedule, diagnostics, and test plan tables.
- TanStack Form for structured editors where forms are needed.
- Vite for the web build and local dev server.
- Canvas or SVG rendering for diagrams depending on performance and export requirements.
- Web Workers for compile, layout, and export tasks that could block the UI.
- A renderer abstraction so diagrams can be exported to SVG, PDF, PNG, and print-oriented formats.

Implementation note:

- The rendering layer should not be the source of truth.
- The renderer consumes HIR plus layout metadata.
- Manual layout adjustments should write structured layout hints back into the design, not mutate opaque canvas state.

## 9.6 Web editor requirements

The web editor should provide a professional local-first design environment.

### Required views

1. Project explorer.
2. TypeScript source editor.
3. Diagnostics panel.
4. Schematic view.
5. Connector face view.
6. Harness board view.
7. BOM table.
8. Cut list table.
9. Label schedule table.
10. Test plan table.
11. Export panel.

### Required interactions

- Open local project.
- Compile project.
- View diagnostics.
- Click diagnostic to highlight source and rendered object.
- Select rendered connector, wire, branch, splice, or label.
- Inspect selected object metadata.
- Search by signal, wire ID, connector reference, pin, part number, or label.
- Export manufacturing packet.
- Export individual artifacts.
- View design revision metadata.

### Code editor

Recommended capabilities:

- TypeScript syntax highlighting.
- Inline diagnostics.
- Jump to definition for local symbols where practical.
- Format on save.
- Generated HIR preview.
- Read-only mode for generated files.

### Acceptance criteria

- A user can author and compile a complete harness without leaving the web app.
- A user can inspect all generated manufacturing outputs in the web app.
- A user can export a complete manufacturing packet.
- Large harnesses remain responsive because compilation and layout run outside the main UI thread.

## 9.7 CLI requirements

The CLI should support local development, CI, and artifact generation.

Required commands:

```bash
nerve init
nerve compile ./src/main.harness.ts
nerve validate ./src/main.harness.ts
nerve render ./src/main.harness.ts --format svg
nerve export ./src/main.harness.ts --target manufacturing-packet
nerve diff ./revisions/A ./revisions/B
nerve inspect ./dist/harness.json
```

### Acceptance criteria

- CLI exits nonzero on validation errors.
- CLI can generate all artifacts without launching the web editor.
- CLI output is deterministic.
- CLI is suitable for CI.

## 9.8 Export requirements

Nerve must generate production-ready outputs.

### Required export formats

Structured:

- JSON HIR.
- CSV BOM.
- CSV cut list.
- CSV label schedule.
- CSV test plan.

Visual:

- SVG schematic.
- SVG connector views.
- SVG harness board view.
- PNG preview.
- PDF manufacturing packet.

Package:

- Zip archive containing all exported artifacts.

### Manufacturing packet contents

The manufacturing packet should include:

1. Cover page with harness name, revision, date, author, and project metadata.
2. Revision history.
3. Schematic wiring diagram.
4. Connector face views.
5. Harness board view.
6. BOM.
7. Wire cut list.
8. Terminal and seal table.
9. Label schedule.
10. Splice table.
11. Assembly instructions.
12. Continuity-test procedure.
13. Generated machine-readable HIR.

### Acceptance criteria

- Exported files include revision metadata.
- Exported files are reproducible from the same input.
- PDF packet is readable without the app.
- CSV outputs are importable into spreadsheet and ERP workflows.

## 9.9 Test procedure generation

Nerve should generate a continuity-test plan from the harness graph.

Required test types:

- Point-to-point continuity.
- No-short checks between unrelated nets.
- Shield drain checks.
- Splice verification.
- Optional resistance threshold checks.
- Optional pin-to-shell checks.

Test plan output should support:

- Human-readable table.
- JSON format for future instrument automation.
- CSV format for manual test tracking.

Example generated test object:

```json
{
  "id": "T-001",
  "type": "continuity",
  "from": { "connector": "J1", "pin": "1" },
  "to": { "connector": "M1", "pin": "1" },
  "expected": "closed",
  "net": "VBAT_24V",
  "wire": "W1"
}
```

### Acceptance criteria

- Every required net has at least one continuity test.
- Test procedures reference physical connector pins.
- Failed tests can be mapped back to wires, endpoints, and rendered objects.

## 9.10 Package and library requirements

Nerve should support reusable libraries for:

- Connectors.
- Terminals.
- Seals.
- Backshells.
- Wire types.
- Cables.
- Sleeves.
- Heat shrink.
- Labels.
- Printer profiles.
- Validation rules.
- Design templates.

Libraries should be normal TypeScript packages.

Example package categories:

```text
@grayhaven/nerve-connectors
@grayhaven/nerve-wire
@grayhaven/nerve-labels
@grayhaven/nerve-industrial
@grayhaven/nerve-robotics
@grayhaven/nerve-rules-automotive-lite
@grayhaven/nerve-rules-production-test
```

### Acceptance criteria

- Users can install reusable libraries through npm-compatible package management.
- Libraries can contain typed components, validation rules, templates, and example designs.
- Library objects include provenance metadata.

## 10. Technical Architecture

## 10.1 System modules

### Core packages

```text
@grayhaven/nerve
  Domain model, builders, HIR types, compiler interface, validation primitives.

@grayhaven/nerve-compiler
  TypeScript loading, normalization, dependency resolution, HIR generation.

@grayhaven/nerve-effect
  Effect services, layers, errors, streams, task orchestration.

@grayhaven/nerve-rules
  Built-in validation and linting rules.

@grayhaven/nerve-layout
  Diagram and harness-board layout algorithms.

@grayhaven/nerve-render-react
  React rendering components for diagrams, connector views, tables, and inspectors.

@grayhaven/nerve-exporters
  SVG, PDF, CSV, JSON, PNG, and zip exporters.

@grayhaven/nerve-cli
  Command-line interface.

@grayhaven/nerve-web
  Vite plus React web editor.
```

## 10.2 Frontend architecture

The frontend should use:

- React for UI components.
- Vite for dev/build tooling.
- TanStack Router for routes.
- TanStack Query for async data fetching and worker-backed compile/export jobs.
- TanStack Table for generated data tables.
- TanStack Form for structured editors.
- TanStack Virtual where large tables or diagnostic lists require virtualization.
- A code editor component for TypeScript authoring.
- Web Workers for compiler and layout work.

Suggested route structure:

```text
/
/projects
/projects/:projectId
/projects/:projectId/source
/projects/:projectId/diagram
/projects/:projectId/connectors
/projects/:projectId/board
/projects/:projectId/bom
/projects/:projectId/cut-list
/projects/:projectId/labels
/projects/:projectId/tests
/projects/:projectId/exports
```

## 10.3 Effect architecture

Effect should be used for domain workflows where typed errors, dependency injection, concurrency, retries, cancellation, streams, and resource safety matter.

Recommended Effect services:

```text
ProjectService
  Open, save, read, and write projects.

CompilerService
  Compile TypeScript harness definitions into HIR.

ValidationService
  Run built-in and custom rules.

LayoutService
  Generate schematic and harness-board layout metadata.

RenderService
  Render HIR to visual formats.

ExportService
  Generate CSV, SVG, PDF, PNG, JSON, and zip outputs.

LibraryService
  Resolve installed component libraries and templates.

DiagnosticService
  Normalize and index compiler and validation diagnostics.

TestPlanService
  Generate continuity and no-short tests.
```

Effect should also model expected failure modes explicitly:

```ts
import { Data } from "effect";

export class CompileError extends Data.TaggedError("CompileError")<{
  readonly message: string;
  readonly source?: string;
  readonly location?: { line: number; column: number };
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly diagnostics: readonly Diagnostic[];
}> {}

export class ExportError extends Data.TaggedError("ExportError")<{
  readonly artifact: string;
  readonly cause: unknown;
}> {}
```

### Acceptance criteria

- Core workflows expose typed errors.
- Long-running work can be cancelled.
- Compile and export jobs stream progress updates.
- UI code does not directly perform low-level compiler or export side effects.
- Services can be mocked for frontend tests.

## 10.4 Data flow

```text
TypeScript harness source
  -> compiler
  -> HIR
  -> validation
  -> diagnostics
  -> layout
  -> renderer
  -> exports
  -> manufacturing packet
```

The product should separate user-authored source from generated data. Generated data can be cached, but it should always be reproducible.

## 10.5 Storage model

Local project layout:

```text
my-harness/
  package.json
  interconnect.config.ts
  src/
    main.harness.ts
    connectors.ts
    rules.ts
    variants/
      alpha.ts
      beta.ts
  dist/
    harness.json
    diagnostics.json
    bom.csv
    cut-list.csv
    labels.csv
    tests.csv
    schematic.svg
    board.svg
    manufacturing-packet.pdf
```

Project config example:

```ts
import { defineConfig } from "@grayhaven/nerve";

export default defineConfig({
  units: "mm",
  defaultWireTolerance: 10,
  outputDir: "dist",
  rules: {
    missingWireColor: "error",
    missingLabel: "warning",
    gaugeCurrentMismatch: "error",
  },
  exports: {
    pdf: true,
    csv: true,
    svg: true,
  },
});
```

## 11. UX Requirements

## 11.1 Main workspace

The main workspace should use a split-view layout:

- Left: project tree and source files.
- Center: active editor or rendering canvas.
- Right: inspector for selected objects.
- Bottom: diagnostics, generated tables, and job output.

Users should be able to switch the center view between code, schematic, connector face, harness board, and generated artifacts.

## 11.2 Diagnostic UX

Diagnostics should be first-class.

Each diagnostic should include:

- Severity.
- Stable code.
- Message.
- Source location where available.
- Affected object ID.
- Suggested fix where possible.
- Link to rendered object.

Diagnostic examples:

```text
HK-WIRE-004 Error
Wire W17 uses 24AWG but signal MOTOR_POWER requires at least 18AWG.

HK-CONN-011 Error
Connector J3 pin 8 requires a seal, but no seal part is assigned.

HK-DOC-002 Warning
Branch SENSOR_BRANCH has no label within 50 mm of breakout.
```

## 11.3 Selection and traceability

Selecting an object in any view should reveal the same object everywhere:

- Source definition.
- Rendered diagram element.
- Inspector metadata.
- BOM rows.
- Test rows.
- Export references.

Example:

Selecting wire `W12` should highlight:

- The `wire("W12", ...)` source call.
- The line segment in schematic view.
- The branch segment in board view.
- Its cut-list row.
- Its continuity-test row.

## 11.4 Export UX

The export panel should show:

- Artifact list.
- Export status.
- Last generated timestamp.
- Revision metadata.
- Validation gate status.
- Download buttons.
- Warnings about stale or invalid artifacts.

Users should not be able to generate a release manufacturing packet without seeing validation status.

## 12. AI-Assisted Features

AI should be useful but not authoritative.

Potential features:

1. Generate an initial harness from connector definitions and signal lists.
2. Convert spreadsheet wire lists into TypeScript.
3. Suggest labels based on branch names and connector roles.
4. Explain validation errors.
5. Propose cut-list optimizations.
6. Parse connector datasheets into draft component definitions.
7. Generate manufacturing instructions from HIR.

Constraints:

- AI-generated output must compile and pass deterministic validation.
- AI suggestions must be reviewable as code diffs.
- AI should not bypass rule failures.
- AI should include confidence and provenance where source material is used.

## 13. Security and Safety Requirements

Nerve executes user-authored TypeScript. This creates risk.

Required controls:

- Treat project execution as untrusted by default.
- Compile and execute user code in a constrained environment where possible.
- Prefer static extraction or controlled evaluation over arbitrary execution.
- Use workers or isolated processes for compile tasks.
- Require explicit user approval before accessing local files outside the project root.
- Do not allow library packages to silently perform network calls during deterministic compilation.
- Record dependency versions in generated outputs.

For cloud-hosted compilation:

- Run projects in sandboxed execution environments.
- Apply resource limits.
- Disable network access by default.
- Store generated artifacts separately from source.
- Preserve audit logs for release exports.

## 14. Performance Requirements

Target performance assumptions:

- Small harness: fewer than 25 connectors, fewer than 250 wires.
- Medium harness: 25 to 150 connectors, 250 to 2,500 wires.
- Large harness: 150 or more connectors, 2,500 or more wires.

Performance targets:

- Small harness compile should feel interactive.
- Medium harness should compile without blocking the UI.
- Large harness should support background compile, progressive diagnostics, and virtualized tables.
- Diagram navigation should remain responsive through pan, zoom, search, and selection.
- Export tasks should stream progress.

Technical implications:

- Use Web Workers for compiler and layout tasks.
- Virtualize large tables.
- Cache HIR and layout artifacts by content hash.
- Separate initial render from expensive export rendering.

## 15. Reliability Requirements

- Generated artifacts must be deterministic.
- Validation must fail closed for release exports.
- Exported manufacturing packets must include compiler version and dependency metadata.
- HIR schema should be versioned.
- Older HIR versions should have migration paths where practical.
- All compiler diagnostics should include stable codes.
- All generated outputs should include revision metadata.

## 16. Observability Requirements

For local workflows:

- Structured compiler logs.
- Export logs.
- Diagnostic counts by severity.
- Performance timings for compile, validation, layout, rendering, and export.

For hosted workflows:

- Project compile success rate.
- Export success rate.
- Most common validation errors.
- Large-project performance metrics.
- Package resolution failures.
- Crash and error reports.

## 17. Product Metrics

### Activation metrics

- Percentage of users who compile a first harness.
- Percentage of users who generate a first diagram.
- Percentage of users who export a first BOM or cut list.
- Time from new project to first successful compile.

### Engagement metrics

- Harnesses compiled per active user.
- Artifacts exported per project.
- Validation errors resolved per project.
- Reused library components per project.
- Number of variants per base harness.

### Quality metrics

- Validation error density by harness size.
- Export failure rate.
- Reported manufacturing issues per released packet.
- Percentage of wires with complete metadata.
- Percentage of required nets covered by generated tests.

### Business metrics

- Teams with multiple active projects.
- Projects using private libraries.
- Manufacturing packets generated per month.
- Package installs or library imports.
- Conversion from local CLI usage to paid team workflow, if commercialized.

## 18. API Design Requirements

The public API should optimize for clarity, type safety, and composability.

### API principles

1. Favor explicit object IDs.
2. Make physical units explicit.
3. Make unsafe assumptions visible.
4. Use branded types for values such as gauge, length, connector reference, pin reference, and part number where useful.
5. Support composition through normal TypeScript functions.
6. Make generated HIR stable and schema-versioned.

### Example parametric template

```ts
import { harnessTemplate, wireBundle } from "@grayhaven/nerve";

export const canSensorDrop = harnessTemplate("can-sensor-drop", (opts: {
  id: string;
  controllerRef: string;
  sensorRef: string;
  length: number;
}) => {
  return wireBundle(`${opts.id}-can`, {
    wires: [
      {
        signal: "CAN_H",
        gauge: "24AWG",
        color: "white",
        length: opts.length,
        twistGroup: `${opts.id}-twist`,
      },
      {
        signal: "CAN_L",
        gauge: "24AWG",
        color: "blue",
        length: opts.length,
        twistGroup: `${opts.id}-twist`,
      },
    ],
  });
});
```

## 19. HIR Schema Requirements

HIR should include enough information to render and export without re-running user code.

Top-level structure:

```json
{
  "schemaVersion": "0.1.0",
  "harness": {
    "id": "motor-controller-harness",
    "revision": "A",
    "units": "mm"
  },
  "connectors": [],
  "wires": [],
  "cables": [],
  "branches": [],
  "splices": [],
  "labels": [],
  "bom": [],
  "diagnostics": [],
  "layoutHints": [],
  "exports": {}
}
```

HIR should support stable references:

```text
connector:J1
connector:J1.pin:1
wire:W12
branch:main
splice:S3
label:L7
bom:MPN-1234
```

## 20. Manufacturing Artifact Requirements

## 20.1 BOM

Required columns:

- Item number
- Quantity
- Unit of measure
- Internal part number
- Manufacturer
- Manufacturer part number
- Description
- Category
- Used by
- Approved alternates
- Notes

## 20.2 Cut list

Required columns:

- Wire ID
- Signal
- Gauge
- Color
- Stripe
- Cut length
- Finished length
- Tolerance
- From connector
- From pin
- To connector
- To pin
- Terminal A
- Terminal B
- Branch
- Notes

## 20.3 Label schedule

Required columns:

- Label ID
- Text
- Quantity
- Material
- Printer profile
- Target object
- Placement offset
- Orientation
- Notes

## 20.4 Assembly instructions

Generated instructions should include:

- Required tools.
- Wire preparation steps.
- Cut and strip instructions.
- Crimp terminal instructions.
- Connector population instructions.
- Branch assembly sequence.
- Splice instructions.
- Sleeve and heat shrink instructions.
- Label application instructions.
- Inspection checklist.
- Continuity-test checklist.

## 21. Collaboration and Versioning

Initial collaboration should be Git-native rather than real-time multiplayer.

Required features:

- Deterministic generated artifacts.
- Clean JSON and CSV outputs.
- Human-readable TypeScript source.
- Design diff command.
- Release metadata in exports.

Diff should identify:

- Added, removed, or changed connectors.
- Pinout changes.
- Wire endpoint changes.
- Wire gauge, color, and length changes.
- BOM changes.
- Label changes.
- Test plan changes.

## 22. Commercial Packaging Direction

Potential product surfaces:

1. Open-source core compiler and CLI.
2. Paid hosted editor for teams.
3. Private component libraries.
4. Private harness template libraries.
5. Manufacturing packet review and release workflow.
6. AI-assisted import and generation.
7. Test fixture and instrument integration.
8. Enterprise integrations with PLM, ERP, and procurement systems.

The wedge should be useful locally and free-standing. The paid product should monetize team workflows, private libraries, hosted validation, release management, and integrations.

## 23. Competitive Positioning

Grayhaven Nerve should position itself as:

- More programmable than spreadsheet-driven harness documentation.
- Lighter and more developer-friendly than enterprise electrical CAD.
- More manufacturing-aware than generic diagramming tools.
- More deterministic and reviewable than AI-only design generation.
- More reusable than hand-authored PDF drawings.

## 24. Open Product Questions

1. Should the primary visual editor allow direct manipulation, or should it only generate structured edits back to source?
2. How much connector library data should be bundled versus community-maintained?
3. Should the first renderer target schematic accuracy or nailboard manufacturing accuracy?
4. Should the app support Python or YAML imports, or stay TypeScript-only initially?
5. How strict should release-export validation gates be?
6. What is the minimum viable connector model for sealed automotive-style connectors?
7. How much physical layout information should be required from users?
8. Should custom rules run during TypeScript evaluation, HIR validation, or both?
9. How should package provenance and component verification be represented?
10. Which production tester format should be targeted first?

## 25. Recommended Initial Product Shape

The strongest initial version is not a full enterprise harness CAD replacement. It should be a developer-grade compiler and editor for small-to-medium harnesses.

Recommended initial product surface:

- TypeScript DSL.
- Compiler to HIR.
- CLI validation and export.
- Vite/React web editor.
- TanStack-based navigation, data tables, and async state.
- Effect-based domain workflows.
- SVG schematic renderer.
- Connector face renderer.
- BOM, cut list, label schedule, and test plan generators.
- PDF manufacturing packet exporter.
- A small standard library of connectors, wires, labels, and rules.

The critical product test is whether a small hardware team can replace a spreadsheet plus drawing workflow for a real harness and confidently hand the generated packet to a technician.

## 26. Definition of Done for Product Readiness

Grayhaven Nerve is product-ready when a user can:

1. Create a complete harness in TypeScript.
2. Compile it to HIR.
3. View schematic, connector, and harness-board renderings.
4. Resolve validation errors with clear diagnostics.
5. Export BOM, cut list, label schedule, and test plan.
6. Export a PDF manufacturing packet.
7. Run the same workflow from the CLI.
8. Commit the source and generated release artifacts to Git.
9. Review changes between revisions.
10. Hand the exported packet to a technician without maintaining separate manual documents.

## 27. Ecosystem and Build Strategy

Nerve should not start from a blank slate. The correct strategy is a clean TypeScript-native core with adapters to existing public formats, standards-informed data models, and proven React/TypeScript infrastructure.

### 27.1 Build clean vs. build on existing work

The following product-owned pieces should be built cleanly:

- TypeScript DSL.
- Canonical HIR.
- Compiler pipeline.
- Physical topology model.
- Deterministic drawing and manufacturing renderer.
- BOM, BOP, cut list, label schedule, test plan, and as-built record generators.
- Release and traceability model.

The following areas should build on existing ecosystems through adapters or reference models:

- WireViz import/export compatibility for early adoption and migration.
- VEC and KBL awareness for industrial harness ontology and future interchange.
- IPC/WHMA-A-620, IPC-D-620, NASA-STD-8739.4, and SAE-AS50881 as standards-informed rule-pack inputs.
- OPC UA Wire Harness Manufacturing as a later machine-integration direction.
- React Flow or xyflow for interactive editing.
- ELKJS for graph-layout suggestions.
- TanStack Router, TanStack Query, and TanStack Table for app architecture.
- Vite for local development and bundling.
- Effect and Effect Schema for typed errors, parsing, validation, services, workflows, and CLI behavior.

### 27.2 WireViz compatibility

WireViz should be treated as a practical compatibility target and reference model, not as the core engine.

Requirements:

- Import a useful subset of WireViz YAML into HIR.
- Preserve connector, cable, wire, color, gauge, shield, and connection semantics where possible.
- Emit actionable diagnostics when WireViz concepts cannot map cleanly into HIR.
- Export a subset of Nerve designs to WireViz YAML for users who need compatibility.
- Maintain a test corpus of WireViz import fixtures.

### 27.3 VEC and KBL awareness

Vehicle Electric Container and related harness exchange models should inform the domain model but should not become the default authoring surface.

The main lessons to preserve are:

- Logical connectivity is distinct from physical topology.
- Component master data is distinct from design-instance data.
- Connector housings, cavities, terminals, seals, plugs, and backshells require compatibility modeling.
- Harness variants require first-class representation.
- Manufacturing and traceability data should link back to design objects.

### 27.4 Modern rendering strategy

React Flow or xyflow should be used for interactive editing and selection. ELKJS should provide automatic layout suggestions. Final exported manufacturing artifacts must come from an Nerve-owned DrawingIR and renderer so that outputs are deterministic, stable, reproducible, and diffable.

## 28. Manufacturing Process and Bill of Process Requirements

BOM is not enough. Nerve must model a Bill of Process as a first-class artifact derived from HIR.

The Manufacturing Operations IR should support:

- Operation sequence.
- Workstation.
- Required tools.
- Crimp applicator, die set, locator, insertion tool, and extraction tool.
- Strip length.
- Crimp height.
- Pull-force requirement.
- Seal insertion step.
- Connector population step.
- Splice, weld, or solder operation.
- Sleeve, heat-shrink, tape, braid, conduit, clip, and tie-wrap operations.
- Inspection checkpoints.
- Estimated labor time.
- Required equipment.
- Rework and deviation handling.

Acceptance criteria:

- A manufacturing packet can include both material and process data.
- Each process step links to HIR objects.
- Process diffs are reviewable between revisions.
- The compiler can fail release export when required process metadata is missing.

## 29. Costing and Quote Preparation Requirements

Nerve should support structured cost and quote preparation without becoming a full ERP system.

Requirements:

- Material cost by harness, variant, and release.
- Wire length cost.
- Connector, terminal, seal, accessory, label, sleeve, and tooling cost.
- Labor-time model from BOP steps.
- Scrap factor.
- Yield assumptions.
- Long-lead item detection.
- Supplier availability and lifecycle-risk fields.
- Cost diff between revisions.
- Quote export to CSV, JSON, PDF, and future API adapters.

## 30. Verified Component Library and Compatibility Data

The component library is a product pillar. Nerve should not treat connector libraries as simple part-name lookup tables.

Each connector-family model should support:

- Housing part number.
- Mating part numbers.
- Compatible terminals.
- Compatible seals.
- Compatible cavity plugs.
- Compatible backshells.
- Compatible wedge locks, TPAs, CPAs, strain reliefs, and clips.
- Wire gauge range.
- Wire insulation OD range.
- Current and voltage limits.
- Cavity layout.
- Front-view and rear-view orientation.
- Pin-numbering convention.
- Insertion and extraction tools.
- Crimp tooling.
- Datasheet or source provenance.
- Verification status.
- Last verified date.
- Organization-specific approval status.

Acceptance criteria:

- The compiler can detect terminal, seal, wire, insulation, and cavity incompatibilities.
- Library items include provenance metadata.
- Organizations can override approval state without mutating global library data.

## 31. Shop-Floor Adapter and Machine Export Strategy

Nerve should define adapter interfaces early, even when first implementations are simple CSV or JSON.

Adapter categories:

- Wire cut machines.
- Wire cut/strip machines.
- Cut/strip/crimp machines.
- Wire marking machines.
- Label printers.
- Continuity testers.
- Hi-pot testers.
- Insulation-resistance testers.
- MES and ERP handoff.
- Barcode and QR work orders.

Requirements:

- Adapters must compile from Manufacturing IR, not from UI state.
- Adapter output must include design revision and export metadata.
- Each exported machine row must map back to HIR objects.
- Adapter failures must return structured diagnostics.

## 32. Labeling, Marking, and Serialization Requirements

Labels are manufacturing objects, not just text annotations.

The label model should support:

- Heat-shrink sleeve.
- Wrap-around label.
- Self-laminating label.
- Flag label.
- Rigid tag.
- Barcode and QR code.
- Serialization.
- Before-termination versus after-termination marking.
- Label material.
- Printer model.
- Label stock.
- Print orientation.
- Text repetition around circumference.
- Minimum wire diameter.
- Environmental exposure.
- Chemical and abrasion requirements.

Acceptance criteria:

- Label schedules can be exported independently and inside manufacturing packets.
- Label records link to wires, cables, branches, connectors, and build records.
- Serialization can be deterministic from release and build metadata.

## 33. Formboard and Nailboard Production Output Requirements

Nerve should support production-grade formboard and nailboard outputs over time.

Requirements:

- 1:1 scale mode.
- Print tiling across sheets.
- Plotter output path.
- Calibration ruler and fiducials.
- Page stitching marks.
- Fixture, peg, holder, and clip placement.
- Branch rotation to fit print or board constraints.
- Section reprint.
- Drawing scale verification.
- Bend-radius and slack callouts.
- Bundle diameter visual thickness.
- Assembly-side orientation.
- QR code linking to revision and as-built record.

## 34. Engineering Analysis Requirements

Nerve should provide useful engineering checks without attempting full SPICE or 3D simulation.

Required analysis directions:

- Voltage drop by net.
- Resistance estimate by wire length, gauge, and material.
- Current aggregation across splices and branches.
- Fuse and protection coordination metadata.
- Ampacity derating by bundle fill, ambient temperature, insulation type, and duty cycle.
- Harness weight.
- Bundle diameter by segment.
- Tape, sleeve, and conduit quantity.
- Minimum bend radius by cable or wire type.
- Service-loop and slack requirements.
- Segregation rules for high voltage, RF, Ethernet, CAN, sensor, and power lines.
- Shield termination strategy.
- Twisted-pair lay-length metadata.
- Differential-impedance notes for high-speed cables.
- Environmental zones: heat, fluids, abrasion, flex, outdoor, washdown, vacuum, vibration.

## 35. ECO, ECN, Release, and Impact Analysis

Engineering-change workflow should be a first-class product area.

Requirements:

- ECO or ECN ID.
- Change reason.
- Affected connectors, wires, splices, branches, labels, tests, BOM rows, and process steps.
- Impacted variants.
- Impacted drawings and manufacturing packets.
- Layout preservation when upstream source data changes.
- Release approval state.
- Obsolete release handling.
- Controlled re-export.
- Manufacturing notification.
- Change-risk score.

Acceptance criteria:

- Users can compare release A against release B and see engineering, manufacturing, and test impact.
- Release exports are immutable unless explicitly superseded.
- Change metadata is preserved inside the Nerve Build Record.

## 36. As-Built Traceability Requirements

The system should generate and preserve as-built evidence, not only design intent.

The Nerve Build Record should support:

- Harness serial number.
- Manufacturing lot.
- Operator.
- Workstation.
- Build date.
- Material lots for wire, terminals, seals, connectors, labels, and sleeves.
- Crimp tool, die, and applicator ID.
- Tool calibration status.
- Tester used.
- Test program version.
- Measured continuity and resistance results.
- Hi-pot and insulation-resistance results where applicable.
- Rework history.
- Deviations and concessions.
- Final QA approval.
- Packout or carton relationship.
- Customer shipment reference.

## 37. System Interface Contract Requirements

Nerve should define interface contracts between PCBs, firmware, mechanical assemblies, test fixtures, and harnesses.

Requirements:

- Import connector pinouts from tscircuit, KiCad, Altium, CSV, or JSON.
- Export harness-side connector contracts.
- Validate PCB connector pinout against harness pinout.
- Validate signal names against a firmware or system signal dictionary.
- Detect swapped pins between PCB and harness.
- Treat PCB connector, harness connector, and mating connector as linked but distinct objects.
- Generate interface-contract diffs between product revisions.
- Support packageable connector contracts, such as `@grayhaven/robot-controller-interface`.

## 38. Standards Rule-Pack Licensing and Provenance Policy

Standards-informed rules must be useful without making unsupported compliance claims.

Requirements:

- Rule packs must reference standard name, revision, and rule provenance.
- The product must not redistribute copyrighted standard text unless properly licensed.
- Rules must distinguish “inspired by,” “mapped to,” “customer-authored,” and “certification-reviewed” provenance.
- Every standards-based diagnostic should include a rule ID and source reference metadata.
- Organizations can map internal rules to purchased standards.
- Compliance claims require review workflow and evidence, not only lint pass/fail.

## 39. Technician Redline and Feedback Workflow

Real manufacturing feedback should flow back into source-controlled design, not live only in PDF markups or hallway conversations.

Requirements:

- Technician can report drawing ambiguity.
- Technician can mark incorrect length, label, connector orientation, or process step.
- Redline maps to HIR object.
- Engineer can accept or reject redline.
- Accepted redline creates a code diff or structured patch.
- Rejected redline is retained with reason.
- Manufacturing issue links to release revision and harness serial number.

## 40. Plugin SDK and External Adapter Interfaces

Nerve should expose typed plugin boundaries for controlled extension.

Plugin types:

- Importers.
- Exporters.
- Rule packs.
- Renderers.
- Cost models.
- Label-printer profiles.
- Tester formats.
- Part-data providers.

Requirements:

- Plugins must declare supported HIR schema versions.
- Plugins must use typed diagnostics.
- Plugins must not mutate HIR in place.
- Plugins must be executable in local and CI environments.

## 41. Golden Test Corpus and Regression Requirements

The compiler and renderer must be protected by a visible regression corpus.

The test corpus should include:

- Known-good sample harnesses.
- Known-bad validation cases.
- Rendering snapshot tests.
- HIR schema compatibility tests.
- Import/export round-trip tests.
- WireViz import fixtures.
- Standards-rule fixtures.
- Large-harness performance fixtures.

Acceptance criteria:

- Every release can compare generated artifacts against golden outputs.
- Renderer changes intentionally update snapshots.
- HIR migrations are tested against old fixture versions.

## 42. Part-Data Provider Abstraction

Part data should come from multiple sources without locking the product to one vendor or distributor.

Provider types:

- Manufacturer APIs.
- Distributor APIs.
- Internal approved-vendor lists.
- PLM or ERP part masters.
- Manual verified libraries.

Requirements:

- Providers return normalized component records.
- Provider data includes provenance and retrieval timestamp.
- Organization approvals are separate from provider data.
- Provider conflicts produce diagnostics rather than silent overwrites.
- Cached provider data is tied to release metadata when used in a manufacturing packet.


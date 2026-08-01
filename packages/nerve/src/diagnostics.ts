/**
 * Diagnostics primitives (PRD §11.2).
 *
 * Every diagnostic carries a stable code so CI gates, docs, and suppression
 * config can rely on it across releases.
 */

export const DiagnosticSeverity = {
  Error: "error",
  Warning: "warning",
  Info: "info"
} as const

export type DiagnosticSeverity =
  (typeof DiagnosticSeverity)[keyof typeof DiagnosticSeverity]

export interface Diagnostic {
  /** Stable code, e.g. `HK-WIRE-001`. */
  readonly code: string
  readonly severity: DiagnosticSeverity
  readonly message: string
  /** Stable HIR object reference, e.g. `wire:W12` or `connector:J1.pin:3`. */
  readonly target?: string | undefined
  /**
   * Additional involved refs (same PRD §19 grammar as `target`) for
   * multi-entity findings — e.g. both wires of an untwisted differential
   * pair. Renderers badge every ref; `target` remains the primary anchor.
   */
  readonly targets?: ReadonlyArray<string> | undefined
  /**
   * Structured values behind the message (measured vs. limit, counts) so
   * tooling never has to parse prose: `{ currentEstimate: 5, ampacityA: 2.3 }`.
   */
  readonly data?: Readonly<Record<string, string | number>> | undefined
}

/** Structural diagnostic codes emitted by the core compiler. */
export const Codes = {
  DuplicateConnectorRef: "HK-CONN-001",
  UndefinedConnectorRef: "HK-CONN-002",
  UndefinedPinRef: "HK-CONN-003",
  InvalidConnectorQuantity: "HK-CONN-004",
  InvalidPinElectrical: "HK-CONN-005",
  /**
   * Two pins supply full part records for one MPN, and the records differ.
   * One part number buys one part and gets one BOM line, so the design has
   * asserted two incompatible facts about a single orderable item; the
   * compiler refuses to pick one silently.
   */
  ConflictingPartRecord: "HK-CONN-006",
  /**
   * A part declares a pinout for a pin it does not have or for one it
   * reserves. The pinout exists to be the outside authority a pin assignment
   * is checked against, so a pinout describing a part that does not exist
   * poisons every comparison made against it.
   */
  ImpossiblePartPinout: "HK-CONN-007",
  DuplicateWireId: "HK-WIRE-001",
  /** A wire assigns itself to a branch that does not exist. Left unchecked it
   * would vanish from every conductor count that branch feeds. */
  WireUndefinedBranch: "HK-WIRE-005",
  WireEndpointsIdentical: "HK-WIRE-002",
  InvalidWireQuantity: "HK-WIRE-003",
  DuplicateBranchId: "HK-BRANCH-001",
  BranchUndefinedEndpoint: "HK-BRANCH-002",
  InvalidBranchGeometry: "HK-BRANCH-003",
  /** A branch's authored `nominalLength` contradicts the length measured from
   * its own `waypoints`. Distinct from HK-BRANCH-003 (a value that is not a
   * valid number) because the fix is different: one number has to give. */
  BranchLengthMismatch: "HK-BRANCH-004",
  DuplicateLabelId: "HK-LABEL-001",
  LabelUndefinedTarget: "HK-LABEL-002",
  InvalidLabelQuantity: "HK-LABEL-003",
  DuplicateSpliceId: "HK-SPLICE-001",
  UndefinedSpliceRef: "HK-SPLICE-002",
  SpliceTooFewWires: "HK-SPLICE-003",
  SpliceUndefinedBranch: "HK-SPLICE-004",
  InvalidSpliceLocation: "HK-SPLICE-005",
  DuplicateCableId: "HK-CABLE-001",
  UndefinedCableRef: "HK-CABLE-002",
  InvalidCableDefinition: "HK-CABLE-003",
  DuplicateCableConductor: "HK-CABLE-004",
  InvalidCableConductor: "HK-CABLE-005",
  DuplicateProtectionId: "HK-PROT-001",
  ProtectionUndefinedWire: "HK-PROT-002",
  InvalidProtectionRating: "HK-PROT-003",
  /**
   * A design object reached the compiler missing structure the type system
   * says it must have — which can only happen when the object was built by a
   * different copy of this library than the one compiling it.
   *
   * The usual cause is authoring a harness outside the workspace, where
   * `@grayhaven/nerve` resolves to a published build from the package cache
   * while the compiler runs from source. Both halves work; they just are not
   * the same version. Without this check the mismatch surfaced as a raw
   * TypeError deep inside normalization, which told the reader nothing.
   */
  ForeignDesignObject: "HK-DESIGN-001"
} as const

export const hasErrors = (diagnostics: ReadonlyArray<Diagnostic>): boolean =>
  diagnostics.some((d) => d.severity === DiagnosticSeverity.Error)

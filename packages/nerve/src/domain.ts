/**
 * Core domain model for Grayhaven Nerve.
 *
 * These are the user-facing design types produced by the DSL builders.
 * The compiler normalizes a `HarnessDesign` into the HIR (see ./hir/schema.ts),
 * which is what renderers, validators, and exporters consume.
 */
import type { KnownGauge } from "./gauge.js"
import type { Point3 } from "./geometry.js"

export type Units = "mm" | "in"

export type ConnectorGender = "plug" | "receptacle" | "hermaphroditic"

/**
 * Literal-union autocomplete that still accepts any string: editors
 * suggest the known values of `T`, raw strings pass through unchanged
 * (the tscircuit props pattern — `string & {}` keeps the union from
 * collapsing to `string`).
 */
export type AutocompleteString<T extends string> = T | (string & {})

/** Wire color names the renderers and WireViz interop know by name. */
export type KnownWireColor =
  | "black" | "white" | "gray" | "pink" | "red" | "orange" | "yellow"
  | "olive" | "green" | "turquoise" | "blue" | "violet" | "brown"
  | "beige" | "ivory" | "slate" | "copper" | "tin" | "silver" | "gold"

/** Datasheet/source provenance and verification state (PRD §30, §38). */
export interface PartProvenance {
  readonly source?: string
  readonly datasheet?: string
  /** "verified" requires a review pass; library seed data is "inspired-by". */
  readonly verification: "unverified" | "inspired-by" | "verified"
  /** ISO date of last verification. */
  readonly lastVerified?: string
}

/** A library reference for discovery and geometry, independent of part ratings. */
export interface KiCadAsset {
  readonly kind: "symbol" | "footprint" | "model3d"
  /** KiCad library:name for symbols/footprints; library-relative path for models. */
  readonly identifier: string
  /** A mate's footprint is not the wire-side housing's cavity layout. */
  readonly relationship: "part" | "mate" | "generic"
  /** The represented part, where this is a part-specific reference. */
  readonly mpn?: string
  readonly sourceUrl: string
  /** Upstream tag or commit, rather than an assumed installed KiCad version. */
  readonly libraryRevision?: string
  /** ISO date on which the upstream asset reference was checked. */
  readonly lastVerified?: string
  readonly license: {
    readonly spdxId: string
    readonly exception?: string
    readonly url: string
    readonly attribution: string
  }
  readonly notes?: string
}

/**
 * Component master data for a connector housing (PRD §9.2, §30).
 * Instances reference a part; parts live in libraries such as
 * `@grayhaven/nerve-connectors`.
 */
export interface ConnectorPart {
  readonly mpn: string
  readonly manufacturer?: string
  readonly family?: string
  readonly description?: string
  readonly gender?: ConnectorGender
  readonly pinCount: number
  readonly pinNumbering?: string
  readonly cavityLayout?: { readonly rows: number; readonly columns: number }
  /** Pins that must stay unassigned (keying, future use, no-connects). */
  /**
   * The signal each pin carries on the part itself, where the part fixes it.
   *
   * A bare housing has no pinout — pin 1 of a Micro-Fit receptacle is whatever
   * you crimp into it. A device does: a sensor, a module, a board header have
   * their pinout defined by the thing, not by the harness. Declaring it turns
   * pin assignment into a claim that can be contradicted by an outside
   * authority.
   *
   * That matters because it is the one thing HK-CONN-011 cannot do. It
   * compares a wire's signal against a pin assignment, but both are written by
   * the same author in the same file, so a consistently wrong pinout — the
   * mistake people actually make — agrees with itself and compiles clean.
   * `matingMpn` does not help: it is a part number with nothing behind it.
   */
  readonly pinout?: Readonly<Record<string, string>>
  readonly reservedPins?: ReadonlyArray<number | string>
  readonly matingMpn?: string
  readonly compatibleTerminals?: ReadonlyArray<string>
  readonly compatibleSeals?: ReadonlyArray<string>
  readonly compatibleBackshells?: ReadonlyArray<string>
  readonly wireGaugeRange?: { readonly min: string; readonly max: string }
  /** Environmentally sealed housing: every populated cavity needs a seal. */
  readonly sealed?: boolean
  readonly currentLimitA?: number
  readonly voltageLimitV?: number
  readonly crimpTool?: string
  readonly insertionTool?: string
  readonly extractionTool?: string
  readonly provenance?: PartProvenance
  /** Optional KiCad references; they do not establish pin mapping or electrical limits. */
  readonly kicadAssets?: ReadonlyArray<KiCadAsset>
}

/**
 * Component master data for a wire (PRD §9.2, §30).
 *
 * Wire was the last free-text material in the model: `gauge`/`insulation`
 * strings gave the bundle-diameter and weight estimators nothing to measure
 * and left the BOM with no orderable wire line items. A wire that names a
 * part becomes purchasable, weighable, and diameter-accurate; wires without
 * one keep working exactly as before.
 */
export interface WirePart {
  readonly mpn: string
  readonly manufacturer?: string
  readonly family?: string
  readonly description?: string
  readonly gauge: AutocompleteString<KnownGauge>
  readonly strands?: number
  readonly conductorMaterial?: "copper" | "tinned-copper" | "copper-clad-aluminum"
  readonly insulation?: string
  /** Nominal outer diameter, mm. */
  readonly outerDiameter?: number
  readonly voltageRating?: number
  readonly temperatureRating?: number
  readonly ohmsPerKm?: number
  readonly gramsPerMeter?: number
  readonly availableColors?: ReadonlyArray<AutocompleteString<KnownWireColor>>
  readonly provenance?: PartProvenance
}

/** A reference to a specific pin/cavity on a connector instance. */
/**
 * The contact that actually crimps the wire.
 *
 * A terminal has been an MPN string with nothing behind it, so every check
 * that wants the contact's own limits has had to substitute the housing's:
 * HK-MFG-004 compares wire gauge against the *housing* range because the
 * terminal's range does not exist. The housing is a proxy for the part doing
 * the crimping, and a proxy is where a check quietly stops being about the
 * thing it names.
 *
 * The process fields are the other half. Strip length, die, crimp height
 * window and pull force are what an operator at a press needs, and they are
 * a function of terminal plus gauge — derivable the moment the terminal is
 * modelled, and underivable while it is a string.
 */
export interface TerminalPart {
  readonly mpn: string
  readonly manufacturer?: string
  readonly family?: string
  readonly description?: string
  /** Conductor gauge range this contact crimps. */
  readonly wireGaugeRange?: { readonly min: string; readonly max: string }
  /** Insulation OD the crimp barrel accepts, mm. */
  readonly insulationDiameterRange?: { readonly min: number; readonly max: number }
  readonly plating?: string
  readonly currentRatingA?: number
  readonly crimpTool?: string
  readonly dieId?: string
  /** Insulation removed before crimping, mm. */
  readonly stripLength?: number
  /**
   * Acceptance window for measured crimp height, mm. The single most
   * important dimensional spec of a crimp, and the one most often missing
   * from a drawing — outside this window the crimp is a reject however it
   * looks.
   */
  readonly crimpHeight?: { readonly min: number; readonly max: number }
  /** Minimum tensile pull before separation, newtons. */
  readonly pullForceN?: number
  readonly provenance?: PartProvenance
}

/** A cavity seal, sized to the wire's insulation rather than its conductor. */
export interface SealPart {
  readonly mpn: string
  readonly manufacturer?: string
  readonly family?: string
  readonly description?: string
  /** Wire insulation OD this seal grips, mm. */
  readonly insulationDiameterRange?: { readonly min: number; readonly max: number }
  readonly provenance?: PartProvenance
}

export interface PinRef {
  readonly kind: "pin-ref"
  readonly connector: string
  readonly pin: string
}

/** A reference to a splice node. */
export interface SpliceRef {
  readonly kind: "splice-ref"
  readonly splice: string
}

/** Where a wire terminates: a connector pin or a splice. */
export type WireEndpoint = PinRef | SpliceRef

/** Map of pin number/name to assigned signal name. */
export type PinAssignments = Readonly<Record<string | number, string>>

/** Electrical behavior a connector pin contributes to its net. */
export type ElectricalRole =
  | "source"
  | "sink"
  | "bidirectional"
  | "passive"
  | "ground"

export type DifferentialPolarity = "positive" | "negative"

export interface VoltageRange {
  readonly minV?: number
  readonly maxV?: number
}

export interface DifferentialSemantics {
  readonly pair: string
  readonly polarity: DifferentialPolarity
}

export interface PinElectrical {
  readonly role?: ElectricalRole
  readonly voltage?: VoltageRange
  /** Role-relative: source capacity or sink demand. */
  readonly currentA?: number
  readonly protocol?: string
  readonly differential?: DifferentialSemantics
  /**
   * Bus termination fitted at this pin, ohms. A high-speed CAN trunk carries
   * exactly two (~120Ω), one at each end — the only thing that makes the line
   * look like its own characteristic impedance instead of a reflector
   * (HK-ELEC-018/019).
   */
  readonly terminationOhms?: number
  /**
   * Bus bit rate, kbit/s. Sets the stub-length and total-length budgets:
   * both shrink as the bit time shrinks (HK-ELEC-021).
   */
  readonly bitRateKbps?: number
}

export type PinElectricalAssignments = Readonly<
  Record<string | number, PinElectrical>
>

/** A connector instance placed in a harness, e.g. `connector("J1", part, {...})`. */
export interface ConnectorInstance {
  readonly kind: "connector"
  readonly ref: string
  readonly part: ConnectorPart
  readonly pins: Readonly<Record<string, string>>
  /** Terminal MPN per pin (PRD §30). */
  readonly terminals: Readonly<Record<string, string>>
  /** Seal MPN per pin. */
  readonly seals: Readonly<Record<string, string>>
  /** Full terminal records, per pin, where the design supplied one rather
   * than a bare MPN. Absent entirely when every terminal is a string. */
  readonly terminalParts?: Readonly<Record<string, TerminalPart>>
  /** Full seal records, per pin. Absent when every seal is a string. */
  readonly sealParts?: Readonly<Record<string, SealPart>>
  /** Optional electrical semantics per assigned pin. */
  readonly electrical: Readonly<Record<string, PinElectrical>>
  /** Build a `PinRef` for a pin on this connector. */
  pin(pin: string | number): PinRef
}

export interface WireProps {
  /** Wire material this conductor is cut from; the only thing that puts a
   * wire on the BOM. */
  readonly part?: WirePart
  readonly gauge?: AutocompleteString<KnownGauge>
  readonly color?: AutocompleteString<KnownWireColor>
  readonly stripe?: AutocompleteString<KnownWireColor>
  /** Finished (installed) length between the two endpoints. */
  readonly length?: number
  readonly lengthTolerance?: number
  /** Extra length added to the cut so the wire can be dressed/serviced. */
  readonly serviceLoop?: number
  /** Insulation removed at each end — a machine parameter, NOT added to cut length. */
  readonly stripLength?: { readonly from: number; readonly to: number }
  /** Length consumed inside each termination — IS added to cut length. */
  readonly terminationAllowance?: { readonly from: number; readonly to: number }
  readonly signal?: string
  readonly insulation?: string
  readonly voltageRating?: number
  readonly temperatureRating?: number
  /**
   * Expected **continuous** current, amps — not peak, not inrush, not stall.
   *
   * Every rule reading this is thermal: ampacity and bundle derating
   * (HK-WIRE-004), contact rating (HK-CONN-016), source capacity
   * (HK-ELEC-017). Conductor heating is I²R integrated over time, so a brief
   * peak does not size a wire and putting one here over-sizes the harness or
   * fails a design that is fine. Size for what the load draws continuously
   * and handle inrush as a separate concern.
   */
  readonly currentEstimate?: number
  /** Crosstalk role for EMC segregation: "aggressor" (noisy source),
   * "victim" (sensitive sink), or "neutral". */
  readonly emcClass?: "aggressor" | "victim" | "neutral"
  readonly twistGroup?: string
  readonly shieldGroup?: string
  /** Cable this wire is a conductor of (see `cable()`). */
  /**
   * The bundle segment this wire runs in, by branch id.
   *
   * Membership is otherwise inferred from whether both of a wire's endpoints
   * appear in a branch's `path`, which makes it depend on an authoring
   * accident: two physically identical bundles disagree if one path happens
   * to name the shared source connector and the other does not. Anything
   * counting conductors in a bundle — derating, sleeve fill, ambient — is
   * only as good as that count, so say it outright when it matters.
   */
  readonly branch?: string
  readonly cable?: string
  /** Conductor number/name within the cable. */
  readonly conductor?: string | number
  readonly notes?: string
}

export interface WireDef extends WireProps {
  readonly kind: "wire"
  readonly id: string
  readonly from: WireEndpoint
  readonly to: WireEndpoint
}

export interface SpliceProps {
  /** crimp, solder-sleeve, ultrasonic-weld, ... */
  readonly type?: string
  /** Crimp or solder-sleeve part number. */
  readonly part?: string
  /** Branch the splice sits on. */
  readonly branch?: string
  /** Distance along the branch from its start, in harness units. */
  readonly location?: number
  /** Seal / heat-shrink / inspection notes (PRD §9.2). */
  readonly notes?: string
}

export interface SpliceDef extends SpliceProps {
  readonly kind: "splice"
  readonly id: string
}

export interface CableProps {
  /** Catalog type, e.g. "2x24AWG twisted shielded". */
  readonly type?: string
  readonly conductors?: number
  readonly shield?: string
  readonly jacket?: string
  readonly outerDiameter?: number
  readonly notes?: string
}

export interface CableDef extends CableProps {
  readonly kind: "cable"
  readonly id: string
}

export interface BranchProps {
  readonly path: ReadonlyArray<ConnectorInstance | string>
  readonly parent?: string
  readonly sleeve?: string
  readonly nominalLength?: number
  readonly breakoutDistance?: number
  /** Tightest bend the bundle tolerates (mm) — breakouts must clear it. */
  readonly minBendRadius?: number
  /** Ambient temperature the bundle runs in (°C); member wires need a
   * temperature rating at or above it. */
  readonly ambientTemperatureC?: number
  /** Routed centerline through space, in harness units. Present means
   * lengths and curvature are computed rather than asserted. */
  readonly waypoints?: ReadonlyArray<Point3>
}

export interface BranchDef {
  readonly kind: "branch"
  readonly id: string
  readonly path: ReadonlyArray<string>
  readonly parent?: string
  readonly sleeve?: string
  readonly nominalLength?: number
  readonly breakoutDistance?: number
  readonly minBendRadius?: number
  readonly ambientTemperatureC?: number
  /**
   * Routed centerline through space, in harness units.
   *
   * Every length in Nerve is otherwise a number a person typed. Lengths do
   * not originate in a text editor — they come from routing a bundle around
   * brackets with real bend radii, and the cut list is where a wrong one gets
   * expensive. When waypoints are present the compiler computes `routedLength`
   * and `routedMinBendRadius` from them, so moving a connector updates the
   * geometry instead of requiring every number to be retyped.
   */
  readonly waypoints?: ReadonlyArray<Point3>
}

export interface ProtectionProps {
  /** Overcurrent device kind. */
  readonly kind: "fuse" | "breaker"
  /** Device rating in amps; must not exceed the ampacity of any wire it guards. */
  readonly ratingA: number
  /** Wire IDs this device protects (explicit, so no current-flow inference). */
  readonly protects: ReadonlyArray<string>
  readonly notes?: string
}

export interface ProtectionDef extends ProtectionProps {
  readonly id: string
}

export interface LabelProps {
  readonly text: string
  readonly attachTo: ConnectorInstance | string
  readonly offsetFrom?: ConnectorInstance | string
  readonly distance?: number
  readonly material?: string
  readonly quantity?: number
}

export interface LabelDef {
  readonly kind: "label"
  readonly id: string
  readonly text: string
  readonly attachTo: string
  readonly offsetFrom?: string
  readonly distance?: number
  readonly material?: string
  readonly quantity?: number
}

export interface HarnessProps {
  readonly revision: string
  readonly units: Units
  readonly metadata?: Readonly<Record<string, string>>
  readonly connectors: ReadonlyArray<ConnectorInstance>
  readonly wires: ReadonlyArray<WireDef>
  readonly branches?: ReadonlyArray<BranchDef>
  readonly labels?: ReadonlyArray<LabelDef>
  readonly splices?: ReadonlyArray<SpliceDef>
  readonly cables?: ReadonlyArray<CableDef>
  readonly protections?: ReadonlyArray<ProtectionDef>
}

/** The root design object returned by `harness(...)` — the unit of compilation. */
export interface HarnessDesign {
  readonly kind: "harness"
  readonly id: string
  readonly revision: string
  readonly units: Units
  readonly metadata: Readonly<Record<string, string>>
  readonly connectors: ReadonlyArray<ConnectorInstance>
  readonly wires: ReadonlyArray<WireDef>
  readonly branches: ReadonlyArray<BranchDef>
  readonly labels: ReadonlyArray<LabelDef>
  readonly splices: ReadonlyArray<SpliceDef>
  readonly cables: ReadonlyArray<CableDef>
  readonly protections: ReadonlyArray<ProtectionDef>
}

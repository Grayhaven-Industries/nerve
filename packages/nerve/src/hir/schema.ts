/**
 * Harness Intermediate Representation (HIR) schema (PRD §9.3, §19).
 *
 * The HIR is the deterministic, serializable contract between the compiler
 * and everything downstream: validation, layout, rendering, exporting, and
 * test-plan generation. It must be decodable without executing user code.
 *
 * Defined with Effect Schema so every boundary (worker messages, cached
 * artifacts, CLI `inspect`) decodes through the same versioned codec.
 */
import { JSONSchema, Schema } from "effect"

import { HIR_SCHEMA_VERSION } from "./core.js"

export const HirUnits = Schema.Literal("mm", "in")

export const HirPinRef = Schema.Struct({
  connector: Schema.String,
  pin: Schema.String
})

export const HirSpliceRef = Schema.Struct({
  splice: Schema.String
})

/** A wire endpoint: a connector pin or a splice node. */
export const HirEndpoint = Schema.Union(HirPinRef, HirSpliceRef)

// Effect Schema ^3.16.0: composed only from the Struct/Literal/optional
// primitives already used throughout this file because external docs were
// unavailable in the implementation environment.
export const HirVoltageRange = Schema.Struct({
  minV: Schema.optional(Schema.Number),
  maxV: Schema.optional(Schema.Number)
})

export const HirDifferentialSemantics = Schema.Struct({
  pair: Schema.String,
  polarity: Schema.Literal("positive", "negative")
})

export const HirPinElectrical = Schema.Struct({
  role: Schema.optional(
    Schema.Literal("source", "sink", "bidirectional", "passive", "ground")
  ),
  voltage: Schema.optional(HirVoltageRange),
  currentA: Schema.optional(Schema.Number),
  protocol: Schema.optional(Schema.String),
  differential: Schema.optional(HirDifferentialSemantics),
  /** Bus termination fitted at this pin, ohms (HK-ELEC-018/019). */
  terminationOhms: Schema.optional(Schema.Number),
  /** Bus bit rate, kbit/s — sets the stub-length budget (HK-ELEC-021). */
  bitRateKbps: Schema.optional(Schema.Number)
})

export const HirProvenance = Schema.Struct({
  source: Schema.optional(Schema.String),
  datasheet: Schema.optional(Schema.String),
  verification: Schema.Literal("unverified", "inspired-by", "verified"),
  lastVerified: Schema.optional(Schema.String)
})

/** The contact that crimps the wire (PRD §30, §4). Present only when the
 * design supplied a record rather than a bare MPN. */
export const HirTerminalPart = Schema.Struct({
  mpn: Schema.String,
  manufacturer: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  wireGaugeRange: Schema.optional(
    Schema.Struct({ min: Schema.String, max: Schema.String })
  ),
  insulationDiameterRange: Schema.optional(
    Schema.Struct({ min: Schema.Number, max: Schema.Number })
  ),
  plating: Schema.optional(Schema.String),
  currentRatingA: Schema.optional(Schema.Number),
  crimpTool: Schema.optional(Schema.String),
  dieId: Schema.optional(Schema.String),
  stripLength: Schema.optional(Schema.Number),
  crimpHeight: Schema.optional(
    Schema.Struct({ min: Schema.Number, max: Schema.Number })
  ),
  pullForceN: Schema.optional(Schema.Number),
  provenance: Schema.optional(HirProvenance)
})

/** A cavity seal, sized to insulation OD rather than conductor gauge. */
export const HirSealPart = Schema.Struct({
  mpn: Schema.String,
  manufacturer: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  insulationDiameterRange: Schema.optional(
    Schema.Struct({ min: Schema.Number, max: Schema.Number })
  ),
  provenance: Schema.optional(HirProvenance)
})

export const HirPin = Schema.Struct({
  pin: Schema.String,
  signal: Schema.optional(Schema.String),
  terminal: Schema.optional(Schema.String),
  seal: Schema.optional(Schema.String),
  /** Full contact record when the design supplied one. */
  terminalPart: Schema.optional(HirTerminalPart),
  sealPart: Schema.optional(HirSealPart),
  electrical: Schema.optional(HirPinElectrical)
})

export const HirConnector = Schema.Struct({
  ref: Schema.String,
  mpn: Schema.String,
  manufacturer: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  gender: Schema.optional(Schema.Literal("plug", "receptacle", "hermaphroditic")),
  pinCount: Schema.Number,
  wireGaugeRange: Schema.optional(
    Schema.Struct({ min: Schema.String, max: Schema.String })
  ),
  cavityLayout: Schema.optional(Schema.Struct({ rows: Schema.Number, columns: Schema.Number })),
  matingMpn: Schema.optional(Schema.String),
  reservedPins: Schema.optional(Schema.Array(Schema.String)),
  /** Signals the part itself fixes per pin, where it fixes them (a device,
   * not a bare housing). The outside authority a pin assignment can be
   * checked against. */
  pinout: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  sealed: Schema.optional(Schema.Boolean),
  compatibleTerminals: Schema.optional(Schema.Array(Schema.String)),
  compatibleSeals: Schema.optional(Schema.Array(Schema.String)),
  /** Per-contact electrical limits from the part datasheet (HK-CONN-016/017). */
  currentLimitA: Schema.optional(Schema.Number),
  voltageLimitV: Schema.optional(Schema.Number),
  crimpTool: Schema.optional(Schema.String),
  provenance: Schema.optional(HirProvenance),
  pins: Schema.Array(HirPin)
})

// effect 3.22.0 (resolved by bun.lock from the `^3.16.0` range): in v3
// `Schema.optional(S)` produces an exact-optional key whose type also admits
// `undefined` — which is what lets `compact()`-built objects assign cleanly
// under `exactOptionalPropertyTypes`. Same primitive as the rest of this file.
/** Wire material master data (PRD §9.2, §30) — the wire counterpart of
 * `HirConnector`'s part fields, and what makes a wire orderable. */
export const HirWirePart = Schema.Struct({
  mpn: Schema.String,
  manufacturer: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  gauge: Schema.String,
  strands: Schema.optional(Schema.Number),
  conductorMaterial: Schema.optional(
    Schema.Literal("copper", "tinned-copper", "copper-clad-aluminum")
  ),
  insulation: Schema.optional(Schema.String),
  /** Nominal outer diameter, mm. */
  outerDiameter: Schema.optional(Schema.Number),
  voltageRating: Schema.optional(Schema.Number),
  temperatureRating: Schema.optional(Schema.Number),
  ohmsPerKm: Schema.optional(Schema.Number),
  gramsPerMeter: Schema.optional(Schema.Number),
  availableColors: Schema.optional(Schema.Array(Schema.String)),
  provenance: Schema.optional(HirProvenance)
})

/** Length consumed or removed at each end of a wire, in harness units. */
export const HirWireEndAllowance = Schema.Struct({
  from: Schema.Number,
  to: Schema.Number
})

export const HirWire = Schema.Struct({
  id: Schema.String,
  from: HirEndpoint,
  to: HirEndpoint,
  /** Present only when the design declares a wire material. */
  part: Schema.optional(HirWirePart),
  gauge: Schema.optional(Schema.String),
  color: Schema.optional(Schema.String),
  stripe: Schema.optional(Schema.String),
  /** Finished (installed) length; the cut length adds the allowances below. */
  length: Schema.optional(Schema.Number),
  lengthTolerance: Schema.optional(Schema.Number),
  /** Slack added to the cut so the wire can be dressed/serviced. */
  serviceLoop: Schema.optional(Schema.Number),
  /** Insulation removed at each end — a machine parameter, not cut length. */
  stripLength: Schema.optional(HirWireEndAllowance),
  /** Length consumed inside each termination — added to cut length. */
  terminationAllowance: Schema.optional(HirWireEndAllowance),
  signal: Schema.optional(Schema.String),
  insulation: Schema.optional(Schema.String),
  voltageRating: Schema.optional(Schema.Number),
  temperatureRating: Schema.optional(Schema.Number),
  currentEstimate: Schema.optional(Schema.Number),
  /** Crosstalk role for EMC segregation (HK-ELEC-008): noisy source,
   * sensitive sink, or neutral. */
  emcClass: Schema.optional(Schema.Literal("aggressor", "victim", "neutral")),
  twistGroup: Schema.optional(Schema.String),
  shieldGroup: Schema.optional(Schema.String),
  cable: Schema.optional(Schema.String),
  conductor: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String)
})

export const HirSplice = Schema.Struct({
  id: Schema.String,
  type: Schema.optional(Schema.String),
  part: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  location: Schema.optional(Schema.Number),
  notes: Schema.optional(Schema.String),
  /** Wire IDs attached to this splice (computed by the compiler). */
  wires: Schema.Array(Schema.String)
})

export const HirCable = Schema.Struct({
  id: Schema.String,
  type: Schema.optional(Schema.String),
  conductors: Schema.optional(Schema.Number),
  shield: Schema.optional(Schema.String),
  jacket: Schema.optional(Schema.String),
  outerDiameter: Schema.optional(Schema.Number),
  /** Longest member wire — the cable cut length (computed). */
  cutLength: Schema.optional(Schema.Number),
  notes: Schema.optional(Schema.String),
  /** Member wire IDs (computed by the compiler). */
  wires: Schema.Array(Schema.String)
})

/** A routed waypoint in harness units. Mirrors `Point3` in geometry.ts,
 * which is the dependency-free kernel the compiler measures with. */
export const HirPoint3 = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  z: Schema.Number
})

export const HirBranch = Schema.Struct({
  id: Schema.String,
  path: Schema.Array(Schema.String),
  parent: Schema.optional(Schema.String),
  sleeve: Schema.optional(Schema.String),
  nominalLength: Schema.optional(Schema.Number),
  breakoutDistance: Schema.optional(Schema.Number),
  minBendRadius: Schema.optional(Schema.Number),
  /** Ambient the bundle runs in (°C); wires in it need a temperature rating
   * at or above this (HK-ELEC-009). */
  ambientTemperatureC: Schema.optional(Schema.Number),
  /** Authored routed centerline, harness units. */
  waypoints: Schema.optional(Schema.Array(HirPoint3)),
  /** Computed from `waypoints` by the compiler: total centerline length.
   * Absent when the branch is not routed — an unrouted branch has no
   * computed length, which is different from a length of zero. */
  routedLength: Schema.optional(Schema.Number),
  /** Computed from `waypoints`: the tightest bend over the routed path.
   * Absent for a straight run, whose radius is infinite rather than zero. */
  routedMinBendRadius: Schema.optional(Schema.Number)
})

/** An overcurrent protection device (fuse/breaker) and the wires it guards.
 * The link is explicit (`protects`) so the rule never has to infer current
 * flow direction from the undirected wire graph. */
export const HirProtection = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literal("fuse", "breaker"),
  ratingA: Schema.Number,
  /** Wire IDs this device protects. */
  protects: Schema.Array(Schema.String),
  notes: Schema.optional(Schema.String)
})

export const HirLabel = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  attachTo: Schema.String,
  offsetFrom: Schema.optional(Schema.String),
  distance: Schema.optional(Schema.Number),
  material: Schema.optional(Schema.String),
  quantity: Schema.optional(Schema.Number)
})

export const HirBomItem = Schema.Struct({
  internalPartId: Schema.optional(Schema.String),
  mpn: Schema.String,
  manufacturer: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  category: Schema.optional(Schema.String),
  quantity: Schema.Number,
  unitOfMeasure: Schema.String,
  usedBy: Schema.Array(Schema.String),
  notes: Schema.optional(Schema.String)
})

export const HirDiagnostic = Schema.Struct({
  code: Schema.String,
  severity: Schema.Literal("error", "warning", "info"),
  message: Schema.String,
  target: Schema.optional(Schema.String),
  /** Additional involved refs (PRD §19 grammar) — multi-entity findings. */
  targets: Schema.optional(Schema.Array(Schema.String)),
  /** Structured values behind the message (measured vs. limit, counts). */
  data: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Union(Schema.String, Schema.Number) })
  )
})

export const Hir = Schema.Struct({
  schemaVersion: Schema.Literal(HIR_SCHEMA_VERSION),
  harness: Schema.Struct({
    id: Schema.String,
    revision: Schema.String,
    units: HirUnits,
    metadata: Schema.Record({ key: Schema.String, value: Schema.String })
  }),
  connectors: Schema.Array(HirConnector),
  wires: Schema.Array(HirWire),
  cables: Schema.Array(HirCable),
  branches: Schema.Array(HirBranch),
  splices: Schema.Array(HirSplice),
  labels: Schema.Array(HirLabel),
  bom: Schema.Array(HirBomItem),
  /** Overcurrent protection devices (optional; omitted when none declared). */
  protections: Schema.optional(Schema.Array(HirProtection)),
  diagnostics: Schema.Array(HirDiagnostic),
  layoutHints: Schema.Array(Schema.Unknown),
  exports: Schema.Record({ key: Schema.String, value: Schema.Unknown })
})

export type Hir = Schema.Schema.Type<typeof Hir>
export type HirConnector = Schema.Schema.Type<typeof HirConnector>
export type HirWire = Schema.Schema.Type<typeof HirWire>
export type HirWirePart = Schema.Schema.Type<typeof HirWirePart>
export type HirWireEndAllowance = Schema.Schema.Type<typeof HirWireEndAllowance>
export type HirPoint3 = Schema.Schema.Type<typeof HirPoint3>
export type HirBranch = Schema.Schema.Type<typeof HirBranch>
export type HirLabel = Schema.Schema.Type<typeof HirLabel>
export type HirBomItem = Schema.Schema.Type<typeof HirBomItem>
export type HirPinRef = Schema.Schema.Type<typeof HirPinRef>
export type HirSpliceRef = Schema.Schema.Type<typeof HirSpliceRef>
export type HirEndpoint = Schema.Schema.Type<typeof HirEndpoint>
export type HirTerminalPart = Schema.Schema.Type<typeof HirTerminalPart>
export type HirSealPart = Schema.Schema.Type<typeof HirSealPart>
export type HirProvenance = Schema.Schema.Type<typeof HirProvenance>
export type HirPin = Schema.Schema.Type<typeof HirPin>
export type HirPinElectrical = Schema.Schema.Type<typeof HirPinElectrical>
export type HirSplice = Schema.Schema.Type<typeof HirSplice>
export type HirCable = Schema.Schema.Type<typeof HirCable>
export type HirProtection = Schema.Schema.Type<typeof HirProtection>

/** Decode an untrusted value (e.g. a cached `harness.json`) into HIR. Throws `ParseError`. */
export const decodeHir = Schema.decodeUnknownSync(Hir)

/** Decode as an Effect, for use inside services. */
export const decodeHirEffect = Schema.decodeUnknown(Hir)

/** Encode HIR back to its JSON-ready form. */
export const encodeHir = Schema.encodeSync(Hir)

/**
 * The HIR contract as draft-07 JSON Schema. Powers the shape-snapshot
 * guard (tests/hir-shape.test.ts) and generated schema docs; useful to
 * external validators too.
 */
export type HirJsonSchema = JSONSchema.JsonSchema7Root
export const hirJsonSchema = (): HirJsonSchema => {
  const schema = JSONSchema.make(Hir)
  // SAFETY: a JSON round trip of the generated schema only drops keys whose value
  // is `undefined`, all of which JsonSchema7Root declares optional.
  return JSON.parse(JSON.stringify(schema)) as HirJsonSchema
}


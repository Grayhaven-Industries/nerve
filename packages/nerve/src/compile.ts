/**
 * Design → HIR normalization (PRD §9.3).
 *
 * `compileDesign` is a pure, deterministic function: given the same
 * `HarnessDesign`, it produces a byte-identical HIR regardless of the order
 * in which connectors, wires, branches, or labels were authored. All
 * collections are canonically sorted and optional fields are omitted (never
 * `undefined`) so serialized output is stable and diffable.
 *
 * Structural integrity checks run here because a broken object graph makes
 * downstream rules meaningless. Domain rules (gauge vs current, twisted
 * pairs, seals, ...) belong to `@grayhaven/nerve-rules`.
 */
import type {
  DifferentialPolarity,
  ElectricalRole,
  HarnessDesign,
  PinElectrical,
  WirePart
} from "./domain.js"
import { Codes, DiagnosticSeverity, type Diagnostic } from "./diagnostics.js"
import { canonicalGauge } from "./gauge.js"
import { minBendRadius, polylineLength, type Point3 } from "./geometry.js"
import { endpointLabel, HIR_SCHEMA_VERSION, refs } from "./hir/core.js"
import {
  type Hir,
  type HirBomItem,
  type HirBranch,
  type HirCable,
  type HirConnector,
  type HirEndpoint,
  type HirLabel,
  type HirProtection,
  type HirSplice,
  type HirWire,
  type HirWirePart
} from "./hir/schema.js"

export interface CompileResult {
  readonly hir: Hir
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

/** Numeric-aware comparison so pin "10" sorts after pin "2". */
const comparePins = (a: string, b: string): number => {
  const na = Number(a)
  const nb = Number(b)
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb
  return a < b ? -1 : a > b ? 1 : 0
}

const compareStrings = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0

const isPositiveFinite = (value: number): boolean => Number.isFinite(value) && value > 0
const isNonNegativeFinite = (value: number): boolean => Number.isFinite(value) && value >= 0
const isPositiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0

const isFinitePoint = (p: Point3): boolean =>
  Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)

/**
 * How far an authored `nominalLength` may sit from the length measured off the
 * branch's own waypoints before the two are reported as contradicting.
 *
 * Relative rather than absolute: 5 mm is noise on a 3 m trunk and a third of a
 * short jumper, and the kernel is unit-agnostic, so an absolute figure would
 * mean different things in mm and in inches.
 *
 * 1% is the loosest threshold that still catches what this feature exists to
 * catch and the tightest that does not fire on honest authoring. Nominal
 * lengths are routinely rounded to the nearest 5 or 10 units (900 for a
 * measured 903.5 is 0.4%), and a routed centerline ignores the sag and the
 * take-up at each tie, so demanding closer agreement would flag every routed
 * branch. Above it the numbers disagree by more than rounding can explain: the
 * 20 mm error on a 900 mm branch that scraps 200 wires is 2.2%, well clear.
 */
const ROUTED_LENGTH_TOLERANCE = 0.01

const electricalRoles: ReadonlySet<string> = new Set([
  "source",
  "sink",
  "bidirectional",
  "passive",
  "ground"
])
const isElectricalRole = (value: unknown): value is ElectricalRole =>
  typeof value === "string" && electricalRoles.has(value)

const differentialPolarities: ReadonlySet<string> = new Set(["positive", "negative"])
const isDifferentialPolarity = (value: unknown): value is DifferentialPolarity =>
  typeof value === "string" && differentialPolarities.has(value)

/** Numeric conductor labels have one canonical identity (`01` and `1` are
 * the same conductor); non-numeric labels such as `red` remain valid. */
const normalizeConductor = (value: string | number): string | undefined => {
  const raw = String(value).trim()
  if (raw === "") return undefined
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return raw
  const numeric = Number(raw)
  return isPositiveInteger(numeric) ? String(numeric) : undefined
}

/**
 * Cut length = finished length plus everything the operator has to feed
 * into the terminations and the service loop. Strip length is deliberately
 * absent: it is a stripper setting, not extra copper.
 *
 * Kept in sync with `wireCutLength` in @grayhaven/nerve-exporters/csv, which
 * cannot be imported here (exporters depend on core, not the reverse).
 */
const cutLengthOf = (w: HirWire): number | undefined =>
  w.length === undefined
    ? undefined
    : w.length +
      (w.serviceLoop ?? 0) +
      (w.terminationAllowance?.from ?? 0) +
      (w.terminationAllowance?.to ?? 0)

/** Strip `undefined` values so optional fields are absent in serialized HIR. */
const compact = <T extends Record<string, unknown>>(obj: T): T => {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value
  }
  return out as T
}

/** Normalize wire master data into HIR, canonicalizing its gauge the same
 * way the wire's own gauge is canonicalized (see ./gauge.ts). */
const toHirWirePart = (p: WirePart): HirWirePart =>
  compact({
    mpn: p.mpn,
    manufacturer: p.manufacturer,
    family: p.family,
    description: p.description,
    gauge: canonicalGauge(p.gauge),
    strands: p.strands,
    conductorMaterial: p.conductorMaterial,
    insulation: p.insulation,
    outerDiameter: p.outerDiameter,
    voltageRating: p.voltageRating,
    temperatureRating: p.temperatureRating,
    ohmsPerKm: p.ohmsPerKm,
    gramsPerMeter: p.gramsPerMeter,
    availableColors:
      p.availableColors !== undefined ? [...p.availableColors] : undefined,
    provenance: p.provenance ? { ...p.provenance } : undefined
  })

export const compileDesign =(design: HarnessDesign): CompileResult => {
  const diagnostics: Array<Diagnostic> = []
  const report = (
    code: string,
    message: string,
    target?: string,
    severity: DiagnosticSeverity = DiagnosticSeverity.Error,
    extra?: Pick<Diagnostic, "targets" | "data">
  ) => {
    diagnostics.push({
      code,
      severity,
      message,
      ...(target !== undefined ? { target } : {}),
      ...(extra?.targets !== undefined && extra.targets.length > 0
        ? { targets: extra.targets }
        : {}),
      ...(extra?.data !== undefined ? { data: extra.data } : {})
    })
  }

  const electricalByConnector = new Map<
    string,
    Readonly<Record<string, PinElectrical>>
  >()

  const normalizePinElectrical = (
    connectorRef: string,
    pins: Readonly<Record<string, string>>,
    assignments: Readonly<Record<string, PinElectrical>>
  ): Readonly<Record<string, PinElectrical>> => {
    const normalized: Record<string, PinElectrical> = {}
    for (const [pin, electrical] of Object.entries(assignments).sort(([a], [b]) =>
      comparePins(a, b)
    )) {
      const target = refs.pin(connectorRef, pin)
      if (!Object.hasOwn(pins, pin)) {
        report(
          Codes.InvalidPinElectrical,
          `Connector ${connectorRef} assigns electrical semantics to pin ${pin}, but that pin is absent from its pin assignments.`,
          target
        )
        continue
      }

      let voltage: PinElectrical["voltage"]
      if (electrical.voltage !== undefined) {
        const { minV, maxV } = electrical.voltage
        const validMin = minV === undefined || Number.isFinite(minV)
        const validMax = maxV === undefined || Number.isFinite(maxV)
        if (!validMin) {
          report(
            Codes.InvalidPinElectrical,
            `Pin ${connectorRef}.${pin} has a non-finite minimum voltage.`,
            target,
            DiagnosticSeverity.Error,
            { data: { field: "voltage.minV" } }
          )
        }
        if (!validMax) {
          report(
            Codes.InvalidPinElectrical,
            `Pin ${connectorRef}.${pin} has a non-finite maximum voltage.`,
            target,
            DiagnosticSeverity.Error,
            { data: { field: "voltage.maxV" } }
          )
        }
        if (
          validMin &&
          validMax &&
          minV !== undefined &&
          maxV !== undefined &&
          minV > maxV
        ) {
          report(
            Codes.InvalidPinElectrical,
            `Pin ${connectorRef}.${pin} has voltage range ${minV}–${maxV}V; minV must not exceed maxV.`,
            target,
            DiagnosticSeverity.Error,
            { data: { minV, maxV } }
          )
        } else {
          voltage = {
            ...(validMin && minV !== undefined ? { minV } : {}),
            ...(validMax && maxV !== undefined ? { maxV } : {})
          }
        }
      }

      let role: ElectricalRole | undefined
      if (electrical.role !== undefined) {
        if (!isElectricalRole(electrical.role)) {
          report(
            Codes.InvalidPinElectrical,
            `Pin ${connectorRef}.${pin} has invalid electrical role "${String(electrical.role)}".`,
            target,
            DiagnosticSeverity.Error,
            { data: { field: "role" } }
          )
        } else role = electrical.role
      }

      let currentA: number | undefined
      if (electrical.currentA !== undefined) {
        if (!isPositiveFinite(electrical.currentA)) {
          report(
            Codes.InvalidPinElectrical,
            `Pin ${connectorRef}.${pin} has current ${electrical.currentA}A; currentA must be positive and finite.`,
            target,
            DiagnosticSeverity.Error,
            { data: { field: "currentA" } }
          )
        } else currentA = electrical.currentA
      }

      // Bus topology inputs (HK-ELEC-018..021). Same positive-finite gate as
      // currentA: a zero/negative terminator or bit rate is a data-entry
      // error, and the topology rules must never reason from one.
      let terminationOhms: number | undefined
      if (electrical.terminationOhms !== undefined) {
        if (!isPositiveFinite(electrical.terminationOhms)) {
          report(
            Codes.InvalidPinElectrical,
            `Pin ${connectorRef}.${pin} has termination ${electrical.terminationOhms}Ω; terminationOhms must be positive and finite.`,
            target,
            DiagnosticSeverity.Error,
            { data: { field: "terminationOhms" } }
          )
        } else terminationOhms = electrical.terminationOhms
      }

      let bitRateKbps: number | undefined
      if (electrical.bitRateKbps !== undefined) {
        if (!isPositiveFinite(electrical.bitRateKbps)) {
          report(
            Codes.InvalidPinElectrical,
            `Pin ${connectorRef}.${pin} has bit rate ${electrical.bitRateKbps}kbit/s; bitRateKbps must be positive and finite.`,
            target,
            DiagnosticSeverity.Error,
            { data: { field: "bitRateKbps" } }
          )
        } else bitRateKbps = electrical.bitRateKbps
      }

      let protocol: string | undefined
      if (electrical.protocol !== undefined) {
        protocol = electrical.protocol.trim()
        if (protocol === "") {
          report(
            Codes.InvalidPinElectrical,
            `Pin ${connectorRef}.${pin} has a blank protocol name.`,
            target,
            DiagnosticSeverity.Error,
            { data: { field: "protocol" } }
          )
          protocol = undefined
        }
      }

      let differential: PinElectrical["differential"]
      if (electrical.differential !== undefined) {
        const pair = electrical.differential.pair.trim()
        const polarity = electrical.differential.polarity
        if (pair === "") {
          report(
            Codes.InvalidPinElectrical,
            `Pin ${connectorRef}.${pin} has a blank differential pair name.`,
            target,
            DiagnosticSeverity.Error,
            { data: { field: "differential.pair" } }
          )
        }
        if (!isDifferentialPolarity(polarity)) {
          report(
            Codes.InvalidPinElectrical,
            `Pin ${connectorRef}.${pin} has invalid differential polarity "${String(polarity)}".`,
            target,
            DiagnosticSeverity.Error,
            { data: { field: "differential.polarity" } }
          )
        }
        if (pair !== "" && isDifferentialPolarity(polarity)) {
          differential = { pair, polarity }
        }
      }

      normalized[pin] = {
        ...(role !== undefined ? { role } : {}),
        ...(voltage !== undefined ? { voltage } : {}),
        ...(currentA !== undefined ? { currentA } : {}),
        ...(protocol !== undefined ? { protocol } : {}),
        ...(differential !== undefined ? { differential } : {}),
        ...(terminationOhms !== undefined ? { terminationOhms } : {}),
        ...(bitRateKbps !== undefined ? { bitRateKbps } : {})
      }
    }
    return normalized
  }

  // --- Connectors ---------------------------------------------------------
  /**
   * Fields the type system guarantees but a foreign build may not supply.
   *
   * `connector()` always populates these, so a connector missing one did not
   * come from the same library this compiler is part of. That happens when a
   * harness authored outside the workspace resolves `@grayhaven/nerve` to a
   * published build in the package cache while the compiler runs from source.
   * Reporting it is the whole point: previously the first `Object.entries` on
   * an absent field threw a bare TypeError from inside normalization, which
   * named neither the connector nor the real cause.
   */
  const REQUIRED_CONNECTOR_FIELDS = ["pins", "terminals", "seals", "electrical"] as const

  const connectorByRef = new Map<string, (typeof design.connectors)[number]>()
  for (const c of design.connectors) {
    const missing = REQUIRED_CONNECTOR_FIELDS.filter((f) => c[f] === undefined)
    if (missing.length > 0 || c.part === undefined) {
      report(
        Codes.ForeignDesignObject,
        `Connector ${c.ref ?? "(unnamed)"} is missing ${missing.length > 0 ? missing.join(", ") : "part"}, which connector() always sets. The harness was almost certainly built against a different copy of @grayhaven/nerve than this compiler — check that the project depends on the same version the compiler runs, rather than resolving one from a package cache.`,
        c.ref !== undefined ? refs.connector(c.ref) : undefined
      )
      continue
    }
    if (connectorByRef.has(c.ref)) {
      report(
        Codes.DuplicateConnectorRef,
        `Connector reference ${c.ref} is defined more than once.`,
        refs.connector(c.ref)
      )
      continue
    }
    connectorByRef.set(c.ref, c)
    electricalByConnector.set(
      c.ref,
      normalizePinElectrical(c.ref, c.pins, c.electrical)
    )
    if (!isPositiveInteger(c.part.pinCount)) {
      report(
        Codes.InvalidConnectorQuantity,
        `Connector ${c.ref} has pinCount ${c.part.pinCount}; pinCount must be a positive integer.`,
        refs.connector(c.ref),
        DiagnosticSeverity.Error,
        { data: { pinCount: c.part.pinCount } }
      )
    }
    if (
      c.part.cavityLayout !== undefined &&
      (!isPositiveInteger(c.part.cavityLayout.rows) ||
        !isPositiveInteger(c.part.cavityLayout.columns))
    ) {
      report(
        Codes.InvalidConnectorQuantity,
        `Connector ${c.ref} has cavity layout ${c.part.cavityLayout.rows}×${c.part.cavityLayout.columns}; rows and columns must be positive integers.`,
        refs.connector(c.ref),
        DiagnosticSeverity.Error,
        { data: { rows: c.part.cavityLayout.rows, columns: c.part.cavityLayout.columns } }
      )
    }
    for (const [field, value] of [
      ["currentLimitA", c.part.currentLimitA],
      ["voltageLimitV", c.part.voltageLimitV]
    ] as const) {
      if (value !== undefined && !isPositiveFinite(value)) {
        report(
          Codes.InvalidConnectorQuantity,
          `Connector ${c.ref} has ${field} ${value}; electrical ratings must be positive finite values.`,
          refs.connector(c.ref),
          DiagnosticSeverity.Error,
          { data: { field, value } }
        )
      }
    }
  }

  const connectors: Array<HirConnector> = [...connectorByRef.values()]
    .sort((a, b) => compareStrings(a.ref, b.ref))
    .map((c) =>
      compact({
        ref: c.ref,
        mpn: c.part.mpn,
        manufacturer: c.part.manufacturer,
        family: c.part.family,
        description: c.part.description,
        gender: c.part.gender,
        pinCount: c.part.pinCount,
        wireGaugeRange: c.part.wireGaugeRange
          ? { min: c.part.wireGaugeRange.min, max: c.part.wireGaugeRange.max }
          : undefined,
        matingMpn: c.part.matingMpn,
        cavityLayout: c.part.cavityLayout
          ? { rows: c.part.cavityLayout.rows, columns: c.part.cavityLayout.columns }
          : undefined,
        reservedPins: c.part.reservedPins?.map(String),
        sealed: c.part.sealed,
        currentLimitA: c.part.currentLimitA,
        voltageLimitV: c.part.voltageLimitV,
        compatibleTerminals: c.part.compatibleTerminals
          ? [...c.part.compatibleTerminals]
          : undefined,
        compatibleSeals: c.part.compatibleSeals
          ? [...c.part.compatibleSeals]
          : undefined,
        crimpTool: c.part.crimpTool,
        provenance: c.part.provenance ? { ...c.part.provenance } : undefined,
        pins: Object.entries(c.pins)
          .sort(([a], [b]) => comparePins(a, b))
          .map(([pin, signal]) =>
            compact({
              pin,
              signal,
              terminal: c.terminals[pin],
              seal: c.seals[pin],
              electrical: electricalByConnector.get(c.ref)?.[pin]
            })
          )
      })
    )

  const pinExists = (connectorRef: string, pin: string): boolean => {
    const c = connectorByRef.get(connectorRef)
    if (c === undefined) return false
    if (pin in c.pins) return true
    const n = Number(pin)
    return Number.isInteger(n) && n >= 1 && n <= c.part.pinCount
  }

  // Splice IDs must be known before wires can validate endpoints.
  const spliceIds = new Set<string>()
  for (const s of design.splices) {
    if (spliceIds.has(s.id)) {
      report(
        Codes.DuplicateSpliceId,
        `Splice ID ${s.id} is defined more than once.`,
        refs.splice(s.id)
      )
    }
    spliceIds.add(s.id)
  }

  const cableIds = new Set<string>()
  const cableById = new Map<string, (typeof design.cables)[number]>()
  for (const c of design.cables) {
    if (cableIds.has(c.id)) {
      report(
        Codes.DuplicateCableId,
        `Cable ID ${c.id} is defined more than once.`,
        `cable:${c.id}`
      )
    } else cableById.set(c.id, c)
    cableIds.add(c.id)
    if (c.conductors !== undefined && !isPositiveInteger(c.conductors)) {
      report(
        Codes.InvalidCableDefinition,
        `Cable ${c.id} has conductor count ${c.conductors}; conductor count must be a positive integer.`,
        `cable:${c.id}`,
        DiagnosticSeverity.Error,
        { data: { conductors: c.conductors } }
      )
    }
    if (c.outerDiameter !== undefined && !isPositiveFinite(c.outerDiameter)) {
      report(
        Codes.InvalidCableDefinition,
        `Cable ${c.id} has outer diameter ${c.outerDiameter}; outer diameter must be positive and finite.`,
        `cable:${c.id}`,
        DiagnosticSeverity.Error,
        { data: { outerDiameter: c.outerDiameter } }
      )
    }
  }

  const checkEndpoint = (owner: string, end: HirEndpoint) => {
    if (!("connector" in end)) {
      if (!spliceIds.has(end.splice)) {
        report(
          Codes.UndefinedSpliceRef,
          `${owner} references undefined splice ${end.splice}.`,
          refs.splice(end.splice)
        )
      }
      return
    }
    if (!connectorByRef.has(end.connector)) {
      report(
        Codes.UndefinedConnectorRef,
        `${owner} references undefined connector ${end.connector}.`,
        refs.connector(end.connector)
      )
    } else if (!pinExists(end.connector, end.pin)) {
      report(
        Codes.UndefinedPinRef,
        `${owner} references pin ${end.pin} which does not exist on connector ${end.connector}.`,
        refs.pin(end.connector, end.pin)
      )
    }
  }

  const toHirEndpoint = (e: (typeof design.wires)[number]["from"]): HirEndpoint =>
    e.kind === "pin-ref"
      ? { connector: e.connector, pin: e.pin }
      : { splice: e.splice }

  // --- Wires --------------------------------------------------------------
  const wireIds = new Set<string>()
  const wires: Array<HirWire> = []
  const conductorOwners = new Map<string, string>()
  // Branches compile after wires, so their ids are collected up front. A wire
  // naming a branch that does not exist would otherwise drop silently out of
  // every conductor count that branch feeds.
  const declaredBranchIds = new Set(design.branches.map((b) => b.id))
  for (const w of design.wires) {
    if (wireIds.has(w.id)) {
      report(
        Codes.DuplicateWireId,
        `Wire ID ${w.id} is defined more than once.`,
        refs.wire(w.id)
      )
      continue
    }
    wireIds.add(w.id)

    const ownerLabel = `Wire ${w.id}`
    const from = toHirEndpoint(w.from)
    const to = toHirEndpoint(w.to)
    checkEndpoint(ownerLabel, from)
    checkEndpoint(ownerLabel, to)
    if (endpointLabel(from) === endpointLabel(to)) {
      report(
        Codes.WireEndpointsIdentical,
        `Wire ${w.id} starts and ends on the same endpoint ${endpointLabel(from)}.`,
        refs.wire(w.id)
      )
    }
    if (w.cable !== undefined && !cableIds.has(w.cable)) {
      report(
        Codes.UndefinedCableRef,
        `Wire ${w.id} references undefined cable ${w.cable}.`,
        refs.wire(w.id)
      )
    }

    if (w.lengthTolerance !== undefined) {
      const toleranceValid = isNonNegativeFinite(w.lengthTolerance)
      const belowLength =
        w.length === undefined || !isPositiveFinite(w.length) || w.lengthTolerance < w.length
      if (!toleranceValid || !belowLength) {
        report(
          Codes.InvalidWireQuantity,
          `Wire ${w.id} has length tolerance ${w.lengthTolerance}; tolerance must be non-negative, finite, and smaller than its positive length${w.length !== undefined ? ` (${w.length})` : ""}.`,
          refs.wire(w.id),
          DiagnosticSeverity.Error,
          {
            data: {
              lengthTolerance: w.lengthTolerance,
              ...(w.length !== undefined ? { length: w.length } : {})
            }
          }
        )
      }
    }
    for (const [field, value, valid] of [
      ["voltageRating", w.voltageRating, w.voltageRating === undefined || isPositiveFinite(w.voltageRating)],
      ["currentEstimate", w.currentEstimate, w.currentEstimate === undefined || isNonNegativeFinite(w.currentEstimate)],
      ["temperatureRating", w.temperatureRating, w.temperatureRating === undefined || Number.isFinite(w.temperatureRating)]
    ] as const) {
      if (!valid && value !== undefined) {
        report(
          Codes.InvalidWireQuantity,
          `Wire ${w.id} has invalid ${field} ${value}.`,
          refs.wire(w.id),
          DiagnosticSeverity.Error,
          { data: { field, value } }
        )
      }
    }

    const conductor =
      w.conductor !== undefined ? normalizeConductor(w.conductor) : undefined
    if (w.conductor !== undefined && conductor === undefined) {
      report(
        Codes.InvalidCableConductor,
        `Wire ${w.id} has invalid conductor identifier "${String(w.conductor)}"; use a positive integer or a non-empty name.`,
        refs.wire(w.id)
      )
    }
    if (w.conductor !== undefined && w.cable === undefined) {
      report(
        Codes.InvalidCableConductor,
        `Wire ${w.id} declares conductor ${String(w.conductor)} without declaring a cable.`,
        refs.wire(w.id)
      )
    }
    if (w.cable !== undefined && conductor !== undefined) {
      const cable = cableById.get(w.cable)
      const numeric = /^\d+$/.test(conductor) ? Number(conductor) : undefined
      if (numeric !== undefined && cable?.conductors !== undefined && numeric > cable.conductors) {
        report(
          Codes.InvalidCableConductor,
          `Wire ${w.id} uses conductor ${conductor} of cable ${w.cable}, but that cable has only ${cable.conductors} conductors.`,
          refs.wire(w.id),
          DiagnosticSeverity.Error,
          { data: { cable: w.cable, conductor, conductors: cable.conductors } }
        )
      }
      const key = `${w.cable}\u0000${conductor}`
      const previous = conductorOwners.get(key)
      if (previous !== undefined) {
        report(
          Codes.DuplicateCableConductor,
          `Wires ${previous} and ${w.id} both claim conductor ${conductor} of cable ${w.cable}.`,
          refs.wire(w.id),
          DiagnosticSeverity.Error,
          {
            targets: [refs.wire(previous)],
            data: { cable: w.cable, conductor, firstWire: previous }
          }
        )
      } else conductorOwners.set(key, w.id)
    }

    if (w.branch !== undefined && !declaredBranchIds.has(w.branch)) {
      report(
        Codes.WireUndefinedBranch,
        `Wire ${w.id} declares branch ${w.branch}, which is not defined.`,
        refs.wire(w.id)
      )
    }
    wires.push(
      compact({
        id: w.id,
        from,
        to,
        part: w.part !== undefined ? toHirWirePart(w.part) : undefined,
        // "awg 20" / "20 AWG" / "20" all compile to "20AWG" so gauge-based
        // rules and exporters see one spelling (HK-MFG-007 flags the rest).
        gauge: w.gauge !== undefined ? canonicalGauge(w.gauge) : undefined,
        color: w.color,
        stripe: w.stripe,
        length: w.length,
        lengthTolerance: w.lengthTolerance,
        serviceLoop: w.serviceLoop,
        stripLength:
          w.stripLength !== undefined
            ? { from: w.stripLength.from, to: w.stripLength.to }
            : undefined,
        terminationAllowance:
          w.terminationAllowance !== undefined
            ? { from: w.terminationAllowance.from, to: w.terminationAllowance.to }
            : undefined,
        signal: w.signal,
        insulation: w.insulation,
        voltageRating: w.voltageRating,
        temperatureRating: w.temperatureRating,
        currentEstimate: w.currentEstimate,
        emcClass: w.emcClass,
        twistGroup: w.twistGroup,
        shieldGroup: w.shieldGroup,
        branch: w.branch,
        cable: w.cable,
        conductor,
        notes: w.notes
      })
    )
  }
  wires.sort((a, b) => compareStrings(a.id, b.id))

  // --- Splices --------------------------------------------------------------
  const spliceWires = (id: string): Array<string> =>
    wires
      .filter(
        (w) =>
          (!("connector" in w.from) && w.from.splice === id) ||
          (!("connector" in w.to) && w.to.splice === id)
      )
      .map((w) => w.id)

  const designBranchIds = new Set(design.branches.map((b) => b.id))
  const seenSplices = new Set<string>()
  const splices: Array<HirSplice> = []
  for (const s of design.splices) {
    if (seenSplices.has(s.id)) continue // duplicate already reported
    seenSplices.add(s.id)
    if (s.branch !== undefined && !designBranchIds.has(s.branch)) {
      report(
        Codes.SpliceUndefinedBranch,
        `Splice ${s.id} is located on undefined branch ${s.branch}.`,
        refs.splice(s.id)
      )
    }
    if (s.location !== undefined && !isNonNegativeFinite(s.location)) {
      report(
        Codes.InvalidSpliceLocation,
        `Splice ${s.id} has location ${s.location}; splice location must be non-negative and finite.`,
        refs.splice(s.id),
        DiagnosticSeverity.Error,
        { data: { location: s.location } }
      )
    }
    const attached = spliceWires(s.id)
    if (attached.length < 2) {
      report(
        Codes.SpliceTooFewWires,
        `Splice ${s.id} joins ${attached.length} wire(s); a splice needs at least 2.`,
        refs.splice(s.id),
        DiagnosticSeverity.Error,
        { targets: attached.map(refs.wire), data: { attachedWires: attached.length } }
      )
    }
    splices.push(
      compact({
        id: s.id,
        type: s.type,
        part: s.part,
        branch: s.branch,
        location: s.location,
        notes: s.notes,
        wires: attached
      })
    )
  }
  splices.sort((a, b) => compareStrings(a.id, b.id))

  // --- Cables ---------------------------------------------------------------
  const seenCables = new Set<string>()
  const cables: Array<HirCable> = []
  for (const c of design.cables) {
    if (seenCables.has(c.id)) continue
    seenCables.add(c.id)
    const members = wires.filter((w) => w.cable === c.id)
    const lengths = members
      .map((w) => w.length)
      .filter((l): l is number => l !== undefined)
    cables.push(
      compact({
        id: c.id,
        type: c.type,
        conductors: c.conductors,
        shield: c.shield,
        jacket: c.jacket,
        outerDiameter: c.outerDiameter,
        cutLength: lengths.length > 0 ? Math.max(...lengths) : undefined,
        notes: c.notes,
        wires: members.map((w) => w.id)
      })
    )
  }
  cables.sort((a, b) => compareStrings(a.id, b.id))

  // --- Branches -----------------------------------------------------------
  const branchIds = new Set<string>()
  const branches: Array<HirBranch> = []
  for (const b of design.branches) {
    if (branchIds.has(b.id)) {
      report(
        Codes.DuplicateBranchId,
        `Branch ID ${b.id} is defined more than once.`,
        refs.branch(b.id)
      )
      continue
    }
    branchIds.add(b.id)

    for (const [field, value, valid] of [
      ["nominalLength", b.nominalLength, b.nominalLength === undefined || isPositiveFinite(b.nominalLength)],
      ["breakoutDistance", b.breakoutDistance, b.breakoutDistance === undefined || isNonNegativeFinite(b.breakoutDistance)],
      ["minBendRadius", b.minBendRadius, b.minBendRadius === undefined || isPositiveFinite(b.minBendRadius)],
      ["ambientTemperatureC", b.ambientTemperatureC, b.ambientTemperatureC === undefined || Number.isFinite(b.ambientTemperatureC)]
    ] as const) {
      if (!valid && value !== undefined) {
        report(
          Codes.InvalidBranchGeometry,
          `Branch ${b.id} has invalid ${field} ${value}.`,
          refs.branch(b.id),
          DiagnosticSeverity.Error,
          { data: { field, value } }
        )
      }
    }

    for (const endpoint of b.path) {
      if (!connectorByRef.has(endpoint)) {
        report(
          Codes.BranchUndefinedEndpoint,
          `Branch ${b.id} path references undefined connector ${endpoint}.`,
          refs.branch(b.id)
        )
      }
    }

    /**
     * Fewer than two waypoints is not a route, it is an unfinished one, and it
     * is rejected rather than measured: `polylineLength` of a lone point is 0,
     * and a `routedLength` of 0 would travel downstream as a measurement — into
     * a cut list, a formboard, the bend-radius rule — indistinguishable from a
     * branch that really was measured at zero. An unfinished route is a
     * data-entry error (HK-BRANCH-003, the same code as any other unusable
     * branch geometry) and contributes nothing: no `waypoints`, no
     * `routedLength`, no `routedMinBendRadius`. Non-finite coordinates are
     * rejected the same way — a NaN would otherwise poison the sum silently.
     *
     * A route of two or more points is always measured, and `routedLength` is
     * then present whether or not the author also typed a `nominalLength`, so
     * "the branch is not routed" (key absent) can never be read as "the two
     * lengths agree".
     */
    const authoredWaypoints = b.waypoints
    const routed =
      authoredWaypoints !== undefined &&
      authoredWaypoints.length >= 2 &&
      authoredWaypoints.every(isFinitePoint)
        ? // Rebuilt in canonical key order rather than aliased: HIR is
          // serialized byte-for-byte, and authored objects carry no promise
          // about their key order or their extra keys.
          authoredWaypoints.map((p): Point3 => ({ x: p.x, y: p.y, z: p.z }))
        : undefined
    if (authoredWaypoints !== undefined && routed === undefined) {
      report(
        Codes.InvalidBranchGeometry,
        `Branch ${b.id} declares ${authoredWaypoints.length} waypoint(s) with finite coordinates required; a route needs at least two.`,
        refs.branch(b.id),
        DiagnosticSeverity.Error,
        { data: { field: "waypoints", waypoints: authoredWaypoints.length } }
      )
    }

    const routedLength = routed !== undefined ? polylineLength(routed) : undefined
    // `undefined` for a straight run — infinite radius, not zero. Passed
    // through as absence so the bend-radius rule never reads it as a bend.
    const routedMinBendRadius = routed !== undefined ? minBendRadius(routed) : undefined

    // Both numbers claim to be the same length. When they disagree by more than
    // rounding can explain, one of them is wrong, and which one is wrong is the
    // author's call — the compiler only refuses to pick silently.
    if (
      routedLength !== undefined &&
      b.nominalLength !== undefined &&
      isPositiveFinite(b.nominalLength)
    ) {
      const scale = Math.max(b.nominalLength, routedLength)
      const relative = Math.abs(b.nominalLength - routedLength) / scale
      if (relative > ROUTED_LENGTH_TOLERANCE) {
        report(
          Codes.BranchLengthMismatch,
          `Branch ${b.id} declares nominalLength ${b.nominalLength} but its waypoints measure ${routedLength}.`,
          refs.branch(b.id),
          DiagnosticSeverity.Error,
          {
            data: {
              nominalLength: b.nominalLength,
              routedLength,
              tolerance: ROUTED_LENGTH_TOLERANCE
            }
          }
        )
      }
    }

    branches.push(
      compact({
        id: b.id,
        path: [...b.path],
        parent: b.parent,
        sleeve: b.sleeve,
        nominalLength: b.nominalLength,
        breakoutDistance: b.breakoutDistance,
        minBendRadius: b.minBendRadius,
        ambientTemperatureC: b.ambientTemperatureC,
        waypoints: routed,
        routedLength,
        routedMinBendRadius
      })
    )
  }
  branches.sort((a, b) => compareStrings(a.id, b.id))

  // --- Protections --------------------------------------------------------
  const protectionIds = new Set<string>()
  const protections: Array<HirProtection> = []
  for (const p of design.protections) {
    if (protectionIds.has(p.id)) {
      report(
        Codes.DuplicateProtectionId,
        `Protection ID ${p.id} is defined more than once.`,
        `protection:${p.id}`
      )
      continue
    }
    protectionIds.add(p.id)
    if (!isPositiveFinite(p.ratingA)) {
      report(
        Codes.InvalidProtectionRating,
        `${p.kind} ${p.id} has rating ${p.ratingA}A; protection ratings must be positive and finite.`,
        `protection:${p.id}`,
        DiagnosticSeverity.Error,
        { data: { ratingA: p.ratingA } }
      )
    }
    for (const wireId of p.protects) {
      if (!wireIds.has(wireId)) {
        report(
          Codes.ProtectionUndefinedWire,
          `Protection ${p.id} guards undefined wire ${wireId}.`,
          `protection:${p.id}`
        )
      }
    }
    protections.push(
      compact({
        id: p.id,
        kind: p.kind,
        ratingA: p.ratingA,
        protects: [...p.protects].sort(compareStrings),
        notes: p.notes
      })
    )
  }
  protections.sort((a, b) => compareStrings(a.id, b.id))

  // --- Labels ---------------------------------------------------------------
  const labelIds = new Set<string>()
  const labels: Array<HirLabel> = []
  for (const l of design.labels) {
    if (labelIds.has(l.id)) {
      report(
        Codes.DuplicateLabelId,
        `Label ID ${l.id} is defined more than once.`,
        refs.label(l.id)
      )
      continue
    }
    labelIds.add(l.id)

    if (l.distance !== undefined && !isNonNegativeFinite(l.distance)) {
      report(
        Codes.InvalidLabelQuantity,
        `Label ${l.id} has distance ${l.distance}; placement distance must be non-negative and finite.`,
        refs.label(l.id),
        DiagnosticSeverity.Error,
        { data: { distance: l.distance } }
      )
    }
    if (l.quantity !== undefined && !isPositiveInteger(l.quantity)) {
      report(
        Codes.InvalidLabelQuantity,
        `Label ${l.id} has quantity ${l.quantity}; label quantity must be a positive integer.`,
        refs.label(l.id),
        DiagnosticSeverity.Error,
        { data: { quantity: l.quantity } }
      )
    }

    if (!branchIds.has(l.attachTo) && !connectorByRef.has(l.attachTo)) {
      report(
        Codes.LabelUndefinedTarget,
        `Label ${l.id} attaches to ${l.attachTo}, which is not a defined branch or connector.`,
        refs.label(l.id)
      )
    }
    if (l.offsetFrom !== undefined && !connectorByRef.has(l.offsetFrom)) {
      report(
        Codes.LabelUndefinedTarget,
        `Label ${l.id} is offset from ${l.offsetFrom}, which is not a defined connector.`,
        refs.label(l.id)
      )
    }

    labels.push(
      compact({
        id: l.id,
        text: l.text,
        attachTo: l.attachTo,
        offsetFrom: l.offsetFrom,
        distance: l.distance,
        material: l.material,
        quantity: l.quantity
      })
    )
  }
  labels.sort((a, b) => compareStrings(a.id, b.id))

  // --- BOM (connector housings + terminals + seals + wire) ------------------
  const bomByMpn = new Map<
    string,
    { item: Omit<HirBomItem, "usedBy" | "quantity">; usedBy: Array<string>; qty: number }
  >()
  const bomAdd = (
    mpn: string,
    category: string,
    usedBy: string,
    extra: Partial<Omit<HirBomItem, "usedBy" | "quantity" | "mpn">> = {}
  ): void => {
    const existing = bomByMpn.get(mpn)
    if (existing) {
      existing.qty += 1
      existing.usedBy.push(usedBy)
    } else {
      bomByMpn.set(mpn, {
        item: compact({ mpn, category, unitOfMeasure: "ea", ...extra }) as Omit<
          HirBomItem,
          "usedBy" | "quantity"
        >,
        usedBy: [usedBy],
        qty: 1
      })
    }
  }
  for (const c of [...connectorByRef.values()].sort((a, b) => compareStrings(a.ref, b.ref))) {
    bomAdd(c.part.mpn, "connector", refs.connector(c.ref), {
      manufacturer: c.part.manufacturer,
      description: c.part.description
    })
    for (const [pin, terminal] of Object.entries(c.terminals).sort(([a], [b]) =>
      comparePins(a, b)
    )) {
      bomAdd(terminal, "terminal", refs.pin(c.ref, pin))
    }
    for (const [pin, seal] of Object.entries(c.seals).sort(([a], [b]) =>
      comparePins(a, b)
    )) {
      bomAdd(seal, "seal", refs.pin(c.ref, pin))
    }
  }
  for (const s of splices) {
    if (s.part !== undefined) bomAdd(s.part, "splice", refs.splice(s.id))
  }

  // Wire is bought by length, not by the each, so it rolls up on its own:
  // quantity is summed cut length in harness units. Opt-in — a wire without
  // a declared `part` names no material and cannot be ordered, so it stays
  // off the BOM entirely.
  const wireBomByMpn = new Map<
    string,
    { part: HirWirePart; quantity: number; usedBy: Array<string> }
  >()
  for (const w of wires) {
    if (w.part === undefined) continue
    const existing = wireBomByMpn.get(w.part.mpn)
    const length = cutLengthOf(w) ?? 0
    if (existing) {
      existing.quantity += length
      existing.usedBy.push(refs.wire(w.id))
    } else {
      wireBomByMpn.set(w.part.mpn, {
        part: w.part,
        quantity: length,
        usedBy: [refs.wire(w.id)]
      })
    }
  }
  const wireBom: Array<HirBomItem> = [...wireBomByMpn.values()].map(
    ({ part, quantity, usedBy }) =>
      compact({
        mpn: part.mpn,
        manufacturer: part.manufacturer,
        description: part.description,
        category: "wire",
        quantity,
        unitOfMeasure: design.units,
        usedBy: [...usedBy].sort(compareStrings)
      })
  )

  const bom: Array<HirBomItem> = [
    ...[...bomByMpn.values()].map(({ item, usedBy, qty }) => ({
      ...item,
      quantity: qty,
      usedBy
    })),
    ...wireBom
  ].sort((a, b) => compareStrings(a.mpn, b.mpn))

  // --- Diagnostics (canonical order) ----------------------------------------
  diagnostics.sort(
    (a, b) =>
      compareStrings(a.target ?? "", b.target ?? "") ||
      compareStrings(a.code, b.code) ||
      compareStrings(a.message, b.message)
  )

  const hir: Hir = {
    schemaVersion: HIR_SCHEMA_VERSION,
    harness: {
      id: design.id,
      revision: design.revision,
      units: design.units,
      metadata: design.metadata
    },
    connectors,
    wires,
    cables,
    branches,
    splices,
    labels,
    bom,
    // Omitted when empty so existing golden HIR stays byte-identical.
    ...(protections.length > 0 ? { protections } : {}),
    diagnostics,
    layoutHints: [],
    exports: {}
  }

  return { hir, diagnostics }
}

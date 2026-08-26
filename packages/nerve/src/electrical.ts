/** Deterministic electrical constraint analysis over compiled HIR nets. */
import type { PinElectrical, VoltageRange } from "./domain.js"
import { refs } from "./hir/core.js"
import type { Hir } from "./hir/schema.js"
import { computeNets } from "./nets.js"

export type ElectricalConstraintKind =
  | "multiple-sources"
  | "undriven-load"
  | "voltage-incompatible"
  | "protocol-mismatch"
  | "differential-conflict"
  | "source-current-exceeded"

export interface ElectricalPinFact {
  readonly ref: string
  readonly connector: string
  readonly pin: string
  readonly electrical: PinElectrical
}

export interface ElectricalNetSemantics {
  readonly root: string
  readonly name: string
  readonly pins: ReadonlyArray<ElectricalPinFact>
}

export interface ElectricalConstraintFinding {
  readonly kind: ElectricalConstraintKind
  readonly net: string
  readonly pins: ReadonlyArray<string>
  readonly message: string
  readonly data?: Readonly<Record<string, string | number>>
}

export interface ElectricalAnalysis {
  readonly nets: ReadonlyArray<ElectricalNetSemantics>
  readonly findings: ReadonlyArray<ElectricalConstraintFinding>
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const sortedUnique = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)].sort(cmp)

const completeVoltage = (
  electrical: PinElectrical
): { readonly minV: number; readonly maxV: number } | undefined => {
  const minV = electrical.voltage?.minV
  const maxV = electrical.voltage?.maxV
  if (
    minV === undefined ||
    maxV === undefined ||
    !Number.isFinite(minV) ||
    !Number.isFinite(maxV) ||
    minV > maxV
  ) {
    return undefined
  }
  return { minV, maxV }
}

const knownPositiveCurrent = (electrical: PinElectrical): number | undefined => {
  const value = electrical.currentA
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

const pinRefs = (
  pins: ReadonlyArray<ElectricalPinFact>
): ReadonlyArray<string> => pins.map((pin) => pin.ref).sort(cmp)

const toPinElectrical = (
  electrical: NonNullable<Hir["connectors"][number]["pins"][number]["electrical"]>
): PinElectrical => {
  let out: PinElectrical = {}
  if (electrical.role !== undefined) out = { ...out, role: electrical.role }
  if (electrical.voltage !== undefined) {
    let voltage: VoltageRange = {}
    if (electrical.voltage.minV !== undefined) {
      voltage = { ...voltage, minV: electrical.voltage.minV }
    }
    if (electrical.voltage.maxV !== undefined) {
      voltage = { ...voltage, maxV: electrical.voltage.maxV }
    }
    out = { ...out, voltage }
  }
  if (electrical.currentA !== undefined) out = { ...out, currentA: electrical.currentA }
  if (electrical.protocol !== undefined) out = { ...out, protocol: electrical.protocol }
  if (electrical.differential !== undefined) {
    out = {
      ...out,
      differential: {
        pair: electrical.differential.pair,
        polarity: electrical.differential.polarity
      }
    }
  }
  return out
}

const findingsForNet = (
  net: ElectricalNetSemantics,
  wiredPinRefs: ReadonlySet<string>
): ReadonlyArray<ElectricalConstraintFinding> => {
  const findings: Array<ElectricalConstraintFinding> = []
  const sources = net.pins.filter((pin) => pin.electrical.role === "source")
  const sinks = net.pins.filter((pin) => pin.electrical.role === "sink")
  const bidirectional = net.pins.filter(
    (pin) => pin.electrical.role === "bidirectional"
  )

  if (sources.length >= 2) {
    const pins = pinRefs(sources)
    findings.push({
      kind: "multiple-sources",
      net: net.name,
      pins,
      message: `Net ${net.name} has multiple declared sources: ${pins.join(", ")}.`,
      data: { sources: sources.length }
    })
  }

  const rolesComplete = [...wiredPinRefs].every(
    (ref) =>
      net.pins.find((pin) => pin.ref === ref)?.electrical.role !== undefined
  )
  if (
    rolesComplete &&
    sinks.length > 0 &&
    sources.length === 0 &&
    bidirectional.length === 0
  ) {
    const pins = pinRefs(sinks)
    findings.push({
      kind: "undriven-load",
      net: net.name,
      pins,
      message: `Net ${net.name} has declared loads but no source or bidirectional driver.`
    })
  }

  const rangedPins = net.pins.flatMap((pin) => {
    const voltage = completeVoltage(pin.electrical)
    return voltage === undefined ? [] : [{ pin, voltage }]
  })
  const comparedVoltagePairs = new Set<string>()
  const addVoltageFinding = (
    first: (typeof rangedPins)[number],
    second: (typeof rangedPins)[number],
    source: ElectricalPinFact | undefined
  ): void => {
    const orderedRefs = [first.pin.ref, second.pin.ref].sort(cmp)
    const pairKey = orderedRefs.join("\u0000")
    if (comparedVoltagePairs.has(pairKey)) return
    comparedVoltagePairs.add(pairKey)

    if (source !== undefined) {
      const sourceEntry = source.ref === first.pin.ref ? first : second
      const affected = source.ref === first.pin.ref ? second : first
      findings.push({
        kind: "voltage-incompatible",
        net: net.name,
        pins: [source.ref, affected.pin.ref],
        message: `Source ${source.ref} range ${sourceEntry.voltage.minV}–${sourceEntry.voltage.maxV}V is not wholly accepted by ${affected.pin.ref} range ${affected.voltage.minV}–${affected.voltage.maxV}V on net ${net.name}.`,
        data: {
          sourceMinV: sourceEntry.voltage.minV,
          sourceMaxV: sourceEntry.voltage.maxV,
          affectedMinV: affected.voltage.minV,
          affectedMaxV: affected.voltage.maxV
        }
      })
      return
    }

    const primaryRef = orderedRefs[0]!
    const affectedRef = orderedRefs[1]!
    const primary = first.pin.ref === primaryRef ? first : second
    const affected = first.pin.ref === affectedRef ? first : second
    findings.push({
      kind: "voltage-incompatible",
      net: net.name,
      pins: orderedRefs,
      message: `Complete voltage ranges ${primaryRef} ${primary.voltage.minV}–${primary.voltage.maxV}V and ${affectedRef} ${affected.voltage.minV}–${affected.voltage.maxV}V are disjoint on net ${net.name}.`,
      data: {
        primaryMinV: primary.voltage.minV,
        primaryMaxV: primary.voltage.maxV,
        affectedMinV: affected.voltage.minV,
        affectedMaxV: affected.voltage.maxV
      }
    })
  }

  for (const source of sources) {
    const sourceEntry = rangedPins.find(({ pin }) => pin.ref === source.ref)
    if (sourceEntry === undefined) continue
    for (const other of rangedPins) {
      if (other.pin.ref === source.ref || other.pin.electrical.role === "source") {
        continue
      }
      if (
        sourceEntry.voltage.minV < other.voltage.minV ||
        sourceEntry.voltage.maxV > other.voltage.maxV
      ) {
        addVoltageFinding(sourceEntry, other, source)
      }
    }
  }

  for (let i = 0; i < rangedPins.length; i += 1) {
    const first = rangedPins[i]!
    for (let j = i + 1; j < rangedPins.length; j += 1) {
      const second = rangedPins[j]!
      const disjoint =
        first.voltage.maxV < second.voltage.minV ||
        second.voltage.maxV < first.voltage.minV
      if (!disjoint) continue
      const source =
        first.pin.electrical.role === "source"
          ? first.pin
          : second.pin.electrical.role === "source"
            ? second.pin
            : undefined
      addVoltageFinding(first, second, source)
    }
  }

  const protocolPins = net.pins.flatMap((pin) => {
    const protocol = pin.electrical.protocol?.trim()
    return protocol === undefined || protocol === "" ? [] : [{ pin, protocol }]
  })
  const protocols = sortedUnique(protocolPins.map(({ protocol }) => protocol))
  if (protocols.length > 1) {
    findings.push({
      kind: "protocol-mismatch",
      net: net.name,
      pins: pinRefs(protocolPins.map(({ pin }) => pin)),
      message: `Net ${net.name} mixes declared protocols: ${protocols.join(", ")}.`,
      data: { protocols: protocols.join(",") }
    })
  }

  const differentialPins = net.pins.flatMap((pin) => {
    const differential = pin.electrical.differential
    if (differential === undefined) return []
    const pair = differential.pair.trim()
    return pair === "" ? [] : [{ pin, pair, polarity: differential.polarity }]
  })
  const pairs = sortedUnique(differentialPins.map(({ pair }) => pair))
  const polarities = sortedUnique(
    differentialPins.map(({ polarity }) => polarity)
  )
  if (pairs.length > 1 || polarities.length > 1) {
    findings.push({
      kind: "differential-conflict",
      net: net.name,
      pins: pinRefs(differentialPins.map(({ pin }) => pin)),
      message: `Net ${net.name} has conflicting differential declarations.`,
      data: {
        pairs: pairs.join(","),
        polarities: polarities.join(",")
      }
    })
  }

  if (sources.length === 1) {
    const source = sources[0]!
    const capacityA = knownPositiveCurrent(source.electrical)
    if (capacityA !== undefined) {
      const knownSinks = sinks.flatMap((sink) => {
        const demandA = knownPositiveCurrent(sink.electrical)
        return demandA === undefined ? [] : [{ sink, demandA }]
      })
      const demandA = knownSinks.reduce((sum, item) => sum + item.demandA, 0)
      if (demandA > capacityA) {
        findings.push({
          kind: "source-current-exceeded",
          net: net.name,
          pins: [
            source.ref,
            ...knownSinks.map(({ sink }) => sink.ref).sort(cmp)
          ],
          message: `Known sink demand ${demandA}A exceeds source ${source.ref} capacity ${capacityA}A on net ${net.name}.`,
          data: { capacityA, demandA }
        })
      }
    }
  }

  return findings
}

/**
 * Analyze only wired connector pins carrying an explicit electrical object.
 * Missing facts are unknown, not errors: no constraint is inferred from them.
 */
export const analyzeElectricalConstraints = (hir: Hir): ElectricalAnalysis => {
  const connectivity = computeNets(hir)
  const electricalByPin = new Map<string, ElectricalPinFact>()
  for (const connector of hir.connectors) {
    for (const pin of connector.pins) {
      if (pin.electrical === undefined) continue
      const ref = refs.pin(connector.ref, pin.pin)
      electricalByPin.set(ref, {
        ref,
        connector: connector.ref,
        pin: pin.pin,
        electrical: toPinElectrical(pin.electrical)
      })
    }
  }

  const pinsByRoot = new Map<string, Map<string, ElectricalPinFact>>()
  const wiredPinsByRoot = new Map<string, Set<string>>()
  const namesByRoot = new Map<string, string>()
  for (const wire of hir.wires) {
    for (const endpoint of [wire.from, wire.to]) {
      if (!("connector" in endpoint)) continue
      const ref = refs.pin(endpoint.connector, endpoint.pin)
      const root = connectivity.rootOf(endpoint)
      const wiredPins = wiredPinsByRoot.get(root) ?? new Set<string>()
      wiredPins.add(ref)
      wiredPinsByRoot.set(root, wiredPins)
      namesByRoot.set(root, connectivity.nameOf(endpoint) ?? root)
      const fact = electricalByPin.get(ref)
      if (fact === undefined) continue
      const facts = pinsByRoot.get(root) ?? new Map<string, ElectricalPinFact>()
      facts.set(ref, fact)
      pinsByRoot.set(root, facts)
    }
  }

  const nets: ReadonlyArray<ElectricalNetSemantics> = [...pinsByRoot.entries()]
    .map(([root, facts]) => ({
      root,
      name: namesByRoot.get(root) ?? root,
      pins: [...facts.values()].sort((a, b) => cmp(a.ref, b.ref))
    }))
    .sort((a, b) => cmp(a.root, b.root))

  const findings = nets
    .flatMap((net) => findingsForNet(net, wiredPinsByRoot.get(net.root) ?? new Set()))
    .sort(
      (a, b) =>
        cmp(a.net, b.net) ||
        cmp(a.kind, b.kind) ||
        cmp(a.pins.join("\u0000"), b.pins.join("\u0000")) ||
        cmp(a.message, b.message)
    )

  return { nets, findings }
}

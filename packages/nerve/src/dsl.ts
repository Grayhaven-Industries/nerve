/**
 * TypeScript authoring DSL (PRD §9.1).
 *
 * Builders are cheap and permissive: they capture intent as plain data.
 * Correctness lives in the compiler/validator, which reports precise
 * diagnostics instead of throwing mid-definition.
 */
import type {
  SealPart,
  TerminalPart,
  BranchDef,
  BranchProps,
  CableDef,
  CableProps,
  ConnectorInstance,
  ConnectorPart,
  HarnessDesign,
  HarnessProps,
  LabelDef,
  LabelProps,
  PinAssignments,
  PinElectrical,
  PinElectricalAssignments,
  PinRef,
  ProtectionDef,
  ProtectionProps,
  SpliceDef,
  SpliceProps,
  WireDef,
  WireEndpoint,
  WireProps
} from "./domain.js"
import { isString } from "./is-string.js"

const toRef = (target: ConnectorInstance | string): string =>
  isString(target) ? target : target.ref

/**
 * A pin-level part, given either as a bare MPN or as a full record, as a map
 * of pin → part or a single value applied to every assigned pin (the common
 * case — one terminal type per housing).
 *
 * Both spellings stay valid on purpose: an MPN is what a migrated wire list
 * carries, and a record is what makes the contact's own limits and its crimp
 * process data available to rules and work instructions. Supplying a record
 * never changes the MPN that reaches HIR, so existing designs are unaffected.
 */
export type PinPart<T> = string | T
export type PinPartAssignment<T = never> =
  | PinPart<T>
  | Readonly<Record<string | number, PinPart<T>>>

export interface ConnectorProps {
  readonly pins: PinAssignments
  readonly terminals?: PinPartAssignment<TerminalPart>
  readonly seals?: PinPartAssignment<SealPart>
  readonly electrical?: PinElectricalAssignments
}

const mpnOf = <T extends { readonly mpn: string }>(p: PinPart<T>): string =>
  isString(p) ? p : p.mpn

interface PinPartExpansion<T> {
  readonly mpns: Record<string, string>
  readonly parts: Record<string, T>
}

/**
 * Expand a pin-part assignment to per-pin MPNs and, where a full record was
 * supplied, the records beside them. The MPN map is what it has always been,
 * so HIR and the BOM are unchanged for designs that pass strings.
 */
const expandPinParts = <T extends { readonly mpn: string }>(
  assignment: PinPartAssignment<T> | undefined,
  pins: Readonly<Record<string, string>>
): PinPartExpansion<T> => {
  if (assignment === undefined) return { mpns: {}, parts: {} }
  // SAFETY: a pin map is keyed by pin labels and no pin is labelled `mpn`, so a
  // value carrying `mpn` is one part applied to every pin, and any other object
  // is the per-pin map.
  const entries: Array<readonly [string, PinPart<T>]> =
    isString(assignment) || "mpn" in assignment
      ? Object.keys(pins).map((pin) => [pin, assignment as PinPart<T>] as const)
      : Object.entries(assignment as Readonly<Record<string, PinPart<T>>>).map(
          ([pin, p]) => [String(pin), p] as const
        )
  const mpns: Record<string, string> = {}
  const parts: Record<string, T> = {}
  for (const [pin, p] of entries) {
    mpns[pin] = mpnOf(p)
    if (!isString(p)) parts[pin] = p
  }
  return { mpns, parts }
}

/** Place a connector in the harness: `connector("J1", MolexMicroFit["43025-0800"], { pins: {...}, terminals: "43030-0007" })`. */
export const connector = (
  ref: string,
  part: ConnectorPart,
  opts: ConnectorProps
): ConnectorInstance => {
  const pins: Record<string, string> = {}
  for (const [pin, signal] of Object.entries(opts.pins)) {
    pins[String(pin)] = signal
  }
  const electrical: Record<string, PinElectrical> = {}
  for (const [pin, semantics] of Object.entries(opts.electrical ?? {})) {
    electrical[String(pin)] = semantics
  }
  const terminals = expandPinParts(opts.terminals, pins)
  const seals = expandPinParts(opts.seals, pins)
  // Omitted when no record was supplied, so a string-only design produces
  // the identical ConnectorInstance it always has.
  let records: Pick<ConnectorInstance, "terminalParts" | "sealParts"> = {}
  if (Object.keys(terminals.parts).length > 0) {
    records = { ...records, terminalParts: terminals.parts }
  }
  if (Object.keys(seals.parts).length > 0) records = { ...records, sealParts: seals.parts }
  return {
    kind: "connector",
    ref,
    part,
    pins,
    terminals: terminals.mpns,
    seals: seals.mpns,
    ...records,
    electrical,
    pin: (pin: string | number): PinRef => ({
      kind: "pin-ref",
      connector: ref,
      pin: String(pin)
    })
  }
}

/** Anything a wire can terminate on: a pin ref, a splice (def or ref). */
export type EndpointInput = PinRef | SpliceDef | { kind: "splice-ref"; splice: string }

const toEndpoint = (input: EndpointInput): WireEndpoint =>
  input.kind === "splice"
    ? { kind: "splice-ref", splice: input.id }
    : input

/**
 * Define a wire between two endpoints:
 * `wire("W1", j1.pin(1), m1.pin(1), { gauge: "18AWG", ... })` or
 * `wire("W5", j1.pin(2), s1, {...})` where `s1` is a splice.
 */
export const wire = (
  id: string,
  from: EndpointInput,
  to: EndpointInput,
  props: WireProps = {}
): WireDef => ({
  kind: "wire",
  id,
  from: toEndpoint(from),
  to: toEndpoint(to),
  ...props
})

/** Define a splice node: `splice("S1", { type: "crimp", branch: "main", location: 120 })`. */
export const splice = (id: string, props: SpliceProps = {}): SpliceDef => ({
  kind: "splice",
  id,
  ...props
})

/** Define a multi-conductor cable that wires can belong to via `cable`/`conductor` props. */
export const cable = (id: string, props: CableProps = {}): CableDef => ({
  kind: "cable",
  id,
  ...props
})

/** Define a physical branch through the harness: `branch("main", { path: [j1, m1], ... })`. */
export const branch = (id: string, props: BranchProps): BranchDef => {
  const { path, ...rest } = props
  return {
    kind: "branch",
    id,
    path: path.map(toRef),
    ...rest
  }
}

/** Define an overcurrent device and the wires it guards:
 * `protection("F1", { kind: "fuse", ratingA: 5, protects: ["W1", "W2"] })`. */
export const protection = (id: string, props: ProtectionProps): ProtectionDef => ({
  id,
  ...props,
  protects: [...props.protects]
})

/** Define a label: `label("L1", { text: "MOTOR CTRL A", attachTo: "main", ... })`. */
export const label = (id: string, props: LabelProps): LabelDef => {
  const { attachTo, offsetFrom, ...rest } = props
  const base: Pick<LabelDef, "kind" | "id" | "attachTo"> = {
    kind: "label",
    id,
    attachTo: toRef(attachTo)
  }
  return offsetFrom !== undefined
    ? { ...base, offsetFrom: toRef(offsetFrom), ...rest }
    : { ...base, ...rest }
}

/** Define a harness — the root design object and default export of a `.harness.ts` file. */
export const harness = (id: string, props: HarnessProps): HarnessDesign => ({
  kind: "harness",
  id,
  revision: props.revision,
  units: props.units,
  metadata: props.metadata ?? {},
  connectors: props.connectors,
  wires: props.wires,
  branches: props.branches ?? [],
  labels: props.labels ?? [],
  splices: props.splices ?? [],
  cables: props.cables ?? [],
  protections: props.protections ?? []
})

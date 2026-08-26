/**
 * JSX components for harness authoring (tscircuit-inspired, experimental).
 * No React: these are plain functions invoked by the custom JSX runtime in
 * jsx-runtime.ts. The output is the SAME typed design objects the function
 * DSL produces — <Harness> compiles to byte-identical HIR (proven in
 * tests), so JSX is purely an authoring-style choice.
 *
 *   /** @jsxImportSource @grayhaven/nerve-react *\/
 *   export default (
 *     <Harness id="h" revision="A" units="mm">
 *       <Connector ref="J1" part={part("microfit-2x8")} pins={{ 1: "VBAT" }} />
 *       <Wire id="W1" from="J1.1" to="M1.1" gauge="20AWG" color="red" length={420} />
 *     </Harness>
 *   )
 *
 * Endpoints are strings: "J1.3" (connector.pin) or a splice id ("S1").
 */
import {
  branch as branchFn,
  cable as cableFn,
  connector as connectorFn,
  harness as harnessFn,
  label as labelFn,
  splice as spliceFn,
  wire as wireFn,
  type BranchProps,
  type CableProps,
  type ConnectorPart,
  type ConnectorProps,
  type HarnessDesign,
  type LabelProps,
  type SpliceProps,
  type WireProps
} from "@grayhaven/nerve"

type Def = ReturnType<
  | typeof connectorFn
  | typeof wireFn
  | typeof branchFn
  | typeof labelFn
  | typeof spliceFn
  | typeof cableFn
>

export type Children = Def | ReadonlyArray<Children> | undefined | null | false

export const flatten = (children: Children): Array<Def> => {
  if (children === undefined || children === null || children === false) return []
  if (Array.isArray(children)) {
    // SAFETY: the only array member of Children is ReadonlyArray<Children>.
    return (children as ReadonlyArray<Children>).flatMap(flatten)
  }
  // SAFETY: every Children value that is not empty and not an array is a Def.
  return [children as Def]
}

/** "J1.3" -> pin ref; anything without a dot is a splice id. */
const endpoint = (s: string) => {
  const dot = s.lastIndexOf(".")
  if (dot === -1) return { kind: "splice-ref" as const, splice: s }
  return { kind: "pin-ref" as const, connector: s.slice(0, dot), pin: s.slice(dot + 1) }
}

export function Connector(props: { ref: string; part: ConnectorPart } & ConnectorProps) {
  const { ref, part, ...rest } = props
  return connectorFn(ref, part, rest)
}

export function Wire(props: { id: string; from: string; to: string } & WireProps) {
  const { id, from, to, ...rest } = props
  return wireFn(id, endpoint(from), endpoint(to), rest)
}

export function Splice(props: { id: string } & SpliceProps) {
  const { id, ...rest } = props
  return spliceFn(id, rest)
}

export function Cable(props: { id: string } & CableProps) {
  const { id, ...rest } = props
  return cableFn(id, rest)
}

export function Branch(props: { id: string } & Omit<BranchProps, "path"> & { path: ReadonlyArray<string> }) {
  const { id, ...rest } = props
  return branchFn(id, rest)
}

export function Label(props: { id: string } & LabelProps) {
  const { id, ...rest } = props
  return labelFn(id, rest)
}

export function Harness(props: {
  id: string
  revision: string
  units: "mm" | "in"
  children?: Children
}): HarnessDesign {
  const kids = flatten(props.children)
  const byKind = <K extends Def["kind"]>(kind: K) =>
    kids.filter((k): k is Extract<Def, { kind: K }> => k.kind === kind)
  return harnessFn(props.id, {
    revision: props.revision,
    units: props.units,
    connectors: byKind("connector"),
    wires: byKind("wire"),
    splices: byKind("splice"),
    cables: byKind("cable"),
    branches: byKind("branch"),
    labels: byKind("label")
  })
}

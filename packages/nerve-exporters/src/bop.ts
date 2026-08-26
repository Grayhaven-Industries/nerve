/**
 * Bill of Process — Manufacturing Operations IR (PRD §28).
 *
 * "BOM is not enough." The BOP is a first-class artifact derived from HIR:
 * an ordered operation sequence with workstations, tools, labor-time
 * estimates, and — critically — every step linking back to the HIR objects
 * it manufactures (PRD §28 acceptance). Deterministic: canonical HIR order
 * in, identical BOP out.
 *
 * Crimp heights, pull forces, and applicator data come from the terminal
 * record on the pin (`HirPin.terminalPart`, PRD §30) and from nowhere else;
 * the labor estimates here remain planning-grade.
 */
import { isPinEndpoint, refs, type Hir, type HirPin } from "@grayhaven/nerve"
import { generateTestPlan } from "./test-plan.js"
import { toCsv, type TableData } from "./csv.js"
import { draft } from "./draft.js"

/** The contact record as it reaches an exporter. Derived from `HirPin`
 * because the HIR package publishes the pin type, not the terminal type. */
export type TerminalRecord = NonNullable<HirPin["terminalPart"]>

/**
 * One press setup: every termination that shares a terminal MPN and a wire
 * gauge, and therefore shares a die and a crimp-height window.
 *
 * Grouping is by (terminal MPN, wire gauge) rather than per pin because that
 * pair is exactly what an operator changes at the press. A 65-wire harness
 * yields two or three setups instead of 65 unreadable identical steps, and
 * each step is a thing someone actually does: fit the die, set the press,
 * crimp this list of cavities, measure one.
 *
 * Records that disagree on the process spec under the same MPN and gauge
 * cannot share a setup, so they are grouped separately and surface as two
 * steps with the same header — a visible data conflict rather than a silently
 * dropped specification.
 */
export interface CrimpSetup {
  readonly terminalMpn: string
  /** Absent when the wire declares no gauge; never defaulted. */
  readonly gauge?: string
  readonly terminal: TerminalRecord
  /** Terminated cavities in this setup, e.g. `J1.1`. */
  readonly pins: ReadonlyArray<string>
  /** Stable HIR pin refs (PRD §19), one per entry in `pins`. */
  readonly pinRefs: ReadonlyArray<string>
  readonly connectors: ReadonlyArray<string>
}

/** Said of any value the terminal record does not carry. Never "0", never a
 * dash: an operator must be able to tell an absent spec from a met one. */
const UNSPECIFIED = "not specified in the terminal record"

/**
 * Terminated pins that carry a terminal record, grouped into press setups in
 * canonical order (terminal MPN, then gauge, then process spec).
 *
 * Pins with no record are not represented here at all — an absent record
 * yields no crimp process data rather than an invented one.
 */
export const crimpSetups = (hir: Hir): ReadonlyArray<CrimpSetup> => {
  interface Group {
    readonly key: string
    readonly terminalMpn: string
    readonly gauge?: string
    readonly terminal: TerminalRecord
    readonly pins: Array<string>
    readonly pinRefs: Array<string>
    readonly connectors: Array<string>
  }
  const groups = new Map<string, Group>()

  for (const c of hir.connectors) {
    for (const p of c.pins) {
      const terminal = p.terminalPart
      if (terminal === undefined) continue
      // Only a terminated pin gets crimped: a record on an unwired cavity
      // describes a part, not an operation.
      const wire = hir.wires.find((w) =>
        [w.from, w.to].some(
          (e) => isPinEndpoint(e) && e.connector === c.ref && e.pin === p.pin
        )
      )
      if (wire === undefined) continue
      const gauge = wire.gauge ?? wire.part?.gauge
      // The spec signature keeps two disagreeing records from collapsing into
      // one setup; the die and the window are what the press is set to.
      const signature = JSON.stringify([
        terminal.stripLength ?? null,
        terminal.crimpTool ?? null,
        terminal.dieId ?? null,
        terminal.crimpHeight?.min ?? null,
        terminal.crimpHeight?.max ?? null,
        terminal.pullForceN ?? null,
        terminal.provenance?.verification ?? null
      ])
      const key = JSON.stringify([terminal.mpn, gauge ?? null, signature])
      let group = groups.get(key)
      if (group === undefined) {
        const started = draft<Group>({
          key,
          terminalMpn: terminal.mpn,
          terminal,
          pins: [],
          pinRefs: [],
          connectors: []
        })
        if (gauge !== undefined) started.gauge = gauge
        group = started
      }
      group.pins.push(`${c.ref}.${p.pin}`)
      group.pinRefs.push(refs.pin(c.ref, p.pin))
      if (!group.connectors.includes(c.ref)) group.connectors.push(c.ref)
      groups.set(key, group)
    }
  }

  return [...groups.values()]
    .sort(
      (a, b) =>
        a.terminalMpn.localeCompare(b.terminalMpn) ||
        (a.gauge ?? "").localeCompare(b.gauge ?? "") ||
        a.key.localeCompare(b.key)
    )
    .map((g): CrimpSetup => {
      const head = draft<Pick<CrimpSetup, "terminalMpn" | "gauge">>({ terminalMpn: g.terminalMpn })
      if (g.gauge !== undefined) head.gauge = g.gauge
      return {
        ...head,
        terminal: g.terminal,
        pins: g.pins,
        pinRefs: g.pinRefs,
        connectors: g.connectors
      }
    })
}

/** How the setup is announced: what part, on what wire, at which cavities. */
export const crimpSetupHeadline = (setup: CrimpSetup): string => {
  const t = setup.terminal
  const maker = t.manufacturer !== undefined ? ` (${t.manufacturer})` : ""
  const gauge =
    setup.gauge !== undefined ? `on ${setup.gauge} wire` : "on wire of unspecified gauge"
  return `Crimp ${setup.pins.length} termination(s) with terminal ${t.mpn}${maker} ${gauge}: ${setup.pins.join(", ")}`
}

/**
 * The process spec, one sentence per operator-critical value, every one of
 * them printed whether or not the record carries it.
 *
 * Every number here is read straight off the terminal record. There is no
 * fallback table and no cited standard: published general pull-force floors
 * disagree with each other and terminal makers routinely specify above them,
 * so a number nobody supplied is reported as missing rather than guessed.
 * Omitting the line instead would leave the operator unable to tell an absent
 * spec from a check that was skipped.
 */
export const crimpSpecSentences = (
  terminal: TerminalRecord
): ReadonlyArray<string> => {
  const lines: Array<string> = [
    terminal.stripLength !== undefined
      ? `Strip length ${terminal.stripLength} mm.`
      : `Strip length ${UNSPECIFIED}.`,
    terminal.crimpTool !== undefined
      ? `Crimp tool ${terminal.crimpTool}.`
      : `Crimp tool ${UNSPECIFIED}.`,
    terminal.dieId !== undefined ? `Die ${terminal.dieId}.` : `Die ${UNSPECIFIED}.`,
    terminal.crimpHeight !== undefined
      ? `Crimp height ${terminal.crimpHeight.min} to ${terminal.crimpHeight.max} mm, measured with a micrometer across the crimp barrel.`
      : `Crimp height ${UNSPECIFIED}; no window to measure against.`,
    terminal.pullForceN !== undefined
      ? `Pull force minimum ${terminal.pullForceN} N, checked by tensile pull test.`
      : `Pull force ${UNSPECIFIED}; no minimum to test against.`
  ]
  const verification = terminal.provenance?.verification
  if (verification !== undefined && verification !== "verified") {
    lines.push(
      `Terminal data is ${verification} — confirm against the terminal datasheet before setting the press.`
    )
  }
  return lines
}

/** Tools the declared spec actually requires: the measuring instruments
 * appear only when there is a declared value to measure against. */
const crimpSetupTools = (terminal: TerminalRecord): ReadonlyArray<string> => [
  terminal.crimpTool !== undefined
    ? `crimp tool ${terminal.crimpTool}`
    : `crimp tool (${UNSPECIFIED})`,
  terminal.dieId !== undefined ? `die ${terminal.dieId}` : `die (${UNSPECIFIED})`,
  ...(terminal.crimpHeight !== undefined ? ["crimp-height micrometer"] : []),
  ...(terminal.pullForceN !== undefined ? ["pull tester"] : [])
]

export type Workstation = "wire-prep" | "assembly" | "finishing" | "qa"

export interface Operation {
  /** Sequence number (steps of 10, classic router style). */
  readonly seq: number
  readonly op:
    | "cut-strip"
    | "twist"
    | "crimp"
    | "populate"
    | "splice"
    | "sleeve"
    | "label"
    | "inspect"
    | "test"
  readonly workstation: Workstation
  readonly description: string
  /** Stable HIR refs this step manufactures (PRD §28: links to HIR objects). */
  readonly targets: ReadonlyArray<string>
  readonly tools: ReadonlyArray<string>
  readonly estimatedSeconds: number
}

export interface BillOfProcess {
  readonly harness: { readonly id: string; readonly revision: string }
  readonly operations: ReadonlyArray<Operation>
  readonly totalEstimatedSeconds: number
  readonly estimatedLaborMinutes: number
}

// Planning-grade time standards (seconds).
const T = {
  cutStripPerWire: 25,
  twistPerGroup: 40,
  crimpPerTermination: 30,
  populatePerCavity: 8,
  splice: 90,
  sleeveBase: 30,
  sleevePerMm: 0.05,
  labelEach: 20,
  inspectPerConnector: 15,
  testPerStep: 8
} as const

export const generateBop = (hir: Hir): BillOfProcess => {
  const operations: Array<Operation> = []
  let seq = 0
  const add = (op: Omit<Operation, "seq">): void => {
    seq += 10
    operations.push({ seq, ...op })
  }

  // --- Wire prep -------------------------------------------------------------
  for (const w of hir.wires) {
    const spec = [w.gauge, w.color].filter((s) => s !== undefined).join(" ")
    add({
      op: "cut-strip",
      workstation: "wire-prep",
      description: `Cut and strip ${w.id} (${spec || "wire"}${w.length !== undefined ? `, ${w.length} ${hir.harness.units}` : ""}).`,
      targets: [refs.wire(w.id)],
      tools: ["wire cutter", "wire stripper"],
      estimatedSeconds: T.cutStripPerWire
    })
  }

  const twistGroups = new Map<string, Array<string>>()
  for (const w of hir.wires) {
    if (w.twistGroup === undefined) continue
    const list = twistGroups.get(w.twistGroup) ?? []
    list.push(w.id)
    twistGroups.set(w.twistGroup, list)
  }
  for (const [group, wires] of [...twistGroups.entries()].sort()) {
    add({
      op: "twist",
      workstation: "wire-prep",
      description: `Twist ${wires.join(" + ")} (${group}).`,
      targets: wires.map(refs.wire),
      tools: ["twisting fixture"],
      estimatedSeconds: T.twistPerGroup
    })
  }

  // --- Terminations ------------------------------------------------------------
  // Press setups first: one operation per (terminal MPN, gauge), because that
  // is one trip to the press. Terminations whose pin carries no record fall
  // through to the per-connector step below, which knows only the count.
  const setups = crimpSetups(hir)
  const specified = new Set(setups.flatMap((s) => s.pinRefs))
  for (const setup of setups) {
    add({
      op: "crimp",
      workstation: "assembly",
      description: `${crimpSetupHeadline(setup)}. ${crimpSpecSentences(setup.terminal).join(" ")}`,
      targets: setup.pinRefs,
      tools: crimpSetupTools(setup.terminal),
      estimatedSeconds: setup.pins.length * T.crimpPerTermination
    })
  }

  const byRef = new Map(hir.connectors.map((c) => [c.ref, c]))
  for (const c of hir.connectors) {
    const terminations = hir.wires.flatMap((w) =>
      [w.from, w.to].filter((e) => isPinEndpoint(e) && e.connector === c.ref)
    )
    if (terminations.length === 0) continue
    const unspecified = terminations.filter(
      (e) => !isPinEndpoint(e) || !specified.has(refs.pin(e.connector, e.pin))
    )
    if (unspecified.length > 0) {
      add({
        op: "crimp",
        workstation: "assembly",
        description: `Crimp ${unspecified.length} termination(s) for ${c.ref} (${c.mpn}).`,
        targets: [refs.connector(c.ref)],
        tools: ["crimp tool" + (byRef.get(c.ref)?.family !== undefined ? ` (${byRef.get(c.ref)!.family})` : "")],
        estimatedSeconds: unspecified.length * T.crimpPerTermination
      })
    }
    add({
      op: "populate",
      workstation: "assembly",
      description: `Populate ${c.ref}: seat ${terminations.length} terminal(s), verify lock engagement.`,
      targets: [refs.connector(c.ref)],
      tools: ["insertion tool"],
      estimatedSeconds: terminations.length * T.populatePerCavity
    })
  }

  // --- Splices -------------------------------------------------------------------
  for (const s of hir.splices) {
    add({
      op: "splice",
      workstation: "assembly",
      description: `Splice ${s.id}: join ${s.wires.join(" + ")}${s.type !== undefined ? ` (${s.type}${s.part !== undefined ? `, ${s.part}` : ""})` : ""}.${s.notes !== undefined ? ` ${s.notes}` : ""}`,
      targets: [refs.splice(s.id), ...s.wires.map(refs.wire)],
      tools: s.type === "solder-sleeve" ? ["heat gun"] : ["splice crimp tool", "heat gun"],
      estimatedSeconds: T.splice
    })
  }

  // --- Finishing --------------------------------------------------------------------
  for (const b of hir.branches) {
    if (b.sleeve === undefined) continue
    add({
      op: "sleeve",
      workstation: "finishing",
      description: `Sleeve branch ${b.id} with ${b.sleeve}${b.nominalLength !== undefined ? ` (${b.nominalLength} ${hir.harness.units})` : ""}.`,
      targets: [refs.branch(b.id)],
      tools: ["sleeving tool", "heat gun"],
      estimatedSeconds: Math.round(T.sleeveBase + (b.nominalLength ?? 0) * T.sleevePerMm)
    })
  }
  for (const l of hir.labels) {
    add({
      op: "label",
      workstation: "finishing",
      description: `Print and apply ${l.id} "${l.text}" on ${l.attachTo}${l.offsetFrom !== undefined && l.distance !== undefined ? ` ${l.distance} ${hir.harness.units} from ${l.offsetFrom}` : ""}.`,
      targets: [refs.label(l.id)],
      tools: ["label printer"],
      estimatedSeconds: T.labelEach
    })
  }

  // --- QA --------------------------------------------------------------------------
  add({
    op: "inspect",
    workstation: "qa",
    description: `Visual inspection: ${hir.connectors.length} connector(s) against pinout tables, labels against schedule, sleeve coverage against board drawing.`,
    targets: hir.connectors.map((c) => refs.connector(c.ref)),
    tools: ["inspection checklist"],
    estimatedSeconds: hir.connectors.length * T.inspectPerConnector
  })
  const testCount = generateTestPlan(hir).tests.length
  add({
    op: "test",
    workstation: "qa",
    description: `Run continuity-test procedure: ${testCount} step(s); record results per test ID.`,
    targets: ["test-plan"],
    tools: ["continuity tester"],
    estimatedSeconds: testCount * T.testPerStep
  })

  const total = operations.reduce((sum, op) => sum + op.estimatedSeconds, 0)
  return {
    harness: { id: hir.harness.id, revision: hir.harness.revision },
    operations,
    totalEstimatedSeconds: total,
    estimatedLaborMinutes: Math.round((total / 60) * 10) / 10
  }
}

/** Bill of Process table (shared by CSV and PDF). */
export const bopTable = (bop: BillOfProcess): TableData => ({
  headers: ["Seq", "Operation", "Workstation", "Description", "Targets", "Tools", "Est. sec"],
  rows: bop.operations.map((op) => [
    op.seq,
    op.op,
    op.workstation,
    op.description,
    op.targets.join("; "),
    op.tools.join("; "),
    op.estimatedSeconds
  ])
})

export const bopCsv = (hir: Hir): string => {
  const bop = generateBop(hir)
  const table = bopTable(bop)
  return toCsv([
    table.headers,
    ...table.rows,
    ["", "", "", `TOTAL — estimated labor ${bop.estimatedLaborMinutes} min`, "", "", bop.totalEstimatedSeconds]
  ])
}

export const bopJson = (hir: Hir): string =>
  JSON.stringify(generateBop(hir), null, 2) + "\n"

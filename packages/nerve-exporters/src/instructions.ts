/**
 * Assembly instruction generation (PRD §20.4).
 *
 * Generated from HIR only, in build order: materials → cut → twist → crimp →
 * populate → branch assembly → labels → inspection → test.
 *
 * The crimp section is the one an operator reads standing at the press, so it
 * is grouped the way a press is set up — per (terminal MPN, wire gauge), see
 * `CrimpSetup` — and every number in it is read off the pin's terminal record.
 * A harness whose pins carry no terminal record prints exactly what it printed
 * before: no section, no fabricated defaults.
 */
import { isPinEndpoint, type Hir } from "@grayhaven/nerve"
import { crimpSetupHeadline, crimpSetups, crimpSpecSentences } from "./bop.js"

export const assemblyInstructions = (hir: Hir): string => {
  const lines: Array<string> = []
  const section = (title: string) => {
    lines.push("", title, "-".repeat(title.length))
  }
  let step = 0
  const add = (text: string) => {
    step += 1
    lines.push(`${String(step).padStart(2, " ")}. ${text}`)
  }

  lines.push(
    `ASSEMBLY INSTRUCTIONS — ${hir.harness.id} rev ${hir.harness.revision}`,
    `Units: ${hir.harness.units}. Generated from HIR ${hir.schemaVersion}; every step references design object IDs.`
  )

  section("Materials")
  for (const item of hir.bom) {
    add(`Gather ${item.quantity}x ${item.mpn}${item.description !== undefined ? ` (${item.description})` : ""} — used by ${item.usedBy.join(", ")}.`)
  }

  section("Cut wires")
  for (const w of hir.wires) {
    const spec = [w.gauge, w.color].filter((s) => s !== undefined).join(" ")
    const len =
      w.length !== undefined
        ? `${w.length} ${hir.harness.units}${w.lengthTolerance !== undefined ? ` ±${w.lengthTolerance}` : ""}`
        : "length per board"
    add(`Cut ${w.id}: ${spec || "wire"}, ${len}${w.signal !== undefined ? ` [${w.signal}]` : ""}.`)
  }

  const twistGroups = new Map<string, Array<string>>()
  for (const w of hir.wires) {
    if (w.twistGroup === undefined) continue
    const list = twistGroups.get(w.twistGroup) ?? []
    list.push(w.id)
    twistGroups.set(w.twistGroup, list)
  }
  if (twistGroups.size > 0) {
    section("Twist pairs")
    for (const [group, wires] of [...twistGroups.entries()].sort()) {
      add(`Twist ${wires.join(" + ")} together (${group}).`)
    }
  }

  if (hir.splices.length > 0) {
    section("Splices")
    for (const s of hir.splices) {
      const parts = [
        `Splice ${s.id}: join ${s.wires.join(" + ")}`,
        s.type !== undefined ? `(${s.type}${s.part !== undefined ? `, ${s.part}` : ""})` : undefined,
        s.branch !== undefined && s.location !== undefined
          ? `at ${s.location} ${hir.harness.units} along ${s.branch}`
          : undefined,
        s.notes
      ].filter((x): x is string => x !== undefined)
      add(parts.join(" ") + ".")
    }
  }

  const setups = crimpSetups(hir)
  if (setups.length > 0) {
    section("Crimp terminations")
    for (const setup of setups) {
      add(`${crimpSetupHeadline(setup)}.`)
      for (const sentence of crimpSpecSentences(setup.terminal)) {
        lines.push(`      ${sentence}`)
      }
    }
  }

  section("Populate connectors")
  for (const c of hir.connectors) {
    const wired = hir.wires.filter((w) =>
      [w.from, w.to].some((e) => isPinEndpoint(e) && e.connector === c.ref)
    )
    add(`Populate ${c.ref} (${c.mpn}${c.gender !== undefined ? `, ${c.gender}` : ""}):`)
    for (const w of wired) {
      const end = [w.from, w.to].find(
        (e) => isPinEndpoint(e) && e.connector === c.ref
      )
      if (end === undefined || !isPinEndpoint(end)) continue
      lines.push(`      cavity ${end.pin}: ${w.id}${w.signal !== undefined ? ` (${w.signal})` : ""}`)
    }
  }

  if (hir.branches.length > 0) {
    section("Branch assembly")
    for (const b of hir.branches) {
      const parts = [
        `Route branch ${b.id} (${b.path.join(" → ")})`,
        b.nominalLength !== undefined ? `${b.nominalLength} ${hir.harness.units} nominal` : undefined,
        b.sleeve !== undefined ? `sleeve with ${b.sleeve}` : undefined
      ].filter((s): s is string => s !== undefined)
      add(parts.join("; ") + ".")
    }
  }

  if (hir.labels.length > 0) {
    section("Apply labels")
    for (const l of hir.labels) {
      const placement =
        l.offsetFrom !== undefined && l.distance !== undefined
          ? ` ${l.distance} ${hir.harness.units} from ${l.offsetFrom}`
          : ""
      add(`Apply ${l.id} "${l.text}" on ${l.attachTo}${placement}.`)
    }
  }

  section("Inspection")
  add("Verify every cavity against the pinout table; check seating/lock engagement.")
  add("Verify wire colors and labels against the schedule.")
  add("Verify branch lengths and sleeve coverage against the board drawing.")

  section("Test")
  add("Run the continuity-test procedure (tests.csv / test-plan.json); record results per test ID.")

  return lines.join("\n") + "\n"
}

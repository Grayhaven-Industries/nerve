/**
 * Crimp process data in the operator-facing artifacts (PRD §28, §30).
 *
 * The thing under test is not formatting, it is honesty: every dimension an
 * operator reads at the press must come off the pin's terminal record, an
 * absent value must read as absent rather than as zero or as satisfied, and a
 * harness whose pins carry no record must print exactly what it printed before
 * this section existed.
 *
 * vitest 4.1.10 — the root runner resolved by bun.lock, which is what
 * `bun run test` executes; the package's own ^3.2.4 devDependency is not.
 * (`describe`/`it`/`expect` with `toBe`/`toContain`/`toEqual`, per the v4 docs.)
 */
import { describe, expect, it } from "vitest"
import {
  compileDesign,
  connector,
  harness,
  wire,
  type ConnectorPart,
  type Hir,
  type HirConnector,
  type HirPin
} from "@grayhaven/nerve"
import { assemblyInstructions } from "../src/instructions.js"
import {
  bopJson,
  crimpSetups,
  crimpSpecSentences,
  generateBop,
  type TerminalRecord
} from "../src/bop.js"

const four: ConnectorPart = { mpn: "CONN-4", pinCount: 4 }
const two: ConnectorPart = { mpn: "CONN-2", pinCount: 2 }

const j1 = connector("J1", four, { pins: { 1: "VBAT", 2: "VBAT_RTN", 3: "CAN_H", 4: "SPARE" } })
const m1 = connector("M1", two, { pins: { 1: "VBAT", 2: "VBAT_RTN" } })
const m2 = connector("M2", two, { pins: { 1: "CAN_H", 2: "SPARE" } })

const design = harness("crimp-process", {
  revision: "A",
  units: "mm",
  connectors: [j1, m1, m2],
  wires: [
    wire("W1", j1.pin(1), m1.pin(1), { gauge: "18AWG", color: "red", length: 300 }),
    wire("W2", j1.pin(2), m1.pin(2), { gauge: "18AWG", color: "black", length: 300 }),
    wire("W3", j1.pin(3), m2.pin(1), { gauge: "20AWG", color: "yellow", length: 420 }),
    wire("W4", j1.pin(4), m2.pin(2), { gauge: "22AWG", color: "blue", length: 260 })
  ]
})

/** No bundled example supplies a terminal record, so this is the shape of
 * every harness the packet has ever exported. */
const bare = compileDesign(design).hir

/** Distinctive values: no published table, secondary source or plausible
 * default carries this combination, so a number appearing in the output that
 * is not here did not come from the design. */
const FULL: TerminalRecord = {
  mpn: "GH-4471-3",
  manufacturer: "Grayhaven Contacts",
  crimpTool: "CT-9082",
  dieId: "D-7734",
  stripLength: 6.43,
  crimpHeight: { min: 1.263, max: 1.417 },
  pullForceN: 73.6,
  provenance: { verification: "verified" }
}

/** The common real case: a tool is known, the dimensional spec is not, and
 * the transcription has never been checked against the datasheet. */
const PARTIAL: TerminalRecord = {
  mpn: "GH-2210-9",
  crimpTool: "CT-9082",
  provenance: { verification: "unverified" }
}

const withTerminals = (
  hir: Hir,
  records: Readonly<Record<string, TerminalRecord>>
): Hir => ({
  ...hir,
  connectors: hir.connectors.map(
    (c): HirConnector => ({
      ...c,
      pins: c.pins.map((p): HirPin => {
        const { terminalPart: _dropped, ...rest } = p
        const record = records[`${c.ref}.${p.pin}`]
        return record !== undefined ? { ...rest, terminalPart: record } : rest
      })
    })
  )
})

/** J1.1, J1.2 and M1.1 share the part and 18AWG — one press setup across two
 * connectors. M2.2 is the same part on 22AWG, which is a different die and a
 * different window, so it must not join them. J1.3 is partially specified.
 * J1.4 and M2.1 carry no record at all. */
const populated = withTerminals(bare, {
  "J1.1": FULL,
  "J1.2": FULL,
  "M1.1": FULL,
  "M2.2": FULL,
  "J1.3": PARTIAL
})

const numbersIn = (s: string): ReadonlyArray<string> => s.match(/\d+(?:\.\d+)?/g) ?? []

/** The indented spec lines of the "Crimp terminations" section. */
const crimpSpecLines = (text: string): ReadonlyArray<string> => {
  const lines = text.split("\n")
  const start = lines.indexOf("Crimp terminations")
  const end = lines.indexOf("Populate connectors")
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return lines.slice(start, end).filter((l) => l.startsWith("      "))
}

describe("crimp process data (PRD §28, §30)", () => {
  it("prints nothing new when no pin carries a terminal record", () => {
    // Same HIR, records added then removed: byte identity is the assertion.
    const stripped = withTerminals(populated, {})
    expect(crimpSetups(bare)).toEqual([])
    expect(assemblyInstructions(bare)).toBe(assemblyInstructions(stripped))
    expect(bopJson(bare)).toBe(bopJson(stripped))
    expect(assemblyInstructions(bare)).not.toContain("Crimp terminations")
    expect(bopJson(bare)).not.toContain("terminal record")
    // The legacy per-connector crimp step is untouched.
    expect(
      generateBop(bare).operations.filter((o) => o.op === "crimp").map((o) => o.description)
    ).toEqual([
      "Crimp 4 termination(s) for J1 (CONN-4).",
      "Crimp 2 termination(s) for M1 (CONN-2).",
      "Crimp 2 termination(s) for M2 (CONN-2)."
    ])
  })

  it("surfaces strip length, tool, die, height window and pull force", () => {
    const text = assemblyInstructions(populated)
    expect(text).toContain(
      "Crimp 3 termination(s) with terminal GH-4471-3 (Grayhaven Contacts) on 18AWG wire: J1.1, J1.2, M1.1."
    )
    expect(text).toContain("Strip length 6.43 mm.")
    expect(text).toContain("Crimp tool CT-9082.")
    expect(text).toContain("Die D-7734.")
    expect(text).toContain(
      "Crimp height 1.263 to 1.417 mm, measured with a micrometer across the crimp barrel."
    )
    expect(text).toContain("Pull force minimum 73.6 N, checked by tensile pull test.")

    const bop = generateBop(populated)
    const setup = bop.operations.find((o) => o.description.includes("GH-4471-3 (Grayhaven Contacts) on 18AWG"))
    expect(setup?.op).toBe("crimp")
    expect(setup?.workstation).toBe("assembly")
    expect(setup?.targets).toEqual([
      "connector:J1.pin:1",
      "connector:J1.pin:2",
      "connector:M1.pin:1"
    ])
    expect(setup?.tools).toEqual([
      "crimp tool CT-9082",
      "die D-7734",
      "crimp-height micrometer",
      "pull tester"
    ])
  })

  it("makes a missing spec visibly unspecified, never zero and never omitted", () => {
    const text = assemblyInstructions(populated)
    expect(text).toContain("Crimp tool CT-9082.")
    expect(text).toContain("Strip length not specified in the terminal record.")
    expect(text).toContain("Die not specified in the terminal record.")
    expect(text).toContain(
      "Crimp height not specified in the terminal record; no window to measure against."
    )
    expect(text).toContain(
      "Pull force not specified in the terminal record; no minimum to test against."
    )
    // Absent must not read as a value.
    for (const line of crimpSpecLines(text)) {
      expect(line, line).not.toMatch(/\b0(\.0+)? (mm|N)\b/)
      expect(line, line).not.toMatch(/[:—-]\s*[-–—]\s*$/)
    }
    // Every one of the five operator-critical lines is printed for every
    // setup, specified or not: five setups' worth for three setups, plus one
    // provenance line.
    expect(crimpSpecLines(text)).toHaveLength(3 * 5 + 1)
    // The partial record's own tools list still declares what is missing.
    const partialOp = generateBop(populated).operations.find((o) =>
      o.description.includes("GH-2210-9")
    )
    expect(partialOp?.tools).toEqual([
      "crimp tool CT-9082",
      "die (not specified in the terminal record)"
    ])
  })

  it("emits no number that is not in the terminal record", () => {
    for (const record of [FULL, PARTIAL]) {
      const supplied = new Set(numbersIn(JSON.stringify(record)))
      for (const sentence of crimpSpecSentences(record)) {
        for (const n of numbersIn(sentence)) {
          expect(supplied.has(n), `${n} in "${sentence}"`).toBe(true)
        }
      }
    }
    // Same guarantee against the rendered artifact, not just the helper.
    const supplied = new Set([
      ...numbersIn(JSON.stringify(FULL)),
      ...numbersIn(JSON.stringify(PARTIAL))
    ])
    for (const line of crimpSpecLines(assemblyInstructions(populated))) {
      for (const n of numbersIn(line)) {
        expect(supplied.has(n), `${n} in "${line}"`).toBe(true)
      }
    }
    // No standard is cited and no general floor is implied: the published
    // pull-force values disagree across sources and terminal makers supersede
    // them, so the design record is the only authority.
    const artifacts = assemblyInstructions(populated) + bopJson(populated)
    for (const forbidden of [
      "IPC",
      "WHMA",
      "A-620",
      "class 2",
      "Class 2",
      "magnification",
      "illumination",
      "per standard",
      "conformance"
    ]) {
      expect(artifacts, forbidden).not.toContain(forbidden)
    }
  })

  it("groups by terminal MPN and gauge, the pair that sets the press", () => {
    const setups = crimpSetups(populated)
    expect(
      setups.map((s) => [s.terminalMpn, s.gauge, [...s.pins]])
    ).toEqual([
      ["GH-2210-9", "20AWG", ["J1.3"]],
      ["GH-4471-3", "18AWG", ["J1.1", "J1.2", "M1.1"]],
      ["GH-4471-3", "22AWG", ["M2.2"]]
    ])
    // Three pins sharing a setup produce one step, not three.
    const text = assemblyInstructions(populated)
    expect(text.split("Crimp 3 termination(s) with terminal GH-4471-3")).toHaveLength(2)
    // Terminations whose pin has no record still get crimped, and are not
    // double-counted against the setups above.
    const bop = generateBop(populated)
    const crimps = bop.operations.filter((o) => o.op === "crimp")
    expect(crimps.map((o) => o.description).filter((d) => d.startsWith("Crimp 1 termination(s) for"))).toEqual([
      "Crimp 1 termination(s) for J1 (CONN-4).",
      "Crimp 1 termination(s) for M1 (CONN-2).",
      "Crimp 1 termination(s) for M2 (CONN-2)."
    ])
    expect(crimps.reduce((n, o) => n + o.estimatedSeconds, 0)).toBe(
      generateBop(bare).operations
        .filter((o) => o.op === "crimp")
        .reduce((n, o) => n + o.estimatedSeconds, 0)
    )
  })

  it("shows unverified provenance where the press is set from it", () => {
    const text = assemblyInstructions(populated)
    expect(text).toContain(
      "Terminal data is unverified — confirm against the terminal datasheet before setting the press."
    )
    expect(bopJson(populated)).toContain("Terminal data is unverified")
    // A verified record makes no such claim on the operator's attention.
    expect(crimpSpecSentences(FULL).some((s) => s.includes("Terminal data is"))).toBe(false)
  })

  it("is deterministic: same HIR twice, byte-identical output", () => {
    const again = withTerminals(compileDesign(design).hir, {
      "J1.1": FULL,
      "J1.2": FULL,
      "M1.1": FULL,
      "M2.2": FULL,
      "J1.3": PARTIAL
    })
    expect(assemblyInstructions(again)).toBe(assemblyInstructions(populated))
    expect(bopJson(again)).toBe(bopJson(populated))
    expect(assemblyInstructions(populated)).toMatchSnapshot()
  })
})

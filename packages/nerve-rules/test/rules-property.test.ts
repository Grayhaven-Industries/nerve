/**
 * Property-based rule testing (fast-check): instead of hand-picking cases,
 * generate thousands of arbitrary harness designs and assert INVARIANTS —
 * things that must hold for every possible design. This is how you "fully
 * test" rules: hand-written cases pin known behaviors; properties guarantee
 * the engine never crashes, never emits malformed diagnostics, and obeys
 * metamorphic laws (e.g. adding a ground wire can only remove HK-ELEC-003).
 */
import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  compileDesign,
  connector,
  harness,
  runRules,
  wire,
  type ConnectorPart,
  type WireProps
} from "@grayhaven/nerve"
import { builtinRules, parseAwg, ruleCodeFromNumber, ruleCodeNumber } from "@grayhaven/nerve-rules"

// --- generators -------------------------------------------------------------

const signalArb = fc.oneof(
  fc.constantFrom("VBAT_24V", "5V", "GND", "AGND", "CAN_H", "CAN_L", "CAN1_H", "CAN1_L",
    "RS485_A", "RS485_B", "DATA0", "SHIELD", "V5", "EN_5V", "LVDS_P", "LVDS_N"),
  fc.stringMatching(/^[A-Z][A-Z0-9_]{0,11}$/)
)

const gaugeArb = fc.oneof(
  fc.constantFrom("30AWG", "28AWG", "26AWG", "24AWG", "22AWG", "20AWG", "18AWG", "16AWG"),
  fc.constant(undefined)
)

const partArb: fc.Arbitrary<ConnectorPart> = fc
  .tuple(
    fc.stringMatching(/^[A-Z]{2}-\d{2}$/),
    fc.integer({ min: 1, max: 8 }),
    fc.boolean()
  )
  .map(([mpn, pinCount, ranged]) =>
    ranged ? { mpn, pinCount, wireGaugeRange: { min: "30AWG", max: "18AWG" } } : { mpn, pinCount }
  )

/** `WireProps` with its readonly lifted, so a generated wire carries only the
 * properties the arbitrary drew. */
type WirePropsDraft = { -readonly [K in keyof WireProps]: WireProps[K] }

/** A random but structurally valid design: connectors with some assigned
 * pins, wires between existing pins. */
const designArb = fc
  .tuple(
    fc.array(fc.tuple(partArb, fc.array(signalArb, { maxLength: 4 })), { minLength: 1, maxLength: 4 }),
    fc.array(
      fc.record({
        fromConn: fc.nat(), fromPin: fc.nat(), toConn: fc.nat(), toPin: fc.nat(),
        gauge: gaugeArb,
        color: fc.option(fc.constantFrom("red", "black", "blue"), { nil: undefined }),
        length: fc.option(fc.integer({ min: 1, max: 5000 }), { nil: undefined }),
        signal: fc.option(signalArb, { nil: undefined }),
        twistGroup: fc.option(fc.constantFrom("T1", "T2"), { nil: undefined }),
        currentEstimate: fc.option(fc.float({ min: Math.fround(0.1), max: 50, noNaN: true }), { nil: undefined })
      }),
      { maxLength: 8 }
    ),
    fc.constantFrom("A", "B", "  ", "")
  )
  .map(([connSpecs, wireSpecs, revision]) => {
    const conns = connSpecs.map(([part, signals], i) => {
      const pins = Object.fromEntries(
        signals.slice(0, part.pinCount).map((s, pi) => [pi + 1, s])
      )
      return connector(`J${i + 1}`, part, { pins })
    })
    const wires = wireSpecs.map((w, i) => {
      const from = conns[w.fromConn % conns.length]!
      const to = conns[w.toConn % conns.length]!
      const fromPart = connSpecs[w.fromConn % conns.length]![0]
      const toPart = connSpecs[w.toConn % conns.length]![0]
      const props: WirePropsDraft = {}
      if (w.gauge !== undefined) props.gauge = w.gauge
      if (w.color !== undefined) props.color = w.color
      if (w.length !== undefined) props.length = w.length
      if (w.signal !== undefined) props.signal = w.signal
      if (w.twistGroup !== undefined) props.twistGroup = w.twistGroup
      if (w.currentEstimate !== undefined) props.currentEstimate = w.currentEstimate
      return wire(
        `W${i + 1}`,
        from.pin((w.fromPin % fromPart.pinCount) + 1),
        to.pin((w.toPin % toPart.pinCount) + 1),
        props
      )
    })
    return harness("prop-fixture", { revision, units: "mm", connectors: conns, wires })
  })

const RUNS = { numRuns: 250 }

// --- invariants ---------------------------------------------------------------

describe("rule engine invariants (property-based)", () => {
  it("never throws and always emits well-formed diagnostics", () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const { hir } = compileDesign(design)
        const diags = runRules(hir, builtinRules)
        for (const d of diags) {
          expect(d.code).toMatch(/^HK-(DOC|MFG|WIRE|ELEC|CONN)-\d{3}$/)
          expect(["error", "warning", "info"]).toContain(d.severity)
          expect(d.message.length).toBeGreaterThan(0)
          if (d.target !== undefined) {
            expect(d.target).toMatch(/^(connector|wire|branch|splice|label|bom):/)
          }
        }
      }),
      RUNS
    )
  })

  it("is deterministic: same design, same diagnostics", () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const { hir } = compileDesign(design)
        expect(runRules(hir, builtinRules)).toEqual(runRules(hir, builtinRules))
      }),
      RUNS
    )
  })

  it("'off' config removes exactly that rule's diagnostics and nothing else", () => {
    fc.assert(
      fc.property(designArb, fc.nat(), (design, pick) => {
        const { hir } = compileDesign(design)
        const all = runRules(hir, builtinRules)
        const target = builtinRules[pick % builtinRules.length]!
        const without = runRules(hir, builtinRules, { [target.name]: "off" })
        expect(without).toEqual(all.filter((d) => d.code !== target.code))
      }),
      RUNS
    )
  })

  it("every emitted code round-trips through the numeric mapping", () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const { hir } = compileDesign(design)
        for (const d of runRules(hir, builtinRules)) {
          const n = ruleCodeNumber(d.code)
          expect(n).toBeDefined()
          expect(ruleCodeFromNumber(n!)).toBe(d.code)
        }
      }),
      RUNS
    )
  })
})

describe("metamorphic laws", () => {
  it("adding a GND wire never INTRODUCES a missing-ground-return error", () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const before = runRules(compileDesign(design).hir, builtinRules)
          .filter((d) => d.code === "HK-ELEC-003").length
        const a = connector("JG1", { mpn: "GP-01", pinCount: 1 }, { pins: { 1: "GND" } })
        const b = connector("JG2", { mpn: "GP-02", pinCount: 1 }, { pins: { 1: "GND" } })
        const withGround = harness("prop-fixture", {
          revision: design.revision,
          units: "mm",
          connectors: [...design.connectors, a, b],
          wires: [
            ...design.wires,
            wire("WGND", a.pin(1), b.pin(1), { signal: "GND", gauge: "20AWG", color: "black", length: 100 })
          ]
        })
        const after = runRules(compileDesign(withGround).hir, builtinRules)
          .filter((d) => d.code === "HK-ELEC-003").length
        expect(after).toBeLessThanOrEqual(before)
        expect(after).toBe(0) // a ground wire satisfies the rule outright
      }),
      RUNS
    )
  })

  it("fully specifying every wire eliminates all MFG missing-field diagnostics", () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const filled = harness("prop-fixture", {
          revision: design.revision,
          units: "mm",
          connectors: design.connectors,
          wires: design.wires.map((w) => ({
            ...w,
            gauge: w.gauge ?? "24AWG",
            color: w.color ?? "red",
            length: w.length ?? 100
          }))
        })
        const codes = runRules(compileDesign(filled).hir, builtinRules).map((d) => d.code)
        for (const c of ["HK-MFG-001", "HK-MFG-002", "HK-MFG-003"]) {
          expect(codes).not.toContain(c)
        }
      }),
      RUNS
    )
  })

  it("parseAwg inverts rendering for every integer gauge 1..40", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (n) => {
        expect(parseAwg(`${n}AWG`)).toBe(n)
        expect(parseAwg(`${n} AWG`)).toBe(n)
        expect(parseAwg(`AWG${n}`)).toBe(n)
      })
    )
  })
})

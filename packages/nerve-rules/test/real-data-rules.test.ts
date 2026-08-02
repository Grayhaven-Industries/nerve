/**
 * The three rules that stopped judging a declaration and started judging
 * physics: HK-ELEC-010 (fuse coordination against conductors it can actually
 * reach), HK-WIRE-004 (ampacity derated by bundle conductor count), and
 * HK-MFG-005 (a computed routed curvature preferred to an asserted one).
 *
 * Each of the three used to compare two numbers a person typed. What is under
 * test here is therefore not only "does it fail correctly" but "does it fail
 * for a reason that exists in the world" — and, just as load-bearing, that the
 * wider reach did not buy its sensitivity with false positives.
 *
 * vitest 4.1.10 (`node_modules/vitest/package.json`; root devDependency
 * `^4.1.10`), API confirmed against the v4.1.6 docs via Context7.
 */
import { describe, expect, it } from "vitest"
import {
  branch,
  compileDesign,
  connector,
  harness,
  hasErrors,
  protection,
  runRules,
  runRulesWithMargins,
  splice,
  wire,
  type ConnectorPart,
  type Hir,
  type HarnessDesign
} from "@grayhaven/nerve"
import {
  AMPACITY_BY_AWG,
  breakoutTighterThanBendRadius,
  builtinRules,
  gaugeCurrentMismatch,
  overcurrentExceedsConductor
} from "@grayhaven/nerve-rules"
import { bundleDeratingFactor } from "../src/wire-data.js"
import motorController from "../../../examples/motor-controller/src/main.harness.js"
import sensorSplice from "../../../examples/sensor-splice/src/main.harness.js"
import robotPlatform from "../../../examples/robot-platform/src/main.harness.js"

const compile = (d: HarnessDesign): Hir => {
  const { hir, diagnostics } = compileDesign(d)
  // A fixture that does not compile cleanly would make every assertion below
  // a statement about the compiler instead of about the rule.
  expect(diagnostics.filter((x) => x.severity === "error")).toEqual([])
  return hir
}

const AMP_10 = AMPACITY_BY_AWG[10]!
const AMP_12 = AMPACITY_BY_AWG[12]!
const AMP_20 = AMPACITY_BY_AWG[20]!
const AMP_22 = AMPACITY_BY_AWG[22]!
const AMP_24 = AMPACITY_BY_AWG[24]!

const plug = (mpn: string, pinCount: number): ConnectorPart => ({ mpn, pinCount })

// Splices are inert definitions, so one pair serves every fixture below.
const s1 = splice("S1", { type: "crimp" })
const s2 = splice("S2", { type: "crimp" })

// --- HK-ELEC-010: fuse coordination over a traversed scope -------------------

describe("HK-ELEC-010 walks past the declared protects list", () => {
  it("reports the declared case exactly as it always did", () => {
    const a = connector("J1", plug("F-2", 2), { pins: { 1: "PWR" } })
    const b = connector("J2", plug("F-2B", 2), { pins: { 1: "PWR" } })
    const hir = compile(
      harness("declared-only", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [
          wire("W1", a.pin(1), b.pin(1), {
            gauge: "22AWG",
            color: "red",
            length: 10,
            signal: "VBAT_12V"
          })
        ],
        protections: [protection("F1", { kind: "fuse", ratingA: 5, protects: ["W1"] })]
      })
    )

    // Whole-object equality, not a substring: the no-regression claim covers
    // the message, the targets and every key of `data`, so the traversal
    // cannot have quietly added a field to a finding it did not change.
    expect(runRules(hir, [overcurrentExceedsConductor])).toEqual([
      {
        code: "HK-ELEC-010",
        severity: "error",
        message:
          `fuse F1 is rated 5A but its thinnest protected wire W1 carries only ${AMP_22}A. ` +
          `The wire fails before the device trips.`,
        target: "protection:F1",
        targets: ["wire:W1"],
        data: { ratingA: 5, conductorAmpacityA: AMP_22, governingWire: "W1" }
      }
    ])
  })

  it("catches a run that necks down three hops downstream and is listed nowhere", () => {
    const bat = connector("JBAT", plug("BAT-2", 2), { pins: { 1: "VBAT_12V" } })
    const load = connector("JLOAD", plug("LOAD-2", 2), { pins: { 1: "VBAT_12V" } })
    const hir = compile(
      harness("neck-down", {
        revision: "A",
        units: "mm",
        connectors: [bat, load],
        splices: [s1, s2],
        wires: [
          wire("W1", bat.pin(1), s1, { gauge: "10AWG", color: "red", length: 100 }),
          wire("W2", s1, s2, { gauge: "10AWG", color: "red", length: 100 }),
          // The neck-down. Nobody put it in `protects`.
          wire("W3", s2, load.pin(1), { gauge: "20AWG", color: "red", length: 100 })
        ],
        protections: [protection("F1", { kind: "fuse", ratingA: 30, protects: ["W1"] })]
      })
    )

    const diags = runRules(hir, [overcurrentExceedsConductor])
    expect(diags.map((d) => d.code)).toEqual(["HK-ELEC-010"])
    expect(diags[0]?.data).toEqual({
      ratingA: 30,
      conductorAmpacityA: AMP_20,
      governingWire: "W3",
      governingWireSource: "downstream"
    })
    // The message has to say the conductor was reached, not declared: they are
    // different claims and a reviewer audits them differently.
    expect(diags[0]?.message).toBe(
      `fuse F1 is rated 30A but wire W3 downstream of its protected run carries only ` +
        `${AMP_20}A. The wire fails before the device trips.`
    )
    // The declared 10AWG feed alone would have passed a 30A fuse.
    expect(AMP_10).toBeGreaterThan(30)
  })

  it("does not reach through a connector pin, in either direction", () => {
    const bat = connector("JBAT", plug("BAT-2", 2), { pins: { 1: "VBAT_12V" } })
    const load = connector("JLOAD", plug("LOAD-2", 2), { pins: { 1: "VBAT_12V", 2: "SENSE" } })
    const other = connector("JOTHER", plug("OTH-2", 2), { pins: { 1: "VBAT_12V", 2: "SENSE" } })
    const hir = compile(
      harness("scope-guard", {
        revision: "A",
        units: "mm",
        connectors: [bat, load, other],
        splices: [s1],
        wires: [
          wire("W1", bat.pin(1), s1, { gauge: "12AWG", color: "red", length: 100 }),
          wire("W2", s1, load.pin(1), { gauge: "12AWG", color: "red", length: 100 }),
          // Upstream of the fuse: shares the battery CONTACT with the fused
          // feed, so a union-find net walk reaches it. It is not protected.
          wire("W9", bat.pin(1), other.pin(1), { gauge: "24AWG", color: "red", length: 100 }),
          // Far side of the load: same net again, still not this fuse's job.
          wire("W10", load.pin(2), other.pin(2), { gauge: "24AWG", color: "white", length: 100 })
        ],
        protections: [protection("F1", { kind: "fuse", ratingA: 20, protects: ["W1"] })]
      })
    )

    // Both out-of-scope wires are on the same electrical net as the fused run.
    expect(hir.wires.every((w) => w.gauge !== undefined)).toBe(true)
    expect(runRules(hir, [overcurrentExceedsConductor])).toEqual([])

    // And the margin proves the scope, not just the verdict: the limit is the
    // 12AWG run, never the 24AWG wires a net walk would have swept in.
    const { margins } = runRulesWithMargins(hir, [overcurrentExceedsConductor])
    expect(margins.map((m) => ({ target: m.target, measured: m.measured, limit: m.limit }))).toEqual([
      { target: "protection:F1", measured: 20, limit: AMP_12 }
    ])
    expect(AMP_24).toBeLessThan(20)
  })

  it("stops at a splice shared with another device's declared run", () => {
    const bat = connector("JBAT", plug("BAT-2", 2), { pins: { 1: "VBAT_12V" } })
    const ja = connector("JA", plug("A-2", 2), { pins: { 1: "VBAT_12V" } })
    const jb = connector("JB", plug("B-2", 2), { pins: { 1: "VBAT_12V" } })
    const hir = compile(
      harness("two-devices", {
        revision: "A",
        units: "mm",
        connectors: [bat, ja, jb],
        splices: [s1],
        wires: [
          wire("WFEED", bat.pin(1), s1, { gauge: "10AWG", color: "red", length: 100 }),
          wire("W1", s1, ja.pin(1), { gauge: "12AWG", color: "red", length: 100 }),
          wire("W2", s1, jb.pin(1), { gauge: "24AWG", color: "red", length: 100 })
        ],
        protections: [
          protection("F1", { kind: "fuse", ratingA: 20, protects: ["W1"] }),
          protection("F2", { kind: "fuse", ratingA: 1, protects: ["W2"] })
        ]
      })
    )

    // S1 is a distribution point between two devices. Without the barrier F1
    // would inherit F2's 24AWG branch (1.4A) and fail at 20A.
    expect(runRules(hir, [overcurrentExceedsConductor])).toEqual([])
    expect(AMP_24).toBeLessThan(20)
  })
})

// --- HK-WIRE-004: conductor-count derating -----------------------------------

/**
 * `HirWire.branch` is the bundle association the derating counts, and nothing
 * in today's DSL populates it (see the report accompanying this change), so
 * the fixture writes it onto compiled HIR. HIR is the rules' input contract —
 * running against it is exactly what a rule does in production.
 */
const bundleOf = (conductorCount: number, underTest: { gauge: string; currentEstimate: number }): Hir => {
  const ids = Array.from({ length: conductorCount }, (_, i) => `W${String(i + 1).padStart(2, "0")}`)
  const a = connector("J1", plug("BUNDLE-A", conductorCount), {
    pins: Object.fromEntries(ids.map((_, i) => [i + 1, `NET_${i + 1}`]))
  })
  const b = connector("J2", plug("BUNDLE-B", conductorCount), {
    pins: Object.fromEntries(ids.map((_, i) => [i + 1, `NET_${i + 1}`]))
  })
  const hir = compile(
    harness("bundle", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      wires: ids.map((id, i) =>
        wire(id, a.pin(i + 1), b.pin(i + 1), {
          color: "red",
          length: 100,
          signal: `NET_${i + 1}`,
          ...(i === 0 ? underTest : { gauge: underTest.gauge })
        })
      ),
      branches: [branch("main", { path: [a, b], sleeve: "braided-pet-12" })]
    })
  )
  return { ...hir, wires: hir.wires.map((w) => ({ ...w, branch: "main" })) }
}

describe("HK-WIRE-004 derates ampacity by bundle conductor count", () => {
  const carried = { gauge: "20AWG", currentEstimate: 3 }

  it("passes the same wire in a pair and fails it in a 30-way trunk", () => {
    expect(runRules(bundleOf(2, carried), [gaugeCurrentMismatch])).toEqual([])

    // Only W01 declares a current, so only W01 can be judged — the other 29
    // conductors are counted as bundle members, never invented as loads.
    const diags = runRules(bundleOf(30, carried), [gaugeCurrentMismatch])
    expect(diags.map((d) => d.code)).toEqual(["HK-WIRE-004"])
    const first = diags.find((d) => d.target === "wire:W01")
    expect(first?.data).toMatchObject({
      gauge: "20AWG",
      currentEstimateA: 3,
      ampacityA: AMP_20 * 0.5,
      bundleConductors: 30,
      deratingFactor: 0.5
    })
    // The message names the derating, because "20AWG cannot carry 3A" is false
    // in isolation and only true of this conductor in this bundle.
    expect(first?.message).toBe(
      "Wire W01 uses 20AWG but its 3A estimate requires at least 16AWG. " +
        "Branch main bundles 30 conductors, so the limit derates 0.5×."
    )
  })

  it("holds the published factors at each threshold", () => {
    expect([1, 2, 3].map(bundleDeratingFactor)).toEqual([1, 1, 1])
    expect([4, 5, 6].map(bundleDeratingFactor)).toEqual([0.7, 0.7, 0.7])
    expect([7, 12, 24].map(bundleDeratingFactor)).toEqual([0.6, 0.6, 0.6])
    expect([25, 30, 100].map(bundleDeratingFactor)).toEqual([0.5, 0.5, 0.5])
  })

  it("measures against the derated limit, not the flat one", () => {
    const pair = runRulesWithMargins(bundleOf(2, carried), [gaugeCurrentMismatch]).margins
    const trunk = runRulesWithMargins(bundleOf(30, carried), [gaugeCurrentMismatch]).margins

    const of = (ms: typeof pair, target: string) => ms.find((m) => m.target === target)!
    expect(of(pair, "wire:W01")).toMatchObject({
      quantity: "conductor current",
      measured: 3,
      limit: AMP_20,
      unit: "A"
    })
    expect(of(trunk, "wire:W01")).toMatchObject({
      quantity: "conductor current",
      measured: 3,
      limit: AMP_20 * 0.5
    })
    // A passing design still reports how close it sits — and the two bundles
    // sit in different places despite identical copper.
    expect(of(pair, "wire:W01").utilization).toBeLessThan(1)
    expect(of(trunk, "wire:W01").utilization).toBeGreaterThan(1)

    // The finding and the margin agree about the limit, to the bit.
    const diag = runRules(bundleOf(30, carried), [gaugeCurrentMismatch]).find(
      (d) => d.target === "wire:W01"
    )
    expect(diag?.data?.ampacityA).toBe(of(trunk, "wire:W01").limit)
  })

  it("leaves an unbundled wire on the flat table", () => {
    const trunk = bundleOf(30, carried)
    const unassigned: Hir = { ...trunk, wires: trunk.wires.map(({ branch: _, ...w }) => w) }
    expect(runRules(unassigned, [gaugeCurrentMismatch])).toEqual([])
    expect(
      runRulesWithMargins(unassigned, [gaugeCurrentMismatch]).margins.find(
        (m) => m.target === "wire:W01"
      )?.limit
    ).toBe(AMP_20)
  })
})

// --- HK-MFG-005: computed vs asserted bend radius ----------------------------

/** Right-angle route: the circle through (0,0,0), (100,0,0), (100,100,0) has
 * radius |AC| / 2 = 70.71…, comfortably tighter than the asserted 10. */
const CORNER = [
  { x: 0, y: 0, z: 0 },
  { x: 100, y: 0, z: 0 },
  { x: 100, y: 100, z: 0 }
]
const STRAIGHT = [
  { x: 0, y: 0, z: 0 },
  { x: 100, y: 0, z: 0 },
  { x: 200, y: 0, z: 0 }
]

const routedBranch = (props: Parameters<typeof branch>[1]): Hir => {
  const a = connector("J1", plug("BEND-2", 2), { pins: { 1: "PWR" } })
  const b = connector("J2", plug("BEND-2B", 2), { pins: { 1: "PWR" } })
  return compile(
    harness("routed", {
      revision: "A",
      units: "mm",
      connectors: [a, b],
      wires: [wire("W1", a.pin(1), b.pin(1), { gauge: "20AWG", color: "red", length: 100 })],
      branches: [branch("main", { ...props, path: [a, b] })]
    })
  )
}

describe("HK-MFG-005 judges the routed radius when the compiler measured one", () => {
  it("uses the computed curvature and says so", () => {
    const hir = routedBranch({
      path: [],
      waypoints: CORNER,
      breakoutDistance: 40,
      // Asserted radius alone would clear the 40mm breakout. The route does not.
      minBendRadius: 10
    })
    const computed = hir.branches[0]?.routedMinBendRadius
    expect(computed).toBeCloseTo(70.71067811865476, 10)

    const { diagnostics, margins } = runRulesWithMargins(hir, [breakoutTighterThanBendRadius])
    expect(diagnostics.map((d) => d.code)).toEqual(["HK-MFG-005"])
    expect(diagnostics[0]?.message).toBe(
      "Branch main breaks out 40mm from its parent but its routed centerline bends to a " +
        "computed ~70.7mm radius."
    )
    expect(diagnostics[0]?.data).toEqual({
      breakoutDistanceMm: 40,
      minBendRadiusMm: computed!,
      radiusSource: "computed"
    })
    // Margin and finding are the same measurement, unrounded.
    expect(margins).toMatchObject([{ quantity: "bend radius", measured: computed!, limit: 40 }])
  })

  it("does not condemn a straight routed branch, whose radius is absent, not zero", () => {
    const hir = routedBranch({
      path: [],
      waypoints: STRAIGHT,
      breakoutDistance: 40,
      minBendRadius: 10
    })
    // A straight run has infinite curvature radius; the compiler omits it.
    expect(hir.branches[0]?.routedMinBendRadius).toBeUndefined()
    expect(hir.branches[0]?.waypoints).toHaveLength(3)

    const { diagnostics, margins } = runRulesWithMargins(hir, [breakoutTighterThanBendRadius])
    expect(diagnostics).toEqual([])
    // Falls back to the asserted radius, not to zero and not to nothing.
    expect(margins).toMatchObject([{ quantity: "bend radius", measured: 10, limit: 40 }])
  })

  it("behaves exactly as before on a branch with no waypoints", () => {
    const hir = routedBranch({ path: [], breakoutDistance: 20, minBendRadius: 25 })
    expect(hir.branches[0]?.routedMinBendRadius).toBeUndefined()

    expect(runRules(hir, [breakoutTighterThanBendRadius])).toEqual([
      {
        code: "HK-MFG-005",
        severity: "error",
        message:
          "Branch main breaks out 20mm from its parent but the bundle needs a 25mm bend radius.",
        target: "branch:main",
        data: { breakoutDistanceMm: 20, minBendRadiusMm: 25 }
      }
    ])

    const clear = routedBranch({ path: [], breakoutDistance: 40, minBendRadius: 25 })
    expect(runRules(clear, [breakoutTighterThanBendRadius])).toEqual([])
  })
})

// --- Determinism and the shipped examples ------------------------------------

describe("the widened rules stay deterministic", () => {
  it("produces byte-identical diagnostics and margins for the same HIR", () => {
    const rules = [overcurrentExceedsConductor, gaugeCurrentMismatch, breakoutTighterThanBendRadius]
    const build = (): Hir => {
      const bat = connector("JBAT", plug("BAT-2", 2), { pins: { 1: "VBAT_12V" } })
      const load = connector("JLOAD", plug("LOAD-2", 2), { pins: { 1: "VBAT_12V" } })
      const hir = compile(
        harness("determinism", {
          revision: "A",
          units: "mm",
          connectors: [bat, load],
          splices: [s1, s2],
          wires: [
            wire("W1", bat.pin(1), s1, { gauge: "10AWG", color: "red", length: 100, currentEstimate: 20 }),
            wire("W2", s1, s2, { gauge: "10AWG", color: "red", length: 100, currentEstimate: 20 }),
            wire("W3", s2, load.pin(1), { gauge: "20AWG", color: "red", length: 100, currentEstimate: 3 })
          ],
          branches: [branch("main", { path: [bat, load], breakoutDistance: 40, waypoints: CORNER })],
          protections: [protection("F1", { kind: "fuse", ratingA: 30, protects: ["W1"] })]
        })
      )
      return { ...hir, wires: hir.wires.map((w) => ({ ...w, branch: "main" })) }
    }

    const first = runRulesWithMargins(build(), rules)
    const second = runRulesWithMargins(build(), rules)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    // Not a vacuous comparison: this fixture exercises all three changes.
    expect(first.diagnostics.map((d) => d.code).sort()).toContain("HK-ELEC-010")
    expect(first.margins.length).toBeGreaterThan(0)
  })
})

describe("the shipped examples still validate", () => {
  for (const [name, design] of [
    ["motor-controller", motorController],
    ["sensor-splice", sensorSplice],
    ["robot-platform", robotPlatform]
  ] as const) {
    it(`${name} compiles and runs the built-in rules with zero errors`, () => {
      const { hir, diagnostics } = compileDesign(design)
      expect(diagnostics.filter((d) => d.severity === "error")).toEqual([])
      const found = runRules(hir, builtinRules)
      expect(found.filter((d) => d.severity === "error")).toEqual([])
      expect(hasErrors(found)).toBe(false)
    })
  }
})

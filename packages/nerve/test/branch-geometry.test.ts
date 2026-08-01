/**
 * Routed branch geometry: the compiler measuring a branch instead of
 * believing it.
 *
 * The distinctions these tests defend are absence-shaped, so they assert
 * absence rather than zero: an unrouted branch has no computed length (not a
 * length of 0), and a straight run has no minimum bend radius (its radius is
 * infinite, and a 0 there would invert the bend-radius rule).
 *
 * Pinned versions: vitest 4.1 (`not.toHaveProperty` for key absence),
 * effect 3.16 (`Schema.optional`, so an absent key decodes back absent).
 */
import { describe, expect, it } from "vitest"
import {
  Codes,
  branch,
  compileDesign,
  connector,
  decodeHir,
  harness,
  wire,
  type HirBranch,
  type Point3
} from "@grayhaven/nerve"
import robotPlatform from "../../../examples/robot-platform/src/main.harness.js"

const part = { mpn: "TEST-2", pinCount: 2 }

const p = (x: number, y: number, z: number): Point3 => ({ x, y, z })

/** One branch between two connectors, so each case differs only in geometry. */
const compileBranch = (props: {
  readonly waypoints?: ReadonlyArray<Point3>
  readonly nominalLength?: number
}) => {
  const j1 = connector("J1", part, { pins: { 1: "A", 2: "B" } })
  const j2 = connector("J2", part, { pins: { 1: "A", 2: "B" } })
  const { hir, diagnostics } = compileDesign(
    harness("routed", {
      revision: "A",
      units: "mm",
      connectors: [j1, j2],
      wires: [wire("W1", j1.pin(1), j2.pin(1))],
      branches: [branch("spine", { path: [j1, j2], ...props })]
    })
  )
  return { branch: hir.branches[0] as HirBranch, hir, diagnostics }
}

describe("branch geometry", () => {
  it("computes nothing for a branch that declares no waypoints", () => {
    const { branch: spine, diagnostics } = compileBranch({ nominalLength: 900 })

    expect(spine).not.toHaveProperty("waypoints")
    expect(spine).not.toHaveProperty("routedLength")
    expect(spine).not.toHaveProperty("routedMinBendRadius")
    expect(diagnostics).toEqual([])
  })

  it("measures the routed polyline instead of trusting a typed length", () => {
    // 300 east, 400 north, 120 up — hand-summed to 820.
    const { branch: spine } = compileBranch({
      waypoints: [p(0, 0, 0), p(300, 0, 0), p(300, 400, 0), p(300, 400, 120)]
    })

    expect(spine.routedLength).toBe(820)
    expect(spine.waypoints).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 300, y: 0, z: 0 },
      { x: 300, y: 400, z: 0 },
      { x: 300, y: 400, z: 120 }
    ])
  })

  it("reports the tightest bend of a right-angle route", () => {
    // A right angle's circumradius is half its hypotenuse: legs 100 and 100
    // give 100√2 / 2 = 70.7107.
    const { branch: spine } = compileBranch({
      waypoints: [p(0, 0, 0), p(100, 0, 0), p(100, 100, 0)]
    })

    expect(spine.routedMinBendRadius).toBeCloseTo(70.710678, 6)
  })

  it("reports no bend radius for a straight run", () => {
    const { branch: spine } = compileBranch({
      waypoints: [p(0, 0, 0), p(100, 0, 0), p(200, 0, 0)]
    })

    expect(spine.routedLength).toBe(200)
    // Infinite radius, not zero: a straight branch violates no bend limit.
    expect(spine).not.toHaveProperty("routedMinBendRadius")
  })

  it.each([
    ["empty", [] as ReadonlyArray<Point3>],
    ["single-point", [p(0, 0, 0)]]
  ])("rejects a %s waypoint array rather than measuring it", (_label, waypoints) => {
    const { branch: spine, diagnostics } = compileBranch({ waypoints })

    // Not a route: nothing computed, nothing carried, and never a length of 0.
    expect(spine).not.toHaveProperty("waypoints")
    expect(spine).not.toHaveProperty("routedLength")
    expect(spine).not.toHaveProperty("routedMinBendRadius")
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: Codes.InvalidBranchGeometry,
        target: "branch:spine",
        data: expect.objectContaining({ field: "waypoints" })
      })
    )
  })

  it("stays quiet when the declared length agrees with the geometry", () => {
    const { branch: spine, diagnostics } = compileBranch({
      nominalLength: 705, // 0.7% over the measured 700 — inside rounding.
      waypoints: [p(0, 0, 0), p(300, 0, 0), p(300, 400, 0)]
    })

    expect(spine.routedLength).toBe(700)
    expect(diagnostics).toEqual([])
  })

  it("reports a declared length that contradicts the geometry", () => {
    const { diagnostics } = compileBranch({
      nominalLength: 900,
      waypoints: [p(0, 0, 0), p(300, 0, 0), p(300, 400, 0)]
    })

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: Codes.BranchLengthMismatch,
        target: "branch:spine",
        data: expect.objectContaining({ nominalLength: 900, routedLength: 700 })
      })
    )
  })

  it("round-trips waypoints and computed geometry through the HIR schema", () => {
    const { hir } = compileBranch({
      waypoints: [p(0, 0, 0), p(100, 0, 0), p(100, 100, 0)]
    })

    const decoded = decodeHir(JSON.parse(JSON.stringify(hir)) as unknown)
    expect(decoded.branches[0]).toEqual(hir.branches[0])
  })

  it("compiles a routed design to byte-identical HIR twice", () => {
    const waypoints = [p(0, 0, 0), p(300, 0, 0), p(300, 400, 0), p(300, 400, 120)]
    const first = compileBranch({ waypoints, nominalLength: 820 })
    const second = compileBranch({ waypoints, nominalLength: 820 })

    expect(JSON.stringify(first.hir)).toBe(JSON.stringify(second.hir))
  })

  it("leaves an unrouted example untouched", () => {
    // No example declares waypoints, so geometry must be entirely inert here:
    // same bytes as before the feature existed, and no new diagnostics.
    const { hir, diagnostics } = compileDesign(robotPlatform)

    for (const b of hir.branches) {
      expect(b).not.toHaveProperty("waypoints")
      expect(b).not.toHaveProperty("routedLength")
      expect(b).not.toHaveProperty("routedMinBendRadius")
    }
    expect(diagnostics).toEqual([])
    expect(JSON.stringify(hir)).toBe(JSON.stringify(compileDesign(robotPlatform).hir))
  })
})

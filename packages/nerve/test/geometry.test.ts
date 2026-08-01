// vitest 4.1.10 (root devDependency ^4.1.10, the version that runs `bun run
// test`; packages/nerve pins ^3.2.4 for its own tooling). expect().toBe,
// .toEqual, .toBeCloseTo, .toBeUndefined and it.each confirmed against the
// vitest v4.1.6 expect docs.
import { describe, expect, it } from "vitest"
// Imported from source rather than the package barrel: the barrel is owned by
// the integration that wires geometry into the domain model, and this kernel
// must stay independent of it.
import {
  bendRadiusAt,
  cumulativeLengths,
  distance,
  lengthBetween,
  minBendRadius,
  pointAtDistance,
  polylineLength,
  segmentLengths,
  type Point3
} from "../src/geometry.js"

const p = (x: number, y: number, z: number): Point3 => ({ x, y, z })

/**
 * A branch routed the way a real one is: out along the chassis, up over a
 * bulkhead, back along the rail, then a diagonal drop to a breakout. Every
 * segment is a Pythagorean triple so the totals are hand-checkable and land on
 * exact doubles.
 *
 *   0 → 1   (120, 0, 0)            120
 *   1 → 2   (0, 90, 0)              90
 *   2 → 3   (0, 0, 200)            200
 *   3 → 4   (300, 0, 0)            300
 *   4 → 5   (60, 80, 0)            100   (3-4-5 × 20)
 *                                  ---
 *                                  810
 */
const branch: ReadonlyArray<Point3> = [
  p(0, 0, 0),
  p(120, 0, 0),
  p(120, 90, 0),
  p(120, 90, 200),
  p(420, 90, 200),
  p(480, 170, 200)
]

describe("distance", () => {
  it("3-4-5 triangle", () => {
    expect(distance(p(0, 0, 0), p(3, 4, 0))).toBe(5)
  })

  it("unit cube diagonal is sqrt(3)", () => {
    expect(distance(p(0, 0, 0), p(1, 1, 1))).toBe(Math.sqrt(3))
  })

  it("is symmetric and zero on a coincident pair", () => {
    expect(distance(p(7, -3, 11), p(-2, 5, 4))).toBe(distance(p(-2, 5, 4), p(7, -3, 11)))
    expect(distance(p(7, -3, 11), p(7, -3, 11))).toBe(0)
  })
})

describe("segmentLengths", () => {
  it("returns one length per consecutive pair", () => {
    expect(segmentLengths(branch)).toEqual([120, 90, 200, 300, 100])
  })

  it.each([
    ["empty", []],
    ["single point", [p(4, 4, 4)]]
  ])("%s yields []", (_label, points) => {
    expect(segmentLengths(points)).toEqual([])
  })
})

describe("polylineLength", () => {
  it("a closed square path totals its perimeter", () => {
    const square = [p(0, 0, 0), p(10, 0, 0), p(10, 10, 0), p(0, 10, 0), p(0, 0, 0)]
    expect(polylineLength(square)).toBe(40)
  })

  it.each([
    ["empty", []],
    ["single point", [p(1, 2, 3)]]
  ])("%s is 0", (_label, points) => {
    expect(polylineLength(points)).toBe(0)
  })

  it("a harness-scale branch matches the hand-computed total", () => {
    // 120 + 90 + 200 + 300 + 100
    expect(polylineLength(branch)).toBe(810)
  })
})

describe("cumulativeLengths", () => {
  it("is prefix sums, one per waypoint, starting at 0", () => {
    expect(cumulativeLengths(branch)).toEqual([0, 120, 210, 410, 710, 810])
  })

  it("empty yields []", () => {
    expect(cumulativeLengths([])).toEqual([])
  })
})

describe("lengthBetween", () => {
  it("sums exactly the intervening segments", () => {
    // waypoints 1→3 crosses the 90 and the 200
    expect(lengthBetween(branch, 1, 3)).toBe(290)
    expect(lengthBetween(branch, 0, 5)).toBe(polylineLength(branch))
  })

  it("is order-independent to the bit, not merely approximately", () => {
    for (const [from, to] of [
      [1, 3],
      [0, 4],
      [2, 5]
    ] as const) {
      expect(lengthBetween(branch, to, from)).toBe(lengthBetween(branch, from, to))
    }
  })

  it("equal indices give 0", () => {
    expect(lengthBetween(branch, 2, 2)).toBe(0)
    expect(lengthBetween(branch, 0, 0)).toBe(0)
  })

  it("degenerate polylines give 0", () => {
    expect(lengthBetween([], 0, 1)).toBe(0)
    expect(lengthBetween([p(1, 1, 1)], 0, 0)).toBe(0)
  })

  it("out-of-range and non-finite indices clamp instead of producing NaN", () => {
    expect(lengthBetween(branch, -99, 999)).toBe(810)
    expect(lengthBetween(branch, Number.NaN, 3)).toBe(410)
  })
})

describe("bendRadiusAt", () => {
  it("recovers the radius of a known circle", () => {
    // Right-angle isoceles: legs sqrt(2), hypotenuse 2, so the circumradius is
    // half the hypotenuse — exactly 1.
    expect(bendRadiusAt(p(0, 0, 0), p(1, 1, 0), p(2, 0, 0))).toBeCloseTo(1, 12)
    // Three points on the unit circle.
    expect(bendRadiusAt(p(1, 0, 0), p(0, 1, 0), p(-1, 0, 0))).toBeCloseTo(1, 12)
    // 30-40-50 right triangle: circumradius is half the hypotenuse, 25.
    expect(bendRadiusAt(p(0, 0, 0), p(30, 0, 0), p(30, 40, 0))).toBe(25)
    // Harness-scale arc: a 250 mm bend radius.
    expect(bendRadiusAt(p(250, 0, 0), p(0, 250, 0), p(-250, 0, 0))).toBeCloseTo(250, 10)
  })

  it("works off-axis, in a tilted plane", () => {
    // The 30-40-50 triangle rotated into the x=y=z diagonal plane keeps R = 25.
    expect(bendRadiusAt(p(0, 0, 0), p(0, 30, 0), p(0, 30, 40))).toBe(25)
    expect(bendRadiusAt(p(5, 5, 5), p(5, 35, 5), p(5, 35, 45))).toBe(25)
  })

  it.each([
    ["axis-aligned", p(0, 0, 0), p(10, 0, 0), p(30, 0, 0)],
    ["along a diagonal", p(0, 0, 0), p(100, 100, 100), p(300, 300, 300)],
    ["at inexact coordinates", p(1.1, 2.2, 3.3), p(11.1, 22.2, 33.3), p(111.1, 222.2, 333.3)],
    ["with the middle point outside the span", p(0, 0, 0), p(300, 0, 0), p(100, 0, 0)]
  ])("collinear %s returns undefined, NOT 0", (_label, a, b, c) => {
    const radius = bendRadiusAt(a, b, c)
    // A straight run has infinite radius. Reporting 0 would invert the
    // bend-radius rule and fail every straight branch, so assert the
    // distinction explicitly rather than just checking falsiness.
    expect(radius).toBeUndefined()
    expect(radius).not.toBe(0)
  })

  it.each([
    ["a and b", p(5, 5, 5), p(5, 5, 5), p(10, 0, 0)],
    ["b and c", p(1, 2, 3), p(9, 9, 9), p(9, 9, 9)],
    ["a and c", p(5, 5, 5), p(10, 0, 0), p(5, 5, 5)],
    ["all three", p(2, 2, 2), p(2, 2, 2), p(2, 2, 2)]
  ])("coincident %s returns undefined rather than NaN", (_label, a, b, c) => {
    const radius = bendRadiusAt(a, b, c)
    expect(radius).toBeUndefined()
    expect(radius).not.toBeNaN()
  })

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY]
  ])("a %s coordinate returns undefined, never a poisoned number", (_label, bad) => {
    expect(bendRadiusAt(p(bad, 0, 0), p(1, 1, 0), p(2, 0, 0))).toBeUndefined()
    expect(bendRadiusAt(p(0, 0, 0), p(1, bad, 0), p(2, 0, 0))).toBeUndefined()
    expect(bendRadiusAt(p(0, 0, 0), p(1, 1, 0), p(2, 0, bad))).toBeUndefined()
  })

  it("a very slight kink gives a large finite radius, not NaN", () => {
    // 1 micron of sag across a 2000 mm span — far shallower than anything a
    // formboard would show, but still a real bend, not a straight run.
    const radius = bendRadiusAt(p(0, 0, 0), p(1000, 0.001, 0), p(2000, 0, 0))
    expect(radius).toBeDefined()
    expect(Number.isFinite(radius!)).toBe(true)
    // Circle through a chord of 2L with sagitta h: R = (L² + h²) / 2h.
    const expected = (1000 * 1000 + 0.001 * 0.001) / (2 * 0.001)
    // Tight relative bound: this is the case the naive abc/4K-via-Heron
    // formulation gets wrong by ~5e-6, and the reason the cross-product
    // formulation was chosen. The current implementation is exact here.
    expect(Math.abs(radius! - expected) / expected).toBeLessThan(1e-12)
    expect(radius!).toBeGreaterThan(1e8)
  })

  it("stays accurate on a needle-thin bend two decades shallower still", () => {
    // sagitta 1e-5 mm over a 2000 mm chord.
    const radius = bendRadiusAt(p(0, 0, 0), p(1000, 1e-5, 0), p(2000, 0, 0))!
    const expected = (1000 * 1000 + 1e-10) / (2 * 1e-5)
    expect(Number.isFinite(radius)).toBe(true)
    expect(Math.abs(radius - expected) / expected).toBeLessThan(1e-9)
  })

  it("is symmetric under reversing the three points", () => {
    const a = p(12.5, -3.25, 400)
    const b = p(130, 44, 400)
    const c = p(260, -8.5, 375)
    expect(bendRadiusAt(c, b, a)).toBe(bendRadiusAt(a, b, c))
  })
})

describe("minBendRadius", () => {
  it("picks the tightest bend of several", () => {
    // Two right-angle bends, so each circumradius is half its hypotenuse:
    // at waypoint 1 the legs are 30 and 40 → R = 25; at waypoint 2 the legs
    // are 40 and 300 → R = sqrt(91600)/2 ≈ 151.3. The 25 must win.
    const run = [p(0, 0, 0), p(30, 0, 0), p(30, 40, 0), p(30, 40, 300)]
    expect(bendRadiusAt(run[0]!, run[1]!, run[2]!)).toBe(25)
    expect(bendRadiusAt(run[1]!, run[2]!, run[3]!)).toBeCloseTo(Math.sqrt(91600) / 2, 10)
    expect(minBendRadius(run)).toBe(25)
  })

  it("finds the tightest bend on the harness-scale branch", () => {
    const radii = [1, 2, 3, 4].map((i) => bendRadiusAt(branch[i - 1]!, branch[i]!, branch[i + 1]!)!)
    // Hand-checked: the first bend is a 120/90 right angle, hypotenuse 150,
    // so R = 75 — the tightest of the four.
    expect(radii[0]).toBe(75)
    expect(minBendRadius(branch)).toBe(75)
    expect(minBendRadius(branch)).toBe(Math.min(...radii))
  })

  it("a straight run is undefined, not 0", () => {
    const straight = [p(0, 0, 0), p(1, 0, 0), p(2, 0, 0), p(3, 0, 0)]
    const radius = minBendRadius(straight)
    expect(radius).toBeUndefined()
    expect(radius).not.toBe(0)
  })

  it("ignores the collinear vertices and reports the one real bend", () => {
    // A straight run with a single genuine right-angle corner in the middle.
    const mixed = [p(0, 0, 0), p(30, 0, 0), p(60, 0, 0), p(60, 80, 0), p(60, 160, 0)]
    // Vertices 1 and 3 are mid-line and contribute nothing…
    expect(bendRadiusAt(mixed[0]!, mixed[1]!, mixed[2]!)).toBeUndefined()
    expect(bendRadiusAt(mixed[2]!, mixed[3]!, mixed[4]!)).toBeUndefined()
    // …leaving the corner at vertex 2, whose legs are 30 and 80 (its immediate
    // neighbours, not the ends of the straight sections): R = sqrt(7300)/2.
    expect(minBendRadius(mixed)).toBe(Math.sqrt(7300) / 2)
  })

  it.each([
    ["empty", []],
    ["single point", [p(1, 1, 1)]],
    ["two points (no interior vertex)", [p(0, 0, 0), p(1, 0, 0)]]
  ])("%s has no interior vertex and is undefined", (_label, points) => {
    expect(minBendRadius(points)).toBeUndefined()
  })
})

describe("pointAtDistance", () => {
  it("interpolates within a segment", () => {
    // 150 along: 120 gets to waypoint 1, then 30 more up the 90 mm leg.
    expect(pointAtDistance(branch, 150)).toEqual(p(120, 30, 0))
  })

  it("lands exactly on a waypoint at its cumulative distance", () => {
    expect(pointAtDistance(branch, 120)).toEqual(p(120, 0, 0))
    expect(pointAtDistance(branch, 410)).toEqual(p(120, 90, 200))
  })

  it("clamps to the ends rather than extrapolating", () => {
    expect(pointAtDistance(branch, 0)).toEqual(p(0, 0, 0))
    expect(pointAtDistance(branch, -5)).toEqual(p(0, 0, 0))
    expect(pointAtDistance(branch, 810)).toEqual(p(480, 170, 200))
    expect(pointAtDistance(branch, 99_999)).toEqual(p(480, 170, 200))
    expect(pointAtDistance(branch, Number.POSITIVE_INFINITY)).toEqual(p(480, 170, 200))
    expect(pointAtDistance(branch, Number.NaN)).toEqual(p(0, 0, 0))
  })

  it("never returns a NaN coordinate", () => {
    for (const d of [-1, 0, 1, 150, 810, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      const at = pointAtDistance(branch, d)!
      expect([at.x, at.y, at.z].every(Number.isFinite)).toBe(true)
    }
  })

  it("is undefined only for an empty polyline", () => {
    expect(pointAtDistance([], 5)).toBeUndefined()
    expect(pointAtDistance([p(4, 4, 4)], 5)).toEqual(p(4, 4, 4))
  })
})

describe("determinism", () => {
  it("repeated calls on the same input are byte-identical", () => {
    for (let i = 0; i < 3; i++) {
      expect(polylineLength(branch)).toBe(polylineLength(branch))
      expect(segmentLengths(branch)).toEqual(segmentLengths(branch))
      expect(cumulativeLengths(branch)).toEqual(cumulativeLengths(branch))
      expect(lengthBetween(branch, 1, 4)).toBe(lengthBetween(branch, 1, 4))
      expect(minBendRadius(branch)).toBe(minBendRadius(branch))
      expect(pointAtDistance(branch, 333)).toEqual(pointAtDistance(branch, 333))
    }
  })

  it("results are exact doubles, reproducible through a JSON round-trip", () => {
    const snapshot = JSON.stringify({
      total: polylineLength(branch),
      segments: segmentLengths(branch),
      cumulative: cumulativeLengths(branch),
      minRadius: minBendRadius(branch),
      at333: pointAtDistance(branch, 333)
    })
    expect(
      JSON.stringify({
        total: polylineLength(branch),
        segments: segmentLengths(branch),
        cumulative: cumulativeLengths(branch),
        minRadius: minBendRadius(branch),
        at333: pointAtDistance(branch, 333)
      })
    ).toBe(snapshot)
  })

  it("does not depend on the order the polyline is walked", () => {
    const reversed = [...branch].reverse()
    expect(polylineLength(reversed)).toBe(polylineLength(branch))
    expect(minBendRadius(reversed)).toBe(minBendRadius(branch))
  })
})

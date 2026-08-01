/**
 * 3D polyline geometry: the kernel that lets a wire's length fall out of the
 * routing instead of being asserted by hand.
 *
 * Today lengths are numbers a human typed (`wire("W1", a, b, { length: 420 })`)
 * and nothing in the compiler can disagree with them. Cut lists are where a
 * wrong number gets expensive — 20 mm off across a 200-unit run is 200 scrapped
 * wires — so the one fact most likely to be wrong is the one fact the single
 * source of truth does not derive. Authoring waypoints on a branch and
 * measuring the graph closes that gap.
 *
 * Deliberately dependency-free and unit-agnostic: callers author in mm or in,
 * and nothing here assumes which. It imports nothing from the rest of the
 * package, so the domain model, the exporters and the bend-radius rule can all
 * adopt it without a cycle.
 */

/** A waypoint in harness space. Units are the harness's, never assumed here. */
export interface Point3 {
  readonly x: number
  readonly y: number
  readonly z: number
}

/**
 * Collinearity threshold, measured as sin of the turn angle at a vertex.
 *
 * Dimensionless on purpose: the kernel has no unit, and an absolute tolerance
 * would mean one thing on a 10 mm jumper and another on a 3000 mm trunk.
 *
 * 1e-12 sits four orders of magnitude above the ~1e-16 floor where the cross
 * product stops resolving the angle at all, so coordinate rounding can never
 * fabricate a bend out of a straight run, and no kink an author could intend is
 * ever suppressed. It is also far past the point of physical meaning in the
 * other direction: by the law of sines a turn this shallow across a 100 mm span
 * has a radius near 5e13 mm, and on a 1000 mm span the transverse deviation it
 * represents is about a nanometre.
 */
const COLLINEAR_EPSILON = 1e-12

/**
 * Euclidean distance.
 *
 * sqrt of the sum of squares rather than `Math.hypot`: IEEE-754 requires sqrt
 * to be correctly rounded, so this is byte-identical on every engine, whereas
 * hypot's precision is implementation-defined and the repo asserts determinism
 * at every layer. Harness coordinates are nowhere near the overflow range hypot
 * exists to guard.
 */
export const distance = (a: Point3, b: Point3): number => {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/** Length of each consecutive segment. Fewer than two points yields []. */
export const segmentLengths = (points: ReadonlyArray<Point3>): ReadonlyArray<number> => {
  const out: Array<number> = []
  for (let i = 1; i < points.length; i++) out.push(distance(points[i - 1]!, points[i]!))
  return out
}

/** Total run length. Zero for fewer than two points. */
export const polylineLength = (points: ReadonlyArray<Point3>): number => {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1]!, points[i]!)
  return total
}

/**
 * Prefix sums, one per waypoint, the first always 0. What locates a breakout
 * sitting a given distance along a branch. Empty input yields [].
 */
export const cumulativeLengths = (points: ReadonlyArray<Point3>): ReadonlyArray<number> => {
  const out: Array<number> = []
  let total = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) total += distance(points[i - 1]!, points[i]!)
    out.push(total)
  }
  return out
}

/** Non-integer, out-of-range and non-finite indices land inside the polyline. */
const clampIndex = (i: number, length: number): number =>
  Number.isFinite(i) ? Math.min(Math.max(Math.trunc(i), 0), length - 1) : 0

/**
 * Cumulative length between two waypoint indices — how a wire's length is read
 * off its position along a branch.
 *
 * Order-independent by construction, not by approximation: the indices are
 * ordered first and the segments are then summed low-to-high, so swapping the
 * arguments produces the identical double, not merely a near-identical one.
 */
export const lengthBetween = (
  points: ReadonlyArray<Point3>,
  fromIndex: number,
  toIndex: number
): number => {
  if (points.length < 2) return 0
  const a = clampIndex(fromIndex, points.length)
  const b = clampIndex(toIndex, points.length)
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  let total = 0
  for (let i = lo + 1; i <= hi; i++) total += distance(points[i - 1]!, points[i]!)
  return total
}

/**
 * Radius of the circle through three consecutive waypoints — how tight the
 * bundle turns at `b`.
 *
 * `undefined` for every degenerate case: two points coincident, or all three
 * collinear. A straight run has infinite radius, which is not a violation, so
 * it must never surface as 0 — reporting it that way would invert the
 * bend-radius check and fail every straight branch.
 *
 * Formulation: the law of sines, R = |AC| / (2 sin B), with sin B taken from a
 * cross product of the two leg vectors after shifting the origin to `b`.
 *
 * The obvious alternative — R = abc / 4K with K from Heron — is wrong here, and
 * measurably so. Both textbook Heron and Kahan's stable rearrangement of it
 * ("Miscalculating Area and Angles of a Needle-like Triangle") take the three
 * SIDE LENGTHS as input, and by the time a branch's coordinates have been
 * turned into side lengths the information that distinguishes a bend from a
 * straight run is already gone: a first-order transverse offset only perturbs a
 * length to second order, so the square root squashes it below the rounding of
 * the length itself. No rearrangement of Heron can recover what its inputs no
 * longer carry. Checked against exact BigInt circumradii of the same doubles
 * over 400 generic near-collinear triangles at harness scale, this formulation
 * was more accurate in 399 and tied in the last, by up to eight orders of
 * magnitude — and on the tightest cases Kahan-Heron did not merely lose digits,
 * it returned "collinear" for real kinks, which is precisely the inversion that
 * would make the bend-radius rule pass a bundle it should fail.
 *
 * Subtracting `b` first is the load-bearing step: coordinate differences keep
 * the transverse offset at full relative precision, and every later operation
 * is on those differences rather than on the absolute positions.
 */
export const bendRadiusAt = (a: Point3, b: Point3, c: Point3): number | undefined => {
  const ux = a.x - b.x
  const uy = a.y - b.y
  const uz = a.z - b.z
  const vx = c.x - b.x
  const vy = c.y - b.y
  const vz = c.z - b.z

  const lu = Math.sqrt(ux * ux + uy * uy + uz * uz)
  const lv = Math.sqrt(vx * vx + vy * vy + vz * vz)
  const lw = distance(a, c)
  // A zero leg means two waypoints coincide: no unique circle through them.
  if (!(lu > 0) || !(lv > 0) || !(lw > 0)) return undefined

  const cx = uy * vz - uz * vy
  const cy = uz * vx - ux * vz
  const cz = ux * vy - uy * vx
  // |u x v| = |u||v| sin B, i.e. twice the triangle's area.
  const twiceArea = Math.sqrt(cx * cx + cy * cy + cz * cz)
  const sinB = twiceArea / (lu * lv)

  // Written as `!(x >= eps)` so a NaN from any path above lands here and
  // leaves as undefined rather than propagating into a radius.
  if (!(sinB >= COLLINEAR_EPSILON)) return undefined

  const radius = lw / (2 * sinB)
  // Belt and braces: never hand back NaN or Infinity as a radius.
  return Number.isFinite(radius) && radius > 0 ? radius : undefined
}

/**
 * Tightest bend over every interior vertex — what the bend-radius rule holds
 * against the bundle's minimum. `undefined` when no interior vertex has a
 * defined radius, which includes a straight run and any run under three points.
 */
export const minBendRadius = (points: ReadonlyArray<Point3>): number | undefined => {
  let tightest: number | undefined
  for (let i = 1; i + 1 < points.length; i++) {
    const radius = bendRadiusAt(points[i - 1]!, points[i]!, points[i + 1]!)
    if (radius !== undefined && (tightest === undefined || radius < tightest)) tightest = radius
  }
  return tightest
}

/**
 * Position a given distance along the polyline, for the formboard renderer and
 * for placing a breakout. Distances outside the run clamp to its ends rather
 * than extrapolating; `undefined` only for an empty polyline.
 */
export const pointAtDistance = (
  points: ReadonlyArray<Point3>,
  along: number
): Point3 | undefined => {
  const n = points.length
  if (n === 0) return undefined
  const first = points[0]!
  const last = points[n - 1]!
  if (n === 1 || Number.isNaN(along) || along <= 0) return first

  const cum = cumulativeLengths(points)
  if (along >= cum[n - 1]!) return last

  let i = 1
  while (i < n && cum[i]! < along) i++
  const before = points[i - 1]!
  const after = points[i]!
  const start = cum[i - 1]!
  const span = cum[i]! - start
  if (span <= 0) return before

  const t = (along - start) / span
  return {
    x: before.x + (after.x - before.x) * t,
    y: before.y + (after.y - before.y) * t,
    z: before.z + (after.z - before.z) * t
  }
}

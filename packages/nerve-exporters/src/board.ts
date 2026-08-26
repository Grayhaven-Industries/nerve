/**
 * Harness-board / nailboard layout (PRD §9.5.3) emitting DrawingIR.
 *
 * Shows physical branch layout for technicians: connector endpoints, breakout
 * children, label positions with offsets, sleeve callouts, and length
 * dimensions. A branch that declares an authored routed centerline is drawn
 * along it (see {@link branchGeometry} for the projection and its failure
 * mode); a branch without one keeps the synthesized topological run scaled
 * from its nominal length. 1:1-scale print tiling (§33) windows this drawing.
 */
import {
  pointAtDistance,
  polylineLength,
  segmentLengths,
  type Hir,
  type HirBranch,
  type Point3
} from "@grayhaven/nerve"
import { diagnosticBadges } from "./badges.js"
import { renderSvg, scaleDrawing, textWidth, type DrawItem, type Drawing } from "./drawing.js"

// The board lays out in REAL MILLIMETERS (1 unit = 1 mm): the formboard
// windows it 1:1 with no rescale (calibration stays exact, no lossy
// round-trip), and boardSvg applies a display scale for screens.
const MARGIN = 48
const TITLE_H = 64
const TRUNK_GAP = 150
const DEFAULT_LEN_MM = 240
const NODE_W = 64
const NODE_H = 26

// True length: 1 unit = 1 mm with NO floor. The old Math.max(120, mm)
// inflated every sub-120mm branch, which silently broke the formboard's
// "1:1 / calibration exact" promise (a 50mm drop printed at 120mm).
// Only an UNdimensioned branch falls back to a nominal display length.
const lengthMm = (mm: number | undefined): number =>
  mm !== undefined ? mm : DEFAULT_LEN_MM

/** Sheet coordinates round to the micron: the board is mm-native and prints
 * 1:1, so 1e-3 mm is three orders below anything a printer or a technician
 * can resolve, while keeping float artifacts out of the emitted bytes. */
const round3 = (n: number): number => Math.round(n * 1000) / 1000

/** A position on the board sheet, in sheet millimetres. */
interface SheetPoint {
  readonly x: number
  readonly y: number
}

/** Annotated lengths round to 0.1 mm — the resolution a cut list is called
 * out in. Deterministic: `String` of an already-rounded double. */
const fmtLength = (n: number): string => String(Math.round(n * 10) / 10)

/**
 * The note printed on any board that contains a routed branch. Short by
 * necessity: the same sentence has to fit a formboard sheet.
 */
export const ROUTED_PROJECTION_NOTE =
  "routed trunks: arc-length unroll, 1:1 along the path only"

/**
 * A branch is drawn along its authored centerline only when that centerline is
 * usable: at least two waypoints, finite, and of non-zero total length.
 * Everything else falls back to the topological layout — which is the common
 * case (no bundled example is routed today) and must stay byte-identical.
 *
 * Shared with the formboard so the sheet's projection note and the geometry it
 * annotates can never disagree.
 */
export const isRoutedBranch = (branch: HirBranch): boolean => {
  const waypoints = branch.waypoints
  if (waypoints === undefined || waypoints.length < 2) return false
  const length = polylineLength(waypoints)
  return Number.isFinite(length) && length > 0
}

/**
 * Signed turn at `b` in radians, positive counterclockwise seen from +Z.
 *
 * `atan2(|u x v|, u . v)` rather than `acos` of a normalised dot product:
 * `acos` loses its precision exactly at the near-straight vertex, which is
 * where a harness route spends most of its vertices, and can return NaN from a
 * dot product that rounds a hair past ±1.
 */
const turnAngle = (a: Point3, b: Point3, c: Point3): number => {
  const ux = b.x - a.x
  const uy = b.y - a.y
  const uz = b.z - a.z
  const vx = c.x - b.x
  const vy = c.y - b.y
  const vz = c.z - b.z
  const cx = uy * vz - uz * vy
  const cy = uz * vx - ux * vz
  const cz = ux * vy - uy * vx
  const magnitude = Math.atan2(
    Math.sqrt(cx * cx + cy * cy + cz * cz),
    ux * vx + uy * vy + uz * vz
  )
  // The sheet is the view from +Z and its y runs DOWN, so a counterclockwise
  // world turn (cz > 0) is a DECREASING heading here — that sign is what keeps
  // a plan-view route from printing as its own mirror image. A turn invisible
  // in plan view (cz == 0, e.g. a purely vertical zigzag) is signed off the +Y
  // then +X viewpoint instead: its drawn sense is then a choice, but its
  // magnitude is still exact, so a real kink is never drawn straight.
  const sense =
    cz !== 0 ? Math.sign(cz) : cy !== 0 ? Math.sign(cy) : cx !== 0 ? Math.sign(cx) : 1
  return -sense * magnitude
}

/** A branch's drawn centerline in sheet space, starting at the origin.
 * `local` is a polyline the geometry kernel measures directly (z pinned to 0),
 * so breakouts, splices and labels are placed with `pointAtDistance` on the
 * path that is actually drawn — not with a second copy of the arithmetic. */
interface BranchGeometry {
  readonly routed: boolean
  readonly local: ReadonlyArray<Point3>
  /** Drawn path length; equals `routedLength` for a routed branch. */
  readonly length: number
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/**
 * How a 3D routed centerline becomes 2D sheet geometry: an ARC-LENGTH UNROLL
 * (the rectifying development of the polyline).
 *
 * Every authored segment is laid into the sheet plane at exactly its 3D
 * length, and every vertex at exactly its 3D turn angle. The projection
 * therefore preserves, exactly:
 *   - the length of each segment, hence the total path length, hence the
 *     distance from the branch start to any breakout, splice or label on it;
 *   - the angle of every bend, so a kink is drawn as the kink it is;
 *   - handedness — a route that lies in a Z plane unrolls to its true plan
 *     view seen from +Z, never to that view's mirror.
 * It discards exactly one thing: torsion, the way the route leaves a plane.
 *
 * Why not the obvious alternatives. Projecting onto a principal plane (drop z)
 * or onto a best-fit plane is a foreshortening: every segment not parallel to
 * the chosen plane is drawn SHORTER than it is. On a formboard that is the
 * dangerous way to be wrong, because the sheet is a physical 1:1 template —
 * someone lays the bundle along the printed line and cuts against it, and a
 * template quietly 8% short scraps the run with nothing on the paper to say
 * so. An unroll can only be wrong about where two points sit relative to each
 * other, which a technician discovers when the harness will not lie on the
 * board, rather than after the wire is already cut.
 *
 * FAILURE MODE, stated plainly: for a route with torsion (one that does not
 * lie in a plane) the drawn straight-line distance between two points is NOT
 * their true separation, and a route that passes over itself in space can
 * cross itself on the sheet. The template is true MEASURED ALONG THE BUNDLE
 * and nowhere else. Which is why the board header and every formboard sheet
 * carry {@link ROUTED_PROJECTION_NOTE}, and every routed trunk carries
 * `data-projection="arc-length-unroll"`: a reader can always tell from the
 * output which geometry they are holding.
 */
const branchGeometry = (branch: HirBranch): BranchGeometry => {
  if (!isRoutedBranch(branch)) {
    const length = lengthMm(branch.nominalLength)
    return { routed: false, local: [], length, minX: 0, minY: 0, maxX: length, maxY: 0 }
  }
  const waypoints = branch.waypoints!
  const segments = segmentLengths(waypoints)
  const local: Array<Point3> = [{ x: 0, y: 0, z: 0 }]
  let heading = 0
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) heading += turnAngle(waypoints[i - 1]!, waypoints[i]!, waypoints[i + 1]!)
    const previous = local[i]!
    local.push({
      x: previous.x + segments[i]! * Math.cos(heading),
      y: previous.y + segments[i]! * Math.sin(heading),
      z: 0
    })
  }
  let minX = 0
  let minY = 0
  let maxX = 0
  let maxY = 0
  for (const p of local) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { routed: true, local, length: polylineLength(waypoints), minX, minY, maxX, maxY }
}

export const boardDrawing = (hir: Hir): Drawing => {
  const items: Array<DrawItem> = [
    {
      kind: "text",
      x: MARGIN,
      y: 28,
      text: `${hir.harness.id} — harness board`,
      size: 18,
      weight: "bold",
      fill: "#111"
    },
    {
      kind: "text",
      x: MARGIN,
      y: 48,
      text: `rev ${hir.harness.revision} · units ${hir.harness.units} · 1 unit = 1 ${hir.harness.units} (1:1)`,
      fill: "#555"
    }
  ]

  // Say which projection the reader is holding. Only a board that actually
  // contains a routed trunk carries the note, so an unrouted drawing is
  // untouched.
  const hasRouted = hir.branches.some(isRoutedBranch)
  if (hasRouted) {
    items.push({
      kind: "text",
      x: MARGIN,
      y: 64,
      text: ROUTED_PROJECTION_NOTE,
      size: 11,
      fill: "#555"
    })
  }

  const roots = hir.branches.filter((b) => b.parent === undefined)
  const children = (parent: string): ReadonlyArray<HirBranch> =>
    hir.branches.filter((b) => b.parent === parent)

  // The canvas widens to fit the projection note rather than clipping it.
  let maxX = hasRouted
    ? Math.max(MARGIN + 400, MARGIN + textWidth(ROUTED_PROJECTION_NOTE, 11))
    : MARGIN + 400
  let y = TITLE_H + MARGIN + NODE_H

  // First drawn position of each entity — diagnostic badges anchor here.
  const connectorAt = new Map<string, { x: number; y: number }>()
  const spliceAt = new Map<string, { x: number; y: number }>()
  const branchAt = new Map<string, { x: number; y: number }>()

  const drawEndpoint = (x: number, cy: number, ref: string): void => {
    if (!connectorAt.has(ref)) connectorAt.set(ref, { x, y: cy })
    items.push(
      {
        kind: "rect",
        x: x - NODE_W / 2,
        y: cy - NODE_H / 2,
        w: NODE_W,
        h: NODE_H,
        rx: 4,
        fill: "#ffffff",
        stroke: "#333",
        strokeWidth: 1.5
      },
      {
        kind: "text",
        x,
        y: cy + 4,
        text: ref,
        weight: "bold",
        fill: "#111",
        anchor: "middle"
      }
    )
  }

  // One geometry per branch, computed once: the parent needs a child's
  // bounding box to place the breakout stub before the child draws itself,
  // and recomputing would be both wasteful and a chance to disagree.
  const geometryCache = new Map<string, BranchGeometry>()
  const geometryOf = (branch: HirBranch): BranchGeometry => {
    const cached = geometryCache.get(branch.id)
    if (cached !== undefined) return cached
    const geometry = branchGeometry(branch)
    geometryCache.set(branch.id, geometry)
    return geometry
  }

  /** Where a branch's trunk starts, given the top-left corner of its row.
   * An unrouted trunk begins exactly at that corner (unchanged); a routed
   * trunk is offset by its own bounding box so the whole unrolled path stays
   * below and right of the corner instead of running back over its neighbours
   * or off the top of the sheet. */
  const startOf = (
    branch: HirBranch,
    ox: number,
    oy: number
  ): SheetPoint => {
    const geometry = geometryOf(branch)
    return geometry.routed
      ? { x: round3(ox - geometry.minX), y: round3(oy - geometry.minY) }
      : { x: ox, y: oy }
  }

  /** Keep a routed annotation on the canvas. The unrouted layout only ever
   * grows downward from its row, so its text is bounded by the trunk it sits
   * over; a routed annotation can be pushed sideways past the trunk's own
   * extent, and the canvas has to follow it. Measured with the same
   * deterministic monospace metric the rest of the layout uses. */
  const widenForText = (
    x: number,
    text: string,
    size: number,
    anchor: "start" | "middle" | "end"
  ): void => {
    const w = textWidth(text, size)
    const right = anchor === "start" ? x + w : anchor === "middle" ? x + w / 2 : x
    maxX = Math.max(maxX, round3(right + 8))
  }

  const drawBranch = (branch: HirBranch, x0: number, cy: number, depth: number): number => {
    const geometry = geometryOf(branch)
    const len = geometry.length
    const x1 = x0 + len

    /** Sheet position `along` units from the branch start. `flat` is the exact
     * expression the topological layout has always used, evaluated verbatim so
     * an unrouted branch emits byte-identical coordinates. */
    const at = (along: number, flat: number): SheetPoint => {
      if (!geometry.routed) return { x: flat, y: cy }
      const p = pointAtDistance(geometry.local, along)!
      return { x: round3(x0 + p.x), y: round3(cy + p.y) }
    }

    /** Unit normal to the trunk at `along`, chosen to point down the sheet.
     * Annotations are offset along it so they sit BESIDE the bundle instead of
     * being struck through by it — a routed trunk folds back on itself, so the
     * unrouted layout's "always above, always below" no longer holds. Falls
     * back to straight down, which is exactly the unrouted convention. */
    const normalAt = (along: number): SheetPoint => {
      const step = Math.max(len * 1e-3, 1e-6)
      const before = pointAtDistance(geometry.local, along - step)!
      const after = pointAtDistance(geometry.local, along + step)!
      const dx = after.x - before.x
      const dy = after.y - before.y
      const magnitude = Math.sqrt(dx * dx + dy * dy)
      if (!(magnitude > 0)) return { x: 0, y: 1 }
      const nx = -dy / magnitude
      const ny = dx / magnitude
      return ny >= 0 ? { x: nx, y: ny } : { x: -nx, y: -ny }
    }

    /** Text pushed sideways reads away from the trunk; text pushed up or down
     * stays centred, as the unrouted layout has it. */
    const anchorFor = (n: SheetPoint): "start" | "middle" | "end" =>
      Math.abs(n.x) <= Math.abs(n.y) ? "middle" : n.x > 0 ? "start" : "end"

    maxX = Math.max(
      maxX,
      geometry.routed ? round3(x0 + geometry.maxX + NODE_W) : x1 + NODE_W
    )
    branchAt.set(branch.id, at(len / 2, x0 + len / 2))

    // Trunk (thickness suggests the bundle). Routed branches follow the
    // unrolled centerline and say so in the markup; unrouted ones are the
    // synthesized topological run.
    if (geometry.routed) {
      items.push({
        kind: "path",
        d: geometry.local
          .map((p, i) => `${i === 0 ? "M" : "L"} ${round3(x0 + p.x)} ${round3(cy + p.y)}`)
          .join(" "),
        stroke: "#444",
        strokeWidth: 5,
        data: { branch: branch.id, projection: "arc-length-unroll" }
      })
    } else {
      items.push({
        kind: "line",
        x1: x0,
        y1: cy,
        x2: x1,
        y2: cy,
        stroke: "#444",
        strokeWidth: 5
      })
    }

    // Endpoints from the branch path: first at start, last at end,
    // intermediates evenly spaced (along the arc, when routed).
    const path = branch.path
    path.forEach((ref, i) => {
      const t = path.length > 1 ? i / (path.length - 1) : 0
      const p = at(t * len, x0 + t * len)
      drawEndpoint(p.x, p.y, ref)
    })

    // Branch ID + sleeve callout above; length dimension below.
    const callout = [
      branch.id,
      branch.sleeve !== undefined ? `sleeve: ${branch.sleeve}` : undefined
    ]
      .filter((s): s is string => s !== undefined)
      .join(" · ")
    const mid = at(len / 2, x0 + len / 2)
    // Straight down for an unrouted trunk, so the offsets below reduce to the
    // constants this layout has always used.
    const normal = geometry.routed ? normalAt(len / 2) : { x: 0, y: 1 }
    const CALLOUT_OFFSET = NODE_H / 2 + 8
    const LENGTH_OFFSET = NODE_H / 2 + 30
    const calloutX = geometry.routed ? round3(mid.x - normal.x * CALLOUT_OFFSET) : mid.x
    const calloutAnchor = geometry.routed
      ? anchorFor({ x: -normal.x, y: -normal.y })
      : "middle"
    items.push({
      kind: "text",
      x: calloutX,
      y: geometry.routed ? round3(mid.y - normal.y * CALLOUT_OFFSET) : mid.y - NODE_H / 2 - 8,
      text: callout,
      fill: "#333",
      anchor: calloutAnchor
    })
    if (geometry.routed) {
      // A measured length, so it reads "routed" and carries data-length-source;
      // an asserted one keeps reading "nominal" in the branch below. No witness
      // line: a straight dimension under a curved trunk would assert a
      // straight-line distance this projection does not preserve.
      const radius = branch.routedMinBendRadius
      const lengthText =
        `${fmtLength(branch.routedLength ?? len)} ${hir.harness.units} routed` +
        // Absent radius means a straight run (infinite radius), never zero, so
        // the callout omits it rather than printing a number.
        (radius !== undefined ? ` · min bend R ${fmtLength(radius)} ${hir.harness.units}` : "")
      const lengthX = round3(mid.x + normal.x * LENGTH_OFFSET)
      const lengthAnchor = anchorFor(normal)
      items.push({
        kind: "text",
        x: lengthX,
        y: round3(mid.y + normal.y * LENGTH_OFFSET),
        text: lengthText,
        size: 11,
        fill: "#777",
        anchor: lengthAnchor,
        data: { branch: branch.id, "length-source": "routed" }
      })
      widenForText(calloutX, callout, 12, calloutAnchor)
      widenForText(lengthX, lengthText, 11, lengthAnchor)
    } else if (branch.nominalLength !== undefined) {
      const dimY = cy + NODE_H / 2 + 16
      items.push(
        { kind: "line", x1: x0, y1: dimY, x2: x1, y2: dimY, stroke: "#999" },
        { kind: "line", x1: x0, y1: dimY - 4, x2: x0, y2: dimY + 4, stroke: "#999" },
        { kind: "line", x1: x1, y1: dimY - 4, x2: x1, y2: dimY + 4, stroke: "#999" },
        {
          kind: "text",
          x: x0 + len / 2,
          y: dimY + 14,
          text: `${branch.nominalLength} ${hir.harness.units} nominal`,
          size: 11,
          fill: "#777",
          anchor: "middle"
        }
      )
    }

    // Labels attached to this branch (offset measured from offsetFrom end).
    for (const label of hir.labels.filter((l) => l.attachTo === branch.id)) {
      const fromEnd = label.offsetFrom !== undefined && label.offsetFrom === path[path.length - 1]
      const off = label.distance ?? 0
      const anchor = at(fromEnd ? len - off : off, fromEnd ? x1 - off : x0 + off)
      const lx = anchor.x
      const ly = anchor.y
      const flagText = `${label.id}: ${label.text}`
      items.push(
        { kind: "line", x1: lx, y1: ly, x2: lx, y2: ly - 34, stroke: "#b07a00" },
        {
          kind: "rect",
          x: lx,
          y: ly - 50,
          // Measured, not the old hand-tuned 6.7px/char approximation.
          w: 16 + textWidth(flagText, 11),
          h: 16,
          fill: "#fff3d6",
          stroke: "#b07a00",
          strokeWidth: 1
        },
        {
          kind: "text",
          x: lx + 8,
          y: ly - 38,
          text: flagText,
          size: 11,
          fill: "#8a5a00"
        }
      )
    }

    // Splices located on this branch.
    for (const s of hir.splices.filter((sp) => sp.branch === branch.id)) {
      const along = Math.min(s.location ?? 0, len)
      const p = at(along, x0 + along)
      spliceAt.set(s.id, { x: p.x, y: p.y })
      items.push(
        { kind: "circle", cx: p.x, cy: p.y, r: 6, fill: "#333" },
        {
          kind: "text",
          x: p.x,
          y: p.y + NODE_H / 2 + 30,
          text: `${s.id}${s.type !== undefined ? ` (${s.type})` : ""}`,
          size: 11,
          fill: "#333",
          anchor: "middle"
        }
      )
    }

    // Breakout children: drop down-right from the breakout point. A routed
    // trunk owns vertical space of its own, so children start below its
    // deepest excursion rather than below the row's centre line.
    let childY = geometry.routed ? round3(cy + geometry.maxY) : cy
    for (const child of children(branch.id)) {
      const along = Math.min(child.breakoutDistance ?? 0, len)
      const b = at(along, x0 + along)
      childY += TRUNK_GAP * 0.7
      const start = startOf(child, b.x + 24, childY)
      items.push({
        kind: "line",
        x1: b.x,
        y1: b.y,
        x2: start.x,
        y2: start.y,
        stroke: "#444",
        strokeWidth: 3
      })
      childY = drawBranch(child, start.x, start.y, depth + 1)
    }
    return childY
  }

  if (roots.length === 0) {
    items.push({
      kind: "text",
      x: MARGIN,
      y,
      text: "No branches defined — add branch(...) entries to lay out the board.",
      fill: "#777"
    })
    y += 24
  }
  for (const root of roots) {
    const start = startOf(root, MARGIN + NODE_W / 2, y + 30)
    y = drawBranch(root, start.x, start.y, 0) + TRUNK_GAP
  }

  // Diagnostic badges at the entities technicians actually look at.
  // Pins are not drawn on the board view — pin findings badge the
  // connector node; wire findings badge nothing here (no wire geometry).
  items.push(
    ...diagnosticBadges(hir.diagnostics, (r) => {
      switch (r.kind) {
        case "connector":
        case "pin": {
          const p = connectorAt.get(r.ref)
          if (p === undefined) return undefined
          return {
            x: p.x + NODE_W / 2 + 10,
            y: p.y - NODE_H / 2 - 2,
            data: r.kind === "pin" ? { connector: r.ref, pin: r.pin! } : { connector: r.ref }
          }
        }
        case "splice": {
          const s = spliceAt.get(r.ref)
          if (s === undefined) return undefined
          return { x: s.x + 12, y: s.y - 12, data: { splice: r.ref } }
        }
        case "branch": {
          const b = branchAt.get(r.ref)
          if (b === undefined) return undefined
          return { x: b.x, y: b.y - NODE_H / 2 - 24, data: { branch: r.ref } }
        }
        default:
          return undefined
      }
    })
  )

  return {
    width: maxX + MARGIN,
    height: y + MARGIN,
    background: "#fafafa",
    items
  }
}

/** Screen rendering: the mm-native layout at a comfortable display scale. */
const BOARD_DISPLAY_SCALE = 0.8

export const boardSvg = (hir: Hir): string =>
  renderSvg(scaleDrawing(boardDrawing(hir), BOARD_DISPLAY_SCALE))

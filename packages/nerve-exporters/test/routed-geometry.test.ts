/**
 * Routed-centerline drawing tests: what the board and the formboard do with a
 * branch that carries authored `waypoints`, and — just as load-bearing — what
 * they must keep doing with the branches that do not.
 *
 * The projection under test is the arc-length unroll documented in board.ts.
 * Its guarantee is metric ALONG the path and nothing across it, so the
 * assertions here measure along the drawn polyline, plus one negative
 * assertion (a plane projection would foreshorten a 3D segment) that fails
 * loudly if someone swaps the projection out from under the template.
 *
 * vitest 4.1.10 — the root runner resolved by bun.lock, which is what
 * `bun run test` executes; the package's own ^3.2.4 devDependency is not.
 */
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import {
  branch,
  compileDesign,
  connector,
  distance,
  harness,
  label,
  minBendRadius,
  polylineLength,
  segmentLengths,
  splice,
  wire,
  type ConnectorPart,
  type Hir,
  type HirBranch,
  type Point3
} from "@grayhaven/nerve"
import { boardDrawing, boardSvg } from "../src/board.js"
import { formboardSheets } from "../src/formboard.js"

const part: ConnectorPart = { mpn: "RG-4", pinCount: 4 }
const j1 = connector("J1", part, { pins: { 1: "VBAT", 2: "SENSE" } })
const m1 = connector("M1", part, { pins: { 1: "VBAT" } })
const m2 = connector("M2", part, { pins: { 1: "SENSE" } })

/** One trunk with a sleeve, a label, a splice and a breakout child: enough of
 * the board's vocabulary that a byte hash over it is worth asserting. The
 * child `drop` is never routed, so every drawing below shows a computed and an
 * asserted length side by side. */
const design = harness("routed-geometry", {
  revision: "A",
  units: "mm",
  connectors: [j1, m1, m2],
  splices: [splice("SP1", { type: "crimp", branch: "trunk", location: 120 })],
  wires: [
    wire("W1", j1.pin(1), m1.pin(1), { gauge: "18AWG", color: "red", length: 500, signal: "VBAT" }),
    wire("W2", j1.pin(2), m2.pin(1), { gauge: "20AWG", color: "black", length: 300, signal: "SENSE" })
  ],
  branches: [
    branch("trunk", { path: [j1, m1], sleeve: "braided-pet", nominalLength: 420 }),
    branch("drop", { parent: "trunk", breakoutDistance: 150, path: [m2], nominalLength: 180 })
  ],
  labels: [label("L1", { text: "TRUNK A", attachTo: "trunk", offsetFrom: j1, distance: 60 })]
})

const unroutedHir = compileDesign(design).hir

/** An L in the XY plane: 300 across, 200 up, 500 of centerline against a
 * `nominalLength` of 420 — a drawing that still believes the asserted number
 * is impossible to mistake for one that measured the route. */
const L_ROUTE: ReadonlyArray<Point3> = [
  { x: 0, y: 0, z: 0 },
  { x: 300, y: 0, z: 0 },
  { x: 300, y: 200, z: 0 }
]

/** Collinear in all three axes: no interior bend, so `routedMinBendRadius` is
 * ABSENT (infinite radius, not zero), and every segment leaves the XY plane —
 * a plane projection would draw each true 114.56 as 111.80. */
const STRAIGHT_3D: ReadonlyArray<Point3> = [
  { x: 0, y: 0, z: 0 },
  { x: 100, y: 50, z: 25 },
  { x: 200, y: 100, z: 50 }
]

/** Attach a centerline the way the compiler does: waypoints authored, length
 * and curvature measured off them with the shared geometry kernel, and
 * `routedMinBendRadius` omitted rather than zeroed for a straight run. */
const route = (hir: Hir, id: string, waypoints: ReadonlyArray<Point3>): Hir => {
  const radius = minBendRadius(waypoints)
  const routed = (b: HirBranch): HirBranch =>
    radius !== undefined
      ? { ...b, waypoints, routedLength: polylineLength(waypoints), routedMinBendRadius: radius }
      : { ...b, waypoints, routedLength: polylineLength(waypoints) }
  return {
    ...hir,
    branches: hir.branches.map((b): HirBranch => (b.id === id ? routed(b) : b))
  }
}

/** Length assertions compare to 2 decimals: the board emits coordinates
 * rounded to the micron, so a multi-segment path can accumulate a few microns
 * of rounding. 0.005 mm is roughly an eighth of a 600 dpi printer dot — far
 * below anything the template can express, and still 4 orders of magnitude
 * tighter than the ~1 mm error a plane projection would introduce here. */
const MM_DIGITS = 2

const sha256 = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex")

/** Every formboard sheet, concatenated — the printed artifact as bytes. */
const sheetBytes = (hir: Hir): string =>
  formboardSheets(hir, { paper: "letter" })
    .sheets.map((s) => `${s.name}\n${s.svg}`)
    .join("")

const parseD = (d: string): ReadonlyArray<Point3> => {
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
  const points: Array<Point3> = []
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    points.push({ x: numbers[i]!, y: numbers[i + 1]!, z: 0 })
  }
  return points
}

/** The routed trunk as the LAYOUT emits it (board units, 1 unit = 1 mm). */
const trunkPoints = (hir: Hir, id: string): ReadonlyArray<Point3> => {
  const item = boardDrawing(hir).items.find(
    (i): i is Extract<typeof i, { kind: "path" }> =>
      i.kind === "path" &&
      i.data?.["branch"] === id &&
      i.data["projection"] === "arc-length-unroll"
  )
  expect(item, `no routed trunk emitted for ${id}`).toBeDefined()
  return parseD(item!.d)
}

/** The same trunk as the PRINTED SHEET carries it (also 1 unit = 1 mm). */
const sheetTrunkPoints = (hir: Hir, id: string): ReadonlyArray<Point3> => {
  const d = new RegExp(
    `<path data-branch="${id}" data-projection="arc-length-unroll" d="([^"]+)"`
  ).exec(sheetBytes(hir))?.[1]
  expect(d, `no routed trunk on the sheets for ${id}`).toBeDefined()
  return parseD(d!)
}

describe("unrouted branches (the common case) are untouched", () => {
  // These two digests were taken from the PRE-CHANGE board.ts / formboard.ts
  // (`git show HEAD:…` at the time of writing) over the fixture above. They
  // are the byte-identity claim in executable form: routing is additive, so a
  // harness that declares no waypoints must render exactly the drawing it
  // always did. A failure here is a regression, never a number to refresh —
  // the committed exporters snapshot and the PNG baselines say the same thing
  // about the bundled examples.
  const BOARD_SHA256 = "1f6acbde7a3d8dbcf432cb9d05d47b500056c1d4cabf6a4435d4c8235ef91fbb"
  const FORMBOARD_SHA256 = "59be3ae16b69502316eee35cb1009b45490e1ec8feac4154aa668b7f701709c5"

  it("emits byte-identical board and formboard SVG", () => {
    expect(sha256(boardSvg(unroutedHir))).toBe(BOARD_SHA256)
    expect(sha256(sheetBytes(unroutedHir))).toBe(FORMBOARD_SHA256)
  })

  it("carries no routed markings at all", () => {
    const svg = boardSvg(unroutedHir)
    expect(svg).not.toContain("data-projection")
    expect(svg).not.toContain("data-length-source")
    expect(svg).not.toMatch(/mm routed/)
    expect(sheetBytes(unroutedHir)).not.toContain("arc-length unroll")
  })
})

describe("a routed trunk is drawn along its centerline", () => {
  const hir = route(unroutedHir, "trunk", L_ROUTE)

  it("follows the projected waypoints, not the topological run", () => {
    const points = trunkPoints(hir, "trunk")
    expect(points).toHaveLength(L_ROUTE.length)
    // Segment for segment, the drawing is the route.
    for (const [i, drawn] of segmentLengths(points).entries()) {
      expect(drawn).toBeCloseTo(segmentLengths(L_ROUTE)[i]!, MM_DIGITS)
    }
    // ...and so it is NOT the 420 straight run the topology would have drawn.
    expect(polylineLength(points)).toBeCloseTo(500, MM_DIGITS)
    expect(distance(points[0]!, points[2]!)).toBeCloseTo(Math.hypot(300, 200), MM_DIGITS)
  })

  it("leaves the unrouted child on the topological run", () => {
    // Only `drop` still draws the synthesized straight trunk (#444 at width 5),
    // and it still spans exactly its nominal 180.
    const straight = boardDrawing(hir).items.filter(
      (i): i is Extract<typeof i, { kind: "line" }> =>
        i.kind === "line" && i.stroke === "#444" && i.strokeWidth === 5
    )
    expect(straight).toHaveLength(1)
    expect(straight[0]!.x2 - straight[0]!.x1).toBe(180)
    expect(straight[0]!.y1).toBe(straight[0]!.y2)
  })

  it("hangs the connector nodes off the routed path, not off nominalLength", () => {
    const drawing = boardDrawing(hir)
    const nodeAt = (ref: string) => {
      const text = drawing.items.find(
        (i): i is Extract<typeof i, { kind: "text" }> => i.kind === "text" && i.text === ref
      )!
      return { x: text.x, y: text.y - 4 }
    }
    const points = trunkPoints(hir, "trunk")
    const end = points[points.length - 1]!
    expect(nodeAt("M1").x).toBeCloseTo(end.x, MM_DIGITS)
    expect(nodeAt("M1").y).toBeCloseTo(end.y, MM_DIGITS)
    // The far node sits 200 ABOVE the near one, which a nominal-length layout
    // (both ends on one row) could never produce.
    expect(nodeAt("M1").y).toBeCloseTo(nodeAt("J1").y - 200, MM_DIGITS)
  })
})

describe("annotated length says which kind of number it is", () => {
  it("prefers routedLength and marks it as measured", () => {
    const svg = boardSvg(route(unroutedHir, "trunk", L_ROUTE))
    expect(svg).toContain("500 mm routed")
    expect(svg).toContain('data-length-source="routed"')
    // The trunk's asserted 420 is no longer presented as its length...
    expect(svg).not.toContain("420 mm nominal")
    // ...while the unrouted child still reads exactly as it always has, so the
    // two kinds of number appear side by side and cannot be confused.
    expect(svg).toContain("180 mm nominal")
  })

  it("falls back to nominalLength when the branch is not routed", () => {
    const svg = boardSvg(unroutedHir)
    expect(svg).toContain("420 mm nominal")
    expect(svg).toContain("180 mm nominal")
    expect(svg).not.toMatch(/mm routed/)
  })

  it("reports the routed bend radius when there is one", () => {
    const radius = minBendRadius(L_ROUTE)!
    expect(radius).toBeGreaterThan(0)
    expect(boardSvg(route(unroutedHir, "trunk", L_ROUTE))).toContain(
      `min bend R ${Math.round(radius * 10) / 10} mm`
    )
  })
})

describe("a straight routed run renders cleanly", () => {
  const hir = route(unroutedHir, "trunk", STRAIGHT_3D)

  it("has no routedMinBendRadius to print (infinite, not zero)", () => {
    expect(minBendRadius(STRAIGHT_3D)).toBeUndefined()
    expect(hir.branches.find((b) => b.id === "trunk")!.routedMinBendRadius).toBeUndefined()
    expect(boardSvg(hir)).not.toContain("min bend R")
  })

  it("emits no NaN, no undefined and no empty coordinate", () => {
    for (const svg of [boardSvg(hir), sheetBytes(hir)]) {
      expect(svg).not.toContain("NaN")
      expect(svg).not.toContain("undefined")
      expect(svg).not.toContain("Infinity")
      for (const m of svg.matchAll(/\s(x|y|x1|y1|x2|y2|cx|cy|r|font-size)="([^"]*)"/g)) {
        expect(m[2], `empty ${m[1]}`).not.toBe("")
        expect(Number.isFinite(Number(m[2])), `${m[1]}="${m[2]}"`).toBe(true)
      }
      for (const m of svg.matchAll(/ d="([^"]*)"/g)) {
        expect(m[1]).not.toBe("")
        for (const n of m[1]!.split(/[^-\d.]+/).filter((s) => s.length > 0)) {
          expect(Number.isFinite(Number(n)), `d token ${n}`).toBe(true)
        }
      }
    }
  })
})

describe("determinism", () => {
  for (const [name, waypoints] of [
    ["planar L", L_ROUTE],
    ["straight 3D", STRAIGHT_3D]
  ] as const) {
    it(`same HIR twice, same bytes for both views (${name})`, () => {
      const hir = route(unroutedHir, "trunk", waypoints)
      expect(boardSvg(hir)).toBe(boardSvg(hir))
      expect(sheetBytes(hir)).toBe(sheetBytes(hir))
      // Same geometry rebuilt from scratch, not the same object identity.
      const rebuilt = route(unroutedHir, "trunk", waypoints.map((p) => ({ ...p })))
      expect(boardSvg(rebuilt)).toBe(boardSvg(hir))
      expect(sheetBytes(rebuilt)).toBe(sheetBytes(hir))
    })
  }
})

describe("formboard sheets stay 1:1 for a routed branch", () => {
  // THE PROPERTY THIS PROJECTION GUARANTEES: arc length. Every drawn segment is
  // its true 3D length, so distance measured ALONG a printed trunk is the
  // harness's real routed length, which is what someone cutting against the
  // template is doing. It does NOT guarantee straight-line distance across the
  // paper — that is what the unroll trades away — and the foreshortening test
  // below pins the trade down so a switch to a plane projection fails here.
  it("prints one sheet unit per millimetre", () => {
    const sheet = formboardSheets(route(unroutedHir, "trunk", L_ROUTE), {
      paper: "letter"
    }).sheets[0]!
    const m = /width="([\d.]+)mm"[^>]*viewBox="[\d.-]+ [\d.-]+ ([\d.]+) /.exec(sheet.svg)!
    expect(Number(m[1])).toBeCloseTo(Number(m[2]), 10)
  })

  for (const [name, waypoints] of [
    ["planar L", L_ROUTE],
    ["straight 3D", STRAIGHT_3D]
  ] as const) {
    it(`drawn path length equals routedLength (${name})`, () => {
      const hir = route(unroutedHir, "trunk", waypoints)
      const routedLength = hir.branches.find((b) => b.id === "trunk")!.routedLength!
      // Sheets are mm-native and unscaled, so the sheet polyline IS the
      // template. 1e-3 is the micron-level coordinate rounding the board emits.
      const points = sheetTrunkPoints(hir, "trunk")
      expect(polylineLength(points)).toBeCloseTo(routedLength, MM_DIGITS)
      for (const [i, drawn] of segmentLengths(points).entries()) {
        expect(drawn).toBeCloseTo(segmentLengths(waypoints)[i]!, MM_DIGITS)
      }
    })
  }

  it("keeps a 3D segment at full length instead of foreshortening it", () => {
    const hir = route(unroutedHir, "trunk", STRAIGHT_3D)
    const drawn = segmentLengths(sheetTrunkPoints(hir, "trunk"))[0]!
    const trueLength = distance(STRAIGHT_3D[0]!, STRAIGHT_3D[1]!)
    const droppedZ = Math.hypot(
      STRAIGHT_3D[1]!.x - STRAIGHT_3D[0]!.x,
      STRAIGHT_3D[1]!.y - STRAIGHT_3D[0]!.y
    )
    expect(drawn).toBeCloseTo(trueLength, MM_DIGITS)
    expect(drawn).toBeGreaterThan(droppedZ + 1)
  })

  it("says on the page which projection the template is", () => {
    for (const sheet of formboardSheets(route(unroutedHir, "trunk", L_ROUTE), { paper: "letter" })
      .sheets) {
      expect(sheet.svg).toContain("arc-length unroll, 1:1 along the path only")
    }
  })
})

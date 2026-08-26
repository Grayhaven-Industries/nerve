import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { PDFDocument } from "pdf-lib"
import { compileDesign, branch, connector, harness, wire } from "@grayhaven/nerve"
import {
  assemblyInstructions,
  boardDrawing,
  boardSvg,
  bomCsv,
  buildPacket,
  canRelease,
  coverage,
  cutListCsv,
  generateTestPlan,
  labelScheduleCsv,
  manufacturingPacketPdf,
  schematicSvg,
  testPlanCsv
} from "@grayhaven/nerve-exporters"
import design from "../../../examples/motor-controller/src/main.harness.js"

const { hir } = compileDesign(design)

describe("CSV exporters (PRD §20)", () => {
  it("BOM has the §20.1 columns and connector rollup", () => {
    const csv = bomCsv(hir)
    const [header, ...rows] = csv.trim().split("\n")
    expect(header).toBe(
      "Item number,Quantity,Unit of measure,Internal part number,Manufacturer,Manufacturer part number,Description,Category,Used by,Approved alternates,Notes"
    )
    expect(rows).toHaveLength(4)
    expect(rows[0]).toContain("43020-0800")
    expect(rows[0]).toContain("connector:M1")
    expect(csv).toMatchSnapshot()
  })

  it("cut list has the §20.2 columns, with default tolerance applied", () => {
    const csv = cutListCsv(hir, { defaultWireTolerance: 10 })
    const lines = csv.trim().split("\n")
    expect(lines[0]).toBe(
      "Wire ID,Signal,Gauge,Color,Stripe,Cut length,Finished length,Service loop,Termination allowance (from),Termination allowance (to),Strip (from),Strip (to),Tolerance,Units,From connector,From pin,To connector,To pin,Terminal A,Terminal B,Branch,Notes"
    )
    // No allowances declared, so cut length still equals finished length.
    expect(lines[1]).toBe(
      "W1,VBAT_24V,20AWG,red,,420,420,,,,,,10,mm,J1,1,M1,1,43030-0007,43031-0007,,"
    )
    expect(csv).toMatchSnapshot()
  })

  it("label schedule has the §20.3 columns", () => {
    const csv = labelScheduleCsv(hir)
    const lines = csv.trim().split("\n")
    expect(lines[1]).toBe("L1,MOTOR CTRL A,1,,,main,50 from J1,,")
    expect(csv).toMatchSnapshot()
  })

  it("escapes cells containing commas and quotes", () => {
    const { hir: tricky } = compileDesign({
      ...design,
      labels: [
        {
          kind: "label",
          id: "L1",
          text: 'MOTOR "A", MAIN',
          attachTo: "main"
        }
      ]
    })
    expect(labelScheduleCsv(tricky)).toContain('"MOTOR ""A"", MAIN"')
  })
})

describe("test plan (PRD §9.9)", () => {
  const plan = generateTestPlan(hir)

  it("generates one continuity test per wire, matching the PRD shape", () => {
    const continuity = plan.tests.filter((t) => t.type === "continuity")
    expect(continuity).toHaveLength(4)
    expect(continuity[0]).toEqual({
      id: "T-001",
      type: "continuity",
      from: { connector: "J1", pin: "1" },
      to: { connector: "M1", pin: "1" },
      expected: "closed",
      net: "VBAT_24V",
      wire: "W1"
    })
  })

  it("generates no-short tests between distinct nets on each connector", () => {
    const noShort = plan.tests.filter((t) => t.type === "no-short")
    // 4 nets per connector → C(4,2)=6 pairs × 2 connectors.
    expect(noShort).toHaveLength(12)
    expect(noShort.every((t) => t.expected === "open")).toBe(true)
  })

  it("covers every wired net (acceptance criterion)", () => {
    const { nets, covered } = coverage(hir, plan)
    expect(covered).toBe(nets)
  })

  it("CSV form is deterministic", () => {
    expect(testPlanCsv(plan)).toBe(testPlanCsv(generateTestPlan(hir)))
    expect(testPlanCsv(plan)).toMatchSnapshot()
  })
})

describe("SVG schematic (PRD §9.5.1)", () => {
  const svg = schematicSvg(hir)

  it("renders title block, connectors, pins, and wires", () => {
    expect(svg).toContain("motor-controller-harness")
    expect(svg).toContain("rev A")
    expect(svg).toContain(">J1<")
    expect(svg).toContain(">M1<")
    expect(svg).toContain("43025-0800")
    expect(svg).toContain("W1 · 20AWG")
    expect(svg).toContain("W3 · 24AWG · twisted")
    expect(svg).toMatchSnapshot()
  })

  it("highlights wires with error diagnostics", () => {
    const withError = {
      ...hir,
      diagnostics: [
        {
          code: "HK-WIRE-004",
          severity: "error" as const,
          message: "test",
          target: "wire:W1"
        }
      ]
    }
    expect(schematicSvg(withError)).toContain('stroke="#d11"')
  })

  it("is deterministic", () => {
    expect(schematicSvg(hir)).toBe(svg)
  })
})

describe("harness board view (PRD §9.5.3)", () => {
  const svg = boardSvg(hir)

  it("renders branch trunk, endpoints, sleeve, length, and label callouts", () => {
    expect(svg).toContain("harness board")
    expect(svg).toContain(">J1<")
    expect(svg).toContain(">M1<")
    expect(svg).toContain("main · sleeve: braided-pet")
    expect(svg).toContain("420 mm nominal")
    expect(svg).toContain("L1: MOTOR CTRL A")
    expect(svg).toMatchSnapshot()
  })

  it("is deterministic and handles branch-less harnesses", () => {
    expect(boardSvg(hir)).toBe(svg)
    const { hir: bare } = compileDesign({ ...design, branches: [], labels: [] })
    expect(boardSvg(bare)).toContain("No branches defined")
  })

  it("lays out at true 1:1 mm — a short branch is NOT inflated to a 120mm floor", () => {
    const part = { mpn: "T-2", pinCount: 2 }
    const a = connector("A", part, { pins: { 1: "X" } })
    const b = connector("B", part, { pins: { 1: "X" } })
    const { hir: shortHir } = compileDesign(
      harness("short", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [wire("W1", a.pin(1), b.pin(1), { signal: "X" })],
        branches: [branch("B1", { path: [a, b], nominalLength: 50 })]
      })
    )
    // The trunk line (stroke #444, width 5) must span 50 units, not 120 —
    // the formboard prints this 1:1, so the floor would break calibration.
    const trunk = boardDrawing(shortHir).items.find(
      (i): i is Extract<typeof i, { kind: "line" }> =>
        i.kind === "line" && i.stroke === "#444" && i.strokeWidth === 5
    )
    expect(trunk).toBeDefined()
    expect((trunk!.x2 - trunk!.x1)).toBe(50)
  })
})

describe("assembly instructions (PRD §20.4)", () => {
  it("covers materials, cut, twist, populate, branch, label, inspect, test", () => {
    const text = assemblyInstructions(hir)
    expect(text).toContain("Cut W1: 20AWG red, 420 mm [VBAT_24V]")
    expect(text).toContain("Twist W3 + W4 together (CAN_PAIR)")
    expect(text).toContain("Populate J1 (43025-0800, receptacle)")
    expect(text).toContain("Route branch main (J1 → M1); 420 mm nominal; sleeve with braided-pet")
    expect(text).toContain('Apply L1 "MOTOR CTRL A" on main 50 mm from J1')
    expect(text).toContain("continuity-test procedure")
    expect(text).toMatchSnapshot()
  })
})

describe("PDF manufacturing packet (PRD §9.8, DoD #6)", () => {
  it("produces a valid, deterministic PDF", async () => {
    const a = await manufacturingPacketPdf(hir, { defaultWireTolerance: 10 })
    const b = await manufacturingPacketPdf(hir, { defaultWireTolerance: 10 })
    expect(Buffer.from(a.slice(0, 5)).toString()).toBe("%PDF-")
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    // Cover + schematic + board + 4 tables + instructions ≥ 8 pages.
    const doc = await PDFDocument.load(a)
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(8)
    expect(doc.getTitle()).toBe(
      "motor-controller-harness rev A — manufacturing packet"
    )
  })
})

describe("manufacturing packet (PRD §9.8)", () => {
  it("contains all artifacts and is byte-deterministic", async () => {
    const a = await buildPacket(hir, { defaultWireTolerance: 10 })
    const b = await buildPacket(hir, { defaultWireTolerance: 10 })
    expect([...a.files.keys()]).toEqual([
      "COVER.txt",
      "manufacturing-packet.pdf",
      "harness.json",
      "graph.json",
      "render-layout.json",
      "diagnostics.json",
      "schematic.svg",
      "schematic.html",
      "board.svg",
      "connector-faces.svg",
      "pinout.svg",
      "bom.csv",
      "cut-list.csv",
      "labels.csv",
      "bom.json",
      "cut-list.json",
      "label-schedule.json",
      "bop.csv",
      "bop.json",
      "tests.csv",
      "test-plan.json",
      "assembly-instructions.txt"
    ])
    expect(Buffer.from(a.zip).equals(Buffer.from(b.zip))).toBe(true)
  })

  it("packet zip bytes are golden — an fflate/pdf-lib bump that changes them fails here", async () => {
    // Same-process determinism (above) can't see a dependency-version
    // byte change. This hashes the whole zip against a committed snapshot,
    // so a Renovate bump that alters compression/PDF output trips the
    // determinism gate. Refresh intentionally with `vitest -u`.
    const { zip } = await buildPacket(hir, { defaultWireTolerance: 10 })
    expect(createHash("sha256").update(Buffer.from(zip)).digest("hex")).toMatchSnapshot()
  })

  it("cover sheet carries revision metadata, not timestamps", async () => {
    const { files } = await buildPacket(hir)
    // SAFETY: buildPacket writes COVER.txt as a string (coverSheet), never bytes.
    const cover = files.get("COVER.txt") as string
    expect(cover).toContain("Revision:     A")
    expect(cover).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it("release gate fails closed on errors", () => {
    expect(canRelease(hir)).toBe(true)
    expect(
      canRelease({
        ...hir,
        diagnostics: [
          { code: "X", severity: "error", message: "boom" }
        ]
      })
    ).toBe(false)
  })
})

describe("net-label mode (high-fanout nets)", () => {
  it("signals on >=3 wires render as stubs + flags, not routed paths", async () => {
    const { compileDesign, connector, harness, wire } = await import("@grayhaven/nerve")
    const part = { mpn: "NL-8", pinCount: 8 }
    const a = connector("J1", part, { pins: { 1: "VBAT", 2: "VBAT", 3: "VBAT", 4: "DATA" } })
    const b = connector("J2", part, { pins: { 1: "VBAT", 2: "VBAT", 3: "VBAT", 4: "DATA" } })
    const { hir } = compileDesign(
      harness("netlabel", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [
          wire("W1", a.pin(1), b.pin(1), { signal: "VBAT", gauge: "18AWG", color: "red", length: 100 }),
          wire("W2", a.pin(2), b.pin(2), { signal: "VBAT", gauge: "18AWG", color: "red", length: 100 }),
          wire("W3", a.pin(3), b.pin(3), { signal: "VBAT", gauge: "18AWG", color: "red", length: 100 }),
          wire("W4", a.pin(4), b.pin(4), { signal: "DATA", gauge: "24AWG", color: "blue", length: 100 }),
          // Pad past NET_LABEL_MIN_WIRES so the size gate engages.
          ...Array.from({ length: 9 }, (_, i) =>
            wire(`WP${i}`, a.pin(5), b.pin(5), { signal: `PAD${i}`, gauge: "24AWG", color: "black", length: 100 })
          )
        ]
      })
    )
    const svg = schematicSvg(hir)
    // Small harnesses stay fully drawn (size gate).
    const small = compileDesign(
      harness("small", {
        revision: "A",
        units: "mm",
        connectors: [a, b],
        wires: [
          wire("S1", a.pin(1), b.pin(1), { signal: "VBAT", gauge: "18AWG", color: "red", length: 100 }),
          wire("S2", a.pin(2), b.pin(2), { signal: "VBAT", gauge: "18AWG", color: "red", length: 100 }),
          wire("S3", a.pin(3), b.pin(3), { signal: "VBAT", gauge: "18AWG", color: "red", length: 100 })
        ]
      })
    ).hir
    expect(schematicSvg(small)).not.toContain("▸ VBAT")
    // Labeled net: flags at both ends, no cross-canvas curve for VBAT wires.
    expect(svg).toContain("▸ VBAT")
    expect(svg).toContain("VBAT ◂")
    expect((svg.match(/▸ VBAT/g) ?? []).length).toBe(3) // one per left-side wire end
    // Low-fanout DATA wire still routes as a path.
    const pathCount = (svg.match(/<path data-wire="W4"/g) ?? []).length
    expect(pathCount).toBe(1)
    expect(svg).not.toContain('<path data-wire="W1"')
    // Determinism.
    expect(schematicSvg(hir)).toBe(svg)
  })
})

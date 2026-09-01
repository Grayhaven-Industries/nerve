import { readFileSync } from "node:fs"
import { join } from "node:path"
// Vitest 4.1.10: describe/it/expect exports verified against installed types.
import { describe, expect, it } from "vitest"
import { compileDesign } from "@grayhaven/nerve"
import { exportWireViz, importWireViz } from "@grayhaven/nerve-wireviz"

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")

describe("WireViz import (PRD §27.2)", () => {
  const { design, diagnostics } = importWireViz(fixture("motor.yml"), {
    harnessId: "imported-motor"
  })
  const { hir, diagnostics: structural } = compileDesign(design)

  it("imports connectors with pinlabels and genders", () => {
    expect(diagnostics).toEqual([])
    expect(structural).toEqual([])
    expect(hir.connectors.map((c) => c.ref)).toEqual(["X1", "X2"])
    expect(hir.connectors[0]).toMatchObject({
      family: "Molex Micro-Fit 3.0",
      gender: "receptacle",
      pinCount: 4
    })
    expect(hir.connectors[0]?.pins[2]).toEqual({ pin: "3", signal: "CAN_H" })
  })

  it("imports cable conductors as wires with color/gauge/length", () => {
    expect(hir.wires).toHaveLength(4)
    expect(hir.wires[0]).toMatchObject({
      id: "W1.1",
      from: { connector: "X1", pin: "1" },
      to: { connector: "X2", pin: "1" },
      gauge: "20AWG",
      color: "red",
      length: 420,
      signal: "VBAT",
      cable: "W1"
    })
    expect(hir.cables[0]).toMatchObject({ id: "W1", conductors: 4, shield: "shield" })
  })

  it("matches the import snapshot", () => {
    expect(hir).toMatchSnapshot()
  })

  it("warns about unmapped concepts instead of silently dropping them", () => {
    const result = importWireViz(fixture("unsupported.yml"))
    const messages = result.diagnostics.map((d) => d.message)
    expect(messages.some((m) => m.includes('"fontname"'))).toBe(true)
    expect(messages.some((m) => m.includes('"image"'))).toBe(true)
    expect(result.design.metadata.sourceTitle).toBe("Demo")
    // Bundle wires import as loose wires with DIN colors, not a cable.
    const { hir: h } = compileDesign(result.design)
    expect(h.cables).toEqual([])
    expect(h.wires.map((w) => w.color)).toEqual(["white", "brown"])
  })

  it("reports unknown top-level scalar and object sections", () => {
    const result = importWireViz(`connectors: {}
cables: {}
connections: []
vendor_note: keep out
vendor_extension:
  nested: value
`)

    expect(result.design.wires).toEqual([])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "HK-WV-001",
        severity: "warning",
        message: expect.stringContaining('"vendor_note"')
      }),
      expect.objectContaining({
        code: "HK-WV-001",
        severity: "warning",
        message: expect.stringContaining('"vendor_extension"')
      })
    ])
  })

  it("reports recursive values by key without traversing the alias", () => {
    const result = importWireViz(`recursive: &loop [*loop]
connectors: {}
cables: {}
connections: []
`)

    expect(result.design.wires).toEqual([])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "HK-WV-001",
        message: expect.stringContaining('"recursive"')
      })
    ])
  })

  it("accepts top-level templates as a diagnostic-clean anchor container", () => {
    const result = importWireViz(`templates:
  connector: &connector
    type: JST-XH
connectors:
  X1:
    <<: *connector
cables: {}
connections: []
`)

    expect(result.design.connectors).toHaveLength(1)
    expect(result.diagnostics).toEqual([])
  })

  it("continues to report known unsupported top-level sections", () => {
    const result = importWireViz(`connectors: {}
cables: {}
connections: []
tweak: {}
additional_bom_items: []
`)

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: "HK-WV-001",
        message: expect.stringContaining('"tweak"')
      }),
      expect.objectContaining({
        code: "HK-WV-001",
        message: expect.stringContaining('"additional_bom_items"')
      })
    ])
  })

  it("supports prepend files, YAML merges, descending ranges, and explicit length units", () => {
    const prepend = `templates:
  connector: &connector
    type: JST-XH
    subtype: female
    pinlabels: [A, B, C, D]
  cable: &cable
    colors: [RD, BK, BU, WH]
    gauge: 22 awg
`
    const source = `connectors:
  X1:
    <<: *connector
  X2:
    <<: *connector
cables:
  W1:
    <<: *cable
    length: 36 cm
connections:
  - [X1: [1-4], W1: [1-4], X2: [4-1]]
metadata:
  title: Reversing adapter
`
    const result = importWireViz(source, {
      harnessId: "real-wireviz",
      prependYaml: [prepend]
    })
    const { hir, diagnostics: structural } = compileDesign(result.design)

    expect(result.diagnostics).toEqual([])
    expect(structural).toEqual([])
    expect(hir.harness.metadata.sourceTitle).toBe("Reversing adapter")
    expect(hir.connectors[0]).toMatchObject({
      family: "JST-XH",
      gender: "receptacle",
      pinCount: 4
    })
    expect(
      hir.wires.map((w) => [
        "pin" in w.from ? w.from.pin : undefined,
        "pin" in w.to ? w.to.pin : undefined,
        w.gauge,
        w.length
      ])
    ).toEqual([
      ["1", "4", "22AWG", 360],
      ["2", "3", "22AWG", 360],
      ["3", "2", "22AWG", 360],
      ["4", "1", "22AWG", 360]
    ])
  })

  it("materializes named WireViz templates and resolves semantic pin and conductor names", () => {
    const result = importWireViz(`options:
  template_separator: "."
connectors:
  PLUG:
    type: Control plug
    subtype: male
    pinlabels: [VBAT, GND, CAN_H, CAN_L]
  SOCKET:
    type: Control socket
    subtype: female
    pinlabels: [VBAT, GND, CAN_H, CAN_L]
cables:
  LOOM:
    wirecount: 4
    wirelabels: [POWER, RETURN, CAN_HIGH, CAN_LOW]
    colors: [RD, BK, WH, BU]
    gauge: 22 awg
    length: 0.4
connections:
  - [PLUG.J1: [VBAT, GND, CAN_H, CAN_L], LOOM.CBL1: [POWER, RETURN, CAN_HIGH, CAN_LOW], SOCKET.J2: [VBAT, GND, CAN_H, CAN_L]]
`)
    const { hir, diagnostics: structural } = compileDesign(result.design)

    expect(result.diagnostics).toEqual([])
    expect(structural).toEqual([])
    expect(hir.connectors.map((connector) => connector.ref)).toEqual(["J1", "J2"])
    expect(hir.cables.map((cable) => cable.id)).toEqual(["CBL1"])
    expect(
      hir.wires.map((wire) => [
        wire.id,
        "pin" in wire.from ? wire.from.pin : undefined,
        wire.conductor,
        wire.color,
        wire.signal
      ])
    ).toEqual([
      ["CBL1.1", "1", "1", "red", "VBAT"],
      ["CBL1.2", "2", "2", "black", "GND"],
      ["CBL1.3", "3", "3", "white", "CAN_H"],
      ["CBL1.4", "4", "4", "blue", "CAN_L"]
    ])
    expect(hir.bom.some((item) => item.usedBy.includes("connector:PLUG"))).toBe(false)
    expect(hir.bom.some((item) => item.usedBy.includes("connector:SOCKET"))).toBe(false)
  })

  it("fails visibly on ambiguous semantic references and unnamed templates", () => {
    const result = importWireViz(`connectors:
  X:
    pinlabels: [SIG, SIG]
  Y:
    pinlabels: [SIG, SIG]
cables:
  W:
    colors: [RD, RD]
connections:
  - [X.X1: [SIG], W.W1: [RD], Y.Y1: [SIG]]
  - [X.X2: [1], W.: [1], Y.Y2: [1]]
`)

    expect(result.design.wires).toEqual([])
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('pin label "SIG" is ambiguous'),
        expect.stringContaining('conductor reference "RD" is ambiguous'),
        expect.stringContaining('unnamed cable autogeneration "W."')
      ])
    )
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === "error")).toBe(true)
  })
  it("reports dropped connection rows as errors instead of succeeding with zero wires", () => {
    const result = importWireViz(`connectors:
  X1: { pincount: 2 }
cables:
  W1: { wirecount: 2 }
connections:
  - [X1: [1-2], W1: [1-2], [X, X]]
`)

    expect(result.design.wires).toEqual([])
    expect(result.diagnostics.map((d) => d.severity)).toEqual(["error", "error"])
    expect(result.diagnostics[0]?.message).toContain("unrecognized entry")
    expect(result.diagnostics[1]?.message).toContain("no wires were imported")
  })
})

describe("WireViz export (PRD §27.2)", () => {
  const { design } = importWireViz(fixture("motor.yml"), { harnessId: "rt" })
  const { hir } = compileDesign(design)

  it("round-trips through export and re-import", () => {
    const { yaml, diagnostics } = exportWireViz(hir)
    expect(diagnostics).toEqual([])
    const back = importWireViz(yaml, { harnessId: "rt" })
    const { hir: hir2 } = compileDesign(back.design)
    expect(hir2.connectors).toEqual(hir.connectors)
    expect(hir2.wires.map((w) => [w.id, w.color, w.gauge, w.length])).toEqual(
      hir.wires.map((w) => [w.id, w.color, w.gauge, w.length])
    )
  })

  it("reports splices as unrepresentable", async () => {
    const spliced = await import("../../../examples/sensor-splice/src/main.harness.js")
    const { hir: sHir } = compileDesign(spliced.default)
    const { diagnostics } = exportWireViz(sHir)
    expect(diagnostics.filter((d) => d.code === "HK-WV-002").length).toBeGreaterThan(0)
  })
})

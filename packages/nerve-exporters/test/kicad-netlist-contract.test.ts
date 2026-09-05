import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { compileDesign } from "@grayhaven/nerve"
import {
  contractJson,
  findContractImporter,
  importKiCadNetlistPinout,
  importKiCadPcbPinout,
  validateContract
} from "@grayhaven/nerve-exporters"
import motor from "../../../examples/motor-controller/src/main.harness.js"

const fixture = readFileSync(resolve(import.meta.dirname, "fixtures/controller.net"), "utf8")
const board = readFileSync(resolve(import.meta.dirname, "fixtures/controller.kicad_pcb"), "utf8")
const meta = { connector: "J1", component: "BOARD_J7", sourceName: "controller.net" }
const { hir } = compileDesign(motor)

// Provenance and source links live beside the native-format fixture.
describe("KiCad schematic netlist contracts", () => {
  it("imports a complete connector before board layout with revision and source provenance", () => {
    expect(findContractImporter("Controller.NET")?.id).toBe("kicad-netlist")
    const imported = findContractImporter("Controller.NET")!.import(fixture, meta)!
    expect(imported).toMatchObject({
      connector: "J1",
      mpn: "43020-0800",
      harness: { id: "kicad-netlist", revision: "A" },
      source: {
        format: "kicad-netlist", name: "controller.net", component: "BOARD_J7",
        designRevision: "A", formatVersion: "E", generator: "Eeschema 9.0.2"
      }
    })
    expect(imported.source?.contentFingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
    expect(imported.pinout.map((pin) => pin.pin)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"])
    expect(imported.pinout).toEqual(importKiCadPcbPinout(board, meta)!.pinout)
    expect(validateContract(hir, imported)).toEqual([])
  })

  it("keeps unknown inventory pins distinct from schematic and library no-connect declarations", () => {
    const imported = importKiCadNetlistPinout(fixture, { connector: "J1", component: "J_NC" })!
    expect(imported.mpn).toBe("TEST-4")
    expect(imported.pinout).toEqual([
      { pin: "1", sourcePin: "1", connection: "unconnected" },
      { pin: "2", sourcePin: "2" },
      { pin: "3", sourcePin: "3", connection: "unconnected" },
      { pin: "4", sourcePin: "4", signal: "unconnected-user-signal", connection: "net" }
    ])
    const diagnostics = validateContract(hir, imported)
    expect(diagnostics.filter((d) => d.code === "HK-IFC-006").map((d) => d.target)).toEqual([
      "connector:J1.pin:1", "connector:J1.pin:3"
    ])
    expect(diagnostics.some((d) => d.target === "connector:J1.pin:2")).toBe(false)
  })

  it("retains exact resolved hierarchical net names and does not infer roles or voltages", () => {
    const imported = importKiCadNetlistPinout(fixture.replace('"CAN_H"', '"/Controller/CAN_H"'), meta)!
    expect(imported.pinout.find((p) => p.pin === "3")).toEqual({
      pin: "3", sourcePin: "3", signal: "/Controller/CAN_H", connection: "net"
    })
    expect(validateContract(hir, imported).find((d) => d.code === "HK-IFC-004")).toMatchObject({
      target: "connector:J1.pin:3"
    })
    expect(contractJson(imported)).not.toMatch(/voltage|electricalRole/)
  })

  it("ignores export timestamps and object order while fingerprinting interface changes", () => {
    const original = importKiCadNetlistPinout(fixture, meta)!
    const netLines = fixture.match(/^    \(net .*$/gm)!
    const reordered = fixture.replace(netLines.join("\n"), [...netLines].reverse().join("\n"))
      .replace('(date "2026-09-05")', '(date "2026-09-06")')
    expect(contractJson(importKiCadNetlistPinout(reordered, meta)!)).toBe(contractJson(original))
    const changed = importKiCadNetlistPinout(fixture.replace('"CAN_H"', '"CAN_L"'), meta)!
    expect(changed.source?.contentFingerprint).not.toBe(original.source?.contentFingerprint)
  })

  it("deduplicates identical nodes but rejects conflicting duplicate assignments", () => {
    const node = '(node (ref "BOARD_J7") (pin "3") (pintype "passive"))'
    expect(importKiCadNetlistPinout(fixture.replace(node, `${node} ${node}`), meta)?.pinout).toHaveLength(8)
    expect(() => importKiCadNetlistPinout(fixture.replace('(pin "4") (pintype "passive")))', `(pin "4") (pintype "passive")) ${node})`), meta))
      .toThrow(/pin 3 has conflicting net/)
    expect(() => importKiCadNetlistPinout(fixture.replace('(code "4")', '(code "3")'), meta))
      .toThrow(/net code 3 has conflicting names/)
  })

  it("reports missing and malformed inventory rather than silently dropping unconnected pins", () => {
    expect(importKiCadNetlistPinout(fixture, { connector: "MISSING" })).toBeUndefined()
    expect(() => importKiCadNetlistPinout(fixture.replace('(lib "NerveTest") (part "MotorConnector")', '(lib "Missing") (part "MotorConnector")'), meta))
      .toThrow(/requires one library pin inventory/)
    expect(() => importKiCadNetlistPinout(fixture.replace('(node (ref "BOARD_J7") (pin "3")', '(node (ref "BOARD_J7") (pin "30")'), meta))
      .toThrow(/node pin 30 is absent/)
    expect(() => importKiCadNetlistPinout(fixture.replace('(node (ref "BOARD_J7") (pin "3")', '(node (ref "BOARD_J7")'), meta))
      .toThrow(/non-empty pin/)
    expect(() => importKiCadNetlistPinout('(export (version "E") (components) (nets))', meta))
      .toThrow(/requires components, libparts, and nets/)
    expect(() => importKiCadNetlistPinout('(kicad_sch (version 20250114))', meta))
      .toThrow(/--format kicadsexpr/)
  })

  it("does not mistake literal quoted parentheses for syntax and rejects incomplete strings", () => {
    expect(importKiCadNetlistPinout(fixture.replace('"CAN_H"', '")"'), meta)?.pinout.find((p) => p.pin === "3")?.signal)
      .toBe(")")
    expect(() => importKiCadNetlistPinout('(export (version "E)', meta)).toThrow(/Unterminated quoted string/)
    expect(() => importKiCadNetlistPinout(fixture.slice(0, -2), meta)).toThrow(/Unclosed expression/)
    expect(() => importKiCadNetlistPinout(`${fixture} (extra)`, meta)).toThrow(/Unexpected content/)
  })

  it("accepts an explicit MPN override without treating the symbol value as a manufacturer part", () => {
    expect(importKiCadNetlistPinout(fixture, { ...meta, mpn: "OVERRIDE" })?.mpn).toBe("OVERRIDE")
    expect(importKiCadNetlistPinout(fixture.replace('(fields (field (name "Manufacturer Part Number") "43020-0800"))', ''), meta)?.mpn)
      .toBe("unknown")
  })
})

describe("KiCad board import integrity", () => {
  it("reads KiCad 10 name-only pad nets alongside older code-and-name assignments", () => {
    // KiCad 10.0 pcb_io_kicad_sexpr.cpp writes pad nets as (net "name").
    const current = board.replace(/\(net \d+ ("[^"]*")\)/g, '(net $1)')
    expect(importKiCadPcbPinout(current, meta)?.pinout).toEqual(importKiCadPcbPinout(board, meta)?.pinout)
    expect(validateContract(hir, importKiCadPcbPinout(current, meta)!)).toEqual([])
  })

  it("deduplicates repeated physical pads with the same number and net", () => {
    const pad = board.match(/^    \(pad "3".*$/m)![0]
    expect(importKiCadPcbPinout(board.replace(pad, `${pad}\n${pad}`), meta)?.pinout).toHaveLength(8)
    expect(() => importKiCadPcbPinout(board.replace(pad, `${pad}\n${pad.replace('"CAN_H"', '"CAN_L"')}`), meta))
      .toThrow(/conflicting net assignments on duplicate pad 3/)
  })

  it("uses explicit board pin-type metadata for no-connects instead of an autogenerated net name", () => {
    const nc = board.replace('(net 3 "CAN_H")', '(net "unconnected-(BOARD_J7-Pad3)") (pintype "passive+no_connect")')
    expect(importKiCadPcbPinout(nc, meta)?.pinout.find((pin) => pin.pin === "3")).toEqual({
      pin: "3", sourcePin: "3", connection: "unconnected"
    })
  })

  it("describes unassigned board pads without claiming a schematic NC flag", () => {
    const imported = importKiCadPcbPinout(board.replace(' (net 3 "CAN_H")', ''), meta)!
    const diagnostic = validateContract(hir, imported).find((d) => d.code === "HK-IFC-006")!
    expect(diagnostic.message).toContain("has no assigned connection in the source")
    expect(diagnostic.message).not.toContain("explicit")
  })
})

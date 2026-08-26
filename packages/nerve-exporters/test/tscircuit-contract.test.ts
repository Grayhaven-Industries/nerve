/**
 * PRD §37: import connector pinouts from tscircuit Circuit JSON and
 * validate the harness against the PCB. Fixture mirrors the shapes from
 * circuit-json@0.0.433 (source_component + source_port with port_hints).
 */
import { describe, expect, it } from "vitest"
import { compileDesign } from "@grayhaven/nerve"
import {
  exportTscircuitCircuitJson,
  importTscircuitPinout,
  validateContract,
  type TscircuitElement
} from "../src/contracts.js"
import motor from "../../../examples/motor-controller/src/main.harness.js"

const board = (signals: ReadonlyArray<string>): Array<TscircuitElement> => [
  { type: "source_component", ftype: "simple_chip", source_component_id: "sc1", name: "J1", manufacturer_part_number: "43020-0800" },
  { type: "source_component", ftype: "simple_chip", source_component_id: "sc2", name: "U1" },
  ...signals.map((sig, i): TscircuitElement => ({
    type: "source_port",
    source_port_id: `sp${i}`,
    source_component_id: "sc1",
    name: `pin${i + 1}`,
    pin_number: i + 1,
    port_hints: [sig, `pin${i + 1}`, String(i + 1)]
  })),
  // noise from another component must be ignored
  { type: "source_port", source_port_id: "spx", source_component_id: "sc2", name: "pin1", pin_number: 1, port_hints: ["XTAL"] }
]

const MOTOR_SIGNALS = ["VBAT_24V", "GND", "CAN_H", "CAN_L", "ENC_A", "ENC_B", "MOTOR_TEMP", "SHIELD_DRAIN"]

describe("tscircuit Circuit JSON contract import (PRD §37)", () => {
  it("extracts the named component's pinout with signals from port_hints", () => {
    const contract = importTscircuitPinout(board(MOTOR_SIGNALS), { connector: "J1" })
    expect(contract?.mpn).toBe("43020-0800")
    expect(contract?.pinout).toHaveLength(8)
    expect(contract?.pinout[0]).toEqual({ pin: "1", signal: "VBAT_24V" })
    expect(contract?.pinout.some((p) => p.signal === "XTAL")).toBe(false)
  })

  it("a matching PCB validates clean against the harness", () => {
    const { hir } = compileDesign(motor)
    const contract = importTscircuitPinout(board(MOTOR_SIGNALS), { connector: "J1" })!
    expect(validateContract(hir, contract)).toEqual([])
  })

  it("a swapped pin on the PCB is caught (the §37 headline case)", () => {
    const { hir } = compileDesign(motor)
    const swapped = [...MOTOR_SIGNALS]
    ;[swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!] // CAN_H <-> CAN_L
    const contract = importTscircuitPinout(board(swapped), { connector: "J1" })!
    const diags = validateContract(hir, contract)
    expect(diags.length).toBeGreaterThan(0)
    expect(JSON.stringify(diags)).toContain("CAN")
  })

  it("returns undefined for unknown components; --component can target a different refdes", () => {
    expect(importTscircuitPinout(board(MOTOR_SIGNALS), { connector: "J9" })).toBeUndefined()
    const aliased = importTscircuitPinout(board(MOTOR_SIGNALS), { connector: "J1", component: "J1" })
    expect(aliased?.connector).toBe("J1")
  })
})

describe("tscircuit Circuit JSON export (reverse direction)", () => {
  it("round-trips: our export -> our import -> clean validation", () => {
    const { hir } = compileDesign(motor)
    const circuitJson = exportTscircuitCircuitJson(hir, "J1")
    expect(circuitJson.filter((el) => el["type"] === "source_component")).toHaveLength(1)
    expect(circuitJson.filter((el) => el["type"] === "source_port")).toHaveLength(8)
    const contract = importTscircuitPinout(circuitJson, { connector: "J1" })!
    expect(validateContract(hir, contract)).toEqual([])
  })

  it("is deterministic and exports every connector when unscoped", () => {
    const { hir } = compileDesign(motor)
    const a = JSON.stringify(exportTscircuitCircuitJson(hir))
    expect(JSON.stringify(exportTscircuitCircuitJson(hir))).toBe(a)
    expect(exportTscircuitCircuitJson(hir).filter((el) => el["type"] === "source_component")).toHaveLength(2)
  })
})

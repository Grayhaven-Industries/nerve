import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { compileDesign } from "@grayhaven/nerve"
import {
  analyzeHarness,
  analysisCsv,
  contractJson,
  exportConnectorContract,
  findContractImporter,
  genericCutStripCsv,
  genericLabelPrinterCsv,
  genericTesterJson,
  importPinoutCsv,
  importKiCadPcbPinout,
  validateContract
} from "@grayhaven/nerve-exporters"
import motor from "../../../examples/motor-controller/src/main.harness.js"
import robot from "../../../examples/robot-platform/src/main.harness.js"

const { hir } = compileDesign(robot)
const { hir: motorHir } = compileDesign(motor)

describe("engineering analysis (PRD §34)", () => {
  const report = analyzeHarness(hir)

  it("computes per-wire resistance from gauge and length", () => {
    const w = report.wires.find((x) => x.id === "W_BAT_P")!
    // 12AWG, 80mm → 0.00521 Ω/m × 0.08 m
    expect(w.resistanceOhms).toBeCloseTo(0.0004, 4)
  })

  it("estimates bundle diameter per branch and harness totals", () => {
    const spine = report.branches.find((b) => b.id === "spine")!
    expect(spine.wireCount).toBeGreaterThan(3)
    expect(spine.bundleDiameterMm).toBeGreaterThan(5)
    expect(report.totals.wireLengthM).toBeGreaterThan(10)
    expect(report.totals.estimatedWeightG).toBeGreaterThan(50)
  })

  it("aggregates current across splices and reports voltage drop when current is known", () => {
    const { hir: withCurrent } = compileDesign({
      ...motor,
      wires: motor.wires.map((w) =>
        w.id === "W1" ? { ...w, currentEstimate: 4 } : w
      )
    })
    const r = analyzeHarness(withCurrent)
    const w1 = r.wires.find((x) => x.id === "W1")!
    // 20AWG 0.42m → 0.014 Ω; ×4A ≈ 0.056V
    expect(w1.voltageDropV).toBeCloseTo(0.056, 2)
  })

  it("is deterministic and exports CSV", () => {
    expect(analyzeHarness(hir)).toEqual(report)
    expect(analysisCsv(hir)).toContain("harness,total wire length")
  })
})

describe("shop-floor adapters (PRD §31)", () => {
  it("cut/strip adapter emits rows with revision metadata and HIR refs", () => {
    const { files, diagnostics } = genericCutStripCsv.generate(hir)
    const csv = files.get("cut-strip.machine.csv")!
    expect(csv).toContain("# revision: A")
    expect(csv).toContain("wire:W_BAT_P")
    expect(diagnostics.every((diagnostic) => diagnostic.code === "HK-ADAPT-005")).toBe(true)
  })

  it("skips unbuildable rows with structured diagnostics, not throws", () => {
    // Motor fixture: W3/W4 have no length → two warnings, rows skipped.
    const { files, diagnostics } = genericCutStripCsv.generate(motorHir)
    expect(diagnostics.filter((d) => d.code === "HK-ADAPT-002")).toHaveLength(2)
    expect(diagnostics.filter((d) => d.code === "HK-ADAPT-005")).toHaveLength(2)
    expect(files.get("cut-strip.machine.csv")).not.toContain("W3,")
  })

  it("uses declared asymmetric strips and copper allowances without defaults", () => {
    const explicit = {
      ...motorHir,
      wires: motorHir.wires.map((wire) =>
        wire.id === "W1"
          ? {
              ...wire,
              length: 100,
              serviceLoop: 12,
              terminationAllowance: { from: 3, to: 4 },
              stripLength: { from: 4.5, to: 7.25 }
            }
          : wire
      )
    }
    const { files, diagnostics } = genericCutStripCsv.generate(explicit)
    const rows = files.get("cut-strip.machine.csv")!.split("\n")
    const w1 = rows.find((row) => row.startsWith("W1,"))!.split(",")
    const w2 = rows.find((row) => row.startsWith("W2,"))!.split(",")

    expect(w1).toEqual([
      "W1",
      "20AWG",
      "red",
      "119",
      "",
      "4.5",
      "7.25",
      "1",
      "wire:W1"
    ])
    expect(w2[5]).toBe("")
    expect(w2[6]).toBe("")
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "HK-ADAPT-005", target: "wire:W1" })
    )
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: "HK-ADAPT-005", target: "wire:W2" })
    )
  })

  it("label printer and tester adapters emit per-object rows", () => {
    const labels = genericLabelPrinterCsv.generate(hir)
    expect(labels.files.get("labels.machine.csv")).toContain("L1,GH-R1 SPINE,1")
    const tester = genericTesterJson.generate(hir)
    const program = JSON.parse(tester.files.get("tester.program.json")!)
    expect(program.revision).toBe("A")
    expect(program.steps.length).toBeGreaterThan(50)
    expect(program.steps[0]).toMatchObject({ mode: "continuity" })
    expect(program.steps[0]).not.toHaveProperty("thresholdOhms")
    expect(tester.files.get("tester.program.json")).not.toMatch(/maxOhms|minOhms/)
  })

  it("rejects unknown HIR schema versions", () => {
    // SAFETY: the test feeds a schema version the HIR type cannot name, so the
    // adapter's runtime version check is what rejects it.
    const future = { ...hir, schemaVersion: "9.9.9" as never }
    const { diagnostics } = genericTesterJson.generate(future)
    expect(diagnostics[0]?.code).toBe("HK-ADAPT-001")
  })
})

describe("interface contracts (PRD §37)", () => {
  const contract = exportConnectorContract(motorHir, "J1")!
  const kicadFixturePath = resolve(import.meta.dirname, "fixtures/controller.kicad_pcb")
  const kicadFixture = readFileSync(kicadFixturePath, "utf8")

  it("exports the harness-side pinout with revision metadata", () => {
    expect(contract.mpn).toBe("43025-0800")
    expect(contract.harness).toEqual({ id: "motor-controller-harness", revision: "A" })
    expect(contract.pinout.find((p) => p.pin === "3")?.signal).toBe("CAN_H")
  })

  it("a harness validates against its own exported contract", () => {
    expect(validateContract(motorHir, contract)).toEqual([])
  })

  it("detects swapped pins between PCB and harness (the §37 headline case)", () => {
    const swapped = {
      ...contract,
      pinout: contract.pinout.map((p) =>
        p.pin === "3" ? { ...p, signal: "CAN_L" } : p.pin === "4" ? { ...p, signal: "CAN_H" } : p
      )
    }
    const diags = validateContract(motorHir, swapped)
    expect(diags.map((d) => d.code)).toEqual(["HK-IFC-004", "HK-IFC-004"])
    expect(diags[0]?.message).toContain("Nerve J1.3 carries CAN_H, but contract pad 3 requires CAN_L")
  })

  it("detects missing and extra pins, and imports pinout CSV", () => {
    const fromCsv = importPinoutCsv("pin,signal\n1,VBAT_24V\n2,GND\n9,MYSTERY\n", {
      connector: "J1",
      mpn: "43025-0800"
    })
    const diags = validateContract(motorHir, fromCsv)
    const codes = diags.map((d) => d.code)
    expect(codes).toContain("HK-IFC-003") // contract pin 9 missing from harness
    expect(codes).toContain("HK-IFC-005") // harness pins 3-8 uncovered
  })

  it("imports connector pad nets from a KiCad 6+ board without inferring schematic geometry", () => {
    const board = `(kicad_pcb
      (version 20250114)
      (generator pcbnew)
      (footprint "Connector:MicroFit"
        (layer "F.Cu")
        (property "Reference" "J1")
        (property "Manufacturer Part Number" "43025-0800")
        (pad "1" thru_hole circle (at 0 0) (size 1 1) (layers "*.Cu") (net 1 "VBAT_24V"))
        (pad "2" thru_hole circle (at 2 0) (size 1 1) (layers "*.Cu") (net 2 "GND"))
        (pad "3" thru_hole circle (at 4 0) (size 1 1) (layers "*.Cu") (net 3 "CAN_L"))
      )
    )`
    const imported = importKiCadPcbPinout(board, { connector: "J1" })
    expect(imported).toMatchObject({
      connector: "J1",
      mpn: "43025-0800",
      pinout: [
        { pin: "1", signal: "VBAT_24V" },
        { pin: "2", signal: "GND" },
        { pin: "3", signal: "CAN_L" }
      ]
    })
    expect(validateContract(motorHir, imported!).map((d) => d.code)).toContain("HK-IFC-004")
  })

  it("imports a committed KiCad fixture with revision, component, and content provenance", () => {
    const importer = findContractImporter(kicadFixturePath)
    expect(importer?.id).toBe("kicad-pcb")
    const imported = importer?.import(kicadFixture, {
      connector: "J1",
      component: "BOARD_J7",
      sourceName: "controller.kicad_pcb"
    })
    expect(imported).toMatchObject({
      harness: { id: "kicad-pcb", revision: "A" },
      connector: "J1",
      mpn: "43020-0800",
      source: {
        format: "kicad-pcb",
        name: "controller.kicad_pcb",
        component: "BOARD_J7",
        designRevision: "A",
        formatVersion: "20250114",
        generator: "pcbnew 9.0.2"
      }
    })
    expect(imported?.source?.contentFingerprint).toMatch(/^fnv1a64:[0-9a-f]{16}$/)
    expect(imported?.pinout.map((pin) => pin.pin)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"])
    expect(validateContract(motorHir, imported!)).toEqual([])
    expect(contractJson(imported!)).toBe(contractJson(imported!))
  })

  it("keeps normalized pin order and diagnostics stable when KiCad pad objects are reordered", () => {
    const ascendingPads = [...kicadFixture.matchAll(/^    \(pad .*$/gm)]
      .map((match) => match[0])
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const reordered = kicadFixture.replace(
      /^    \(pad .*$(?:\n^    \(pad .*$)*/gm,
      ascendingPads.join("\n")
    )
    const meta = { connector: "J1", component: "BOARD_J7" }
    const original = importKiCadPcbPinout(kicadFixture, meta)!
    const sorted = importKiCadPcbPinout(reordered, meta)!
    expect(contractJson(sorted)).toBe(contractJson(original))
    expect(validateContract(motorHir, sorted)).toEqual(validateContract(motorHir, original))
  })

  it("reports the Nerve target and exact KiCad component/pad for swaps and no-connects", () => {
    const swapped = importKiCadPcbPinout(
      kicadFixture.replace('(net 3 "CAN_H")', '(net 3 "CAN_L")'),
      { connector: "J1", component: "BOARD_J7" }
    )!
    const swapDiagnostic = validateContract(motorHir, swapped).find((d) => d.code === "HK-IFC-004")
    expect(swapDiagnostic).toMatchObject({ target: "connector:J1.pin:3" })
    expect(swapDiagnostic?.message).toContain("kicad-pcb component BOARD_J7 pad 3")

    const noConnect = importKiCadPcbPinout(
      kicadFixture.replace(' (net 3 "CAN_H")', ""),
      { connector: "J1", component: "BOARD_J7" }
    )!
    expect(noConnect.pinout.find((pin) => pin.pin === "3")).toMatchObject({
      connection: "unconnected",
      sourcePin: "3"
    })
    expect(validateContract(motorHir, noConnect).map((d) => d.code)).toContain("HK-IFC-006")
  })

  it("covers missing, extra populated, and connector-part mismatches from KiCad", () => {
    const missingPad = importKiCadPcbPinout(
      kicadFixture.replace(/^    \(pad "8".*\n/m, ""),
      { connector: "J1", component: "BOARD_J7" }
    )!
    expect(validateContract(motorHir, missingPad).map((d) => d.code)).toContain("HK-IFC-005")

    const extraPad = importKiCadPcbPinout(
      kicadFixture.replace(
        "  )\n)",
        '    (pad "9" thru_hole circle (at 12 3) (size 1.5 1.5) (layers "*.Cu") (net 9 "EXTRA_POPULATED"))\n  )\n)'
      ),
      { connector: "J1", component: "BOARD_J7" }
    )!
    expect(validateContract(motorHir, extraPad).map((d) => d.code)).toContain("HK-IFC-003")

    const wrongPart = importKiCadPcbPinout(
      kicadFixture.replaceAll("43020-0800", "WRONG-PCB-PART"),
      { connector: "J1", component: "BOARD_J7" }
    )!
    expect(validateContract(motorHir, wrongPart).map((d) => d.code)).toContain("HK-IFC-002")
  })

  it("supports the legacy fp_text reference form used by earlier KiCad 6+ boards", () => {
    const board = `(kicad_pcb (version 20221018) (generator pcbnew)
      (footprint "Connector:One" (layer "F.Cu")
        (fp_text reference "BOARD_J7" (at 0 0) (layer "F.SilkS"))
        (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu") (net 1 "GND"))))`
    expect(
      importKiCadPcbPinout(board, { connector: "J1", component: "BOARD_J7" })?.pinout
    ).toEqual([{ pin: "1", signal: "GND", connection: "net", sourcePin: "1" }])
  })
})

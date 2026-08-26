import { utils, write } from "@e965/xlsx"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { compileDesign } from "@grayhaven/nerve"
import { describe, expect, it } from "vitest"
import { importWireList, normalizeWireListColumnMap, parseCsvWireList, parseXlsxWireList, wireListColumnMapJson } from "@grayhaven/nerve-importers"

const mapping = {
  wireId: "Wire",
  fromConnector: "From",
  fromPin: "From Pin",
  toConnector: "To",
  toPin: "To Pin",
  signal: "Signal",
  gauge: "Gauge",
  color: "Color",
  length: "Length",
  lengthUnit: "Unit",
  fromMpn: "From MPN",
  toMpn: "To MPN"
} as const

const csv = `Wire,From,From Pin,To,To Pin,Signal,Gauge,Color,Length,Unit,From MPN,To MPN
W1,J1,1,J2,1,PWR_12V,18AWG,red,10,in,A-2,B-2
W2,J1,2,J2,2,GND,18AWG,black,254,mm,A-2,B-2
`

describe("wire-list import", () => {
  it("converts committed common and edge-case fixtures with every row accounted for", () => {
    const fixtureDir = resolve(import.meta.dirname, "fixtures")
    const fixtureMapping = normalizeWireListColumnMap(
      JSON.parse(readFileSync(resolve(fixtureDir, "column-map.json"), "utf8"))
    )
    const common = importWireList(
      parseCsvWireList(readFileSync(resolve(fixtureDir, "wire-list.csv"), "utf8")),
      fixtureMapping,
      { harnessId: "fixture" }
    )
    expect(common.report).toMatchObject({ accepted: 2, rejected: 0 })
    expect(common.report.rows).toHaveLength(2)

    const edge = importWireList(
      parseCsvWireList(readFileSync(resolve(fixtureDir, "edge-cases.csv"), "utf8")),
      fixtureMapping,
      { harnessId: "edge" }
    )
    expect(edge.report).toMatchObject({ accepted: 2, rejected: 2 })
    expect(edge.report.rows).toHaveLength(4)
    expect(edge.report.rows.map((row) => row.diagnostics)).toEqual([
      [],
      ["HK-IMPORT-003"],
      [],
      ["HK-IMPORT-002"]
    ])
    expect(edge.source).toContain('.pin("A1")')
    expect(edge.source).toContain('.pin("B7")')
    expect(compileDesign(edge.design!).hir.wires.map((wire) => wire.id)).toEqual(["W-A", "W-C"])
    expect(edge.diagnostics.find((diagnostic) => diagnostic.code === "HK-IMPORT-002")?.data).toEqual({
      sourceRow: 5,
      sourceColumn: "From Pin"
    })
  })

  it("normalizes reusable mapping JSON and rejects ambiguous fields", () => {
    const normalized = normalizeWireListColumnMap({
      toPin: " To Pin ",
      fromPin: "From Pin",
      toConnector: "To",
      fromConnector: "From"
    })
    expect(wireListColumnMapJson(normalized)).toBe(`{
  "fromConnector": "From",
  "fromPin": "From Pin",
  "toConnector": "To",
  "toPin": "To Pin"
}\n`)
    expect(() => normalizeWireListColumnMap({ ...normalized, guessedSafety: "Class" })).toThrow(
      "Unknown column-map field"
    )
  })

  it("emits deterministic, reviewable source and accounts for every row", () => {
    const table = parseCsvWireList(csv)
    const a = importWireList(table, mapping, { harnessId: "migrated", sourceName: "legacy.csv" })
    const b = importWireList(table, mapping, { harnessId: "migrated", sourceName: "legacy.csv" })
    expect(a.source).toBe(b.source)
    expect(a.diagnostics).toEqual(b.diagnostics)
    expect(a.report).toEqual(b.report)
    expect(compileDesign(a.design!).hir).toEqual(compileDesign(b.design!).hir)
    expect(a.report).toMatchObject({ accepted: 2, rejected: 0 })
    expect(a.source).toContain("// source row 2")
    expect(a.source).toContain('length: 254')
    expect(a.source).toContain('verification: "unverified"')
    const compiled = compileDesign(a.design!).hir
    expect(compiled.wires.map((wire) => wire.id)).toEqual(["W1", "W2"])
    expect(compiled.wires[0]).toMatchObject({
      id: "W1",
      from: { connector: "J1", pin: "1" },
      to: { connector: "J2", pin: "1" },
      signal: "PWR_12V",
      gauge: "18AWG",
      color: "red",
      length: 254
    })
  })

  it("rejects malformed and duplicate rows without dropping them silently", () => {
    const table = parseCsvWireList(csv + "W2,J1,,J2,2,GND,18AWG,black,nope,mm,A-2,B-2\n")
    const result = importWireList(table, mapping)
    expect(result.report.rows).toHaveLength(3)
    expect(result.report).toMatchObject({ accepted: 2, rejected: 1 })
    expect(result.diagnostics.map((d) => d.code)).toContain("HK-IMPORT-002")
  })

  it("reads a selected XLSX worksheet through the same pure converter", () => {
    const workbook = utils.book_new()
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([["ignore"], ["x"]]), "Notes")
    utils.book_append_sheet(
      workbook,
      utils.aoa_to_sheet([
        Object.values(mapping),
        ["W1", "J1", "1", "J2", "1", "SIG", "20AWG", "white", 100, "mm", "A", "B"]
      ]),
      "Wire List"
    )
    // `write` is typed `any`; with `type: "array"` it returns the workbook bytes.
    const bytes: Uint8Array = write(workbook, { type: "array", bookType: "xlsx" })
    const parsed = parseXlsxWireList(bytes, "Wire List")
    expect(parsed.rows).toHaveLength(1)
    expect(importWireList(parsed, mapping).report.accepted).toBe(1)
  })

  it("does not invent a signal when the source leaves it blank", () => {
    const result = importWireList(
      parseCsvWireList(
        `From,From Pin,To,To Pin\nJ1,1,J2,1\n`
      ),
      {
        fromConnector: "From",
        fromPin: "From Pin",
        toConnector: "To",
        toPin: "To Pin"
      }
    )
    expect(result.source).not.toContain("UNASSIGNED_")
    expect(result.design?.connectors[0]?.pins).toEqual({})
  })

  it("fails when an explicitly mapped optional column is absent", () => {
    const result = importWireList(parseCsvWireList("From,From Pin,To,To Pin\nJ1,1,J2,1\n"), {
      fromConnector: "From",
      fromPin: "From Pin",
      toConnector: "To",
      toPin: "To Pin",
      signal: "Signal"
    })
    expect(result.design).toBeUndefined()
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("HK-IMPORT-001")
    expect(result.report.rows).toEqual([
      { row: 2, status: "rejected", diagnostics: ["HK-IMPORT-001"] }
    ])
  })

  it("rejects unknown length units instead of treating the value as the target unit", () => {
    const result = importWireList(
      parseCsvWireList("From,From Pin,To,To Pin,Length,Unit\nJ1,1,J2,1,10,cm\n"),
      {
        fromConnector: "From",
        fromPin: "From Pin",
        toConnector: "To",
        toPin: "To Pin",
        length: "Length",
        lengthUnit: "Unit"
      }
    )
    expect(result.report).toMatchObject({ accepted: 0, rejected: 1 })
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("HK-IMPORT-006")
  })

  it("does not mutate accepted connector data when a later row conflicts", () => {
    const result = importWireList(
      parseCsvWireList(
        "Wire,From,From Pin,To,To Pin,Signal,From MPN,To MPN\nW1,J1,1,J2,1,SIG,A,B\nW2,J1,1,J3,1,OTHER,A,C\n"
      ),
      {
        wireId: "Wire",
        fromConnector: "From",
        fromPin: "From Pin",
        toConnector: "To",
        toPin: "To Pin",
        signal: "Signal",
        fromMpn: "From MPN",
        toMpn: "To MPN"
      }
    )
    expect(result.report).toMatchObject({ accepted: 1, rejected: 1 })
    expect(result.design?.connectors.map((connector) => connector.ref)).toEqual(["J1", "J2"])
    expect(result.source).not.toContain('connector("J3"')
  })
})

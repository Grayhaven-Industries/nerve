import { describe, expect, it } from "vitest"
import {
  importWireList,
  parseCsvWireList,
  type WireListColumnMap
} from "@grayhaven/nerve-importers"
import {
  assembleSourceSet,
  assertIsolatedJob,
  assertRowAccountingComplete,
  buildImportReport,
  IngestionError,
  IngestionErrorCode,
  resolveContentStorage,
  unmappedColumnUnknowns,
  wireListFileImport,
  type IngestionJobPreconditions,
  type SourceSetAssemblyInput,
  type UploadedFile
} from "../src/ingestion.js"

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)

const isolated: IngestionJobPreconditions = {
  malwareScan: "clean",
  scannerVersion: "clamav-1.4.1",
  scannedAt: "2026-01-02T03:04:05Z",
  networkAccessDisabled: true
}

const columnMap: WireListColumnMap = {
  fromConnector: "From",
  fromPin: "FromPin",
  toConnector: "To",
  toPin: "ToPin"
}

const csvText = ["From,FromPin,To,ToPin,Notes", "J1,1,J2,1,keep me", ",2,J2,2,no source"].join(
  "\n"
)

const csvUpload: UploadedFile = {
  filename: "wires.csv",
  mediaType: "text/csv",
  bytes: bytes(csvText),
  kind: "csv",
  importAdapterVersion: "wire-list@7.0.0",
  mappingVersion: "map-2026-01",
  columnMap,
  uploadedBy: "user:ada",
  uploadedAt: "2026-01-02T03:05:00Z"
}

const sourceUpload: UploadedFile = {
  filename: "harness.nerve.ts",
  mediaType: "text/typescript",
  bytes: bytes("export default harness('H1', {})\n"),
  kind: "nerve-source",
  importAdapterVersion: "nerve@7.0.0",
  uploadedBy: "user:grace",
  uploadedAt: "2026-01-02T03:06:00Z"
}

const assembly = (
  uploads: ReadonlyArray<UploadedFile>,
  overrides: Partial<SourceSetAssemblyInput> = {}
): SourceSetAssemblyInput => ({
  id: "srcset-1",
  harnessId: "harness-1",
  uploads,
  dependencyVersions: { compiler: "7.0.0", "rules-automotive": "2.1.0" },
  interfaceContracts: ["contract:ecu-a", "contract:body"],
  preconditions: isolated,
  createdAt: "2026-01-02T03:07:00Z",
  ...overrides
})

describe("source-set identity (ING-006, §9.1 step 5)", () => {
  it("is unchanged when the same files are uploaded in a different order", () => {
    const forward = assembleSourceSet(assembly([csvUpload, sourceUpload]))
    const reversed = assembleSourceSet(assembly([sourceUpload, csvUpload]))
    expect(reversed.sourceSet.fingerprint).toBe(forward.sourceSet.fingerprint)
    expect(reversed.sourceSet.files.map((file) => file.filename)).toEqual(
      forward.sourceSet.files.map((file) => file.filename)
    )
  })

  it("is unchanged when files sharing a name and bytes are uploaded in a different order", () => {
    // Same file re-read under a second saved mapping: filename and contentHash
    // tie, so only a comparator covering the rest of the hashed identity keeps
    // upload order out of the fingerprint.
    const remapped: UploadedFile = { ...csvUpload, mappingVersion: "map-2026-02" }
    const forward = assembleSourceSet(assembly([csvUpload, remapped]))
    const reversed = assembleSourceSet(assembly([remapped, csvUpload]))
    expect(reversed.sourceSet.fingerprint).toBe(forward.sourceSet.fingerprint)
    expect(reversed.sourceSet.files.map((file) => file.mappingVersion)).toEqual(
      forward.sourceSet.files.map((file) => file.mappingVersion)
    )
  })

  it("is unchanged when interface contracts are listed in a different order", () => {
    const a = assembleSourceSet(assembly([csvUpload]))
    const b = assembleSourceSet(
      assembly([csvUpload], { interfaceContracts: ["contract:body", "contract:ecu-a"] })
    )
    expect(b.sourceSet.fingerprint).toBe(a.sourceSet.fingerprint)
  })

  it("records uploader identity without letting it fork the fingerprint", () => {
    const original = assembleSourceSet(assembly([csvUpload]))
    const reuploaded = assembleSourceSet(
      assembly([{ ...csvUpload, uploadedBy: "user:linus", uploadedAt: "2026-06-01T00:00:00Z" }])
    )
    expect(reuploaded.sourceSet.fingerprint).toBe(original.sourceSet.fingerprint)
    expect(reuploaded.sourceSet.files[0]?.uploadedBy).toBe("user:linus")
  })

  it("moves the fingerprint when the bytes move", () => {
    const original = assembleSourceSet(assembly([csvUpload]))
    const edited = assembleSourceSet(
      assembly([{ ...csvUpload, bytes: bytes(csvText + "\nJ3,1,J4,1,extra") }])
    )
    expect(edited.sourceSet.fingerprint).not.toBe(original.sourceSet.fingerprint)
  })

  /**
   * The other four inputs `sourceSetFingerprint` claims to cover (ING-006,
   * §9.1 step 5), one case each.
   *
   * §10.2 invalidates an approval when the reviewed content moves, and the
   * bytes are only one of the five things that can move: a compiler or
   * rule-pack bump, a re-parented harness, a changed interface claim, or a
   * re-mapped column all change what was reviewed without touching a byte. If
   * any of them fell out of the hash, the platform would hand a changed
   * submission the old identity and keep stale approvals alive — so each one
   * has to be able to fork the fingerprint on its own, not merely alongside
   * the bytes.
   *
   * The `harnessId` case carries a second load. `dispositionApplies`
   * (src/dispositions.ts, §9.3 step 5) deliberately does not compare
   * `scope.harnessId`, on the grounds that fingerprint equality already binds
   * a waiver to one harness's submission. That reasoning holds only while
   * `harnessId` is inside this hash, which is what this case pins.
   *
   * Table-driven with `it.each` and `$input` name interpolation, confirmed
   * against **vitest 4.1.10** (the version the workspace runs; this package
   * declares `^3.2.4`, where `it.each` has the same signature).
   */
  const movedIdentityInputs: ReadonlyArray<{
    readonly input: string
    readonly moved: SourceSetAssemblyInput
  }> = [
    {
      input: "a dependency version",
      moved: assembly([csvUpload], {
        dependencyVersions: { compiler: "7.0.1", "rules-automotive": "2.1.0" }
      })
    },
    {
      input: "the harness the submission belongs to",
      moved: assembly([csvUpload], { harnessId: "harness-2" })
    },
    {
      input: "the claimed interface contracts",
      moved: assembly([csvUpload], { interfaceContracts: ["contract:ecu-a"] })
    },
    {
      input: "a file's saved column map version",
      moved: assembly([{ ...csvUpload, mappingVersion: "map-2026-02" }])
    },
    {
      input: "a file's import adapter version",
      moved: assembly([{ ...csvUpload, importAdapterVersion: "wire-list@7.0.1" }])
    }
  ]

  it.each(movedIdentityInputs)("moves the fingerprint when $input moves", ({ moved }) => {
    const original = assembleSourceSet(assembly([csvUpload]))
    expect(assembleSourceSet(moved).sourceSet.fingerprint).not.toBe(
      original.sourceSet.fingerprint
    )
  })

  it("records the ING-006 provenance fields on every file", () => {
    const { sourceSet } = assembleSourceSet(assembly([csvUpload]))
    expect(sourceSet.files[0]).toMatchObject({
      filename: "wires.csv",
      mediaType: "text/csv",
      byteLength: csvUpload.bytes.byteLength,
      kind: "csv",
      importAdapterVersion: "wire-list@7.0.0",
      mappingVersion: "map-2026-01",
      uploadedBy: "user:ada"
    })
    expect(sourceSet.files[0]?.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/)
  })
})

describe("saved column maps (ING-003)", () => {
  it("refuses a CSV with no mapping version", () => {
    const { mappingVersion: _dropped, ...rest } = csvUpload
    expect(() => assembleSourceSet(assembly([rest]))).toThrowError(
      expect.objectContaining({ code: IngestionErrorCode.MissingColumnMap })
    )
  })

  it("refuses a CSV whose mapping version names no saved map", () => {
    const { columnMap: _dropped, ...rest } = csvUpload
    try {
      assembleSourceSet(assembly([rest]))
      expect.unreachable("assembly should refuse an unmapped CSV")
    } catch (error) {
      expect(error).toBeInstanceOf(IngestionError)
      if (!(error instanceof IngestionError)) throw error
      expect(error.code).toBe(IngestionErrorCode.MissingColumnMap)
      expect(error.filename).toBe("wires.csv")
    }
  })

  it("refuses an XLSX whose saved map is missing a required column", () => {
    expect(() =>
      assembleSourceSet(
        assembly([
          {
            ...csvUpload,
            filename: "wires.xlsx",
            kind: "xlsx",
            columnMap: { fromConnector: "From", fromPin: "FromPin" }
          }
        ])
      )
    ).toThrowError(expect.objectContaining({ code: IngestionErrorCode.InvalidColumnMap }))
  })

  it("does not demand a column map from adapters that carry their own schema", () => {
    expect(() => assembleSourceSet(assembly([sourceUpload]))).not.toThrow()
  })
})

describe("isolated job preconditions (ING-008)", () => {
  it("refuses an unscanned job", () => {
    expect(() => assertIsolatedJob({ ...isolated, malwareScan: "not-scanned" })).toThrowError(
      expect.objectContaining({ code: IngestionErrorCode.NotScanned })
    )
  })

  it("refuses infected content", () => {
    expect(() => assertIsolatedJob({ ...isolated, malwareScan: "infected" })).toThrowError(
      expect.objectContaining({ code: IngestionErrorCode.Infected })
    )
  })

  it("refuses a job that could still reach the network", () => {
    expect(() =>
      assertIsolatedJob({ ...isolated, networkAccessDisabled: false })
    ).toThrowError(expect.objectContaining({ code: IngestionErrorCode.NetworkEnabled }))
  })

  it("gates assembly before any file is hashed", () => {
    expect(() =>
      assembleSourceSet(
        assembly([csvUpload], { preconditions: { ...isolated, malwareScan: "not-scanned" } })
      )
    ).toThrowError(expect.objectContaining({ code: IngestionErrorCode.NotScanned }))
  })
})

describe("content-addressed storage (ING-007)", () => {
  it("stores new content once and reuses it on re-upload", () => {
    const first = resolveContentStorage([csvUpload])
    expect(first[0]?.disposition).toBe("stored-new")

    const known = new Map([[first[0]!.contentHash, first[0]!.storageRef]])
    const second = resolveContentStorage(
      [{ ...csvUpload, filename: "wires-copy.csv", uploadedBy: "user:linus" }],
      known
    )
    expect(second[0]?.disposition).toBe("reused")
    expect(second[0]?.storageRef).toBe(first[0]?.storageRef)
  })

  it("folds duplicate bytes inside one submission", () => {
    const resolved = resolveContentStorage([csvUpload, { ...csvUpload, filename: "again.csv" }])
    expect(resolved.map((entry) => entry.disposition)).toEqual(["stored-new", "reused"])
    expect(resolved[0]?.storageRef).toBe(resolved[1]?.storageRef)
  })

  it("mints no second revision for identical re-uploaded content", () => {
    const first = assembleSourceSet(assembly([csvUpload]))
    const known = new Map([
      [first.storage[0]!.contentHash, first.storage[0]!.storageRef]
    ])
    const second = assembleSourceSet(assembly([csvUpload], { knownContent: known }))
    expect(second.storage[0]?.disposition).toBe("reused")
    expect(second.storage[0]?.storageRef).toBe(first.storage[0]?.storageRef)
    expect(second.sourceSet.fingerprint).toBe(first.sourceSet.fingerprint)
  })
})

describe("row accounting (ING-004)", () => {
  const table = parseCsvWireList(csvText)
  const imported = importWireList(table, columnMap, { sourceName: "wires.csv" })

  it("accounts for every row of a real wire-list import", () => {
    const report = buildImportReport({
      files: [wireListFileImport("wires.csv", table, imported)]
    })
    expect(report.accounting).toMatchObject({
      complete: true,
      totalRows: 2,
      accepted: 1,
      rejected: 1,
      imbalances: []
    })
    expect(() => assertRowAccountingComplete(report)).not.toThrow()
  })

  it("carries column-level diagnostics onto the rejected row", () => {
    const report = buildImportReport({
      files: [wireListFileImport("wires.csv", table, imported)]
    })
    const rejected = report.files[0]?.rows.find((row) => row.status === "rejected")
    expect(rejected?.row).toBe(3)
    expect(rejected?.columns).toEqual([
      expect.objectContaining({ code: "HK-IMPORT-002", column: "From" })
    ])
  })

  it("fails loudly when a file's rows do not add up", () => {
    const report = buildImportReport({
      files: [
        {
          filename: "wires.csv",
          totalRows: 3,
          rows: [
            { row: 2, status: "accepted", diagnostics: [] },
            { row: 3, status: "rejected", diagnostics: ["HK-IMPORT-002"] }
          ]
        }
      ]
    })
    expect(report.accounting.complete).toBe(false)
    expect(report.accounting.imbalances).toEqual([
      { filename: "wires.csv", totalRows: 3, accepted: 1, rejected: 1, unaccounted: 1 }
    ])
    expect(() => assertRowAccountingComplete(report)).toThrowError(
      expect.objectContaining({ code: IngestionErrorCode.RowAccountingImbalance })
    )
  })

  it("keeps file-level diagnostics that name no row", () => {
    const missingMap = importWireList(table, { ...columnMap, fromConnector: "Absent" }, {
      sourceName: "wires.csv"
    })
    const report = buildImportReport({
      files: [wireListFileImport("wires.csv", table, missingMap)]
    })
    expect(report.accounting.complete).toBe(true)
    expect(report.accounting.rejected).toBe(2)
    expect(report.files[0]?.fileDiagnostics).toEqual([
      expect.objectContaining({ code: "HK-IMPORT-001" })
    ])
  })
})

describe("retained unknowns (ING-005)", () => {
  it("lists columns the saved map has nowhere to put", () => {
    const table = parseCsvWireList(csvText)
    expect(unmappedColumnUnknowns("wires.csv", table.headers, columnMap)).toEqual([
      { filename: "wires.csv", concept: "column", rawValue: "Notes", column: "Notes" }
    ])
  })

  it("carries unknowns into the report rather than discarding them", () => {
    const table = parseCsvWireList(csvText)
    const imported = importWireList(table, columnMap, { sourceName: "wires.csv" })
    const report = buildImportReport({
      files: [wireListFileImport("wires.csv", table, imported)],
      retainedUnknowns: [
        ...unmappedColumnUnknowns("wires.csv", table.headers, columnMap),
        {
          filename: "wires.csv",
          concept: "shield-class",
          rawValue: "braid+foil",
          row: 2,
          column: "Notes"
        }
      ]
    })
    expect(report.retainedUnknowns).toHaveLength(2)
    expect(report.retainedUnknowns[1]?.rawValue).toBe("braid+foil")
    // The unknowns are extra information, not a reason to lose a row.
    expect(report.accounting.complete).toBe(true)
  })
})

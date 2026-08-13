/**
 * Source ingestion (PRD §9.1 steps 2-5, §11.2 ING-003 … ING-008).
 *
 * This is the platform layer above `@grayhaven/nerve-importers`. The importers
 * know how to read a wire list; this module decides whether the job was
 * allowed to read anything at all (ING-008), whether the file arrived with the
 * saved mapping its adapter demands (ING-003), what identity the resulting
 * submission has (ING-006, §9.1 step 5), and whether the resulting report
 * accounts for every input row (ING-004) while keeping the concepts nobody
 * understood in plain sight (ING-005).
 *
 * Nothing here parses CSV, opens a workbook, or scans for malware. Parsing is
 * `@grayhaven/nerve-importers`; the scanner and the network-isolated sandbox
 * are the deployment layer's, and reach this module only as an already-decided
 * verdict it must check before proceeding.
 *
 * Effect Schema usage is confirmed against **effect 3.22.1** (declared
 * `^3.16.0` in this package): `Schema.decodeUnknownSync(S)(value)` validates
 * and throws `ParseError`.
 */
import { Schema } from "effect"
import type { Diagnostic } from "@grayhaven/nerve"
import type {
  ImportRowResult,
  ParsedWireList,
  WireListColumnMap,
  WireListImportResult
} from "@grayhaven/nerve-importers"
import { normalizeWireListColumnMap } from "@grayhaven/nerve-importers"
import { PLATFORM_SCHEMA_VERSION, SourceSet } from "./objects.js"
import type { SourceFile, SourceKind } from "./objects.js"
import { fingerprint, fingerprintBytes } from "./fingerprint.js"
import type { Canonical, Fingerprint } from "./fingerprint.js"

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Stable ingestion refusal codes. Each one names the requirement it enforces
 * so an operator reading a failed job sees which rule stopped it rather than a
 * prose message that drifts between releases.
 */
export const IngestionErrorCode = {
  /** ING-003: a `csv`/`xlsx` upload arrived with no saved column map. */
  MissingColumnMap: "ING-003-NO-COLUMN-MAP",
  /** ING-003: a saved column map exists but does not decode. */
  InvalidColumnMap: "ING-003-INVALID-COLUMN-MAP",
  /** ING-004: a file's accepted + rejected rows do not equal its input rows. */
  RowAccountingImbalance: "ING-004-ROW-ACCOUNTING",
  /** ING-006: the assembled source set failed its own schema. */
  InvalidSourceSet: "ING-006-INVALID-SOURCE-SET",
  /** ING-008: the job ran before a malware verdict existed. */
  NotScanned: "ING-008-NOT-SCANNED",
  /** ING-008: the scanner rejected the upload. */
  Infected: "ING-008-INFECTED",
  /** ING-008: the job could still reach the network. */
  NetworkEnabled: "ING-008-NETWORK-ENABLED"
} as const

export type IngestionErrorCode =
  (typeof IngestionErrorCode)[keyof typeof IngestionErrorCode]

/**
 * A hard refusal to ingest. These are deliberately thrown rather than
 * collected as warnings: ING-003 and ING-008 describe conditions where
 * continuing would produce a source set whose provenance is a guess, and a
 * guessed provenance is worse than no submission.
 */
export class IngestionError extends Error {
  readonly code: IngestionErrorCode
  /** File the refusal is about, when it is about one file. */
  readonly filename: string | undefined

  constructor(code: IngestionErrorCode, message: string, filename?: string) {
    super(message)
    this.name = "IngestionError"
    this.code = code
    this.filename = filename
  }
}

// ---------------------------------------------------------------------------
// ING-008 — isolated job preconditions
// ---------------------------------------------------------------------------

/**
 * What the scanner concluded. `not-scanned` is a first-class verdict rather
 * than an absent field so "we never looked" cannot be confused with "we looked
 * and it was fine" by a caller that forgot to set the flag.
 */
export const MalwareScanVerdict = {
  Clean: "clean",
  Infected: "infected",
  NotScanned: "not-scanned"
} as const

export type MalwareScanVerdict =
  (typeof MalwareScanVerdict)[keyof typeof MalwareScanVerdict]

/**
 * ING-008 preconditions for the isolated import job.
 *
 * This module never runs a scanner and never opens a socket. The real scanner
 * and the network-isolated sandbox are injected by the deployment layer, which
 * fills this record in; the platform's job is to refuse to proceed unless the
 * record says both controls actually applied. Scanner identity and time are
 * recorded because an evidence bundle has to state *which* scanner cleared the
 * bytes, not merely that something did.
 */
export interface IngestionJobPreconditions {
  readonly malwareScan: MalwareScanVerdict
  readonly scannerVersion: string
  readonly scannedAt: string
  /** True only when the job had no egress path while it read the files. */
  readonly networkAccessDisabled: boolean
}

/**
 * Enforce ING-008 before any byte is read. Throws rather than returning a
 * verdict because every caller's correct response is identical — stop.
 */
export const assertIsolatedJob = (
  preconditions: IngestionJobPreconditions
): void => {
  if (preconditions.malwareScan === MalwareScanVerdict.NotScanned) {
    throw new IngestionError(
      IngestionErrorCode.NotScanned,
      "Ingestion requires a malware scan verdict. The job has not been scanned."
    )
  }
  if (preconditions.malwareScan === MalwareScanVerdict.Infected) {
    throw new IngestionError(
      IngestionErrorCode.Infected,
      `Ingestion refused: scanner ${preconditions.scannerVersion} reported infected content at ${preconditions.scannedAt}.`
    )
  }
  if (!preconditions.networkAccessDisabled) {
    throw new IngestionError(
      IngestionErrorCode.NetworkEnabled,
      "Ingestion requires an isolated job with network access disabled."
    )
  }
}

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------

/**
 * Adapters that cannot read a file without a saved column map (ING-003).
 * Tabular formats carry no schema of their own, so an import without a mapping
 * would be the platform guessing which column meant "from pin".
 */
const MAPPED_KINDS: ReadonlySet<SourceKind> = new Set<SourceKind>(["csv", "xlsx"])

/** True when this adapter requires a saved column map (ING-003). */
export const requiresColumnMap = (kind: SourceKind): boolean =>
  MAPPED_KINDS.has(kind)

/**
 * One uploaded file, before it has an identity.
 *
 * `bytes` is here and `contentHash` is not: the hash is this module's to
 * compute, so a caller cannot hand in a digest that does not describe the
 * bytes it also handed in.
 */
export interface UploadedFile {
  readonly filename: string
  readonly mediaType: string
  readonly bytes: Uint8Array
  readonly kind: SourceKind
  readonly importAdapterVersion: string
  /** Required for `csv`/`xlsx` (ING-003). */
  readonly mappingVersion?: string | undefined
  /** The saved column map itself, validated against the importer's decoder. */
  readonly columnMap?: unknown
  readonly uploadedBy: string
  readonly uploadedAt: string
}

/**
 * ING-003, per file. A mapping *version* with no map is a dangling reference
 * and a map with no version cannot be cited in evidence, so both are required
 * together or the upload is refused.
 */
const assertColumnMap = (upload: UploadedFile): void => {
  if (!requiresColumnMap(upload.kind)) return
  if (upload.mappingVersion === undefined || upload.mappingVersion.trim() === "") {
    throw new IngestionError(
      IngestionErrorCode.MissingColumnMap,
      `${upload.filename} is a ${upload.kind} import and requires a saved column map version (ING-003).`,
      upload.filename
    )
  }
  if (upload.columnMap === undefined) {
    throw new IngestionError(
      IngestionErrorCode.MissingColumnMap,
      `${upload.filename} names column map version ${upload.mappingVersion} but no saved column map was supplied (ING-003).`,
      upload.filename
    )
  }
  try {
    normalizeWireListColumnMap(upload.columnMap)
  } catch (cause) {
    throw new IngestionError(
      IngestionErrorCode.InvalidColumnMap,
      `${upload.filename} has an unusable saved column map: ${cause instanceof Error ? cause.message : String(cause)}`,
      upload.filename
    )
  }
}

// ---------------------------------------------------------------------------
// ING-007 — content-addressed storage
// ---------------------------------------------------------------------------

/** Whether a file's bytes were already in storage, or were written now. */
export type StorageDisposition = "reused" | "stored-new"

/**
 * Where one upload's bytes live, and how they got there (ING-007).
 *
 * The disposition is returned rather than logged because "we already had this"
 * is the fact the caller acts on: a reused blob must not produce a second
 * revision of anything.
 */
export interface StorageResolution {
  readonly filename: string
  readonly contentHash: Fingerprint
  readonly storageRef: string
  readonly disposition: StorageDisposition
}

/**
 * Derive a storage reference from content alone.
 *
 * ING-007 says identical re-uploads must not mint an ambiguous mutable
 * revision. The cheapest way to keep that promise is to make the reference a
 * pure function of the bytes — there is no counter to increment, so there is
 * no second revision to be ambiguous about. The deployment layer maps this
 * reference onto a bucket key; it does not invent one.
 */
const storageRefFor = (contentHash: Fingerprint): string => `blob:${contentHash}`

/**
 * Resolve storage for a batch of uploads against already-known content
 * (ING-007).
 *
 * `known` maps a content hash to the reference the prior upload received, so a
 * deployment that stores blobs under its own keys keeps them. Duplicates
 * *within* one batch are folded too: uploading the same bytes twice in one
 * submission is the same event as uploading them twice in two.
 */
export const resolveContentStorage = (
  uploads: ReadonlyArray<UploadedFile>,
  known: ReadonlyMap<Fingerprint, string> = new Map()
): ReadonlyArray<StorageResolution> => {
  const seen = new Map<Fingerprint, string>(known)
  return uploads.map((upload) => {
    const contentHash = fingerprintBytes(upload.bytes)
    const existing = seen.get(contentHash)
    if (existing !== undefined) {
      return {
        filename: upload.filename,
        contentHash,
        storageRef: existing,
        disposition: "reused" as const
      }
    }
    const storageRef = storageRefFor(contentHash)
    seen.set(contentHash, storageRef)
    return {
      filename: upload.filename,
      contentHash,
      storageRef,
      disposition: "stored-new" as const
    }
  })
}

// ---------------------------------------------------------------------------
// ING-006 / §9.1 step 5 — source-set identity
// ---------------------------------------------------------------------------

/**
 * Order files by filename, then content hash.
 *
 * Upload order is an accident of how the browser queued the files; it must not
 * fork the identity of the submission. Comparison is by code unit rather than
 * `localeCompare` because the collation available at runtime is not part of
 * the contract, and the fingerprint has to be reproducible on any host.
 */
export const sortSourceFiles = (
  files: ReadonlyArray<SourceFile>
): ReadonlyArray<SourceFile> =>
  [...files].sort((a, b) => {
    if (a.filename !== b.filename) return a.filename < b.filename ? -1 : 1
    if (a.contentHash !== b.contentHash) return a.contentHash < b.contentHash ? -1 : 1
    return 0
  })

/**
 * The part of a file that decides the submission's identity.
 *
 * Deliberately excludes `uploadedBy` and `uploadedAt`. ING-006 requires those
 * to be *recorded*, and they are, on the `SourceFile`. But §10.2 invalidates
 * approvals when the reviewed content moves, and re-uploading byte-identical
 * files under a second engineer's name has not moved anything a reviewer
 * looked at. Folding upload identity into the hash would invalidate approvals
 * for a change of clerk, which is the opposite of what the requirement is for.
 *
 * `mappingVersion` becomes `null` rather than being dropped so that "no saved
 * mapping" is an explicit, hashed statement about the file.
 */
const fileIdentity = (file: SourceFile): Canonical => ({
  filename: file.filename,
  mediaType: file.mediaType,
  byteLength: file.byteLength,
  contentHash: file.contentHash,
  kind: file.kind,
  importAdapterVersion: file.importAdapterVersion,
  mappingVersion: file.mappingVersion ?? null
})

/** Inputs that decide a source set's fingerprint (§9.1 step 5). */
export interface SourceSetIdentity {
  readonly harnessId: string
  readonly files: ReadonlyArray<SourceFile>
  readonly dependencyVersions: Readonly<Record<string, string>>
  readonly interfaceContracts: ReadonlyArray<string>
}

/**
 * Fingerprint a submission (ING-006, §9.1 step 5).
 *
 * Covers the files, their mappings, the resolved dependency versions, and the
 * claimed interface contracts — everything §10.2 says must invalidate an
 * approval when it moves. It does not cover the source set's `id` or
 * `createdAt`: those name the row, not the content, and hashing them would
 * make every re-submission of identical work a different design.
 *
 * Interface contract ids are sorted for the same reason files are: the set of
 * contracts is what was claimed, and the order they were typed in is not.
 */
export const sourceSetFingerprint = (identity: SourceSetIdentity): Fingerprint =>
  fingerprint({
    schemaVersion: PLATFORM_SCHEMA_VERSION,
    harnessId: identity.harnessId,
    files: sortSourceFiles(identity.files).map(fileIdentity),
    dependencyVersions: { ...identity.dependencyVersions },
    interfaceContracts: [...identity.interfaceContracts].sort()
  })

/** Everything `assembleSourceSet` needs to produce an immutable submission. */
export interface SourceSetAssemblyInput {
  readonly id: string
  readonly harnessId: string
  readonly uploads: ReadonlyArray<UploadedFile>
  readonly dependencyVersions: Readonly<Record<string, string>>
  readonly interfaceContracts: ReadonlyArray<string>
  /** ING-008 gate; checked before any upload is hashed. */
  readonly preconditions: IngestionJobPreconditions
  /** ING-007 dedup table: content hash to the storage reference it already has. */
  readonly knownContent?: ReadonlyMap<Fingerprint, string> | undefined
  /** Taken as a parameter so assembly stays a pure function of its inputs. */
  readonly createdAt: string
}

/**
 * A finished submission plus the storage decisions made along the way, so a
 * caller can tell ING-007 reuse from new writes without re-hashing the bytes.
 */
export interface SourceSetAssembly {
  readonly sourceSet: SourceSet
  readonly storage: ReadonlyArray<StorageResolution>
}

/**
 * Assemble an immutable source set (§9.1 step 5).
 *
 * Order of operations is the point: the isolated-job gate (ING-008) runs
 * before anything reads the bytes, the mapping gate (ING-003) runs before a
 * tabular file earns an identity, and the fingerprint is taken last over the
 * sorted files so upload order cannot fork it.
 */
export const assembleSourceSet = (
  input: SourceSetAssemblyInput
): SourceSetAssembly => {
  assertIsolatedJob(input.preconditions)
  for (const upload of input.uploads) assertColumnMap(upload)

  const storage = resolveContentStorage(input.uploads, input.knownContent ?? new Map())
  const files: ReadonlyArray<SourceFile> = input.uploads.map((upload, index) => ({
    filename: upload.filename,
    mediaType: upload.mediaType,
    byteLength: upload.bytes.byteLength,
    contentHash: storage[index]!.contentHash,
    kind: upload.kind,
    importAdapterVersion: upload.importAdapterVersion,
    ...(upload.mappingVersion !== undefined
      ? { mappingVersion: upload.mappingVersion }
      : {}),
    uploadedBy: upload.uploadedBy,
    uploadedAt: upload.uploadedAt
  }))

  const sorted = sortSourceFiles(files)
  const candidate = {
    id: input.id,
    harnessId: input.harnessId,
    files: sorted,
    dependencyVersions: { ...input.dependencyVersions },
    interfaceContracts: [...input.interfaceContracts].sort(),
    fingerprint: sourceSetFingerprint({
      harnessId: input.harnessId,
      files: sorted,
      dependencyVersions: input.dependencyVersions,
      interfaceContracts: input.interfaceContracts
    }),
    createdAt: input.createdAt
  }

  // Decode through the frozen schema rather than trusting the construction
  // above: this record is what every later stage cites, so a field that drifts
  // from §8 must fail here and not in an evidence bundle.
  let sourceSet: SourceSet
  try {
    sourceSet = Schema.decodeUnknownSync(SourceSet)(candidate)
  } catch (cause) {
    throw new IngestionError(
      IngestionErrorCode.InvalidSourceSet,
      `Assembled source set does not satisfy the platform schema: ${cause instanceof Error ? cause.message : String(cause)}`
    )
  }
  return { sourceSet, storage }
}

// ---------------------------------------------------------------------------
// ING-005 — retained unknowns
// ---------------------------------------------------------------------------

/**
 * Something the import saw and did not understand (ING-005).
 *
 * Modelled explicitly, and carrying `rawValue` verbatim, because the failure
 * this requirement guards against is silent loss: a column the mapping does
 * not name, or a concept an adapter has no home for, must reach the reviewer
 * as text they can read and decide about rather than vanishing between the
 * file and the design. §9.1 step 4 has the user confirm these before the
 * source set is minted.
 */
export interface RetainedUnknown {
  readonly filename: string
  /** What kind of thing was not understood, e.g. `column`, `wireviz-node`. */
  readonly concept: string
  /** The value exactly as it appeared, never normalized or truncated. */
  readonly rawValue: string
  readonly row?: number | undefined
  readonly column?: string | undefined
}

/**
 * Columns present in a table but absent from the saved column map (ING-005).
 *
 * These are the commonest unknowns in practice — a customer's "Notes",
 * "Twist", or "Shield" column that the mapping has nowhere to put. The
 * importer ignores them by design; this turns that silence into a listed item.
 */
export const unmappedColumnUnknowns = (
  filename: string,
  headers: ReadonlyArray<string>,
  columnMap: WireListColumnMap
): ReadonlyArray<RetainedUnknown> => {
  const mapped = new Set<string>(Object.values(columnMap))
  return headers
    .filter((header) => header !== "" && !mapped.has(header))
    .map((header) => ({
      filename,
      concept: "column",
      rawValue: header,
      column: header
    }))
}

// ---------------------------------------------------------------------------
// ING-004 — unified row accounting
// ---------------------------------------------------------------------------

/** A diagnostic pinned to a specific column of a specific row (ING-004). */
export interface ColumnDiagnostic {
  readonly code: string
  readonly column: string
  readonly message: string
}

/**
 * One input row's fate. Extends the importer's `ImportRowResult` rather than
 * restating it, so the row number and status a parser already decided stay the
 * single source of truth; the platform only adds the column detail a reviewer
 * needs to go fix the file.
 */
export interface RowAccount extends ImportRowResult {
  readonly columns: ReadonlyArray<ColumnDiagnostic>
}

/** One file's contribution to the unified report. */
export interface FileImportInput {
  readonly filename: string
  /**
   * Rows the parser read, counted independently of the importer's results.
   * ING-004 is only checkable because this number comes from a different place
   * than `rows` does — comparing `rows.length` to itself would prove nothing.
   */
  readonly totalRows: number
  readonly rows: ReadonlyArray<ImportRowResult>
  /** Adapter diagnostics; those carrying `sourceRow` are joined onto rows. */
  readonly diagnostics?: ReadonlyArray<Diagnostic> | undefined
}

/** Accounting for one file (ING-004). */
export interface FileRowAccounting {
  readonly filename: string
  readonly totalRows: number
  readonly accepted: number
  readonly rejected: number
  readonly rows: ReadonlyArray<RowAccount>
  /** Diagnostics that describe the file rather than any one row. */
  readonly fileDiagnostics: ReadonlyArray<ColumnDiagnostic>
  /** `accepted + rejected === totalRows`. */
  readonly balanced: boolean
}

/** A file whose rows do not add up, named so the failure can be reported. */
export interface RowAccountingImbalance {
  readonly filename: string
  readonly totalRows: number
  readonly accepted: number
  readonly rejected: number
  /** `totalRows - (accepted + rejected)`; positive means rows went missing. */
  readonly unaccounted: number
}

/**
 * The ING-004 release-gate input.
 *
 * Exposed as a plain summary so the gate elsewhere in the system can consume
 * `complete` without knowing anything about importers: if a single row of a
 * single file went unaccounted for, the submission has not been fully read and
 * no verdict about it is trustworthy.
 */
export interface RowAccountingSummary {
  readonly complete: boolean
  readonly totalRows: number
  readonly accepted: number
  readonly rejected: number
  readonly imbalances: ReadonlyArray<RowAccountingImbalance>
}

/** The unified import preview shown at §9.1 step 3. */
export interface ImportReport {
  readonly reportVersion: "0.1.0"
  readonly files: ReadonlyArray<FileRowAccounting>
  /** ING-005: never empty by accident — an empty list is an assertion. */
  readonly retainedUnknowns: ReadonlyArray<RetainedUnknown>
  readonly accounting: RowAccountingSummary
}

const columnDiagnostic = (diagnostic: Diagnostic): ColumnDiagnostic => ({
  code: diagnostic.code,
  column: String(diagnostic.data?.["sourceColumn"] ?? ""),
  message: diagnostic.message
})

/**
 * Index a file's diagnostics by the source row they name. Diagnostics without
 * a `sourceRow` describe the file itself (a mapped column that is missing
 * outright) and are kept separately rather than dropped.
 */
const splitDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>
): {
  readonly byRow: ReadonlyMap<number, ReadonlyArray<ColumnDiagnostic>>
  readonly fileLevel: ReadonlyArray<ColumnDiagnostic>
} => {
  const byRow = new Map<number, Array<ColumnDiagnostic>>()
  const fileLevel: Array<ColumnDiagnostic> = []
  for (const diagnostic of diagnostics) {
    const row = diagnostic.data?.["sourceRow"]
    if (typeof row !== "number") {
      fileLevel.push(columnDiagnostic(diagnostic))
      continue
    }
    const bucket = byRow.get(row)
    if (bucket === undefined) byRow.set(row, [columnDiagnostic(diagnostic)])
    else bucket.push(columnDiagnostic(diagnostic))
  }
  return { byRow, fileLevel }
}

const accountForFile = (file: FileImportInput): FileRowAccounting => {
  const { byRow, fileLevel } = splitDiagnostics(file.diagnostics ?? [])
  const rows: ReadonlyArray<RowAccount> = file.rows.map((row) => ({
    ...row,
    columns: byRow.get(row.row) ?? []
  }))
  // Counted by status rather than taken as `rows.length` so that a row which
  // somehow carries neither status surfaces as an imbalance instead of being
  // absorbed into a total that always agrees with itself.
  const accepted = rows.filter((row) => row.status === "accepted").length
  const rejected = rows.filter((row) => row.status === "rejected").length
  return {
    filename: file.filename,
    totalRows: file.totalRows,
    accepted,
    rejected,
    rows,
    fileDiagnostics: fileLevel,
    balanced: accepted + rejected === file.totalRows
  }
}

/**
 * Prove ING-004 across every file, or name the files that break it.
 *
 * Returns rather than throws because the preview at §9.1 step 3 has to *show*
 * the imbalance to whoever can fix it; `assertRowAccountingComplete` is the
 * loud form for the gate that must not proceed.
 */
export const summarizeRowAccounting = (
  files: ReadonlyArray<FileRowAccounting>
): RowAccountingSummary => {
  const imbalances = files
    .filter((file) => !file.balanced)
    .map((file) => ({
      filename: file.filename,
      totalRows: file.totalRows,
      accepted: file.accepted,
      rejected: file.rejected,
      unaccounted: file.totalRows - (file.accepted + file.rejected)
    }))
  return {
    complete: imbalances.length === 0,
    totalRows: files.reduce((sum, file) => sum + file.totalRows, 0),
    accepted: files.reduce((sum, file) => sum + file.accepted, 0),
    rejected: files.reduce((sum, file) => sum + file.rejected, 0),
    imbalances
  }
}

/**
 * Build the unified report covering every row of every file (ING-004) with the
 * unknowns the import chose not to discard (ING-005).
 */
export const buildImportReport = (input: {
  readonly files: ReadonlyArray<FileImportInput>
  readonly retainedUnknowns?: ReadonlyArray<RetainedUnknown> | undefined
}): ImportReport => {
  const files = input.files.map(accountForFile)
  return {
    reportVersion: "0.1.0",
    files,
    retainedUnknowns: input.retainedUnknowns ?? [],
    accounting: summarizeRowAccounting(files)
  }
}

/**
 * The loud form of the ING-004 check. A report that loses rows is not a
 * partial result to be shown with a caveat — it means the platform cannot say
 * what was in the customer's file, so no downstream verdict may be built on it.
 */
export const assertRowAccountingComplete = (report: ImportReport): void => {
  if (report.accounting.complete) return
  const detail = report.accounting.imbalances
    .map(
      (imbalance) =>
        `${imbalance.filename}: ${imbalance.accepted} accepted + ${imbalance.rejected} rejected of ${imbalance.totalRows} rows (${imbalance.unaccounted} unaccounted)`
    )
    .join("; ")
  throw new IngestionError(
    IngestionErrorCode.RowAccountingImbalance,
    `Import report does not account for every input row (ING-004). ${detail}`,
    report.accounting.imbalances[0]?.filename
  )
}

/**
 * Adapt one `@grayhaven/nerve-importers` wire-list import into the unified
 * report's shape.
 *
 * The parsed table is taken alongside the result on purpose: its row count is
 * what the file actually contained, and the importer's row results are what
 * the adapter claims it handled. ING-004 is the assertion that those two
 * numbers agree, which is only an assertion if they are measured separately.
 */
export const wireListFileImport = (
  filename: string,
  table: ParsedWireList,
  result: WireListImportResult
): FileImportInput => ({
  filename,
  totalRows: table.rows.length,
  rows: result.report.rows,
  diagnostics: result.diagnostics
})

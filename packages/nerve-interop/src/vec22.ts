/* oxlint-disable anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, anti-slop/no-shape-in-symbol-names, anti-slop/no-chained-type-assertions, anti-slop/require-safety-comment-for-type-assertion -- Conditional spreads preserve omission; the checked external DTO boundary must accept and narrow unknown JSON before domain use. */
/**
 * A normalized, structured VEC 2.2 subset boundary.
 *
 * This is intentionally not an official XML parser or conformance validator.
 * The caller runs the official XSD/ontology/SHACL toolchain and supplies its
 * evidence. Unsupported extensions remain attached to the normalized document.
 */
import {
  connector,
  harness,
  wire,
  type ConnectorInstance,
  type ConnectorPart,
  type HarnessDesign,
  type SealPart,
  type TerminalPart,
  type WirePart,
  type WireProps
} from "@grayhaven/nerve"

export const VEC_22_SUBSET_SCHEMA_VERSION = "2.2.0-subset.1" as const

interface VecValidatorEvidence {
  readonly validator: string
  readonly version: string
  readonly passed: boolean
  readonly reportHash: string
}

export interface VecValidationEvidence {
  readonly xsd: VecValidatorEvidence
  readonly shacl: VecValidatorEvidence
  readonly validatedAt?: string
}

export type VecJsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<VecJsonValue>
  | { readonly [key: string]: VecJsonValue }

export interface VecUnknownExtension {
  readonly path: string
  readonly namespace: string
  readonly name: string
  /** A finite, acyclic JSON value. Non-JSON objects require a raw reference/hash. */
  readonly losslessJson?: VecJsonValue
  readonly rawReference?: string
  readonly rawHash?: string
}

interface Vec22Terminal {
  readonly mpn: string
  readonly manufacturer?: string
  readonly family?: string
  readonly description?: string
  readonly wireGaugeRange?: { readonly min: string; readonly max: string }
  readonly insulationDiameterRange?: { readonly min: number; readonly max: number }
  readonly plating?: string
  readonly currentRatingA?: number
  readonly crimpTool?: string
  readonly dieId?: string
  readonly stripLength?: number
  readonly crimpHeight?: { readonly min: number; readonly max: number }
  readonly pullForceN?: number
}

interface Vec22Seal {
  readonly mpn: string
  readonly manufacturer?: string
  readonly family?: string
  readonly description?: string
  readonly insulationDiameterRange?: { readonly min: number; readonly max: number }
}

interface Vec22Pin {
  readonly id: string
  /** Omitted means the cavity is represented but not assigned in this subset. */
  readonly signal?: string
  readonly terminal?: Vec22Terminal
  readonly seal?: Vec22Seal
}

export interface Vec22Connector {
  readonly ref: string
  readonly mpn: string
  readonly manufacturer?: string
  readonly family?: string
  readonly description?: string
  readonly gender?: "plug" | "receptacle" | "hermaphroditic"
  readonly pinCount: number
  readonly voltageLimitV?: number
  readonly currentLimitA?: number
  readonly pins: ReadonlyArray<Vec22Pin>
}

interface Vec22WirePart {
  readonly mpn: string
  readonly manufacturer?: string
  readonly family?: string
  readonly description?: string
  readonly gauge: string
  readonly strands?: number
  readonly conductorMaterial?: "copper" | "tinned-copper" | "copper-clad-aluminum"
  readonly insulation?: string
  readonly outerDiameter?: number
  readonly voltageRating?: number
  readonly temperatureRating?: number
  readonly ohmsPerKm?: number
  readonly gramsPerMeter?: number
  readonly availableColors?: ReadonlyArray<string>
}

interface Vec22Endpoint {
  readonly connector: string
  readonly pin: string
}

export interface Vec22Wire {
  readonly id: string
  readonly from: Vec22Endpoint
  readonly to: Vec22Endpoint
  readonly part?: Vec22WirePart
  readonly material?: string
  readonly gauge?: string
  readonly color?: string
  readonly stripe?: string
  readonly length?: number
  readonly lengthTolerance?: number
  readonly serviceLoop?: number
  readonly stripLength?: { readonly from: number; readonly to: number }
  readonly terminationAllowance?: { readonly from: number; readonly to: number }
  readonly signal?: string
  readonly insulation?: string
  readonly voltageRating?: number
  readonly temperatureRating?: number
  readonly currentEstimate?: number
}

export interface Vec22SubsetDocument {
  readonly schemaVersion: typeof VEC_22_SUBSET_SCHEMA_VERSION
  readonly harness: {
    readonly id: string
    readonly revision: string
    readonly units: "mm" | "in"
  }
  /** Hash of the caller-owned source artifact; this package never computes it. */
  readonly sourceHash: string
  readonly sourceReference?: string
  readonly validation?: VecValidationEvidence
  readonly connectors: ReadonlyArray<Vec22Connector>
  readonly wires: ReadonlyArray<Vec22Wire>
  readonly unknownExtensions: ReadonlyArray<VecUnknownExtension>
}

export interface VecCoverage {
  readonly connectors: { readonly total: number; readonly mapped: number }
  readonly wires: { readonly total: number; readonly mapped: number }
  readonly unknownExtensions: number
  readonly unmappedPaths: ReadonlyArray<string>
  /** Mapping coverage only; never a VEC conformance statement. */
  readonly complete: boolean
}

export interface VecImportOptions {
  /** Fail closed unless both caller-supplied XSD and SHACL evidence pass. */
  readonly requireSemanticValidation?: boolean
}

export interface VecDiagnostic {
  readonly code: string
  readonly severity: "error" | "warning"
  readonly message: string
  readonly target?: string
}

export interface VecImportResult {
  readonly ok: boolean
  /** Absent when the external DTO could not be safely decoded. */
  readonly document?: Vec22SubsetDocument
  readonly design?: HarnessDesign
  readonly diagnostics: ReadonlyArray<VecDiagnostic>
  readonly coverage: VecCoverage
}

export interface VecExportResult {
  readonly ok: boolean
  readonly document?: Vec22SubsetDocument
  readonly json?: string
  readonly bytes?: Uint8Array
  readonly diagnostics: ReadonlyArray<VecDiagnostic>
  readonly coverage: VecCoverage
}

interface VecDesignExportOptions {
  readonly sourceHash: string
  readonly sourceReference?: string
  readonly validation?: VecValidationEvidence
  readonly unknownExtensions?: ReadonlyArray<VecUnknownExtension>
}

const CODES = {
  Version: "NI-VEC-001",
  ValidationMissing: "NI-VEC-002",
  ValidationFailed: "NI-VEC-003",
  SourceMissing: "NI-VEC-004",
  DuplicateConnector: "NI-VEC-005",
  DuplicatePin: "NI-VEC-006",
  DuplicateWire: "NI-VEC-007",
  BrokenEndpoint: "NI-VEC-008",
  MissingSignal: "NI-VEC-009",
  UnknownExtension: "NI-VEC-010",
  ExtensionEvidence: "NI-VEC-011",
  InvalidFact: "NI-VEC-012",
  UnsupportedEndpoint: "NI-VEC-013",
  MalformedDocument: "NI-VEC-014",
  InvalidJsonExtension: "NI-VEC-015"
} as const

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const present = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length > 0
const finiteNonnegative = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0

type UnknownRecord = Record<string, unknown>

const isPlainRecord = (value: unknown): value is UnknownRecord => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([a], [b]) => cmp(a, b))
        .map(([key, child]) => [key, canonicalValue(child)])
    )
  }
  return value
}

const canonicalClone = <T extends object>(value: T): T => {
  // SAFETY: serialization starts from T, changes only key order, and drops only undefined fields.
  return JSON.parse(JSON.stringify(canonicalValue(value))) as T
}

const utf8Bytes = (text: string): Uint8Array => {
  const bytes: Array<number> = []
  for (const character of text) {
    const codePoint = character.codePointAt(0)!
    if (codePoint <= 0x7f) bytes.push(codePoint)
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      )
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      )
    }
  }
  return Uint8Array.from(bytes)
}

const normalizeDocument = (document: Vec22SubsetDocument): Vec22SubsetDocument => {
  const cloned = canonicalClone(document)
  return {
    ...cloned,
    connectors: [...cloned.connectors]
      .map((entry) => ({ ...entry, pins: [...entry.pins].sort((a, b) => cmp(a.id, b.id)) }))
      .sort((a, b) => cmp(a.ref, b.ref)),
    wires: [...cloned.wires].sort((a, b) => cmp(a.id, b.id)),
    unknownExtensions: [...cloned.unknownExtensions].sort(
      (a, b) => cmp(a.path, b.path) || cmp(a.namespace, b.namespace) || cmp(a.name, b.name)
    )
  }
}

const diagnostic = (
  code: string,
  severity: VecDiagnostic["severity"],
  message: string,
  target?: string
): VecDiagnostic => ({
  code,
  severity,
  message,
  ...(target === undefined ? {} : { target })
})

const sortDiagnostics = (
  diagnostics: ReadonlyArray<VecDiagnostic>
): ReadonlyArray<VecDiagnostic> =>
  [...diagnostics].sort(
    (a, b) =>
      cmp(a.code, b.code) ||
      cmp(a.target ?? "", b.target ?? "") ||
      cmp(a.message, b.message)
  )

interface JsonProblem {
  readonly path: string
  readonly reason: string
}

const jsonProblem = (
  value: unknown,
  path = "document",
  ancestors: WeakSet<object> = new WeakSet()
): JsonProblem | undefined => {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return undefined
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? undefined : { path, reason: "numbers must be finite" }
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return { path, reason: "cyclic arrays are not JSON values" }
    ancestors.add(value)
    for (let index = 0; index < value.length; index += 1) {
      const problem = jsonProblem(value[index], `${path}[${index}]`, ancestors)
      if (problem !== undefined) return problem
    }
    ancestors.delete(value)
    return undefined
  }
  if (!isPlainRecord(value)) {
    return { path, reason: "values must be JSON primitives, arrays, or plain objects" }
  }
  if (ancestors.has(value)) return { path, reason: "cyclic objects are not JSON values" }
  ancestors.add(value)
  for (const key of Object.keys(value).sort(cmp)) {
    const problem = jsonProblem(value[key], `${path}.${key}`, ancestors)
    if (problem !== undefined) return problem
  }
  ancestors.delete(value)
  return undefined
}

const optionalFields = (
  record: UnknownRecord,
  keys: ReadonlyArray<string>,
  predicate: (value: unknown) => boolean
): boolean =>
  keys.every((key) => !Object.hasOwn(record, key) || predicate(record[key]))

const stringValue = (value: unknown): value is string => typeof value === "string"
const numberValue = (value: unknown): value is number => typeof value === "number"

const stringRangeShape = (value: unknown): boolean =>
  isPlainRecord(value) && stringValue(value.min) && stringValue(value.max)

const numericRangeShape = (value: unknown): boolean =>
  isPlainRecord(value) && numberValue(value.min) && numberValue(value.max)

const endAllowanceShape = (value: unknown): boolean =>
  isPlainRecord(value) && numberValue(value.from) && numberValue(value.to)

const validatorEvidenceShape = (value: unknown): boolean =>
  isPlainRecord(value) &&
  stringValue(value.validator) &&
  stringValue(value.version) &&
  typeof value.passed === "boolean" &&
  stringValue(value.reportHash)

const validationEvidenceShape = (value: unknown): boolean =>
  isPlainRecord(value) &&
  validatorEvidenceShape(value.xsd) &&
  validatorEvidenceShape(value.shacl) &&
  optionalFields(value, ["validatedAt"], stringValue)

const terminalShape = (value: unknown): boolean => {
  if (!isPlainRecord(value) || !stringValue(value.mpn)) return false
  return (
    optionalFields(
      value,
      ["manufacturer", "family", "description", "plating", "crimpTool", "dieId"],
      stringValue
    ) &&
    optionalFields(value, ["currentRatingA", "stripLength", "pullForceN"], numberValue) &&
    optionalFields(value, ["wireGaugeRange"], stringRangeShape) &&
    optionalFields(value, ["insulationDiameterRange", "crimpHeight"], numericRangeShape)
  )
}

const sealShape = (value: unknown): boolean =>
  isPlainRecord(value) &&
  stringValue(value.mpn) &&
  optionalFields(value, ["manufacturer", "family", "description"], stringValue) &&
  optionalFields(value, ["insulationDiameterRange"], numericRangeShape)

const pinShape = (value: unknown): boolean =>
  isPlainRecord(value) &&
  stringValue(value.id) &&
  optionalFields(value, ["signal"], stringValue) &&
  optionalFields(value, ["terminal"], terminalShape) &&
  optionalFields(value, ["seal"], sealShape)

const connectorShape = (value: unknown): boolean =>
  isPlainRecord(value) &&
  stringValue(value.ref) &&
  stringValue(value.mpn) &&
  numberValue(value.pinCount) &&
  Array.isArray(value.pins) &&
  value.pins.every(pinShape) &&
  optionalFields(value, ["manufacturer", "family", "description"], stringValue) &&
  optionalFields(value, ["voltageLimitV", "currentLimitA"], numberValue) &&
  optionalFields(
    value,
    ["gender"],
    (gender) => gender === "plug" || gender === "receptacle" || gender === "hermaphroditic"
  )

const wirePartShape = (value: unknown): boolean =>
  isPlainRecord(value) &&
  stringValue(value.mpn) &&
  stringValue(value.gauge) &&
  optionalFields(
    value,
    ["manufacturer", "family", "description", "insulation"],
    stringValue
  ) &&
  optionalFields(
    value,
    [
      "strands",
      "outerDiameter",
      "voltageRating",
      "temperatureRating",
      "ohmsPerKm",
      "gramsPerMeter"
    ],
    numberValue
  ) &&
  optionalFields(
    value,
    ["conductorMaterial"],
    (material) =>
      material === "copper" ||
      material === "tinned-copper" ||
      material === "copper-clad-aluminum"
  ) &&
  optionalFields(
    value,
    ["availableColors"],
    (colors) => Array.isArray(colors) && colors.every(stringValue)
  )

const endpointShape = (value: unknown): boolean =>
  isPlainRecord(value) && stringValue(value.connector) && stringValue(value.pin)

const wireShape = (value: unknown): boolean =>
  isPlainRecord(value) &&
  stringValue(value.id) &&
  endpointShape(value.from) &&
  endpointShape(value.to) &&
  optionalFields(value, ["part"], wirePartShape) &&
  optionalFields(
    value,
    ["material", "gauge", "color", "stripe", "signal", "insulation"],
    stringValue
  ) &&
  optionalFields(
    value,
    [
      "length",
      "lengthTolerance",
      "serviceLoop",
      "voltageRating",
      "temperatureRating",
      "currentEstimate"
    ],
    numberValue
  ) &&
  optionalFields(value, ["stripLength", "terminationAllowance"], endAllowanceShape)

const unknownExtensionShape = (value: unknown): boolean =>
  isPlainRecord(value) &&
  stringValue(value.path) &&
  stringValue(value.namespace) &&
  stringValue(value.name) &&
  optionalFields(value, ["rawReference", "rawHash"], stringValue)

interface DecodedDocument {
  readonly document?: Vec22SubsetDocument
  readonly diagnostics: ReadonlyArray<VecDiagnostic>
}

const decodeDocument = (input: unknown): DecodedDocument => {
  let jsonIssue: JsonProblem | undefined
  try {
    jsonIssue = jsonProblem(input)
  } catch {
    return {
      diagnostics: [
        diagnostic(
          CODES.MalformedDocument,
          "error",
          "Structured subset input could not be inspected safely.",
          "document"
        )
      ]
    }
  }
  if (jsonIssue !== undefined) {
    const extensionJson = jsonIssue.path.includes(".losslessJson")
    return {
      diagnostics: [
        diagnostic(
          extensionJson ? CODES.InvalidJsonExtension : CODES.MalformedDocument,
          "error",
          `${jsonIssue.path} is not lossless JSON: ${jsonIssue.reason}.`,
          jsonIssue.path
        )
      ]
    }
  }
  if (!isPlainRecord(input)) {
    return {
      diagnostics: [
        diagnostic(
          CODES.MalformedDocument,
          "error",
          "Structured subset input must be a JSON object.",
          "document"
        )
      ]
    }
  }

  const diagnostics: Array<VecDiagnostic> = []
  const malformed = (message: string, target: string): void => {
    diagnostics.push(diagnostic(CODES.MalformedDocument, "error", message, target))
  }
  if (!stringValue(input.schemaVersion)) {
    malformed("schemaVersion must be a string.", "document:schemaVersion")
  }
  if (
    !isPlainRecord(input.harness) ||
    !stringValue(input.harness.id) ||
    !stringValue(input.harness.revision) ||
    (input.harness.units !== "mm" && input.harness.units !== "in")
  ) {
    malformed("harness must contain string id/revision and mm or in units.", "document:harness")
  }
  if (!stringValue(input.sourceHash)) {
    malformed("sourceHash must be a string.", "document:sourceHash")
  }
  if (!optionalFields(input, ["sourceReference"], stringValue)) {
    malformed("sourceReference must be a string when present.", "document:sourceReference")
  }
  if (!optionalFields(input, ["validation"], validationEvidenceShape)) {
    malformed("validation must contain identified XSD and SHACL result objects.", "document:validation")
  }

  for (const [field, predicate] of [
    ["connectors", connectorShape],
    ["wires", wireShape],
    ["unknownExtensions", unknownExtensionShape]
  ] as const) {
    const entries = input[field]
    if (!Array.isArray(entries)) {
      malformed(`${field} must be an array.`, `document:${field}`)
      continue
    }
    entries.forEach((entry, index) => {
      if (!predicate(entry)) {
        malformed(
          `${field}[${index}] contains missing or incorrectly typed known fields.`,
          `document:${field}[${index}]`
        )
      }
    })
  }

  if (diagnostics.length > 0) return { diagnostics: sortDiagnostics(diagnostics) }
  return {
    // SAFETY: JSON-domain validation and every known DTO field check above completed.
    document: input as unknown as Vec22SubsetDocument,
    diagnostics: []
  }
}

const terminalPart = (terminal: Vec22Terminal): TerminalPart => ({
  mpn: terminal.mpn,
  ...(terminal.manufacturer === undefined ? {} : { manufacturer: terminal.manufacturer }),
  ...(terminal.family === undefined ? {} : { family: terminal.family }),
  ...(terminal.description === undefined ? {} : { description: terminal.description }),
  ...(terminal.wireGaugeRange === undefined
    ? {}
    : { wireGaugeRange: { ...terminal.wireGaugeRange } }),
  ...(terminal.insulationDiameterRange === undefined
    ? {}
    : { insulationDiameterRange: { ...terminal.insulationDiameterRange } }),
  ...(terminal.plating === undefined ? {} : { plating: terminal.plating }),
  ...(terminal.currentRatingA === undefined
    ? {}
    : { currentRatingA: terminal.currentRatingA }),
  ...(terminal.crimpTool === undefined ? {} : { crimpTool: terminal.crimpTool }),
  ...(terminal.dieId === undefined ? {} : { dieId: terminal.dieId }),
  ...(terminal.stripLength === undefined ? {} : { stripLength: terminal.stripLength }),
  ...(terminal.crimpHeight === undefined
    ? {}
    : { crimpHeight: { ...terminal.crimpHeight } }),
  ...(terminal.pullForceN === undefined ? {} : { pullForceN: terminal.pullForceN })
})

const sealPart = (seal: Vec22Seal): SealPart => ({
  mpn: seal.mpn,
  ...(seal.manufacturer === undefined ? {} : { manufacturer: seal.manufacturer }),
  ...(seal.family === undefined ? {} : { family: seal.family }),
  ...(seal.description === undefined ? {} : { description: seal.description }),
  ...(seal.insulationDiameterRange === undefined
    ? {}
    : { insulationDiameterRange: { ...seal.insulationDiameterRange } })
})

const wirePart = (part: Vec22WirePart): WirePart => ({
  mpn: part.mpn,
  gauge: part.gauge,
  ...(part.manufacturer === undefined ? {} : { manufacturer: part.manufacturer }),
  ...(part.family === undefined ? {} : { family: part.family }),
  ...(part.description === undefined ? {} : { description: part.description }),
  ...(part.strands === undefined ? {} : { strands: part.strands }),
  ...(part.conductorMaterial === undefined
    ? {}
    : { conductorMaterial: part.conductorMaterial }),
  ...(part.insulation === undefined ? {} : { insulation: part.insulation }),
  ...(part.outerDiameter === undefined ? {} : { outerDiameter: part.outerDiameter }),
  ...(part.voltageRating === undefined ? {} : { voltageRating: part.voltageRating }),
  ...(part.temperatureRating === undefined
    ? {}
    : { temperatureRating: part.temperatureRating }),
  ...(part.ohmsPerKm === undefined ? {} : { ohmsPerKm: part.ohmsPerKm }),
  ...(part.gramsPerMeter === undefined ? {} : { gramsPerMeter: part.gramsPerMeter }),
  ...(part.availableColors === undefined
    ? {}
    : { availableColors: [...part.availableColors] })
})

const toWireProps = (entry: Vec22Wire, effectivePart?: Vec22WirePart): WireProps => ({
  ...(effectivePart === undefined ? {} : { part: wirePart(effectivePart) }),
  ...(entry.gauge === undefined ? {} : { gauge: entry.gauge }),
  ...(entry.color === undefined ? {} : { color: entry.color }),
  ...(entry.stripe === undefined ? {} : { stripe: entry.stripe }),
  ...(entry.length === undefined ? {} : { length: entry.length }),
  ...(entry.lengthTolerance === undefined
    ? {}
    : { lengthTolerance: entry.lengthTolerance }),
  ...(entry.serviceLoop === undefined ? {} : { serviceLoop: entry.serviceLoop }),
  ...(entry.stripLength === undefined
    ? {}
    : { stripLength: { ...entry.stripLength } }),
  ...(entry.terminationAllowance === undefined
    ? {}
    : { terminationAllowance: { ...entry.terminationAllowance } }),
  ...(entry.signal === undefined ? {} : { signal: entry.signal }),
  ...(entry.insulation === undefined ? {} : { insulation: entry.insulation }),
  ...(entry.voltageRating === undefined ? {} : { voltageRating: entry.voltageRating }),
  ...(entry.temperatureRating === undefined
    ? {}
    : { temperatureRating: entry.temperatureRating }),
  ...(entry.currentEstimate === undefined
    ? {}
    : { currentEstimate: entry.currentEstimate })
})

const emptyCoverage = (): VecCoverage => ({
  connectors: { total: 0, mapped: 0 },
  wires: { total: 0, mapped: 0 },
  unknownExtensions: 0,
  unmappedPaths: [],
  complete: false
})

/** Import the structured subset into a compilable HarnessDesign. */
export const importVec22Subset = (
  input: unknown,
  options: VecImportOptions = {}
): VecImportResult => {
  const decoded = decodeDocument(input)
  if (decoded.document === undefined) {
    return {
      ok: false,
      diagnostics: decoded.diagnostics,
      coverage: emptyCoverage()
    }
  }
  const document = normalizeDocument(decoded.document)
  const diagnostics: Array<VecDiagnostic> = []
  const unmappedPaths = new Set<string>()
  let mappedConnectors = 0
  let mappedWires = 0

  if (document.schemaVersion !== VEC_22_SUBSET_SCHEMA_VERSION) {
    diagnostics.push(
      diagnostic(
        CODES.Version,
        "error",
        `Structured subset version must be ${VEC_22_SUBSET_SCHEMA_VERSION}.`,
        "document:schemaVersion"
      )
    )
  }
  if (!present(document.sourceHash)) {
    diagnostics.push(
      diagnostic(CODES.SourceMissing, "error", "A caller-supplied source hash is required.", "document:sourceHash")
    )
  }

  const validation = document.validation
  const validationIdentified =
    validation !== undefined &&
    present(validation.xsd.validator) &&
    present(validation.xsd.version) &&
    present(validation.xsd.reportHash) &&
    present(validation.shacl.validator) &&
    present(validation.shacl.version) &&
    present(validation.shacl.reportHash)
  const validationPassed =
    validationIdentified && validation.xsd.passed === true && validation.shacl.passed === true
  if (options.requireSemanticValidation === true && !validationIdentified) {
    diagnostics.push(
      diagnostic(
        CODES.ValidationMissing,
        "error",
        "Semantic gating requires caller-supplied XSD and SHACL validation evidence.",
        "document:validation"
      )
    )
  } else if (options.requireSemanticValidation === true && !validationPassed) {
    diagnostics.push(
      diagnostic(
        CODES.ValidationFailed,
        "error",
        "Semantic gating requires both XSD and SHACL validation to pass.",
        "document:validation"
      )
    )
  } else if (validation !== undefined && !validationPassed) {
    diagnostics.push(
      diagnostic(
        CODES.ValidationFailed,
        "warning",
        "Supplied validation evidence contains a failed XSD or SHACL result; semantic gating was not requested.",
        "document:validation"
      )
    )
  }

  const connectorIds = new Set<string>()
  const instances = new Map<string, ConnectorInstance>()
  for (const entry of document.connectors) {
    const target = `connector:${entry.ref}`
    if (connectorIds.has(entry.ref)) {
      diagnostics.push(
        diagnostic(CODES.DuplicateConnector, "error", `Connector ${entry.ref} is repeated.`, target)
      )
      continue
    }
    connectorIds.add(entry.ref)
    if (
      !present(entry.ref) ||
      !present(entry.mpn) ||
      !Number.isSafeInteger(entry.pinCount) ||
      entry.pinCount < 1
    ) {
      diagnostics.push(
        diagnostic(
          CODES.InvalidFact,
          "error",
          `Connector ${entry.ref || "<missing>"} requires a ref, MPN, and positive safe-integer pinCount.`,
          target
        )
      )
      continue
    }
    if (entry.pins.length > entry.pinCount) {
      diagnostics.push(
        diagnostic(
          CODES.InvalidFact,
          "error",
          `Connector ${entry.ref} represents ${entry.pins.length} cavities but declares pinCount ${entry.pinCount}.`,
          target
        )
      )
    }

    const pins: Record<string, string> = {}
    const terminals: Record<string, TerminalPart> = {}
    const seals: Record<string, SealPart> = {}
    const pinIds = new Set<string>()
    for (const pin of entry.pins) {
      const pinTarget = `${target}.pin:${pin.id}`
      if (!present(pin.id)) {
        diagnostics.push(
          diagnostic(
            CODES.InvalidFact,
            "error",
            `Connector ${entry.ref} contains a blank pin id.`,
            pinTarget
          )
        )
        continue
      }
      if (pinIds.has(pin.id)) {
        diagnostics.push(
          diagnostic(CODES.DuplicatePin, "error", `Connector ${entry.ref} repeats pin ${pin.id}.`, pinTarget)
        )
        continue
      }
      pinIds.add(pin.id)
      if (!present(pin.signal)) {
        if (pin.terminal !== undefined || pin.seal !== undefined) {
          diagnostics.push(
            diagnostic(
              CODES.MissingSignal,
              "warning",
              `Pin ${entry.ref}.${pin.id} has terminal or seal data but no assigned signal; Nerve cannot attach those facts to an unassigned cavity.`,
              pinTarget
            )
          )
          unmappedPaths.add(`connectors/${entry.ref}/pins/${pin.id}`)
        }
        continue
      }
      pins[pin.id] = pin.signal
      if (pin.terminal !== undefined) terminals[pin.id] = terminalPart(pin.terminal)
      if (pin.seal !== undefined) seals[pin.id] = sealPart(pin.seal)
    }

    const part: ConnectorPart = {
      mpn: entry.mpn,
      pinCount: entry.pinCount,
      ...(entry.manufacturer === undefined ? {} : { manufacturer: entry.manufacturer }),
      ...(entry.family === undefined ? {} : { family: entry.family }),
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.gender === undefined ? {} : { gender: entry.gender }),
      ...(entry.voltageLimitV === undefined ? {} : { voltageLimitV: entry.voltageLimitV }),
      ...(entry.currentLimitA === undefined ? {} : { currentLimitA: entry.currentLimitA })
    }
    const instance = connector(entry.ref, part, {
      pins,
      ...(Object.keys(terminals).length === 0 ? {} : { terminals }),
      ...(Object.keys(seals).length === 0 ? {} : { seals })
    })
    instances.set(entry.ref, instance)
    mappedConnectors += 1
  }

  const wires = []
  const wireIds = new Set<string>()
  for (const entry of document.wires) {
    const target = `wire:${entry.id}`
    if (wireIds.has(entry.id)) {
      diagnostics.push(
        diagnostic(CODES.DuplicateWire, "error", `Wire ${entry.id} is repeated.`, target)
      )
      continue
    }
    wireIds.add(entry.id)
    const from = instances.get(entry.from.connector)
    const to = instances.get(entry.to.connector)
    const fromAssigned = from !== undefined && Object.hasOwn(from.pins, entry.from.pin)
    const toAssigned = to !== undefined && Object.hasOwn(to.pins, entry.to.pin)
    if (!fromAssigned || !toAssigned) {
      const missing = [
        ...(fromAssigned ? [] : [`${entry.from.connector}.${entry.from.pin}`]),
        ...(toAssigned ? [] : [`${entry.to.connector}.${entry.to.pin}`])
      ]
      diagnostics.push(
        diagnostic(
          CODES.BrokenEndpoint,
          "error",
          `Wire ${entry.id} references missing or unassigned endpoint(s): ${missing.join(", ")}.`,
          target
        )
      )
      unmappedPaths.add(`wires/${entry.id}`)
      continue
    }
    if (
      (entry.length !== undefined && !finiteNonnegative(entry.length)) ||
      (entry.serviceLoop !== undefined && !finiteNonnegative(entry.serviceLoop))
    ) {
      diagnostics.push(
        diagnostic(CODES.InvalidFact, "error", `Wire ${entry.id} contains a negative or non-finite length.`, target)
      )
      continue
    }
    let effectivePart = entry.part
    if (
      entry.part !== undefined &&
      present(entry.material) &&
      entry.part.mpn !== entry.material
    ) {
      diagnostics.push(
        diagnostic(
          CODES.InvalidFact,
          "error",
          `Wire ${entry.id} declares material ${entry.material} but its part MPN is ${entry.part.mpn}.`,
          target
        )
      )
      unmappedPaths.add(`wires/${entry.id}/material`)
      continue
    }
    if (effectivePart === undefined && present(entry.material)) {
      if (present(entry.gauge)) {
        effectivePart = { mpn: entry.material, gauge: entry.gauge }
      } else {
        diagnostics.push(
          diagnostic(
            CODES.InvalidFact,
            "warning",
            `Wire ${entry.id} material ${entry.material} is retained but cannot become a Nerve WirePart without a declared gauge.`,
            target
          )
        )
        unmappedPaths.add(`wires/${entry.id}/material`)
      }
    }
    // The booleans above prove both instances exist; keep the assertion local.
    wires.push(
      wire(
        entry.id,
        from.pin(entry.from.pin),
        to.pin(entry.to.pin),
        toWireProps(entry, effectivePart)
      )
    )
    mappedWires += 1
  }

  for (const extension of document.unknownExtensions) {
    const target = `extension:${extension.path}`
    diagnostics.push(
      diagnostic(
        CODES.UnknownExtension,
        "warning",
        `Unsupported extension ${extension.namespace}:${extension.name} is retained at ${extension.path}.`,
        target
      )
    )
    unmappedPaths.add(extension.path)
    const hasLossless = extension.losslessJson !== undefined
    const hasRaw = present(extension.rawReference) && present(extension.rawHash)
    if (!hasLossless && !hasRaw) {
      diagnostics.push(
        diagnostic(
          CODES.ExtensionEvidence,
          "error",
          `Extension ${extension.path} requires losslessJson or both rawReference and rawHash.`,
          target
        )
      )
    }
  }

  const orderedDiagnostics = sortDiagnostics(diagnostics)
  const hasErrors = orderedDiagnostics.some((entry) => entry.severity === "error")
  const coverage: VecCoverage = {
    connectors: { total: document.connectors.length, mapped: mappedConnectors },
    wires: { total: document.wires.length, mapped: mappedWires },
    unknownExtensions: document.unknownExtensions.length,
    unmappedPaths: [...unmappedPaths].sort(cmp),
    complete:
      !hasErrors &&
      mappedConnectors === document.connectors.length &&
      mappedWires === document.wires.length &&
      document.unknownExtensions.length === 0
  }
  const base = {
    ok: !hasErrors,
    document,
    diagnostics: orderedDiagnostics,
    coverage
  }
  if (hasErrors) return base
  return {
    ...base,
    design: harness(document.harness.id, {
      revision: document.harness.revision,
      units: document.harness.units,
      metadata: {
        "vec.subsetSchemaVersion": document.schemaVersion,
        "vec.sourceHash": document.sourceHash,
        ...(document.sourceReference === undefined
          ? {}
          : { "vec.sourceReference": document.sourceReference })
      },
      connectors: [...instances.values()].sort((a, b) => cmp(a.ref, b.ref)),
      wires
    })
  }
}

const exportTerminal = (part: TerminalPart | undefined, mpn: string | undefined): Vec22Terminal | undefined => {
  if (part !== undefined) {
    return canonicalClone({
      mpn: part.mpn,
      ...(part.manufacturer === undefined ? {} : { manufacturer: part.manufacturer }),
      ...(part.family === undefined ? {} : { family: part.family }),
      ...(part.description === undefined ? {} : { description: part.description }),
      ...(part.wireGaugeRange === undefined ? {} : { wireGaugeRange: part.wireGaugeRange }),
      ...(part.insulationDiameterRange === undefined
        ? {}
        : { insulationDiameterRange: part.insulationDiameterRange }),
      ...(part.plating === undefined ? {} : { plating: part.plating }),
      ...(part.currentRatingA === undefined ? {} : { currentRatingA: part.currentRatingA }),
      ...(part.crimpTool === undefined ? {} : { crimpTool: part.crimpTool }),
      ...(part.dieId === undefined ? {} : { dieId: part.dieId }),
      ...(part.stripLength === undefined ? {} : { stripLength: part.stripLength }),
      ...(part.crimpHeight === undefined ? {} : { crimpHeight: part.crimpHeight }),
      ...(part.pullForceN === undefined ? {} : { pullForceN: part.pullForceN })
    })
  }
  return mpn === undefined ? undefined : { mpn }
}

const exportSeal = (part: SealPart | undefined, mpn: string | undefined): Vec22Seal | undefined => {
  if (part !== undefined) {
    return canonicalClone({
      mpn: part.mpn,
      ...(part.manufacturer === undefined ? {} : { manufacturer: part.manufacturer }),
      ...(part.family === undefined ? {} : { family: part.family }),
      ...(part.description === undefined ? {} : { description: part.description }),
      ...(part.insulationDiameterRange === undefined
        ? {}
        : { insulationDiameterRange: part.insulationDiameterRange })
    })
  }
  return mpn === undefined ? undefined : { mpn }
}

const documentFromDesign = (
  design: HarnessDesign,
  options: VecDesignExportOptions,
  diagnostics: Array<VecDiagnostic>,
  unmappedPaths: Set<string>
): Vec22SubsetDocument => {
  const connectors: Array<Vec22Connector> = design.connectors.map((entry) => ({
    ref: entry.ref,
    mpn: entry.part.mpn,
    ...(entry.part.manufacturer === undefined ? {} : { manufacturer: entry.part.manufacturer }),
    ...(entry.part.family === undefined ? {} : { family: entry.part.family }),
    ...(entry.part.description === undefined ? {} : { description: entry.part.description }),
    ...(entry.part.gender === undefined ? {} : { gender: entry.part.gender }),
    pinCount: entry.part.pinCount,
    ...(entry.part.voltageLimitV === undefined ? {} : { voltageLimitV: entry.part.voltageLimitV }),
    ...(entry.part.currentLimitA === undefined ? {} : { currentLimitA: entry.part.currentLimitA }),
    pins: Object.entries(entry.pins).map(([id, signal]) => ({
      id,
      signal,
      ...(exportTerminal(entry.terminalParts?.[id], entry.terminals[id]) === undefined
        ? {}
        : { terminal: exportTerminal(entry.terminalParts?.[id], entry.terminals[id])! }),
      ...(exportSeal(entry.sealParts?.[id], entry.seals[id]) === undefined
        ? {}
        : { seal: exportSeal(entry.sealParts?.[id], entry.seals[id])! })
    }))
  }))

  const wires: Array<Vec22Wire> = []
  for (const entry of design.wires) {
    if (entry.from.kind !== "pin-ref" || entry.to.kind !== "pin-ref") {
      diagnostics.push(
        diagnostic(
          CODES.UnsupportedEndpoint,
          "warning",
          `Wire ${entry.id} uses a splice endpoint outside the normalized VEC subset and was not exported.`,
          `wire:${entry.id}`
        )
      )
      unmappedPaths.add(`wires/${entry.id}`)
      continue
    }
    const part = entry.part
    const exportedPart: Vec22WirePart | undefined = part === undefined
      ? undefined
      : canonicalClone({
          mpn: part.mpn,
          gauge: part.gauge,
          ...(part.manufacturer === undefined ? {} : { manufacturer: part.manufacturer }),
          ...(part.family === undefined ? {} : { family: part.family }),
          ...(part.description === undefined ? {} : { description: part.description }),
          ...(part.strands === undefined ? {} : { strands: part.strands }),
          ...(part.conductorMaterial === undefined
            ? {}
            : { conductorMaterial: part.conductorMaterial }),
          ...(part.insulation === undefined ? {} : { insulation: part.insulation }),
          ...(part.outerDiameter === undefined ? {} : { outerDiameter: part.outerDiameter }),
          ...(part.voltageRating === undefined ? {} : { voltageRating: part.voltageRating }),
          ...(part.temperatureRating === undefined
            ? {}
            : { temperatureRating: part.temperatureRating }),
          ...(part.ohmsPerKm === undefined ? {} : { ohmsPerKm: part.ohmsPerKm }),
          ...(part.gramsPerMeter === undefined ? {} : { gramsPerMeter: part.gramsPerMeter }),
          ...(part.availableColors === undefined
            ? {}
            : { availableColors: [...part.availableColors] })
        })
    wires.push({
      id: entry.id,
      from: { connector: entry.from.connector, pin: entry.from.pin },
      to: { connector: entry.to.connector, pin: entry.to.pin },
      ...(exportedPart === undefined ? {} : { part: exportedPart }),
      ...(part?.mpn === undefined ? {} : { material: part.mpn }),
      ...(entry.gauge === undefined ? {} : { gauge: entry.gauge }),
      ...(entry.color === undefined ? {} : { color: entry.color }),
      ...(entry.stripe === undefined ? {} : { stripe: entry.stripe }),
      ...(entry.length === undefined ? {} : { length: entry.length }),
      ...(entry.lengthTolerance === undefined ? {} : { lengthTolerance: entry.lengthTolerance }),
      ...(entry.serviceLoop === undefined ? {} : { serviceLoop: entry.serviceLoop }),
      ...(entry.stripLength === undefined ? {} : { stripLength: { ...entry.stripLength } }),
      ...(entry.terminationAllowance === undefined
        ? {}
        : { terminationAllowance: { ...entry.terminationAllowance } }),
      ...(entry.signal === undefined ? {} : { signal: entry.signal }),
      ...(entry.insulation === undefined ? {} : { insulation: entry.insulation }),
      ...(entry.voltageRating === undefined ? {} : { voltageRating: entry.voltageRating }),
      ...(entry.temperatureRating === undefined
        ? {}
        : { temperatureRating: entry.temperatureRating }),
      ...(entry.currentEstimate === undefined ? {} : { currentEstimate: entry.currentEstimate })
    })
  }

  return normalizeDocument({
    schemaVersion: VEC_22_SUBSET_SCHEMA_VERSION,
    harness: { id: design.id, revision: design.revision, units: design.units },
    sourceHash: options.sourceHash,
    ...(options.sourceReference === undefined ? {} : { sourceReference: options.sourceReference }),
    ...(options.validation === undefined ? {} : { validation: options.validation }),
    connectors,
    wires,
    unknownExtensions: options.unknownExtensions ?? []
  })
}

export function exportVec22Subset(input: VecImportResult | Vec22SubsetDocument): VecExportResult
export function exportVec22Subset(
  input: HarnessDesign,
  options: VecDesignExportOptions
): VecExportResult
export function exportVec22Subset(
  input: VecImportResult | Vec22SubsetDocument | HarnessDesign,
  options?: VecDesignExportOptions
): VecExportResult {
  let document: Vec22SubsetDocument
  let diagnostics: Array<VecDiagnostic> = []
  const unmappedPaths = new Set<string>()
  let mappedConnectorCount = 0
  let mappedWireCount = 0
  let totalConnectorCount = 0
  let totalWireCount = 0

  if (!isPlainRecord(input)) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          CODES.MalformedDocument,
          "error",
          "VEC export input must be a structured subset, import result, or HarnessDesign.",
          "document"
        )
      ],
      coverage: emptyCoverage()
    }
  }
  if ("kind" in input && input.kind === "harness") {
    const design = input as unknown as HarnessDesign
    totalConnectorCount = design.connectors.length
    totalWireCount = design.wires.length
    if (options === undefined || !present(options.sourceHash)) {
      diagnostics.push(
        diagnostic(CODES.SourceMissing, "error", "Exporting a design requires a caller-supplied sourceHash.", "document:sourceHash")
      )
      return { ok: false, diagnostics, coverage: emptyCoverage() }
    }
    document = documentFromDesign(design, options, diagnostics, unmappedPaths)
    mappedConnectorCount = document.connectors.length
    mappedWireCount = document.wires.length
  } else if ("ok" in input && "coverage" in input && "diagnostics" in input) {
    const imported = input as unknown as VecImportResult
    if (imported.document === undefined) {
      return {
        ok: false,
        diagnostics: [...imported.diagnostics],
        coverage: imported.coverage
      }
    }
    document = normalizeDocument(imported.document)
    diagnostics = [...imported.diagnostics]
    totalConnectorCount = imported.coverage.connectors.total
    totalWireCount = imported.coverage.wires.total
    mappedConnectorCount = imported.coverage.connectors.mapped
    mappedWireCount = imported.coverage.wires.mapped
    for (const path of imported.coverage.unmappedPaths) unmappedPaths.add(path)
  } else {
    const imported = importVec22Subset(input)
    if (imported.document === undefined) {
      return {
        ok: false,
        diagnostics: [...imported.diagnostics],
        coverage: imported.coverage
      }
    }
    document = imported.document
    diagnostics = [...imported.diagnostics]
    totalConnectorCount = imported.coverage.connectors.total
    totalWireCount = imported.coverage.wires.total
    mappedConnectorCount = imported.coverage.connectors.mapped
    mappedWireCount = imported.coverage.wires.mapped
    for (const path of imported.coverage.unmappedPaths) unmappedPaths.add(path)
  }

  const orderedDiagnostics = sortDiagnostics(diagnostics)
  const json = vec22SubsetJson(document)
  const coverage: VecCoverage = {
    connectors: { total: totalConnectorCount, mapped: mappedConnectorCount },
    wires: { total: totalWireCount, mapped: mappedWireCount },
    unknownExtensions: document.unknownExtensions.length,
    unmappedPaths: [...unmappedPaths].sort(cmp),
    complete:
      orderedDiagnostics.every((entry) => entry.severity !== "error") &&
      mappedConnectorCount === totalConnectorCount &&
      mappedWireCount === totalWireCount &&
      document.unknownExtensions.length === 0
  }
  return {
    ok: orderedDiagnostics.every((entry) => entry.severity !== "error"),
    document,
    json,
    bytes: utf8Bytes(json),
    diagnostics: orderedDiagnostics,
    coverage
  }
}

/** Canonical, newline-terminated JSON for the normalized structured subset. */
export const vec22SubsetJson = (document: Vec22SubsetDocument): string =>
  JSON.stringify(canonicalValue(normalizeDocument(document)), null, 2) + "\n"

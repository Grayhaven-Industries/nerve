/* oxlint-disable anti-slop/no-conditional-empty-object-spread, anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion -- Conditional spreads preserve omission; this checked external machine-result boundary must accept and narrow unknown runtime DTO values before domain use. */
/**
 * Transport-neutral mappings for the initial OPC 40570 v1 cutting-room scope.
 *
 * No network client, OPC UA binding, certificate, assembly flow, or EOL test
 * protocol lives here. Values are copied from HIR or caller options only.
 */
import type { Hir, HirEndpoint, HirPin, HirWire } from "@grayhaven/nerve"

export const OPC_40570_PROFILE_VERSION = "1.0.0" as const

interface OpcOperationBase {
  readonly id: string
  readonly wireId: string
  readonly materialRef: string
}

interface OpcCutOperation extends OpcOperationBase {
  readonly kind: "cut"
  readonly units: "mm" | "in"
  readonly finishedLength: number
  readonly serviceLoop?: number
  readonly terminationAllowance?: { readonly from: number; readonly to: number }
  readonly cutLength: number
}

interface OpcStripOperation extends OpcOperationBase {
  readonly kind: "strip"
  readonly end: "from" | "to"
  readonly units: "mm" | "in"
  readonly stripLength: number
}

interface OpcCrimpOperation extends OpcOperationBase {
  readonly kind: "crimp"
  readonly end: "from" | "to"
  readonly terminalRef: string
  readonly crimpTool?: string
  readonly dieId?: string
  readonly declaredCrimpHeight?: { readonly min: number; readonly max: number }
  readonly declaredPullForceN?: number
}

interface OpcSealOperation extends OpcOperationBase {
  readonly kind: "seal"
  readonly end: "from" | "to"
  readonly sealRef: string
}

export type Opc40570Operation =
  | OpcCutOperation
  | OpcStripOperation
  | OpcCrimpOperation
  | OpcSealOperation

export interface Opc40570Limitation {
  readonly code: string
  readonly severity: "error" | "warning"
  readonly message: string
  readonly target?: string
}

export interface Opc40570JobOptions {
  readonly jobId: string
  readonly releaseId: string
  readonly releaseFingerprint: string
  readonly createdAt: string
  /** Shop/material-system identifiers keyed by HIR wire id. */
  readonly materialRefs: Readonly<Record<string, string>>
  /** Omitted selects all HIR wires; supplied ids are still validated. */
  readonly wireIds?: ReadonlyArray<string>
}

export interface Opc40570Job {
  readonly profileVersion: typeof OPC_40570_PROFILE_VERSION
  readonly scope: "single-core-single-layer-cut-strip-crimp-seal"
  readonly jobId: string
  readonly releaseId: string
  readonly releaseFingerprint: string
  readonly createdAt: string
  readonly harnessId: string
  readonly harnessRevision: string
  readonly units: "mm" | "in"
  readonly operations: ReadonlyArray<Opc40570Operation>
  readonly limitations: ReadonlyArray<Opc40570Limitation>
  /** Structural dispatch readiness only; never process or product acceptance. */
  readonly dispatchable: boolean
}

export interface Opc40570MachineResult {
  readonly operationId: string
  readonly operationKind?: Opc40570Operation["kind"]
  readonly status: "completed" | "passed" | "failed" | "skipped" | "aborted"
  readonly startedAt?: string
  readonly completedAt?: string
  readonly actualCutLength?: number
  readonly actualStripLength?: number
  readonly actualCrimpHeight?: number
  readonly actualCrimpWidth?: number
  readonly actualPullForceN?: number
  readonly forceCurve?: ReadonlyArray<{
    readonly position: number
    readonly force: number
  }>
}

export interface Opc40570ResultEnvelope {
  readonly profileVersion: string
  readonly jobId: string
  readonly releaseFingerprint: string
  readonly machine: {
    readonly id: string
    readonly manufacturer?: string
    readonly model?: string
    readonly serial?: string
  }
  readonly software: {
    readonly name: string
    readonly version: string
  }
  readonly calibration?: {
    readonly id: string
    readonly status: "valid" | "expired" | "unknown"
    readonly calibratedAt?: string
    readonly dueAt?: string
  }
  readonly startedAt: string
  readonly completedAt: string
  readonly rawReference: string
  readonly rawHash: string
  readonly results: ReadonlyArray<Opc40570MachineResult>
}

export interface Opc40570IngestResult {
  readonly structurallyAccepted: boolean
  /** Process/product acceptance needs a caller-owned control plan. */
  readonly acceptance: "not-determined"
  readonly jobId: string
  readonly envelope: Opc40570ResultEnvelope
  readonly matchedResults: ReadonlyArray<Opc40570MachineResult>
  readonly diagnostics: ReadonlyArray<Opc40570Limitation>
}

const CODES = {
  MissingJobIdentity: "NI-OPC-001",
  UnknownWire: "NI-OPC-002",
  UnsupportedCable: "NI-OPC-003",
  MissingLength: "NI-OPC-004",
  MissingMaterial: "NI-OPC-005",
  MissingEndFact: "NI-OPC-006",
  VersionMismatch: "NI-OPC-007",
  JobMismatch: "NI-OPC-008",
  UnknownOperation: "NI-OPC-009",
  MissingOperation: "NI-OPC-010",
  DuplicateOperation: "NI-OPC-011",
  ForceCurveInsufficient: "NI-OPC-012",
  MissingEvidence: "NI-OPC-013",
  OperationMismatch: "NI-OPC-014",
  InvalidMeasurement: "NI-OPC-015",
  InvalidFinishedLength: "NI-OPC-016",
  InvalidCutLength: "NI-OPC-017",
  InvalidStripLength: "NI-OPC-018",
  InvalidEnvelope: "NI-OPC-019",
  InvalidResult: "NI-OPC-020",
  InvalidTerminalReference: "NI-OPC-021",
  InvalidSealReference: "NI-OPC-022",
  InvalidCrimpHeight: "NI-OPC-023",
  InvalidPullForce: "NI-OPC-024",
  IncompatibleMeasurement: "NI-OPC-025",
  InvalidCrimpTool: "NI-OPC-026",
  InvalidDieId: "NI-OPC-027"
} as const

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const present = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0
const finiteNonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
const finitePositive = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

type UnknownRecord = Readonly<Record<string, unknown>>

const recordOf = (value: unknown): UnknownRecord | undefined => {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as UnknownRecord
      : undefined
  } catch {
    return undefined
  }
}

const ownValue = (record: unknown, key: string): unknown => {
  const object = recordOf(record)
  if (object === undefined) return undefined
  try {
    return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined
  } catch {
    return undefined
  }
}

const ownString = (record: unknown, key: string): string | undefined => {
  const value = ownValue(record, key)
  return typeof value === "string" ? value : undefined
}

type CanonicalInput = object | string | number | boolean | null | undefined

const canonicalValue = (
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet()
): CanonicalInput => {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "object") return null
  if (ancestors.has(value)) return null
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const result = value.map((child) => canonicalValue(child, ancestors))
      ancestors.delete(value)
      return result
    }
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => cmp(a, b))
      .map(([key, child]) => [key, canonicalValue(child, ancestors)] as const)
    ancestors.delete(value)
    return Object.fromEntries(entries)
  } catch {
    ancestors.delete(value)
    return null
  }
}

const limitation = (
  code: string,
  severity: Opc40570Limitation["severity"],
  message: string,
  target?: string
): Opc40570Limitation => ({
  code,
  severity,
  message,
  ...(target === undefined ? {} : { target })
})

const sortLimitations = (
  limitations: ReadonlyArray<Opc40570Limitation>
): ReadonlyArray<Opc40570Limitation> =>
  [...limitations].sort(
    (a, b) =>
      cmp(a.code, b.code) ||
      cmp(a.target ?? "", b.target ?? "") ||
      cmp(a.message, b.message)
  )

const pinFor = (hir: Hir, endpoint: HirEndpoint): HirPin | undefined => {
  if (!("connector" in endpoint)) return undefined
  return hir.connectors
    .find((entry) => entry.ref === endpoint.connector)
    ?.pins.find((pin) => pin.pin === endpoint.pin)
}

const declaredCrimpFacts = (
  part: HirPin["terminalPart"],
  wireId: string,
  end: "from" | "to",
  target: string,
  limitations: Array<Opc40570Limitation>
): Pick<
  OpcCrimpOperation,
  "crimpTool" | "dieId" | "declaredCrimpHeight" | "declaredPullForceN"
> => {
  let crimpTool: string | undefined
  const crimpToolValue = ownValue(part, "crimpTool")
  if (crimpToolValue !== undefined) {
    if (!present(crimpToolValue)) {
      limitations.push(
        limitation(
          CODES.InvalidCrimpTool,
          "error",
          `Wire ${wireId} has a blank or invalid ${end}-end crimp-tool reference; the invalid reference was omitted.`,
          target
        )
      )
    } else {
      crimpTool = crimpToolValue
    }
  }

  let dieId: string | undefined
  const dieIdValue = ownValue(part, "dieId")
  if (dieIdValue !== undefined) {
    if (!present(dieIdValue)) {
      limitations.push(
        limitation(
          CODES.InvalidDieId,
          "error",
          `Wire ${wireId} has a blank or invalid ${end}-end die identifier; the invalid identifier was omitted.`,
          target
        )
      )
    } else {
      dieId = dieIdValue
    }
  }

  let declaredCrimpHeight: OpcCrimpOperation["declaredCrimpHeight"]
  const crimpHeightValue = ownValue(part, "crimpHeight")
  if (crimpHeightValue !== undefined) {
    const range = recordOf(crimpHeightValue)
    const min = ownValue(range, "min")
    const max = ownValue(range, "max")
    if (!finitePositive(min) || !finitePositive(max) || min > max) {
      limitations.push(
        limitation(
          CODES.InvalidCrimpHeight,
          "error",
          `Wire ${wireId} has a ${end}-end crimp-height range that is not finite, positive, and ordered; the invalid range was omitted.`,
          target
        )
      )
    } else {
      declaredCrimpHeight = { min, max }
    }
  }

  let declaredPullForceN: number | undefined
  const pullForceValue = ownValue(part, "pullForceN")
  if (pullForceValue !== undefined) {
    if (!finitePositive(pullForceValue)) {
      limitations.push(
        limitation(
          CODES.InvalidPullForce,
          "error",
          `Wire ${wireId} has a ${end}-end pull-force fact that is not finite and positive; the invalid fact was omitted.`,
          target
        )
      )
    } else {
      declaredPullForceN = pullForceValue
    }
  }

  return {
    ...(crimpTool === undefined ? {} : { crimpTool }),
    ...(dieId === undefined ? {} : { dieId }),
    ...(declaredCrimpHeight === undefined ? {} : { declaredCrimpHeight }),
    ...(declaredPullForceN === undefined ? {} : { declaredPullForceN })
  }
}

const endOperations = (
  hir: Hir,
  wireEntry: HirWire,
  materialRef: string,
  end: "from" | "to",
  limitations: Array<Opc40570Limitation>
): ReadonlyArray<Opc40570Operation> => {
  const operations: Array<Opc40570Operation> = []
  const target = `wire:${wireEntry.id}.${end}`
  const stripLength = wireEntry.stripLength?.[end]
  if (stripLength === undefined) {
    limitations.push(
      limitation(
        CODES.MissingEndFact,
        "warning",
        `Wire ${wireEntry.id} has no declared ${end}-end strip length; no strip operation was created.`,
        target
      )
    )
  } else if (!finitePositive(stripLength)) {
    limitations.push(
      limitation(
        CODES.InvalidStripLength,
        "error",
        `Wire ${wireEntry.id} has a ${end}-end strip length that is not finite and positive; no strip operation was created.`,
        target
      )
    )
  } else {
    operations.push({
      id: `${wireEntry.id}:${end}:strip`,
      kind: "strip",
      wireId: wireEntry.id,
      materialRef,
      end,
      units: hir.harness.units,
      stripLength
    })
  }

  const endpoint = wireEntry[end]
  if (!("connector" in endpoint)) {
    limitations.push(
      limitation(
        CODES.MissingEndFact,
        "warning",
        `Wire ${wireEntry.id} ${end} endpoint is a splice; OPC 40570 terminal and seal operations were not created.`,
        target
      )
    )
    return operations
  }
  const pin = pinFor(hir, endpoint)
  const sealRef = pin?.seal
  if (sealRef === undefined) {
    limitations.push(
      limitation(
        CODES.MissingEndFact,
        "warning",
        `Wire ${wireEntry.id} has no declared ${end}-end seal; no seal operation was created.`,
        target
      )
    )
  } else if (!present(sealRef)) {
    limitations.push(
      limitation(
        CODES.InvalidSealReference,
        "error",
        `Wire ${wireEntry.id} has a blank or invalid ${end}-end seal reference; no seal operation was created.`,
        target
      )
    )
  } else {
    operations.push({
      id: `${wireEntry.id}:${end}:seal`,
      kind: "seal",
      wireId: wireEntry.id,
      materialRef,
      end,
      sealRef
    })
  }
  const terminalRef = pin?.terminal
  const part = pin?.terminalPart
  const crimpFacts = declaredCrimpFacts(part, wireEntry.id, end, target, limitations)
  if (terminalRef === undefined) {
    limitations.push(
      limitation(
        CODES.MissingEndFact,
        "warning",
        `Wire ${wireEntry.id} has no declared ${end}-end terminal; no crimp operation was created.`,
        target
      )
    )
  } else if (!present(terminalRef)) {
    limitations.push(
      limitation(
        CODES.InvalidTerminalReference,
        "error",
        `Wire ${wireEntry.id} has a blank or invalid ${end}-end terminal reference; no crimp operation was created.`,
        target
      )
    )
  } else {
    operations.push({
      id: `${wireEntry.id}:${end}:crimp`,
      kind: "crimp",
      wireId: wireEntry.id,
      materialRef,
      end,
      terminalRef,
      ...crimpFacts
    })
  }
  return operations
}

/** Build a deterministic cutting-room job from declared HIR and caller identity. */
export const createOpc40570Job = (hir: Hir, options: Opc40570JobOptions): Opc40570Job => {
  const limitations: Array<Opc40570Limitation> = []
  const operations: Array<Opc40570Operation> = []
  const materialRefs = ownValue(options, "materialRefs")
  const identities = [
    ["jobId", options.jobId],
    ["releaseId", options.releaseId],
    ["releaseFingerprint", options.releaseFingerprint],
    ["createdAt", options.createdAt]
  ] as const
  for (const [field, value] of identities) {
    if (!present(value)) {
      limitations.push(
        limitation(
          CODES.MissingJobIdentity,
          "error",
          `Caller must supply ${field}.`,
          `job:${options.jobId || "<missing>"}`
        )
      )
    }
  }

  const byId = new Map(hir.wires.map((entry) => [entry.id, entry] as const))
  const selectedIds = options.wireIds === undefined
    ? [...byId.keys()].sort(cmp)
    : [...new Set(options.wireIds)].sort(cmp)
  for (const wireId of selectedIds) {
    const entry = byId.get(wireId)
    if (entry === undefined) {
      limitations.push(
        limitation(CODES.UnknownWire, "error", `Selected wire ${wireId} is absent from HIR.`, `wire:${wireId}`)
      )
      continue
    }
    if (entry.cable !== undefined) {
      limitations.push(
        limitation(
          CODES.UnsupportedCable,
          "error",
          `Wire ${wireId} belongs to cable ${entry.cable}; v1 mapping is limited to single-core, single-layer wire.`,
          `wire:${wireId}`
        )
      )
      continue
    }
    const materialRef = ownString(materialRefs, wireId)
    if (!present(materialRef)) {
      limitations.push(
        limitation(
          CODES.MissingMaterial,
          "error",
          `Wire ${wireId} requires a caller-supplied material reference.`,
          `wire:${wireId}`
        )
      )
      continue
    }
    if (entry.length === undefined) {
      limitations.push(
        limitation(
          CODES.MissingLength,
          "error",
          `Wire ${wireId} requires a declared finished length; no cut operation was created.`,
          `wire:${wireId}`
        )
      )
      continue
    }
    if (!finitePositive(entry.length)) {
      limitations.push(
        limitation(
          CODES.InvalidFinishedLength,
          "error",
          `Wire ${wireId} has a finished length that is not finite and positive; no cut operation was created.`,
          `wire:${wireId}`
        )
      )
      continue
    }
    const serviceLoop = entry.serviceLoop
    const allowance = entry.terminationAllowance
    if (
      (serviceLoop !== undefined && !finiteNonnegative(serviceLoop)) ||
      (allowance !== undefined &&
        (!finiteNonnegative(allowance.from) || !finiteNonnegative(allowance.to)))
    ) {
      limitations.push(
        limitation(
          CODES.InvalidCutLength,
          "error",
          `Wire ${wireId} has a negative or non-finite service/termination allowance; no cut operation was created.`,
          `wire:${wireId}`
        )
      )
      continue
    }
    const cutLength =
      entry.length +
      (serviceLoop === undefined ? 0 : serviceLoop) +
      (allowance === undefined ? 0 : allowance.from + allowance.to)
    if (!finitePositive(cutLength)) {
      limitations.push(
        limitation(
          CODES.InvalidCutLength,
          "error",
          `Wire ${wireId} has a computed cut length that is not finite and positive; no cut operation was created.`,
          `wire:${wireId}`
        )
      )
      continue
    }
    operations.push({
      id: `${entry.id}:cut`,
      kind: "cut",
      wireId: entry.id,
      materialRef,
      units: hir.harness.units,
      finishedLength: entry.length,
      ...(serviceLoop === undefined ? {} : { serviceLoop }),
      ...(allowance === undefined
        ? {}
        : { terminationAllowance: { from: allowance.from, to: allowance.to } }),
      cutLength
    })
    operations.push(...endOperations(hir, entry, materialRef, "from", limitations))
    operations.push(...endOperations(hir, entry, materialRef, "to", limitations))
  }

  const orderedLimitations = sortLimitations(limitations)
  return {
    profileVersion: OPC_40570_PROFILE_VERSION,
    scope: "single-core-single-layer-cut-strip-crimp-seal",
    jobId: options.jobId,
    releaseId: options.releaseId,
    releaseFingerprint: options.releaseFingerprint,
    createdAt: options.createdAt,
    harnessId: hir.harness.id,
    harnessRevision: hir.harness.revision,
    units: hir.harness.units,
    operations,
    limitations: orderedLimitations,
    dispatchable: orderedLimitations.every((entry) => entry.severity !== "error")
  }
}

const measurementFields = [
  "actualCutLength",
  "actualStripLength",
  "actualCrimpHeight",
  "actualCrimpWidth",
  "actualPullForceN"
] as const satisfies ReadonlyArray<keyof Opc40570MachineResult>

const resultMeasurementFields = [
  ...measurementFields,
  "forceCurve"
] as const satisfies ReadonlyArray<keyof Opc40570MachineResult>

const measurementCompatibleWith = (
  kind: Opc40570Operation["kind"],
  field: (typeof resultMeasurementFields)[number]
): boolean => {
  switch (kind) {
    case "cut":
      return field === "actualCutLength"
    case "strip":
      return field === "actualStripLength"
    case "crimp":
      return (
        field === "actualCrimpHeight" ||
        field === "actualCrimpWidth" ||
        field === "actualPullForceN" ||
        field === "forceCurve"
      )
    case "seal":
      return false
  }
}

const MACHINE_STATUSES = new Set<Opc40570MachineResult["status"]>([
  "completed",
  "passed",
  "failed",
  "skipped",
  "aborted"
])
const OPERATION_KINDS = new Set<Opc40570Operation["kind"]>([
  "cut",
  "strip",
  "crimp",
  "seal"
])

const isMachineStatus = (value: unknown): value is Opc40570MachineResult["status"] =>
  typeof value === "string" && MACHINE_STATUSES.has(value as Opc40570MachineResult["status"])

const isOperationKind = (value: unknown): value is Opc40570Operation["kind"] =>
  typeof value === "string" && OPERATION_KINDS.has(value as Opc40570Operation["kind"])

const optionalText = (
  record: unknown,
  key: string,
  diagnostics: Array<Opc40570Limitation>,
  code: string,
  target: string
): string | undefined => {
  const value = ownValue(record, key)
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  diagnostics.push(
    limitation(code, "error", `${target} has a non-string ${key} field.`, target)
  )
  return undefined
}

const optionalMeasurement = (
  record: unknown,
  key: (typeof measurementFields)[number],
  diagnostics: Array<Opc40570Limitation>,
  target: string
): number | undefined => {
  const value = ownValue(record, key)
  if (value === undefined) return undefined
  if (typeof value === "number") return value
  diagnostics.push(
    limitation(CODES.InvalidMeasurement, "error", `${target} has a non-numeric ${key}.`, target)
  )
  return undefined
}

const normalizedForceCurve = (
  record: unknown,
  diagnostics: Array<Opc40570Limitation>,
  target: string
): Opc40570MachineResult["forceCurve"] => {
  const value = ownValue(record, "forceCurve")
  if (value === undefined) return undefined
  try {
    if (!Array.isArray(value)) {
      diagnostics.push(
        limitation(CODES.InvalidMeasurement, "error", `${target} has a non-array forceCurve.`, target)
      )
      return undefined
    }
    const points: Array<{ readonly position: number; readonly force: number }> = []
    for (let index = 0; index < value.length; index += 1) {
      const point = recordOf(value[index])
      const position = ownValue(point, "position")
      const force = ownValue(point, "force")
      if (!finiteNumber(position) || !finiteNumber(force)) {
        diagnostics.push(
          limitation(
            CODES.InvalidMeasurement,
            "error",
            `${target} has an invalid forceCurve point at index ${index}.`,
            target
          )
        )
        return undefined
      }
      points.push({ position, force })
    }
    return points
  } catch {
    diagnostics.push(
      limitation(CODES.InvalidMeasurement, "error", `${target} has an unreadable forceCurve.`, target)
    )
    return undefined
  }
}

const normalizeMachineResult = (
  value: unknown,
  index: number,
  diagnostics: Array<Opc40570Limitation>
): Opc40570MachineResult | undefined => {
  const record = recordOf(value)
  const operationId = ownString(record, "operationId")
  const target = present(operationId) ? `operation:${operationId}` : `result:${index}`
  const status = ownValue(record, "status")
  if (record === undefined || !present(operationId) || !isMachineStatus(status)) {
    diagnostics.push(
      limitation(
        CODES.InvalidResult,
        "error",
        `Machine result ${index} requires own string operationId and recognized status fields.`,
        target
      )
    )
    return undefined
  }
  const operationKindValue = ownValue(record, "operationKind")
  const operationKind = operationKindValue === undefined
    ? undefined
    : isOperationKind(operationKindValue)
      ? operationKindValue
      : undefined
  if (operationKindValue !== undefined && operationKind === undefined) {
    diagnostics.push(
      limitation(
        CODES.InvalidResult,
        "error",
        `Machine result ${operationId} has an unrecognized operationKind.`,
        target
      )
    )
  }
  const startedAt = optionalText(record, "startedAt", diagnostics, CODES.InvalidResult, target)
  const completedAt = optionalText(record, "completedAt", diagnostics, CODES.InvalidResult, target)
  const actualCutLength = optionalMeasurement(record, "actualCutLength", diagnostics, target)
  const actualStripLength = optionalMeasurement(record, "actualStripLength", diagnostics, target)
  const actualCrimpHeight = optionalMeasurement(record, "actualCrimpHeight", diagnostics, target)
  const actualCrimpWidth = optionalMeasurement(record, "actualCrimpWidth", diagnostics, target)
  const actualPullForceN = optionalMeasurement(record, "actualPullForceN", diagnostics, target)
  const forceCurve = normalizedForceCurve(record, diagnostics, target)
  return {
    operationId,
    status,
    ...(operationKind === undefined ? {} : { operationKind }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(actualCutLength === undefined ? {} : { actualCutLength }),
    ...(actualStripLength === undefined ? {} : { actualStripLength }),
    ...(actualCrimpHeight === undefined ? {} : { actualCrimpHeight }),
    ...(actualCrimpWidth === undefined ? {} : { actualCrimpWidth }),
    ...(actualPullForceN === undefined ? {} : { actualPullForceN }),
    ...(forceCurve === undefined ? {} : { forceCurve })
  }
}

const normalizeResultEnvelope = (
  input: unknown,
  diagnostics: Array<Opc40570Limitation>,
  target: string
): Opc40570ResultEnvelope => {
  const record = recordOf(input)
  if (record === undefined) {
    diagnostics.push(
      limitation(CODES.InvalidEnvelope, "error", "Machine result envelope is not an object.", target)
    )
  }
  const machineRecord = recordOf(ownValue(record, "machine"))
  const softwareRecord = recordOf(ownValue(record, "software"))
  if (machineRecord === undefined || softwareRecord === undefined) {
    diagnostics.push(
      limitation(
        CODES.InvalidEnvelope,
        "error",
        "Machine result envelope requires own machine and software objects.",
        target
      )
    )
  }
  const manufacturer = optionalText(
    machineRecord,
    "manufacturer",
    diagnostics,
    CODES.InvalidEnvelope,
    target
  )
  const model = optionalText(machineRecord, "model", diagnostics, CODES.InvalidEnvelope, target)
  const serial = optionalText(machineRecord, "serial", diagnostics, CODES.InvalidEnvelope, target)
  const machine = {
    id: ownString(machineRecord, "id") ?? "",
    ...(manufacturer === undefined ? {} : { manufacturer }),
    ...(model === undefined ? {} : { model }),
    ...(serial === undefined ? {} : { serial })
  }
  const software = {
    name: ownString(softwareRecord, "name") ?? "",
    version: ownString(softwareRecord, "version") ?? ""
  }

  const calibrationValue = ownValue(record, "calibration")
  const calibrationRecord = recordOf(calibrationValue)
  let calibration: Opc40570ResultEnvelope["calibration"]
  if (calibrationValue !== undefined) {
    const calibrationStatus = ownValue(calibrationRecord, "status")
    if (
      calibrationRecord === undefined ||
      !present(ownString(calibrationRecord, "id")) ||
      (calibrationStatus !== "valid" &&
        calibrationStatus !== "expired" &&
        calibrationStatus !== "unknown")
    ) {
      diagnostics.push(
        limitation(
          CODES.InvalidEnvelope,
          "error",
          "Machine result calibration must have own id and recognized status fields.",
          target
        )
      )
    } else {
      const calibratedAt = optionalText(
        calibrationRecord,
        "calibratedAt",
        diagnostics,
        CODES.InvalidEnvelope,
        target
      )
      const dueAt = optionalText(
        calibrationRecord,
        "dueAt",
        diagnostics,
        CODES.InvalidEnvelope,
        target
      )
      calibration = {
        id: ownString(calibrationRecord, "id")!,
        status: calibrationStatus,
        ...(calibratedAt === undefined ? {} : { calibratedAt }),
        ...(dueAt === undefined ? {} : { dueAt })
      }
    }
  }

  const resultsValue = ownValue(record, "results")
  const results: Array<Opc40570MachineResult> = []
  try {
    if (!Array.isArray(resultsValue)) {
      diagnostics.push(
        limitation(CODES.InvalidEnvelope, "error", "Machine result envelope requires an own results array.", target)
      )
    } else {
      for (let index = 0; index < resultsValue.length; index += 1) {
        const result = normalizeMachineResult(resultsValue[index], index, diagnostics)
        if (result !== undefined) results.push(result)
      }
    }
  } catch {
    diagnostics.push(
      limitation(CODES.InvalidEnvelope, "error", "Machine result array is unreadable.", target)
    )
  }

  return {
    profileVersion: ownString(record, "profileVersion") ?? "",
    jobId: ownString(record, "jobId") ?? "",
    releaseFingerprint: ownString(record, "releaseFingerprint") ?? "",
    machine,
    software,
    ...(calibration === undefined ? {} : { calibration }),
    startedAt: ownString(record, "startedAt") ?? "",
    completedAt: ownString(record, "completedAt") ?? "",
    rawReference: ownString(record, "rawReference") ?? "",
    rawHash: ownString(record, "rawHash") ?? "",
    results
  }
}

/** Ingest and structurally correlate results without making an acceptance verdict. */
const ingestOpc40570ResultInternal = (
  job: Opc40570Job,
  input: Opc40570ResultEnvelope
): Opc40570IngestResult => {
  const diagnostics: Array<Opc40570Limitation> = []
  const envelope = normalizeResultEnvelope(input, diagnostics, `job:${job.jobId}`)
  if (envelope.profileVersion !== OPC_40570_PROFILE_VERSION) {
    diagnostics.push(
      limitation(
        CODES.VersionMismatch,
        "error",
        `Result profile ${envelope.profileVersion} does not match ${OPC_40570_PROFILE_VERSION}.`,
        `job:${job.jobId}`
      )
    )
  }
  if (envelope.jobId !== job.jobId || envelope.releaseFingerprint !== job.releaseFingerprint) {
    diagnostics.push(
      limitation(
        CODES.JobMismatch,
        "error",
        "Result job id or release fingerprint does not match the dispatched job.",
        `job:${job.jobId}`
      )
    )
  }
  if (
    !present(envelope.machine.id) ||
    !present(envelope.software.name) ||
    !present(envelope.software.version) ||
    !present(envelope.startedAt) ||
    !present(envelope.completedAt) ||
    !present(envelope.rawReference) ||
    !present(envelope.rawHash)
  ) {
    diagnostics.push(
      limitation(
        CODES.MissingEvidence,
        "error",
        "Machine, software, run times, raw reference, and raw hash are required result evidence.",
        `job:${job.jobId}`
      )
    )
  }
  if (envelope.calibration === undefined || !present(envelope.calibration.id)) {
    diagnostics.push(
      limitation(
        CODES.MissingEvidence,
        "warning",
        "No calibration identity was supplied; downstream acceptance must treat calibration as unresolved.",
        `job:${job.jobId}`
      )
    )
  }

  const operations = new Map(job.operations.map((entry) => [entry.id, entry] as const))
  const results = new Map<string, Opc40570MachineResult>()
  for (const result of envelope.results) {
    const target = `operation:${result.operationId}`
    if (results.has(result.operationId)) {
      diagnostics.push(
        limitation(
          CODES.DuplicateOperation,
          "error",
          `Result repeats operation ${result.operationId}.`,
          target
        )
      )
      continue
    }
    results.set(result.operationId, result)
    const operation = operations.get(result.operationId)
    if (operation === undefined) {
      diagnostics.push(
        limitation(
          CODES.UnknownOperation,
          "error",
          `Result references unknown operation ${result.operationId}.`,
          target
        )
      )
      continue
    }
    if (result.operationKind !== undefined && result.operationKind !== operation.kind) {
      diagnostics.push(
        limitation(
          CODES.OperationMismatch,
          "error",
          `Result labels ${result.operationId} as ${result.operationKind}, but the job operation is ${operation.kind}.`,
          target
        )
      )
    }
    for (const field of measurementFields) {
      const value = result[field]
      if (value !== undefined && !finiteNonnegative(value)) {
        diagnostics.push(
          limitation(
            CODES.InvalidMeasurement,
            "error",
            `${result.operationId} has invalid ${field}.`,
            target
          )
        )
      }
    }
    for (const field of resultMeasurementFields) {
      if (result[field] !== undefined && !measurementCompatibleWith(operation.kind, field)) {
        diagnostics.push(
          limitation(
            CODES.IncompatibleMeasurement,
            "error",
            `${result.operationId} reports ${field}, which is incompatible with a ${operation.kind} operation.`,
            target
          )
        )
      }
    }
    if (
      operation.kind === "crimp" &&
      result.forceCurve !== undefined &&
      result.actualCrimpHeight === undefined &&
      result.actualCrimpWidth === undefined &&
      result.actualPullForceN === undefined
    ) {
      diagnostics.push(
        limitation(
          CODES.ForceCurveInsufficient,
          "warning",
          `Force-curve evidence for ${result.operationId} is retained but cannot by itself establish crimp acceptance.`,
          target
        )
      )
    }
  }
  for (const operation of job.operations) {
    if (!results.has(operation.id)) {
      diagnostics.push(
        limitation(
          CODES.MissingOperation,
          "error",
          `No result was supplied for operation ${operation.id}.`,
          `operation:${operation.id}`
        )
      )
    }
  }

  const matchedResults = job.operations
    .map((operation) => results.get(operation.id))
    .filter((result): result is Opc40570MachineResult => result !== undefined)
  const orderedDiagnostics = sortLimitations(diagnostics)
  return {
    structurallyAccepted: orderedDiagnostics.every((entry) => entry.severity !== "error"),
    acceptance: "not-determined",
    jobId: job.jobId,
    envelope,
    matchedResults,
    diagnostics: orderedDiagnostics
  }
}

/** Fail closed even when a runtime caller bypasses the DTO types. */
export const ingestOpc40570Result = (
  job: Opc40570Job,
  input: Opc40570ResultEnvelope
): Opc40570IngestResult => {
  try {
    return ingestOpc40570ResultInternal(job, input)
  } catch {
    const jobId = ownString(job, "jobId") ?? ""
    const diagnostics = [
      limitation(
        CODES.InvalidEnvelope,
        "error",
        "Machine result envelope or dispatched job is unreadable.",
        `job:${jobId || "<missing>"}`
      )
    ]
    return {
      structurallyAccepted: false,
      acceptance: "not-determined",
      jobId,
      envelope: {
        profileVersion: "",
        jobId: "",
        releaseFingerprint: "",
        machine: { id: "" },
        software: { name: "", version: "" },
        startedAt: "",
        completedAt: "",
        rawReference: "",
        rawHash: "",
        results: []
      },
      matchedResults: [],
      diagnostics
    }
  }
}

/** Canonical, newline-terminated job JSON. */
export const opc40570JobJson = (job: Opc40570Job): string =>
  JSON.stringify(canonicalValue(job), null, 2) + "\n"

/** Canonical, newline-terminated raw or ingested result JSON. */
export const opc40570ResultJson = (
  result: Opc40570ResultEnvelope | Opc40570IngestResult
): string => JSON.stringify(canonicalValue(result), null, 2) + "\n"

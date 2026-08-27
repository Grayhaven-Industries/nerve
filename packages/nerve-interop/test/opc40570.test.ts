/* oxlint-disable anti-slop/no-conditional-empty-object-spread -- Test fixtures conditionally omit exact optional fields. */
import { compileDesign, connector, harness, wire } from "@grayhaven/nerve"
import { describe, expect, it } from "vitest"
import {
  OPC_40570_PROFILE_VERSION,
  createOpc40570Job,
  ingestOpc40570Result,
  opc40570JobJson,
  opc40570ResultJson,
  type Opc40570MachineResult,
  type Opc40570ResultEnvelope
} from "../src/index.js"

const makeHir = (wireId = "W1") => {
  const terminal = {
    mpn: "TERM-18",
    crimpTool: "PRESS-7",
    dieId: "DIE-18",
    crimpHeight: { min: 1.1, max: 1.2 },
    pullForceN: 70
  }
  const seal = { mpn: "SEAL-18" }
  const j1 = connector("J1", { mpn: "H1", pinCount: 1 }, {
    pins: { 1: "PWR" },
    terminals: terminal,
    seals: seal
  })
  const j2 = connector("J2", { mpn: "H2", pinCount: 1 }, {
    pins: { 1: "PWR" },
    terminals: terminal,
    seals: seal
  })
  return compileDesign(
    harness("opc-demo", {
      revision: "C",
      units: "mm",
      connectors: [j1, j2],
      wires: [
        wire(wireId, j1.pin(1), j2.pin(1), {
          part: { mpn: "WIRE-18-RD", gauge: "18AWG" },
          gauge: "18AWG",
          length: 100,
          serviceLoop: 10,
          stripLength: { from: 4, to: 5 },
          terminationAllowance: { from: 2, to: 3 }
        })
      ]
    })
  ).hir
}

const options = {
  jobId: "JOB-17",
  releaseId: "REL-4",
  releaseFingerprint: "sha256:release",
  createdAt: "2026-08-27T15:00:00Z",
  materialRefs: { W1: "ERP-MATERIAL-991" }
} as const

const resultsFor = (
  operationIds: ReadonlyArray<
    readonly [string, NonNullable<Opc40570MachineResult["operationKind"]>]
  >
): ReadonlyArray<Opc40570MachineResult> =>
  operationIds.map(([operationId, kind]) => ({
    operationId,
    operationKind: kind,
    status: "completed",
    ...(kind === "cut" ? { actualCutLength: 115 } : {}),
    ...(kind === "strip" ? { actualStripLength: 4 } : {}),
    ...(kind === "crimp"
      ? { forceCurve: [{ position: 0, force: 0 }, { position: 1, force: 25 }] }
      : {})
  }))

const envelopeFor = (
  results: ReadonlyArray<Opc40570MachineResult>
): Opc40570ResultEnvelope => ({
  profileVersion: OPC_40570_PROFILE_VERSION,
  jobId: options.jobId,
  releaseFingerprint: options.releaseFingerprint,
  machine: {
    id: "CUTROOM-3",
    manufacturer: "Machine Company",
    model: "Line 8",
    serial: "SN-331"
  },
  software: { name: "line-controller", version: "5.4.2" },
  calibration: {
    id: "CAL-2026-004",
    status: "valid",
    calibratedAt: "2026-06-01",
    dueAt: "2027-06-01"
  },
  startedAt: "2026-08-27T15:01:00Z",
  completedAt: "2026-08-27T15:02:00Z",
  rawReference: "artifact://machine/JOB-17.json",
  rawHash: "sha256:machine-result",
  results
})

describe("OPC 40570 transport-neutral mappings", () => {
  it("creates both-end operations and computes cut length only from declared facts", () => {
    const job = createOpc40570Job(makeHir(), options)
    expect(job.dispatchable).toBe(true)
    expect(job.scope).toBe("single-core-single-layer-cut-strip-crimp-seal")
    expect(job.operations.map((entry) => `${entry.kind}:${"end" in entry ? entry.end : ""}`)).toEqual([
      "cut:",
      "strip:from",
      "seal:from",
      "crimp:from",
      "strip:to",
      "seal:to",
      "crimp:to"
    ])
    expect(job.operations[0]).toMatchObject({
      kind: "cut",
      finishedLength: 100,
      serviceLoop: 10,
      terminationAllowance: { from: 2, to: 3 },
      cutLength: 115,
      materialRef: "ERP-MATERIAL-991"
    })
  })

  it("does not invent missing material, length, or end process data", () => {
    const hir = makeHir()
    const withoutFacts: typeof hir = {
      ...hir,
      wires: [{ ...hir.wires[0]!, length: undefined, stripLength: undefined }]
    }
    const job = createOpc40570Job(withoutFacts, { ...options, materialRefs: {} })
    expect(job.operations).toEqual([])
    expect(job.dispatchable).toBe(false)
    expect(job.limitations.map((entry) => entry.code)).toContain("NI-OPC-005")
  })

  it("rejects non-finite and non-positive finished and strip lengths", () => {
    const base = makeHir()
    for (const length of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const hir: typeof base = {
        ...base,
        wires: [{ ...base.wires[0]!, length }]
      }
      const job = createOpc40570Job(hir, options)
      expect(job.dispatchable).toBe(false)
      expect(job.limitations.map((entry) => entry.code)).toContain("NI-OPC-016")
      expect(job.operations.some((entry) => entry.kind === "cut")).toBe(false)
    }

    for (const stripLength of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const hir: typeof base = {
        ...base,
        wires: [{
          ...base.wires[0]!,
          stripLength: { from: stripLength, to: 5 }
        }]
      }
      const job = createOpc40570Job(hir, options)
      expect(job.dispatchable).toBe(false)
      expect(job.limitations.map((entry) => entry.code)).toContain("NI-OPC-018")
      expect(
        job.operations.some(
          (entry) => entry.kind === "strip" && entry.end === "from"
        )
      ).toBe(false)
    }
  })

  it("rejects computed cut-length overflow", () => {
    const base = makeHir()
    const hir: typeof base = {
      ...base,
      wires: [{
        ...base.wires[0]!,
        length: Number.MAX_VALUE,
        serviceLoop: Number.MAX_VALUE
      }]
    }
    const job = createOpc40570Job(hir, options)
    expect(job.dispatchable).toBe(false)
    expect(job.limitations.map((entry) => entry.code)).toContain("NI-OPC-017")
    expect(job.operations.some((entry) => entry.kind === "cut")).toBe(false)
  })

  it("requires an own string material reference for prototype-key wire ids", () => {
    const hir = makeHir("toString")
    const inherited = createOpc40570Job(hir, { ...options, materialRefs: {} })
    expect(inherited.dispatchable).toBe(false)
    expect(inherited.limitations.map((entry) => entry.code)).toContain("NI-OPC-005")

    const materialRefs = { toString: "ERP-MATERIAL-PROTOTYPE-KEY" }
    const owned = createOpc40570Job(hir, { ...options, materialRefs })
    expect(owned.dispatchable).toBe(true)
    expect(owned.operations[0]).toMatchObject({
      wireId: "toString",
      materialRef: "ERP-MATERIAL-PROTOTYPE-KEY"
    })
  })

  it("retains machine evidence while refusing to infer crimp acceptance", () => {
    const job = createOpc40570Job(makeHir(), options)
    const resultPairs = job.operations.map((entry) => [entry.id, entry.kind] as const)
    const ingested = ingestOpc40570Result(job, envelopeFor(resultsFor(resultPairs)))
    expect(ingested.structurallyAccepted).toBe(true)
    expect(ingested.acceptance).toBe("not-determined")
    expect(ingested.envelope).toMatchObject({
      machine: { id: "CUTROOM-3", serial: "SN-331" },
      software: { version: "5.4.2" },
      calibration: { id: "CAL-2026-004", status: "valid" },
      rawHash: "sha256:machine-result"
    })
    expect(ingested.diagnostics.map((entry) => entry.code)).toContain("NI-OPC-012")
    expect(opc40570ResultJson(ingested).endsWith("\n")).toBe(true)
  })

  it("diagnoses job, operation, duplicate, and missing-result mismatches", () => {
    const job = createOpc40570Job(makeHir(), options)
    const first = job.operations[0]!
    const envelope = {
      ...envelopeFor([
        { operationId: first.id, operationKind: first.kind, status: "completed" },
        { operationId: first.id, operationKind: first.kind, status: "completed" },
        { operationId: "UNKNOWN", status: "completed" }
      ]),
      releaseFingerprint: "sha256:wrong"
    }
    const ingested = ingestOpc40570Result(job, envelope)
    expect(ingested.structurallyAccepted).toBe(false)
    expect(ingested.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["NI-OPC-008", "NI-OPC-009", "NI-OPC-010", "NI-OPC-011"])
    )
    expect(opc40570JobJson(job).endsWith("\n")).toBe(true)
  })

  it("fails closed without throwing for malformed external result DTOs", () => {
    const job = createOpc40570Job(makeHir(), options)
    const malformed = envelopeFor([])
    Object.defineProperties(malformed, {
      machine: { value: null },
      software: { value: null },
      results: {
        value: [null, { operationId: job.operations[0]!.id, status: "unexpected" }]
      }
    })
    const ingested = ingestOpc40570Result(job, malformed)
    expect(ingested.structurallyAccepted).toBe(false)
    expect(ingested.acceptance).toBe("not-determined")
    expect(ingested.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["NI-OPC-019", "NI-OPC-020"])
    )
  })
})

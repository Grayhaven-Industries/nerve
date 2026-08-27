import { compileDesign } from "@grayhaven/nerve"
import { describe, expect, it } from "vitest"
import {
  VEC_22_SUBSET_SCHEMA_VERSION,
  exportVec22Subset,
  importVec22Subset,
  vec22SubsetJson,
  type Vec22SubsetDocument
} from "../src/index.js"

interface CyclicJsonCandidate {
  self?: unknown
}

const document = (): Vec22SubsetDocument => ({
  schemaVersion: VEC_22_SUBSET_SCHEMA_VERSION,
  harness: { id: "vec-demo", revision: "B", units: "mm" },
  sourceHash: "sha256:vec-source",
  sourceReference: "artifact://customer/harness.vec.xml",
  validation: {
    xsd: {
      validator: "caller-xsd-runner",
      version: "2.2.0",
      passed: true,
      reportHash: "sha256:xsd-report"
    },
    shacl: {
      validator: "caller-shacl-runner",
      version: "2.2.0",
      passed: true,
      reportHash: "sha256:shacl-report"
    },
    validatedAt: "2026-08-27T14:00:00Z"
  },
  connectors: [
    {
      ref: "J2",
      mpn: "HOUSING-2",
      pinCount: 1,
      pins: [
        {
          id: "1",
          signal: "PWR",
          terminal: {
            mpn: "TERM-B",
            stripLength: 4,
            crimpHeight: { min: 1.1, max: 1.2 },
            pullForceN: 70
          },
          seal: { mpn: "SEAL-B" }
        }
      ]
    },
    {
      ref: "J1",
      mpn: "HOUSING-1",
      manufacturer: "Parts Co",
      pinCount: 1,
      pins: [
        {
          id: "1",
          signal: "PWR",
          terminal: { mpn: "TERM-A", crimpTool: "PRESS-7", dieId: "DIE-3" },
          seal: { mpn: "SEAL-A" }
        }
      ]
    }
  ],
  wires: [
    {
      id: "W1",
      from: { connector: "J1", pin: "1" },
      to: { connector: "J2", pin: "1" },
      part: {
        mpn: "WIRE-18-RD",
        gauge: "18AWG",
        conductorMaterial: "tinned-copper",
        voltageRating: 600
      },
      material: "WIRE-18-RD",
      gauge: "18AWG",
      color: "red",
      length: 100,
      serviceLoop: 10,
      stripLength: { from: 4, to: 5 },
      terminationAllowance: { from: 2, to: 3 },
      signal: "PWR",
      voltageRating: 600
    }
  ],
  unknownExtensions: []
})

describe("normalized VEC 2.2 subset", () => {
  it("imports supported facts into a compilable HarnessDesign", () => {
    const imported = importVec22Subset(document(), { requireSemanticValidation: true })
    expect(imported.ok).toBe(true)
    expect(imported.design).toBeDefined()
    const compiled = compileDesign(imported.design!)
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.hir.wires[0]).toMatchObject({
      id: "W1",
      length: 100,
      serviceLoop: 10,
      stripLength: { from: 4, to: 5 },
      terminationAllowance: { from: 2, to: 3 },
      part: { mpn: "WIRE-18-RD", voltageRating: 600 }
    })
    expect(compiled.hir.connectors[0]?.pins[0]).toMatchObject({
      terminal: "TERM-A",
      seal: "SEAL-A"
    })
  })

  it("round-trips supported facts and emits exact UTF-8 bytes with newline", () => {
    const imported = importVec22Subset(document())
    const exported = exportVec22Subset(imported)
    expect(exported.ok).toBe(true)
    expect(exported.document?.wires[0]).toEqual(document().wires[0])
    expect(imported.document).toBeDefined()
    expect(exported.json).toBe(vec22SubsetJson(imported.document!))
    expect(Array.from(exported.bytes ?? []).at(-1)).toBe(10)
    expect(exported.bytes?.length).toBe(exported.json?.length)
  })

  it("maps a declared material reference when the subset also supplies its gauge", () => {
    const fixture = document()
    const { part: removedPart, ...materialOnlyWire } = fixture.wires[0]!
    expect(removedPart).toBeDefined()
    const imported = importVec22Subset({ ...fixture, wires: [materialOnlyWire] })
    expect(imported.ok).toBe(true)
    const compiled = compileDesign(imported.design!)
    expect(compiled.hir.wires[0]?.part).toMatchObject({
      mpn: "WIRE-18-RD",
      gauge: "18AWG"
    })
  })

  it("fails closed when requested XSD and SHACL evidence is absent or failed", () => {
    const { validation: removedValidation, ...withoutValidation } = document()
    expect(removedValidation).toBeDefined()
    const missing = importVec22Subset(withoutValidation, { requireSemanticValidation: true })
    expect(missing.ok).toBe(false)
    expect(missing.design).toBeUndefined()
    expect(missing.diagnostics.map((entry) => entry.code)).toContain("NI-VEC-002")

    const failed = importVec22Subset(
      {
        ...document(),
        validation: {
          ...document().validation!,
          shacl: { ...document().validation!.shacl, passed: false }
        }
      },
      { requireSemanticValidation: true }
    )
    expect(failed.diagnostics.map((entry) => entry.code)).toContain("NI-VEC-003")
  })

  it("diagnoses broken endpoints and preserves unknown extensions losslessly", () => {
    const withUnknown = {
      ...document(),
      wires: [
        {
          ...document().wires[0]!,
          to: { connector: "MISSING", pin: "9" }
        }
      ],
      unknownExtensions: [
        {
          path: "/Harness/CustomThing[1]",
          namespace: "urn:customer:vec-extension",
          name: "CustomThing",
          losslessJson: { z: 2, a: ["raw", 1] }
        }
      ]
    } satisfies Vec22SubsetDocument
    const imported = importVec22Subset(withUnknown)
    expect(imported.ok).toBe(false)
    expect(imported.diagnostics.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(["NI-VEC-008", "NI-VEC-010"])
    )
    const exported = exportVec22Subset(imported)
    expect(exported.document?.unknownExtensions).toEqual(withUnknown.unknownExtensions)
    expect(exported.json).toContain("urn:customer:vec-extension")
  })

  it("rejects a negative termination allowance that would corrupt cut length", () => {
    // A negative-but-finite allowance passes DTO/lossless-JSON validation, so it
    // would import silently and drive cutLengthOf below the finished length
    // (cut = length + serviceLoop + terminationAllowance.from + .to). The
    // compiler never sign-checks it, so the import must fail closed here.
    const base = document()
    const cases: ReadonlyArray<{ readonly from: number; readonly to: number }> = [
      { from: -100, to: 0 },
      { from: 0, to: -5 }
    ]
    for (const terminationAllowance of cases) {
      const imported = importVec22Subset({
        ...base,
        wires: [{ ...base.wires[0]!, terminationAllowance }]
      })
      expect(imported.ok).toBe(false)
      expect(imported.design).toBeUndefined()
      const invalid = imported.diagnostics.find((entry) => entry.code === "NI-VEC-012")
      expect(invalid?.severity).toBe("error")
      expect(invalid?.message).toContain("W1")
    }
  })

  it("rejects blank, duplicate, over-capacity, and unsafe connector cavity declarations", () => {
    const fixture = document()
    const first = fixture.connectors[0]!
    const pin = first.pins[0]!
    const cases: ReadonlyArray<unknown> = [
      {
        ...fixture,
        connectors: [{ ...first, pins: [{ ...pin, id: "" }] }, fixture.connectors[1]!]
      },
      {
        ...fixture,
        connectors: [
          { ...first, pins: [pin, { ...pin, signal: "SECOND" }] },
          fixture.connectors[1]!
        ]
      },
      {
        ...fixture,
        connectors: [
          {
            ...first,
            pinCount: 1,
            pins: [pin, { ...pin, id: "2", signal: "SECOND" }]
          },
          fixture.connectors[1]!
        ]
      },
      {
        ...fixture,
        connectors: [
          { ...first, pinCount: Number.MAX_SAFE_INTEGER + 1 },
          fixture.connectors[1]!
        ]
      }
    ]

    for (const input of cases) {
      const imported = importVec22Subset(input)
      expect(imported.ok).toBe(false)
      expect(imported.design).toBeUndefined()
      expect(imported.coverage.complete).toBe(false)
      expect(imported.diagnostics.some((entry) => entry.severity === "error")).toBe(true)
    }
  })

  it("returns stable diagnostics for malformed external DTOs instead of throwing", () => {
    const fixture = document()
    const malformed: ReadonlyArray<unknown> = [
      null,
      {},
      { ...fixture, connectors: null },
      {
        ...fixture,
        wires: [{ ...fixture.wires[0]!, from: null }]
      }
    ]

    for (const input of malformed) {
      const imported = importVec22Subset(input)
      expect(imported).toMatchObject({ ok: false, coverage: { complete: false } })
      expect(imported.document).toBeUndefined()
      expect(imported.diagnostics.map((entry) => entry.code)).toContain("NI-VEC-014")
      expect(exportVec22Subset(imported).ok).toBe(false)
    }
  })

  it("accepts only genuinely lossless JSON for unknown extensions", () => {
    const cyclic: CyclicJsonCandidate = {}
    cyclic.self = cyclic
    const invalidValues: ReadonlyArray<unknown> = [
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: new Date("2026-08-27T00:00:00Z") },
      cyclic
    ]

    for (const losslessJson of invalidValues) {
      const imported = importVec22Subset({
        ...document(),
        unknownExtensions: [
          {
            path: "/Harness/External[1]",
            namespace: "urn:customer:test",
            name: "External",
            losslessJson
          }
        ]
      })
      expect(imported.ok).toBe(false)
      expect(imported.document).toBeUndefined()
      expect(imported.diagnostics.map((entry) => entry.code)).toContain("NI-VEC-015")
    }

    const jsonValue = { z: 2, a: ["retained", 1, null, true] }
    const imported = importVec22Subset({
      ...document(),
      unknownExtensions: [
        {
          path: "/Harness/External[1]",
          namespace: "urn:customer:test",
          name: "External",
          losslessJson: jsonValue
        }
      ]
    })
    expect(imported.ok).toBe(true)
    expect(imported.document?.unknownExtensions[0]?.losslessJson).toEqual(jsonValue)
  })
})

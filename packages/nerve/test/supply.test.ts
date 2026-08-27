import { describe, expect, it } from "vitest"
import {
  SUPPLY_SNAPSHOT_SCHEMA_VERSION,
  SupplyDiagnosticCodes,
  createSupplySnapshot,
  resolveSupplyRecord,
  selectSupplyPrice,
  staticSupplyProvider,
  type SupplyRecord
} from "@grayhaven/nerve"

const retrievedAt = "2026-08-26T15:00:00Z"

const defaultConnectorRecord: SupplyRecord & { readonly kind: "connector" } = {
  kind: "connector",
  mpn: "CONN-2",
  manufacturer: "Acme",
  description: "Two-position housing",
  lifecycle: "active",
  approval: "approved",
  alternates: ["CONN-2-B"],
  compatibleTooling: ["TOOL-1"],
  compatibleProcesses: ["CRIMP-1"],
  provenance: {
    source: "plm://release/42",
    retrievedAt,
    qualification: "verified"
  },
  offers: [
    {
      supplier: "Preferred",
      currency: "USD",
      priceBreaks: [
        { minimumQuantity: 100, unitCost: 0.5 },
        { minimumQuantity: 1, unitCost: 0.9 },
        { minimumQuantity: 10, unitCost: 0.7 }
      ],
      availableQuantity: 500,
      minimumOrderQuantity: 1,
      retrievedAt
    },
    {
      supplier: "Budget",
      currency: "USD",
      priceBreaks: [{ minimumQuantity: 1, unitCost: 0.6 }],
      retrievedAt
    }
  ]
}

const connectorRecord = (
  overrides: Partial<typeof defaultConnectorRecord> = {}
): SupplyRecord => ({ ...defaultConnectorRecord, ...overrides })

describe("supply pricing and resolution", () => {
  it("selects the deepest price break and honors a viable preferred supplier", () => {
    const record = connectorRecord()
    expect(selectSupplyPrice(record, 25)).toMatchObject({
      supplier: "Budget",
      minimumQuantity: 1,
      unitCost: 0.6,
      orderQuantity: 25
    })
    expect(selectSupplyPrice(record, 25, "Preferred")).toMatchObject({
      supplier: "Preferred",
      minimumQuantity: 10,
      unitCost: 0.7,
      orderQuantity: 25
    })
    expect(selectSupplyPrice(record, 100, "Preferred")?.unitCost).toBe(0.5)
  })

  it("never compares numeric prices across currencies without narrowing", () => {
    const mixed = connectorRecord({
      offers: [
        {
          supplier: "DollarCo",
          currency: "USD",
          priceBreaks: [{ minimumQuantity: 1, unitCost: 1 }],
          retrievedAt
        },
        {
          supplier: "EuroCo",
          currency: "EUR",
          priceBreaks: [{ minimumQuantity: 1, unitCost: 0.5 }],
          retrievedAt
        }
      ]
    })

    expect(selectSupplyPrice(mixed, 1)).toBeUndefined()
    expect(selectSupplyPrice(mixed, 1, "DollarCo")).toMatchObject({
      supplier: "DollarCo",
      currency: "USD",
      unitCost: 1
    })
    expect(selectSupplyPrice(mixed, 1, { preferredCurrency: "EUR" })).toMatchObject({
      supplier: "EuroCo",
      currency: "EUR",
      unitCost: 0.5
    })

    const ambiguous = resolveSupplyRecord(
      [staticSupplyProvider("mixed", [mixed])],
      { kind: "connector", mpn: "CONN-2" }
    )
    expect(ambiguous.diagnostics[0]?.code).toBe(SupplyDiagnosticCodes.AmbiguousCurrency)
    const narrowed = resolveSupplyRecord(
      [staticSupplyProvider("mixed", [mixed])],
      { kind: "connector", mpn: "CONN-2", preferredCurrency: "EUR" }
    )
    expect(narrowed.diagnostics).toEqual([])
  })

  it("rejects offers whose stock cannot satisfy MOQ and diagnoses malformed stock", () => {
    const stocked = connectorRecord({
      offers: [
        {
          supplier: "ShortStock",
          currency: "USD",
          priceBreaks: [{ minimumQuantity: 1, unitCost: 0.1 }],
          minimumOrderQuantity: 10,
          availableQuantity: 9,
          retrievedAt
        },
        {
          supplier: "ReadyStock",
          currency: "USD",
          priceBreaks: [{ minimumQuantity: 1, unitCost: 0.8 }],
          minimumOrderQuantity: 10,
          availableQuantity: 10,
          retrievedAt
        }
      ]
    })
    expect(selectSupplyPrice(stocked, 5)).toMatchObject({
      supplier: "ReadyStock",
      orderQuantity: 10,
      unitCost: 0.8
    })

    const shortOnly = connectorRecord({ offers: [stocked.offers[0]!] })
    expect(selectSupplyPrice(shortOnly, 5)).toBeUndefined()

    const malformed = connectorRecord({
      offers: [{
        supplier: "Malformed",
        currency: "USD",
        priceBreaks: [{ minimumQuantity: 1, unitCost: 0.2 }],
        availableQuantity: -1,
        retrievedAt
      }]
    })
    const resolved = resolveSupplyRecord(
      [staticSupplyProvider("malformed", [malformed])],
      { kind: "connector", mpn: "CONN-2" }
    )
    expect(resolved.diagnostics[0]?.code).toBe(SupplyDiagnosticCodes.InvalidAvailability)
    expect(selectSupplyPrice(malformed, 1)).toBeUndefined()
  })

  it("keeps the first provider whole and diagnoses provenance/price conflicts", () => {
    const plmRecord = connectorRecord()
    const vendorRecord = connectorRecord({
      provenance: {
        source: "vendor://CONN-2",
        retrievedAt: "2026-08-27T00:00:00Z",
        qualification: "manufacturer-verified"
      },
      offers: [{
        supplier: "Vendor",
        currency: "USD",
        priceBreaks: [{ minimumQuantity: 1, unitCost: 1.1 }],
        retrievedAt: "2026-08-27T00:00:00Z"
      }]
    })
    const result = resolveSupplyRecord([
      staticSupplyProvider("plm", [plmRecord]),
      staticSupplyProvider("vendor", [vendorRecord])
    ], { kind: "connector", mpn: "CONN-2" })

    expect(result.provider).toBe("plm")
    expect(result.record).toBe(plmRecord)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]).toMatchObject({
      code: SupplyDiagnosticCodes.Conflict,
      providers: ["plm", "vendor"]
    })
    expect(result.diagnostics[0]?.fields).toEqual([
      "provenance.source",
      "provenance.retrievedAt",
      "provenance.qualification",
      "offers"
    ])
  })

  it("canonicalizes nested offer key order for provider conflict comparison", () => {
    const first = connectorRecord({
      offers: [{
        supplier: "Ordered",
        currency: "USD",
        priceBreaks: [{ minimumQuantity: 1, unitCost: 0.9 }],
        sourceReference: "quote-1",
        retrievedAt
      }]
    })
    const reordered = connectorRecord({
      offers: [{
        retrievedAt,
        sourceReference: "quote-1",
        priceBreaks: [{ unitCost: 0.9, minimumQuantity: 1 }],
        currency: "USD",
        supplier: "Ordered"
      }]
    })
    const agreeing = resolveSupplyRecord([
      staticSupplyProvider("first", [first]),
      staticSupplyProvider("reordered", [reordered])
    ], { kind: "connector", mpn: "CONN-2" })
    expect(agreeing.diagnostics).toEqual([])

    const changed = connectorRecord({
      offers: [{
        retrievedAt,
        sourceReference: "quote-1",
        priceBreaks: [{ unitCost: 0.8, minimumQuantity: 1 }],
        currency: "USD",
        supplier: "Ordered"
      }]
    })
    const conflicting = resolveSupplyRecord([
      staticSupplyProvider("first", [first]),
      staticSupplyProvider("changed", [changed])
    ], { kind: "connector", mpn: "CONN-2" })
    expect(conflicting.diagnostics[0]).toMatchObject({
      code: SupplyDiagnosticCodes.Conflict,
      fields: ["offers"]
    })
  })
})

describe("supply snapshots", () => {
  it("canonicalizes content, preserves unresolved requests, and is deterministic", () => {
    const record = connectorRecord()
    const records = [record]
    const requests = [
      { kind: "wire", mpn: "WIRE-MISSING", quantity: 5 } as const,
      { kind: "connector", mpn: "CONN-2", quantity: 25 } as const
    ]
    const beforeRecords = JSON.stringify(records)
    const beforeRequests = JSON.stringify(requests)
    const provider = staticSupplyProvider("plm", records)
    const options = {
      capturedAt: "2026-08-27T12:00:00Z",
      source: "estimate-inputs",
      release: "R7"
    } as const

    const first = createSupplySnapshot(requests, [provider], options)
    const second = createSupplySnapshot([...requests].reverse(), [provider], options)

    expect(first).toEqual(second)
    expect(first.schemaVersion).toBe(SUPPLY_SNAPSHOT_SCHEMA_VERSION)
    expect(first.requests.map((request) => request.kind)).toEqual(["connector", "wire"])
    expect(first.records).toHaveLength(1)
    expect(first.records[0]?.provenance).toEqual(record.provenance)
    expect(first.records[0]?.offers[0]?.supplier).toBe("Budget")
    expect(first.unresolvedRequests).toEqual([
      { kind: "wire", mpn: "WIRE-MISSING", quantity: 5 }
    ])
    expect(first.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      SupplyDiagnosticCodes.Unresolved
    ])
    expect(JSON.stringify(records)).toBe(beforeRecords)
    expect(JSON.stringify(requests)).toBe(beforeRequests)
    expect(first.records[0]).not.toBe(record)
  })

  it("reports invalid price breaks instead of accepting non-finite/negative prices", () => {
    const invalid = connectorRecord({
      offers: [{
        supplier: "Bad",
        currency: "USD",
        priceBreaks: [{ minimumQuantity: 0, unitCost: -1 }],
        retrievedAt
      }]
    })
    const snapshot = createSupplySnapshot(
      [{ kind: "connector", mpn: "CONN-2" }],
      [staticSupplyProvider("bad", [invalid])],
      { capturedAt: retrievedAt }
    )
    expect(snapshot.diagnostics[0]?.code).toBe(SupplyDiagnosticCodes.InvalidPriceBreak)
    expect(selectSupplyPrice(invalid, 1)).toBeUndefined()
  })

  it("orders resolved records by kind and identity rather than request/provider order", () => {
    const wire: SupplyRecord = {
      kind: "wire",
      mpn: "WIRE-18-RD",
      lifecycle: "active",
      approval: "approved",
      alternates: [],
      compatibleTooling: [],
      compatibleProcesses: ["CUT-STRIP-18"],
      provenance: { source: "plm://wire", retrievedAt, qualification: "verified" },
      offers: []
    }
    const recipe: SupplyRecord = {
      kind: "process-recipe",
      id: "CUT-STRIP-18",
      lifecycle: "active",
      approval: "approved",
      alternates: [],
      compatibleTooling: ["CUTTER-1"],
      compatibleProcesses: [],
      provenance: { source: "mes://recipe/18", retrievedAt, qualification: "qualified" },
      offers: []
    }
    const provider = staticSupplyProvider("registry", [recipe, wire, connectorRecord()])
    const snapshot = createSupplySnapshot([
      { kind: "process-recipe", id: "CUT-STRIP-18" },
      { kind: "wire", mpn: "WIRE-18-RD" },
      { kind: "connector", mpn: "CONN-2" }
    ], [provider], { capturedAt: retrievedAt })

    expect(snapshot.records.map((record) =>
      record.kind === "process-recipe" ? `${record.kind}:${record.id}` : `${record.kind}:${record.mpn}`
    )).toEqual([
      "connector:CONN-2",
      "wire:WIRE-18-RD",
      "process-recipe:CUT-STRIP-18"
    ])
  })
})

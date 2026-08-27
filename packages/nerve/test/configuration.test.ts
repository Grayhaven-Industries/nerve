import { describe, expect, it } from "vitest"
import {
  ConfigurationIssueCodes,
  connector,
  defineProductFamily,
  enumerateConfigurations,
  harness,
  resolveConfiguration,
  wire,
  type ConnectorPart,
  type ProductFamily
} from "@grayhaven/nerve"

const housing: ConnectorPart = { mpn: "TEST-2", pinCount: 2 }
const source = connector("J1", housing, { pins: { 1: "PWR", 2: "AUX" } })
const load = connector("J2", housing, { pins: { 1: "PWR", 2: "AUX" } })
const base = harness("config-base", {
  revision: "A",
  units: "mm",
  connectors: [source, load],
  wires: [wire("W1", source.pin(1), load.pin(1), { length: 100 })]
})

const family = defineProductFamily({
  id: "controller",
  base,
  options: [
    {
      id: "long",
      patch: { wires: { override: { W1: { length: 250 } } } }
    },
    {
      id: "fused",
      requires: ["long"],
      patch: {
        protections: {
          add: [{ id: "F1", kind: "fuse", ratingA: 5, protects: ["W1"] }]
        }
      }
    },
    {
      id: "economy",
      excludes: ["fused"],
      patch: {}
    }
  ]
})

describe("product configuration", () => {
  it("resolves in family order and records canonical configuration metadata", () => {
    const before = JSON.stringify(family)
    const first = resolveConfiguration(family, {
      id: "controller-fused",
      optionIds: ["fused", "long"],
      revision: "B"
    })
    const second = resolveConfiguration(family, {
      id: "controller-fused",
      optionIds: ["long", "fused"],
      revision: "B"
    })

    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error("configuration should resolve")
    expect(first.optionIds).toEqual(["long", "fused"])
    expect(first.design.wires[0]?.length).toBe(250)
    expect(first.design.protections).toEqual([
      { id: "F1", kind: "fuse", ratingA: 5, protects: ["W1"] }
    ])
    expect(first.design.metadata).toMatchObject({
      configurationFamily: "controller",
      configurationOptions: '["long","fused"]',
      variantOf: "config-base"
    })
    expect(first.design.revision).toBe("B")
    expect(JSON.stringify(family)).toBe(before)
  })

  it("returns stable issues for selection and constraint failures", () => {
    const result = resolveConfiguration(family, {
      id: "bad",
      optionIds: ["missing", "fused", "economy", "fused"]
    })
    expect(result.ok).toBe(false)
    expect(result.optionIds).toEqual(["fused", "economy"])
    expect(result.issues.map((issue) => issue.code)).toEqual([
      ConfigurationIssueCodes.DuplicateSelection,
      ConfigurationIssueCodes.UnknownSelection,
      ConfigurationIssueCodes.UnsatisfiedRequirement,
      ConfigurationIssueCodes.MutuallyExcluded
    ])
    expect("design" in result).toBe(false)
  })

  it("rejects duplicate definitions and conflicting mutations/additions", () => {
    const broken: ProductFamily = {
      id: "broken",
      base,
      options: [
        { id: "a", patch: { wires: { override: { W1: { length: 150 } } } } },
        { id: "a", patch: {} },
        { id: "b", patch: { wires: { override: { W1: { length: 175 } } } } },
        {
          id: "c",
          patch: {
            connectors: { add: [source] }
          }
        }
      ]
    }
    const result = resolveConfiguration(broken, {
      id: "broken-output",
      optionIds: ["c", "b", "a"]
    })
    expect(result.ok).toBe(false)
    expect(result.issues.map((issue) => issue.code)).toEqual([
      ConfigurationIssueCodes.DuplicateOptionDefinition,
      ConfigurationIssueCodes.ConflictingMutation,
      ConfigurationIssueCodes.ConflictingMutation
    ])
    expect(result.issues.filter((issue) => issue.entityId).map((issue) => issue.entityId))
      .toEqual(["J1", "W1"])
  })

  it("merges compatible mutations of different fields on one entity", () => {
    const compatible = defineProductFamily({
      id: "compatible",
      base,
      options: [
        { id: "length", patch: { wires: { override: { W1: { length: 175 } } } } },
        { id: "color", patch: { wires: { override: { W1: { color: "blue" } } } } }
      ]
    })
    const result = resolveConfiguration(compatible, {
      id: "compatible-output",
      optionIds: ["color", "length"]
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("compatible patches should resolve")
    expect(result.optionIds).toEqual(["length", "color"])
    expect(result.design.wires[0]).toMatchObject({ length: 175, color: "blue" })
  })

  it("compares nested override values with canonical object-key order", () => {
    const nested = defineProductFamily({
      id: "nested",
      base,
      options: [
        {
          id: "forward",
          patch: { wires: { override: { W1: { stripLength: { from: 1, to: 2 } } } } }
        },
        {
          id: "reverse",
          patch: { wires: { override: { W1: { stripLength: { to: 2, from: 1 } } } } }
        },
        {
          id: "different",
          patch: { wires: { override: { W1: { stripLength: { to: 3, from: 1 } } } } }
        }
      ]
    })

    const same = resolveConfiguration(nested, {
      id: "nested-same",
      optionIds: ["reverse", "forward"]
    })
    expect(same.ok).toBe(true)
    if (!same.ok) throw new Error("equivalent nested values should resolve")
    expect(same.design.wires[0]?.stripLength).toEqual({ to: 2, from: 1 })

    const changed = resolveConfiguration(nested, {
      id: "nested-changed",
      optionIds: ["different", "forward"]
    })
    expect(changed.ok).toBe(false)
    expect(changed.issues[0]?.code).toBe(ConfigurationIssueCodes.ConflictingMutation)
  })

  it("enumerates only valid selections and fails explicitly at the guard", () => {
    const enumerated = enumerateConfigurations(family, { maximum: 8 })
    expect(enumerated).toEqual({
      ok: true,
      configurations: [[], ["long"], ["long", "fused"], ["economy"], ["long", "economy"]],
      issues: []
    })

    const guarded = enumerateConfigurations(family, { maximum: 4 })
    expect(guarded.ok).toBe(false)
    expect(guarded.configurations).toEqual([])
    expect(guarded.issues[0]?.code).toBe(ConfigurationIssueCodes.EnumerationLimit)
  })
})

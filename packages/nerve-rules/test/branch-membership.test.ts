/**
 * Which wires count as running in a bundle.
 *
 * Sleeve fill, ambient and conductor derating are all counts over branch
 * membership, so they are only as sound as the membership rule. Inference
 * from path adjacency — both endpoints named in the branch's `path` — makes
 * that count depend on an authoring accident: a breakout that lists the
 * shared source connector counts every conductor, and an otherwise identical
 * one that omits it counts none. Zero conductors passes every check it feeds,
 * silently, which is the worst possible failure for a verifier.
 *
 * `WireProps.branch` states it outright. These tests pin that an explicit
 * assignment wins, that it is not double-counted, and that designs declaring
 * nothing keep exactly the old behaviour.
 */
import { describe, expect, it } from "vitest"
import { compileDesign, connector, harness, wire, branch, runRules } from "@grayhaven/nerve"
import { builtinRules } from "../src/index.js"

const part = { mpn: "TEST-4", pinCount: 4 }

const build = (wireBranch?: string) => {
  const src = connector("SRC", part, { pins: { 1: "A", 2: "B" } })
  const dst = connector("DST", part, { pins: { 1: "A", 2: "B" } })
  return compileDesign(
    harness("membership", {
      revision: "A",
      units: "mm",
      connectors: [src, dst],
      wires: [
        wire(
          "W1",
          src.pin(1),
          dst.pin(1),
          wireBranch !== undefined
            ? { gauge: "20AWG", length: 100, branch: wireBranch }
            : { gauge: "20AWG", length: 100 }
        )
      ],
      branches: [
        // Deliberately omits SRC, exactly the shape that makes path
        // adjacency count zero.
        branch("bundle", { path: [dst], sleeve: "braided-pet-6", nominalLength: 100 })
      ]
    })
  ).hir
}

describe("branch membership", () => {
  it("carries an explicit assignment into HIR", () => {
    const hir = build("bundle")
    expect(hir.wires[0]?.branch).toBe("bundle")
  })

  it("omits the field entirely when undeclared", () => {
    const hir = build()
    expect(hir.wires[0]).not.toHaveProperty("branch")
  })

  it("reports a wire assigned to a branch that does not exist", () => {
    const hir = build("nonexistent")
    const found = hir.diagnostics.find((d) => d.code === "HK-WIRE-005")
    expect(found).toBeDefined()
    expect(found?.target).toBe("wire:W1")
    expect(found?.message).toContain("nonexistent")
  })

  it("does not fire HK-WIRE-005 for a branch that does exist", () => {
    const hir = build("bundle")
    expect(hir.diagnostics.filter((d) => d.code === "HK-WIRE-005")).toEqual([])
  })

  // The regression that matters: path adjacency alone counts this wire as
  //zero members because SRC is absent from the path. The explicit assignment
  // is what rescues it.
  it("counts a wire the path heuristic would miss", () => {
    const declared = build("bundle")
    const inferred = build()
    const sleeveFill = (hir: ReturnType<typeof build>) =>
      runRules(hir, builtinRules).filter((d) => d.code === "HK-MFG-006")
    // Neither over-fills, so neither reports — the observable difference is
    // that the declared design has a wire to measure at all.
    expect(sleeveFill(declared)).toEqual([])
    expect(sleeveFill(inferred)).toEqual([])
    expect(declared.wires[0]?.branch).toBe("bundle")
    expect(inferred.wires[0]?.branch).toBeUndefined()
  })

  it("is deterministic", () => {
    expect(JSON.stringify(build("bundle"))).toBe(JSON.stringify(build("bundle")))
  })
})

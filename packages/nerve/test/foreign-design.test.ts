/**
 * A design object built by a different copy of this library.
 *
 * The type system says a `ConnectorInstance` always has `pins`, `terminals`,
 * `seals` and `electrical`, and `connector()` always sets them — so at runtime
 * a connector missing one did not come from this build. The real-world route
 * is authoring a harness outside the workspace, where `@grayhaven/nerve`
 * resolves to a published build in the package cache while the compiler runs
 * from source. Both halves work; they are just not the same version.
 *
 * Before the guard this surfaced as `TypeError: Object.entries requires that
 * input parameter not be null or undefined` thrown from inside normalization,
 * naming neither the connector nor the cause. The compiler must report it and
 * keep going, because a crash has no diagnostic to read.
 */
import { describe, expect, it } from "vitest"
import { compileDesign, connector, harness, wire } from "../src/index.js"
import type { ConnectorInstance } from "../src/index.js"

const part = {
  mpn: "TEST-2",
  pinCount: 2
}

/** A connector as an older build would hand it over: no `electrical`. */
const foreignConnector = (ref: string): ConnectorInstance => {
  const c = connector(ref, part, { pins: { 1: "VBAT", 2: "GND" } })
  const { electrical: _dropped, ...rest } = c
  return rest as ConnectorInstance
}

describe("a design object from a foreign build", () => {
  const design = () => {
    const j1 = foreignConnector("J1")
    const m1 = connector("M1", part, { pins: { 1: "VBAT", 2: "GND" } })
    return harness("foreign-demo", {
      revision: "A",
      units: "mm",
      connectors: [j1, m1],
      wires: [wire("W1", j1.pin(1), m1.pin(1), { gauge: "20AWG", length: 100 })]
    })
  }

  it("reports rather than throwing", () => {
    expect(() => compileDesign(design())).not.toThrow()
  })

  it("names the connector, the missing field, and the version mismatch", () => {
    const { hir } = compileDesign(design())
    const found = hir.diagnostics.find((d) => d.code === "HK-DESIGN-001")
    expect(found).toBeDefined()
    expect(found?.severity).toBe("error")
    expect(found?.target).toBe("connector:J1")
    expect(found?.message).toContain("electrical")
    // The actionable half: without this the reader knows a field is missing
    // but not that two library copies are in play.
    expect(found?.message).toContain("@grayhaven/nerve")
  })

  it("leaves a well-formed design completely unaffected", () => {
    const j1 = connector("J1", part, { pins: { 1: "VBAT", 2: "GND" } })
    const m1 = connector("M1", part, { pins: { 1: "VBAT", 2: "GND" } })
    const { hir } = compileDesign(
      harness("clean-demo", {
        revision: "A",
        units: "mm",
        connectors: [j1, m1],
        wires: [wire("W1", j1.pin(1), m1.pin(1), { gauge: "20AWG", length: 100 })]
      })
    )
    expect(hir.diagnostics.filter((d) => d.code === "HK-DESIGN-001")).toEqual([])
    expect(hir.connectors).toHaveLength(2)
  })
})

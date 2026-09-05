/**
 * A part's own pinout through the compiler (PRD §9.2, §30).
 *
 * HK-CONN-011 compares a wire's declared signal against the pin assignment it
 * lands on, but both are written by the same author in the same file, so a
 * consistently wrong pinout — the mistake people actually make — agrees with
 * itself and compiles clean. `ConnectorPart.pinout` is the outside authority
 * that closes that hole: a bare housing has no pinout, but a device (sensor,
 * module, board header) has its pinout fixed by the thing itself.
 *
 * These tests pin the compiler's half of the contract. The pinout reaches HIR
 * intact and canonically ordered, pin names normalize to one spelling so a
 * comparison downstream cannot silently miss, a pinout that cannot be true of
 * its own part is reported here rather than travelling on, and — the hard
 * constraint — a design that declares no pinout compiles to exactly the bytes
 * it always did. Comparing the pinout against the design's pin assignments is
 * deliberately absent: that is a rule's job, and doing it here too would
 * produce two findings for one defect.
 *
 * Runs on vitest 4.1.10 (root devDependency, confirmed in bun.lock; the runner
 * for every workspace package). `toStrictEqual` is used where a key has to be
 * *absent* rather than merely undefined — v4 documents it as the matcher that
 * checks undefined-valued keys, which `toEqual` ignores. Compiled HIR decodes
 * through effect 3.22.0 Schema (the version bun.lock resolves from
 * `effect@^3.16.0`), where a missing optional key decodes back to a missing
 * key rather than to an explicit `undefined`.
 */
import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { compileDesign, connector, decodeHir, harness, wire } from "@grayhaven/nerve"
import type { ConnectorPart, HarnessDesign } from "../src/domain.js"
import motorController from "../../../examples/motor-controller/src/main.harness.js"
import robotPlatform from "../../../examples/robot-platform/src/main.harness.js"
import sensorSplice from "../../../examples/sensor-splice/src/main.harness.js"

/** A bare housing: pin 1 is whatever you crimp into it, so it fixes nothing. */
const housing: ConnectorPart = {
  mpn: "43025-0400",
  manufacturer: "Molex",
  description: "Micro-Fit 3.0 receptacle, 4 circuit",
  pinCount: 4
}

/** A device: the pinout is a property of the sensor, not of the harness. */
const sensor: ConnectorPart = {
  ...housing,
  mpn: "M12A-4P-SENSOR",
  description: "M12 A-coded 4-pin sensor",
  pinout: { 1: "V+", 2: "OUT2", 3: "GND", 4: "OUT1" }
}

const pinMap = { 1: "V+", 2: "OUT2", 3: "GND", 4: "OUT1" }

const compileWith = (part: ConnectorPart) => {
  const j1 = connector("J1", part, { pins: pinMap })
  const j2 = connector("J2", housing, { pins: pinMap })
  return compileDesign(
    // Named without the word this file is about, so the absence assertions can
    // stay plain substring checks over the whole serialized HIR.
    harness("device-part", {
      revision: "A",
      units: "mm",
      connectors: [j1, j2],
      wires: [wire("W1", j1.pin(1), j2.pin(1), { gauge: "22AWG", length: 300 })]
    })
  )
}

const connectorOf = (hir: ReturnType<typeof compileWith>["hir"], ref: string) =>
  hir.connectors.find((c) => c.ref === ref)!

describe("a part that declares no pinout", () => {
  const { hir, diagnostics } = compileWith(housing)

  it("compiles clean", () => {
    expect(diagnostics).toEqual([])
  })

  it("carries no pinout key at all", () => {
    const j1 = connectorOf(hir, "J1")
    // Absence, not undefined: the key must never appear in serialized HIR.
    expect("pinout" in j1).toBe(false)
    expect(Object.keys(j1)).toStrictEqual(["ref", "mpn", "manufacturer", "description", "pinCount", "pins"])
    expect(JSON.stringify(hir)).not.toContain("pinout")
  })

  it("treats a declared-but-empty pinout the same way", () => {
    // An empty record claims nothing about any pin, which is exactly what
    // declaring no pinout claims. Emitting `"pinout":{}` would put a key in
    // HIR that a reader could mistake for an authority with no signals.
    const { hir: empty } = compileWith({ ...housing, pinout: {} })
    expect("pinout" in connectorOf(empty, "J1")).toBe(false)
    expect(JSON.stringify(empty)).not.toContain("pinout")
  })
})

describe("a part that declares a pinout", () => {
  const { hir, diagnostics } = compileWith(sensor)

  it("compiles clean", () => {
    expect(diagnostics).toEqual([])
  })

  it("carries it into HIR unchanged", () => {
    expect(connectorOf(hir, "J1").pinout).toStrictEqual({
      1: "V+",
      2: "OUT2",
      3: "GND",
      4: "OUT1"
    })
  })

  it("leaves the housing beside it untouched", () => {
    expect("pinout" in connectorOf(hir, "J2")).toBe(false)
  })

  it("does not compare the pinout against the design's pin assignments", () => {
    // That comparison is a rule's job. A pinout that flatly contradicts the
    // harness must still compile clean here, or one defect yields two findings.
    const { diagnostics: contradicting } = compileWith({
      ...sensor,
      pinout: { 1: "GND", 2: "V+", 3: "OUT1", 4: "OUT2" }
    })
    expect(contradicting).toEqual([])
  })
})

describe("pin name normalization", () => {
  /**
   * The whole point of the field is to be compared against a pin assignment,
   * and pin assignments are keyed by `String(pin)`. A pinout that kept a
   * different spelling would not fail loudly — it would fail to match, which
   * looks exactly like agreement.
   */
  it("normalizes numeric and string pin keys to the same form", () => {
    const numeric = compileWith(sensor).hir
    const strings = compileWith({
      ...sensor,
      pinout: { "1": "V+", "2": "OUT2", "3": "GND", "4": "OUT1" }
    }).hir
    expect(JSON.stringify(strings)).toBe(JSON.stringify(numeric))
    expect(Object.keys(connectorOf(numeric, "J1").pinout!)).toStrictEqual([
      "1",
      "2",
      "3",
      "4"
    ])
  })

  it("orders pins numerically, not by authored key order", () => {
    // "10" must sort after "2", and the author's typing order must not reach
    // HIR: byte-identical output is a contract at every layer.
    const wide: ConnectorPart = { ...sensor, pinCount: 12 }
    const authored = compileWith({
      ...wide,
      pinout: { 10: "CAN_H", 2: "GND", 1: "V+" }
    }).hir
    const reordered = compileWith({
      ...wide,
      pinout: { 1: "V+", 2: "GND", 10: "CAN_H" }
    }).hir
    expect(Object.keys(connectorOf(authored, "J1").pinout!)).toStrictEqual([
      "1",
      "2",
      "10"
    ])
    expect(JSON.stringify(authored)).toBe(JSON.stringify(reordered))
  })

  it("keeps non-numeric pin names as authored, in stable order", () => {
    const lettered = compileWith({
      ...sensor,
      pinout: { C: "GND", A: "V+", B: "OUT1" }
    }).hir
    expect(Object.keys(connectorOf(lettered, "J1").pinout!)).toStrictEqual([
      "A",
      "B",
      "C"
    ])
  })
})

describe("a pinout that cannot be true of its part (HK-CONN-007)", () => {
  it("reports a pin beyond the part's own pinCount", () => {
    const { diagnostics } = compileWith({
      ...sensor,
      pinout: { 1: "V+", 5: "NOT_A_PIN" }
    })

    expect(diagnostics).toEqual([
      {
        code: "HK-CONN-007",
        severity: "error",
        message:
          "Connector J1 part M12A-4P-SENSOR declares a pinout for pin 5, but the part has 4 pins.",
        target: "connector:J1.pin:5",
        data: { mpn: "M12A-4P-SENSOR", pin: "5", pinCount: 4 }
      }
    ])
  })

  it("reports a pin the same part reserves", () => {
    const { diagnostics } = compileWith({
      ...sensor,
      reservedPins: [3],
      pinout: { 1: "V+", 3: "GND" }
    })

    expect(diagnostics).toEqual([
      {
        code: "HK-CONN-007",
        severity: "error",
        message:
          "Connector J1 part M12A-4P-SENSOR declares a pinout for pin 3, which the same part reserves.",
        target: "connector:J1.pin:3",
        data: { mpn: "M12A-4P-SENSOR", pin: "3" }
      }
    ])
  })

  it("matches a reserved pin written as a number against a pinout keyed as a string", () => {
    const { diagnostics } = compileWith({
      ...sensor,
      reservedPins: ["3"],
      pinout: { 3: "GND" }
    })
    expect(diagnostics.map((d) => d.code)).toEqual(["HK-CONN-007"])
  })

  it("passes a lettered pin name rather than guessing at it", () => {
    // `pinCount` counts cavities and says nothing about how they are labelled,
    // so "A1" is unjudgeable here. Flagging it would reject a legitimate
    // gridded part; the compiler stays silent instead.
    const { diagnostics } = compileWith({ ...sensor, pinout: { A1: "V+" } })
    expect(diagnostics).toEqual([])
  })

  it("adds nothing when pinCount is already invalid", () => {
    // The bad pinCount is reported once (HK-CONN-004); measuring a pinout
    // against it would be a second finding for one defect.
    const { diagnostics } = compileWith({
      ...sensor,
      pinCount: 0,
      pinout: { 1: "V+", 9: "OUT" }
    })
    expect(diagnostics.map((d) => d.code)).toEqual(["HK-CONN-004"])
  })
})

describe("HIR schema round trip", () => {
  it("survives encode and decode with the pinout intact", () => {
    const { hir } = compileWith(sensor)
    const decoded = decodeHir(JSON.parse(JSON.stringify(hir)))

    expect(decoded.connectors.find((c) => c.ref === "J1")!.pinout).toStrictEqual({
      1: "V+",
      2: "OUT2",
      3: "GND",
      4: "OUT1"
    })
    // Absence survives the round trip as absence, not as explicit undefined.
    expect("pinout" in decoded.connectors.find((c) => c.ref === "J2")!).toBe(false)
    expect(decoded).toEqual(hir)
  })
})

describe("determinism", () => {
  it("compiles the same design to byte-identical HIR twice", () => {
    expect(JSON.stringify(compileWith(sensor).hir)).toBe(
      JSON.stringify(compileWith(sensor).hir)
    )
  })

  /**
   * The hard constraint on this feature: no bundled part or example declares a
   * pinout, so every existing harness must compile to the bytes it compiled to
   * before the field existed.
   *
   * Each digest below was captured by compiling the example against the tree
   * immediately before the compiler change landed — `git show HEAD:...
   * compile.ts` written to a sibling module, both compilers run over all three
   * designs in one process, sha256 of `JSON.stringify(hir)` compared pairwise —
   * and re-checked after. Asserting the literal rather than "the snapshot did
   * not move" is deliberate: a snapshot regenerated in the same commit proves
   * nothing.
   */
  const bundled: ReadonlyArray<{
    readonly name: string
    readonly design: HarnessDesign
    readonly digest: string
    readonly bytes: number
  }> = [
    {
      name: "motor-controller",
      design: motorController,
      digest: "91b01b3703aedaf70631151f2066e90b4db6d8552831cfc85d5171045b831da7",
      bytes: 4274
    },
    {
      name: "robot-platform",
      design: robotPlatform,
      digest: "be5fdc5a430920aa266e606a22a3726b12ecf134fbe44475f5585664ab528205",
      bytes: 36139
    },
    {
      name: "sensor-splice",
      design: sensorSplice,
      digest: "d3c2ae90fc1b21a7b19ee50289a1e661793d7ea6a731e0d33be382fab7f54470",
      bytes: 4856
    }
  ]

  for (const { name, design, digest, bytes } of bundled) {
    it(`compiles examples/${name} to its pinned output`, () => {
      // Keep the historical pinout regression check after catalog assets were
      // added. Their complete HIR contract is covered in kicad-assets.test.ts.
      const json = JSON.stringify(compileDesign(design).hir, (key, value) =>
        key === "kicadAssets" ? undefined : value
      )

      expect(createHash("sha256").update(json).digest("hex")).toBe(digest)
      expect(Buffer.byteLength(json)).toBe(bytes)
    })
  }
})

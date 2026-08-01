/**
 * HK-CONN-023 / HK-CONN-024 (part-pinout contract).
 *
 * The property under test is narrower than "does it fire". These are the first
 * rules in the pack that judge a design against something the design did not
 * write, so what has to hold is that the outside authority is consulted only
 * where it exists: a part that declares no pinout, or declares one for some
 * pins only, must be indistinguishable from the world before these rules
 * existed. That is the common case by a wide margin, and it is the first
 * test in this file.
 *
 * vitest 4.1.10 (root package.json pins `^4.1.10`;
 * `node_modules/vitest/package.json` resolves to 4.1.10 — this package's own
 * devDependency `vitest@^3.2.4` resolves to 3.2.7 but the suite runs from the
 * workspace root). `describe` / `it` / `expect` with `toEqual`,
 * `toMatchObject` and `toHaveLength` confirmed against the v4.1.6 API docs via
 * Context7 (/vitest-dev/vitest/v4.1.6).
 */
import { describe, expect, it } from "vitest"
import {
  compileDesign,
  connector,
  harness,
  runRulesWithMargins,
  wire,
  type ConnectorInstance,
  type ConnectorPart,
  type Diagnostic,
  type HarnessDesign,
  type Hir,
  type WireDef
} from "@grayhaven/nerve"
import { pinoutPinUnassigned, pinoutRules, pinoutSignalContradiction } from "../src/pinout.js"
import motorController from "../../../examples/motor-controller/src/main.harness.js"
import sensorSplice from "../../../examples/sensor-splice/src/main.harness.js"
import robotPlatform from "../../../examples/robot-platform/src/main.harness.js"

const compile = (d: HarnessDesign): Hir => {
  const { hir, diagnostics } = compileDesign(d)
  // A fixture that does not compile cleanly would make every assertion below a
  // statement about the compiler instead of about the rule.
  expect(diagnostics.filter((x) => x.severity === "error")).toEqual([])
  return hir
}

/**
 * Attach a part pinout to compiled connectors the way the compiler carries
 * `part.pinout` into `HirConnector.pinout`.
 *
 * The fixtures below ALSO declare `pinout` on the `ConnectorPart` itself, so
 * once the compiler's carry lands this helper becomes a rewrite with identical
 * values rather than an injection, and every assertion here keeps meaning what
 * it means today. Same shape as the in-flight-field injection in
 * `nerve-exporters/test/routed-geometry.test.ts`.
 */
const withPinout = (
  hir: Hir,
  pinouts: Readonly<Record<string, Readonly<Record<string, string>>>>
): Hir => ({
  ...hir,
  connectors: hir.connectors.map((c) => {
    const declared = pinouts[c.ref]
    return declared === undefined ? c : { ...c, pinout: declared }
  })
})

/** A device: a part whose pinout is fixed by the thing behind the connector. */
const device = (mpn: string, pinout: Readonly<Record<string, string>>): ConnectorPart => ({
  mpn,
  pinCount: 4,
  pinout
})

/** A bare housing: pin 1 is whatever you crimp into it. */
const housing: ConnectorPart = { mpn: "MICROFIT-4", pinCount: 4 }

const build = (opts: {
  readonly connectors: ReadonlyArray<ConnectorInstance>
  readonly wires: ReadonlyArray<WireDef>
}): Hir =>
  compile(
    harness("pinout-fixture", {
      revision: "A",
      units: "mm",
      connectors: [...opts.connectors],
      wires: [...opts.wires]
    })
  )

const findings = (hir: Hir): ReadonlyArray<Diagnostic> =>
  runRulesWithMargins(hir, pinoutRules).diagnostics

const codes = (hir: Hir): ReadonlyArray<string> => findings(hir).map((d) => d.code)

const only = (hir: Hir, code: string): ReadonlyArray<Diagnostic> =>
  findings(hir).filter((d) => d.code === code)

/**
 * A four-pin sensor on J1 wired to a bare housing on J2.
 *
 * `sensorPins` is what the DESIGN assigns on J1; `sensorPinout` is what the
 * PART fixes. Every test below is one disagreement between those two records,
 * which is the whole point of the rule.
 */
const sensorHarness = (
  sensorPins: Readonly<Record<string, string>>,
  sensorPinout: Readonly<Record<string, string>> | undefined
): Hir => {
  const part =
    sensorPinout === undefined ? housing : device("SENSOR-4", sensorPinout)
  const j1 = connector("J1", part, { pins: sensorPins })
  const j2 = connector("J2", housing, { pins: sensorPins })
  const hir = build({
    connectors: [j1, j2],
    wires: Object.entries(sensorPins)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([pin, signal], i) =>
        wire(`W${i + 1}`, j1.pin(pin), j2.pin(pin), {
          signal,
          gauge: "20AWG",
          color: "black",
          length: 500
        })
      )
  })
  return sensorPinout === undefined ? hir : withPinout(hir, { J1: sensorPinout })
}

/** What the SENSOR-4 datasheet fixes. */
const DATASHEET = { 1: "VBAT_24V", 2: "GND", 3: "CAN_H", 4: "CAN_L" } as const

describe("a part that declares no pinout makes no claim", () => {
  it("produces nothing for a bare housing, however the design is wired", () => {
    // Deliberately implausible wiring: with no outside authority there is
    // nothing to contradict, and these rules must stay silent.
    expect(findings(sensorHarness({ 1: "GND", 2: "VBAT_24V", 3: "CAN_L", 4: "CAN_H" }, undefined)))
      .toEqual([])
    expect(findings(sensorHarness({ 1: "ANYTHING" }, undefined))).toEqual([])
  })

  it("produces nothing for pins a partial pinout does not mention", () => {
    // The part fixes pins 1 and 2 only; 3 and 4 are spare cavities the design
    // may use for whatever it likes.
    const hir = sensorHarness({ 1: "VBAT_24V", 2: "GND", 3: "SPARE_A", 4: "SPARE_B" }, {
      1: "VBAT_24V",
      2: "GND"
    })
    expect(findings(hir)).toEqual([])
  })
})

describe("HK-CONN-023 assignment contradicts the part", () => {
  it("passes a design that matches the part's pinout exactly", () => {
    expect(findings(sensorHarness({ ...DATASHEET }, { ...DATASHEET }))).toEqual([])
  })

  it("reports the pin, the expected signal and the assigned one", () => {
    // The classic self-consistent error: the connector went in rotated, so
    // CAN_H and CAN_L are swapped everywhere and the design agrees with itself.
    const hir = sensorHarness(
      { 1: "VBAT_24V", 2: "GND", 3: "CAN_L", 4: "CAN_H" },
      { ...DATASHEET }
    )
    const found = only(hir, "HK-CONN-023")
    expect(found).toHaveLength(2)
    expect(found[0]?.severity).toBe("error")
    expect(found[0]?.target).toBe("connector:J1.pin:3")
    expect(found[0]?.data).toMatchObject({
      mpn: "SENSOR-4",
      pin: "3",
      partSignal: "CAN_H",
      assignedSignal: "CAN_L"
    })
    expect(found[0]?.message).toContain("J1.3")
    expect(found[0]?.message).toContain("CAN_L")
    expect(found[0]?.message).toContain("CAN_H")
    // The part, not another line of the author's own file, is named as the
    // authority — a reader has to know where the claim came from.
    expect(found[0]?.message).toContain("SENSOR-4")
    expect(found[1]?.data).toMatchObject({ pin: "4", partSignal: "CAN_L", assignedSignal: "CAN_H" })
  })

  it("errors when a wire lands on a pin the part declares no-connect", () => {
    const hir = sensorHarness(
      { 1: "VBAT_24V", 2: "GND", 3: "CAN_H", 4: "SPARE" },
      { ...DATASHEET, 4: "NC" }
    )
    const found = only(hir, "HK-CONN-023")
    expect(found).toHaveLength(1)
    expect(found[0]?.severity).toBe("error")
    expect(found[0]?.message).toContain("no-connect")
    expect(found[0]?.data).toMatchObject({ pin: "4", partSignal: "NC", assignedSignal: "SPARE" })
  })

  it("carries the connector as a secondary target", () => {
    const hir = sensorHarness({ ...DATASHEET, 1: "GND" }, { ...DATASHEET })
    expect(only(hir, "HK-CONN-023")[0]?.targets).toEqual(["connector:J1"])
  })
})

describe("HK-CONN-024 a pin the part fixes, left unassigned", () => {
  it("warns, with its own code, when the design assigns nothing to a fixed pin", () => {
    // Pins 3 and 4 of the sensor (the CAN pair) are simply never brought out.
    const hir = sensorHarness({ 1: "VBAT_24V", 2: "GND" }, { ...DATASHEET })
    const found = only(hir, "HK-CONN-024")
    expect(found).toHaveLength(2)
    // Warning, not error: leaving a device pin unwired is a legitimate design
    // choice often enough that erroring would fail correct harnesses.
    expect(found.map((d) => d.severity)).toEqual(["warning", "warning"])
    expect(found[0]?.target).toBe("connector:J1.pin:3")
    expect(found[0]?.data).toMatchObject({ mpn: "SENSOR-4", pin: "3", partSignal: "CAN_H" })
    expect(found[0]?.message).toContain("SENSOR-4")
    // A different code from the mismatch finding, so the two can be waived
    // apart: a team accepting unused device pins is not accepting wrong ones.
    expect(only(hir, "HK-CONN-023")).toEqual([])
  })

  it("stays silent on an unassigned pin the part declares no-connect", () => {
    // The other branch: the part says nothing lands here, and nothing does.
    const hir = sensorHarness({ 1: "VBAT_24V", 2: "GND", 3: "CAN_H" }, {
      ...DATASHEET,
      4: "N/C"
    })
    expect(findings(hir)).toEqual([])
  })

  it("separates a wrong pin from a missing one on the same connector", () => {
    const hir = sensorHarness({ 1: "GND", 2: "VBAT_24V" }, { ...DATASHEET })
    expect(codes(hir)).toEqual([
      "HK-CONN-023",
      "HK-CONN-023",
      "HK-CONN-024",
      "HK-CONN-024"
    ])
  })
})

describe("signal naming: case-folded, and strict past that", () => {
  it("forgives case and surrounding whitespace", () => {
    const hir = sensorHarness(
      { 1: "vbat_24v", 2: " GND ", 3: "Can_H", 4: "CAN_L" },
      { ...DATASHEET }
    )
    expect(findings(hir)).toEqual([])
  })

  it("catches a ground synonym rather than forgiving it", () => {
    // GND_SIG is a plausible name for the same net, and it is still reported.
    // Forgiving it would need a ground classifier, and the same classifier
    // would forgive AGND landing on PGND — the defect this rule exists for.
    const hir = sensorHarness({ ...DATASHEET, 2: "GND_SIG" }, { ...DATASHEET })
    const found = only(hir, "HK-CONN-023")
    expect(found).toHaveLength(1)
    expect(found[0]?.data).toMatchObject({ partSignal: "GND", assignedSignal: "GND_SIG" })
  })

  it("catches a swapped differential pair rather than forgiving it", () => {
    const hir = sensorHarness({ ...DATASHEET, 3: "CAN_L", 4: "CAN_H" }, { ...DATASHEET })
    expect(only(hir, "HK-CONN-023")).toHaveLength(2)
  })

  it("catches a power rail at the wrong voltage", () => {
    const hir = sensorHarness({ ...DATASHEET, 1: "VBAT_12V" }, { ...DATASHEET })
    expect(only(hir, "HK-CONN-023")).toHaveLength(1)
  })
})

describe("scope, margins and determinism", () => {
  it("contributes no margins, on a passing design or a failing one", () => {
    // A pin either matches or it does not; there is no denominator anywhere in
    // the problem, and a fabricated slope would be followed by an optimizer.
    expect(
      runRulesWithMargins(sensorHarness({ ...DATASHEET }, { ...DATASHEET }), pinoutRules).margins
    ).toEqual([])
    expect(
      runRulesWithMargins(
        sensorHarness({ 1: "GND", 2: "VBAT_24V" }, { ...DATASHEET }),
        pinoutRules
      ).margins
    ).toEqual([])
  })

  it("is deterministic: the same HIR twice yields byte-identical diagnostics", () => {
    const hir = sensorHarness({ 1: "GND", 2: "VBAT_24V", 3: "CAN_L" }, { ...DATASHEET })
    const a = findings(hir)
    const b = findings(hir)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.length).toBeGreaterThan(0)
  })

  it("claims no standard, and carries a rule version", () => {
    for (const r of pinoutRules) {
      // The authority is the part's own datasheet, which is per-part data, not
      // a document a reviewer could look up. Naming one would be a fabrication.
      expect(r.standard).toBeUndefined()
      expect(r.clause).toBeUndefined()
      expect(r.ruleVersion).toBe("1.0.0")
    }
    expect(pinoutRules.map((r) => r.code)).toEqual(["HK-CONN-023", "HK-CONN-024"])
    expect([pinoutSignalContradiction, pinoutPinUnassigned].map((r) => r.name)).toEqual([
      "pinoutSignalContradiction",
      "pinoutPinUnassigned"
    ])
  })

  it("stays silent on the two examples that declare no pinout", () => {
    for (const design of [motorController, sensorSplice]) {
      const { hir } = compileDesign(design)
      expect(hir.connectors.every((c) => c.pinout === undefined)).toBe(true)
      expect(runRulesWithMargins(hir, pinoutRules)).toEqual({ diagnostics: [], margins: [] })
    }
  })

  // robot-platform models its IMU as a device part rather than a bare housing,
  // so these rules are exercised by a real harness and not only by fixtures.
  // A rule nothing runs is indistinguishable from a rule that cannot fire.
  it("is exercised by robot-platform's IMU module and finds it correct", () => {
    const { hir } = compileDesign(robotPlatform)
    const withPinout = hir.connectors.filter((c) => c.pinout !== undefined)

    expect(withPinout.map((c) => c.ref)).toEqual(["IMU1"])
    expect(withPinout[0]!.pinout).toEqual({
      "1": "5V_SENS",
      "2": "GND_SENS",
      "3": "CAN_H",
      "4": "CAN_L"
    })
    expect(runRulesWithMargins(hir, pinoutRules)).toEqual({ diagnostics: [], margins: [] })
  })
})

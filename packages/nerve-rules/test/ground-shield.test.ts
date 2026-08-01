// vitest 4.1.10 (resolved by bun.lock from the root `^4.1.10` range):
// describe/it/expect with `toEqual` deep-equality, per the v4 docs.
import { describe, expect, it } from "vitest"
import {
  compileDesign,
  connector,
  harness,
  runRules,
  splice,
  wire,
  type ConnectorPart,
  type Hir,
  type HarnessDesign,
  type WireProps
} from "@grayhaven/nerve"
import { shieldDrainUnconnected } from "@grayhaven/nerve-rules"
import { groundLoop, shieldTerminationScheme } from "../src/ground-shield.js"

const part: ConnectorPart = { mpn: "GS-4", pinCount: 4 }

const pins = { 1: "VBAT_24V", 2: "GND", 3: "SHIELD_DRAIN" }

const j1 = connector("J1", part, { pins })
const j2 = connector("J2", part, { pins })
const j3 = connector("J3", part, { pins })

const w = (
  id: string,
  from: Parameters<typeof wire>[1],
  to: Parameters<typeof wire>[2],
  props: WireProps = {}
) => wire(id, from, to, { gauge: "18AWG", color: "black", length: 100, ...props })

const compile = (d: HarnessDesign): Hir => compileDesign(d).hir

const fixture = (
  wires: HarnessDesign["wires"],
  splices: HarnessDesign["splices"] = []
): Hir =>
  compile(
    harness("ground-shield", {
      revision: "A",
      units: "mm",
      connectors: [j1, j2, j3],
      wires,
      splices
    })
  )

const s1 = splice("S1", { type: "crimp" })
const s2 = splice("S2", { type: "crimp" })
const s3 = splice("S3", { type: "crimp" })

/** Single-point star: three grounds meeting at one splice, no second path. */
const groundStar = fixture(
  [
    w("W1", j1.pin(2), s1, { signal: "GND" }),
    w("W2", j2.pin(2), s1, { signal: "GND" }),
    w("W3", j3.pin(2), s1, { signal: "GND" })
  ],
  [s1]
)

/** The same star plus a direct J1-J2 ground: W1 + W2 + W4 enclose a loop. */
const groundLoopHir = fixture(
  [
    w("W1", j1.pin(2), s1, { signal: "GND" }),
    w("W2", j2.pin(2), s1, { signal: "GND" }),
    w("W3", j3.pin(2), s1, { signal: "GND" }),
    w("W4", j1.pin(2), j2.pin(2), { signal: "GND" })
  ],
  [s1]
)

describe("HK-ELEC-022 groundLoop", () => {
  it("passes a single-point ground star", () => {
    expect(runRules(groundStar, [groundLoop])).toEqual([])
  })

  it("reports the loop once and names every participating wire", () => {
    const diagnostics = runRules(groundLoopHir, [groundLoop])
    expect(diagnostics).toEqual([
      {
        code: "HK-ELEC-022",
        severity: "warning",
        message:
          "Ground net GND forms a loop: wires W1, W2, W4 provide more than one return path between J1.2 and J2.2.",
        target: "wire:W4",
        targets: [
          "connector:J1.pin:2",
          "connector:J2.pin:2",
          "wire:W1",
          "wire:W2"
        ],
        data: { net: "GND", loopWires: "W1, W2, W4", loopLength: 3 }
      }
    ])
    // W3 hangs off the star and is not part of the return path.
    expect(diagnostics[0]?.message).not.toContain("W3")
  })

  it("reports one finding per independent loop, not per wire in it", () => {
    // Two closing wires over the same star: two independent loops.
    const twoLoops = fixture(
      [
        w("W1", j1.pin(2), s1, { signal: "GND" }),
        w("W2", j2.pin(2), s1, { signal: "GND" }),
        w("W3", j3.pin(2), s1, { signal: "GND" }),
        w("W4", j1.pin(2), j2.pin(2), { signal: "GND" }),
        w("W5", j2.pin(2), j3.pin(2), { signal: "GND" })
      ],
      [s1]
    )
    expect(runRules(twoLoops, [groundLoop]).map((d) => d.target)).toEqual([
      "wire:W4",
      "wire:W5"
    ])
  })

  it("ignores a loop that is not in the ground subgraph", () => {
    const powerLoop = fixture(
      [
        w("W1", j1.pin(1), s1, { signal: "VBAT_24V" }),
        w("W2", j2.pin(1), s1, { signal: "VBAT_24V" }),
        w("W3", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })
      ],
      [s1]
    )
    expect(runRules(powerLoop, [groundLoop])).toEqual([])
  })

  it("treats an unsignaled wire as ground only when both ends are ground points", () => {
    // W4 carries no signal but joins two GND-assigned pins: it closes the loop.
    const inferred = fixture(
      [
        w("W1", j1.pin(2), s1, { signal: "GND" }),
        w("W2", j2.pin(2), s1, { signal: "GND" }),
        w("W4", j1.pin(2), j2.pin(2))
      ],
      [s1]
    )
    expect(runRules(inferred, [groundLoop]).map((d) => d.target)).toEqual(["wire:W4"])

    // W5/W6 would close a J1.2-J3.1-J2.2 loop if signalless wires onto a
    // non-ground pin counted as ground. They do not, so nothing is reported.
    const ambiguous = fixture(
      [
        w("W1", j1.pin(2), s1, { signal: "GND" }),
        w("W2", j2.pin(2), s1, { signal: "GND" }),
        w("W5", j1.pin(2), j3.pin(1)),
        w("W6", j2.pin(2), j3.pin(1))
      ],
      [s1]
    )
    expect(runRules(ambiguous, [groundLoop])).toEqual([])
  })
})

/** Drain lands on S2, which a ground wire also lands on: one termination. */
const shieldSingleEnd = fixture(
  [
    w("W10", j2.pin(3), s2, { signal: "SHIELD_DRAIN", shieldGroup: "CBL1" }),
    w("W11", s2, j1.pin(2), { signal: "GND" })
  ],
  [s2]
)

/** Both drain ends reach ground: a loop closes through the shield itself. */
const shieldBothEnds = fixture(
  [
    w("W10", s2, s3, { signal: "SHIELD_DRAIN", shieldGroup: "CBL1" }),
    w("W11", s2, j1.pin(2), { signal: "GND" }),
    w("W12", s3, j2.pin(2), { signal: "GND" })
  ],
  [s2, s3]
)

/** Shield wired end to end but tied to ground nowhere. */
const shieldFloating = fixture([
  w("W10", j1.pin(3), j2.pin(3), { signal: "SHIELD_DRAIN", shieldGroup: "CBL1" })
])

describe("HK-ELEC-023 shieldTerminationScheme", () => {
  it("passes a shield terminated at exactly one end", () => {
    expect(runRules(shieldSingleEnd, [shieldTerminationScheme])).toEqual([])
  })

  it("reports double-ended termination as a scheme finding, not an error", () => {
    const diagnostics = runRules(shieldBothEnds, [shieldTerminationScheme])
    expect(diagnostics).toEqual([
      {
        code: "HK-ELEC-023",
        severity: "info",
        message:
          "Shield group CBL1 (wires W10) is terminated at 2 points (splice:S2, splice:S3); terminating both ends closes a ground loop through the shield. Single-end termination is the usual scheme; keep this only if it is a deliberate high-frequency choice.",
        target: "wire:W10",
        targets: ["splice:S2", "splice:S3"],
        data: { shieldGroup: "CBL1", terminations: 2, wires: "W10" }
      }
    ])
  })

  it("reports a floating shield with its own message and severity", () => {
    const diagnostics = runRules(shieldFloating, [shieldTerminationScheme])
    expect(diagnostics).toEqual([
      {
        code: "HK-ELEC-023",
        severity: "warning",
        message:
          "Shield group CBL1 (wires W10) is terminated at neither end; a floating shield attenuates nothing. Ground it at one end.",
        target: "wire:W10",
        data: { shieldGroup: "CBL1", terminations: 0, wires: "W10" }
      }
    ])
    expect(diagnostics[0]?.message).not.toBe(
      runRules(shieldBothEnds, [shieldTerminationScheme])[0]?.message
    )
  })

  it("counts terminations on the shield conductor, not on inner conductors", () => {
    // W13 is a named inner conductor of the same cable that happens to be a
    // ground return; it must not read as a second shield termination.
    const withInner = fixture(
      [
        w("W10", j2.pin(3), s2, { signal: "SHIELD_DRAIN", shieldGroup: "CBL1" }),
        w("W11", s2, j1.pin(2), { signal: "GND" }),
        w("W13", j1.pin(2), j2.pin(2), { signal: "GND", shieldGroup: "CBL1" })
      ],
      [s2]
    )
    expect(runRules(withInner, [shieldTerminationScheme])).toEqual([])
  })

  it("reports a pin-level ground termination the same as a splice one", () => {
    const ontoGroundPin = fixture([
      w("W10", j1.pin(2), j2.pin(2), { signal: "SHIELD_DRAIN", shieldGroup: "CBL1" })
    ])
    expect(
      runRules(ontoGroundPin, [shieldTerminationScheme]).map((d) => d.data?.terminations)
    ).toEqual([2])
  })
})

describe("ground and shield topology rules together", () => {
  it("produce no findings for a harness with no grounds and no shields", () => {
    const signalOnly = fixture([
      w("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })
    ])
    expect(runRules(signalOnly, [groundLoop, shieldTerminationScheme])).toEqual([])
  })

  it("do not restate what shieldDrainUnconnected already reports", () => {
    // J1.3/J2.3/J3.3 are assigned SHIELD_DRAIN and left unwired.
    const unwiredShieldPins = fixture([
      w("W1", j1.pin(1), j2.pin(1), { signal: "VBAT_24V" })
    ])
    const mine = runRules(unwiredShieldPins, [groundLoop, shieldTerminationScheme])
    const existing = runRules(unwiredShieldPins, [shieldDrainUnconnected])
    expect(existing.map((d) => d.code)).toEqual([
      "HK-ELEC-004",
      "HK-ELEC-004",
      "HK-ELEC-004"
    ])
    expect(mine).toEqual([])
  })

  it("are deterministic: the same design twice yields byte-identical diagnostics", () => {
    const rules = [groundLoop, shieldTerminationScheme]
    const once = JSON.stringify(runRules(groundLoopHir, rules))
    const twice = JSON.stringify(runRules(groundLoopHir, rules))
    expect(twice).toBe(once)

    const recompiled = fixture(
      [
        w("W1", j1.pin(2), s1, { signal: "GND" }),
        w("W2", j2.pin(2), s1, { signal: "GND" }),
        w("W3", j3.pin(2), s1, { signal: "GND" }),
        w("W4", j1.pin(2), j2.pin(2), { signal: "GND" })
      ],
      [s1]
    )
    expect(JSON.stringify(runRules(recompiled, rules))).toBe(once)
    expect(JSON.stringify(runRules(shieldBothEnds, rules))).toBe(
      JSON.stringify(runRules(shieldBothEnds, rules))
    )
  })

  it("carry stable codes and a rule version, and claim no standard", () => {
    expect([groundLoop, shieldTerminationScheme].map((r) => [r.name, r.code])).toEqual([
      ["groundLoop", "HK-ELEC-022"],
      ["shieldTerminationScheme", "HK-ELEC-023"]
    ])
    for (const r of [groundLoop, shieldTerminationScheme]) {
      expect(r.ruleVersion).toBe("1.0.0")
      // Ground-loop and shield-termination practice is engineering convention,
      // not a citable clause: an invented citation would be worse than none.
      expect(r.standard).toBeUndefined()
      expect(r.clause).toBeUndefined()
    }
  })
})

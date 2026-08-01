// Vitest 4.1.10 (root devDependency, resolved in bun.lock).
import { describe, expect, it } from "vitest"
import { compileDesign, variant } from "@grayhaven/nerve"
import { buildRecordJson, createBuildRecord } from "../src/build-record.js"
import { mergePatches, redlinesFromBuildRecord, resolveRedline, suggestPatch } from "../src/redline.js"
import { createRelease } from "../src/release.js"
import motor from "../../../examples/motor-controller/src/main.harness.js"

// Base fixture: W1/W2 are 420mm with no declared tolerance, W3/W4 carry no
// design length at all.
const { hir } = compileDesign(motor)
const release = createRelease(hir, {
  eco: { id: "ECO-001", reason: "Initial release" },
  createdAt: "2026-06-06"
})

// Same harness with a tolerance on W1 only, so precedence is observable.
const { hir: tolHir } = compileDesign(
  variant(motor, {
    id: "motor-controller-harness",
    wires: { override: { W1: { lengthTolerance: 5 } } }
  })
)
const tolRelease = createRelease(tolHir, {
  eco: { id: "ECO-002", reason: "Declare W1 length tolerance" },
  createdAt: "2026-06-06"
})

const options = {
  serial: "SN-0001",
  operator: "tech-a",
  buildDate: "2026-06-06"
}

describe("as-built lengths (PRD §36)", () => {
  it("omits the length fields entirely when nothing was measured", () => {
    const record = createBuildRecord(hir, release, [], options)
    expect(record).not.toHaveProperty("lengths")
    expect(record).not.toHaveProperty("lengthSummary")
    // Byte-identical to the pre-length shape: same keys, same order.
    expect(Object.keys(record)).toEqual([
      "recordVersion",
      "release",
      "hirFingerprint",
      "serial",
      "operator",
      "buildDate",
      "testProgramVersion",
      "results",
      "summary"
    ])
    const json = buildRecordJson(record)
    expect(json).not.toContain("lengths")
    expect(json).not.toContain("lengthSummary")
    // An empty observation list is still evidence of measuring nothing, so
    // it must not be confused with the absent case.
    const measured = createBuildRecord(hir, release, [], { ...options, lengths: [] })
    expect(measured.lengths).toEqual([])
    expect(measured.lengthSummary).toEqual({
      inTolerance: 0,
      outOfTolerance: 0,
      noDesignLength: 0
    })
  })

  it("passes a measurement inside the wire's own tolerance", () => {
    const record = createBuildRecord(tolHir, tolRelease, [], {
      ...options,
      lengths: [{ wire: "W1", measuredLength: 423 }]
    })
    expect(record.lengths).toEqual([
      {
        wire: "W1",
        designLength: 420,
        tolerance: 5,
        measuredLength: 423,
        delta: 3,
        verdict: "in-tolerance"
      }
    ])
    expect(record.lengthSummary).toEqual({
      inTolerance: 1,
      outOfTolerance: 0,
      noDesignLength: 0
    })
    // Evidence, not intent: the continuity verdict and status are untouched.
    expect(record.summary.status).toBe("incomplete")
  })

  it("fails a measurement outside tolerance with a signed delta", () => {
    const record = createBuildRecord(tolHir, tolRelease, [], {
      ...options,
      lengths: [{ wire: "W1", measuredLength: 380 }]
    })
    expect(record.lengths?.[0]).toMatchObject({ delta: -40, verdict: "out-of-tolerance" })
    const long = createBuildRecord(tolHir, tolRelease, [], {
      ...options,
      lengths: [{ wire: "W1", measuredLength: 460 }]
    })
    expect(long.lengths?.[0]).toMatchObject({ delta: 40, verdict: "out-of-tolerance" })
    expect(long.lengthSummary?.outOfTolerance).toBe(1)
  })

  it("reports wires with no design length instead of failing them", () => {
    // W3 has no length; NOPE is not in the HIR at all. Neither is judgeable.
    const record = createBuildRecord(hir, release, [], {
      ...options,
      lengths: [
        { wire: "W3", measuredLength: 500 },
        { wire: "NOPE", measuredLength: 100 }
      ]
    })
    expect(record.lengths).toEqual([
      { wire: "NOPE", measuredLength: 100, verdict: "no-design-length" },
      { wire: "W3", measuredLength: 500, verdict: "no-design-length" }
    ])
    expect(record.lengthSummary).toEqual({
      inTolerance: 0,
      outOfTolerance: 0,
      noDesignLength: 2
    })
  })

  it("uses defaultLengthTolerance only where the wire declares none", () => {
    const record = createBuildRecord(tolHir, tolRelease, [], {
      ...options,
      defaultLengthTolerance: 50,
      lengths: [
        { wire: "W1", measuredLength: 430 },
        { wire: "W2", measuredLength: 430 }
      ]
    })
    // W1's own 5mm tolerance wins over the 50mm default.
    expect(record.lengths?.[0]).toMatchObject({
      wire: "W1",
      tolerance: 5,
      verdict: "out-of-tolerance"
    })
    expect(record.lengths?.[1]).toMatchObject({
      wire: "W2",
      tolerance: 50,
      verdict: "in-tolerance"
    })
    // With no tolerance anywhere, any nonzero delta is out of tolerance.
    const strict = createBuildRecord(hir, release, [], {
      ...options,
      lengths: [{ wire: "W2", measuredLength: 421 }]
    })
    expect(strict.lengths?.[0]).toMatchObject({ verdict: "out-of-tolerance" })
    expect(strict.lengths?.[0]).not.toHaveProperty("tolerance")
  })
})

describe("length redlines from build records (PRD §39)", () => {
  const record = createBuildRecord(hir, release, [], {
    ...options,
    lengths: [
      // Deliberately out of id order on the way in.
      { wire: "W2", measuredLength: 455 },
      { wire: "W3", measuredLength: 500 },
      { wire: "W1", measuredLength: 460 }
    ]
  })

  it("emits one redline per out-of-tolerance verdict, with stable sorted ids", () => {
    const redlines = redlinesFromBuildRecord(record, { reportedBy: "tech-a" })
    expect(redlines.map((r) => r.id)).toEqual(["RL-W1", "RL-W2"])
    expect(redlines[0]).toMatchObject({
      target: "wire:W1",
      type: "incorrect-length",
      proposedValue: "460",
      release: release.releaseId,
      serial: "SN-0001",
      reportedBy: "tech-a",
      status: "open"
    })
    expect(redlines[0]?.description).toContain("420")
    expect(redlines[0]?.description).toContain("460")
    expect(redlines[0]?.description).toContain("+40")
    // W3 has no design length, so it yields nothing to redline.
    expect(redlines.some((r) => r.target === "wire:W3")).toBe(false)
    // Stable across regeneration, and honours the id prefix.
    expect(redlinesFromBuildRecord(record, { reportedBy: "tech-a" })).toEqual(redlines)
    expect(redlinesFromBuildRecord(record, { idPrefix: "SN1" }).map((r) => r.id)).toEqual([
      "SN1-W1",
      "SN1-W2"
    ])

    const clean = createBuildRecord(tolHir, tolRelease, [], {
      ...options,
      lengths: [{ wire: "W1", measuredLength: 422 }]
    })
    expect(redlinesFromBuildRecord(clean)).toEqual([])
  })

  it("round-trips measured lengths into one merged variant patch", () => {
    const patch = mergePatches(
      redlinesFromBuildRecord(record)
        .map((redline) =>
          resolveRedline(redline, {
            accept: true,
            reason: "Confirmed on the fixture.",
            by: "engineer-b",
            resolvedAt: "2026-06-07"
          })
        )
        .map(suggestPatch)
        .filter((p) => p !== undefined)
    )
    expect(patch).toEqual({
      wires: { override: { W1: { length: 460 }, W2: { length: 455 } } }
    })
    // The merged patch is exactly what variant() consumes.
    const revised = compileDesign(variant(motor, { id: "motor-controller-harness", ...patch })).hir
    expect(revised.wires.find((w) => w.id === "W1")?.length).toBe(460)
    expect(revised.wires.find((w) => w.id === "W2")?.length).toBe(455)
  })

  it("merges deeply, later patches winning, with canonically sorted keys", () => {
    const merged = mergePatches([
      { wires: { override: { W2: { length: 455 }, W1: { length: 460, gauge: "20AWG" } } } },
      { labels: { override: { L1: { text: "MOTOR CTRL B" } } } },
      { wires: { override: { W1: { length: 470 } } } }
    ])
    expect(merged.wires?.override?.["W1"]).toEqual({ gauge: "20AWG", length: 470 })
    expect(Object.keys(merged)).toEqual(["labels", "wires"])
    expect(Object.keys(merged.wires?.override ?? {})).toEqual(["W1", "W2"])
    expect(Object.keys(merged.wires?.override?.["W1"] ?? {})).toEqual(["gauge", "length"])
    expect(mergePatches([])).toEqual({})
  })

  it("serializes deterministically", () => {
    const build = () =>
      buildRecordJson(
        createBuildRecord(hir, release, [], {
          ...options,
          defaultLengthTolerance: 10,
          lengths: [
            { wire: "W2", measuredLength: 455 },
            { wire: "W1", measuredLength: 460 },
            { wire: "W4", measuredLength: 300 }
          ]
        })
      )
    expect(build()).toBe(build())
    expect(build().endsWith("\n")).toBe(true)
    expect(build()).not.toContain("\r")
  })
})

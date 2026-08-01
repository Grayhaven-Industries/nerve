import { describe, expect, it } from "vitest"
import { buildPacket } from "@grayhaven/nerve-exporters"
import {
  JPL_HARNESSES,
  JPL_SHOWCASE_SUMMARY,
  JPL_SOURCE
} from "../src/showcase/jpl-rover.js"

describe("NASA/JPL rover showcase", () => {
  it("is backed by the pinned open corpus rather than hand-authored demo data", () => {
    expect(JPL_SOURCE).toEqual({
      repository: "https://github.com/nasa-jpl/open-source-rover",
      commit: "50dca639560b4b8cebf1852e6c7c2048ac770762",
      path: "electrical/wiring/wireviz",
      license: "Apache-2.0"
    })
    expect(JPL_SHOWCASE_SUMMARY).toEqual({
      designs: 6,
      conductors: 28,
      ruleCount: 49,
      packetFiles: 22
    })
    expect(JPL_HARNESSES.every((proof) => proof.importDiagnostics.every((d) => d.severity !== "error"))).toBe(true)
  })

  it("shows the front encoder import integrity and review blockers separately", () => {
    const front = JPL_HARNESSES.find((proof) => proof.slug === "front-encoder")!
    expect(front.hir.wires.map((wire) => wire.length)).toEqual([540, 540, 530, 530, 530, 530])
    expect(front.reviewDiagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "HK-ELEC-003",
      "HK-CONN-011"
    ])
    expect(front.releaseReady).toBe(false)
    expect(front.testPlan.tests).toHaveLength(27)
    expect(front.schematic).toContain("<svg")
  })

  it("keeps the advertised evidence-packet count tied to the real exporter", async () => {
    const front = JPL_HARNESSES.find((proof) => proof.slug === "front-encoder")!
    const packet = await buildPacket(front.hir)
    expect(packet.files.size).toBe(JPL_SHOWCASE_SUMMARY.packetFiles)
  })
})

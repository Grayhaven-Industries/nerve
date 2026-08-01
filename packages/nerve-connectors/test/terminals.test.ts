/**
 * Terminal library integrity. These are numbers somebody sets a crimp press
 * from, so the assertions here are mostly about what must NOT be in the data:
 * no claimed verification tier the repo cannot back, and no acceptance window
 * without a document behind it.
 */
import { describe, expect, it } from "vitest"
import { parseAwg } from "@grayhaven/nerve"
import { allParts, allTerminals } from "../src/index.js"

/**
 * Terminals a housing names that this library deliberately does not model.
 *
 * 76823-0321 / 76823-0322 are the Mega-Fit female crimp terminals — 14/16AWG
 * and 12AWG respectively. They replaced 76650-0117 / 76650-0118, which were
 * never Mega-Fit parts at all: Molex's own datasheet for the sibling
 * 76650-0125 shows the 76650 block to be *kit* part numbers in the PicoBlade
 * family, 1.25mm pitch and 32-28AWG. The Mega-Fit tooling document naming
 * only the 76823 and 172063 series was the tell.
 *
 * They stay unmodelled here because their crimp process data could not be
 * read from a Molex document — the same reason no terminal in this library
 * carries a crimp height. The housings' gauge range is corrected regardless,
 * which is what the rules actually need.
 */
const NOT_YET_MODELLED: ReadonlyArray<string> = ["76823-0321", "76823-0322"]

describe("bundled terminal library", () => {
  it("every terminal's mpn matches its key", () => {
    expect(Object.keys(allTerminals).length).toBeGreaterThan(0)
    for (const [key, t] of Object.entries(allTerminals)) {
      expect(t.mpn, key).toBe(key)
    }
  })

  it("every terminal a housing names is modelled or explicitly deferred", () => {
    const referenced = new Set<string>()
    for (const p of Object.values(allParts)) {
      for (const mpn of p.compatibleTerminals ?? []) referenced.add(mpn)
    }
    expect(referenced.size).toBeGreaterThan(0)
    for (const mpn of referenced) {
      const known = allTerminals[mpn] !== undefined || NOT_YET_MODELLED.includes(mpn)
      expect(known, `${mpn} is neither modelled nor on the deferred list`).toBe(true)
    }
  })

  it("nothing claims the verified tier", () => {
    // "verified" in this repo means a human checked a physical sample or a
    // catalog. Nothing assembled from fetched documents may claim it, and
    // this assertion is here so the ceiling cannot be raised quietly.
    for (const [key, t] of Object.entries(allTerminals)) {
      expect(t.provenance?.verification, key).not.toBe("verified")
    }
  })

  it("a crimp height never ships without the document it came from", () => {
    for (const [key, t] of Object.entries(allTerminals)) {
      if (t.crimpHeight === undefined) continue
      expect(t.provenance?.datasheet, key).toBeDefined()
      expect(t.crimpHeight.max, key).toBeGreaterThan(t.crimpHeight.min)
    }
  })

  it("gauge ranges parse and run thin to thick", () => {
    // gauge.ts: a larger AWG number is a thinner wire, so `min` — the
    // thinnest conductor accepted — is the higher number of the two.
    for (const [key, t] of Object.entries(allTerminals)) {
      if (t.wireGaugeRange === undefined) continue
      const thin = parseAwg(t.wireGaugeRange.min)
      const thick = parseAwg(t.wireGaugeRange.max)
      expect(thin, key).toBeDefined()
      expect(thick, key).toBeDefined()
      expect(thin!, key).toBeGreaterThan(thick!)
    }
  })

  it("insulation diameter ranges run low to high", () => {
    for (const [key, t] of Object.entries(allTerminals)) {
      if (t.insulationDiameterRange === undefined) continue
      expect(t.insulationDiameterRange.max, key).toBeGreaterThan(t.insulationDiameterRange.min)
    }
  })

  it("is deterministic across imports", async () => {
    const a = await import("../src/terminals.js")
    const b = await import("../src/terminals.js")
    expect(Object.keys(a.allTerminals)).toEqual(Object.keys(b.allTerminals))
    expect(JSON.stringify(a.allTerminals)).toBe(JSON.stringify(b.allTerminals))
  })
})

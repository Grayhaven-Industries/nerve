/** Library-wide integrity: every part in every family is well-formed. */
import { describe, expect, it } from "vitest"
import { parseAwg } from "@grayhaven/nerve-rules"
import { allParts, DeutschDT, nerveConnectorsProvider } from "../src/index.js"

describe("bundled part library", () => {
  it("every part is internally consistent", () => {
    expect(Object.keys(allParts).length).toBeGreaterThanOrEqual(19)
    for (const [key, p] of Object.entries(allParts)) {
      expect(p.mpn, key).toBe(key)
      expect(p.pinCount, key).toBeGreaterThan(0)
      expect(p.provenance?.verification, key).toBeDefined()
      expect(p.provenance?.lastVerified, key).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (p.cavityLayout !== undefined) {
        expect(p.cavityLayout.rows * p.cavityLayout.columns, key).toBeGreaterThanOrEqual(p.pinCount)
      }
      if (p.wireGaugeRange !== undefined) {
        const thin = parseAwg(p.wireGaugeRange.min)
        const thick = parseAwg(p.wireGaugeRange.max)
        expect(thin, key).toBeDefined()
        expect(thick, key).toBeDefined()
        // AWG: larger number = thinner wire; min names the thinnest accepted.
        expect(thin!, key).toBeGreaterThanOrEqual(thick!)
      }
    }
  })

  it("mating references resolve within the library", () => {
    const byMpn = new Map(Object.entries(allParts))
    for (const [key, p] of Object.entries(allParts)) {
      if (p.matingMpn === undefined) continue
      // Headers (JST B*B-*) are PCB-side and intentionally out of library scope.
      if (/^B\d+B-/.test(p.matingMpn)) continue
      const mate = byMpn.get(p.matingMpn)
      expect(mate, `${key} mates ${p.matingMpn}`).toBeDefined()
      expect(mate?.matingMpn, key).toBe(key)
    }
  })

  it("DT plugs and receptacles pair with opposite genders", () => {
    expect(DeutschDT["DT06-2S"].gender).not.toBe(DeutschDT["DT04-2P"].gender)
  })

  it("the bundled provider serves and searches the library", () => {
    expect(nerveConnectorsProvider.get("PHR-4")?.family).toBe("PH")
    expect(nerveConnectorsProvider.search?.("mega-fit")).toContain("76829-0008")
  })
})

describe("compact part specs (footprinter-style)", () => {
  it("resolves specs, raw MPNs, and case-insensitively", async () => {
    const { part } = await import("../src/part-spec.js")
    expect(part("microfit-2x8").mpn).toBe("43025-1600")
    expect(part("DT-4S").mpn).toBe("DT06-4S")
    expect(part("xt60-f").gender).toBe("receptacle")
    expect(part("PHR-3").mpn).toBe("PHR-3") // raw MPN passthrough
  })

  it("every spec resolves to a real library part", async () => {
    const { part, partSpecs } = await import("../src/part-spec.js")
    for (const [spec, mpn] of Object.entries(partSpecs)) {
      expect(part(spec).mpn, spec).toBe(mpn)
    }
  })

  it("fails loudly with the menu on unknown specs", async () => {
    const { part } = await import("../src/part-spec.js")
    expect(() => part("nonexistent-99")).toThrow(/Compact specs:/)
  })

  it("normalizes real-world spellings: prefixes, separators, case", async () => {
    const { part } = await import("../src/part-spec.js")
    // Vendor-prefixed and re-hyphenated spellings.
    expect(part("JST PH-3").mpn).toBe("PHR-3")
    expect(part("jst_ph 3").mpn).toBe("PHR-3")
    expect(part("Micro-Fit-8").mpn).toBe("43025-0800")
    expect(part("XT-60-m").mpn).toBe("XT60PW-M")
    expect(part("Deutsch DT-4S").mpn).toBe("DT06-4S")
    // Raw MPN, any case.
    expect(part("phr-3").mpn).toBe("PHR-3")
    expect(part("dt06-4s").mpn).toBe("DT06-4S")
  })

  it("pins the full error contract: verbatim input + complete menu", async () => {
    const { part, partSpecs } = await import("../src/part-spec.js")
    try {
      part("DT06 4X")
      expect.fail("should throw")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // The user's input is quoted verbatim (not the normalized form)…
      expect(msg).toContain('Unknown part spec "DT06 4X"')
      // …and every compact spec is in the menu.
      for (const spec of Object.keys(partSpecs)) expect(msg).toContain(spec)
      expect(msg).toContain("or any library MPN")
    }
  })
})

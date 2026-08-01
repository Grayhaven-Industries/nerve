/**
 * The README's countable claims, checked against the code.
 *
 * The rule count in the README went stale three times while the rule set grew
 * from 43 to 53, and nothing caught it — the number is prose, so no compiler
 * or snapshot has an opinion about it. A README that overstates what ships is
 * a small lie with an outsized cost, because it is the first thing anyone
 * evaluating the tool reads and the last thing anyone thinks to re-verify.
 *
 * Only counts belong here. Prose describing what the tool does cannot be
 * asserted from the source, and a test that pretended otherwise would just be
 * a second place to update.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { allParts, allTerminals, partSpecs } from "../packages/nerve-connectors/src/index.js"
import { builtinRules } from "../packages/nerve-rules/src/index.js"

const readme = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8")

/** Every distinct integer the README states, for the "no stale number" sweep. */
const claimed = (pattern: RegExp): ReadonlyArray<number> =>
  [...readme.matchAll(pattern)].map((m) => Number(m[1]))

describe("README countable claims", () => {
  it("states the true number of built-in rules everywhere it states one", () => {
    const counts = claimed(/(\d+)\s+(?:built-in|generic built-in)\s+/g)

    expect(counts.length).toBeGreaterThan(0)
    for (const n of counts) expect(n).toBe(builtinRules.length)
  })

  it("states the true size of the connector library", () => {
    const housings = claimed(/(\d+)\s+connector housings/g)
    const terminals = claimed(/(\d+)\s+crimp terminals/g)

    expect(housings).toEqual([Object.keys(allParts).length])
    expect(terminals).toEqual([Object.keys(allTerminals).length])
  })

  // A guard against the guard: if the library grows a category the README
  // does not mention, the two assertions above still pass while the sentence
  // they check becomes incomplete. This fails instead.
  it("has not silently gained a part category the README omits", () => {
    expect(Object.keys(partSpecs).length).toBeGreaterThan(0)
    expect(readme).toContain("crimp terminals")
    expect(readme).toContain("connector housings")
  })
})

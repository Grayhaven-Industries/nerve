import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { applyPatch, applyProjectPatch, parseToolCall } from "../src/lib/ai.js"
import { ENTRY_FILE } from "../src/lib/sources.js"

const SRC = `const a = wire("W1", j1.pin(1), j2.pin(1), { gauge: "20AWG" })
const b = wire("W2", j1.pin(2), j2.pin(2), { gauge: "20AWG" })
`

describe("agent patch engine", () => {
  it("applies a unique replacement exactly once", () => {
    const r = applyPatch(SRC, { name: "edit_harness_source", old_string: '"W1"', new_string: '"W9"' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.next).toContain('"W9"')
      expect(r.next).not.toContain('"W1"')
      expect(r.next).toContain('"W2"') // untouched
    }
  })

  it("rejects a missing old_string with a retryable report", () => {
    const r = applyPatch(SRC, { name: "edit_harness_source", old_string: "nope", new_string: "x" })
    expect(r).toEqual({ ok: false, report: expect.stringContaining("not found") })
  })

  it("rejects a non-unique old_string instead of guessing", () => {
    const r = applyPatch(SRC, {
      name: "edit_harness_source",
      old_string: '"20AWG"',
      new_string: '"16AWG"'
    })
    expect(r).toEqual({ ok: false, report: expect.stringContaining("not unique") })
  })

  it("rewrite replaces wholesale; unknown tools are refused", () => {
    const r = applyPatch(SRC, { name: "rewrite_harness_source", source: "x" })
    expect(r).toEqual({ ok: true, next: "x" })
    expect(parseToolCall("delete_everything", "{}")).toBeUndefined()
    expect(parseToolCall("rewrite_harness_source", "not json")).toBeUndefined()
  })

  it("a patch with an explicit path targets that file and leaves the entry file untouched", () => {
    const variant = `import base from "../main.harness.js"\nexport default base\n`
    const files = { [ENTRY_FILE]: SRC, "/variants/long.ts": variant }

    const r = applyProjectPatch(files, {
      name: "edit_harness_source",
      path: "/variants/long.ts",
      old_string: "export default base",
      new_string: "export default base // long SKU"
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.path).toBe("/variants/long.ts")
      expect(r.next).toContain("// long SKU")
    }
    expect(files[ENTRY_FILE]).toBe(SRC) // entry untouched

    // No path → the entry file, byte-identical to the single-file contract.
    const d = applyProjectPatch(files, {
      name: "edit_harness_source",
      path: null,
      old_string: '"W1"',
      new_string: '"W9"'
    })
    expect(d.ok).toBe(true)
    if (d.ok) expect(d.path).toBe(ENTRY_FILE)

    // Unknown path → error result naming the valid paths, not a throw.
    const u = applyProjectPatch(files, {
      name: "rewrite_harness_source",
      path: "/nope.ts",
      source: "x"
    })
    expect(u).toEqual({ ok: false, report: expect.stringContaining("/variants/long.ts") })
  })

  it("property: a successful edit changes exactly the replaced span", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ maxLength: 20 }),
        (doc, needle, replacement) => {
          const r = applyPatch(doc, {
            name: "edit_harness_source",
            old_string: needle,
            new_string: replacement
          })
          const occurrences = doc.split(needle).length - 1
          if (occurrences === 1) {
            expect(r.ok).toBe(true)
            if (r.ok) expect(r.next).toBe(doc.replace(needle, () => replacement))
          } else {
            expect(r.ok).toBe(false)
          }
        }
      ),
      { numRuns: 500 }
    )
  })
})

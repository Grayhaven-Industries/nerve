/**
 * Object store (§8, §10.2, §9.4 step 6).
 *
 * The refusals are the substance here. A store that only round-trips records
 * is a map; what makes this one worth having is that it will not let a
 * fingerprint mean two things, and will not let a release be lost to a race.
 */
import { describe, expect, it } from "vitest"

import {
  fingerprint,
  memoryStore,
  StoreCodes,
  StoreError,
  type Canonical
} from "@grayhaven/nerve-platform"

const record = (n: number): Canonical => ({ kind: "candidate", n, nested: { a: [1, 2] } })

describe("immutable objects", () => {
  it("stores a record under its own digest and reads it back", () => {
    const store = memoryStore()
    const r = record(1)
    const id = fingerprint(r)
    expect(store.put("release-candidate", id, r)).toBe("stored")
    expect(store.get("release-candidate", id)).toEqual(r)
    expect(store.has("release-candidate", id)).toBe(true)
  })

  /** ING-007: identical content reuses storage rather than minting a revision. */
  it("reports a second identical put as reused", () => {
    const store = memoryStore()
    const r = record(1)
    const id = fingerprint(r)
    expect(store.put("source-set", id, r)).toBe("stored")
    expect(store.put("source-set", id, r)).toBe("reused")
    expect(store.list("source-set")).toEqual([id])
  })

  it("treats a key-reordered record as the same object", () => {
    const store = memoryStore()
    const id = fingerprint({ a: 1, b: 2 })
    expect(store.put("policy", id, { a: 1, b: 2 })).toBe("stored")
    // Same content, different insertion order: canonical encoding makes these
    // one object, so this must reuse rather than conflict.
    expect(store.put("policy", id, { b: 2, a: 1 })).toBe("reused")
  })

  /**
   * The integrity check. Filing a record under an identity it does not hash to
   * is how a release ends up pointing at evidence that was never approved
   * (§10.2), so the store refuses rather than trusting the caller's label.
   */
  it("refuses a record filed under an identity it does not hash to", () => {
    const store = memoryStore()
    const wrong = fingerprint(record(999))
    expect(() => store.put("release", wrong, record(1))).toThrowError(StoreError)
    try {
      store.put("release", wrong, record(1))
    } catch (error) {
      expect((error as StoreError).code).toBe(StoreCodes.FingerprintMismatch)
    }
    expect(store.has("release", wrong)).toBe(false)
  })

  it("keeps namespaces separate", () => {
    const store = memoryStore()
    const r = record(1)
    const id = fingerprint(r)
    store.put("review-run", id, r)
    expect(store.has("review-run", id)).toBe(true)
    expect(store.has("release", id)).toBe(false)
  })

  /**
   * A record handed out and then mutated must not corrupt what the store
   * holds, or the digest would stop describing its content without any write
   * having taken place.
   */
  it("does not let a caller mutate a stored record through the value it got back", () => {
    const store = memoryStore()
    const r = record(1)
    const id = fingerprint(r)
    store.put("release", id, r)

    const handed = store.get("release", id) as { n: number }
    handed.n = 42
    expect(store.get("release", id)).toEqual(record(1))

    // The same must hold for the value that was passed in.
    const mutable = { kind: "candidate", n: 7 }
    const mid = fingerprint(mutable)
    store.put("release-candidate", mid, mutable)
    mutable.n = 8
    expect(fingerprint(store.get("release-candidate", mid) as Canonical)).toBe(mid)
  })
})

describe("release pointer (§9.4 step 6)", () => {
  const a = fingerprint({ release: "a" })
  const b = fingerprint({ release: "b" })
  const c = fingerprint({ release: "c" })

  it("claims an unset pointer and then supersedes it", () => {
    const store = memoryStore()
    store.advance("harness:motor-controller", undefined, a)
    expect(store.pointer("harness:motor-controller")).toBe(a)
    store.advance("harness:motor-controller", a, b)
    expect(store.pointer("harness:motor-controller")).toBe(b)
  })

  it("refuses to claim a name that is already held", () => {
    const store = memoryStore()
    store.advance("h", undefined, a)
    try {
      store.advance("h", undefined, b)
      throw new Error("expected a refusal")
    } catch (error) {
      expect((error as StoreError).code).toBe(StoreCodes.PointerConflict)
    }
    expect(store.pointer("h")).toBe(a)
  })

  /**
   * The lost-update case. Two reviewers promote different candidates from the
   * same observed release; the second must fail rather than quietly erase the
   * first, because a superseded release is still part of the record (§9.4
   * step 6).
   */
  it("refuses a supersession based on a stale observation", () => {
    const store = memoryStore()
    store.advance("h", undefined, a)
    store.advance("h", a, b) // first writer wins
    try {
      store.advance("h", a, c) // second still believes `a` is current
      throw new Error("expected a refusal")
    } catch (error) {
      expect((error as StoreError).code).toBe(StoreCodes.PointerConflict)
    }
    expect(store.pointer("h")).toBe(b)
  })

  it("refuses to supersede a pointer that was never set", () => {
    const store = memoryStore()
    try {
      store.advance("h", a, b)
      throw new Error("expected a refusal")
    } catch (error) {
      expect((error as StoreError).code).toBe(StoreCodes.PointerMissing)
    }
    expect(store.pointer("h")).toBeUndefined()
  })
})

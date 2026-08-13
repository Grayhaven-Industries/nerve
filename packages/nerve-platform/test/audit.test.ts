import { Schema } from "effect"
import { describe, expect, it } from "vitest"
import type { AuditEntry, AuditEntryInput } from "../src/audit.js"
import * as auditModule from "../src/audit.js"
import { AuditEntry as AuditEntrySchema, appendAuditEntry, verifyAuditLog } from "../src/audit.js"

const invite: AuditEntryInput = {
  actor: "u1",
  action: "member:invite",
  organizationId: "org1",
  at: "2026-01-01T00:00:00Z"
}

const approve: AuditEntryInput = {
  actor: "u2",
  action: "review:approve",
  organizationId: "org1",
  projectId: "p1",
  subject: "review:R7",
  at: "2026-01-02T00:00:00Z"
}

const publish: AuditEntryInput = {
  actor: "u3",
  action: "release:publish",
  organizationId: "org1",
  projectId: "p1",
  subject: "release:REL1",
  at: "2026-01-03T00:00:00Z"
}

const log = (): ReadonlyArray<AuditEntry> =>
  [invite, approve, publish].reduce<ReadonlyArray<AuditEntry>>(
    (acc, entry) => appendAuditEntry(acc, entry),
    []
  )

describe("appendAuditEntry (ORG-006)", () => {
  it("decodes as an AuditEntry", () => {
    const entries = log()
    for (const entry of entries) {
      expect(Schema.decodeUnknownSync(AuditEntrySchema)(entry)).toEqual(entry)
    }
  })

  it("leaves the first entry unlinked and links every later one", () => {
    const entries = log()
    expect(entries).toHaveLength(3)
    expect(entries[0]?.previousHash).toBeUndefined()
    expect(entries[1]?.previousHash).toBe(entries[0]?.hash)
    expect(entries[2]?.previousHash).toBe(entries[1]?.hash)
  })

  it("does not mutate the log it was given", () => {
    const first = appendAuditEntry([], invite)
    const second = appendAuditEntry(first, approve)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
  })

  it("is deterministic: the same appends produce the same hashes", () => {
    expect(log().map((entry) => entry.hash)).toEqual(log().map((entry) => entry.hash))
  })

  /**
   * ORG-006 promises that a rewritten past entry breaks its own hash, so every
   * field the entry records must be covered by that hash. Checking one field
   * would leave the others free to be rewritten silently: an action could be
   * downgraded from `release:publish` to `project:read`, a subject repointed at
   * another release, or a timestamp backdated, and the chain would still verify.
   * One case per hashed field keeps that hole closed as the entry grows.
   */
  for (
    const [field, value] of [
      ["actor", "u9"],
      ["action", "project:read"],
      ["organizationId", "org2"],
      ["projectId", "p9"],
      ["subject", "release:REL9"],
      ["at", "2026-01-09T00:00:00Z"]
    ] as const
  ) {
    it(`gives a different hash when ${field} changes`, () => {
      const a = appendAuditEntry([], approve)[0]
      const b = appendAuditEntry([], { ...approve, [field]: value })[0]
      expect(a?.hash).not.toBe(b?.hash)
    })
  }
})

describe("verifyAuditLog (ORG-006)", () => {
  it("accepts an intact chain, including the empty log", () => {
    expect(verifyAuditLog([])).toBeUndefined()
    expect(verifyAuditLog(log())).toBeUndefined()
  })

  it("reports the index of an entry whose content was rewritten", () => {
    const entries = log()
    const first = entries[0]
    if (first === undefined) throw new Error("expected an entry")
    const tampered = [{ ...first, actor: "impostor" }, ...entries.slice(1)]
    expect(verifyAuditLog(tampered)).toBe(0)
  })

  /**
   * Repointing an approval at another object is the rewrite ORG-006 exists to
   * catch, and it touches neither the actor nor the first entry, so it proves
   * the check reads the whole entry at every position rather than one field at
   * the head of the log.
   */
  it("reports an entry whose subject was repointed", () => {
    const entries = log()
    const second = entries[1]
    if (second === undefined) throw new Error("expected an entry")
    const tampered = [...entries.slice(0, 1), { ...second, subject: "review:R9" }, ...entries.slice(2)]
    expect(verifyAuditLog(tampered)).toBe(1)
  })

  it("reports the rewritten entry even when its own hash is recomputed", () => {
    // The strongest attack available without the later entries: rewrite the
    // entry and restamp its hash so it is internally consistent. The next
    // entry still records the old link, so the break surfaces there.
    const entries = log()
    const forged = appendAuditEntry([], { ...invite, actor: "impostor" })[0]
    if (forged === undefined) throw new Error("expected an entry")
    expect(verifyAuditLog([forged, ...entries.slice(1)])).toBe(1)
  })

  it("reports a deleted middle entry", () => {
    const entries = log()
    expect(verifyAuditLog([...entries.slice(0, 1), ...entries.slice(2)])).toBe(1)
  })

  it("reports a reordered pair", () => {
    const entries = log()
    const [a, b, c] = entries
    if (a === undefined || b === undefined || c === undefined) throw new Error("expected 3 entries")
    expect(verifyAuditLog([a, c, b])).toBe(1)
  })

  it("exposes no way to update or delete an existing entry", () => {
    expect(Object.keys(auditModule).filter((name) => /update|delete|remove|set/i.test(name))).toEqual([])
  })
})

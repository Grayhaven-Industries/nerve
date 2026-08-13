/**
 * Append-only audit log (PRD ORG-006).
 *
 * A log that can be edited proves nothing, so this module offers no update
 * and no delete: the only writing operation returns a new log with one more
 * entry on the end. That alone would still let someone rewrite the stored
 * history, so each entry hashes its own content together with the hash of the
 * entry before it. Changing any past entry changes its hash, which breaks the
 * link every later entry recorded, and `verifyAuditLog` reports where.
 *
 * The chain uses the same canonical fingerprint as the release objects, so an
 * auditor recomputing a link uses one encoding rule for the whole platform.
 *
 * Schema APIs here follow effect 3.22.1 (the version installed for this
 * package's `effect: ^3.16.0` range), confirmed via Context7.
 */
import { Schema } from "effect"
import type { Fingerprint } from "./fingerprint.js"
import { fingerprint } from "./fingerprint.js"
import { FingerprintValue, Timestamp } from "./objects.js"

/**
 * One recorded privileged action (ORG-006).
 *
 * `actor`, `at`, and the scope are all required because an entry that cannot
 * say who did what, where, and when is not evidence. `subject` is optional
 * only because some actions — inviting a member, editing policy — act on the
 * organization itself rather than on a referenced object.
 */
export const AuditEntry = Schema.Struct({
  /** User id of the person who performed the action. */
  actor: Schema.String,
  /** The `Action` that was permitted, recorded as written by `access.ts`. */
  action: Schema.String,
  organizationId: Schema.String,
  projectId: Schema.optional(Schema.String),
  /** Affected object, in the §19 ref grammar (`review:R7`, `policy:P1`). */
  subject: Schema.optional(Schema.String),
  at: Timestamp,
  /** Hash of the preceding entry; absent only on the first entry of a log. */
  previousHash: Schema.optional(FingerprintValue),
  /** Hash over this entry's content and `previousHash`. */
  hash: FingerprintValue
})
export type AuditEntry = Schema.Schema.Type<typeof AuditEntry>

/**
 * What a caller supplies. The chain fields are omitted deliberately: they are
 * derived from the log, and letting a caller pass them in would make a forged
 * link as easy to write as a true one.
 */
export type AuditEntryInput = Omit<AuditEntry, "hash" | "previousHash">

/**
 * Compute the link hash for an entry. Kept separate from appending so
 * verification recomputes with exactly the code that wrote the value, rather
 * than with a second implementation that could drift.
 *
 * Absent fields hash as `null` instead of being dropped, so an entry that
 * names no project cannot be confused with one whose project was removed.
 */
const linkHash = (entry: AuditEntryInput, previousHash: Fingerprint | undefined): Fingerprint =>
  fingerprint({
    actor: entry.actor,
    action: entry.action,
    organizationId: entry.organizationId,
    projectId: entry.projectId ?? null,
    subject: entry.subject ?? null,
    at: entry.at,
    previousHash: previousHash ?? null
  })

/**
 * Append one entry, returning a new log (ORG-006).
 *
 * The input log is never mutated, so a caller holding an earlier reference
 * still holds the history it read. `at` is a parameter on the entry rather
 * than a clock read here, which keeps the hash of a given append reproducible
 * for tests and for anyone re-verifying a bundle later.
 */
export const appendAuditEntry = (
  log: ReadonlyArray<AuditEntry>,
  entry: AuditEntryInput
): ReadonlyArray<AuditEntry> => {
  const previousHash = log[log.length - 1]?.hash
  return [
    ...log,
    {
      ...entry,
      ...(previousHash === undefined ? {} : { previousHash }),
      hash: linkHash(entry, previousHash)
    }
  ]
}

/**
 * Find the first entry whose recorded hash no longer matches its content or
 * its predecessor, or `undefined` when the chain is intact.
 *
 * Returning the index rather than a bare boolean is what makes the check
 * useful in an incident: the earliest broken link is where the history stops
 * being trustworthy, and everything before it still is.
 */
export const verifyAuditLog = (log: ReadonlyArray<AuditEntry>): number | undefined => {
  let previousHash: Fingerprint | undefined
  for (let index = 0; index < log.length; index += 1) {
    const entry = log[index]
    if (entry === undefined) continue
    if (entry.previousHash !== previousHash) return index
    if (entry.hash !== linkHash(entry, previousHash)) return index
    previousHash = entry.hash
  }
  return undefined
}

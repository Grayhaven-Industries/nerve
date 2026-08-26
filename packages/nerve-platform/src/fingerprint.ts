/**
 * Deterministic fingerprints (PRD §8, §10.2).
 *
 * Every immutable object in the platform — source set, review run, release
 * candidate, evidence bundle — is identified by the hash of its content
 * rather than by a serial number. That is what lets §10.2 state "the bundle
 * fingerprint matches the approved candidate fingerprint" as a checkable
 * fact: if any input, rule, policy, or dependency moved, the hash moves with
 * it and the prior approval no longer refers to the thing being released.
 *
 * The hash is taken over a canonical encoding, not over `JSON.stringify` of
 * whatever the caller happened to build. Two records that differ only in key
 * insertion order describe the same submission and must not produce two
 * different release identities.
 */
import { createHash } from "node:crypto"

/** A lowercase hex SHA-256 digest, prefixed with its algorithm. */
export type Fingerprint = string

/**
 * JSON values, restricted to what a fingerprintable record may contain.
 * `undefined` is deliberately excluded: an absent key and a key set to
 * `undefined` would otherwise hash differently while meaning the same thing.
 */
export type Canonical =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<Canonical>
  | CanonicalRecord

export type CanonicalRecord = { readonly [key: string]: Canonical }

const isCanonicalArray = (value: Canonical): value is ReadonlyArray<Canonical> =>
  Array.isArray(value)

/** `Object(x) === x` holds for every object and no primitive. */
const isCanonicalRecord = (value: Canonical): value is CanonicalRecord =>
  Object(value) === value && !Array.isArray(value)

/**
 * Encode a value canonically: object keys sorted by code unit, no
 * insignificant whitespace, `undefined` members dropped from objects.
 *
 * Array order is preserved — order is meaning in a wire list or an approval
 * sequence, so callers that want order-independence must sort before
 * hashing rather than relying on the encoder to do it for them.
 */
export const canonicalize = (value: Canonical): string => {
  if (value === null) return "null"
  if (value === true || value === false) return value ? "true" : "false"
  if (isCanonicalArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`
  }
  if (isCanonicalRecord(value)) {
    const parts: Array<string> = []
    for (const key of Object.keys(value).sort()) {
      const member = value[key]
      if (member === undefined) continue
      parts.push(`${JSON.stringify(key)}:${canonicalize(member)}`)
    }
    return `{${parts.join(",")}}`
  }
  // NaN and the infinities have no JSON form; allowing them would make the
  // digest depend on how the serializer happened to degrade them.
  if (value === Infinity || value === -Infinity || Number.isNaN(value)) {
    throw new Error(`Cannot fingerprint non-finite number: ${String(value)}.`)
  }
  // Normalize -0 to 0 so a signed zero cannot fork an otherwise identical
  // measurement into two fingerprints. Strings serialize as-is.
  return JSON.stringify(value === 0 ? 0 : value)
}

/** Fingerprint a structured record. */
export const fingerprint = (value: Canonical): Fingerprint =>
  `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`

/**
 * Fingerprint raw bytes (an uploaded file). Separate from `fingerprint` so a
 * file's digest is over its exact bytes — ING-006 records a content hash that
 * has to match what the customer uploaded, not a hash of a JSON wrapper.
 */
export const fingerprintBytes = (bytes: Uint8Array): Fingerprint =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`

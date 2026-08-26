/**
 * Zero-backend share links (PRD §13 no-server posture): the harness source
 * gzips into the URL FRAGMENT — same URL, same bytes, same diagnostics, so
 * a share link IS a bug report. The fragment never reaches the server
 * (or Vercel logs); decoding happens entirely in the browser.
 *
 * Formats:
 *   v1.<base64url(gzip(entry-source))>            single file (compact, legacy)
 *   v2.<base64url(gzip(JSON of {path: source}))>  multi-file project
 * v1 links keep round-tripping; multi-file projects use v2 so their extra
 * files (e.g. variants/long.ts) aren't silently dropped.
 */
import { gzipSync, gunzipSync, strFromU8, strToU8 } from "fflate"
import { jsonObject, jsonString, parseJson } from "./json.js"

const VERSION = "v1"
const ENTRY = "/main.harness.ts"

// Decompression bomb defense: a few hundred KB of crafted fragment can
// expand to hundreds of MB synchronously. The gzip trailer's ISIZE field
// (last 4 bytes, little-endian, uncompressed size mod 2^32) tells us the
// output size BEFORE inflating, so oversized payloads are rejected without
// allocating anything.
const MAX_DECODED_BYTES = 4 * 1024 * 1024

const gunzipCapped = (bytes: Uint8Array): Uint8Array => {
  // Minimum well-formed gzip: 10-byte header + 8-byte trailer.
  if (bytes.length < 18) throw new Error("Share link too small")
  const n = bytes.length
  const isize =
    (bytes[n - 4]! | (bytes[n - 3]! << 8) | (bytes[n - 2]! << 16) | (bytes[n - 1]! << 24)) >>> 0
  if (isize > MAX_DECODED_BYTES) throw new Error("Share link too large")
  return gunzipSync(bytes)
}

const toBase64Url = (bytes: Uint8Array): string => {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

const fromBase64Url = (text: string): Uint8Array => {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Source → fragment payload (without the leading '#'). */
export const encodeShareHash = (source: string): string =>
  `${VERSION}.${toBase64Url(gzipSync(strToU8(source), { level: 9, mtime: 0 }))}`

/** Fragment payload → source; undefined when malformed/unknown version. */
export const decodeShareHash = (hash: string): string | undefined => {
  const payload = hash.startsWith("#") ? hash.slice(1) : hash
  if (!payload.startsWith(`${VERSION}.`)) return undefined
  try {
    return strFromU8(gunzipCapped(fromBase64Url(payload.slice(VERSION.length + 1))))
  } catch {
    return undefined
  }
}

/** Encode a whole project (path → source) — v2 JSON, deterministic key order. */
export const encodeShareFiles = (files: Readonly<Record<string, string>>): string => {
  const ordered = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]))
  return `v2.${toBase64Url(gzipSync(strToU8(JSON.stringify(ordered)), { level: 9, mtime: 0 }))}`
}

/** Decode a fragment to a file map. Handles v2 (multi-file) and v1 (single,
 * mapped onto the entry path). Undefined when malformed/unknown. */
export const decodeShareFiles = (hash: string): Record<string, string> | undefined => {
  const payload = hash.startsWith("#") ? hash.slice(1) : hash
  if (payload.startsWith("v2.")) {
    try {
      const obj = jsonObject(parseJson(strFromU8(gunzipCapped(fromBase64Url(payload.slice(3))))))
      if (obj === undefined) return undefined
      const files: Record<string, string> = {}
      for (const [k, v] of Object.entries(obj)) {
        const source = jsonString(v)
        if (source === undefined) return undefined
        files[k] = source
      }
      return Object.keys(files).length > 0 ? files : undefined
    } catch {
      return undefined
    }
  }
  const source = decodeShareHash(payload)
  return source !== undefined ? { [ENTRY]: source } : undefined
}

/** Full share URL for a project — single entry file uses the compact v1
 * form; anything else uses v2 so no file is lost. */
export const shareUrl = (files: Readonly<Record<string, string>>): string => {
  const keys = Object.keys(files)
  const payload =
    keys.length === 1 && keys[0] === ENTRY ? encodeShareHash(files[ENTRY]!) : encodeShareFiles(files)
  return `${window.location.origin}/shared#${payload}`
}

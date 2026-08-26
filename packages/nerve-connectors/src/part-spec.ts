/**
 * Compact part specs (tscircuit footprinter-style): resolve short,
 * memorable strings to library parts. `part("microfit-2x8")` beats
 * remembering "43025-1600", and unknown specs fail loudly with the
 * full menu.
 *
 *   microfit-8 / microfit-2x4   -> 43025-0800 (receptacle)
 *   microfit-8-plug             -> 43020-0800
 *   megafit-8 / megafit-8-plug  -> 76829-0008 / 76825-0008
 *   ph-2..6, xh-2..4            -> JST housings
 *   dt-2s..4s / dt-2p..4p       -> Deutsch DT plugs / receptacles
 *   xt60-m / xt60-f             -> AMASS XT60
 */
import type { AutocompleteString, ConnectorPart } from "@grayhaven/nerve"
import { allParts } from "./index.js"

// `satisfies` (not a wide annotation) keeps `keyof typeof SPECS` a literal
// union, so part() autocompletes every spec while raw MPNs still pass.
const SPECS = {
  "microfit-8": "43025-0800",
  "microfit-2x4": "43025-0800",
  "microfit-8-plug": "43020-0800",
  "microfit-2x4-plug": "43020-0800",
  "microfit-16": "43025-1600",
  "microfit-2x8": "43025-1600",
  "microfit-16-plug": "43020-1600",
  "microfit-2x8-plug": "43020-1600",
  "megafit-8": "76829-0008",
  "megafit-2x4": "76829-0008",
  "megafit-8-plug": "76825-0008",
  "ph-2": "PHR-2",
  "ph-3": "PHR-3",
  "ph-4": "PHR-4",
  "ph-6": "PHR-6",
  "xh-2": "XHP-2",
  "xh-3": "XHP-3",
  "xh-4": "XHP-4",
  "dt-2s": "DT06-2S",
  "dt-3s": "DT06-3S",
  "dt-4s": "DT06-4S",
  "dt-2p": "DT04-2P",
  "dt-3p": "DT04-3P",
  "dt-4p": "DT04-4P",
  "xt60-m": "XT60PW-M",
  "xt60-f": "XT60PW-F"
} as const satisfies Readonly<Record<string, string>>

/** Every compact spec name, as a literal union (drives autocomplete). */
export type PartSpecName = keyof typeof SPECS

/**
 * Real-world spellings → canonical spec tokens (footprinter's
 * normalizeDefinition move). Applied AFTER separator cleanup, so
 * "JST PH-3", "jst_ph 3", and "ph-3" all resolve the same part.
 */
const REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^jst-(ph|xh)-/, "$1-"], // JST prefix is implied
  [/^micro-fit-/, "microfit-"],
  [/^mega-fit-/, "megafit-"],
  [/^xt-60/, "xt60"],
  [/^deutsch-dt-/, "dt-"]
]

/** Trim, lowercase, collapse whitespace/underscores to the canonical dash. */
const normalizeSpec = (spec: string): string => {
  let s = spec.trim().toLowerCase().replace(/[\s_]+/g, "-")
  for (const [pattern, replacement] of REWRITES) s = s.replace(pattern, replacement)
  return s
}

// Raw-MPN passthrough is case-insensitive: part("dt06-4s") works without
// memorizing the catalog's capitalization. Built lazily — this module and
// index.js import each other, so allParts is not populated at init time.
let mpnIndexCache: ReadonlyMap<string, string> | undefined
const mpnIndex = (): ReadonlyMap<string, string> =>
  (mpnIndexCache ??= new Map(Object.keys(allParts).map((mpn) => [mpn.toLowerCase(), mpn])))

const isSpecName = (s: string): s is PartSpecName => Object.hasOwn(SPECS, s)
const isLibraryMpn = (s: string): s is keyof typeof allParts => Object.hasOwn(allParts, s)

/** Resolve a compact spec or a raw MPN to a library part. Throws with the menu on a miss. */
export const part = (spec: AutocompleteString<PartSpecName>): ConnectorPart => {
  const normalized = normalizeSpec(spec)
  const mpn = isSpecName(normalized) ? SPECS[normalized] : (mpnIndex().get(normalized) ?? spec)
  const found = isLibraryMpn(mpn) ? allParts[mpn] : undefined
  if (found === undefined) {
    // The full menu + the verbatim input is a TESTED error contract —
    // agents and humans recover from it without reading source.
    throw new Error(
      `Unknown part spec "${spec}". Compact specs: ${Object.keys(SPECS).join(", ")} — or any library MPN.`
    )
  }
  return found
}

/** Every compact spec and its MPN, for docs and tooling. */
export const partSpecs = SPECS

export interface PartInfo {
  /** Compact spec(s) that resolve to this part, shortest first. */
  readonly specs: ReadonlyArray<string>
  readonly mpn: string
  readonly part: ConnectorPart
}

/**
 * Introspect a spec or MPN without throwing: the data behind editor
 * completions, `nerve parts`, and the generated library docs page.
 */
export const partInfo = (specOrMpn: string): PartInfo | undefined => {
  let resolved: ConnectorPart
  try {
    resolved = part(specOrMpn)
  } catch {
    return undefined
  }
  const specs = Object.entries(SPECS)
    .filter(([, mpn]) => mpn === resolved.mpn)
    .map(([spec]) => spec)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
  return { specs, mpn: resolved.mpn, part: resolved }
}

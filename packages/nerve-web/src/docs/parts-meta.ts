/**
 * Part-library metadata for the client, extracted at build time by
 * scripts/gen-meta.ts from the shipped connector library (importing the
 * package here would pull the effect runtime into the route chunk).
 */
import partsMeta from "./parts-meta.json"

export interface PartMetaRow {
  readonly spec?: string
  readonly mpn: string
  readonly family?: string
  readonly description?: string
  readonly pinCount: number
  readonly gender?: string
  readonly verification?: string
}

// SAFETY: parts-meta.json is written by scripts/gen-meta.ts from PartMetaRow
// values with absent (never undefined) optional fields, so every element is a
// PartMetaRow; the JSON import only lacks the optional-key typing.
const rows = partsMeta as ReadonlyArray<PartMetaRow>

export const PARTS_META: ReadonlyArray<PartMetaRow> = rows

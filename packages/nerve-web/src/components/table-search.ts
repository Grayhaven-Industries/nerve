import type { SortingState } from "@tanstack/react-table"
import { jsonString, type JsonValue } from "../lib/json.js"

/** The sort keys this module owns on the URL. `sortBy` and `desc` are both
 * optional AND explicitly `| undefined`: this is the route's search schema,
 * so it is also what navigate() accepts. Optional keeps plain
 * <Link to=".../bom"> legal; the `| undefined` is what lets sortingToSearch
 * pass an explicit undefined to CLEAR a param under exactOptionalPropertyTypes. */
export interface SortSearch {
  sortBy?: string | undefined
  desc?: true | undefined
}

/** What the router hands validateSearch: defaultParseSearch JSON-parses each
 * param and keeps the raw string when that fails. */
export type RawSearch = Readonly<Record<string, JsonValue>>

/** Translate a Table sorting updater into a router search-param navigation.
 * Lives apart from DataTable so route validateSearch (eager) never pulls
 * @tanstack/table-core — only the type, which erases. */
export const sortingToSearch = (
  updater: SortingState | ((old: SortingState) => SortingState),
  current: SortingState
): Required<SortSearch> => {
  const next = Array.isArray(updater) ? updater : updater(current)
  const first = next[0]
  // @tanstack/react-router 1.170.18: navigate({ search }) MERGES the object
  // over the current search — a key that is merely absent is retained, not
  // cleared. Omitting `desc` on the desc -> asc/none steps therefore left
  // ?desc=true in the URL and the sort stuck on descending forever. Every key
  // this function owns is emitted on every call; `undefined` is what actually
  // drops a param (stringifySearch skips it).
  return {
    sortBy: first?.id,
    desc: first?.desc === true ? (true as const) : undefined
  }
}

/** Parse tolerant sort search params. Keys are added only when present, so
 * a URL without them yields `{}`. */
export const parseSortSearch = (s: RawSearch): SortSearch => {
  const search: SortSearch = {}
  const sortBy = jsonString(s["sortBy"])
  if (sortBy !== undefined) search.sortBy = sortBy
  // Router JSON-parses search values: ?desc=1 arrives as number 1,
  // ?desc=true as boolean true. Accept the string forms too.
  const desc = s["desc"]
  if (desc === true || desc === 1 || desc === "1" || desc === "true") search.desc = true
  return search
}

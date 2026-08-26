/**
 * The JSON value domain. Decoders that read persisted or URL-borne JSON
 * narrow from here by structure (null, array, object, "equals its own
 * string form") rather than by representation probes.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | Array<JsonValue>
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

/** JSON.parse at the boundary: the result is a JSON value by construction. */
export const parseJson = (text: string): JsonValue => JSON.parse(text)

/** The value when it is a string. A string is the one JSON value equal to its
 * own string form; numbers, booleans, null and containers all differ from it. */
export const jsonString = (value: JsonValue | undefined): string | undefined => {
  const text = String(value)
  return text === value ? text : undefined
}

/** The value when it is a plain object (not null, not an array). */
export const jsonObject = (value: JsonValue | undefined): JsonObject | undefined =>
  value instanceof Object && !Array.isArray(value) ? value : undefined

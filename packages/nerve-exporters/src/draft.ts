/**
 * Draft builder for the exporters' immutable contracts.
 *
 * Every serialized artifact (graph.json, build records, contracts, the
 * DrawingIR in render-layout.json) is byte-stable, so optional properties
 * must be added only when present and in the position the output expects.
 * `draft` starts a value from its required properties with `readonly`
 * lifted one level; the caller assigns each optional property in order and
 * hands the finished value out as the contract type. Nothing is widened
 * and nothing is asserted.
 */
export type Draft<T> = { -readonly [K in keyof T]: T[K] }

export const draft = <T extends object>(value: T): Draft<T> => value

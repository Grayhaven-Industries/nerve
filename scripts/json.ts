/**
 * JSON as a typed value. `JSON.parse` yields `any`; decoding through this
 * schema is the one place a file's bytes become a value the scripts and
 * root tests can branch on without probing its representation.
 */
import { Schema } from "effect"

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | Array<JsonValue>
  | { readonly [key: string]: JsonValue }

export const JsonValue: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.mutable(Schema.Array(JsonValue)),
    Schema.Record({ key: Schema.String, value: JsonValue })
  )
)

export const JsonObject = Schema.Record({ key: Schema.String, value: JsonValue })
export type JsonObject = Schema.Schema.Type<typeof JsonObject>

export const isJsonObject = Schema.is(JsonObject)
export const isJsonString = Schema.is(Schema.String)

export const parseJson = (text: string): JsonValue =>
  Schema.decodeUnknownSync(JsonValue)(JSON.parse(text))

export const parseJsonObject = (text: string): JsonObject =>
  Schema.decodeUnknownSync(JsonObject)(JSON.parse(text))

/** The fields of a workspace package.json these scripts read. */
export const PackageManifest = Schema.Struct({
  name: Schema.String,
  version: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  publishConfig: Schema.optional(JsonObject)
})
export type PackageManifest = Schema.Schema.Type<typeof PackageManifest>

export const parsePackageManifest = (text: string): PackageManifest =>
  Schema.decodeUnknownSync(PackageManifest)(JSON.parse(text))

/** A dependency block: package name to version spec. */
export const DependencyBlock = Schema.Record({ key: Schema.String, value: Schema.String })
export const decodeDependencyBlock = Schema.decodeUnknownSync(DependencyBlock)

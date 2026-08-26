/**
 * Plugin SDK (PRD §40).
 *
 * Typed extension boundary. The contract:
 *  - plugins declare which HIR schema versions they support — the compiler
 *    refuses mismatches with a diagnostic instead of undefined behavior,
 *  - plugin rules report through the standard typed diagnostic channel,
 *  - plugins MUST NOT mutate the HIR (rules receive it read-only),
 *  - plugins are plain modules, executable locally and in CI.
 *
 * First plugin surface: rule packs (the §38 standards-pack vehicle).
 * Importers/exporters/renderers join as their host seams stabilize.
 */
import { Schema } from "effect"
import type { Rule } from "./rules.js"

export interface NervePlugin {
  readonly name: string
  readonly version?: string
  /** HIR schema versions this plugin understands. */
  readonly hirSchemaVersions: ReadonlyArray<string>
  readonly rules?: ReadonlyArray<Rule>
}

/** Identity helper for typed plugin modules: `export default definePlugin({...})`. */
export const definePlugin = (plugin: NervePlugin): NervePlugin => plugin

/** The runtime surface a loaded module must carry to be treated as a plugin. */
const PluginSurface = Schema.Struct({
  name: Schema.String,
  hirSchemaVersions: Schema.Array(Schema.Unknown)
})
const hasPluginSurface = Schema.is(PluginSurface)

export const isNervePlugin = <T>(value: T): value is T & NervePlugin => hasPluginSurface(value)

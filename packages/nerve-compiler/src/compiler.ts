/**
 * File-level compilation (PRD §9.3, §10.3).
 *
 * Loads a user-authored `.harness.ts` module, extracts the default-exported
 * `HarnessDesign`, normalizes it to HIR, and runs structural + rule
 * validation. TypeScript loading is the only impure step; everything past
 * the design object is pure and deterministic.
 *
 * User code runs in-process via jiti for now. The PRD §13 sandboxing
 * controls (workers/isolated processes, no network during compile) land
 * with the hosted service; the CLI treats local project code as trusted
 * the same way a bundler does.
 */
import { dirname, join, resolve } from "node:path"
import { existsSync } from "node:fs"
import { createJiti } from "jiti"
import { Effect, Schema } from "effect"
import {
  compileDesign,
  HIR_SCHEMA_VERSION,
  isNervePlugin,
  runRules,
  type Diagnostic,
  type HarnessDesign,
  type Hir,
  type NerveConfig,
  type NervePlugin,
  type Rule
} from "@grayhaven/nerve"
import { builtinRulesWith } from "@grayhaven/nerve-rules"
import { CompileError, ValidationError } from "./errors.js"

const jiti = createJiti(import.meta.url, { interopDefault: true })

/**
 * Watch-mode loader: module-cache disabled so edits to the harness file
 * (and anything it imports, config included) are seen on every recompile.
 * The module-level `jiti` above CACHES — using it in a watch loop serves
 * stale designs forever.
 */
const freshJiti = (alias?: Readonly<Record<string, string>>) => {
  const options = { interopDefault: true, moduleCache: false }
  return alias !== undefined
    ? createJiti(import.meta.url, { ...options, alias: { ...alias } })
    : createJiti(import.meta.url, options)
}

const loaderFor = (
  fresh: boolean,
  alias?: Readonly<Record<string, string>>
) => alias !== undefined ? freshJiti(alias) : fresh ? freshJiti() : jiti

export interface CompileFileOptions {
  /** Extra rules to run alongside the built-ins. */
  readonly rules?: ReadonlyArray<Rule>
  /** Project config; when omitted, `nerve.config.ts` next to the file is loaded if present. */
  readonly config?: NerveConfig
  /** Bypass the module cache (watch mode): re-read every source file. */
  readonly fresh?: boolean
  /** Module aliases for compiling generated source before dependencies are installed. */
  readonly moduleAliases?: Readonly<Record<string, string>>
}

export interface CompileFileResult {
  readonly design: HarnessDesign
  readonly hir: Hir
  /** Structural + rule diagnostics, canonically ordered. */
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly config: NerveConfig
}

/** The runtime surface a loaded module value must carry to be a `harness(...)` result. */
const HarnessSurface = Schema.Struct({ kind: Schema.Literal("harness") })
const hasHarnessSurface = Schema.is(HarnessSurface)
const isHarnessDesign = <T>(value: T): value is T & HarnessDesign => hasHarnessSurface(value)

/** Load the default-exported design from a `.harness.ts` module. */
export const loadDesign = (
  file: string,
  options: {
    readonly fresh?: boolean
    readonly moduleAliases?: Readonly<Record<string, string>>
  } = {}
): Effect.Effect<HarnessDesign, CompileError> =>
  Effect.tryPromise({
    try: async () => {
      const mod = await loaderFor(
        options.fresh === true,
        options.moduleAliases
      ).import<{ readonly default?: unknown }>(resolve(file))
      const design = isHarnessDesign(mod) ? mod : mod?.default
      if (!isHarnessDesign(design)) {
        throw new CompileError({
          message: `${file} does not default-export a harness design (expected the result of harness(...)).`,
          source: file
        })
      }
      return design
    },
    catch: (cause) =>
      cause instanceof CompileError
        ? cause
        : new CompileError({
            message: `Failed to load ${file}: ${cause instanceof Error ? cause.message : String(cause)}`,
            source: file,
            cause
          })
  })

const CONFIG_FILES = ["nerve.config.ts", "interconnect.config.ts"]

/**
 * Locate and load the project config, walking up to the package root.
 * Returns the directory it was found in too — `config.entry` and
 * `config.harnessFiles` resolve relative to the config file, not the cwd.
 */
export const findConfig = (
  fromDir: string,
  options: { readonly fresh?: boolean } = {}
): Effect.Effect<{ readonly config: NerveConfig; readonly dir: string }, CompileError> =>
  Effect.tryPromise({
    try: async () => {
      const loader = loaderFor(options.fresh === true)
      let dir = resolve(fromDir)
      for (;;) {
        for (const name of CONFIG_FILES) {
          const candidate = join(dir, name)
          if (existsSync(candidate)) {
            // With interopDefault the module is either the config itself or wraps it.
            const mod = await loader.import<NerveConfig & { readonly default?: NerveConfig }>(
              candidate
            )
            return { config: mod.default ?? mod, dir }
          }
        }
        if (existsSync(join(dir, "package.json"))) return { config: {}, dir }
        const parent = dirname(dir)
        if (parent === dir) return { config: {}, dir }
        dir = parent
      }
    },
    catch: (cause) =>
      new CompileError({
        message: `Failed to load project config: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause
      })
  })

/** Load `nerve.config.ts` (or legacy `interconnect.config.ts`) from a directory, walking up to the package root. */
export const loadConfig = (
  fromDir: string
): Effect.Effect<NerveConfig, CompileError> =>
  Effect.map(findConfig(fromDir), ({ config }) => config)

/** Load plugin modules declared in config (PRD §40). */
export const loadPlugins = (
  fromDir: string,
  specifiers: ReadonlyArray<string>,
  options: { readonly fresh?: boolean } = {}
): Effect.Effect<
  { plugins: ReadonlyArray<NervePlugin>; diagnostics: ReadonlyArray<Diagnostic> },
  CompileError
> =>
  Effect.tryPromise({
    try: async () => {
      const loader = loaderFor(options.fresh === true)
      const plugins: Array<NervePlugin> = []
      const diagnostics: Array<Diagnostic> = []
      for (const spec of specifiers) {
        const path = spec.startsWith(".") ? resolve(fromDir, spec) : spec
        const mod = await loader.import<{ readonly default?: unknown }>(path)
        const plugin = mod.default ?? mod
        if (!isNervePlugin(plugin)) {
          throw new CompileError({
            message: `${spec} does not default-export a Nerve plugin (use definePlugin).`,
            source: spec
          })
        }
        if (!plugin.hirSchemaVersions.includes(HIR_SCHEMA_VERSION)) {
          diagnostics.push({
            code: "HK-PLUGIN-001",
            severity: "error",
            message: `Plugin ${plugin.name} supports HIR ${plugin.hirSchemaVersions.join(", ")}, but this compiler emits ${HIR_SCHEMA_VERSION}; its rules were not run.`
          })
          continue
        }
        plugins.push(plugin)
      }
      return { plugins, diagnostics }
    },
    catch: (cause) =>
      cause instanceof CompileError
        ? cause
        : new CompileError({
            message: `Failed to load plugins: ${cause instanceof Error ? cause.message : String(cause)}`,
            cause
          })
  })

/** Compile a `.harness.ts` file to HIR with full diagnostics. */
export const compileFile = (
  file: string,
  options: CompileFileOptions = {}
): Effect.Effect<CompileFileResult, CompileError> =>
  Effect.gen(function* () {
    const fresh = options.fresh === true
    const design = yield* loadDesign(
      file,
      options.moduleAliases !== undefined
        ? { fresh, moduleAliases: options.moduleAliases }
        : { fresh }
    )
    const config =
      options.config ??
      (yield* Effect.map(
        findConfig(dirname(resolve(file)), { fresh }),
        ({ config }) => config
      ))
    const { plugins, diagnostics: pluginDiagnostics } =
      config.plugins !== undefined && config.plugins.length > 0
        ? yield* loadPlugins(dirname(resolve(file)), config.plugins, { fresh })
        : { plugins: [], diagnostics: [] }
    const { hir, diagnostics: structural } = compileDesign(design)
    const ruleDiagnostics = runRules(
      hir,
      [
        // Shop capability profile (config.shop) parameterizes the HK-MFG
        // rules; same names/codes, so severity overrides apply unchanged.
        ...builtinRulesWith(config.shop),
        ...plugins.flatMap((p) => p.rules ?? []),
        ...(options.rules ?? [])
      ],
      config.rules ?? {}
    )
    const diagnostics = [...pluginDiagnostics, ...structural, ...ruleDiagnostics]
    return {
      design,
      hir: { ...hir, diagnostics },
      diagnostics,
      config
    }
  })

/** Fail with `ValidationError` when diagnostics contain errors (fail-closed gate, PRD §15). */
export const failOnErrors = (
  result: CompileFileResult
): Effect.Effect<CompileFileResult, ValidationError> => {
  const errors = result.diagnostics.filter((d) => d.severity === "error")
  return errors.length > 0
    ? Effect.fail(new ValidationError({ diagnostics: errors }))
    : Effect.succeed(result)
}

/**
 * CompilerService (PRD §10.3): the Effect service boundary used by the CLI
 * and (later) the web editor's worker host.
 */
export class CompilerService extends Effect.Service<CompilerService>()(
  "nerve/CompilerService",
  {
    succeed: {
      loadDesign,
      loadConfig,
      compileFile,
      failOnErrors
    }
  }
) {}

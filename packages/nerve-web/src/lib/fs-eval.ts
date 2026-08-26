/**
 * Multi-file harness evaluation (PRD §9.6 project explorer): an fsMap of
 * TypeScript sources + an entrypoint, evaluated with a require() shim —
 * relative imports resolve WITHIN the map (NodeNext-style: the authored
 * `./main.harness.js` specifier probes to `/main.harness.ts`), bare
 * specifiers resolve against the sandbox module table, and import cycles
 * fail with the exact chain.
 *
 * Pure module (no worker globals) so the resolution rules are unit-tested
 * outside the browser.
 */
import type { HarnessDesign } from "@grayhaven/nerve"
import type * as Nerve from "@grayhaven/nerve"
import type * as Connectors from "@grayhaven/nerve-connectors"

export type FsMap = Readonly<Record<string, string>>

/** "./src/../main.harness.ts" → "/main.harness.ts" (POSIX, rooted). */
export const normalizePath = (path: string): string => {
  const parts = path.replace(/\\/g, "/").split("/")
  const out: Array<string> = []
  for (const part of parts) {
    if (part === "" || part === ".") continue
    if (part === "..") out.pop()
    else out.push(part)
  }
  return "/" + out.join("/")
}

export const normalizeFsMap = (fsMap: FsMap): Map<string, string> => {
  const files = new Map<string, string>()
  for (const [key, content] of Object.entries(fsMap)) {
    files.set(normalizePath(key), content)
  }
  return files
}

const dirnameOf = (path: string): string => path.slice(0, path.lastIndexOf("/")) || "/"

/**
 * Resolve a relative specifier against the map with extension probing:
 * exact, authored-`.js` → `.ts`/`.tsx` (NodeNext), bare → `.ts`/`.tsx`,
 * directory → `/index.ts`.
 */
export const resolveFilePath = (
  files: ReadonlyMap<string, string>,
  from: string,
  spec: string
): string | undefined => {
  const base = normalizePath(spec.startsWith("/") ? spec : `${dirnameOf(from)}/${spec}`)
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`
  ]
  return candidates.find((c) => files.has(c))
}

/** A bare-specifier module `require()` can hand to user code: the curated
 * Nerve surface (any subset of the package's exports) or the part library. */
export type SandboxModule = Partial<typeof Nerve> | typeof Connectors

/** What a sandboxed file leaves in `module.exports.default`. User code is
 * untyped, so only the discriminator is read before the entry check. */
export interface DesignCandidate {
  readonly kind?: string
}

/** `module.exports` of a sandboxed file: created empty here and populated
 * by user code. `default` is the only slot the evaluator reads back. */
export interface UserModuleExports {
  default?: DesignCandidate
}

interface UserModule {
  readonly exports: UserModuleExports
}

export interface EvaluateOptions {
  /** Bare-specifier module table (the worker's sandbox surface). */
  readonly modules: Readonly<Record<string, SandboxModule>>
  /** TS → CJS transform (sucrase's, injected so this module stays lazy-free). */
  readonly transform: (source: string) => string
}

/**
 * Evaluate `entrypoint` within the map and return its default-exported
 * design. Modules evaluate once (shared imports see one instance); cycles
 * throw with the exact import chain.
 */
export const evaluateFsMap = (
  fsMap: FsMap,
  entrypoint: string,
  options: EvaluateOptions
): HarnessDesign => {
  const files = normalizeFsMap(fsMap)
  const entry = normalizePath(entrypoint)
  if (!files.has(entry)) {
    throw new Error(
      `Entrypoint ${entry} is not in the project. Files: ${[...files.keys()].join(", ")}`
    )
  }

  const cache = new Map<string, UserModule>()
  const visiting: Array<string> = []

  const loadModule = (path: string): UserModuleExports => {
    const cached = cache.get(path)
    if (cached !== undefined) return cached.exports
    const at = visiting.indexOf(path)
    if (at !== -1) {
      throw new Error(`Circular import: ${[...visiting.slice(at), path].join(" → ")}`)
    }
    visiting.push(path)
    try {
      const code = options.transform(files.get(path)!)
      const mod: UserModule = { exports: {} }
      const requireFrom = (spec: string): SandboxModule | UserModuleExports => {
        if (!spec.startsWith(".") && !spec.startsWith("/")) {
          const m = options.modules[spec]
          if (m === undefined) {
            throw new Error(
              `Module "${spec}" is not available in the editor sandbox. Available: ${Object.keys(options.modules).join(", ")}`
            )
          }
          return m
        }
        const resolved = resolveFilePath(files, path, spec)
        if (resolved === undefined) {
          throw new Error(
            `Cannot resolve "${spec}" from ${path}. Project files: ${[...files.keys()].join(", ")}`
          )
        }
        return loadModule(resolved)
      }
      new Function("require", "module", "exports", code)(requireFrom, mod, mod.exports)
      cache.set(path, mod)
      return mod.exports
    } finally {
      visiting.pop()
    }
  }

  const design = loadModule(entry).default
  // Optional chaining also covers a primitive or null left in `default`.
  if (design?.kind !== "harness") {
    throw new Error(`${entry} must default-export harness(...) (or a variant of one).`)
  }
  // SAFETY: kind === "harness" is set only by harness()/variant() from the
  // sandboxed @grayhaven/nerve surface, so the object is a HarnessDesign.
  return design as HarnessDesign
}

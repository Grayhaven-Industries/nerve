/**
 * Main-thread client for the compile worker, exposed through a
 * `queryOptions()` factory (the t3code pattern) so the router loader, route
 * components, and the source editor all share one cache entry.
 *
 * Key decisions:
 * - The queryFn compiles whatever `getSource(projectId)` currently returns —
 *   edited and bundled state unify, so a background refetch can never revert
 *   an editor compile.
 * - Compiles are deterministic per source, so `staleTime: Infinity` is the
 *   honest model; the editor writes results through `setCompileResult`.
 * - The worker RPC honors Query's abort signal, and a worker crash rejects
 *   every pending request instead of stranding queries in `pending` forever.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query"
import { ENTRY_FILE, getFiles, getFileSource, getSource, isDirty } from "./sources.js"
import { PROJECTS } from "./projects.js"
import type { CompileRequest, CompileResponse, CompileResult } from "./compile-types.js"

let worker: Worker | undefined
let nextId = 0
const pending = new Map<
  number,
  { resolve: (r: CompileResult) => void; reject: (e: Error) => void }
>()
const pendingExports = new Map<
  number,
  { resolve: (zip: Uint8Array) => void; reject: (e: Error) => void }
>()

/** Spawn the compile worker ahead of the first compile (idle warm-up). */
export const warmCompiler = (): void => {
  getWorker()
}

const getWorker = (): Worker => {
  if (worker === undefined) {
    worker = new Worker(new URL("../worker/compile.worker.ts", import.meta.url), {
      type: "module"
    })
    worker.onmessage = (event: MessageEvent<CompileResponse>) => {
      const { id, result, zip, error } = event.data
      const exportEntry = pendingExports.get(id)
      if (exportEntry !== undefined) {
        pendingExports.delete(id)
        if (zip !== undefined) exportEntry.resolve(zip)
        else exportEntry.reject(new Error(error ?? "Export failed"))
        return
      }
      const entry = pending.get(id)
      if (entry === undefined) return
      pending.delete(id)
      if (result !== undefined) entry.resolve(result)
      else entry.reject(new Error(error ?? "Compile failed"))
    }
    worker.onerror = () => {
      for (const [, entry] of pending) {
        entry.reject(new Error("Compile worker crashed; it will be respawned."))
      }
      pending.clear()
      worker?.terminate()
      worker = undefined
    }
  }
  return worker
}

const requestCompile = (
  projectId: string,
  payload: Pick<CompileRequest, "source" | "fsMap" | "entrypoint">,
  signal?: AbortSignal
): Promise<CompileResult> =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    signal?.addEventListener("abort", () => {
      if (pending.delete(id)) {
        reject(
          signal.reason instanceof Error ? signal.reason : new Error("Compile aborted")
        )
      }
    })
    getWorker().postMessage({ id, projectId, ...payload } satisfies CompileRequest)
  })

/**
 * Compile the project's ENTRY file (§9.6). `source` overrides the entry
 * text (the editor compiles what it sees before sources.ts settles); the
 * full fsMap rides along so cross-file imports resolve. With no override
 * and no edits, the worker uses its bundled design and never loads the
 * transform.
 */
// Only the bundled examples have a pre-evaluated design in the worker.
// scratch/shared have no bundled design, so they must always ship source.
const hasBundledDesign = (projectId: string): boolean =>
  PROJECTS.some((p) => p.id === projectId)

export const compileSource = (
  projectId: string,
  source: string | undefined,
  signal?: AbortSignal
): Promise<CompileResult> => {
  if (source === undefined && !isDirty(projectId) && hasBundledDesign(projectId)) {
    return requestCompile(projectId, {}, signal)
  }
  const files = getFiles(projectId)
  const fsMap = source === undefined ? files : { ...files, [ENTRY_FILE]: source }
  return requestCompile(projectId, { fsMap, entrypoint: ENTRY_FILE }, signal)
}

/**
 * Which file each project is currently compiling as its entrypoint. The
 * compile query KEY stays ['compile', projectId]; this map (written by
 * `compileProjectFile`, the single compile-a-file path) tells the queryFn
 * which file to recompile on invalidation, so a refetch can never revert a
 * variants/long.ts view to the entry-file SKU.
 */
const activeEntrypoints = new Map<string, string>()

export const setActiveEntrypoint = (projectId: string, path: string): void => {
  activeEntrypoints.set(projectId, path)
}

const activeEntrypoint = (projectId: string): string =>
  activeEntrypoints.get(projectId) ?? ENTRY_FILE

/**
 * Compile a specific project file as the ENTRYPOINT — "compile what I'm
 * looking at": opening variants/long.ts renders the long SKU. `text`
 * overrides that file's source.
 */
export const compileProjectFile = (
  projectId: string,
  path: string,
  text: string,
  signal?: AbortSignal
): Promise<CompileResult> => {
  setActiveEntrypoint(projectId, path)
  return requestCompile(
    projectId,
    { fsMap: { ...getFiles(projectId), [path]: text }, entrypoint: path },
    signal
  )
}

/** Build the full manufacturing packet (zip) in the worker. Byte-identical
 * to `nerve export` because it runs the same pure exporters on the same HIR. */
export const exportPacket = (projectId: string): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pendingExports.set(id, { resolve, reject })
    // Exports are entry-based; the fsMap rides along for cross-file imports.
    const request: CompileRequest = isDirty(projectId)
      ? { id, kind: "export", projectId, fsMap: getFiles(projectId), entrypoint: ENTRY_FILE }
      : { id, kind: "export", projectId }
    getWorker().postMessage(request)
  })

export const compileKeys = {
  all: ["compile"] as const,
  project: (projectId: string) => ["compile", projectId] as const
}

export const compileQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: compileKeys.project(projectId),
    // Compiles the *current* state: the active entrypoint (what the user is
    // viewing — tab switches and AI edits record it via compileProjectFile)
    // with that file's current source, both re-read at refetch time so a
    // refetch can never revert an editor compile. On the entry file the
    // bundled-design fast path is kept: undefined source when clean lets the
    // worker skip loading the sucrase transform entirely.
    queryFn: ({ signal }) => {
      const path = activeEntrypoint(projectId)
      return path === ENTRY_FILE
        ? compileSource(projectId, isDirty(projectId) ? getSource(projectId) : undefined, signal)
        : compileProjectFile(projectId, path, getFileSource(projectId, path), signal)
    },
    staleTime: Infinity
  })

/** Editor → cache writer: a successful editor compile becomes the truth everywhere. */
export const setCompileResult = (
  queryClient: QueryClient,
  projectId: string,
  result: CompileResult
): void => {
  queryClient.setQueryData(compileQueryOptions(projectId).queryKey, result)
}

export interface DiagnosticCounts {
  readonly errors: number
  readonly warnings: number
  readonly total: number
}

/** Single pass, no intermediate arrays (vercel-react js-combine-iterations). */
export const countDiagnostics = (
  diagnostics: ReadonlyArray<{ readonly severity: string }>
): DiagnosticCounts => {
  let errors = 0
  let warnings = 0
  for (const d of diagnostics) {
    if (d.severity === "error") errors++
    else if (d.severity === "warning") warnings++
  }
  return { errors, warnings, total: diagnostics.length }
}

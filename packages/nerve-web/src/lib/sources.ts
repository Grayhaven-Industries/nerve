/**
 * Editable sources per project (§9.6), now an fsMap: each project is a set
 * of files (path → TypeScript), not one string. The bundled examples seed
 * the initial map — motor-controller ships with its real variants/long.ts,
 * which only multi-file evaluation can open. Edits persist to localStorage
 * through a debounced writer (t3code's debounced-storage pattern) so a
 * reload never loses work. The ephemeral "shared" project persists to
 * sessionStorage instead: edits survive a reload but die with the tab,
 * honoring the share-link contract.
 *
 * The entry file is "/main.harness.ts"; getSource/setSource keep their
 * original single-string contract by operating on it (the AI pane and
 * legacy callers speak entry-file).
 */
import { Debouncer } from "@tanstack/pacer"
import { jsonString, parseJson } from "./json.js"
import motorControllerSource from "../../../../examples/motor-controller/src/main.harness.ts?raw"
import motorControllerLongSource from "../../../../examples/motor-controller/src/variants/long.ts?raw"
import sensorSpliceSource from "../../../../examples/sensor-splice/src/main.harness.ts?raw"
import robotPlatformSource from "../../../../examples/robot-platform/src/main.harness.ts?raw"

export const ENTRY_FILE = "/main.harness.ts"

// Starter for the in-browser scratch pad (the "New harness" button). Blank
// but valid, so the author starts from green. It's the `scratch` project's
// baseline: edits persist to localStorage, and Reset returns to this.
const SCRATCH_STARTER = `import { harness, connector, wire, type ConnectorPart } from "@grayhaven/nerve"

// A blank canvas — edit freely; the compiler checks every change live.
// There's no server: hit Share to keep this (the link is your save).
const part: ConnectorPart = { mpn: "GENERIC-2", pinCount: 2 }
const j1 = connector("J1", part, { pins: { 1: "PWR", 2: "GND" } })
const j2 = connector("J2", part, { pins: { 1: "PWR", 2: "GND" } })

export default harness("my-harness", {
  revision: "A",
  units: "mm",
  connectors: [j1, j2],
  wires: [
    wire("W1", j1.pin(1), j2.pin(1), { signal: "PWR", gauge: "20AWG", color: "red", length: 100 }),
    wire("W2", j1.pin(2), j2.pin(2), { signal: "GND", gauge: "20AWG", color: "black", length: 100 })
  ]
})
`

const initial = new Map<string, Readonly<Record<string, string>>>(
  Object.entries({
    "motor-controller": {
      [ENTRY_FILE]: motorControllerSource,
      // The §8.4 SKU variant: imports ../main.harness.js — the multi-file
      // resolution proof case (compiles via CLI jiti AND the web sandbox).
      "/variants/long.ts": motorControllerLongSource
    },
    "sensor-splice": { [ENTRY_FILE]: sensorSpliceSource },
    "robot-platform": { [ENTRY_FILE]: robotPlatformSource },
    // The user's scratch pad — starter baseline, persisted like any edit.
    scratch: { [ENTRY_FILE]: SCRATCH_STARTER }
  })
)

const edited = new Map<string, string>() // `${projectId} ${path}` → source

// Per project, the set of paths whose current source differs from its
// bundled baseline. Seeded by one full scan the first time a project is
// asked about, then maintained incrementally — see `dirtySet`/`trackDirty`.
const dirtyPaths = new Map<string, Set<string>>()

const editKey = (projectId: string, path: string): string => `${projectId} ${path}`

// Entry file keeps the legacy storage key (existing saved edits survive);
// other files get a per-path key.
const storageKey = (projectId: string, path: string): string =>
  path === ENTRY_FILE ? `nerve:source:${projectId}` : `nerve:source:${projectId}:${path}`

// The shared project is ephemeral — localStorage would keep it on disk
// forever, contradicting the share-link contract. sessionStorage survives
// a reload but dies with the tab, so shared edits go there instead.
const store = (projectId: string): Storage =>
  projectId === "shared" ? sessionStorage : localStorage

const writePersist = (projectId: string, path: string, source: string): void => {
  try {
    // Edits matching the bundled source don't need persisting.
    if (source === initial.get(projectId)?.[path]) {
      store(projectId).removeItem(storageKey(projectId, path))
    } else {
      store(projectId).setItem(storageKey(projectId, path), source)
    }
  } catch {
    // Quota/privacy-mode failures degrade to session-only edits.
  }
}

// One debouncer PER (project,path): a single shared Debouncer is one
// trailing timer, so editing file B within 500ms of file A would drop A's
// write entirely (silent loss on reload). Keyed timers debounce each file
// independently.
const persisters = new Map<string, Debouncer<(s: string) => void>>()
const persist = (projectId: string, path: string, source: string): void => {
  const key = `${projectId} ${path}`
  let d = persisters.get(key)
  if (d === undefined) {
    d = new Debouncer((s: string) => writePersist(projectId, path, s), { wait: 500 })
    persisters.set(key, d)
  }
  d.maybeExecute(source)
}

const fromStorage = (projectId: string, path: string): string | undefined => {
  try {
    return store(projectId).getItem(storageKey(projectId, path)) ?? undefined
  } catch {
    return undefined
  }
}

/** Whether the project has a bundled baseline to reset to. The shared
 * project does not — its only source is the URL fragment, so "Reset"
 * would wipe it to an empty string irrecoverably. */
export const hasBundledSource = (projectId: string): boolean =>
  initial.has(projectId)

// Projects with no bundled baseline (the shared project, opened from a
// link) register their file set here so tabs/compile see every file.
const registered = new Map<string, ReadonlyArray<string>>()

// The shared project's registered file list also lives in sessionStorage,
// so a reload (which drops the in-memory map) can restore the tab set.
const SHARED_FILES_KEY = "nerve:files:shared"
let sharedHydrated = false
const hydrateShared = (): void => {
  if (sharedHydrated) return
  sharedHydrated = true
  try {
    const raw = sessionStorage.getItem(SHARED_FILES_KEY)
    if (raw === null) return
    const paths = parseJson(raw)
    if (Array.isArray(paths)) {
      const files = paths.map(jsonString)
      if (files.every((p): p is string => p !== undefined)) registered.set("shared", files)
    }
  } catch {
    // Privacy-mode/parse failures degrade to the pre-reload behavior.
  }
}

/** Seed a project from a decoded share link: write each file's source and
 * record its file list (so listFiles shows all the tabs). */
export const registerProjectFiles = (
  projectId: string,
  files: Readonly<Record<string, string>>
): void => {
  for (const [path, source] of Object.entries(files)) edited.set(editKey(projectId, path), source)
  registered.set(projectId, Object.keys(files))
  // This rewrites the file SET, not just one file's text, so the cached
  // dirty set no longer describes the project — drop it and let the next
  // `isDirty` reseed by scanning. Registration is rare (one share link).
  dirtyPaths.delete(projectId)
  if (projectId === "shared") {
    // A fresh registration supersedes anything a previous link left behind.
    sharedHydrated = true
    try {
      for (const [path, source] of Object.entries(files)) {
        sessionStorage.setItem(storageKey(projectId, path), source)
      }
      sessionStorage.setItem(SHARED_FILES_KEY, JSON.stringify(Object.keys(files)))
    } catch {
      // Quota/privacy-mode failures degrade to session-only (no reload survival).
    }
  }
}

/** Project file listing, entry first (stable order for tabs). */
export const listFiles = (projectId: string): ReadonlyArray<string> => {
  if (projectId === "shared") hydrateShared()
  const paths = Object.keys(initial.get(projectId) ?? {})
  const registeredPaths = registered.get(projectId) ?? []
  const all = new Set([ENTRY_FILE, ...paths, ...registeredPaths])
  return [ENTRY_FILE, ...[...all].filter((p) => p !== ENTRY_FILE).sort()]
}

export const getFileSource = (projectId: string, path: string): string =>
  edited.get(editKey(projectId, path)) ??
  fromStorage(projectId, path) ??
  initial.get(projectId)?.[path] ??
  ""

/** The bundled baseline for one file; "" for files with no bundled source
 * (the shared project's, which are dirty the moment they hold any text). */
const baselineSource = (projectId: string, path: string): string =>
  initial.get(projectId)?.[path] ?? ""

// The dirty set for a project, seeded on first use. The seed is the same
// full scan `isDirty` used to run, but it runs ONCE per project instead of
// once per keystroke: every later write updates the set through
// `trackDirty`, which is a single string compare.
const dirtySet = (projectId: string): Set<string> => {
  let paths = dirtyPaths.get(projectId)
  if (paths === undefined) {
    paths = new Set(
      listFiles(projectId).filter(
        (p) => getFileSource(projectId, p) !== baselineSource(projectId, p)
      )
    )
    dirtyPaths.set(projectId, paths)
  }
  return paths
}

// Incremental maintenance: one file changed, so only that file is re-diffed.
// Editing back to the exact bundled text drops the path from the set, which
// is what lets the flag flip false again.
const trackDirty = (projectId: string, path: string, source: string): void => {
  const paths = dirtySet(projectId)
  if (source === baselineSource(projectId, path)) paths.delete(path)
  else paths.add(path)
}

/** The whole project as an fsMap for the compile worker.
 *
 * NOTE: this builds a FRESH object on every call. Nothing memoizes it, and
 * that is deliberate — the sources it reads (the `edited` map, localStorage,
 * sessionStorage) can all change from outside this module (another tab, the
 * AI pane, a share-link registration), so a cache here could serve stale
 * files to the compiler. The hazard to know about: never pass `getFiles`
 * straight to `useSyncExternalStore`. React compares snapshots with
 * `Object.is`, so a new object every call reads as "changed every time" and
 * re-renders forever. Derive a primitive (see `isDirty`) or hold the result
 * in state instead. */
export const getFiles = (projectId: string): Readonly<Record<string, string>> =>
  Object.fromEntries(listFiles(projectId).map((p) => [p, getFileSource(projectId, p)]))

/** Entry-file source (original single-string contract). */
export const getSource = (projectId: string): string => getFileSource(projectId, ENTRY_FILE)

// Change subscription: lets the editor reflect writes made elsewhere
// (the AI pane applying a patch, or another tab via BroadcastChannel).
export type SourceOrigin = "local" | "remote"
const listeners = new Set<(projectId: string, origin: SourceOrigin) => void>()

export const subscribeSource = (
  listener: (projectId: string, origin: SourceOrigin) => void
): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const notify = (projectId: string, origin: SourceOrigin): void => {
  for (const listener of listeners) listener(projectId, origin)
}

// Multi-tab sync: without this, two tabs on one project silently clobber
// each other through the debounced localStorage writer (last writer wins).
const channel =
  globalThis.BroadcastChannel !== undefined ? new BroadcastChannel("nerve-sources") : undefined
if (channel !== undefined) {
  channel.onmessage = (
    e: MessageEvent<{ projectId: string; path?: string; source: string }>
  ) => {
    const path = e.data.path ?? ENTRY_FILE
    edited.set(editKey(e.data.projectId, path), e.data.source)
    trackDirty(e.data.projectId, path, e.data.source)
    notify(e.data.projectId, "remote")
  }
}

export const setFileSource = (projectId: string, path: string, source: string): void => {
  edited.set(editKey(projectId, path), source)
  trackDirty(projectId, path, source)
  persist(projectId, path, source)
  channel?.postMessage({ projectId, path, source })
  notify(projectId, "local")
}

/** Entry-file write (original single-string contract). */
export const setSource = (projectId: string, source: string): void =>
  setFileSource(projectId, ENTRY_FILE, source)

/** True when any file differs from the bundled example.
 *
 * O(1) after the project's first call. `useIsDirty` runs this on every source
 * notification — i.e. every keystroke — and React may call a snapshot more
 * than once per render, so the old full-project diff was pure waste to
 * produce a boolean that flips at most once per session. */
export const isDirty = (projectId: string): boolean => dirtySet(projectId).size > 0

/** Discard all edits and return to the bundled entry source. */
export const resetSource = (projectId: string): string => {
  for (const path of listFiles(projectId)) {
    edited.delete(editKey(projectId, path))
    try {
      store(projectId).removeItem(storageKey(projectId, path))
    } catch {
      // ignore
    }
  }
  // Every file is back to its baseline by construction, so the set is empty.
  dirtyPaths.set(projectId, new Set())
  return initial.get(projectId)?.[ENTRY_FILE] ?? ""
}

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useDebouncedValue } from "@tanstack/react-pacer"
import CodeMirror from "@uiw/react-codemirror"
import { EditorView } from "@codemirror/view"
import { javascript } from "@codemirror/lang-javascript"
import { lintGutter, setDiagnostics } from "@codemirror/lint"
import { autocompletion } from "@codemirror/autocomplete"
import { dslCompletions } from "../lib/dsl-completions.js"
import { toEditorDiagnostics } from "../lib/editor-lint.js"
import { grayscaleTheme } from "../lib/cm-theme.js"
import { useMinimumLoading } from "../lib/useMinimumLoading.js"
import { announce } from "../lib/announce.js"
import {
  compileKeys,
  compileProjectFile,
  countDiagnostics,
  setActiveEntrypoint,
  setCompileResult
} from "../lib/compile-client.js"
import { registerEditor } from "../lib/editor-registry.js"

declare global {
  interface Window {
    /** Automation hook (e2e tests, agent tooling): the live editor view. */
    __nerveEditor?: EditorView
  }
}
import {
  ENTRY_FILE,
  getFiles,
  getFileSource,
  hasBundledSource,
  isDirty,
  listFiles,
  resetSource,
  setFileSource,
  subscribeSource
} from "../lib/sources.js"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

// The single CodeMirror instance every tab drives. It lives outside the Tabs
// root on purpose (see the tab strip below), so the triggers point at it by id
// rather than at a Tabs.Content panel.
const EDITOR_ID = "source-editor"

/**
 * Persistent source editor (PRD §11.1 left pane). Auto-compiles on type;
 * successful compiles write through the query cache so the render pane on
 * the right updates live.
 */
export function SourcePane({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  // Multi-file projects (§9.6): tabs per file; the active file is also the
  // compile ENTRYPOINT — opening variants/long.ts renders the long SKU.
  const [activeFile, setActiveFile] = useState(ENTRY_FILE)
  // Mirror activeFile into a ref so the compile mutation's async onSuccess
  // can tell whether the user has since switched tabs. Updated at commit,
  // which lands before any async onSuccess can read it.
  const activeFileRef = useRef(activeFile)
  useEffect(() => {
    activeFileRef.current = activeFile
  }, [activeFile])
  const files = listFiles(projectId)
  const [source, setLocalSource] = useState(() => getFileSource(projectId, ENTRY_FILE))
  const [autoCompile, setAutoCompile] = useState(true)
  const lastCompiled = useRef<string | undefined>(undefined)
  const viewRef = useRef<EditorView | null>(null)
  // True while this component writes to the source store, so the subscribe
  // listener can ignore its own synchronous self-notifies.
  const selfWrite = useRef(false)
  // Pre-reset snapshot of every file; present only until the next edit,
  // project switch, or undo.
  const [undoSnapshot, setUndoSnapshot] = useState<Readonly<Record<string, string>> | undefined>(undefined)

  // Reset and "Undo reset" each unmount themselves: activating one flips the
  // dirty/snapshot state that renders it, and the other takes its place. Left
  // alone the browser drops focus to <body>, so a keyboard user is dumped at
  // the top of the document mid-task. Hand focus to the control that replaced
  // the one they activated — it is where the undo/redo of that action lives.
  const resetRef = useRef<HTMLButtonElement>(null)
  const undoRef = useRef<HTMLButtonElement>(null)
  const focusAfterSwap = useRef<"reset" | "undo" | null>(null)
  // undoSnapshot is what swaps the pair, so its change is the commit where the
  // replacement button exists to receive focus.
  useEffect(() => {
    const target = focusAfterSwap.current
    if (target === null) return
    focusAfterSwap.current = null
    const el = target === "undo" ? undoRef.current : resetRef.current
    el?.focus()
  }, [undoSnapshot])

  // Push HK diagnostics into the lint gutter whenever a compile lands.
  const publishDiagnostics = (text: string, diags: ReadonlyArray<{ readonly code: string; readonly severity: string; readonly message: string; readonly target?: string | undefined }>) => {
    const view = viewRef.current
    if (view === null) return
    view.dispatch(setDiagnostics(view.state, toEditorDiagnostics(text, diags)))
  }

  // The route keys <SourcePane> by projectId, so a project switch remounts
  // this with fresh state — no re-seeding effect, and therefore no frame of
  // the previous project's source painted before it corrects.
  //
  // activeEntrypoint is module state, not component state, so unlike
  // everything else the old effect reset, it does NOT come back fresh with
  // the mount: a project last left on variants/long.ts keeps that entrypoint
  // while the tab strip shows the entry file. The mount-time auto-compile
  // happens to realign it, but only when auto-compile is on — so carry the
  // deleted effect's one non-state side effect over explicitly.
  // projectId IS in the deps even though the key means this only ever runs on
  // mount: with an empty array the effect silently captures a stale projectId
  // the moment anyone removes that key, and nothing would fail loudly.
  useEffect(() => {
    setActiveEntrypoint(projectId, ENTRY_FILE)
  }, [projectId])

  // Unregister the editor view when the pane unmounts.
  useEffect(() => () => registerEditor(null), [])

  // Reflect writes made elsewhere (the AI pane applying a verified patch).
  // AI edits arrive already compiled, so mark them as lastCompiled to keep
  // the auto-compile effect from re-running the same text.
  useEffect(
    () =>
      subscribeSource((changed, origin) => {
        if (changed !== projectId) return
        if (selfWrite.current) return
        const text = getFileSource(projectId, activeFile)
        // Same-tab external writes (the AI pane) arrive compile-verified;
        // remote-tab keystrokes do not — let auto-compile pick them up.
        if (origin === "local") lastCompiled.current = text
        setLocalSource(text)
      }),
    [projectId, activeFile]
  )

  // The path rides in the mutation variables: mutate() during a tab switch
  // must compile against the NEW path, not this render's closure.
  const compile = useMutation({
    mutationFn: ({ path, text }: { path: string; text: string }) =>
      compileProjectFile(projectId, path, text),
    onSuccess: (result, { path, text }) => {
      // Supersession guards: drop a stale result if a newer edit exists
      // for that file, OR if the user switched tabs while it was in flight
      // (else a late tab-A compile paints A's lint ranges onto B's document
      // and overwrites B's render).
      if (text !== getFileSource(projectId, path)) return
      if (path !== activeFileRef.current) return
      lastCompiled.current = text
      publishDiagnostics(text, result.hir.diagnostics)
      setCompileResult(queryClient, projectId, result)
    }
  })

  // Compile-on-type: debounce the editor text, feed the existing mutation.
  // useEffectEvent reads the latest mutation without being a reactive dep —
  // the effect re-runs only on the values that should trigger a compile.
  const runCompile = useEffectEvent((text: string) => compile.mutate({ path: activeFile, text }))
  const [debouncedSource] = useDebouncedValue(source, { wait: 600 })
  useEffect(() => {
    if (!autoCompile) return
    if (debouncedSource === lastCompiled.current) return
    if (debouncedSource !== getFileSource(projectId, activeFile)) return // project/tab just switched
    runCompile(debouncedSource)
  }, [debouncedSource, autoCompile, projectId, activeFile])

  // Close the stale window (tanstack-query qk-include-dependencies): if the
  // pane unmounts or switches projects with uncompiled edits, invalidate so
  // the render pane recompiles the current source.
  useEffect(() => {
    return () => {
      if (getFileSource(projectId, ENTRY_FILE) !== lastCompiled.current) {
        void queryClient.invalidateQueries({ queryKey: compileKeys.project(projectId) })
      }
    }
  }, [projectId, queryClient])

  // Busy cue: 150ms delay before showing, 300ms minimum once shown —
  // fast compiles never flash the label.
  const showBusy = useMinimumLoading(compile.isPending)

  const onToggleAuto = (enabled: boolean) => {
    setAutoCompile(enabled)
    if (!enabled && getFileSource(projectId, activeFile) !== lastCompiled.current) {
      void queryClient.invalidateQueries({ queryKey: compileKeys.project(projectId) })
    }
  }

  const onChange = (text: string) => {
    setLocalSource(text)
    // Notify is synchronous — bracket the write so the listener skips it.
    selfWrite.current = true
    setFileSource(projectId, activeFile, text)
    selfWrite.current = false
    setUndoSnapshot(undefined)
  }

  const onSelectFile = (path: string) => {
    if (path === activeFile) return
    setActiveFile(path)
    const text = getFileSource(projectId, path)
    setLocalSource(text)
    lastCompiled.current = undefined
    // Compile what you look at: the new tab becomes the entrypoint.
    compile.mutate({ path, text })
  }

  // Keep the status span mounted; animate visibility. Memoized so the
  // render-phase retention setState below cannot loop.
  const status = useMemo(
    () =>
      compile.isError
        ? { kind: "error" as const, text: String(compile.error.message) }
        : compile.isSuccess
          ? {
              kind: "ok" as const,
              text: (() => {
                const { errors, warnings } = countDiagnostics(compile.data.hir.diagnostics)
                const n = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`
                return `Compiled · ${n(errors, "error")}, ${n(warnings, "warning")}`
              })()
            }
          : undefined,
    [compile.isError, compile.isSuccess, compile.error, compile.data]
  )
  // "Storing information from previous renders": retain the last real status
  // while the mutation is idle/pending.
  const [retainedStatus, setRetainedStatus] = useState(status)
  if (status !== undefined && status !== retainedStatus) setRetainedStatus(status)
  const shown = status ?? retainedStatus

  // Speak the compile result. Keyed on the TEXT, not the mutation: auto-
  // compile fires on every typing pause, and a result identical to the last
  // one is not news — re-announcing it would talk over the user continuously.
  // A changed error/warning count is in the text, so that still speaks.
  const statusText = status?.text
  useEffect(() => {
    if (statusText !== undefined) announce(statusText)
  }, [statusText])

  return (
    <div className="source-pane">
      {/*
        Trigger strip only (@radix-ui/react-tabs 1.1.17, via radix-ui 1.6.2):
        Tabs.Root owns selection, but there is no Tabs.Content — the editor
        below is a single shared CodeMirror instance and mounting it under a
        panel would remount it on every switch, dropping the undo history.
        Radix spreads caller props after its own attributes, so aria-controls
        below replaces the id of the panel that deliberately does not exist and
        points at the editor the tabs actually control.
      */}
      {files.length > 1 && (
        <Tabs value={activeFile} onValueChange={onSelectFile}>
          <TabsList variant="line" aria-label="Project files" className="source-tabs">
            {files.map((path) => (
              <TabsTrigger key={path} value={path} className="source-tab" aria-controls={EDITOR_ID}>
                {path.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      <div className="source-toolbar">
        <Button size="xs" disabled={compile.isPending} onClick={() => compile.mutate({ path: activeFile, text: source })}>
          {showBusy ? "Compiling…" : "Compile"}
        </Button>
        <span className="auto-toggle-group">
          <Checkbox
            id="auto-compile"
            checked={autoCompile}
            onCheckedChange={(checked) => onToggleAuto(checked === true)}
          />
          <label className="auto-toggle" htmlFor="auto-compile">
            Auto
          </label>
        </span>
        {hasBundledSource(projectId) && isDirty(projectId) && (
          <Button
            ref={resetRef}
            variant="secondary"
            size="xs"
            onClick={() => {
              focusAfterSwap.current = "undo"
              const snapshot = getFiles(projectId)
              setUndoSnapshot(snapshot)
              const text = resetSource(projectId)
              setActiveFile(ENTRY_FILE)
              setLocalSource(text)
              compile.mutate({ path: ENTRY_FILE, text })
            }}
          >
            Reset
          </Button>
        )}
        {undoSnapshot !== undefined && (
          <Button
            ref={undoRef}
            variant="secondary"
            size="xs"
            onClick={() => {
              focusAfterSwap.current = "reset"
              selfWrite.current = true
              for (const [path, text] of Object.entries(undoSnapshot)) {
                setFileSource(projectId, path, text)
              }
              selfWrite.current = false
              setActiveFile(ENTRY_FILE)
              setLocalSource(undoSnapshot[ENTRY_FILE] ?? "")
              lastCompiled.current = undefined
              compile.mutate({ path: ENTRY_FILE, text: undoSnapshot[ENTRY_FILE] ?? "" })
              setUndoSnapshot(undefined)
            }}
          >
            Undo reset
          </Button>
        )}
        <span
          className={`toolbar-status ${shown?.kind === "error" ? "compile-error" : "compile-ok"} ${status !== undefined ? "visible" : ""}`}
        >
          {shown?.text ?? ""}
        </span>
      </div>
      <CodeMirror
        id={EDITOR_ID}
        value={source}
        height="100%"
        extensions={[
          javascript({ typescript: true }),
          lintGutter(),
          autocompletion({ override: [dslCompletions] }),
          // axe: role=textbox needs an accessible name.
          EditorView.contentAttributes.of({ "aria-label": "Harness source: the code the assistant writes to build the harness" })
        ]}
        theme={grayscaleTheme}
        onCreateEditor={(view) => {
          viewRef.current = view
          registerEditor(view)
          // Automation hook: e2e tests and agent tooling drive real editor
          // transactions through this instead of poking minified internals.
          window.__nerveEditor = view
        }}
        onChange={onChange}
        style={{ flex: 1, minHeight: 0, overflow: "auto", fontSize: 13 }}
      />
    </div>
  )
}

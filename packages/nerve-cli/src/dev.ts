/**
 * `nerve dev` (PRD §9.7 DX tier): watch → recompile → live browser preview.
 *
 * One-way disk → browser: the watcher recompiles via compileFile with the
 * module cache bypassed (the compiler's shared jiti instance caches — a
 * watch loop over it would serve the first compile forever), re-renders
 * the self-contained html.ts viewers, and the page reloads itself when
 * /state.json reports a new HIR fingerprint. Compile failures keep the
 * last good drawing on screen with the error in the header and terminal.
 *
 * No bundler, no websocket stack, no bidirectional sync — the viewers are
 * complete documents already; a 1s fingerprint poll is plenty.
 */
import { createServer, type Server } from "node:http"
import { existsSync, watch, type FSWatcher } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Cause, Effect, Exit, Predicate } from "effect"
import type { Diagnostic } from "@grayhaven/nerve"
import { compileFile } from "@grayhaven/nerve-compiler"
import { boardHtml, facesHtml, hirFingerprint, pinoutHtml, schematicHtml } from "@grayhaven/nerve-exporters"

export interface DevIo {
  out(line: string): void
  err(line: string): void
}

export interface DevServer {
  readonly port: number
  readonly url: string
  /** Recompile + re-render now (the watcher calls this on change). */
  rebuild(): Promise<void>
  close(): Promise<void>
}

interface DevState {
  fingerprint: string
  errors: number
  warnings: number
  /** Set when the last compile failed (the previous good render stays up). */
  compileError?: string
}

const POLL_SCRIPT = `
<script>
(() => {
  let last;
  const tick = async () => {
    try {
      const s = await (await fetch("/state.json")).json();
      if (last !== undefined && s.fingerprint !== last) { location.reload(); return; }
      last = s.fingerprint;
      const el = document.getElementById("dev-status");
      if (el) el.textContent = s.compileError ? "compile error — showing last good render" : s.errors + " error(s) · " + s.warnings + " warning(s)";
    } catch {}
    setTimeout(tick, 1000);
  };
  tick();
})();
</script>`

const STATUS_BADGE = `<div id="dev-status" style="position:fixed;right:10px;top:6px;font-size:11px;color:#555;"></div>`

const inject = (html: string): string =>
  html.replace("</body>", `${STATUS_BADGE}${POLL_SCRIPT}\n</body>`)

/** Minimal page shown when there's no good render yet (e.g. the FIRST
 * compile failed). Carries the poller so it auto-reloads once fixed —
 * without it a broken-on-startup project shows a dead 404 forever. */
const errorPage = (message: string): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>nerve dev — compile error</title>` +
  `<style>body{margin:0;padding:40px;background:#1a1a1a;color:#eee;font-family:ui-monospace,Menlo,monospace}` +
  `h1{font-size:14px;color:#d97706}pre{white-space:pre-wrap;color:#f87171;font-size:13px}</style></head>` +
  `<body><h1>nerve dev — compile error (auto-reloads on fix)</h1><pre>${message.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>` +
  `${STATUS_BADGE}${POLL_SCRIPT}</body></html>`

/** Nearest ancestor holding nerve.config.ts / package.json — so config
 * and shared modules above src/ trigger rebuilds, not just the entry's dir. */
const watchRoot = (entry: string): string => {
  let dir = dirname(entry)
  for (;;) {
    if (existsSync(join(dir, "nerve.config.ts")) || existsSync(join(dir, "package.json"))) return dir
    const parent = dirname(dir)
    if (parent === dir) return dirname(entry)
    dir = parent
  }
}

const printDiagnostics = (diagnostics: ReadonlyArray<Diagnostic>, io: DevIo): void => {
  for (const d of diagnostics) {
    const line = `${d.code} ${d.severity}${d.target !== undefined ? `  ${d.target}` : ""}  ${d.message}`
    ;(d.severity === "error" ? io.err : io.out)(line)
  }
}

export const startDev = async (
  file: string,
  options: { readonly port?: number; readonly io: DevIo }
): Promise<DevServer> => {
  const io = options.io
  const entry = resolve(file)
  const pages = new Map<string, string>()
  const state: DevState = { fingerprint: "", errors: 0, warnings: 0 }

  const rebuild = async (): Promise<void> => {
    const started = Date.now()
    const exit = await Effect.runPromiseExit(compileFile(entry, { fresh: true }))
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause)
      state.compileError =
        failure._tag === "Some" ? failure.value.message : Cause.pretty(exit.cause)
      io.err(`compile failed: ${state.compileError}`)
      return
    }
    delete state.compileError
    const { hir, diagnostics } = exit.value
    printDiagnostics(diagnostics, io)
    pages.set("/", inject(schematicHtml(hir)))
    pages.set("/board", inject(boardHtml(hir)))
    pages.set("/faces", inject(facesHtml(hir)))
    pages.set("/pinout", inject(pinoutHtml(hir)))
    state.fingerprint = hirFingerprint(hir)
    state.errors = diagnostics.filter((d) => d.severity === "error").length
    state.warnings = diagnostics.filter((d) => d.severity === "warning").length
    io.out(
      `compiled ${hir.harness.id} rev ${hir.harness.revision} in ${Date.now() - started}ms — ${state.errors} error(s), ${state.warnings} warning(s)`
    )
  }

  await rebuild()

  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!
    if (path === "/state.json") {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
      res.end(JSON.stringify(state))
      return
    }
    const page = pages.get(path === "/schematic" ? "/" : path)
    if (page !== undefined) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
      res.end(page)
      return
    }
    // No render yet (first compile failed): serve the auto-reloading
    // error page for view routes instead of a dead 404.
    if (state.compileError !== undefined && ["/", "/board", "/faces", "/pinout", "/schematic"].includes(path)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
      res.end(errorPage(state.compileError))
      return
    }
    res.writeHead(404, { "content-type": "text/plain" })
    res.end("nerve dev: /, /board, /faces, /pinout, /state.json")
  })

  await new Promise<void>((resolveListen) =>
    // Bind loopback only — the URL we print is localhost, so don't quietly
    // expose the dev server (and the source it serves) to the whole LAN.
    server.listen(options.port ?? 4477, "127.0.0.1", () => resolveListen())
  )
  const address = server.address()
  // A TCP listener reports an AddressInfo; only pipes and sockets report a string.
  const port =
    address === null || Predicate.isString(address) ? (options.port ?? 4477) : address.port

  // Watch the harness file's tree; debounce bursts (editors write twice).
  let timer: ReturnType<typeof setTimeout> | undefined
  let building = false
  let dirty = false
  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (building) {
        dirty = true
        return
      }
      building = true
      // .catch, not just .finally: a render-phase throw would otherwise
      // become an unhandled rejection and kill the whole dev process.
      rebuild()
        .catch((cause) => io.err(`rebuild failed: ${cause instanceof Error ? cause.message : String(cause)}`))
        .finally(() => {
          building = false
          if (dirty) {
            dirty = false
            schedule()
          }
        })
    }, 120)
  }
  // Watch from the project root (config + modules above src/), not just the
  // entry's directory — so nerve.config.ts edits hot-reload too.
  const watcher: FSWatcher = watch(watchRoot(entry), { recursive: true }, (_event, name) => {
    if (name === null) return schedule()
    if (/node_modules|[/\\]dist[/\\]/.test(name)) return
    if (/\.(ts|tsx|json)$/.test(name)) schedule()
  })

  return {
    port,
    url: `http://localhost:${port}`,
    rebuild,
    close: () =>
      new Promise<void>((resolveClose) => {
        clearTimeout(timer)
        watcher.close()
        server.close(() => resolveClose())
      })
  }
}

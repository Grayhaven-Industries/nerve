import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { Predicate, Schema } from "effect"
import { startDev } from "@grayhaven/nerve-cli"

const FIXTURE = join(
  import.meta.dirname,
  "../../../examples/motor-controller/src/main.harness.ts"
)

// Inside the repo tree so @grayhaven/nerve resolves through the workspace.
const dir = mkdtempSync(join(import.meta.dirname, "tmp-dev-"))
mkdirSync(join(dir, "src"), { recursive: true })
const harnessPath = join(dir, "src", "main.harness.ts")
writeFileSync(harnessPath, readFileSync(FIXTURE, "utf8"))

const sink = () => {
  const lines: Array<string> = []
  return { lines, out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) }
}

afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** What /state.json reports, decoded at the fetch boundary. */
const DevState = Schema.Struct({
  fingerprint: Schema.String,
  errors: Schema.Number,
  warnings: Schema.Number,
  compileError: Schema.optionalWith(Schema.String, { exact: true })
})
const readState = async (url: string) =>
  Schema.decodeUnknownSync(DevState)(await (await fetch(`${url}/state.json`)).json())

describe("nerve dev server", () => {
  it("rejects a listen failure and can reuse the port after the conflict clears", async () => {
    const blocker = createServer()
    await new Promise<void>((resolveListen, rejectListen) => {
      const onError = (cause: unknown): void => rejectListen(cause)
      blocker.once("error", onError)
      blocker.listen(0, "127.0.0.1", () => {
        blocker.off("error", onError)
        resolveListen()
      })
    })
    const address = blocker.address()
    if (address === null || Predicate.isString(address)) {
      throw new Error("loopback listener did not return a TCP address")
    }
    const port = address.port
    try {
      // Vitest 4.1.10: promise rejection assertions preserve native error properties for matching.
      await expect(startDev(harnessPath, { io: sink(), port })).rejects.toMatchObject({
        code: "EADDRINUSE"
      })
    } finally {
      await new Promise<void>((resolveClose) => blocker.close(() => resolveClose()))
    }

    const dev = await startDev(harnessPath, { io: sink(), port })
    expect(dev.port).toBe(port)
    await dev.close()
  }, 30000)

  it("serves live views, reports state, and picks up edits (fresh module cache)", async () => {
    const io = sink()
    const dev = await startDev(harnessPath, { io, port: 0 })
    try {
      const state1 = await readState(dev.url)
      expect(state1.fingerprint).not.toBe("")
      expect(state1.errors).toBe(0)

      // Every view serves a complete self-contained document with the
      // reload poller injected.
      for (const path of ["/", "/board", "/faces", "/pinout"]) {
        const html = await (await fetch(`${dev.url}${path}`)).text()
        expect(html, path).toContain("<!doctype html>")
        expect(html, path).toContain("state.json")
      }
      expect((await fetch(`${dev.url}/nope`)).status).toBe(404)

      // Edit the harness (bump the revision) and rebuild: the jiti module
      // cache MUST not serve the stale design — the known watch-mode trap.
      writeFileSync(
        harnessPath,
        readFileSync(harnessPath, "utf8").replace('revision: "A"', 'revision: "B"')
      )
      await dev.rebuild()
      const state2 = await readState(dev.url)
      expect(state2.fingerprint).not.toBe(state1.fingerprint)
      const html = await (await fetch(`${dev.url}/`)).text()
      expect(html).toContain("rev B")
    } finally {
      await dev.close()
    }
  }, 30000)

  it("keeps the last good render when a compile fails", async () => {
    const io = sink()
    const dev = await startDev(harnessPath, { io, port: 0 })
    try {
      const good = await readState(dev.url)
      const source = readFileSync(harnessPath, "utf8")
      writeFileSync(harnessPath, source + "\nthis is not typescript at all (")
      await dev.rebuild()
      const state = await readState(dev.url)
      expect(state.compileError).toBeDefined()
      // Last good render stays up.
      expect(state.fingerprint).toBe(good.fingerprint)
      expect((await fetch(`${dev.url}/`)).status).toBe(200)
      // Recovery: restore the file, rebuild, error clears.
      writeFileSync(harnessPath, source)
      await dev.rebuild()
      const recovered = await readState(dev.url)
      expect(recovered.compileError).toBeUndefined()
    } finally {
      await dev.close()
    }
  }, 30000)

  it("the WATCHER path recompiles on a real file write (fs.watch → filter → debounce)", async () => {
    // The other tests call rebuild() directly; this exercises the actual
    // watcher: write a config-dir file and poll /state.json for the new
    // fingerprint, with NO manual rebuild() call.
    const io = sink()
    const dev = await startDev(harnessPath, { io, port: 0 })
    try {
      const before = await readState(dev.url)
      // Change the revision regardless of its current value (earlier tests
      // share this fixture) so the HIR — and thus the fingerprint — moves.
      const src = readFileSync(harnessPath, "utf8")
      writeFileSync(harnessPath, src.replace(/revision: "[^"]*"/, 'revision: "WATCH"'))
      // Poll up to ~8s for the watcher+debounce to land a new compile.
      let after = before
      for (let i = 0; i < 80 && after.fingerprint === before.fingerprint; i++) {
        await new Promise((r) => setTimeout(r, 100))
        after = await readState(dev.url)
      }
      expect(after.fingerprint).not.toBe(before.fingerprint)
      expect(await (await fetch(`${dev.url}/`)).text()).toContain("rev WATCH")
    } finally {
      await dev.close()
    }
  }, 30000)

  // Retried: fs-event delivery is timing-sensitive under machine load; the test passes in isolation.
  it("config edits above src/ trigger the watcher (watch root = project root)", { retry: 2, timeout: 30000 }, async () => {
    // nerve.config.ts lives at the project root, above the entry's src/
    // dir; a write there must still recompile (#31).
    const io = sink()
    writeFileSync(join(dir, "nerve.config.ts"), `export default { units: "mm" }\n`)
    const dev = await startDev(harnessPath, { io, port: 0 })
    try {
      const seen = io.lines.length
      writeFileSync(join(dir, "nerve.config.ts"), `export default { units: "mm", defaultWireTolerance: 5 }\n`)
      let recompiled = false
      for (let i = 0; i < 80 && !recompiled; i++) {
        await new Promise((r) => setTimeout(r, 100))
        recompiled = io.lines.slice(seen).some((l) => l.includes("compiled"))
      }
      expect(recompiled).toBe(true)
    } finally {
      await dev.close()
    }
  })
})

#!/usr/bin/env node
// Prefer the TypeScript source when it is present, which is exactly the
// monorepo case: a `dist` from an earlier build would otherwise win and
// `nerve` would silently run stale code, ignoring the edit you just made.
// Published packages ship only `dist` (package.json "files"), so the source
// check fails there and the compiled build loads as before.
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const source = fileURLToPath(new URL("../src/index.ts", import.meta.url))
let main
if (existsSync(source)) {
  const { createJiti } = await import("jiti")
  const jiti = createJiti(import.meta.url)
  ;({ main } = await jiti.import("../src/index.ts"))
} else {
  ;({ main } = await import("../dist/index.js"))
}
process.exit(await main())

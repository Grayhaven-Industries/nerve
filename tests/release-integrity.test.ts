/**
 * Release integrity: bun publish rewrites workspace:* deps using versions
 * recorded in bun.lock — NOT package.json. A version bump without a
 * lockfile refresh ships packages depending on phantom versions (the
 * v0.5.0 publish did exactly this: every internal dep pinned to an
 * unpublished 0.4.0). This test fails the build if the lockfile's
 * workspace versions drift from the package.json versions.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { globSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parsePackageManifest } from "../scripts/json.js"

const ROOT = join(import.meta.dirname, "..")

describe("release integrity", () => {
  it("bun.lock workspace versions match package.json versions", () => {
    const lock = readFileSync(join(ROOT, "bun.lock"), "utf8")
    const pkgs = globSync("packages/*/package.json", { cwd: ROOT })
    expect(pkgs.length).toBeGreaterThanOrEqual(8)
    for (const rel of pkgs) {
      const pkg = parsePackageManifest(readFileSync(join(ROOT, rel), "utf8"))
      if (pkg.version === undefined) continue
      // The lockfile records each workspace as: "name": "<name>",\n "version": "<v>"
      const block = new RegExp(
        `"name": "${pkg.name.replace("/", "\\/")}",\\s*\\n\\s*"version": "([^"]+)"`
      )
      const m = block.exec(lock)
      expect(m, `${pkg.name} missing from bun.lock workspaces`).not.toBeNull()
      expect(m![1], `${pkg.name}: bun.lock has ${m![1]}, package.json has ${pkg.version} — run bun install after version bumps`).toBe(pkg.version)
    }
  })
})

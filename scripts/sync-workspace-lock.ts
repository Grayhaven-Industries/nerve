/**
 * Keep bun.lock's workspace version metadata aligned with package manifests.
 *
 * Bun 1.3 does not invalidate the lockfile when only a workspace package's
 * version changes. That is normally harmless, but `bun pm pack` uses these
 * fields to replace `workspace:*` dependency specs in published tarballs.
 * A stale value can therefore publish dependencies on a version that does not
 * exist. `bun install --frozen-lockfile` does not detect this drift either.
 *
 * The text edit is deliberately narrow and fail-closed: every versioned
 * workspace must have exactly one stanza matching its path and package name.
 * Nothing is written until all stanzas have been validated.
 *
 *   bun scripts/sync-workspace-lock.ts
 *   bun scripts/sync-workspace-lock.ts --check
 */
import { globSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve, sep } from "node:path"
import { isJsonString, parseJsonObject, parsePackageManifest } from "./json.js"

export interface WorkspaceVersion {
  readonly path: string
  readonly name: string
  readonly version: string
}

export interface WorkspaceVersionChange extends WorkspaceVersion {
  readonly previousVersion: string
}

export interface WorkspaceLockResult {
  readonly text: string
  readonly changes: readonly WorkspaceVersionChange[]
}

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const workspaceObjectRange = (lockText: string): readonly [number, number] => {
  const marker = '  "workspaces": {'
  const markerIndex = lockText.indexOf(marker)
  if (markerIndex === -1 || markerIndex !== lockText.lastIndexOf(marker)) {
    throw new Error("bun.lock must contain exactly one top-level workspaces object")
  }

  const open = markerIndex + marker.lastIndexOf("{")
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = open; index < lockText.length; index += 1) {
    const char = lockText[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") depth += 1
    else if (char === "}") {
      depth -= 1
      if (depth === 0) return [open + 1, index]
      if (depth < 0) break
    }
  }

  throw new Error("bun.lock workspaces object is not balanced")
}

/** Synchronize the exact path/name stanza for every versioned workspace. */
export const synchronizeWorkspaceLock = (
  lockText: string,
  workspaces: readonly WorkspaceVersion[]
): WorkspaceLockResult => {
  const [start, end] = workspaceObjectRange(lockText)
  let body = lockText.slice(start, end)
  const changes: WorkspaceVersionChange[] = []
  const seenPaths = new Set<string>()

  for (const workspace of workspaces) {
    if (seenPaths.has(workspace.path)) {
      throw new Error(`duplicate workspace manifest path: ${workspace.path}`)
    }
    seenPaths.add(workspace.path)

    const pathLiteral = escapeRegExp(JSON.stringify(workspace.path))
    const nameLiteral = escapeRegExp(JSON.stringify(workspace.name))
    const stanza = new RegExp(
      `(^    ${pathLiteral}: \\{\\r?\\n` +
        `      "name": ${nameLiteral},\\r?\\n` +
        `      "version": )"([^"\\r\\n]+)"(,\\r?$)`,
      "gm"
    )
    const matches = [...body.matchAll(stanza)]
    if (matches.length !== 1) {
      throw new Error(
        `${workspace.path} (${workspace.name}) must match exactly one bun.lock workspace stanza; matched ${matches.length}`
      )
    }

    const previousVersion = matches[0]?.[2]
    if (previousVersion === undefined) {
      throw new Error(`${workspace.path} (${workspace.name}) has no readable bun.lock version`)
    }
    if (previousVersion === workspace.version) continue

    changes.push({ ...workspace, previousVersion })
    body = body.replace(stanza, (_match, prefix: string, _version: string, suffix: string) =>
      `${prefix}${JSON.stringify(workspace.version)}${suffix}`
    )
  }

  return {
    text: lockText.slice(0, start) + body + lockText.slice(end),
    changes
  }
}

const workspacePatterns = (root: string): readonly string[] => {
  const rootPackage = parseJsonObject(readFileSync(join(root, "package.json"), "utf8"))
  const configured = rootPackage["workspaces"]
  if (!Array.isArray(configured) || !configured.every(isJsonString)) {
    throw new Error("root package.json workspaces must be an array of path patterns")
  }
  return configured
}

/** Load every versioned workspace named by the root package.json. */
export const loadWorkspaceVersions = (root: string): readonly WorkspaceVersion[] => {
  const manifestPaths = new Set<string>()
  for (const configured of workspacePatterns(root)) {
    const pattern = configured.endsWith("package.json")
      ? configured
      : `${configured.replace(/\/$/, "")}/package.json`
    for (const manifestPath of globSync(pattern, { cwd: root })) manifestPaths.add(manifestPath)
  }

  const workspaces: WorkspaceVersion[] = []
  for (const manifestPath of [...manifestPaths].sort()) {
    const manifest = parsePackageManifest(readFileSync(join(root, manifestPath), "utf8"))
    if (manifest.version === undefined) continue
    const path = relative(root, dirname(join(root, manifestPath))).split(sep).join("/")
    workspaces.push({ path, name: manifest.name, version: manifest.version })
  }
  return workspaces
}

export const run = (args: readonly string[], root: string): number => {
  const check = args.length === 1 && args[0] === "--check"
  if ((!check && args.length !== 0) || args.length > 1) {
    console.error("usage: bun scripts/sync-workspace-lock.ts [--check]")
    return 2
  }

  const lockPath = join(root, "bun.lock")
  const original = readFileSync(lockPath, "utf8")
  const result = synchronizeWorkspaceLock(original, loadWorkspaceVersions(root))
  if (result.changes.length === 0) {
    console.log("✓ bun.lock workspace versions match package manifests")
    return 0
  }

  for (const change of result.changes) {
    console.error(
      `${change.path}: bun.lock ${change.previousVersion} -> package.json ${change.version}`
    )
  }
  if (check) {
    console.error("✗ bun.lock workspace versions are stale; run `bun run sync-workspace-lock`")
    return 1
  }

  writeFileSync(lockPath, result.text)
  console.log(`✓ synchronized ${result.changes.length} bun.lock workspace version(s)`)
  return 0
}

if (import.meta.main) process.exit(run(process.argv.slice(2), resolve(import.meta.dirname, "..")))

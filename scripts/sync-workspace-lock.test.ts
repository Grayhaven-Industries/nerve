import { describe, expect, it } from "vitest"
import { synchronizeWorkspaceLock, type WorkspaceVersion } from "./sync-workspace-lock.js"

const versions: readonly WorkspaceVersion[] = [
  { path: "packages/a", name: "@example/a", version: "2.0.0" },
  { path: "packages/b", name: "@example/b", version: "2.0.0" }
]

const fixture = `{
  "lockfileVersion": 1,
  "workspaces": {
    "packages/a": {
      "name": "@example/a",
      "version": "1.0.0",
      "dependencies": {
        "@example/b": "workspace:*",
      },
    },
    "packages/b": {
      "name": "@example/b",
      "version": "1.0.0",
    },
  },
  "packages": {
    "note": ["the workspaces parser must not edit this 1.0.0 string"],
  },
}
`

describe("synchronizeWorkspaceLock", () => {
  it("updates only exact path/name workspace versions", () => {
    const result = synchronizeWorkspaceLock(fixture, versions)

    expect(result.changes).toEqual([
      { ...versions[0], previousVersion: "1.0.0" },
      { ...versions[1], previousVersion: "1.0.0" }
    ])
    expect(result.text.match(/"version": "2\.0\.0"/g)).toHaveLength(2)
    expect(result.text).toContain("the workspaces parser must not edit this 1.0.0 string")
  })

  it("is idempotent once versions match", () => {
    const first = synchronizeWorkspaceLock(fixture, versions)
    const second = synchronizeWorkspaceLock(first.text, versions)

    expect(second).toEqual({ text: first.text, changes: [] })
  })

  it("fails closed when path and name do not identify exactly one stanza", () => {
    expect(() =>
      synchronizeWorkspaceLock(fixture, [
        { path: "packages/a", name: "@example/wrong", version: "2.0.0" }
      ])
    ).toThrow("must match exactly one")

    const duplicate = fixture.replace(
      "    \"packages/b\": {",
      `    "packages/a": {
      "name": "@example/a",
      "version": "1.0.0",
    },
    "packages/b": {`
    )
    expect(() => synchronizeWorkspaceLock(duplicate, [versions[0]!])).toThrow("matched 2")
  })

  it("rejects an ambiguous or malformed workspaces object", () => {
    expect(() => synchronizeWorkspaceLock(fixture + fixture, versions)).toThrow("exactly one")
    const truncated = fixture.slice(0, fixture.indexOf('\n  },\n  "packages"'))
    expect(() => synchronizeWorkspaceLock(truncated, versions)).toThrow("not balanced")
  })
})

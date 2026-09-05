import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { run, type Io } from "../src/index.js"

const directories: string[] = []
const capture = () => {
  const stdout: string[] = [], stderr: string[] = []
  const io: Io = { out: (line) => stdout.push(line), err: (line) => stderr.push(line) }
  return { io, stdout, stderr }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("contract command help", () => {
  it.each([
    ["contract", "--help"],
    ["contract", "-h"],
    ["contract", "--manifest", "-h"],
    ["contract", "--out", "-h"],
    ["contract", "--help", "missing.harness.ts"],
    ["contract", "missing.harness.ts", "--connector", "J1", "--help"],
    ["help", "contract"],
    ["--help", "contract"]
  ])("shows command help for %j without requiring valid input", async (...args) => {
    const { io, stdout, stderr } = capture()
    expect(await run(args, io)).toBe(0)
    expect(stderr).toEqual([])
    const text = stdout.join("\n")
    expect(text).toContain("nerve contract <file.harness.ts> --connector")
    expect(text).toContain("nerve contract --manifest")
    expect(text).toContain("--kicad-cli")
    expect(text).toContain("--format circuit-json")
    expect(text).toContain("Exit codes:")
    expect(text).not.toContain("nerve compile")
  })

  it.each([
    ["--manifest", "missing.json", "--help"],
    ["--manifest", "missing.json", "-h"],
    ["--manifest", "-h"]
  ])("leaves reports and artifacts untouched with invalid options %j", async (...args) => {
    const directory = mkdtempSync(join(tmpdir(), "nerve-contract-help-"))
    directories.push(directory)
    const files = ["interface-report.json", "contract-controller.normalized.json", ".nerve-interface-files.json"]
    for (const file of files) writeFileSync(join(directory, file), `keep ${file}\n`)
    const { io, stderr } = capture()
    expect(await run([
      "contract", "--out", directory, "--json", ...args
    ], io)).toBe(0)
    expect(stderr).toEqual([])
    expect(readdirSync(directory).sort()).toEqual([...files].sort())
    for (const file of files) expect(readFileSync(join(directory, file), "utf8")).toBe(`keep ${file}\n`)
  })
})

import { afterEach, describe, expect, it } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { run, type Io } from "../src/index.js"
import type { InterfaceReport } from "../src/contract-project.js"

const harness = resolve(import.meta.dirname, "../../../examples/motor-controller/src/main.harness.ts")
const boardFixture = resolve(import.meta.dirname, "../../nerve-exporters/test/fixtures/controller.kicad_pcb")
const entry = { id: "controller", connector: "J1", against: "controller.kicad_pcb", component: "BOARD_J7" }
const input = { schemaVersion: "0.1.0", harness, interfaces: [entry] }
const directories: string[] = []
const setup = () => {
  const directory = mkdtempSync(join(tmpdir(), "nerve-manifest-errors-"))
  directories.push(directory)
  const manifest = join(directory, "nerve-interfaces.json")
  const out = join(directory, "output")
  mkdirSync(out)
  writeFileSync(join(out, "interface-report.json"), "previous verdict")
  return { directory, manifest, out }
}
const check = async (manifest: string, out: string) => {
  const stdout: string[] = [], stderr: string[] = []
  const io: Io = { out: (s) => stdout.push(s), err: (s) => stderr.push(s) }
  const code = await run(["contract", "--manifest", manifest, "--json", "--out", out], io)
  return { code, stdout, stderr: stderr.join("\n") }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("manifest error messages", () => {
  it.each([
    { name: "null manifest", value: null, detail: "$: Expected an interface manifest object" },
    { name: "array manifest", value: [], detail: "$: Expected an interface manifest object" },
    { name: "missing harness", value: { schemaVersion: "0.1.0", interfaces: [entry] }, detail: "harness: is missing" },
    { name: "unsupported version", value: { ...input, schemaVersion: "999" }, detail: 'schemaVersion: Expected "0.1.0", actual "999"' },
    { name: "empty interfaces", value: { ...input, interfaces: [] }, detail: "interfaces: Add at least one interface." },
    { name: "non-array interfaces", value: { ...input, interfaces: "controller" }, detail: "interfaces: Expected an array of interface objects" },
    { name: "non-object interface", value: { ...input, interfaces: [null] }, detail: "interfaces[0]: Expected an interface object" },
    { name: "numeric id", value: { ...input, interfaces: [{ ...entry, id: 7 }] }, detail: "interfaces[0].id: Expected string" },
    { name: "unsafe id", value: { ...input, interfaces: [{ ...entry, id: "../controller" }] }, detail: "interfaces[0].id: Start with a letter or number" },
    { name: "empty harness", value: { ...input, harness: "" }, detail: "harness: Must not be empty." },
    { name: "whitespace connector", value: { ...input, interfaces: [{ ...entry, connector: " J1" }] }, detail: "interfaces[0].connector: Remove leading or trailing whitespace." },
    { name: "numeric pins", value: { ...input, interfaces: [{ ...entry, pins: 1 }] }, detail: "interfaces[0].pins: Expected an object mapping source-pad strings to harness-cavity strings" },
    { name: "array pins", value: { ...input, interfaces: [{ ...entry, pins: ["1"] }] }, detail: "interfaces[0].pins: Expected an object mapping source-pad strings to harness-cavity strings" },
    { name: "numeric cavity", value: { ...input, interfaces: [{ ...entry, pins: { "1": 1 } }] }, detail: 'interfaces[0].pins["1"]: Expected string' },
    { name: "empty source pad", value: { ...input, interfaces: [{ ...entry, pins: { "": "1" } }] }, detail: 'interfaces[0].pins[""]: is unexpected, expected: a nonempty string without surrounding whitespace' },
    { name: "whitespace source pad", value: { ...input, interfaces: [{ ...entry, pins: { " 1": "1" } }] }, detail: 'interfaces[0].pins[" 1"]: is unexpected, expected: a nonempty string without surrounding whitespace' },
    { name: "duplicate id", value: { ...input, interfaces: [entry, entry] }, detail: 'interfaces[1].id: Duplicate interface id "controller"; already used by interfaces[0].id.' },
    { name: "duplicate mapping", value: { ...input, interfaces: [entry, { ...entry, id: "copy" }] }, detail: 'interfaces[1]: Duplicate interface mapping "copy"; connector, against, and component already match interfaces[0].' }
  ])("identifies $name without exposing the schema", async ({ value, detail }) => {
    const s = setup()
    writeFileSync(s.manifest, JSON.stringify(value))
    const result = await check(s.manifest, s.out)
    expect(result.code).toBe(2)
    expect(result.stdout).toEqual([])
    expect(result.stderr).toContain(`Invalid manifest ${s.manifest}: ${detail}`)
    expect(result.stderr).not.toMatch(/readonly|refinement|ReadonlyArray|└|minLength|filter/)
    expect(result.stderr.length).toBeLessThan(600)
    expect(existsSync(join(s.out, "interface-report.json"))).toBe(false)
  })

  it("names the unknown field and accepted keys, then recovers after correction", async () => {
    const s = setup()
    writeFileSync(join(s.directory, "controller.kicad_pcb"), readFileSync(boardFixture))
    writeFileSync(join(s.out, "keep.txt"), "unrelated output")
    writeFileSync(s.manifest, JSON.stringify(input))
    expect((await check(s.manifest, s.out)).code).toBe(0)

    writeFileSync(s.manifest, JSON.stringify({ ...input, interfaces: [{ ...entry, componentRef: "BOARD_J7" }] }))
    const failure = await check(s.manifest, s.out)
    expect(failure.code).toBe(2)
    expect(failure.stdout).toEqual([])
    expect(failure.stderr).toContain('interfaces[0].componentRef: is unexpected, expected: "id" | "connector" | "against" | "component" | "mpn" | "pins"')
    expect(failure.stderr.split("\n")).toHaveLength(1)
    expect(existsSync(join(s.out, "interface-report.json"))).toBe(false)
    expect(readFileSync(join(s.out, "keep.txt"), "utf8")).toBe("unrelated output")

    writeFileSync(s.manifest, JSON.stringify(input))
    const recovery = await check(s.manifest, s.out)
    expect(recovery.code).toBe(0)
    const report: InterfaceReport = JSON.parse(recovery.stdout.join("\n"))
    expect(report).toMatchObject({ complete: true, summary: { errors: 0, interfaces: 1 } })
    expect(report.interfaces[0]?.status).toBe("pass")
    expect(JSON.parse(readFileSync(join(s.out, "interface-report.json"), "utf8"))).toEqual(report)
  })

  it("keeps JSON syntax failures readable and invalidates the previous verdict", async () => {
    const s = setup()
    writeFileSync(s.manifest, '{"schemaVersion": "0.1.0",}')
    const result = await check(s.manifest, s.out)
    expect(result.code).toBe(2)
    expect(result.stdout).toEqual([])
    expect(result.stderr).toContain(`Invalid manifest ${s.manifest}: Invalid JSON:`)
    expect(result.stderr).not.toContain("\n    at ")
    expect(result.stderr.length).toBeLessThan(500)
    expect(existsSync(join(s.out, "interface-report.json"))).toBe(false)
  })

  it("bounds large invalid values and reports a limited set of actionable fields", async () => {
    const s = setup()
    writeFileSync(s.manifest, JSON.stringify({ ...input, interfaces: Array.from({ length: 8 }, () => ({ ...entry, connector: ["x".repeat(1000)] })) }))
    const result = await check(s.manifest, s.out)
    expect(result.code).toBe(2)
    expect(result.stderr).toContain("interfaces[0].connector: Expected string")
    expect(result.stderr).toContain("3 more issue(s). Fix these fields and retry.")
    expect(result.stderr.length).toBeLessThan(2300)
    expect(result.stderr).not.toContain("interfaces[5]")
  })
})

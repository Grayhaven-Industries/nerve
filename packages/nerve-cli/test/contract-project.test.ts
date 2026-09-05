import { afterEach, describe, expect, it, vi } from "vitest"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { run, type Io } from "../src/index.js"
import { decodeInterfaceManifest, exportSchematicNetlist, type InterfaceReport } from "../src/contract-project.js"

const harness = resolve(import.meta.dirname, "../../../examples/motor-controller/src/main.harness.ts")
const fixtures = resolve(import.meta.dirname, "../../nerve-exporters/test/fixtures")
const directories: string[] = []
const temp = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "nerve-interfaces-test-"))
  directories.push(directory)
  return directory
}
const capture = () => {
  const stdout: string[] = [], stderr: string[] = []
  const io: Io = { out: (s) => stdout.push(s), err: (s) => stderr.push(s) }
  return { io, stdout, stderr }
}
const write = <A>(path: string, value: A): void => writeFileSync(path, JSON.stringify(value, null, 2))
const setup = () => {
  const directory = temp()
  const board = join(directory, "controller.kicad_pcb")
  writeFileSync(board, readFileSync(join(fixtures, "controller.kicad_pcb")))
  const manifest = join(directory, "nerve-interfaces.json")
  const entry = { id: "controller", connector: "J1", against: "controller.kicad_pcb", component: "BOARD_J7" }
  const input = { schemaVersion: "0.1.0", harness: relative(directory, harness), interfaces: [entry] }
  write(manifest, input)
  return { directory, board, manifest, entry, input }
}
const check = async (manifest: string, out: string) => {
  const captured = capture()
  const code = await run(["contract", "--manifest", manifest, "--json", "--out", out], captured.io)
  const report: InterfaceReport = JSON.parse(captured.stdout.join("\n"))
  return { ...captured, code, report }
}

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("project interface checks", () => {
  it("checks multiple sources, keeps portable provenance, and produces byte-identical reports in any output directory", async () => {
    const s = setup()
    writeFileSync(join(s.directory, "controller.net"), readFileSync(join(fixtures, "controller.net")))
    write(s.manifest, { ...s.input, interfaces: [s.entry, { ...s.entry, id: "schematic", against: "controller.net" }] })
    const first = await check(s.manifest, temp())
    const second = await check(s.manifest, temp())
    expect(first.code).toBe(0)
    expect(first.stdout).toEqual(second.stdout)
    expect(first.report).toMatchObject({ complete: true, summary: { interfaces: 2, errors: 0, uncheckedConnectors: ["M1"] } })
    expect(first.report.interfaces.map((e) => e.source)).toEqual(["controller.kicad_pcb", "controller.net"])
    expect(first.report.interfaces[0]?.contract?.source?.designRevision).toBe("A")
  })

  it("identifies a board-revision pin swap and blocks the gate", async () => {
    const s = setup()
    writeFileSync(s.board, readFileSync(s.board, "utf8").replace('(rev "A")', '(rev "B")').replace('(net 3 "CAN_H")', '(net 3 "CAN_L")'))
    const result = await check(s.manifest, temp())
    expect(result.code).toBe(1)
    expect(result.report.interfaces[0]?.contract?.source?.designRevision).toBe("B")
    expect(result.report.interfaces[0]?.diagnostics).toContainEqual(expect.objectContaining({ code: "HK-IFC-004", target: "connector:J1.pin:3" }))
  })

  it("applies a complete explicit source-pad to cavity map and retains pad identity for the plugin", async () => {
    const s = setup()
    writeFileSync(s.board, readFileSync(s.board, "utf8").replace('(net 3 "CAN_H")', '(net 3 "CAN_L")').replace('(net 4 "CAN_L")', '(net 4 "CAN_H")'))
    const pins = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [String(index + 1), String(index === 2 ? 4 : index === 3 ? 3 : index + 1)]))
    write(s.manifest, { ...s.input, interfaces: [{ ...s.entry, pins }] })
    const result = await check(s.manifest, temp())
    expect(result.code).toBe(0)
    expect(result.report.interfaces[0]?.contract?.pinout.find((pin) => pin.pin === "3")).toMatchObject({ sourcePin: "4", signal: "CAN_H" })
    write(s.manifest, { ...s.input, interfaces: [{ ...s.entry, pins: { "3": "4" } }] })
    expect((await check(s.manifest, temp())).code).toBe(2)
    write(s.manifest, { ...s.input, interfaces: [{ ...s.entry, pins: { ...pins, "1": "3" } }] })
    expect((await check(s.manifest, temp())).code).toBe(2)
  })

  it("continues checking other interfaces when one source is missing", async () => {
    const s = setup()
    write(s.manifest, { ...s.input, interfaces: [s.entry, { ...s.entry, id: "missing", against: "absent.kicad_pcb" }] })
    const result = await check(s.manifest, temp())
    expect(result.code).toBe(2)
    expect(result.report.complete).toBe(false)
    expect(result.report.interfaces.map((e) => e.status)).toEqual(["pass", "incomplete"])
    expect(result.report.diagnostics).toContainEqual(expect.objectContaining({ code: "HK-IFC-007" }))
  })

  it("reports unknown connectivity as incomplete evidence", async () => {
    const s = setup()
    const unknown = join(s.directory, "unknown.csv")
    writeFileSync(unknown, "pin,signal\n1,\n2,GND\n")
    write(s.manifest, { ...s.input, interfaces: [{ ...s.entry, against: "unknown.csv" }] })
    const result = await check(s.manifest, temp())
    expect(result.code).toBe(2)
    expect(result.report.interfaces[0]?.diagnostics).toContainEqual(expect.objectContaining({ code: "HK-IFC-008", target: "connector:J1.pin:1" }))
  })

  it("prunes removed/failed generated contracts without touching requested inputs or unrelated files", async () => {
    const s = setup(), out = temp()
    expect((await check(s.manifest, out)).code).toBe(0)
    const normalized = join(out, "contract-controller.normalized.json")
    write(s.manifest, { ...s.input, interfaces: [{ ...s.entry, against: normalized }] })
    expect((await check(s.manifest, out)).code).toBe(0)
    expect(existsSync(normalized)).toBe(true)
    writeFileSync(join(out, "keep.json"), "keep")
    write(s.manifest, { ...s.input, interfaces: [{ ...s.entry, id: "renamed", against: "absent.kicad_pcb" }] })
    expect((await check(s.manifest, out)).code).toBe(2)
    expect(existsSync(normalized)).toBe(false)
    expect(readFileSync(join(out, "keep.json"), "utf8")).toBe("keep")
  })

  it("invalidates the previous verdict before a compile or manifest failure", async () => {
    const s = setup(), out = temp()
    await check(s.manifest, out)
    write(s.manifest, { ...s.input, harness: "missing.harness.ts" })
    expect(await run(["contract", "--manifest", s.manifest, "--out", out], capture().io)).toBe(2)
    expect(existsSync(join(out, "interface-report.json"))).toBe(false)
    write(s.manifest, s.input)
    await check(s.manifest, out)
    write(s.manifest, { ...s.input, schemaVersion: "999" })
    expect(await run(["contract", "--manifest", s.manifest, "--out", out], capture().io)).toBe(2)
    expect(existsSync(join(out, "interface-report.json"))).toBe(false)
  })

  it("preserves input files when a manifest or contract occupies the report output path", async () => {
    const s = setup(), output = temp()
    const overlapping = join(output, "interface-report.json")
    write(overlapping, s.input)
    const original = readFileSync(overlapping, "utf8")
    expect(await run(["contract", "--manifest", overlapping, "--out", output], capture().io)).toBe(2)
    expect(readFileSync(overlapping, "utf8")).toBe(original)
    write(s.manifest, { ...s.input, interfaces: [{ ...s.entry, against: overlapping }] })
    expect(await run(["contract", "--manifest", s.manifest, "--out", output], capture().io)).toBe(2)
    expect(readFileSync(overlapping, "utf8")).toBe(original)
  })

  it("rejects ambiguous or misspelled manifest declarations", () => {
    const s = setup()
    expect(() => decodeInterfaceManifest({ ...s.input, interfaces: [] })).toThrow()
    expect(() => decodeInterfaceManifest({ ...s.input, interfaces: [s.entry, s.entry] })).toThrow(/Duplicate/)
    expect(() => decodeInterfaceManifest({ ...s.input, interfaces: [{ ...s.entry, id: "../escape" }] })).toThrow()
    expect(() => decodeInterfaceManifest({ ...s.input, interfacse: [] })).toThrow()
  })
})

describe("single contract compatibility and KiCad CLI", () => {
  it("can validate against its own previous normalized output", async () => {
    const s = setup(), out = temp(), io = capture().io
    const args = ["contract", harness, "--connector", "J1", "--component", "BOARD_J7", "--out", out]
    expect(await run([...args, "--against", s.board], io)).toBe(0)
    expect(await run([...args, "--against", join(out, "contract-J1.normalized.json")], io)).toBe(0)
  })

  it("invalidates a configured output directory even when the next compile fails", async () => {
    const s = setup(), output = temp()
    const source = join(s.directory, "src", "main.harness.ts")
    mkdirSync(dirname(source), { recursive: true })
    writeFileSync(source, `export { default } from ${JSON.stringify(harness)};`)
    writeFileSync(join(s.directory, "nerve.config.ts"), `export default { outputDir: ${JSON.stringify(output)} };`)
    const args = ["contract", source, "--connector", "J1", "--against", s.board, "--component", "BOARD_J7"]
    expect(await run(args, capture().io)).toBe(0)
    expect(existsSync(join(output, "interface-report.json"))).toBe(true)
    writeFileSync(source, "export default !")
    expect(await run(args, capture().io)).toBe(2)
    expect(existsSync(join(output, "interface-report.json"))).toBe(false)
  })

  it("validates JSON contract input and honors explicit manifest MPN overrides", async () => {
    const s = setup(), out = temp()
    await run(["contract", harness, "--connector", "J1", "--out", out], capture().io)
    const contract = join(out, "contract-J1.json")
    write(s.manifest, { ...s.input, interfaces: [{ ...s.entry, against: contract, mpn: "OVERRIDE" }] })
    const result = await check(s.manifest, temp())
    expect(result.report.interfaces[0]?.contract?.mpn).toBe("OVERRIDE")
    expect(result.report.interfaces[0]?.diagnostics).toContainEqual(expect.objectContaining({ code: "HK-IFC-002" }))
    write(contract, { contractVersion: "0.1.0", pinout: "invalid" })
    expect((await check(s.manifest, temp())).code).toBe(2)
  })

  it("invokes KiCad without a shell, accepts paths with spaces, and cleans transient exports", () => {
    const directory = temp()
    const executable = join(directory, "fake kicad-cli")
    const log = join(directory, "args.json")
    const netlist = readFileSync(join(fixtures, "controller.net"), "utf8")
    writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs'); const args = process.argv.slice(2); fs.writeFileSync(${JSON.stringify(log)}, JSON.stringify(args)); fs.writeFileSync(args[args.indexOf('--output') + 1], ${JSON.stringify(netlist)});\n`)
    chmodSync(executable, 0o755)
    const source = join(directory, "board with spaces.kicad_sch")
    expect(exportSchematicNetlist(source, executable)).toBe(netlist)
    const args: string[] = JSON.parse(readFileSync(log, "utf8"))
    expect(args.slice(0, 6)).toEqual(["sch", "export", "netlist", "--format", "kicadsexpr", "--output"])
    expect(args.at(-1)).toBe(source)
    expect(existsSync(dirname(args[6]!))).toBe(false)
    expect(() => exportSchematicNetlist(source, join(directory, "not-installed"))).toThrow(/Install KiCad/)
  })

  it("imports schematic source through KiCad and handles uppercase extensions", async () => {
    const s = setup()
    const executable = join(s.directory, "kicad-cli")
    writeFileSync(executable, `#!${process.execPath}\nconst fs = require('node:fs'); const a = process.argv; fs.copyFileSync(${JSON.stringify(join(fixtures, "controller.net"))}, a[a.indexOf('--output') + 1]);\n`)
    chmodSync(executable, 0o755)
    write(s.manifest, { ...s.input, interfaces: [{ ...s.entry, against: "controller.KICAD_SCH" }] })
    const io = capture()
    expect(await run(["contract", "--manifest", s.manifest, "--kicad-cli", executable, "--json", "--out", temp()], io.io)).toBe(0)
    const report: InterfaceReport = JSON.parse(io.stdout.join("\n"))
    expect(report.interfaces[0]?.contract?.source?.format).toBe("kicad-netlist")
  })
})

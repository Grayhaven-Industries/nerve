// vitest 4.1.10 (root package.json / bun.lock) — describe/it/expect only.
import { describe, expect, it } from "vitest"
import { compileDesign } from "@grayhaven/nerve"
import motor from "../../../examples/motor-controller/src/main.harness.js"
import {
  builtinAdapters,
  cirrisEasyWireNetlist,
  experimentalCirrisEasyWireNetlist,
  findAdapter
} from "../src/adapters.js"
import { createBuildRecord } from "../src/build-record.js"
import { createRelease } from "../src/release.js"
import { approveTestSpecification, createTestSpecification } from "../src/test-spec.js"
import { generateTestPlan, type TestPlan } from "../src/test-plan.js"
import { ingestTesterResults } from "../src/tester-ingest.js"

const { hir } = compileDesign(motor)
const plan = generateTestPlan(hir)
const release = createRelease(hir, {
  eco: { id: "ECO-001", reason: "Initial release" },
  createdAt: "2026-06-06"
})
const specification = approveTestSpecification(
  createTestSpecification(plan, {
    id: "ETS-MOTOR",
    revision: "A",
    authority: { source: "controlled engineering procedure ETP-MOTOR-A" },
    steps: plan.tests.map((test) =>
      test.expected === "closed"
        ? { id: test.id, method: "continuity" as const, maxOhms: 1.5 }
        : {
            id: test.id,
            method: "insulation-resistance" as const,
            testVoltageV: 250,
            minOhms: 1_000_000
          }
    )
  }),
  { approvedBy: "quality-a", approvedAt: "2026-06-06T12:00:00Z" }
)

const NETLIST_FILE = "cirris-easywire.netlist.txt"

const exported = (): string =>
  cirrisEasyWireNetlist.generate(hir).files.get(NETLIST_FILE)!

/** The fingerprint the exported program hands the shop floor. */
const exportedFingerprint = (): string =>
  /^# hir-fingerprint: (\w+)$/m.exec(exported())![1]!

/** Rows of one `[SECTION]` block of the net list. */
const section = (text: string, name: string): Array<Array<string>> => {
  const block = text.split(`[${name}]\n`)[1]!.split("[")[0]!
  return block
    .split("\n")
    .filter((line) => line.length > 0)
    .slice(1) // header row
    .map((line) => line.split(","))
}

/** What a tester writes back: one row per executed test, plus provenance. */
const resultsCsv = (
  tests: TestPlan["tests"],
  fingerprint: string,
  overrides: Readonly<Record<string, number>> = {}
): string =>
  `# hir-fingerprint: ${fingerprint}\nTest ID,Method,Measured ohms,Applied voltage V,Applied waveform,Interlock confirmed,Discharge confirmed\n` +
  tests
    .map((t) =>
      t.expected === "closed"
        ? `${t.id},continuity,${overrides[t.id] ?? 0.4},,,,`
        : `${t.id},insulation-resistance,${overrides[t.id] ?? 5_000_000},250,dc,true,true`
    )
    .join("\n") +
  "\n"

describe("cirris-easywire-netlist adapter (PRD §31)", () => {
  it("is directly importable but absent from production discovery", () => {
    expect(experimentalCirrisEasyWireNetlist).toBe(cirrisEasyWireNetlist)
    expect(builtinAdapters).not.toContain(cirrisEasyWireNetlist)
    expect(findAdapter("cirris-easywire-netlist")).toBeUndefined()
    expect(cirrisEasyWireNetlist.kind).toBe("continuity-tester")
  })

  it("exports the same bytes for the same HIR", () => {
    expect(exported()).toBe(exported())
    expect(cirrisEasyWireNetlist.generate(hir)).toEqual(cirrisEasyWireNetlist.generate(hir))
  })

  it("carries revision, fingerprint, and HIR refs back to the design", () => {
    const text = exported()
    expect(text).toContain("# adapter: cirris-easywire-netlist")
    expect(text).toContain("# revision: A")
    expect(exportedFingerprint()).toBe(release.hirFingerprint)
    expect(section(text, "POINTS")[0]).toEqual(["J1-1", "J1", "1", "connector:J1.pin:1"])
    expect(section(text, "CONNECT").every((row) => row[4]!.length > 0)).toBe(true)
  })

  it("lists every wired net the test plan proves", () => {
    const connect = section(exported(), "CONNECT")
    const listed = new Set(connect.map((row) => row[0]!))
    const proven = new Set(
      plan.tests.filter((t) => t.expected === "closed").map((t) => t.net!)
    )
    expect(proven.size).toBeGreaterThan(0)
    for (const net of proven) expect(listed).toContain(net)
    // Isolation pairs ride the same file, one row per no-short test.
    expect(section(exported(), "ISOLATE")).toHaveLength(
      plan.tests.filter((t) => t.expected === "open").length
    )
  })

  it("declares that the format is unvalidated against real hardware", () => {
    const limitations = cirrisEasyWireNetlist.limitations!.join(" ")
    expect(limitations).toMatch(/NOT validated against real Cirris hardware/i)
    expect(limitations).toMatch(/best-effort/i)
    // The same honesty rides in the file and on the diagnostics channel.
    expect(exported()).toContain("unvalidated against Cirris hardware")
    const [diagnostic] = cirrisEasyWireNetlist.generate(hir).diagnostics
    expect(diagnostic).toMatchObject({ code: "HK-ADAPT-003", severity: "info" })
    expect(diagnostic?.message).toContain("proprietary and unverified")
  })
})

describe("tester result ingest (PRD §36)", () => {
  it("round-trips export → tester results → build record verdicts", () => {
    // The tester reads the exported program, so it answers with the
    // fingerprint that program printed.
    const source = resultsCsv(plan.tests, exportedFingerprint(), { "T-002": 480 })
    const ingest = ingestTesterResults(source, release, { plan })

    expect(ingest.fingerprintMatches).toBe(true)
    expect(ingest.diagnostics).toEqual([])
    expect(ingest.measurements).toHaveLength(plan.tests.length)

    const record = createBuildRecord(hir, release, ingest.measurements, {
      serial: "SN-0001",
      operator: "tester-8100",
      buildDate: "2026-06-06",
      testSpecification: specification
    })
    expect(record.summary).toEqual({
      pass: plan.tests.length - 1,
      fail: 1,
      notRun: 0,
      unassessed: 0,
      status: "fail"
    })
    // T-002 is a continuity step: 480 Ω is an open joint, not a wire.
    expect(record.results.find((r) => r.id === "T-002")).toMatchObject({
      verdict: "fail",
      measuredOhms: 480
    })
  })

  it("does not throw on a fingerprint from another design — it reports", () => {
    const source = resultsCsv(plan.tests, "deadbeefdeadbeef")
    const ingest = ingestTesterResults(source, release, { plan })

    expect(ingest.fingerprintMatches).toBe(false)
    const mismatch = ingest.diagnostics.find((d) => d.code === "HK-TEST-002")
    expect(mismatch?.severity).toBe("error")
    expect(mismatch?.message).toContain(release.hirFingerprint)
    expect(mismatch?.data).toMatchObject({ claimed: "deadbeefdeadbeef" })
    // Measurements still parse: the caller decides what to do about it.
    expect(ingest.measurements).toHaveLength(plan.tests.length)
  })

  it("reads the claimed fingerprint out of band when the file carries none", () => {
    const source = "Test ID,Measured ohms\nT-001,0.4\n"
    expect(
      ingestTesterResults(source, release, {
        expectFingerprint: release.hirFingerprint
      }).fingerprintMatches
    ).toBe(true)

    const unclaimed = ingestTesterResults(source, release)
    expect(unclaimed.fingerprintMatches).toBe(false)
    expect(unclaimed.diagnostics.map((d) => d.code)).toEqual(["HK-TEST-001"])
  })

  it("reports unknown result ids and counts planned tests with no result", () => {
    const source =
      resultsCsv(plan.tests.slice(0, 3), exportedFingerprint()) +
      "T-999,continuity,0.1,,,,\n"
    const ingest = ingestTesterResults(source, release, { plan })

    expect(ingest.fingerprintMatches).toBe(true)
    const unknown = ingest.diagnostics.find((d) => d.code === "HK-TEST-004")
    expect(unknown?.message).toContain("T-999")
    const missing = ingest.diagnostics.find((d) => d.code === "HK-TEST-005")
    expect(missing?.data).toEqual({ missing: plan.tests.length - 3, planned: plan.tests.length })
    // Not-run stays the build record's judgment, not ingest's.
    expect(missing?.severity).toBe("info")
  })

  it("skips rows that are not test id + ohms, and tolerates CRLF and comments", () => {
    const source =
      `# hir-fingerprint: ${release.hirFingerprint}\r\n` +
      "Test ID,Measured ohms,Taken at\r\n" +
      "T-001,0.4,10:02:11\r\n" +
      "T-002,OPEN\r\n" +
      "\r\n" +
      "T-003,1.1\r\n"
    const ingest = ingestTesterResults(source, release)

    expect(ingest.measurements).toEqual([
      { id: "T-001", measuredOhms: 0.4 },
      { id: "T-003", measuredOhms: 1.1 }
    ])
    expect(ingest.diagnostics.map((d) => d.code)).toEqual(["HK-TEST-003"])
    expect(ingest.diagnostics[0]?.message).toContain("T-002,OPEN")
  })

  it("reads a legacy two-column file with a custom-worded header positionally", () => {
    // A tester whose export labels the columns anything ("Circuit,Reading")
    // carries no recognized alias, so the first row is a header to drop and the
    // body is still read positionally — id from column one, ohms from column two.
    const source =
      `# hir-fingerprint: ${release.hirFingerprint}\n` +
      "Circuit,Reading\n" +
      "T-001,0.4\n" +
      "T-003,1.1\n"
    const ingest = ingestTesterResults(source, release)

    expect(ingest.measurements).toEqual([
      { id: "T-001", measuredOhms: 0.4 },
      { id: "T-003", measuredOhms: 1.1 }
    ])
    // No row is dropped as HK-TEST-003, and the header row is not a measurement.
    expect(ingest.diagnostics).toEqual([])
  })

  it("retains named electrical, raw-result, tester, software, and calibration evidence", () => {
    const source =
      `# hir-fingerprint: ${release.hirFingerprint}\n` +
      "Test ID,Method,Measured ohms,Applied voltage V,Applied waveform,Leakage mA,Duration seconds,Raw result reference,Raw result hash,Tester ID,Tester serial,Software version,Calibration ID,Timestamp,Interlock confirmed,Discharge confirmed\n" +
      'T-005,dielectric-withstand,,1000,ac,0.7,3,"evidence://run,5",sha256:abc,HV-01,SN-44,9.2,CAL-77,2026-06-06T12:04:00Z,true,true\n'
    const ingest = ingestTesterResults(source, release, {
      testerManufacturer: "Example Test Systems",
      testerModel: "HV-X",
      softwareName: "Bench Runner",
      calibrationDueAt: "2027-01-01"
    })

    expect(ingest.measurements).toEqual([
      {
        id: "T-005",
        method: "dielectric-withstand",
        appliedVoltageV: 1000,
        appliedWaveform: "ac",
        leakageMilliAmps: 0.7,
        durationSeconds: 3,
        rawResultReference: "evidence://run,5",
        rawResultHash: "sha256:abc",
        testerId: "HV-01",
        testerManufacturer: "Example Test Systems",
        testerModel: "HV-X",
        testerSerial: "SN-44",
        softwareName: "Bench Runner",
        softwareVersion: "9.2",
        calibrationId: "CAL-77",
        calibrationDueAt: "2027-01-01",
        timestamp: "2026-06-06T12:04:00Z",
        interlockConfirmed: true,
        dischargeConfirmed: true
      }
    ])
  })

  it("skips explicit unknown methods and diagnoses duplicate test IDs", () => {
    const source =
      `# hir-fingerprint: ${release.hirFingerprint}\n` +
      "Test ID,Method,Measured ohms,Applied waveform\n" +
      "T-001,vendor-auto,0.1,\n" +
      "T-002,continuity,0.2,\n" +
      "T-002,continuity,0.3,\n" +
      "T-003,dielectric-withstand,0.4,pulse\n"
    const ingest = ingestTesterResults(source, release)

    expect(ingest.measurements.map((measurement) => measurement.id)).toEqual(["T-002", "T-002"])
    expect(ingest.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "HK-TEST-007",
      "HK-TEST-010",
      "HK-TEST-009"
    ])
  })
})

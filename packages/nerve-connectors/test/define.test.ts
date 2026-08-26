/**
 * Part declaration and coverage diagnostics (PRD §30, §42).
 *
 * The load-bearing test here is the drift guard: it runs the REAL built-in
 * rules against a real harness and proves, field by field, that removing a
 * field silences exactly the checks `define.ts` claims it gates. If a rule
 * ever starts reading a different field, this fails instead of the coverage
 * report quietly lying.
 *
 * Verified against vitest 4.1.10 (root devDependency) and typescript 5.9.3.
 */
import { describe, expect, it } from "vitest"
import ts from "typescript"
import {
  compileDesign,
  connector,
  harness,
  runRules,
  staticProvider,
  wire,
  type ConnectorPart,
  type Diagnostic
} from "@grayhaven/nerve"
import { builtinRules } from "@grayhaven/nerve-rules"
// `resolvePartWithCoverage` is not re-exported from the package entry yet
// (packages/nerve/src/index.ts is owned elsewhere), so reach the module
// directly rather than leaving the provider path untested.
import { resolvePartWithCoverage } from "../../nerve/src/providers.js"
import { MolexMicroFit } from "../src/molex-micro-fit.js"
import {
  coverageTable,
  definePart,
  partCoverage,
  partCoverageDiagnostics,
  scaffoldPartSource
} from "../src/define.js"

const microFit: ConnectorPart = MolexMicroFit["43025-0800"]

/** Micro-Fit is an unsealed family with no reserved cavities and no seal
 * catalog, so the shipped entry leaves three checks dark. Declaring those
 * answers — even negatively — is what "fully specified" means. */
const fullySpecified: ConnectorPart = {
  ...microFit,
  sealed: false,
  compatibleSeals: ["SEAL-NONE"],
  reservedPins: []
}

const bare: ConnectorPart = { mpn: "BARE-4", pinCount: 4 }

describe("definePart", () => {
  it("defaults provenance to unverified", () => {
    const p = definePart({ mpn: "NEW-2", pinCount: 2 })
    expect(p.provenance).toEqual({ verification: "unverified" })
    expect(p.mpn).toBe("NEW-2")
    expect(p.pinCount).toBe(2)
  })

  it("preserves explicitly supplied provenance", () => {
    const provenance = {
      source: "Vendor catalog",
      datasheet: "https://example.invalid/ds.pdf",
      verification: "verified",
      lastVerified: "2026-01-02"
    } as const
    expect(definePart({ mpn: "NEW-2", pinCount: 2, provenance }).provenance).toEqual(provenance)
  })
})

describe("partCoverage", () => {
  it("a fully-specified part leaves no check dark", () => {
    const coverage = partCoverage(fullySpecified)
    expect(coverage.mpn).toBe("43025-0800")
    expect(coverage.inactive).toEqual([])
    expect(coverage.active).toEqual(coverageTable.map((e) => e.code))
  })

  it("the shipped Micro-Fit entry is honest about the seal/reserved checks it cannot run", () => {
    expect(partCoverage(microFit).inactive).toEqual([
      { code: "HK-CONN-013", missingField: "sealed" },
      { code: "HK-CONN-014", missingField: "compatibleSeals" },
      { code: "HK-CONN-015", missingField: "reservedPins" }
    ])
  })

  it("a bare part reports every gated check as inactive, with the field that enables it", () => {
    const coverage = partCoverage(bare)
    expect(coverage.active).toEqual([])
    expect(coverage.inactive).toEqual([
      { code: "HK-CONN-012", missingField: "compatibleTerminals" },
      { code: "HK-CONN-013", missingField: "sealed" },
      { code: "HK-CONN-014", missingField: "compatibleSeals" },
      { code: "HK-CONN-015", missingField: "reservedPins" },
      { code: "HK-CONN-016", missingField: "currentLimitA" },
      { code: "HK-CONN-017", missingField: "voltageLimitV" },
      { code: "HK-CONN-020", missingField: "cavityLayout" },
      { code: "HK-CONN-021", missingField: "compatibleTerminals" },
      { code: "HK-MFG-004", missingField: "wireGaugeRange" }
    ])
  })

  it("an empty terminal allow-list still leaves HK-CONN-021 dark", () => {
    // missingTerminal skips a zero-length list — that is how solder-cup and
    // PCB-header families opt out — so the datum is not sufficient.
    const coverage = partCoverage({ ...bare, compatibleTerminals: [] })
    expect(coverage.active).toContain("HK-CONN-012")
    expect(coverage.inactive).toContainEqual({
      code: "HK-CONN-021",
      missingField: "compatibleTerminals"
    })
  })
})

describe("partCoverageDiagnostics", () => {
  it("emits one HK-CONN-022 info diagnostic per inactive check, sorted by code", () => {
    const diagnostics = partCoverageDiagnostics(bare)
    expect(diagnostics).toHaveLength(partCoverage(bare).inactive.length)
    expect(diagnostics.every((d) => d.code === "HK-CONN-022")).toBe(true)
    expect(diagnostics.every((d) => d.severity === "info")).toBe(true)
    expect(diagnostics.map((d) => d.data?.["check"])).toEqual([
      "HK-CONN-012",
      "HK-CONN-013",
      "HK-CONN-014",
      "HK-CONN-015",
      "HK-CONN-016",
      "HK-CONN-017",
      "HK-CONN-020",
      "HK-CONN-021",
      "HK-MFG-004"
    ])
    expect(diagnostics[0]!.message).toContain("HK-CONN-012 cannot run against BARE-4")
    expect(diagnostics[0]!.message).toContain("compatibleTerminals")
    expect(diagnostics[0]!.target).toBeUndefined()
  })

  it("attaches the given target and stays silent for a fully-specified part", () => {
    expect(partCoverageDiagnostics(bare, "bom:BARE-4")[0]!.target).toBe("bom:BARE-4")
    expect(partCoverageDiagnostics(fullySpecified)).toEqual([])
  })
})

describe("resolvePartWithCoverage", () => {
  it("reports coverage alongside the provider-conflict diagnostics", () => {
    const lib = staticProvider("lib", { "BARE-4": bare })
    const resolved = resolvePartWithCoverage(
      [lib],
      "BARE-4",
      (p): ReadonlyArray<Diagnostic> => partCoverageDiagnostics(p, `bom:${p.mpn}`)
    )
    expect(resolved.provider).toBe("lib")
    expect(resolved.part).toBe(bare)
    expect(resolved.diagnostics.map((d) => d.code)).toEqual(
      Array.from({ length: 9 }, () => "HK-CONN-022")
    )
  })

  it("keeps the existing conflict behaviour and stays quiet on an unknown MPN", () => {
    const a = staticProvider("a", { X: { mpn: "X", pinCount: 4 } })
    const b = staticProvider("b", { X: { mpn: "X", pinCount: 6 } })
    const conflicted = resolvePartWithCoverage([a, b], "X", () => [])
    expect(conflicted.diagnostics).toHaveLength(1)
    expect(conflicted.diagnostics[0]!.code).toBe("HK-LIB-001")
    expect(resolvePartWithCoverage([a], "MISSING", partCoverageDiagnostics)).toEqual({
      diagnostics: []
    })
  })
})

describe("scaffoldPartSource", () => {
  const source = scaffoldPartSource("43025-0800", 8)

  it("is deterministic across calls", () => {
    expect(scaffoldPartSource("43025-0800", 8)).toBe(source)
    expect(source).not.toContain("\r")
  })

  it("parses as valid TypeScript", () => {
    const result = ts.transpileModule(source, {
      reportDiagnostics: true,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      fileName: "scaffold.ts"
    })
    expect(result.diagnostics ?? []).toEqual([])
  })

  it("declares only the required fields, so the scaffold typechecks as a ConnectorPart", () => {
    const file = ts.createSourceFile("scaffold.ts", source, ts.ScriptTarget.ES2022, true)
    const literals: Array<ts.ObjectLiteralExpression> = []
    const walk = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) literals.push(node)
      ts.forEachChild(node, walk)
    }
    walk(file)
    const names = literals[0]!.properties.map((p) => p.name?.getText(file))
    expect(names).toEqual(["mpn", "pinCount", "provenance"])
    expect(literals[0]!.getText(file)).toContain(`mpn: "43025-0800"`)
    expect(literals[0]!.getText(file)).toContain("pinCount: 8")
  })

  it("comments every gated field with the checks it unlocks", () => {
    const annotated = [...source.matchAll(/^\s*\/\/ (\w+): .*\/\/ enables (.+)$/gm)]
    expect(annotated.map((m) => m[1])).toEqual([
      "cavityLayout",
      "compatibleSeals",
      "compatibleTerminals",
      "currentLimitA",
      "reservedPins",
      "sealed",
      "voltageLimitV",
      "wireGaugeRange"
    ])
    const scaffolded = annotated.flatMap((m) => m[2]!.split(", ")).sort()
    expect(scaffolded).toEqual(coverageTable.map((e) => e.code).sort())
    expect(source).toContain("// cavityLayout: { rows: 1, columns: 8 },  // enables HK-CONN-020")
  })
})

// --- Drift guard -------------------------------------------------------------

/**
 * A part that declares every gated field, wired into a harness that
 * violates every one of them. Each field is therefore provably load-bearing:
 * drop it and the corresponding code stops firing.
 */
const violatingPart: ConnectorPart = {
  mpn: "DRIFT-6",
  pinCount: 6,
  cavityLayout: { rows: 2, columns: 4 }, // 8 cells vs 6 cavities → HK-CONN-020
  reservedPins: [6],
  compatibleTerminals: ["T-OK"],
  compatibleSeals: ["S-OK"],
  sealed: true,
  wireGaugeRange: { min: "30AWG", max: "20AWG" },
  currentLimitA: 1,
  voltageLimitV: 12
}

const codesFor = (part: ConnectorPart): ReadonlySet<string> => {
  const j1 = connector("J1", part, {
    pins: { 1: "VBAT_48V", 2: "GND", 6: "AUX" },
    terminals: { 1: "T-BAD" }, // not in compatibleTerminals → HK-CONN-012
    seals: { 1: "S-BAD" } // not in compatibleSeals → HK-CONN-014
  })
  const j2 = connector("J2", part, { pins: { 1: "VBAT_48V", 2: "GND", 6: "AUX" } })
  const design = harness("drift-fixture", {
    revision: "A",
    units: "mm",
    connectors: [j1, j2],
    wires: [
      // 10AWG is outside 30–20AWG; 10A over a 1A contact; 48V over a 12V housing.
      wire("W1", j1.pin(1), j2.pin(1), {
        gauge: "10AWG",
        signal: "VBAT_48V",
        currentEstimate: 10,
        length: 100
      }),
      wire("W2", j1.pin(2), j2.pin(2), { gauge: "10AWG", signal: "GND", length: 100 })
    ]
  })
  return new Set(runRules(compileDesign(design).hir, builtinRules).map((d) => d.code))
}

/** `violatingPart` with its readonly lifted, so one field can be deleted. */
type PartDraft = { -readonly [K in keyof ConnectorPart]: ConnectorPart[K] }
/** The optional `ConnectorPart` fields — the only ones a check can be gated on. */
type GatedField = Exclude<keyof ConnectorPart, "mpn" | "pinCount">

const isGatedField = (field: string): field is GatedField =>
  field !== "mpn" && field !== "pinCount" && field in violatingPart

describe("code→field table matches what the real rules consume", () => {
  const withEverything = codesFor(violatingPart)

  it("every claimed check actually fires when its field is present", () => {
    for (const { code } of coverageTable) {
      expect(withEverything, `${code} should fire on the violating fixture`).toContain(code)
    }
  })

  it("removing a field silences exactly the checks the table maps to it", () => {
    const fields = [...new Set(coverageTable.map((e) => e.field))].sort()
    for (const field of fields) {
      if (!isGatedField(field)) throw new Error(`${field} is not a gated field on the fixture`)
      const stripped: PartDraft = { ...violatingPart }
      delete stripped[field]
      const codes = codesFor(stripped)
      const silenced = [...withEverything].filter((c) => !codes.has(c)).sort()
      const claimed = coverageTable
        .filter((e) => e.field === field)
        .map((e) => e.code)
        .sort()
      expect(silenced, `dropping ${field}`).toEqual(claimed)
    }
  })
})

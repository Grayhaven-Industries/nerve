/**
 * Declaring a part, and knowing what that declaration buys you (PRD §30
 * registry depth, §42 part-data providers).
 *
 * The bundled library will never contain the part in front of you. The
 * damage is not the missing entry — it is that several built-in checks are
 * gated on optional `ConnectorPart` fields and simply skip a part that
 * lacks them. The report comes back clean because the check never ran, and
 * nothing in the output says so.
 *
 * So this module does two things. `definePart` makes declaring a part
 * cheap and honest (provenance defaults to `unverified` rather than being
 * quietly absent), and `partCoverage` / `partCoverageDiagnostics` name
 * every check that is dark for a part and the exact field that would turn
 * it back on. `scaffoldPartSource` closes the loop: it emits an entry with
 * every gated field already written out, commented with the check it
 * unlocks, so filling one in is a deliberate act rather than an
 * archaeology project.
 *
 * The code→field table below is hardcoded on purpose: `@grayhaven/nerve-rules`
 * is a devDependency here and promoting it to a runtime dependency to read
 * rule metadata would invert the library's dependency direction. The table
 * is therefore pinned by a drift test (test/define.test.ts) that runs the
 * real rules against a real harness and proves each field is load-bearing.
 */
import type { ConnectorPart, Diagnostic } from "@grayhaven/nerve"

/**
 * A built-in check that only runs when the part declares a given field,
 * and the evidence for that claim.
 *
 * `enabled` is not always "field is present": HK-CONN-021 also needs the
 * terminal allow-list to be non-empty, because a zero-length list is how a
 * solder-cup or PCB-header family opts out of terminal checking.
 */
interface CoverageEntry {
  readonly code: string
  /** The `ConnectorPart` field the rule reads before it can report. */
  readonly field: string
  /** Rule name in `@grayhaven/nerve-rules`, for tracing the mapping back. */
  readonly rule: string
  /** What the check does once it has the field. */
  readonly what: string
  readonly enabled: (part: ConnectorPart) => boolean
}

const isNonEmpty = (xs: ReadonlyArray<unknown> | undefined): boolean =>
  xs !== undefined && xs.length > 0

/**
 * Derived by reading the rule bodies in `@grayhaven/nerve-rules`, not from
 * the field names — each entry names the rule and the guard that skips the
 * part when the field is absent.
 *
 * Note HK-CONN-013 (missingSeal) gates on `sealed`, NOT on `compatibleSeals`:
 * it asks whether the housing is sealed at all, and a part that never says
 * so is never checked for missing cavity seals.
 */
const COVERAGE_TABLE: ReadonlyArray<CoverageEntry> = [
  {
    code: "HK-CONN-012",
    field: "compatibleTerminals",
    rule: "terminalIncompatible",
    what: "rejects a terminal MPN the housing does not accept",
    enabled: (p) => p.compatibleTerminals !== undefined
  },
  {
    code: "HK-CONN-013",
    field: "sealed",
    rule: "missingSeal",
    what: "requires a seal on every populated cavity of a sealed housing",
    enabled: (p) => p.sealed !== undefined
  },
  {
    code: "HK-CONN-014",
    field: "compatibleSeals",
    rule: "sealIncompatible",
    what: "rejects a seal MPN the housing does not accept",
    enabled: (p) => p.compatibleSeals !== undefined
  },
  {
    code: "HK-CONN-015",
    field: "reservedPins",
    rule: "reservedPinAssigned",
    what: "keeps keying and no-connect cavities out of service",
    enabled: (p) => p.reservedPins !== undefined
  },
  {
    code: "HK-CONN-016",
    field: "currentLimitA",
    rule: "connectorCurrentExceeded",
    what: "catches a wire whose current estimate exceeds the contact rating",
    enabled: (p) => p.currentLimitA !== undefined
  },
  {
    code: "HK-CONN-017",
    field: "voltageLimitV",
    rule: "connectorVoltageExceeded",
    what: "catches a rail whose nominal voltage exceeds the housing rating",
    enabled: (p) => p.voltageLimitV !== undefined
  },
  {
    code: "HK-CONN-020",
    field: "cavityLayout",
    rule: "cavityLayoutMismatch",
    what: "checks the cavity grid accounts for exactly the housing's cavities",
    enabled: (p) => p.cavityLayout !== undefined
  },
  {
    code: "HK-CONN-021",
    field: "compatibleTerminals",
    rule: "missingTerminal",
    what: "requires a terminal MPN on every wired cavity of a crimp housing",
    enabled: (p) => isNonEmpty(p.compatibleTerminals)
  },
  {
    code: "HK-MFG-004",
    field: "wireGaugeRange",
    rule: "gaugeOutsideConnectorRange",
    what: "catches a wire gauge outside the range the contacts crimp",
    enabled: (p) => p.wireGaugeRange !== undefined
  }
]

/** Every check whose activation depends on part data, sorted by code. */
const entriesByCode: ReadonlyArray<CoverageEntry> = [...COVERAGE_TABLE].sort((a, b) =>
  a.code < b.code ? -1 : a.code > b.code ? 1 : 0
)

/** The code→field mapping this library claims, for the drift test and docs. */
export const coverageTable: ReadonlyArray<{
  readonly code: string
  readonly field: string
  readonly rule: string
}> = entriesByCode.map(({ code, field, rule }) => ({ code, field, rule }))

/**
 * Which built-in checks a part's data is sufficient to run.
 */
export interface PartCoverage {
  readonly mpn: string
  /** Rule codes that CAN run against this part. */
  readonly active: ReadonlyArray<string>
  /** Rule codes that CANNOT run, each with the field that would enable it. */
  readonly inactive: ReadonlyArray<{
    readonly code: string
    readonly missingField: string
  }>
}

/**
 * Report which checks this part's data does and does not enable.
 *
 * Scoped to the checks that part data gates — structural rules that need
 * only `mpn`/`pinCount` always run and are not listed either way.
 */
export const partCoverage = (part: ConnectorPart): PartCoverage => {
  const active: Array<string> = []
  const inactive: Array<{ readonly code: string; readonly missingField: string }> = []
  for (const entry of entriesByCode) {
    if (entry.enabled(part)) active.push(entry.code)
    else inactive.push({ code: entry.code, missingField: entry.field })
  }
  return { mpn: part.mpn, active, inactive }
}

/** Info diagnostics that name a dark check are still diagnostics (PRD §11.2). */
const COVERAGE_CODE = "HK-CONN-022"

/**
 * Diagnostics naming every check that is dark for this part.
 * Emits HK-CONN-022 (info severity) per inactive rule.
 */
export const partCoverageDiagnostics = (
  part: ConnectorPart,
  target?: string
): ReadonlyArray<Diagnostic> => {
  const byCode = new Map(entriesByCode.map((e) => [e.code, e]))
  return partCoverage(part).inactive.map(({ code, missingField }) => {
    const entry = byCode.get(code)!
    return {
      code: COVERAGE_CODE,
      severity: "info" as const,
      message: `${code} cannot run against ${part.mpn}: the part declares no \`${missingField}\`. That check ${entry.what}; declaring \`${missingField}\` turns it on.`,
      ...(target !== undefined ? { target } : {}),
      data: { mpn: part.mpn, check: code, missingField, rule: entry.rule }
    }
  })
}

/**
 * Declare a connector part with defaulted provenance.
 * Provenance defaults to `{ verification: "unverified" }` when omitted.
 */
export const definePart = (part: ConnectorPart): ConnectorPart =>
  part.provenance !== undefined ? part : { ...part, provenance: { verification: "unverified" } }

/** Example values per gated field — plausible, and obviously placeholders. */
const SCAFFOLD_PLACEHOLDER: Readonly<Record<string, string>> = {
  compatibleTerminals: `["TERMINAL-MPN"]`,
  sealed: "false",
  compatibleSeals: `["SEAL-MPN"]`,
  reservedPins: "[]",
  currentLimitA: "5",
  voltageLimitV: "250",
  cavityLayout: "{ rows: 1, columns: PIN_COUNT }",
  wireGaugeRange: `{ min: "24AWG", max: "20AWG" }`
}

/** Descriptive fields no rule reads, but every good entry carries. */
const SCAFFOLD_DESCRIPTIVE: ReadonlyArray<readonly [string, string]> = [
  ["manufacturer", `"Manufacturer"`],
  ["family", `"Family"`],
  ["description", `"Housing description"`],
  ["gender", `"receptacle"`],
  ["matingMpn", `"MATING-MPN"`],
  ["crimpTool", `"CRIMP-TOOL"`]
]

/** `43025-0800` → `Part43025_0800`: a stable, valid TS identifier. */
const scaffoldIdentifier = (mpn: string): string =>
  `Part${mpn.replace(/[^A-Za-z0-9]/g, "_")}`

/**
 * Deterministic TypeScript source for a new part entry, every rule-relevant
 * field present and commented with the check it unlocks.
 */
export const scaffoldPartSource = (mpn: string, pinCount: number): string => {
  // One line per gated field, carrying every code that field turns on —
  // `compatibleTerminals` unlocks two, so both are named.
  const codesByField = new Map<string, Array<string>>()
  for (const entry of entriesByCode) {
    const codes = codesByField.get(entry.field)
    if (codes === undefined) codesByField.set(entry.field, [entry.code])
    else codes.push(entry.code)
  }
  const gated = [...codesByField.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([field, codes]) => {
      const value = SCAFFOLD_PLACEHOLDER[field]!.replace("PIN_COUNT", String(pinCount))
      return `  // ${field}: ${value},  // enables ${[...codes].sort().join(", ")}`
    })
  const descriptive = SCAFFOLD_DESCRIPTIVE.map(([field, value]) => `  // ${field}: ${value},`)
  return [
    "/**",
    ` * ${mpn} — connector part entry.`,
    " *",
    " * Every commented field below gates a built-in check that stays dark",
    " * until you fill it in (the part reports each one as HK-CONN-022).",
    " * Uncomment what the datasheet actually says, and raise `verification`",
    " * once a second pair of eyes has confirmed it against the source (PRD §30).",
    " */",
    `import { definePart } from "@grayhaven/nerve-connectors"`,
    "",
    `export const ${scaffoldIdentifier(mpn)} = definePart({`,
    `  mpn: ${JSON.stringify(mpn)},`,
    `  pinCount: ${pinCount},`,
    ...descriptive,
    ...gated,
    "  provenance: {",
    `    // source: "Manufacturer catalog",`,
    `    // datasheet: "https://…",`,
    `    // lastVerified: "YYYY-MM-DD",`,
    `    verification: "unverified"`,
    "  }",
    "})",
    ""
  ].join("\n")
}

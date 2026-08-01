/**
 * Part-data provider abstraction (PRD §42). Part data can come from
 * manufacturer APIs, distributor APIs, internal AVLs, PLM masters, or
 * bundled verified libraries — without locking the product to one source.
 *
 * Providers return normalized `ConnectorPart` records with provenance.
 * Conflicts between providers produce diagnostics, never silent
 * overwrites: the FIRST provider in the list wins, and every divergent
 * later answer is reported.
 */
import type { ConnectorPart } from "./domain.js"
import type { Diagnostic } from "./diagnostics.js"

export interface PartProvider {
  /** Stable provider id, e.g. "nerve-connectors", "acme-plm". */
  readonly id: string
  get(mpn: string): ConnectorPart | undefined
  /** Optional free-text search returning matching MPNs. */
  search?(query: string): ReadonlyArray<string>
}

/** Build a provider from a static record map (the bundled-library case). */
export const staticProvider = (
  id: string,
  parts: Readonly<Record<string, ConnectorPart>>
): PartProvider => ({
  id,
  get: (mpn) => parts[mpn],
  search: (query) => {
    const q = query.toLowerCase()
    return Object.values(parts)
      .filter(
        (p) =>
          p.mpn.toLowerCase().includes(q) ||
          (p.family?.toLowerCase().includes(q) ?? false) ||
          (p.description?.toLowerCase().includes(q) ?? false)
      )
      .map((p) => p.mpn)
      .sort()
  }
})

export interface ResolvedPart {
  readonly part?: ConnectorPart
  /** Which provider answered. */
  readonly provider?: string
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

/** Fields whose disagreement between providers is worth a diagnostic. */
const CONFLICT_FIELDS = [
  "pinCount",
  "gender",
  "sealed",
  "currentLimitA",
  "voltageLimitV"
] as const

/**
 * Resolve an MPN across providers in priority order. The first answer
 * wins; later providers that DISAGREE on load-bearing fields produce
 * HK-LIB-001 warnings naming both providers (PRD §42: conflicts are
 * diagnostics, not silent overwrites).
 */
export const resolvePart = (
  providers: ReadonlyArray<PartProvider>,
  mpn: string
): ResolvedPart => {
  const answers = providers
    .map((p) => ({ provider: p.id, part: p.get(mpn) }))
    .filter((a): a is { provider: string; part: ConnectorPart } => a.part !== undefined)
  if (answers.length === 0) return { diagnostics: [] }
  const winner = answers[0]!
  const diagnostics: Array<Diagnostic> = []
  for (const other of answers.slice(1)) {
    const fields = CONFLICT_FIELDS.filter((f) => {
      const a = winner.part[f]
      const b = other.part[f]
      return a !== undefined && b !== undefined && a !== b
    })
    if (fields.length > 0) {
      diagnostics.push({
        severity: "warning",
        code: "HK-LIB-001",
        message: `Providers disagree on ${mpn}: ${winner.provider} vs ${other.provider} differ on ${fields.join(", ")} (using ${winner.provider}).`,
        target: `bom:${mpn}`
      })
    }
  }
  return { part: winner.part, provider: winner.provider, diagnostics }
}

/**
 * Reports which built-in checks a part's data leaves dark. Injected rather
 * than imported: the mapping lives with the part library
 * (`@grayhaven/nerve-connectors`), which depends on core, not the reverse.
 */
export type PartCoverageReporter = (part: ConnectorPart) => ReadonlyArray<Diagnostic>

/**
 * `resolvePart` plus coverage: the resolved part reports the checks its own
 * data cannot support, alongside the provider-conflict diagnostics. A part
 * that answers but carries no terminal list, no seal data, and no ratings
 * silently disables several rules — surfacing that here is the difference
 * between a clean report and a report that is clean because nothing ran.
 */
export const resolvePartWithCoverage = (
  providers: ReadonlyArray<PartProvider>,
  mpn: string,
  coverage: PartCoverageReporter
): ResolvedPart => {
  const resolved = resolvePart(providers, mpn)
  if (resolved.part === undefined) return resolved
  const gaps = coverage(resolved.part)
  if (gaps.length === 0) return resolved
  return { ...resolved, diagnostics: [...resolved.diagnostics, ...gaps] }
}

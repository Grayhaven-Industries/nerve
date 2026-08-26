/**
 * ECO/ECN and release records (PRD §35).
 *
 * A release is an immutable record of what shipped: the ECO that authorized
 * it, a fingerprint of the exact HIR, and — when compared against the
 * previous release — the engineering/manufacturing/test impact and a
 * change-risk score. Releases fail closed on validation errors (PRD §15).
 */
import { diffHir, type Hir, type HirDiff } from "@grayhaven/nerve"
import { coverage, generateTestPlan } from "./test-plan.js"
import { draft } from "./draft.js"

/** FNV-1a 64-bit content fingerprint (integrity check, not cryptographic). */
export const hirFingerprint = (hir: Hir): string => {
  const text = JSON.stringify(hir)
  let h = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i))
    h = (h * prime) & mask
  }
  return h.toString(16).padStart(16, "0")
}

export type ChangeRisk = "none" | "low" | "medium" | "high"

export interface ReleaseImpact {
  readonly pinoutChanges: number
  readonly wireChanges: number
  readonly connectorChanges: number
  readonly bomChanges: number
  readonly labelChanges: number
  readonly testCountDelta: number
  readonly riskScore: number
  readonly risk: ChangeRisk
}

export interface Release {
  readonly releaseId: string
  readonly harness: { readonly id: string; readonly revision: string }
  readonly eco: {
    readonly id: string
    readonly reason: string
    readonly author?: string
  }
  readonly createdAt: string
  readonly hirFingerprint: string
  readonly hirSchema: string
  readonly counts: {
    readonly connectors: number
    readonly wires: number
    readonly tests: number
  }
  readonly supersedes?: string
  readonly impact?: ReleaseImpact
}

export class ReleaseBlockedError extends Error {
  constructor(readonly errorCount: number) {
    super(`Release blocked: ${errorCount} validation error(s); releases fail closed (PRD §15).`)
  }
}

const sectionCount = (s: HirDiff[keyof Pick<HirDiff, "wires">]): number =>
  s.added.length + s.removed.length + s.changed.length

export const computeImpact = (previous: Hir, next: Hir): ReleaseImpact => {
  const d = diffHir(previous, next)
  const pinoutChanges = d.pinouts.length
  const wireChanges = sectionCount(d.wires)
  const connectorChanges = sectionCount(d.connectors)
  const bomChanges = sectionCount(d.bom)
  const labelChanges = sectionCount(d.labels)
  const testCountDelta =
    generateTestPlan(next).tests.length - generateTestPlan(previous).tests.length
  // Pinout and wire-endpoint changes are how harnesses hurt people; weight them.
  const riskScore =
    pinoutChanges * 3 + wireChanges * 2 + connectorChanges * 2 + bomChanges + labelChanges
  const risk: ChangeRisk =
    riskScore === 0 ? "none" : riskScore <= 4 ? "low" : riskScore <= 12 ? "medium" : "high"
  return {
    pinoutChanges,
    wireChanges,
    connectorChanges,
    bomChanges,
    labelChanges,
    testCountDelta,
    riskScore,
    risk
  }
}

export interface CreateReleaseOptions {
  readonly eco: { readonly id: string; readonly reason: string; readonly author?: string }
  /** ISO date — passed in (never generated) so releases stay deterministic. */
  readonly createdAt: string
  readonly previous?: { readonly hir: Hir; readonly releaseId: string }
}

/** Create a release record. Throws `ReleaseBlockedError` when the HIR has errors. */
export const createRelease = (hir: Hir, options: CreateReleaseOptions): Release => {
  const plan = generateTestPlan(hir)
  const validationErrors = hir.diagnostics.filter((d) => d.severity === "error")
  const testCoverage = coverage(hir, plan)
  const uncoveredDiagnostics = validationErrors.filter((d) => d.code === "HK-ELEC-011").length
  const uncoveredNets = testCoverage.nets - testCoverage.covered
  const additionalCoverageErrors = Math.max(0, uncoveredNets - uncoveredDiagnostics)
  if (validationErrors.length > 0 || additionalCoverageErrors > 0) {
    throw new ReleaseBlockedError(validationErrors.length + additionalCoverageErrors)
  }
  const release = draft<Release>({
    releaseId: `${hir.harness.id}@${hir.harness.revision}`,
    harness: { id: hir.harness.id, revision: hir.harness.revision },
    eco: options.eco,
    createdAt: options.createdAt,
    hirFingerprint: hirFingerprint(hir),
    hirSchema: hir.schemaVersion,
    counts: {
      connectors: hir.connectors.length,
      wires: hir.wires.length,
      tests: plan.tests.length
    }
  })
  if (options.previous !== undefined) {
    release.supersedes = options.previous.releaseId
    release.impact = computeImpact(options.previous.hir, hir)
  }
  return release
}

export const releaseJson = (release: Release): string =>
  JSON.stringify(release, null, 2) + "\n"

/**
 * End-to-end seam: a real harness, the real compiler, the real release gate.
 *
 * Every other platform test builds its findings by hand. That proves the rules
 * are self-consistent and proves nothing about whether they survive contact
 * with what the compiler actually emits — the shape of a `Diagnostic`, the fact
 * that one rule fires on several objects at once, the fact that a design
 * authored in the DSL carries no source row to annotate. This test compiles
 * `examples/motor-controller` and drives its real output through ingest,
 * gate, disposition, approval, release, and the pull-request check.
 *
 * It deliberately does not assert diagnostic counts or specific rule codes. The
 * example harness and the rule set are both free to change; what must hold is
 * that the platform reaches the right verdict about whatever the compiler says.
 * The blocking rule below is therefore *derived* from the compiler's output
 * rather than hardcoded.
 *
 * Relative imports: root-level tests sit outside the workspace packages, so the
 * `@grayhaven/*` specifiers do not resolve here (see hir-shape.test.ts).
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { compileFile } from "../packages/nerve-compiler/src/index.js"
import {
  assembleSourceSet,
  buildEvidenceBundle,
  checkRunForReview,
  evaluateReadyForApproval,
  fingerprint,
  proposeApproval,
  validateRelease
} from "../packages/nerve-platform/src/index.js"
import type {
  Disposition,
  Finding,
  GateInput,
  Membership,
  Policy,
  Project,
  ReleaseCandidate
} from "../packages/nerve-platform/src/index.js"

/** Fixed so the whole run is deterministic and replayable. */
const AT = "2026-08-13T00:00:00Z"
const HARNESS = resolve(import.meta.dirname, "../examples/motor-controller/src/main.harness.ts")

const basePolicy: Policy = {
  id: "pol-1",
  organizationId: "org-1",
  requiredRulePacks: ["core"],
  requiredInterfaceContracts: [],
  severityOverrides: {},
  requireWarningAcknowledgement: false,
  waiverRequirements: {
    requireApprover: false,
    requireAttachment: false,
    requireExpiry: false,
    requireIssueLink: false
  },
  requiredApproverIds: [],
  allowSingleApprover: false,
  allowEvidenceReuse: false,
  retentionDays: 365,
  sourceStalenessToleranceDays: 30,
  fingerprint: fingerprint({ policy: "pol-1" })
}

const project: Project = {
  id: "p-1",
  organizationId: "org-1",
  name: "Motor controller",
  production: true,
  createdAt: AT
}

const ingest = (bytes: Uint8Array, over: { id: string; by: string; at: string }) =>
  assembleSourceSet({
    id: over.id,
    harnessId: "motor-controller",
    uploads: [
      {
        filename: "src/main.harness.ts",
        mediaType: "text/typescript",
        bytes,
        kind: "nerve-source",
        importAdapterVersion: "nerve-compiler@7.0.0",
        uploadedBy: over.by,
        uploadedAt: over.at
      }
    ],
    dependencyVersions: { "@grayhaven/nerve": "7.0.0" },
    interfaceContracts: [],
    preconditions: {
      malwareScan: "clean",
      scannerVersion: "test-scanner-1",
      scannedAt: AT,
      networkAccessDisabled: true
    },
    createdAt: over.at
  })

describe("compiler → platform seam (real harness)", async () => {
  const bytes = new Uint8Array(readFileSync(HARNESS))
  const assembly = ingest(bytes, { id: "ss-1", by: "engineer-1", at: AT })
  const compiled = await Effect.runPromise(compileFile(HARNESS))

  /** The compiler's real diagnostics, as platform findings. */
  const findings: ReadonlyArray<Finding> = compiled.diagnostics.map((d, i) => ({
    id: `f-${i}`,
    reviewRunId: "run-1",
    code: d.code,
    severity: d.severity,
    ruleSeverity: d.severity,
    message: d.message,
    ...(d.target === undefined ? {} : { target: d.target }),
    ...(d.targets === undefined ? {} : { targets: d.targets }),
    ...(d.data === undefined ? {} : { data: d.data })
  }))

  const hirHash = fingerprint(JSON.parse(JSON.stringify(compiled.hir)))
  const candidate: ReleaseCandidate = {
    id: "rc-1",
    reviewRunId: "run-1",
    reviewRunFingerprint: fingerprint({ run: "run-1" }),
    sourceSetFingerprint: assembly.sourceSet.fingerprint,
    policyFingerprint: basePolicy.fingerprint,
    artifactHashes: { "harness.json": hirHash },
    proposedBy: "engineer-1",
    proposedAt: AT,
    fingerprint: fingerprint({ candidate: "rc-1", hir: hirHash })
  }

  const gateInput = (over: Partial<GateInput> = {}): GateInput => ({
    candidate,
    policy: basePolicy,
    compilation: { compiled: true, hirDecoded: true },
    rowAccountingComplete: true,
    findings,
    dispositions: [],
    warningAcknowledgements: [],
    interfaceContractResults: [],
    rulePackResults: [{ rulePackId: "core", succeeded: true }],
    coverageDisclosure: { acknowledgedBy: "engineer-1", acknowledgedAt: AT },
    regeneratedArtifacts: {
      fromCandidateFingerprint: candidate.fingerprint,
      hashes: candidate.artifactHashes
    },
    sources: [
      { filename: "src/main.harness.ts", required: true, status: "verified", staleForDays: 0 }
    ],
    ...over
  })

  it("compiles the example harness and turns its diagnostics into findings", () => {
    expect(compiled.hir.connectors.length).toBeGreaterThan(0)
    expect(compiled.hir.wires.length).toBeGreaterThan(0)
    expect(findings).toHaveLength(compiled.diagnostics.length)
  })

  it("fingerprints the real source set, and a re-upload keeps the same identity", () => {
    // ING-007: different uploader, different time, identical bytes. The
    // submission has not changed, so its identity must not change either.
    const second = ingest(bytes, { id: "ss-2", by: "engineer-2", at: "2026-09-01T00:00:00Z" })
    expect(second.sourceSet.fingerprint).toBe(assembly.sourceSet.fingerprint)
    expect(assembly.storage[0]?.disposition).toBe("stored-new")
  })

  it("passes the gate when the compiler reports nothing blocking", () => {
    const blocking = findings.filter((f) => f.severity === "error")
    const result = evaluateReadyForApproval(gateInput())
    // Stated as an implication so the test keeps its meaning if the example
    // harness ever gains a genuine error.
    expect(result.ready).toBe(blocking.length === 0)
  })

  /**
   * The interesting half. The example harness compiles clean, so a gate that
   * only ever saw it would never be shown to block anything. Promoting a rule
   * the compiler actually fired (ORG-004) turns real findings into blocking
   * ones without touching the design.
   */
  describe("under a policy that promotes a rule the compiler fired", () => {
    const promoted = findings.find((f) => f.severity === "warning")
    const code = promoted?.code

    it("has a warning to promote", () => {
      expect(code).toBeDefined()
    })

    const strict: Policy = {
      ...basePolicy,
      ...(code === undefined ? {} : { severityOverrides: { [code]: "error" as const } })
    }
    const affected = findings.filter((f) => f.code === code)

    it("blocks, and the pull-request check goes red", () => {
      const result = evaluateReadyForApproval(gateInput({ policy: strict }))
      expect(result.ready).toBe(false)
      expect(result.blockers.length).toBeGreaterThanOrEqual(affected.length)

      const plan = checkRunForReview({
        gate: result,
        findings,
        policy: strict,
        detailsUrl: "https://nerve.example/reviews/run-1",
        reviewRunId: "run-1"
      })
      expect(plan.checkRun.conclusion).toBe("failure")
      // A DSL-authored design has no source rows, so nothing can be annotated.
      // Those findings must still be named rather than dropped (§9.5 step 4).
      expect(plan.unanchoredFindingIds).toHaveLength(affected.length)
      for (const id of plan.unanchoredFindingIds) {
        expect(plan.checkRun.output.summary).toContain(id)
      }
    })

    it("names each affected object, so repeats of one rule stay distinguishable", () => {
      const result = evaluateReadyForApproval(gateInput({ policy: strict }))
      const targeted = affected.filter((f) => f.target !== undefined)
      for (const f of targeted) {
        expect(result.blockers.some((b) => b.message.includes(f.target as string))).toBe(true)
      }
    })

    const waivers: ReadonlyArray<Disposition> = affected.map((f) => ({
      findingId: f.id,
      state: "accepted-risk",
      reason: "Reviewed with manufacturing for this build.",
      ownerId: "engineer-1",
      decidedBy: "engineer-2",
      decidedAt: AT,
      scope: {
        harnessId: "motor-controller",
        code: f.code,
        ...(f.target === undefined ? {} : { target: f.target }),
        sourceSetFingerprint: assembly.sourceSet.fingerprint
      }
    }))

    it("clears once every promoted finding is waived in scope", () => {
      const result = evaluateReadyForApproval(gateInput({ policy: strict, dispositions: waivers }))
      expect(result.ready).toBe(true)
    })

    it("refuses to carry those waivers to a changed submission (§9.3 step 5)", () => {
      const moved: ReleaseCandidate = {
        ...candidate,
        sourceSetFingerprint: fingerprint({ different: "submission" })
      }
      const result = evaluateReadyForApproval(
        gateInput({ policy: strict, dispositions: waivers, candidate: moved })
      )
      expect(result.ready).toBe(false)
    })
  })

  describe("approval and release over the real candidate", () => {
    const preparer: Membership = {
      userId: candidate.proposedBy,
      organizationId: "org-1",
      role: "engineer"
    }
    const other: Membership = { userId: "engineer-2", organizationId: "org-1", role: "engineer" }

    it("refuses the preparer as their own approver", () => {
      const decision = proposeApproval({
        candidate,
        approverId: candidate.proposedBy,
        membership: preparer,
        project,
        policy: basePolicy,
        approvedAt: AT
      })
      expect(decision.admissible).toBe(false)
    })

    it("admits a second engineer and releases with a matching bundle", () => {
      const decision = proposeApproval({
        candidate,
        approverId: "engineer-2",
        membership: other,
        project,
        policy: basePolicy,
        approvedAt: AT
      })
      if (!decision.admissible) throw new Error("second engineer should be admissible")

      const bundle = buildEvidenceBundle({
        candidate,
        project,
        approvals: [decision.approval],
        entries: [
          {
            path: "harness.json",
            contentHash: hirHash,
            byteLength: JSON.stringify(compiled.hir).length
          },
          {
            path: "inputs.json",
            contentHash: assembly.sourceSet.fingerprint,
            byteLength: bytes.byteLength
          }
        ]
      })

      const gate = evaluateReadyForApproval(gateInput())
      expect(
        validateRelease({
          candidate,
          policy: basePolicy,
          approvals: [decision.approval],
          bundle,
          gatePassed: gate.ready
        })
      ).toEqual([])
    })
  })
})

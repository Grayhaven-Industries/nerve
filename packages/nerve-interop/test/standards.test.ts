import { describe, expect, it } from "vitest"
import {
  STANDARDS_PROFILE_SCHEMA_VERSION,
  composeStandardsProfiles,
  defineStandardsProfile,
  standardsProfileJson,
  validateStandardsProfile,
  type StandardAuthority,
  type StandardEvidenceRecord,
  type StandardRequirementReference,
  type StandardsProfile
} from "../src/index.js"

const authority = (revision = "F"): StandardAuthority => ({
  id: `ipc-a620-${revision.toLowerCase()}`,
  issuer: "Caller standards library",
  documentId: "IPC/WHMA-A-620",
  revision,
  scope: "Caller-selected workmanship observations",
  sourceKind: "licensed",
  sourceReference: `license://standards/a620/${revision}`,
  publication: "2025-10"
})

const profile = (selected = authority()): StandardsProfile =>
  defineStandardsProfile({
    id: `shop-${selected.revision.toLowerCase()}`,
    revision: "2026.08",
    authorities: [selected],
    requirements: [
      {
        id: "TERM-OBS-001",
        authorityId: selected.id,
        layer: "workmanship-observation",
        clauseRef: "caller-clause-id",
        parameterSource: {
          authorityId: selected.id,
          reference: "approved-inspection-plan-17"
        },
        applicability: {
          status: "applicable",
          rationale: "Customer purchase order selected this inspection observation."
        },
        reviewer: "quality-engineer",
        evidenceExpectations: ["inspection record reference"]
      }
    ]
  })

describe("standards profiles", () => {
  it("defines exact, source-identified profiles without a compliance verdict", () => {
    const selected = profile()
    expect(selected.schemaVersion).toBe(STANDARDS_PROFILE_SCHEMA_VERSION)
    expect(validateStandardsProfile(selected)).toEqual([])
    expect(selected).not.toHaveProperty("compliant")
    expect(selected).not.toHaveProperty("certified")
  })

  it("rejects latest aliases, missing sources, and certification claims", () => {
    expect(() => profile({ ...authority(), revision: "latest" })).toThrow(/NI-STD-003/)

    const withClaim = {
      ...profile(),
      claims: ["The harness is certified compliant"]
    } satisfies StandardsProfile
    expect(validateStandardsProfile(withClaim).map((entry) => entry.code)).toContain(
      "NI-STD-013"
    )

    const missingSource = {
      ...profile(),
      authorities: [{ ...authority(), sourceReference: "" }]
    } satisfies StandardsProfile
    expect(validateStandardsProfile(missingSource).map((entry) => entry.code)).toContain(
      "NI-STD-004"
    )
  })

  it("reports conflicting revisions instead of choosing one", () => {
    const f = profile(authority("F"))
    const eAuthority = { ...authority("E"), id: "ipc-a620-e" }
    const e = profile(eAuthority)
    const composed = composeStandardsProfiles([f, e])
    expect(composed.hasConflicts).toBe(true)
    expect(composed.issues.map((entry) => entry.code)).toContain("NI-STD-015")
    expect(composed.authorities.map((entry) => entry.revision)).toEqual(["E", "F"])
  })

  it("keeps evidence from crossing design, workmanship, and process layers", () => {
    const selected = profile()
    const crossed = {
      ...selected,
      evidence: [
        {
          id: "E-1",
          requirementId: "TERM-OBS-001",
          layer: "process-evidence",
          status: "satisfied",
          evidenceRefs: ["result:17"]
        }
      ]
    } satisfies StandardsProfile
    expect(validateStandardsProfile(crossed).map((entry) => entry.code)).toContain(
      "NI-STD-012"
    )
  })

  it("emits canonical newline-terminated JSON", () => {
    const selected = profile()
    const reversed = {
      evidence: selected.evidence,
      requirements: selected.requirements,
      authorities: selected.authorities,
      revision: selected.revision,
      id: selected.id,
      schemaVersion: selected.schemaVersion
    } satisfies StandardsProfile
    expect(standardsProfileJson(reversed)).toBe(standardsProfileJson(selected))
    expect(standardsProfileJson(selected).endsWith("\n")).toBe(true)
  })

  it("deep-owns nested caller input after definition", () => {
    const selectedAuthority = { ...authority() }
    const requirement = {
      id: "TERM-OBS-001",
      authorityId: selectedAuthority.id,
      layer: "workmanship-observation",
      parameterSource: {
        authorityId: selectedAuthority.id,
        reference: "approved-inspection-plan-17"
      },
      applicability: {
        status: "applicable",
        rationale: "Initially applicable."
      },
      reviewer: "quality-engineer",
      evidenceExpectations: ["inspection record"]
    } satisfies StandardRequirementReference
    const evidence = {
      id: "E-1",
      requirementId: requirement.id,
      layer: "workmanship-observation",
      status: "satisfied",
      evidenceRefs: ["artifact:original"]
    } satisfies StandardEvidenceRecord
    const defined = defineStandardsProfile({
      id: "owned-profile",
      revision: "1",
      authorities: [selectedAuthority],
      requirements: [requirement],
      evidence: [evidence]
    })

    selectedAuthority.revision = "MUTATED"
    requirement.applicability.rationale = "MUTATED"
    requirement.evidenceExpectations.push("MUTATED")
    evidence.evidenceRefs.push("artifact:mutated")

    expect(defined.authorities[0]?.revision).toBe("F")
    expect(defined.requirements[0]?.applicability?.rationale).toBe("Initially applicable.")
    expect(defined.requirements[0]?.evidenceExpectations).toEqual(["inspection record"])
    expect(defined.evidence[0]?.evidenceRefs).toEqual(["artifact:original"])
  })

  it("composes divergent duplicate profile ids independently of caller order", () => {
    const sameIdProfile = (revision: string, scope: string): StandardsProfile =>
      defineStandardsProfile({
        id: "same-profile",
        revision,
        authorities: [
          {
            ...authority(revision),
            id: "same-authority",
            scope,
            sourceReference: `license://standards/${revision}`
          }
        ],
        requirements: []
      })
    const first = sameIdProfile("1", "First scope")
    const second = sameIdProfile("2", "Second scope")

    const forward = composeStandardsProfiles([first, second])
    const reverse = composeStandardsProfiles([second, first])
    expect(reverse).toEqual(forward)
    expect(forward.issues.map((entry) => entry.code)).toContain("NI-STD-018")

    const exact = composeStandardsProfiles([first, first])
    expect(exact.profileIds).toEqual(["same-profile"])
    expect(exact.issues.map((entry) => entry.code)).not.toContain("NI-STD-018")
  })

  it("rejects satisfied evidence without an artifact reference", () => {
    const selected = profile()
    const unsupported = {
      ...selected,
      evidence: [
        {
          id: "E-EMPTY",
          requirementId: "TERM-OBS-001",
          layer: "workmanship-observation",
          status: "satisfied",
          evidenceRefs: []
        }
      ]
    } satisfies StandardsProfile
    expect(validateStandardsProfile(unsupported).map((entry) => entry.code)).toContain(
      "NI-STD-019"
    )
  })

  it("rejects malformed or incomplete waiver records at the runtime boundary", () => {
    const selected = profile()
    const requirement = selected.requirements[0]!
    const invalidWaivers: ReadonlyArray<unknown> = [
      "waived",
      {},
      { reference: "waiver:17", rationale: "", approvedBy: "quality" },
      { reference: "waiver:17", rationale: "approved exception" },
      {
        reference: "waiver:17",
        rationale: "approved exception",
        approvedBy: "quality",
        approvedOn: ""
      }
    ]

    for (const waiver of invalidWaivers) {
      const candidate = {
        ...selected,
        requirements: [{ ...requirement, waiver }]
      }
      expect(validateStandardsProfile(candidate).map((entry) => entry.code)).toEqual([
        "NI-STD-020"
      ])
    }

    const valid = {
      ...selected,
      requirements: [{
        ...requirement,
        waiver: {
          reference: "waiver:17",
          rationale: "Approved customer exception.",
          approvedBy: "quality",
          approvedOn: "2026-08-27"
        }
      }]
    } satisfies StandardsProfile
    expect(validateStandardsProfile(valid)).toEqual([])
  })

  it("rejects blank evidence identities", () => {
    const selected = profile()
    const blankIdentity = {
      ...selected,
      evidence: [{
        id: "",
        requirementId: selected.requirements[0]!.id,
        layer: "workmanship-observation",
        status: "unassessed",
        evidenceRefs: []
      }]
    } satisfies StandardsProfile

    expect(validateStandardsProfile(blankIdentity)).toContainEqual(
      expect.objectContaining({ code: "NI-STD-002", target: "evidence:<missing>" })
    )
  })

  it("fails closed for hostile accessors and inherited-only profiles without dropping valid neighbors", () => {
    const getter = {}
    Object.defineProperty(getter, "schemaVersion", {
      enumerable: true,
      get: () => {
        throw new Error("hostile getter")
      }
    })
    const proxy = new Proxy({}, {
      get: () => {
        throw new Error("hostile proxy")
      }
    })
    const inheritedOnly: unknown = Object.create(profile())

    for (const hostile of [getter, proxy, inheritedOnly]) {
      expect(validateStandardsProfile(hostile).map((entry) => entry.code)).toEqual([
        "NI-STD-020"
      ])
      const composed = composeStandardsProfiles([profile(), hostile])
      expect(composed.hasConflicts).toBe(true)
      expect(composed.issues.map((entry) => entry.code)).toContain("NI-STD-020")
      expect(composed.profileIds).toEqual(["shop-f"])
    }
  })

  it("diagnoses malformed external profile objects without native crashes", () => {
    expect(validateStandardsProfile(null).map((entry) => entry.code)).toEqual(["NI-STD-020"])
    const composed = composeStandardsProfiles([null, {}])
    expect(composed.hasConflicts).toBe(true)
    expect(composed.issues.every((entry) => entry.code === "NI-STD-020")).toBe(true)
    // SAFETY: Deliberately bypass the static builder contract to verify its runtime boundary.
    expect(() => defineStandardsProfile(null as never)).toThrow(/NI-STD-020/)
  })
})

/**
 * Core product objects (PRD §8).
 *
 * These are the platform's nouns, defined once as Effect Schema so every
 * boundary — API, job queue, evidence bundle — decodes through the same
 * versioned codec the compiler packages already use for HIR.
 *
 * The objects split into two kinds, and the distinction drives the whole
 * release model: mutable records the customer edits (organization, project,
 * harness, policy) and immutable records that are content-addressed and
 * never rewritten (source set, review run, finding, approval, release).
 * §9.1 step 8 and §10 depend on the second kind never being mutated — a new
 * input produces a new run, it does not revise the previous verdict.
 */
import { Schema } from "effect"

/** Platform object schema version, moved independently of HIR's. */
export const PLATFORM_SCHEMA_VERSION = "0.1.0" as const

/** An RFC 3339 timestamp, recorded in UTC. */
export const Timestamp = Schema.String

/** A content-addressed identity produced by `fingerprint.ts`. */
export const FingerprintValue = Schema.String

// ---------------------------------------------------------------------------
// Organization and membership (ORG-001, ORG-002)
// ---------------------------------------------------------------------------

/**
 * MVP roles (ORG-002). Ordered least- to most-privileged; `roleRank` in
 * `access.ts` relies on this order, so new roles must be inserted at their
 * true privilege position rather than appended.
 */
export const Role = Schema.Literal("viewer", "reviewer", "engineer", "admin")
export type Role = Schema.Schema.Type<typeof Role>

export const User = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  displayName: Schema.String
})
export type User = Schema.Schema.Type<typeof User>

/**
 * A user's role inside one organization, optionally narrowed to specific
 * projects. ORG-003 enforces authorization at both boundaries, so a
 * membership that names no projects grants its role org-wide, while one that
 * names projects grants it only there.
 */
export const Membership = Schema.Struct({
  userId: Schema.String,
  organizationId: Schema.String,
  role: Role,
  projectIds: Schema.optional(Schema.Array(Schema.String))
})
export type Membership = Schema.Schema.Type<typeof Membership>

export const Organization = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  createdAt: Timestamp
})
export type Organization = Schema.Schema.Type<typeof Organization>

export const Project = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  name: Schema.String,
  /** Pilots and non-production projects may carry a relaxed approval rule
   * (§10.3); the flag lives on the project so the exception is scoped rather
   * than global, and so the evidence bundle can state which project it
   * applied to. */
  production: Schema.Boolean,
  createdAt: Timestamp
})
export type Project = Schema.Schema.Type<typeof Project>

export const Harness = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  name: Schema.String,
  /** Variant key, when this record is one variant of a family. */
  variant: Schema.optional(Schema.String)
})
export type Harness = Schema.Schema.Type<typeof Harness>

// ---------------------------------------------------------------------------
// Source sets (ING-006)
// ---------------------------------------------------------------------------

/** Import adapters accepted in the MVP (ING-002). */
export const SourceKind = Schema.Literal(
  "nerve-source",
  "hir-json",
  "csv",
  "xlsx",
  "wireviz",
  "pinout-csv",
  "pinout-json",
  "kicad-pcb",
  "circuit-json"
)
export type SourceKind = Schema.Schema.Type<typeof SourceKind>

/**
 * Per-file provenance (ING-006). Every field here is required because the
 * point of the record is to make a submission reproducible by someone who
 * was not in the room: which bytes, read by which adapter version, under
 * which saved mapping, uploaded by whom.
 */
export const SourceFile = Schema.Struct({
  filename: Schema.String,
  mediaType: Schema.String,
  byteLength: Schema.Number,
  contentHash: FingerprintValue,
  kind: SourceKind,
  importAdapterVersion: Schema.String,
  /** Present exactly when the adapter requires a saved column map (ING-003). */
  mappingVersion: Schema.optional(Schema.String),
  uploadedBy: Schema.String,
  uploadedAt: Timestamp
})
export type SourceFile = Schema.Schema.Type<typeof SourceFile>

/**
 * The exact submission a review ran against (§8). Immutable: the fingerprint
 * covers the files, the mappings, the declared dependency versions, and the
 * interface contracts, so any change produces a different source set rather
 * than a new version of this one (ING-007).
 */
export const SourceSet = Schema.Struct({
  id: Schema.String,
  harnessId: Schema.String,
  files: Schema.Array(SourceFile),
  /** Resolved versions of rule packs, part libraries, and the compiler, so a
   * dependency bump invalidates approvals (§10.2) instead of silently
   * changing what "the same source" means. */
  dependencyVersions: Schema.Record({ key: Schema.String, value: Schema.String }),
  /** Interface-contract file ids this submission claims to satisfy. */
  interfaceContracts: Schema.Array(Schema.String),
  fingerprint: FingerprintValue,
  createdAt: Timestamp
})
export type SourceSet = Schema.Schema.Type<typeof SourceSet>

// ---------------------------------------------------------------------------
// Findings and dispositions (§8, §9.3)
// ---------------------------------------------------------------------------

/**
 * Finding severity. Mirrors the compiler's diagnostic severities so a rule
 * result crossing into the platform keeps its meaning; the org policy may
 * override the level per rule (ORG-004), which is why the finding records
 * both the rule's own severity and the effective one.
 */
export const Severity = Schema.Literal("error", "warning", "info")
export type Severity = Schema.Schema.Type<typeof Severity>

export const Finding = Schema.Struct({
  id: Schema.String,
  reviewRunId: Schema.String,
  /** Stable rule code, e.g. `HK-WIRE-001`. */
  code: Schema.String,
  severity: Severity,
  /** Severity before org policy overrides, kept so a reviewer can see that a
   * blocking finding was downgraded by configuration rather than by the rule. */
  ruleSeverity: Severity,
  message: Schema.String,
  /** Primary affected object, in the §19 ref grammar (`connector:J1.pin:3`). */
  target: Schema.optional(Schema.String),
  targets: Schema.optional(Schema.Array(Schema.String)),
  /** Measured value and applicable limit behind the message (§9.3 step 1). */
  data: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Union(Schema.String, Schema.Number) })
  ),
  /** Source row or file location, when the finding traces to one. */
  sourceLocation: Schema.optional(
    Schema.Struct({
      filename: Schema.String,
      row: Schema.optional(Schema.Number),
      column: Schema.optional(Schema.String)
    })
  )
})
export type Finding = Schema.Schema.Type<typeof Finding>

/** Resolution states a reviewer may select (§9.3 step 2). */
export const DispositionState = Schema.Literal(
  "fixed-in-new-run",
  "accepted-risk",
  "false-positive",
  "not-applicable",
  "deferred"
)
export type DispositionState = Schema.Schema.Type<typeof DispositionState>

/**
 * A human decision attached to a finding (§9.3).
 *
 * `scope` is the anti-blast-radius field: §9.3 step 5 binds a waiver to one
 * harness, rule, object, and source fingerprint, so carrying a disposition
 * forward to an unrelated harness or a changed submission requires an
 * administrator to define a broader exception deliberately.
 */
export const Disposition = Schema.Struct({
  findingId: Schema.String,
  state: DispositionState,
  /** Required for every non-fixed state (§9.3 step 3). */
  reason: Schema.optional(Schema.String),
  ownerId: Schema.optional(Schema.String),
  decidedBy: Schema.String,
  decidedAt: Timestamp,
  /** Policy may additionally demand these (§9.3 step 4). */
  approverId: Schema.optional(Schema.String),
  attachmentId: Schema.optional(Schema.String),
  expiresAt: Schema.optional(Timestamp),
  issueLink: Schema.optional(Schema.String),
  scope: Schema.Struct({
    harnessId: Schema.String,
    code: Schema.String,
    target: Schema.optional(Schema.String),
    sourceSetFingerprint: FingerprintValue
  })
})
export type Disposition = Schema.Schema.Type<typeof Disposition>

// ---------------------------------------------------------------------------
// Review runs, approvals, releases
// ---------------------------------------------------------------------------

/**
 * Review lifecycle (§10.1). `review-failed` is deliberately outside the
 * progression: §10.1 calls it a terminal execution state for one run, not a
 * design verdict, so it never feeds forward into approval.
 */
export const ReviewState = Schema.Literal(
  "draft",
  "import-needs-attention",
  "review-running",
  "action-required",
  "ready-for-approval",
  "approved",
  "released",
  "superseded",
  "review-failed"
)
export type ReviewState = Schema.Schema.Type<typeof ReviewState>

export const ReviewRun = Schema.Struct({
  id: Schema.String,
  harnessId: Schema.String,
  sourceSetId: Schema.String,
  sourceSetFingerprint: FingerprintValue,
  /** Engine and policy identity are part of the run, not looked up later: a
   * rule-pack or policy change must produce a new run (§10.2). */
  engineVersion: Schema.String,
  policyId: Schema.String,
  policyFingerprint: FingerprintValue,
  state: ReviewState,
  preparedBy: Schema.String,
  createdAt: Timestamp,
  fingerprint: FingerprintValue
})
export type ReviewRun = Schema.Schema.Type<typeof ReviewRun>

export const Approval = Schema.Struct({
  candidateFingerprint: FingerprintValue,
  approvedBy: Schema.String,
  approvedAt: Timestamp,
  /** Recorded so §10.3's one-person pilot exception is visible in the bundle
   * rather than inferred from the absence of a second approval. */
  singleApproverException: Schema.Boolean
})
export type Approval = Schema.Schema.Type<typeof Approval>

export const Release = Schema.Struct({
  id: Schema.String,
  reviewRunId: Schema.String,
  candidateFingerprint: FingerprintValue,
  bundleFingerprint: FingerprintValue,
  approvals: Schema.Array(Approval),
  releasedAt: Timestamp,
  supersededBy: Schema.optional(Schema.String)
})
export type Release = Schema.Schema.Type<typeof Release>

// ---------------------------------------------------------------------------
// Policy (ORG-004, ORG-005)
// ---------------------------------------------------------------------------

/**
 * What a non-fixed disposition must carry before the gate accepts it
 * (§9.3 step 4). Expressed as requirements rather than as free-form config so
 * the gate can state exactly which one is missing.
 */
export const WaiverRequirements = Schema.Struct({
  requireApprover: Schema.Boolean,
  requireAttachment: Schema.Boolean,
  requireExpiry: Schema.Boolean,
  requireIssueLink: Schema.Boolean
})
export type WaiverRequirements = Schema.Schema.Type<typeof WaiverRequirements>

/**
 * Organization release policy (§8, ORG-004).
 *
 * The policy is fingerprinted and pinned onto each review run because §10.2
 * invalidates approvals when policy changes: a candidate approved under a
 * looser rule must not release under the customer's belief that the current
 * rule was applied.
 */
export const Policy = Schema.Struct({
  id: Schema.String,
  organizationId: Schema.String,
  /** Rule packs that must run and succeed for the gate to pass. */
  requiredRulePacks: Schema.Array(Schema.String),
  /** Interface contracts that must pass. */
  requiredInterfaceContracts: Schema.Array(Schema.String),
  /** Per-rule severity overrides (ORG-004). */
  severityOverrides: Schema.Record({ key: Schema.String, value: Severity }),
  /** When true, every warning needs an explicit acknowledgement (§10.2). */
  requireWarningAcknowledgement: Schema.Boolean,
  waiverRequirements: WaiverRequirements,
  /** Named users who must approve; empty means "any authorized user". */
  requiredApproverIds: Schema.Array(Schema.String),
  /** §10.3 exception, permitted only on non-production projects. */
  allowSingleApprover: Schema.Boolean,
  /** §9.2 step 4: reuse of fingerprint-identical evidence is opt-in. */
  allowEvidenceReuse: Schema.Boolean,
  /** How long findings and bundles are retained, days (ORG-004). */
  retentionDays: Schema.Number,
  /**
   * How stale a required source may be before §10.2's last bullet blocks the
   * candidate, in days.
   *
   * It belongs to the policy rather than to each gate call because ORG-004
   * makes the release rules an administrator's setting: a tolerance supplied
   * per invocation could differ between two runs of the same organization,
   * and the fingerprinted policy is what an approval is attested against.
   */
  sourceStalenessToleranceDays: Schema.Number,
  fingerprint: FingerprintValue
})
export type Policy = Schema.Schema.Type<typeof Policy>

// ---------------------------------------------------------------------------
// Release candidate and evidence bundle (§8, §10.2)
// ---------------------------------------------------------------------------

/**
 * A review run proposed for approval (§8, §9.4 step 2).
 *
 * The candidate freezes inputs, results, dispositions, and generated
 * artifacts; its fingerprint is what approvers attest to, and what the
 * finished bundle must match.
 */
export const ReleaseCandidate = Schema.Struct({
  id: Schema.String,
  reviewRunId: Schema.String,
  reviewRunFingerprint: FingerprintValue,
  sourceSetFingerprint: FingerprintValue,
  policyFingerprint: FingerprintValue,
  /** Content hashes of every regenerated artifact (§10.2). */
  artifactHashes: Schema.Record({ key: Schema.String, value: FingerprintValue }),
  proposedBy: Schema.String,
  proposedAt: Timestamp,
  fingerprint: FingerprintValue
})
export type ReleaseCandidate = Schema.Schema.Type<typeof ReleaseCandidate>

/**
 * Portable archive contents (§8). Listed as a manifest of named entries with
 * hashes rather than as bytes so the bundle can be verified without being
 * unpacked, and so `bundleFingerprint` is reproducible.
 */
export const EvidenceBundle = Schema.Struct({
  schemaVersion: Schema.Literal(PLATFORM_SCHEMA_VERSION),
  releaseCandidateFingerprint: FingerprintValue,
  entries: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      contentHash: FingerprintValue,
      byteLength: Schema.Number
    })
  ),
  /** Recorded exceptions that a reader must see, e.g. single-approver pilots
   * (§10.3) — the bundle states them rather than leaving them implicit. */
  exceptions: Schema.Array(Schema.String),
  fingerprint: FingerprintValue
})
export type EvidenceBundle = Schema.Schema.Type<typeof EvidenceBundle>

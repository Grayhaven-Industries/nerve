/**
 * @grayhaven/nerve-platform — the reviewable-release layer above the compiler.
 *
 * The open-source compiler decides what a harness *is*. This package decides
 * whether a particular submission may be released: who may act (ORG-001..006),
 * what exactly was submitted (ING-001..008), what the review found and how it
 * was dispositioned (§9.3), and whether the gate, approvals, and evidence
 * bundle line up (§10.2, §10.3).
 *
 * Nothing here mutates a verdict. Every immutable record is content-addressed
 * via `fingerprint`, so a changed input, rule, policy, or dependency produces a
 * new identity rather than a quietly revised old one.
 */

// Fingerprints — the identity primitive every immutable record depends on.
export { canonicalize, fingerprint, fingerprintBytes } from "./fingerprint.js"
export type { Canonical, Fingerprint } from "./fingerprint.js"

// Core product objects (§8).
export {
  Approval,
  Disposition,
  DispositionState,
  EvidenceBundle,
  Finding,
  Harness,
  Membership,
  Organization,
  PLATFORM_SCHEMA_VERSION,
  Policy,
  Project,
  Release,
  ReleaseCandidate,
  ReviewRun,
  ReviewState,
  Role,
  Severity,
  SourceFile,
  SourceKind,
  SourceSet,
  User,
  WaiverRequirements
} from "./objects.js"

// Access control (ORG-002, ORG-003).
export { can, roleRank } from "./access.js"
export type { Action } from "./access.js"

// Organization policy (ORG-004).
export { effectiveSeverity, policyFingerprint } from "./policy.js"

// Append-only audit log (ORG-006).
export { appendAuditEntry, AuditEntry, verifyAuditLog } from "./audit.js"
export type { AuditEntryInput } from "./audit.js"

// Ingestion and source sets (ING-001..008).
export {
  assembleSourceSet,
  assertIsolatedJob,
  assertRowAccountingComplete,
  buildImportReport,
  IngestionError,
  IngestionErrorCode,
  MalwareScanVerdict,
  requiresColumnMap,
  resolveContentStorage,
  sortSourceFiles,
  sourceSetFingerprint,
  summarizeRowAccounting,
  unmappedColumnUnknowns,
  wireListFileImport
} from "./ingestion.js"
export type {
  ColumnDiagnostic,
  FileImportInput,
  FileRowAccounting,
  ImportReport,
  IngestionJobPreconditions,
  RetainedUnknown,
  RowAccount,
  RowAccountingImbalance,
  RowAccountingSummary,
  SourceSetAssembly,
  SourceSetAssemblyInput,
  SourceSetIdentity,
  StorageDisposition,
  StorageResolution,
  UploadedFile
} from "./ingestion.js"

// Review lifecycle, release gate, and revision diff (§10.1, §10.2, §9.2).
export {
  canTransition,
  checkTransition,
  diffRevisions,
  evaluateReadyForApproval,
  evidenceReuseAllowed,
  GateCodes,
  isTerminalState,
  nextStates,
  requiresNewRun,
  reviewStates,
  reviewTransitions,
  TransitionCodes
} from "./review.js"
export type {
  CompilationOutcome,
  CoverageDisclosure,
  GateBlocker,
  GateCode,
  GateInput,
  GateResult,
  InterfaceContractResult,
  RegeneratedArtifacts,
  RevisionChange,
  RevisionChangeKind,
  RevisionDiff,
  RevisionDomain,
  RevisionObject,
  RevisionSide,
  RulePackResult,
  SourceFreshness,
  TransitionCheck,
  TransitionCode
} from "./review.js"

// Dispositions and waivers (§9.3).
export { dispositionApplies, DispositionCodes, validateDisposition } from "./dispositions.js"
export type { DispositionProblem } from "./dispositions.js"

// Approvals (§10.3, §9.4 step 4).
export { ApprovalCodes, invalidateApprovals, proposeApproval } from "./approvals.js"
export type {
  ApprovalDecision,
  ApprovalInvalidation,
  ApprovalRefusal,
  CandidateInputs,
  ProposedApproval
} from "./approvals.js"

// Evidence bundle and release admissibility (§10.2 release half).
export {
  buildEvidenceBundle,
  evidenceBundleFingerprint,
  ReleaseCodes,
  singleApproverExceptionLines,
  validateRelease
} from "./evidence.js"
export type { BundleEntry, ProposedRelease, ReleaseRefusal } from "./evidence.js"

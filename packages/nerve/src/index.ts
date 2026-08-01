/**
 * @grayhaven/nerve — Harnesses as code.
 *
 * Domain model, DSL builders, HIR types/schema, compiler interface, and
 * validation primitives (PRD §10.1).
 */
export type {
  AutocompleteString,
  BranchDef,
  BranchProps,
  CableDef,
  CableProps,
  ConnectorGender,
  ConnectorInstance,
  ConnectorPart,
  DifferentialPolarity,
  DifferentialSemantics,
  ElectricalRole,
  HarnessDesign,
  HarnessProps,
  KnownWireColor,
  LabelDef,
  LabelProps,
  PartProvenance,
  PinAssignments,
  PinElectrical,
  PinElectricalAssignments,
  PinRef,
  ProtectionDef,
  ProtectionProps,
  SpliceDef,
  SpliceProps,
  SpliceRef,
  Units,
  VoltageRange,
  WireDef,
  WireEndpoint,
  WirePart,
  WireProps
} from "./domain.js"

export {
  branch,
  cable,
  connector,
  harness,
  label,
  protection,
  splice,
  wire,
  type ConnectorProps,
  type EndpointInput,
  type PinPartAssignment
} from "./dsl.js"

export {
  Codes,
  DiagnosticSeverity,
  hasErrors,
  type Diagnostic
} from "./diagnostics.js"

export { endpointLabel, HIR_SCHEMA_VERSION, isPinEndpoint, refs } from "./hir/core.js"
export {
  decodeHir,
  decodeHirEffect,
  encodeHir,
  hirJsonSchema,
  Hir,
  HirBomItem,
  HirBranch,
  HirCable,
  HirConnector,
  HirEndpoint,
  HirLabel,
  HirPin,
  HirPinElectrical,
  HirPinRef,
  HirProtection,
  HirSplice,
  HirSpliceRef,
  HirWire
} from "./hir/schema.js"

export { compileDesign, type CompileResult } from "./compile.js"

export {
  analyzeElectricalConstraints,
  type ElectricalAnalysis,
  type ElectricalConstraintFinding,
  type ElectricalConstraintKind,
  type ElectricalNetSemantics,
  type ElectricalPinFact
} from "./electrical.js"

export { canonicalGauge, parseAwg, type KnownGauge } from "./gauge.js"

export { computeNets, endpointRefKey, type HarnessNets, type NetSource } from "./nets.js"

export {
  defineConfig,
  type CostModel,
  type NerveConfig,
  type PartCost,
  type PartLifecycle,
  type ShopProfile
} from "./config.js"

export { variant, type VariantOptions } from "./variant.js"

export {
  harnessTemplate,
  mergeFragments,
  prefixRefs,
  type HarnessFragment,
  type HarnessTemplate
} from "./template.js"

export { definePlugin, isNervePlugin, type NervePlugin } from "./plugin.js"

export {
  diffHir,
  formatDiff,
  isEmptyDiff,
  type EntityChange,
  type FieldChange,
  type HirDiff,
  type PinoutChange,
  type SectionDiff
} from "./diff.js"

export {
  rule,
  runRules,
  type Rule,
  type RuleConfig,
  type RuleContext,
  type RuleOptions,
  type RuleReport
} from "./rules.js"
export { resolvePart, resolvePartWithCoverage, staticProvider } from "./providers.js"
export type { PartCoverageReporter, PartProvider, ResolvedPart } from "./providers.js"

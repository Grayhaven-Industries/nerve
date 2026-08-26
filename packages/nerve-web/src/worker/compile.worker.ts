/**
 * Compile worker (PRD §9.5, §13, §14): compilation, validation, and
 * render-prep run off the main thread so the UI stays responsive.
 *
 * Two modes:
 *  - bundled: compile a statically bundled example design,
 *  - source (§9.6): transform user-authored TypeScript with sucrase and
 *    evaluate it here — inside the worker, away from the DOM — with a
 *    require() shim that only exposes the Nerve libraries.
 */
// sucrase (~200KB) loads lazily on the first source-mode compile; the
// bundled-example path never pays for it.
import {
  branch,
  cable,
  Codes,
  compileDesign,
  connector,
  defineConfig,
  definePlugin,
  DiagnosticSeverity,
  diffHir,
  endpointLabel,
  formatDiff,
  harness,
  hasErrors,
  HIR_SCHEMA_VERSION,
  isEmptyDiff,
  isNervePlugin,
  isPinEndpoint,
  label,
  protection,
  refs,
  rule,
  runRules,
  runRulesWithMargins,
  splice,
  variant,
  wire,
  type HarnessDesign
} from "@grayhaven/nerve"
import * as connectorsModule from "@grayhaven/nerve-connectors"
import { builtinRules } from "@grayhaven/nerve-rules"
import { auditProvenance } from "@grayhaven/nerve-eval"
import { boardSvg, connectorFacesSvg, generateTestPlan, schematicSvg } from "@grayhaven/nerve-exporters"
import motorController from "@grayhaven/example-motor-controller"
import sensorSplice from "@grayhaven/example-sensor-splice"
import robotPlatform from "@grayhaven/example-robot-platform"
import type { CompileRequest, CompileResponse } from "../lib/compile-types.js"
import type { SandboxModule } from "../lib/fs-eval.js"

const designs = new Map<string, HarnessDesign>([
  ["motor-controller", motorController],
  ["sensor-splice", sensorSplice],
  ["robot-platform", robotPlatform]
])

/** Modules visible to editor-authored code. The nerve surface is a curated
 * named-import object (not `import *`): a namespace import would mark the
 * barrel's Effect Schema codecs as used and drag ~160KB of effect into the
 * worker. Everything except decodeHir/encodeHir/Hir codecs is exposed. */
const SANDBOX_MODULES = {
  "@grayhaven/nerve": {
    branch,
    cable,
    Codes,
    compileDesign,
    connector,
    defineConfig,
    definePlugin,
    DiagnosticSeverity,
    diffHir,
    endpointLabel,
    formatDiff,
    harness,
    hasErrors,
    HIR_SCHEMA_VERSION,
    isEmptyDiff,
    isNervePlugin,
    isPinEndpoint,
    label,
    protection,
    refs,
    rule,
    runRules,
    splice,
    variant,
    wire
  },
  "@grayhaven/nerve-connectors": connectorsModule
} satisfies Readonly<Record<string, SandboxModule>>

/** Multi-file evaluation (PRD §9.6): fsMap + entrypoint via fs-eval. */
const evaluateProject = async (
  fsMap: Readonly<Record<string, string>>,
  entrypoint: string
): Promise<HarnessDesign> => {
  // Independent lazy chunks: load concurrently, still out of the initial bundle.
  // sucrase 3.35.1 exports `transform` as a sync named export returning `.code`.
  const [{ transform }, { evaluateFsMap }] = await Promise.all([
    import("sucrase"),
    import("../lib/fs-eval.js")
  ])
  return evaluateFsMap(fsMap, entrypoint, {
    modules: SANDBOX_MODULES,
    transform: (source) =>
      transform(source, { transforms: ["typescript", "imports"] }).code
  })
}

// Async handler: overlapping requests may complete out of order, which is
// safe because compile-client matches responses by id.
self.onmessage = async (event: MessageEvent<CompileRequest>) => {
  const { id, kind, projectId, source, fsMap, entrypoint } = event.data
  let design: HarnessDesign | undefined
  try {
    design =
      fsMap !== undefined
        ? await evaluateProject(fsMap, entrypoint ?? "/main.harness.ts")
        : source !== undefined
          ? // Single-string compat: callers that predate fsMap.
            await evaluateProject({ "/main.harness.ts": source }, "/main.harness.ts")
          : designs.get(projectId)
  } catch (cause) {
    self.postMessage({
      id,
      error: cause instanceof Error ? cause.message : String(cause)
    } satisfies CompileResponse)
    return
  }
  if (design === undefined) {
    self.postMessage({
      id,
      error: `Unknown project: ${projectId}`
    } satisfies CompileResponse)
    return
  }
  const { hir, diagnostics: structural } = compileDesign(design)
  // Margins come from the same pass as the findings so the two can never
  // disagree about a number. A design with no errors still has margins, which
  // is the point of collecting them.
  const { diagnostics: ruleDiagnostics, margins } = runRulesWithMargins(hir, builtinRules)
  const diagnostics = [...structural, ...ruleDiagnostics]
  const fullHir = { ...hir, diagnostics }
  if (kind === "export") {
    try {
      // Lazy: pdf-lib + zip machinery (~450KB) load only when someone
      // actually exports — the compile path stays at 41KB.
      const { buildPacket } = await import("@grayhaven/nerve-exporters")
      const packet = await buildPacket(fullHir)
      self.postMessage({ id, zip: packet.zip } satisfies CompileResponse)
    } catch (cause) {
      self.postMessage({
        id,
        error: cause instanceof Error ? cause.message : String(cause)
      } satisfies CompileResponse)
    }
    return
  }
  self.postMessage({
    id,
    result: {
      hir: fullHir,
      svg: schematicSvg(fullHir),
      boardSvg: boardSvg(fullHir),
      facesSvg: connectorFacesSvg(fullHir),
      testPlan: generateTestPlan(fullHir),
      margins,
      provenance: auditProvenance(fullHir)
    }
  } satisfies CompileResponse)
}

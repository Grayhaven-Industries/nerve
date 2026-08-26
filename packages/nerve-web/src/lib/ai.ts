/**
 * AI harness agent (PRD §12, datum's parametric-agent pattern).
 *
 * The agent edits harness source through two tools — a surgical patch and a
 * full rewrite — and every tool call is verified by the compile worker
 * before it lands. Diagnostics feed back into the loop, so the AI cannot
 * bypass HK-* rule failures (§12.3): it either converges to a clean compile
 * or surfaces the remaining diagnostics for review.
 *
 * No server: this is a static SPA, so calls go browser → OpenAI with a
 * user-supplied API key (kept in localStorage, sent only to OpenAI).
 * Multi-turn tool state rides on the Responses API's previous_response_id
 * instead of client-side item replay.
 */
// The SDK loads lazily on the first agent turn (dynamic import below), so
// none of it ships in the route chunk. Type-only imports are erased.
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsStreaming,
  ResponseInputItem
} from "openai/resources/responses/responses"
import { compileProjectFile, compileSource, countDiagnostics } from "./compile-client.js"
import { ENTRY_FILE, getFiles, setFileSource } from "./sources.js"
import type { CompileResult } from "./compile-types.js"
import dslMeta from "../docs/dsl-meta.json"

const KEY_STORAGE = "nerve:openai-key"
const MODEL = "gpt-5.5"
const MAX_TOOL_ROUNDS = 6

export const getApiKey = (): string | undefined => {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? undefined
  } catch {
    return undefined
  }
}

export const setApiKey = (key: string): void => {
  try {
    if (key === "") localStorage.removeItem(KEY_STORAGE)
    else localStorage.setItem(KEY_STORAGE, key)
  } catch {
    // privacy mode: session-only
  }
}

const TOOLS: FunctionTool[] = [
  {
    type: "function",
    name: "edit_harness_source",
    description:
      "Apply a surgical patch to a project source file. Use for focused changes. " +
      "old_string must appear EXACTLY ONCE in the file (include surrounding lines to disambiguate). " +
      "The result is compiled immediately; you get back the diagnostics.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          // Nullable-and-required is strict mode's encoding of "optional".
          type: ["string", "null"],
          description: "Project file to modify, defaults to the entry file"
        },
        old_string: {
          type: "string",
          description: "Exact text to replace — must be unique in the file"
        },
        new_string: { type: "string", description: "Replacement text" }
      },
      required: ["path", "old_string", "new_string"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "rewrite_harness_source",
    description:
      "Replace the entire contents of a project source file. Use only when changes are too " +
      "extensive for patches (roughly >30% of the file). The result is compiled immediately; " +
      "you get back the diagnostics.",
    strict: true,
    parameters: {
      type: "object",
      properties: {
        path: {
          type: ["string", "null"],
          description: "Project file to modify, defaults to the entry file"
        },
        source: { type: "string", description: "The complete new TypeScript file source" }
      },
      required: ["path", "source"],
      additionalProperties: false
    }
  }
]

// Generated from @grayhaven/nerve source (scripts/extract-dsl.ts via
// dsl-meta.json) — the copilot's view of the DSL cannot drift from the
// shipped builders/props. The old hardcoded line omitted half of
// WireProps (stripe, twistGroup, shieldGroup, voltageRating, …).
const dslSurface = (): string => {
  const sigs = dslMeta.builders.map((b) => b.signature).join("\n")
  const props = dslMeta.interfaces
    .map((i) => `${i.name}: ${i.props.map((p) => `${p.name}${p.optional ? "?" : ""}`).join(", ")}`)
    .join("\n")
  return `The DSL (imported from "@grayhaven/nerve"):\n\`\`\`\n${sigs}\n\`\`\`\nProps per options object:\n${props}`
}

const systemPrompt = (projectId: string): string =>
  `You are the Grayhaven Nerve harness agent — an AI copilot inside a wiring-harness design tool where harnesses are TypeScript programs ("harnesses as code").

${dslSurface()}

Endpoints are written "CONNECTOR.pin" (e.g. "J1.3") or "SPLICE" for splice nodes. Gauges are strings like "20AWG". Connector parts declare wireGaugeRange {min, max} — wires must fit within it.

Rules of engagement:
- Each turn you receive EVERY project file (labeled by path) and the current diagnostics. Make the user's change with the smallest edit that works: prefer edit_harness_source; rewrite only for sweeping changes. Edits target the entry file (${ENTRY_FILE}) unless you pass \`path\`.
- Every tool call compiles immediately in a local worker and returns diagnostics. If your edit introduces errors (HK-* codes), fix them before finishing — you may not leave the harness worse than you found it. Pre-existing warnings you weren't asked to fix may remain.
- The user watches the diagram update live as your edits land. Keep your prose to one or two sentences per turn; the diff and the diagram speak for themselves.
- Current project: ${projectId}. Do not invent connector part numbers — reuse parts already defined in the source unless asked to add new ones.`

export interface ToolEvent {
  readonly name: string
  readonly status: "running" | "ok" | "failed"
  readonly detail?: string
}

export interface AgentEvent {
  readonly type: "text" | "tool" | "compile" | "done" | "error"
  readonly text?: string
  readonly tool?: ToolEvent
  readonly compile?: { errors: number; warnings: number }
}

export interface ChatTurn {
  readonly role: "user" | "assistant"
  readonly text: string
  readonly tools?: ReadonlyArray<{ name: string; status: "ok" | "failed"; detail?: string }>
}

/** The whole project as turn context: every path listed, every file's full
 * contents labeled by path (they are small TS files). */
const projectContext = (projectId: string): string => {
  const files = getFiles(projectId)
  return [
    `Files: ${Object.keys(files).join(", ")}`,
    ...Object.entries(files).map(([path, source]) => `<file path="${path}">\n${source}\n</file>`)
  ].join("\n")
}

const diagnosticsReport = (result: CompileResult): string => {
  const { errors, warnings } = countDiagnostics(result.hir.diagnostics)
  if (result.hir.diagnostics.length === 0) return "Compiled clean: 0 errors, 0 warnings."
  const lines = result.hir.diagnostics
    .slice(0, 20)
    .map((d) => `${d.severity.toUpperCase()} ${d.code} ${d.target ?? ""}: ${d.message}`)
  return `Compiled: ${errors} error(s), ${warnings} warning(s).\n${lines.join("\n")}`
}

/** A tool call the model can make, as the strict tool schemas above define
 * it. `path` is nullable-and-required on the wire (strict mode's encoding of
 * optional); null and absent both mean the entry file. */
export interface EditToolCall {
  readonly name: "edit_harness_source"
  readonly path?: string | null
  readonly old_string: string
  readonly new_string: string
}

export interface RewriteToolCall {
  readonly name: "rewrite_harness_source"
  readonly path?: string | null
  readonly source: string
}

export type ToolCall = EditToolCall | RewriteToolCall

export type PatchOutcome = { ok: true; next: string } | { ok: false; report: string }

export type ProjectPatchOutcome =
  | { ok: true; path: string; next: string }
  | { ok: false; report: string }

/** Decode a function_call item into a ToolCall at the API boundary.
 * Undefined when the tool is not one of ours or its arguments are not JSON. */
export const parseToolCall = (name: string, argumentsJson: string): ToolCall | undefined => {
  let args
  try {
    args = JSON.parse(argumentsJson)
  } catch {
    return undefined
  }
  if (name === "edit_harness_source") {
    // SAFETY: the tool is declared `strict: true`, so the Responses API
    // guarantees `arguments` conforms to its JSON schema (every required key
    // present, typed as declared, no extras).
    const call = args as Omit<EditToolCall, "name">
    return { ...call, name }
  }
  if (name === "rewrite_harness_source") {
    // SAFETY: as above — strict-mode arguments conform to the tool's schema.
    const call = args as Omit<RewriteToolCall, "name">
    return { ...call, name }
  }
  return undefined
}

/** Pure patch engine for the agent's tools. Exported for tests: this is
 * the logic that decides whether an LLM edit lands, so it must be exact. */
export const applyPatch = (current: string, call: ToolCall): PatchOutcome => {
  if (call.name === "edit_harness_source") {
    const { old_string, new_string } = call
    const first = current.indexOf(old_string)
    if (first === -1) {
      return { ok: false, report: "old_string not found in source. Re-read the current source and retry with exact text." }
    }
    if (current.indexOf(old_string, first + 1) !== -1) {
      return { ok: false, report: "old_string is not unique. Include more surrounding context to disambiguate." }
    }
    return { ok: true, next: current.slice(0, first) + new_string + current.slice(first + old_string.length) }
  }
  return { ok: true, next: call.source }
}

/** Resolve the tool call's target file and patch it. Pure over the project's
 * files map (exported for tests, like applyPatch): `path` defaults to the
 * entry file; an unknown path is refused with the valid paths named. */
export const applyProjectPatch = (
  files: Readonly<Record<string, string>>,
  call: ToolCall
): ProjectPatchOutcome => {
  const path = call.path ?? ENTRY_FILE
  const current = files[path]
  if (current === undefined) {
    return {
      ok: false,
      report: `Unknown path: ${path}. Valid paths: ${Object.keys(files).join(", ")}`
    }
  }
  const patched = applyPatch(current, call)
  return patched.ok ? { ok: true, path, next: patched.next } : patched
}

/** Apply a tool call, compile-verify it, and return the function output. */
const applyTool = async (
  projectId: string,
  call: ToolCall
): Promise<{ ok: boolean; report: string; result?: CompileResult }> => {
  const patched = applyProjectPatch(getFiles(projectId), call)
  if (!patched.ok) return { ok: false, report: patched.report }
  const { path, next } = patched

  try {
    // Non-entry edits verify with the edited file as the entrypoint (so the
    // user sees the SKU they're editing); entry edits keep the original path.
    const result =
      path === ENTRY_FILE
        ? await compileSource(projectId, next)
        : await compileProjectFile(projectId, path, next)
    // The edit compiles — land it (PRD §12: reviewable, live, rule-checked).
    setFileSource(projectId, path, next)
    return { ok: true, report: diagnosticsReport(result), result }
  } catch (e) {
    return {
      ok: false,
      report: `Source failed to compile (not applied): ${e instanceof Error ? e.message : String(e)}`
    }
  }
}

/**
 * One user turn through the agent loop: stream text, execute tools with
 * compile verification, feed diagnostics back, repeat until the model
 * stops calling tools.
 *
 * `signal` cancels the turn. Abandoning a turn without it (switching
 * projects mid-stream) leaves the request streaming to nowhere and billing
 * tokens, so the caller aborts on unmount and the loop stops between rounds.
 */
export const runAgentTurn = async (
  projectId: string,
  history: ReadonlyArray<ChatTurn>,
  userMessage: string,
  onEvent: (e: AgentEvent) => void,
  onSourceApplied: (result: CompileResult) => void,
  signal?: AbortSignal
): Promise<void> => {
  // Read through a call, not `signal?.aborted` inline: the flag flips during
  // the awaits below, and TS would narrow a direct property check to false.
  const aborted = (): boolean => signal?.aborted === true

  const apiKey = getApiKey()
  if (apiKey === undefined) {
    onEvent({ type: "error", text: "No API key configured." })
    return
  }
  // Lazy-load the SDK: only users of the AI pane ever pay for it.
  const { default: OpenAI } = await import("openai")
  const client = new OpenAI({ apiKey, dangerouslyAllowBrowser: true })

  // First round carries the chat history + fresh source; later rounds ride
  // previous_response_id, sending only the function outputs back.
  let input: ResponseInputItem[] = [
    ...history.map(
      (t): ResponseInputItem => ({ role: t.role, content: t.text || "(applied edits)" })
    ),
    {
      role: "user",
      content: `${userMessage}\n\n<project_files>\n${projectContext(projectId)}\n</project_files>`
    }
  ]
  let previousResponseId: string | undefined

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (aborted()) return
      // openai 6.48.0: request options are the second argument and carry
      // `signal?: AbortSignal` — aborting it tears down the SSE connection
      // (internal/request-options.d.ts).
      const request: ResponseCreateParamsStreaming = {
        model: MODEL,
        instructions: systemPrompt(projectId),
        reasoning: { effort: "medium" },
        max_output_tokens: 16000,
        tools: TOOLS,
        input,
        stream: true
      }
      if (previousResponseId !== undefined) request.previous_response_id = previousResponseId
      const stream = await client.responses.create(request, { signal })

      let finalResponse: Response | undefined
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          onEvent({ type: "text", text: event.delta })
        } else if (event.type === "response.completed") {
          finalResponse = event.response
        } else if (event.type === "response.failed") {
          throw new Error(event.response.error?.message ?? "Response failed")
        }
      }
      // Abandoned mid-stream: don't run this round's tools, which would
      // write patches into a project the user has already left.
      if (aborted()) return
      if (finalResponse === undefined) throw new Error("Stream ended without a completed response")
      previousResponseId = finalResponse.id

      const calls = finalResponse.output.filter((item) => item.type === "function_call")

      if (calls.length === 0) {
        onEvent({ type: "done" })
        return
      }

      const outputs: ResponseInputItem[] = []
      for (const call of calls) {
        if (call.type !== "function_call") continue
        const name = call.name
        onEvent({ type: "tool", tool: { name, status: "running" } })
        const toolCall = parseToolCall(name, call.arguments)
        const outcome =
          toolCall === undefined
            ? { ok: false, report: `Unknown tool or malformed arguments: ${name}` }
            : await applyTool(projectId, toolCall)
        if (outcome.ok && outcome.result !== undefined) {
          onSourceApplied(outcome.result)
          const counts = countDiagnostics(outcome.result.hir.diagnostics)
          onEvent({ type: "compile", compile: counts })
        }
        const detail = outcome.report.split("\n")[0]
        const status = outcome.ok ? "ok" : "failed"
        const tool: ToolEvent = detail === undefined ? { name, status } : { name, status, detail }
        onEvent({ type: "tool", tool })
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: outcome.ok ? outcome.report : `ERROR: ${outcome.report}`
        })
      }
      input = outputs
    }
    onEvent({ type: "error", text: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds without finishing.` })
  } catch (e) {
    const { default: OpenAI } = await import("openai")
    // A deliberate cancellation is not a failure to report.
    if (aborted() || e instanceof OpenAI.APIUserAbortError) return
    if (e instanceof OpenAI.AuthenticationError) {
      onEvent({ type: "error", text: "Invalid API key — check it in the panel header." })
    } else if (e instanceof OpenAI.APIConnectionError) {
      onEvent({
        type: "error",
        text: "Could not reach OpenAI — check your network (or extensions blocking api.openai.com)."
      })
    } else if (e instanceof OpenAI.APIError) {
      onEvent({ type: "error", text: `OpenAI API error ${e.status ?? ""}: ${e.message}` })
    } else {
      onEvent({ type: "error", text: e instanceof Error ? e.message : String(e) })
    }
  }
}

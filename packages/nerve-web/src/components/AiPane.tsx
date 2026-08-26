import { memo, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { setCompileResult } from "../lib/compile-client.js"
import { getApiKey, runAgentTurn, setApiKey, type AgentEvent, type ChatTurn } from "../lib/ai.js"
import { useMinimumLoading } from "../lib/useMinimumLoading.js"
import { Button } from "@/components/ui/button"
/**
 * What the assistant did, in the words a reader would use for it. The model
 * calls these tools `edit_harness_source` and `rewrite_harness_source`; those
 * are function names, and the pane is not the place to read them.
 */
function stepLabel(name: string, status: "running" | "ok" | "failed"): string {
  const verbs =
    name === "edit_harness_source"
      ? (["Editing the harness", "Edited the harness", "Couldn't edit the harness"] as const)
      : name === "rewrite_harness_source"
        ? (["Rewriting the harness", "Rewrote the harness", "Couldn't rewrite the harness"] as const)
        : (["Working on the harness", "Changed the harness", "Couldn't change the harness"] as const)
  return status === "running" ? verbs[0] : status === "ok" ? verbs[1] : verbs[2]
}
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

interface ToolPill {
  readonly name: string
  readonly status: "running" | "ok" | "failed"
  readonly detail?: string
}

interface Message extends ChatTurn {
  readonly id: string
  readonly pills?: ReadonlyArray<ToolPill>
}

// Streaming replaces only the last array element, so memo lets every earlier
// row skip re-rendering on each token.
const MessageRow = memo(function MessageRow({
  message,
  showThinking
}: {
  message: Message
  showThinking: boolean
}) {
  return (
    <div className={`ai-msg ${message.role}`}>
      {message.pills !== undefined && message.pills.length > 0 && (
        <div className="ai-steps">
          {message.pills.map((p, j) => (
            <span key={j} className={`ai-step ${p.status}`} title={p.detail}>
              {stepLabel(p.name, p.status)}
            </span>
          ))}
        </div>
      )}
      {message.text !== "" && <div className="ai-text">{message.text}</div>}
      {message.role === "assistant" && message.text === "" && (message.pills === undefined || message.pills.length === 0) && showThinking && (
        <div className="ai-text thinking">thinking…</div>
      )}
    </div>
  )
})

/**
 * AI copilot pane (datum's chat-pane pattern, PRD §12). Edits the harness
 * through compile-verified tools; the source pane and render pane update
 * live as patches land.
 */
export function AiPane({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const [hasKey, setHasKey] = useState(() => getApiKey() !== undefined)
  const [keyDraft, setKeyDraft] = useState("")
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const showBusy = useMinimumLoading(busy)
  const threadRef = useRef<HTMLDivElement>(null)

  // In-flight turn for this mount. The route keys <AiPane> by projectId, so
  // switching projects unmounts this instance — abort here or the abandoned
  // turn keeps streaming (and billing) with nowhere to land.
  const turnAbort = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      turnAbort.current?.abort()
      turnAbort.current = null
    },
    []
  )

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages])

  const send = () => {
    const text = input.trim()
    if (text === "" || busy) return
    setInput("")
    setBusy(true)
    const controller = new AbortController()
    turnAbort.current = controller
    const history: ChatTurn[] = messages.map((m) => ({ role: m.role, text: m.text }))
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text },
      { id: crypto.randomUUID(), role: "assistant", text: "" }
    ])

    const onEvent = (e: AgentEvent) => {
      // Events can still arrive from an aborted turn (a delta already read
      // off the stream). Drop them rather than touching a dead thread.
      if (controller.signal.aborted) return
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (last === undefined || last.role !== "assistant") return prev
        if (e.type === "text") {
          next[next.length - 1] = { ...last, text: last.text + (e.text ?? "") }
        } else if (e.type === "tool" && e.tool !== undefined) {
          const pills = [...(last.pills ?? [])]
          let idx = -1
          for (let k = pills.length - 1; k >= 0; k--) {
            const candidate = pills[k]
            if (candidate !== undefined && candidate.name === e.tool.name && candidate.status === "running") {
              idx = k
              break
            }
          }
          const { name, status, detail } = e.tool
          const pill: ToolPill = detail === undefined ? { name, status } : { name, status, detail }
          if (e.tool.status === "running" || idx === -1) pills.push(pill)
          else pills[idx] = pill
          next[next.length - 1] = { ...last, pills }
        } else if (e.type === "error") {
          next[next.length - 1] = { ...last, text: `${last.text}\n\n⚠ ${e.text ?? "error"}`.trim() }
        }
        return next
      })
      if (e.type === "done" || e.type === "error") setBusy(false)
      // A failed turn gives the prompt back for editing and resend, unless
      // the user already started typing something new.
      if (e.type === "error") setInput((current) => (current === "" ? text : current))
    }

    void runAgentTurn(
      projectId,
      history,
      text,
      onEvent,
      (result) => {
        // Land the verified compile in the shared cache: diagram, tables and
        // diagnostics all update live, exactly like a manual editor compile.
        if (controller.signal.aborted) return
        setCompileResult(queryClient, projectId, result)
      },
      controller.signal
    )
  }

  if (!hasKey) {
    return (
      <div className="ai-pane">
        <div className="ai-setup">
          <span className="spec-tag">Assistant</span>
          <p>
            Describe the harness and the assistant writes the source for it. Every change is
            compiled and checked before it lands, and you review the harness it produces.
            Requests go directly from your browser to OpenAI. The key is stored locally and
            sent nowhere else.
          </p>
          <Input
            type="password"
            placeholder="sk-…"
            aria-label="OpenAI API key"
            className="h-9 text-sm"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && keyDraft.startsWith("sk-")) {
                setApiKey(keyDraft)
                setHasKey(true)
              }
            }}
          />
          <Button
            size="xs"
            disabled={!keyDraft.startsWith("sk-")}
            onClick={() => {
              setApiKey(keyDraft)
              setHasKey(true)
            }}
          >
            Save key
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="ai-pane">
      <div className="ai-header">
        <span className="spec-tag">Assistant</span>
        <Button
          variant="ghost"
          size="xs"
          className="h-auto p-0 text-[11px]"
          onClick={() => {
            setApiKey("")
            setHasKey(false)
          }}
        >
          Forget key
        </Button>
      </div>
      <div className="ai-thread" ref={threadRef}>
        {messages.length === 0 && (
          <p className="ai-hint">
            Ask for harness changes in plain language — “add a third sensor on the CAN bus”,
            “swap W2 to 18AWG and fix whatever breaks”. Every edit is compiled and rule-checked
            before it lands; watch the diagram update live.
          </p>
        )}
        {messages.map((m, i) => (
          <MessageRow key={m.id} message={m} showThinking={showBusy && i === messages.length - 1} />
        ))}
      </div>
      <div className="ai-input">
        <Textarea
          rows={2}
          className="min-h-0 flex-1 resize-none px-2.5 py-1.5 text-sm leading-snug"
          aria-label="Describe a change"
          placeholder={busy ? "Working…" : "Describe a change…"}
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <Button size="xs" disabled={busy || input.trim() === ""} onClick={send}>
          {busy ? "…" : "Send"}
        </Button>
      </div>
    </div>
  )
}

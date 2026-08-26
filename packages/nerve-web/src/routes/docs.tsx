import { useEffect, useRef, useState } from "react"
import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider
} from "@/components/ui/sidebar"
import { cn } from "../lib/utils.js"

export const Route = createFileRoute("/docs")({
  component: DocsLayout
})

type DocPath = "/docs" | "/docs/dsl" | "/docs/sdk" | "/docs/rules" | "/docs/hir" | "/docs/library" | "/docs/cli" | "/docs/artifacts" | "/docs/ai" | "/docs/lifecycle"
interface DocItem {
  readonly to: DocPath
  readonly label: string
  readonly exact?: boolean
}
interface DocGroup {
  readonly label: string
  readonly items: ReadonlyArray<DocItem>
}

// Diátaxis grouping: learning, reference, and explanation read differently —
// the nav says which mode each page is in.
const GROUPS: ReadonlyArray<DocGroup> = [
  { label: "Learn", items: [{ to: "/docs", label: "Quickstart", exact: true }] },
  {
    label: "Reference",
    items: [
      { to: "/docs/dsl", label: "DSL" },
      { to: "/docs/sdk", label: "TypeScript SDK" },
      { to: "/docs/rules", label: "Validation Rules" },
      { to: "/docs/hir", label: "HIR Schema" },
      { to: "/docs/library", label: "Part Library" },
      { to: "/docs/cli", label: "CLI" },
      { to: "/docs/artifacts", label: "Artifacts" }
    ]
  },
  {
    label: "Concepts",
    items: [
      { to: "/docs/ai", label: "AI Copilot" },
      { to: "/docs/lifecycle", label: "Production Lifecycle" }
    ]
  }
]

const FLAT = GROUPS.flatMap((g) => g.items)

// Route path → agent-readable markdown mirror (generated at build).
const MD_SLUGS: Record<string, string> = {
  "/docs": "quickstart",
  "/docs/dsl": "dsl",
  "/docs/sdk": "sdk",
  "/docs/rules": "rules",
  "/docs/hir": "hir",
  "/docs/library": "library",
  "/docs/cli": "cli",
  "/docs/artifacts": "artifacts",
  "/docs/ai": "ai",
  "/docs/lifecycle": "lifecycle"
}

/** Copy the page's agent-readable markdown mirror to the clipboard. */
function CopyMarkdown({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const copy = async () => {
    try {
      const res = await fetch(`/docs/${slug}.md`)
      await navigator.clipboard.writeText(await res.text())
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard denied or fetch failed — the View link still works
    }
  }

  return (
    <Button variant="ghost" size="xs" className="docs-action" onClick={() => void copy()}>
      {copied ? "Copied ✓" : "Copy Markdown"}
    </Button>
  )
}

/** Fumadocs-style AI page actions: hand this page to an assistant. */
function AiActions({ slug }: { slug: string }) {
  const mdUrl = `${window.location.origin}/docs/${slug}.md`
  const q = encodeURIComponent(`Read ${mdUrl} so I can ask questions about it.`)
  return (
    <>
      <Button variant="ghost" size="xs" className="docs-action" asChild>
        <a href={`https://claude.ai/new?q=${q}`} target="_blank" rel="noreferrer">
          Open in Claude
        </a>
      </Button>
      <span className="sep">/</span>
      <Button variant="ghost" size="xs" className="docs-action" asChild>
        <a href={`https://chatgpt.com/?hints=search&q=${q}`} target="_blank" rel="noreferrer">
          Open in ChatGPT
        </a>
      </Button>
    </>
  )
}

function DocsLayout() {
  const { pathname } = useLocation()
  const path = pathname.replace(/\/$/, "") || "/docs"
  const slug = MD_SLUGS[path]
  const idx = FLAT.findIndex((i) => i.to === path)
  const prev = idx > 0 ? FLAT[idx - 1] : undefined
  const next = idx >= 0 && idx < FLAT.length - 1 ? FLAT[idx + 1] : undefined
  const bodyRef = useRef<HTMLElement>(null)

  // Per-code-block copy buttons (Fumadocs CodeBlock pattern, minimal voice).
  useEffect(() => {
    const body = bodyRef.current
    if (body === null) return
    const buttons: HTMLButtonElement[] = []
    for (const pre of body.querySelectorAll("pre")) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.className = cn(buttonVariants({ variant: "ghost", size: "xs" }), "pre-copy")
      btn.textContent = "Copy"
      btn.addEventListener("click", () => {
        void navigator.clipboard.writeText(pre.textContent ?? "").then(() => {
          btn.textContent = "Copied ✓"
          setTimeout(() => (btn.textContent = "Copy"), 2000)
        })
      })
      pre.appendChild(btn)
      buttons.push(btn)
    }
    return () => buttons.forEach((b) => b.remove())
  }, [pathname])

  return (
    <div className="docs">
      {/* shadcn sidebar, embedded (collapsible="none") inside the docs
          split rather than fixed to the viewport: the app shell already
          owns the frame, and the docs column scrolls on its own. */}
      <SidebarProvider className="docs-sidebar-provider">
        <Sidebar collapsible="none" className="docs-nav">
          <SidebarContent>
            {GROUPS.map((group) => (
              <SidebarGroup key={group.label}>
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {group.items.map((item) => (
                      <SidebarMenuItem key={item.to}>
                        <SidebarMenuButton asChild isActive={path === item.to}>
                          <Link to={item.to} activeOptions={{ exact: item.exact === true }}>
                            {item.label}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>
          <SidebarFooter>
            <a className="docs-llms" href="/llms.txt">
              llms.txt
            </a>
          </SidebarFooter>
        </Sidebar>
      </SidebarProvider>
      <article className="docs-body" ref={bodyRef}>
        <div className="docs-content">
        {slug !== undefined && (
          <div className="docs-md-actions">
            <CopyMarkdown slug={slug} />
            <span className="sep">/</span>
            <Button variant="ghost" size="xs" className="docs-action" asChild>
              <a href={`/docs/${slug}.md`}>View Markdown</a>
            </Button>
            <span className="sep">/</span>
            <AiActions slug={slug} />
          </div>
        )}
        <Outlet />
        <footer className="docs-pager">
          {prev !== undefined ? (
            <Link to={prev.to} className="pager-link prev">
              <span className="pager-dir">← Previous</span>
              {prev.label}
            </Link>
          ) : (
            <span />
          )}
          {next !== undefined ? (
            <Link to={next.to} className="pager-link next">
              <span className="pager-dir">Next →</span>
              {next.label}
            </Link>
          ) : (
            <span />
          )}
        </footer>
        </div>
      </article>
    </div>
  )
}

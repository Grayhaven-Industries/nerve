import { createFileRoute, Link, notFound, Outlet, retainSearchParams } from "@tanstack/react-router"
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels"
import { useSuspenseQuery } from "@tanstack/react-query"
import { compileQueryOptions, exportPacket } from "../lib/compile-client.js"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SearchBox } from "../components/SearchBox.js"
import { DiagnosticsPanel } from "../components/DiagnosticsPanel.js"
import { SourcePane } from "../components/SourcePane.js"
import { RenderErrorBoundary } from "../components/RenderErrorBoundary.js"
import { AiPane } from "../components/AiPane.js"
import { useIsDirty } from "../lib/useSources.js"
import { useMediaQuery } from "../lib/useMediaQuery.js"
import { projectMeta } from "../lib/projects.js"
import { announce } from "../lib/announce.js"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

export const Route = createFileRoute("/projects/$projectId")({
  search: {
    // Sorting a table then visiting Diagram and back keeps the sort.
    middlewares: [retainSearchParams(["sortBy", "desc"])]
  },
  beforeLoad: ({ params }) => {
    if (projectMeta(params.projectId) === undefined) throw notFound()
  },
  head: ({ params }) => ({ meta: [{ title: `${params.projectId} · Grayhaven Nerve` }] }),
  // Intent preloading (hover a project card) compiles in the worker
  // before the click; staleTime: Infinity makes the preload stick.
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(compileQueryOptions(params.projectId)),
  pendingComponent: () => <div className="status">Compiling…</div>,
  errorComponent: ({ error }) => (
    <Empty className="app-status app-status--error">
        <EmptyHeader>
          <EmptyTitle>This harness didn&rsquo;t compile</EmptyTitle>
          <EmptyDescription>The compiler stopped before it produced a result, so there is nothing to show yet. Edit
        the source and it will retry, or open another harness.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <span className="status-cause">{String(error)}</span>
<Button variant="secondary" size="xs" onClick={() => window.location.reload()}>
          Retry
        </Button>
        <Button variant="outline" size="xs" asChild>
          <Link to="/projects">All harnesses</Link>
        </Button>
        </EmptyContent>
      </Empty>
  ),
  // Not an error state: nothing broke, the address just doesn't name
  // anything. The red heading belongs to failures.
  notFoundComponent: () => (
    <Empty className="app-status">
        <EmptyHeader>
          <EmptyTitle>No harness by that name</EmptyTitle>
          <EmptyDescription>The link may be out of date, or the harness was opened from a share link that this
        browser no longer holds.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
<Button variant="secondary" size="xs" asChild>
          <Link to="/projects">All harnesses</Link>
        </Button>
        </EmptyContent>
      </Empty>
  ),
  component: ProjectWorkspace
})

// PRD §11.1 split workspace: source on the left, the selected render view
// on the right. Tabs switch only the right pane.
const TABS = [
  { to: "/projects/$projectId/diagram", label: "Diagram" },
  { to: "/projects/$projectId/connectors", label: "Connectors" },
  { to: "/projects/$projectId/board", label: "Board" },
  { to: "/projects/$projectId/bom", label: "BOM" },
  { to: "/projects/$projectId/cut-list", label: "Cut list" },
  { to: "/projects/$projectId/labels", label: "Labels" },
  { to: "/projects/$projectId/tests", label: "Tests" },
  // Not artifacts like the tabs above: these two say how close the design came
  // to failing, and what the verdict rests on.
  { to: "/projects/$projectId/margins", label: "Margins" },
  { to: "/projects/$projectId/provenance", label: "Provenance" }
] as const

function ExportButton({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [cause, setCause] = useState<string | undefined>(undefined)
  const run = async () => {
    setBusy(true)
    setFailed(false)
    try {
      const zip = await exportPacket(projectId)
      const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: "application/zip" }))
      const a = document.createElement("a")
      a.href = url
      a.download = `${projectId}-packet.zip`
      a.click()
      URL.revokeObjectURL(url)
      announce("Packet downloaded.")
    } catch (error) {
      // Was a bare `catch {}`: the real cause was discarded, so an export
      // failure was undiagnosable from the console or a bug report.
      console.error("Export packet failed", error)
      setCause(error instanceof Error ? error.message : String(error))
      setFailed(true)
      announce("Export failed.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Button variant="secondary" size="xs" disabled={busy} onClick={() => void run()}>
        {busy ? "Exporting…" : "Export packet"}
      </Button>
      {failed && (
        <span className="compile-error" title={cause}>
          Export failed. Try again.
        </span>
      )}
    </>
  )
}

/** Copy a zero-backend share link: the source gzipped into the fragment. */
function ShareButton({ projectId }: { projectId: string }) {
  const [copied, setCopied] = useState(false)
  const [fallbackUrl, setFallbackUrl] = useState<string | undefined>(undefined)
  const run = async () => {
    const [{ shareUrl }, { getFiles }] = await Promise.all([
      import("../lib/share.js"),
      import("../lib/sources.js")
    ])
    // Encode the whole project so multi-file projects don't lose their
    // extra files; single-entry projects still get a compact v1 link.
    const url = shareUrl(getFiles(projectId))
    try {
      await navigator.clipboard.writeText(url)
      setFallbackUrl(undefined)
      setCopied(true)
      announce("Share link copied to clipboard.")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Safari can reject writeText once the user-gesture window expires
      // during the awaits above; show the link for manual copy instead.
      setFallbackUrl(url)
      // This branch is the one a screen-reader user is most likely to hit and
      // least likely to notice: the button label does not change, and a new
      // input simply appears.
      announce("Couldn't copy automatically. A share link field is now shown — copy it manually.")
    }
  }
  return (
    <>
      <Button variant="secondary" size="xs" onClick={() => void run()}>
        {copied ? "Link copied ✓" : "Share"}
      </Button>
      {fallbackUrl !== undefined && (
        <Input
          readOnly
          value={fallbackUrl}
          aria-label="Share link"
          className="h-7 w-56 text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </>
  )
}

/** Tab strip with a hover pill that slides between tabs (hover as preview). */
function WorkspaceTabs({ projectId }: { projectId: string }) {
  const listRef = useRef<HTMLElement>(null)
  const [hover, setHover] = useState<{ x: number; w: number } | null>(null)
  const onEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const list = listRef.current
    if (list === null) return
    const item = e.currentTarget.getBoundingClientRect()
    setHover({ x: item.left - list.getBoundingClientRect().left, w: item.width })
  }
  return (
    <nav className="tabs" ref={listRef} onMouseLeave={() => setHover(null)}>
      {hover !== null && (
        <span
          className="tab-hover-pill"
          style={{ translate: `${hover.x}px 0`, width: hover.w }}
          aria-hidden="true"
        />
      )}
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          params={{ projectId }}
          activeProps={{ className: "active" }}
          onMouseEnter={onEnter}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}

// Three side-by-side panes need ~820px before the assistant is narrower than
// its own hint text. Below that the split stacks instead of squeezing: one
// switch at a named threshold, not three panes trying to stay fluid.
const STACK_WORKSPACE_BELOW = "(max-width: 820px)"

function ProjectWorkspace() {
  const { projectId } = Route.useParams()
  const stacked = useMediaQuery(STACK_WORKSPACE_BELOW)
  // Separate ids: sizes saved for a row of panes are meaningless as a column.
  const workspaceLayout = useDefaultLayout({
    id: stacked ? "nerve-workspace-3-stacked" : "nerve-workspace-3",
    panelIds: ["ai", "source", "render"]
  })
  const { data } = useSuspenseQuery(compileQueryOptions(projectId))
  const dirty = useIsDirty(projectId)

  return (
    <div className="workspace">
      <div className="workspace-header">
        <h2>
          {data.hir.harness.id}
          {dirty ? " •" : ""}
        </h2>
        <span className="meta">rev {data.hir.harness.revision}</span>
        <SearchBox hir={data.hir} projectId={projectId} />
        <ShareButton projectId={projectId} />
        <ExportButton projectId={projectId} />
        <WorkspaceTabs projectId={projectId} />
      </div>
      {/* Datum-style resizable split; layout persisted to localStorage. */}
      <Group
        key={stacked ? "stacked" : "split"}
        orientation={stacked ? "vertical" : "horizontal"}
        className={stacked ? "workspace-split workspace-split-stacked" : "workspace-split"}
        {...workspaceLayout}
      >
        <Panel
          id="ai"
          defaultSize={stacked ? "26%" : "22%"}
          minSize={stacked ? "150px" : "220px"}
          maxSize={stacked ? "50%" : "34%"}
          collapsible
        >
          {/*
            Keyed by projectId: a project switch remounts the pane with fresh
            state instead of re-seeding it in an effect, so an in-flight turn
            can never append the old project's tokens to the new thread.
            Each pane owns its boundary — a crash in one leaves the others
            (and the editor's unsaved work) usable, which is the whole point
            of RenderErrorBoundary.
          */}
          <RenderErrorBoundary resetKey={projectId}>
            <AiPane key={projectId} projectId={projectId} />
          </RenderErrorBoundary>
        </Panel>
        <Separator className="pane-handle" />
        <Panel
          id="source"
          defaultSize={stacked ? "37%" : "38%"}
          minSize={stacked ? "140px" : "300px"}
          maxSize={stacked ? "60%" : "60%"}
          collapsible
        >
          {/* Keyed for the same reason: fresh state on mount beats an effect
              that re-seeds after commit and paints one stale frame first. */}
          <RenderErrorBoundary resetKey={projectId}>
            <SourcePane key={projectId} projectId={projectId} />
          </RenderErrorBoundary>
        </Panel>
        <Separator className="pane-handle" />
        <Panel id="render" minSize={stacked ? "160px" : "25%"}>
          <div className="render-pane">
            <RenderErrorBoundary resetKey={projectId}>
              <Outlet />
            </RenderErrorBoundary>
          </div>
        </Panel>
      </Group>
      <RenderErrorBoundary resetKey={projectId}>
        <DiagnosticsPanel diagnostics={data.hir.diagnostics} />
      </RenderErrorBoundary>
    </div>
  )
}

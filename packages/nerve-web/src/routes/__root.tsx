import { useEffect } from "react"
import {
  createRootRouteWithContext,
  HeadContent,
  Link,
  Outlet,
  type ErrorComponentProps
} from "@tanstack/react-router"
import type { QueryClient } from "@tanstack/react-query"
import { warmCompiler } from "../lib/compile-client.js"
import { docsUrl } from "../lib/site.js"
import { Button } from "@/components/ui/button"
import { CommandPalette } from "../components/CommandPalette.js"
import { LiveRegion } from "../lib/announce.js"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({ meta: [{ title: "Grayhaven Nerve — Harnesses as code" }] }),
  component: RootLayout,
  errorComponent: RootError
})

/** The Grayhaven shield mark (from public/icon.svg), inheriting currentColor. */
function GrayhavenMark() {
  return (
    <svg viewBox="0 0 2048 2048" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="m 1032.31,1996.09 c -10.36,-9.39 -75.43,-67.83 -163.14,-146.53 -71.23,-63.91 -124.05,-111.51 -132.97,-119.82 -4.9,-4.57 -46.67,-42.31 -92.82,-83.86 -46.15,-41.56 -98.28,-88.62 -115.84,-104.59 -17.56,-15.97 -62.01,-56.07 -98.76,-89.12 -36.76,-33.05 -99.41,-89.41 -139.23,-125.25 l -72.4,-65.16 V 654.46 47.16 H 396.84 576.54 V 200.88 354.59 H 721.35 866.15 V 200.88 47.16 h 178.96 178.96 V 200.88 354.59 h 144.06 144.06 V 200.88 47.16 h 179.71 179.71 V 655.23 1263.3 l -4.24,3.45 c -2.33,1.9 -24.22,21.51 -48.64,43.59 -53.73,48.58 -195.7,176.32 -302.83,272.48 -150.1,134.74 -166.76,149.69 -245.79,220.7 -106.05,95.29 -215.08,192.77 -224.39,200.61 -2.04,1.72 -3.83,0.65 -13.42,-8.05 z m 83.42,-579.84 c 151.43,-137.74 236,-215.27 348.08,-319.09 26.88,-24.9 51.44,-47.5 54.58,-50.22 l 5.7,-4.94 V 833.44 c 0,-114.7 -0.4,-208.55 -0.9,-208.55 -0.49,0 -4.34,3.11 -8.54,6.92 -4.2,3.81 -42.4,38.04 -84.87,76.06 -42.48,38.03 -99.95,89.58 -127.72,114.55 -27.77,24.98 -76.89,69.05 -109.16,97.95 -32.27,28.9 -76.71,68.7 -98.76,88.46 -22.05,19.76 -42.54,38.04 -45.53,40.62 l -5.43,4.7 -98.54,-88.62 C 890.44,916.81 816.03,849.8 779.29,816.63 613.83,667.31 569.52,627.56 566.52,625.81 c -1.48,-0.87 -1.86,41.02 -1.86,207.4 v 208.49 l 29.98,27.37 c 57.24,52.27 69.73,63.71 211.3,193.71 78.28,71.88 147.12,135.04 152.97,140.35 5.85,5.31 27.18,24.86 47.39,43.44 20.21,18.58 37.24,33.79 37.84,33.79 0.6,0 32.81,-28.85 71.58,-64.11 z" />
    </svg>
  )
}

/** The GitHub mark (octicon mark-github path). */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function RootError({ error, reset }: ErrorComponentProps) {
  return (
    <Empty className="app-status app-status--error">
        <EmptyHeader>
          <EmptyTitle>Something broke on this page</EmptyTitle>
          <EmptyDescription>Nothing was lost — harnesses are held in this browser, not on a server. Try again, and
        reload if it keeps happening.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <span className="status-cause">{error instanceof Error ? error.message : String(error)}</span>
<Button variant="secondary" size="xs" onClick={() => reset()}>
          Try again
        </Button>
        <Button variant="outline" size="xs" onClick={() => window.location.reload()}>
          Reload
        </Button>
        </EmptyContent>
      </Empty>
  )
}

function RootLayout() {
  useEffect(() => {
    if ("requestIdleCallback" in window) {
      const id = requestIdleCallback(() => warmCompiler())
      return () => cancelIdleCallback(id)
    }
    const id = setTimeout(warmCompiler, 2000)
    return () => clearTimeout(id)
  }, [])

  return (
    <TooltipProvider>
      <div className="app-shell">
        <HeadContent />
        <header className="topbar">
          <Link to="/" className="brand" aria-label="Grayhaven Nerve home">
            <GrayhavenMark />
            <span className="brand-label">Grayhaven Nerve</span>
          </Link>
          {/* React 19.2.8 renders aria-label on nav; TanStack Router
              1.170.27 keeps the Link anchors and routes unchanged. */}
          <nav className="topnav" aria-label="Primary">
            <Link to="/showcase" activeProps={{ className: "active" }}>
              Showcase
            </Link>
            <Link to="/projects" activeProps={{ className: "active" }}>
              Projects
            </Link>
            {/* Docs are a separate deployment; this leaves the app. */}
            <a href={docsUrl("/docs")} target="_blank" rel="noreferrer">
              Docs
            </a>
            {/* The one icon-only control in the chrome. aria-label already
                named it for assistive tech; the tooltip is what tells a
                sighted user what the glyph does. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <a
                  className="gh-link"
                  href="https://github.com/tylergibbs1/nerve"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub repository"
                >
                  <GitHubMark />
                </a>
              </TooltipTrigger>
              <TooltipContent>GitHub repository</TooltipContent>
            </Tooltip>
          </nav>
        </header>
        <main className="app-main">
          <Outlet />
        </main>
        <CommandPalette />
        {/* One live region for the whole app; see lib/announce.tsx. */}
        <LiveRegion />
      </div>
    </TooltipProvider>
  )
}

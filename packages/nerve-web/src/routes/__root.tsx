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
      <path d="m 1032.3054,1996.0867 c -10.3587,-9.3875 -75.42932,-67.8323 -163.14073,-146.5292 -71.23239,-63.9115 -124.04939,-111.5064 -132.96726,-119.8204 -4.90106,-4.5692 -46.67152,-42.3081 -92.82322,-83.864 -46.15171,-41.556 -98.28123,-88.6197 -115.84338,-104.586 -17.56216,-15.9663 -62.00591,-56.0714 -98.76397,-89.1221 -36.75799,-33.0507 -99.41367,-89.4129 -139.23483,-125.2491 l -72.40212,-65.1566 V 654.46082 47.162334 H 396.83565 576.54147 V 200.87759 354.59285 H 721.3457 866.14992 V 200.87759 47.162334 h 178.96318 178.9631 V 200.87759 354.59285 h 144.0616 144.0617 V 200.87759 47.162334 h 179.7057 179.7059 V 655.23244 1263.3025 l -4.2378,3.4493 c -2.3307,1.8972 -24.2184,21.5143 -48.6392,43.5937 -53.734,48.5819 -195.6954,176.3177 -302.8302,272.4842 -150.1035,134.7363 -166.758,149.691 -245.7873,220.7016 -106.0505,95.29 -215.0847,192.7685 -224.3868,200.6054 -2.0396,1.7186 -3.8293,0.6454 -13.4244,-8.05 z m 83.4179,-579.8437 c 151.4262,-137.7376 236.0048,-215.2719 348.0761,-319.0851 26.8833,-24.9024 51.4443,-47.5013 54.58,-50.2195 l 5.7014,-4.9425 V 833.44492 c 0,-114.70296 -0.403,-208.55084 -0.8956,-208.55084 -0.4926,0 -4.3356,3.11465 -8.5398,6.92145 -4.2042,3.8068 -42.397,38.03507 -84.873,76.06281 -42.4758,38.02775 -99.9519,89.5767 -127.7246,114.55314 -27.7727,24.97657 -76.8948,69.05364 -109.1601,97.94899 -32.2654,28.89535 -76.7091,68.70159 -98.764,88.45823 -22.0547,19.7567 -42.5417,38.0376 -45.5264,40.6243 l -5.427,4.7031 -98.53516,-88.61785 C 890.4408,916.80849 816.034,849.79577 779.2867,816.63113 613.83473,667.3098 569.51512,627.56131 566.51656,625.80566 c -1.4816,-0.86738 -1.85646,41.0207 -1.85646,207.39881 v 208.48593 l 29.97877,27.3728 c 57.24297,52.2668 69.72614,63.711 211.29997,193.712 78.28145,71.8824 147.11916,135.0393 152.97282,140.3488 5.85365,5.3095 27.17893,24.8581 47.38954,43.4411 20.2109,18.5833 37.2406,33.7878 37.8439,33.7878 0.6035,0 32.8138,-28.8494 71.5782,-64.1099 z" />
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
          <nav className="topnav">
            <Link to="/showcase" activeProps={{ className: "active" }}>
              Showcase
            </Link>
            <Link to="/projects" activeProps={{ className: "active" }}>
              Projects
            </Link>
            <Link to="/docs" activeProps={{ className: "active" }}>
              Docs
            </Link>
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

/**
 * Global ⌘K command palette — navigation only (v1). Owns its open state and
 * renders through shadcn's CommandDialog, so the focus trap, scroll lock,
 * scrim and Escape-to-close come from Radix Dialog instead of hand-rolled
 * markup. cmdk does the filtering.
 *
 * Escape no longer fights the Inspector: the palette autofocuses its input,
 * and Inspector.tsx ignores Escape whose target is an INPUT.
 *
 * Verified against the versions in this project: react 19.1, cmdk 1.1.1,
 * radix-ui 1.6.2 (Dialog), shadcn 4.13.1 (nova preset).
 */
import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Command, CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { docsUrl } from "../lib/site.js"

const PAGES = [
  { label: "Home", to: "/" },
  { label: "Projects", to: "/projects" },
  { label: "Showcase", to: "/showcase" }
] as const

const WORKSPACES = [
  { label: "Motor controller", projectId: "motor-controller" },
  { label: "Sensor splice", projectId: "sensor-splice" },
  { label: "Robot platform", projectId: "robot-platform" }
] as const

// The docs are a separate deployment, so these leave the app. Paths mirror
// the sidebar in docs/content/docs.
const DOCS = [
  { label: "Quickstart", path: "/docs/quickstart" },
  { label: "DSL", path: "/docs/reference/dsl" },
  { label: "TypeScript SDK", path: "/docs/reference/sdk" },
  { label: "Validation rules", path: "/docs/reference/rules" },
  { label: "HIR schema", path: "/docs/reference/hir" },
  { label: "Part library", path: "/docs/reference/parts" },
  { label: "CLI", path: "/docs/reference/cli" },
  { label: "Artifacts", path: "/docs/reference/artifacts" },
  { label: "Production lifecycle", path: "/docs/concepts/production-lifecycle" },
  { label: "Troubleshooting", path: "/docs/troubleshooting" }
] as const

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  const close = () => setOpen(false)

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      // Renders as a visually hidden DialogTitle/DialogDescription pair, so the
      // dialog keeps the accessible name the old aria-label carried.
      title="Command palette"
      description="Search pages, workspaces and docs."
      className="sm:max-w-[560px]"
    >
      <Command label="Command palette">
        <CommandInput autoFocus placeholder="Where to?" className="h-9 text-sm" />
        <CommandList>
          <CommandEmpty>No matches.</CommandEmpty>
          {PAGES.map((p) => (
            <CommandItem
              key={p.to}
              value={p.label}
              onSelect={() => {
                void navigate({ to: p.to })
                close()
              }}
            >
              {p.label}
            </CommandItem>
          ))}
          {WORKSPACES.map((w) => (
            <CommandItem
              key={w.projectId}
              value={w.label}
              onSelect={() => {
                void navigate({
                  to: "/projects/$projectId/diagram",
                  params: { projectId: w.projectId }
                })
                close()
              }}
            >
              {w.label}
            </CommandItem>
          ))}
          {DOCS.map((d) => (
            <CommandItem
              key={d.path}
              value={d.label}
              onSelect={() => {
                window.open(docsUrl(d.path), "_blank", "noopener,noreferrer")
                close()
              }}
            >
              {d.label}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

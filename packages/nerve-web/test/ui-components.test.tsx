// @vitest-environment jsdom
/**
 * DOM component tests for the ported design-system primitives: variants
 * must produce the doctrine classes, asChild must merge onto the child,
 * and disabled semantics must be real DOM semantics (not just styling).
 */
import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { Button } from "../src/components/ui/button"
import { Input } from "../src/components/ui/input"

describe("Button", () => {
  it("renders a real button with variant + size classes", () => {
    render(<Button variant="outline" size="xs">Export</Button>)
    const el = screen.getByRole("button", { name: "Export" })
    expect(el.tagName).toBe("BUTTON")
    expect(el.className).toContain("border")
    expect(el.className).toContain("text-xs")
  })

  it("asChild merges button styling onto the child element", () => {
    render(
      <Button asChild variant="ghost" size="xs">
        <a href="/docs">Docs</a>
      </Button>
    )
    const link = screen.getByRole("link", { name: "Docs" })
    expect(link.tagName).toBe("A")
    expect(link.className).toContain("inline-flex")
  })

  it("disabled is a DOM attribute, not just paint", () => {
    render(<Button disabled>Busy</Button>)
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Busy" }).disabled).toBe(true)
  })
})

describe("Input", () => {
  it("renders an accessible input with the shared field classes", () => {
    render(<Input aria-label="api key" placeholder="sk-ant-…" />)
    const el = screen.getByLabelText("api key")
    expect(el.tagName).toBe("INPUT")
    expect(el.className).toContain("border")
  })
})

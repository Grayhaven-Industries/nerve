/**
 * Accessibility audit (axe-core): serious/critical violations are release
 * blockers on the public surfaces. Monochrome-on-black is doctrine, so
 * contrast findings matter here more than most apps.
 */
import AxeBuilder from "@axe-core/playwright"
import { expect, test } from "@playwright/test"

const PAGES = ["/", "/showcase", "/projects", "/docs/quickstart", "/projects/motor-controller/diagram"]

for (const path of PAGES) {
  test(`axe: ${path} has no serious/critical violations`, async ({ page }) => {
    await page.goto(path)
    await page.waitForLoadState("networkidle")
    // @axe-core/playwright 4.13.0: analyze() audits the full document, including
    // the CodeMirror scroller; no accessibility exception is retained.
    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    )
    expect(
      blocking.map((v) => `${v.id}: ${v.help} (${v.nodes.length} nodes)`),
      JSON.stringify(blocking, null, 2).slice(0, 2000)
    ).toEqual([])
  })
}

test("project workspace exposes accessible editor and page structure", async ({ page }) => {
  await page.goto("/projects/motor-controller/diagram")
  await page.waitForLoadState("networkidle")

  // @playwright/test 1.62.1: role locators query the computed accessibility tree.
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(1)
  await expect(page.getByRole("navigation", { name: "Project views" })).toHaveCount(1)
  await expect(page.locator(".workspace-header h1")).toHaveCount(1)
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1)

  const scroller = page.locator(".cm-scroller")
  await expect(scroller).toHaveAttribute("tabindex", "0")
  await expect(scroller).toHaveAttribute("role", "region")
  await expect(scroller).toHaveAttribute("aria-label", "Harness source scroll area")
  await scroller.focus()
  await expect(scroller).toBeFocused()

  const editor = page.getByRole("textbox", { name: /Harness source/ })
  await editor.click()
  await expect(editor).toBeFocused()

  const contrast = await page.locator(".cm-gutterElement").first().evaluate((lineNumber) => {
    const channels = (value: string) =>
      (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const luminance = (value: string) => {
      const [red = 0, green = 0, blue = 0] = channels(value).map((channel) => {
        const normalized = channel / 255
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    const foreground = luminance(getComputedStyle(lineNumber).color)
    const gutters = lineNumber.closest(".cm-gutters")
    if (!(gutters instanceof HTMLElement)) throw new Error("CodeMirror gutters not found")
    const background = luminance(getComputedStyle(gutters).backgroundColor)
    return (Math.max(foreground, background) + 0.05) /
      (Math.min(foreground, background) + 0.05)
  })
  expect(contrast).toBeGreaterThanOrEqual(4.5)
})

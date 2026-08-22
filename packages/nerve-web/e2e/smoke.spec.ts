/**
 * E2E smoke: the flows a release must never break, exercised against the
 * real production bundle (worker compile, router, editor).
 */
import { expect, test } from "@playwright/test"

test("landing -> projects -> workspace compiles and renders the schematic", async ({ page }) => {
  await page.goto("/projects")
  await page.locator(".project-card", { hasText: "Motor Controller" }).click()
  // Worker compile lands: status line + diagram SVG from the exporter.
  await expect(page.locator(".toolbar-status")).toContainText(/0 error/i, { timeout: 15_000 })
  await expect(page.locator(".diagram-pane svg")).toBeVisible()
  await expect(page.locator("[data-wire]").first()).toBeAttached()
})

test("rover proof imports real WireViz data and exposes Nerve's review delta", async ({ page }) => {
  await page.goto("/showcase")
  await expect(page.getByRole("heading", { name: /Rover harness review/i })).toBeVisible()
  await expect(page.locator(".showcase-review-head")).toContainText("6 conductors · 53 checks")
  await expect(page.locator(".showcase-review-head")).toContainText("Blocked")
  await expect(page.locator(".showcase-findings .showcase-finding")).toHaveCount(2)
  await page.getByText("Inspect design", { exact: true }).click()
  await expect(page.locator(".showcase-wire-table tbody tr")).toHaveCount(6)
  await expect(page.locator(".showcase-wire-table")).toContainText("540 mm")
  await expect(page.locator(".showcase-wire-table")).toContainText("530 mm")

  await page.getByLabel("Harness").selectOption({ label: "Front servo" })
  await expect(page.getByLabel("Harness")).toHaveValue("front-servo")
  await expect(page.locator(".showcase-review-head")).toContainText("Clear")
  await expect(page.locator(".showcase-wire-table tbody tr")).toHaveCount(3)

  await page.getByLabel("Harness").selectOption({ label: "Middle encoder" })
  await expect(page.locator(".showcase-review-head")).toContainText("Blocked")
})

test("rover showcase downloads a generated packet", async ({ page }) => {
  await page.goto("/showcase")
  await page.getByText("Inspect design", { exact: true }).click()
  const download = page.waitForEvent("download", { timeout: 30_000 })
  await page.getByRole("button", { name: /Download packet/i }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("jpl-front-encoder-packet.zip")
})

test("a broken harness surfaces HK diagnostics + lint gutter", async ({ page }) => {
  // Seed a broken source (the canonical PRD §12 V5->V9 edit) via storage —
  // exactly what a returning user with bad edits sees on load. Contexts are
  // fresh per test, so nothing leaks.
  await page.goto("/projects/sensor-splice/diagram")
  await expect(page.locator(".diagram-pane svg")).toBeVisible({ timeout: 15_000 })
  // Drive a real editor transaction through the automation hook (CodeMirror
  // virtualizes the DOM, so scraping text is lossy).
  const seeded = await page.evaluate(() => {
    const view = (window as unknown as {
      __nerveEditor?: {
        state: { doc: { toString(): string } }
        dispatch(spec: { changes: { from: number; to: number; insert: string } }): void
      }
    }).__nerveEditor
    if (view === undefined) return false
    const doc = view.state.doc.toString()
    const idx = doc.indexOf('1: "V5", 2: "GND", 3: "CAN_H"')
    if (idx === -1) return false
    view.dispatch({ changes: { from: idx + 4, to: idx + 6, insert: "V9" } })
    return true
  })
  test.skip(!seeded, "bundled source drifted")
  await expect(page.locator("body")).toContainText("HK-CONN-011", { timeout: 20_000 })
  await expect(page.locator(".cm-lint-marker").first()).toBeVisible()
})

test("multi-file project: variants tab compiles the long SKU (§9.6 fsMap)", async ({ page }) => {
  await page.goto("/projects/motor-controller/diagram")
  await expect(page.locator(".diagram-pane svg")).toBeVisible({ timeout: 15_000 })
  // The bundled variants/long.ts ships as a real second file.
  const tab = page.locator(".source-tab", { hasText: "variants/long.ts" })
  await expect(tab).toBeVisible()
  await tab.click()
  // Compile-what-you-look-at: the variant becomes the entrypoint — its
  // import of ../main.harness.js resolves INSIDE the worker's fsMap.
  await expect(page.locator(".toolbar-status")).toContainText(/0 error/i, { timeout: 20_000 })
  await expect(page.locator(".diagram-pane svg")).toContainText("motor-controller-harness-long", {
    timeout: 20_000
  })
  // Back to the entry file: the base harness renders again.
  await page.locator(".source-tab", { hasText: "main.harness.ts" }).first().click()
  await expect(page.locator(".diagram-pane svg")).not.toContainText("motor-controller-harness-long", {
    timeout: 20_000
  })
})

test("share link round-trips: Share copies a URL whose fragment recompiles the harness", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/projects/motor-controller/diagram")
  await expect(page.locator(".diagram-pane svg")).toBeVisible({ timeout: 15_000 })
  await page.getByRole("button", { name: "Share" }).click()
  await expect(page.getByRole("button", { name: /Link copied/ })).toBeVisible()
  const url = await page.evaluate(() => navigator.clipboard.readText())
  // motor-controller ships variants/long.ts, so it's a multi-file (v2) link.
  expect(url).toContain("/shared#v2.")
  // The fragment IS the project: a fresh navigation decodes and compiles it.
  await page.goto(url)
  await expect(page.locator(".diagram-pane svg")).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(".diagram-pane svg")).toContainText("motor-controller-harness")
  await expect(page.locator(".toolbar-status")).toContainText(/0 error/i, { timeout: 20_000 })
  // The extra file survived the round-trip (not dropped): its tab is present.
  await expect(page.locator(".source-tab", { hasText: "variants/long.ts" })).toBeVisible()
})

test("diagram sheet actions exist and Copy SVG puts markup on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
  await page.goto("/projects/motor-controller/diagram")
  await expect(page.locator(".diagram-pane svg")).toBeVisible({ timeout: 15_000 })
  await page.getByRole("button", { name: "Copy SVG" }).click()
  const clip = await page.evaluate(() => navigator.clipboard.readText())
  expect(clip).toContain("<svg")
  expect(clip).toContain("data-wire")
})

test("export packet downloads a zip built in the worker", async ({ page }) => {
  await page.goto("/projects/motor-controller/diagram")
  await expect(page.locator(".diagram-pane svg")).toBeVisible({ timeout: 15_000 })
  const download = page.waitForEvent("download", { timeout: 30_000 })
  await page.getByRole("button", { name: /export packet/i }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("motor-controller-packet.zip")
})

test("docs render with copy-as-markdown and highlighted code", async ({ page }) => {
  await page.goto("/docs/dsl")
  await expect(page.locator(".docs-content, .docs-body").first()).toBeVisible()
  await expect.poll(async () => page.locator("pre code span[class*='tok-']").count(), {
    timeout: 10_000
  }).toBeGreaterThan(5)
  await expect(page.getByRole("button", { name: /copy.*markdown/i }).first()).toBeVisible()
})

test("reset is undoable: Undo reset restores pre-reset edits", async ({ page }) => {
  await page.goto("/projects/motor-controller/diagram")
  await expect(page.locator(".diagram-pane svg")).toBeVisible({ timeout: 15_000 })
  // Drive a real editor transaction through the automation hook (CodeMirror
  // virtualizes the DOM, so scraping text is lossy).
  const seeded = await page.evaluate(() => {
    const view = (window as unknown as {
      __nerveEditor?: {
        state: { doc: { toString(): string } }
        dispatch(spec: { changes: { from: number; to: number; insert: string } }): void
      }
    }).__nerveEditor
    if (view === undefined) return false
    view.dispatch({ changes: { from: 0, to: 0, insert: "// undo-me\n" } })
    return true
  })
  test.skip(!seeded, "editor hook missing")
  const resetButton = page.getByRole("button", { name: "Reset", exact: true })
  const undoButton = page.getByRole("button", { name: "Undo reset" })
  await expect(resetButton).toBeVisible({ timeout: 15_000 })
  await resetButton.click()
  // Reset discards the edit and offers a one-shot undo in the toolbar.
  await expect(undoButton).toBeVisible({ timeout: 15_000 })
  await expect.poll(
    async () =>
      page.evaluate(() =>
        (window as unknown as { __nerveEditor: { state: { doc: { toString(): string } } } })
          .__nerveEditor.state.doc.toString()
      ),
    { timeout: 15_000 }
  ).not.toContain("// undo-me")
  await undoButton.click()
  // Undo restores every file's pre-reset content; the button is one-shot.
  await expect.poll(
    async () =>
      page.evaluate(() =>
        (window as unknown as { __nerveEditor: { state: { doc: { toString(): string } } } })
          .__nerveEditor.state.doc.toString()
      ),
    { timeout: 15_000 }
  ).toContain("// undo-me")
  await expect(undoButton).not.toBeVisible()
  // The project is dirty again, so Reset reappears.
  await expect(resetButton).toBeVisible({ timeout: 15_000 })
})

test("traceability: click a wire -> inspector; search navigates and selects", async ({ page }) => {
  await page.goto("/projects/motor-controller/diagram")
  await expect(page.locator(".diagram-pane svg")).toBeVisible({ timeout: 15_000 })
  // Click a rendered wire (dispatched: bent paths have empty bbox centers).
  await page.locator("path[data-wire]").first().dispatchEvent("click")
  await expect(page.locator(".inspector")).toBeVisible()
  await expect(page.locator(".inspector dd").first()).toHaveText(/W\d/)
  // Selection survives a tab switch (cross-view, §11.3).
  await page.getByRole("link", { name: "Connectors" }).click()
  await expect(page.locator(".diagram-pane svg .sel").first()).toBeAttached()
  // Search: signal query finds the pin and navigates.
  await page.getByLabel("Search the harness").fill("CAN_H")
  await page.locator(".search-results [cmdk-item]").first().click()
  await expect(page.locator(".inspector")).toBeVisible()
})

/**
 * E2E: the AI copilot pane against a mocked OpenAI Responses API.
 *
 * Only the network call to api.openai.com is intercepted — the agent loop,
 * patch engine, compile worker and stores all run real. ai.ts streams
 * `client.responses.create({ stream: true })`, i.e. POST /v1/responses
 * answered with SSE; the SDK yields each `data:` JSON event (event-name
 * line optional), so the mock emits data-only frames:
 *   response.output_text.delta -> thread text
 *   response.completed         -> { id, output } (function_call items drive tools)
 * A tool round-trip is a SECOND POST (previous_response_id + function
 * outputs), so the route handler serves bodies sequentially by call count.
 */
import { expect, test, type Page } from "@playwright/test"

const sse = (events: ReadonlyArray<object>): string =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")

const textStream = (id: string, chunks: ReadonlyArray<string>): string =>
  sse([
    ...chunks.map((delta) => ({ type: "response.output_text.delta", delta })),
    { type: "response.completed", response: { id, output: [] } }
  ])

const toolCallStream = (id: string): string =>
  sse([
    {
      type: "response.completed",
      response: {
        id,
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "edit_harness_source",
            arguments: JSON.stringify({
              path: null,
              old_string: "MOTOR CTRL A",
              new_string: "MOTOR CTRL B"
            })
          }
        ]
      }
    }
  ])

/** Serve the given SSE bodies to successive POST /v1/responses calls.
 * The browser preflights (Authorization header), so OPTIONS is answered
 * with CORS approval and never counted as a round. */
const mockOpenAI = async (page: Page, bodies: ReadonlyArray<string>): Promise<void> => {
  let round = 0
  await page.route("**/v1/responses", async (route) => {
    const request = route.request()
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers":
            request.headers()["access-control-request-headers"] ?? "*"
        }
      })
      return
    }
    const body = bodies[Math.min(round, bodies.length - 1)]
    round += 1
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      contentType: "text/event-stream",
      body: body ?? ""
    })
  })
}

/** Key entry through the real UI so the localStorage persistence path runs. */
const saveKey = async (page: Page): Promise<void> => {
  await page.getByLabel("OpenAI API key").fill("sk-test123")
  await page.getByRole("button", { name: "Save key" }).click()
  // Setup screen swaps for the thread once the key lands.
  await expect(page.getByLabel("Describe a change")).toBeVisible()
}

const sendMessage = async (page: Page, text: string): Promise<void> => {
  await page.getByLabel("Describe a change").fill(text)
  await page.getByRole("button", { name: "Send", exact: true }).click()
}

test("assistant streams a reply", async ({ page }) => {
  await mockOpenAI(page, [textStream("resp_mock_1", ["Hello ", "from the mock"])])
  await page.goto("/projects/motor-controller/diagram")
  await expect(page.locator(".diagram-pane svg")).toBeVisible({ timeout: 15_000 })
  await saveKey(page)
  await sendMessage(page, "hi")
  await expect(page.locator(".ai-msg.assistant")).toContainText("Hello from the mock", {
    timeout: 20_000
  })
})

test("a tool call patches the editor", async ({ page }) => {
  test.setTimeout(60_000)
  // Round 1: edit_harness_source renames the L1 label (unique substring of
  // the bundled motor-controller entry source). Round 2 closes with text.
  await mockOpenAI(page, [
    toolCallStream("resp_mock_tool"),
    textStream("resp_mock_done", ["Renamed the label."])
  ])
  await page.goto("/projects/motor-controller/diagram")
  await expect(page.locator(".diagram-pane svg")).toBeVisible({ timeout: 15_000 })
  await expect(page.locator(".toolbar-status")).toContainText(/0 error/i, { timeout: 20_000 })
  await saveKey(page)
  await sendMessage(page, "rename the label to MOTOR CTRL B")

  // The patch lands compile-verified and closes with the round-2 text.
  await expect(page.locator(".ai-msg.assistant")).toContainText("Renamed the label.", {
    timeout: 30_000
  })
  // The step is reported in plain language, not as the tool's function name.
  await expect(page.locator(".ai-msg.assistant .ai-steps")).toContainText("Edited the harness")
  // The editor document reflects the AI's edit (same automation hook as smoke).
  await expect.poll(
    async () =>
      page.evaluate(() => window.__nerveEditor?.state.doc.toString()),
    { timeout: 20_000 }
  ).toContain("MOTOR CTRL B")
  // The real worker compiled the patched source clean.
  await expect(page.locator(".toolbar-status")).toContainText(/0 error/i, { timeout: 20_000 })
})

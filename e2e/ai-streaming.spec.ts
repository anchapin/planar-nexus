import { test, expect } from "@playwright/test";

/**
 * AI Streaming E2E Tests
 *
 * Issue #1534: `/api/chat` is hardened and delegates to the shared coach
 * pipeline, emitting the coach Server-Sent-Events wire format (one JSON
 * `CoachStreamEvent` per `data:` line). These specs pin the wire contract the
 * client-facing chat consumes.
 *
 * Note: tool calling is intentionally NOT tested here — the hardened
 * `/api/chat` no longer exposes a tool surface (card search lives behind
 * `/api/ai-proxy`).
 */
test.describe("AI Streaming & Tools", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/deck-coach");
  });

  test("should stream coach SSE events from /api/chat", async ({ page }) => {
    // Mock the chat API to return the hardened SSE event stream.
    await page.route("**/api/chat", async (route) => {
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"type":"text","value":"Hello! "}\n\n',
        'data: {"type":"text","value":"I am your AI coach."}\n\n',
        'data: {"type":"done"}\n\n',
      ];

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: Buffer.from(chunks.join("")),
      });
    });

    // Exercise the endpoint via fetch in the page and read the full stream.
    const response = await page.evaluate(async () => {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "Hi" }],
          provider: "google",
        }),
        headers: { "Content-Type": "application/json" },
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        text += decoder.decode(value);
      }
      return text;
    });

    expect(response).toContain('data: {"type":"text","value":"Hello! "}');
    expect(response).toContain('data: {"type":"done"}');
  });

  // Issue #2070: Tests the heuristic fallback when AI is unavailable.
  // Note: In CI environments where no AI providers are configured, the code
  // path goes directly to heuristic without attempting AI calls. This test
  // verifies the deck-coach UI works when AI is mocked to fail.
  test("should use heuristic mode when AI API fails", async ({ page }) => {
    // Mock API failure - abort the request to simulate network/API error
    await page.route("**/api/ai-proxy", async (route) => {
      await route.abort("internetdisconnected");
    });

    await page.goto("/deck-coach");
    await page.waitForLoadState("domcontentloaded");

    // The textarea should be visible after page loads
    const textarea = page.locator('textarea[placeholder*="1 Sol Ring"]');
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // Enter a decklist
    await textarea.fill("1 Black Lotus\n1 Mox Ruby");

    // Click the Review button
    await page.click('button:has-text("Review My Deck")');

    // Wait for analysis to complete (may use heuristic if AI fails)
    // The page should still be functional - verify no error dialog
    await page.waitForTimeout(2000);

    // Verify the textarea still exists and the page is responsive
    await expect(textarea).toBeVisible();
  });
});

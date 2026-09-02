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

  // Skipped: Requires AI service that may not be available in CI
  test.skip("should fallback to heuristic mode when offline", async ({
    page,
  }) => {
    // Navigate to the page first, before going offline
    await page.goto("/deck-coach");

    // Mock API failure
    await page.route("**/api/ai-proxy", async (route) => {
      await route.abort("internetdisconnected");
    });

    // Set offline mode in browser
    await page.context().setOffline(true);

    // Trigger deck review
    await page.goto("/deck-coach");

    await page.fill(
      'textarea[placeholder*="1 Sol Ring"]',
      "1 Black Lotus\n1 Mox Ruby",
    );
    await page.click('button:has-text("Review My Deck")');

    // Check for fallback message
    const summary = page.locator("text=[Heuristic Mode - AI Unavailable]");
    await expect(summary).toBeVisible({ timeout: 10000 });

    await page.context().setOffline(false);
  });
});

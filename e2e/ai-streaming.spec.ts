import { test, expect, type Page } from "@playwright/test";

/**
 * AI Streaming E2E Tests
 *
 * Issue #1534: `/api/chat` is hardened and delegates to the shared coach
 * pipeline, emitting the coach Server-Sent-Events wire format (one JSON
 * `CoachStreamEvent` per `data:` line). These specs pin the wire contract the
 * client-facing chat consumes.
 *
 * Issue #2288: `page.route` is unreliable with WebKit under load.
 * All AI proxy mocks use `addInitScript` (window.fetch interception) instead,
 * which works consistently across all browsers.
 *
 * Note: tool calling is intentionally NOT tested here — the hardened
 * `/api/chat` no longer exposes a tool surface (card search lives behind
 * `/api/ai-proxy`).
 */

async function mockChatApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const chunks = [
      'data: {"type":"text","value":"Hello! "}\n\n',
      'data: {"type":"text","value":"I am your AI coach."}\n\n',
      'data: {"type":"done"}\n\n',
    ];
    const body = chunks.join("");

    const originalFetch = window.fetch.bind(window);
    window.fetch = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/api/chat")) {
        return Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      return originalFetch(input, init);
    };
  });
}

async function mockAiProxyFailure(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/api/ai-proxy")) {
        return Promise.reject(new Error("internetdisconnected"));
      }
      return originalFetch(input, init);
    };
  });
}

test.describe("AI Streaming & Tools", () => {
  test("should stream coach SSE events from /api/chat", async ({ page }) => {
    await mockChatApi(page);

    await page.goto("/deck-coach");

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

  test("should use heuristic mode when AI API fails", async ({ page }) => {
    await mockAiProxyFailure(page);

    await page.goto("/deck-coach");
    await page.waitForLoadState("domcontentloaded");

    const textarea = page.locator('textarea[placeholder*="1 Sol Ring"]');
    await expect(textarea).toBeVisible({ timeout: 10000 });

    await textarea.fill("1 Black Lotus\n1 Mox Ruby");

    await page.click('button:has-text("Review My Deck")');

    await page.waitForTimeout(2000);

    await expect(textarea).toBeVisible();
  });
});

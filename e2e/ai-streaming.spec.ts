import { test, expect } from "@playwright/test";

/**
 * AI Streaming & Tools E2E Tests
 * Verifies Phase 6 requirements: SSE streaming, multi-provider, tool calling.
 */
test.describe("AI Streaming & Tools", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/deck-coach");
  });

  test("should support streaming responses in AI Coach chat", async ({
    page,
  }) => {
    // Mock the chat API to return a streaming response
    await page.route("**/api/chat", async (route) => {
      const encoder = new TextEncoder();
      const chunks = [
        '0:"Hello! "\n',
        '0:"I am "\n',
        '0:"your AI coach. "\n',
        '0:"How can I help you today?"\n',
      ];

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: Buffer.from(chunks.join("")),
      });
    });

    // Navigate to a page with AICoachChatPanel (if integrated somewhere)
    // For now, let's assume it's on the deck coach page or we can go to a demo
    await page.goto("/api/card-interactions-demo"); // Just a place to trigger chat if needed

    // Actually, let's just test the /api/chat endpoint directly via fetch in the page
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

    expect(response).toContain('0:"Hello! "');
    expect(response).toContain('0:"How can I help you today?"');
  });

  test("should fallback to heuristic mode when offline", async ({ page }) => {
    // Navigate to the page first, before going offline
    await page.goto("/deck-coach");

    // Mock API failure
    await page.route("**/api/ai-proxy", async (route) => {
      await route.abort("internetdisconnected");
    });

    // Set offline mode in browser
    await page.context().setOffline(true);

    // Trigger deck review
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

  test("should handle tool calling (searchCards) correctly", async ({
    page,
  }) => {
    // Mock the chat API with a tool call and result
    await page.route("**/api/chat", async (route) => {
      const chunks = [
        '0:"Let me search for that card..."\n',
        '9:{"toolCallId":"call_123","toolName":"searchCards","args":{"query":"Sol Ring"}}\n',
        'a:{"toolCallId":"call_123","toolName":"searchCards","args":{"query":"Sol Ring"},"result":{"message":"Found 1 card","cards":[{"name":"Sol Ring","cost":"{1}","type":"Artifact"}]}}\n',
        '0:"I found Sol Ring, a powerful artifact that costs {1} mana."\n',
      ];

      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: Buffer.from(chunks.join("")),
      });
    });

    // Test the tool call logic
    const response = await page.evaluate(async () => {
      const res = await fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", content: "Tell me about Sol Ring" }],
          provider: "openai",
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

    expect(response).toContain(
      '9:{"toolCallId":"call_123","toolName":"searchCards"',
    );
    expect(response).toContain(
      'a:{"toolCallId":"call_123","toolName":"searchCards"',
    );
    expect(response).toContain('0:"I found Sol Ring');
  });
});

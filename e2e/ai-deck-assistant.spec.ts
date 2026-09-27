import { test, expect } from "@playwright/test";
import { seedCardDatabase, loadDeck } from "./test-utils";

/**
 * E2E: AI Deck Assistant — AI Assistant panel on /deck-builder (issue #1815).
 *
 * The AI assistant reads the user's saved deck from IndexedDB and streams back
 * card suggestions via the /api/ai-proxy route.
 *
 * Issue #2288: `page.route` is unreliable with WebKit under load.
 * All AI proxy mocks use `addInitScript` (window.fetch interception) instead,
 * which works consistently across all browsers.
 *
 * The shared `storageState` in playwright.config.ts suppresses the onboarding
 * tour (`planar-nexus:onboarded=true`).
 */

async function mockAiProxy(page: Parameters<typeof page>[0]): Promise<void> {
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
        const body = init?.body ? JSON.parse(init.body as string) : {};
        if (body?.body?.stream) {
          const chunks = [
            '0:"This card synergizes well with your deck\'s mana strategy. "',
            '0:"Consider adding more artifact-based ramp to improve consistency."',
          ];
          return Promise.resolve(
            new Response(chunks.join("\n"), {
              status: 200,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            }),
          );
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: JSON.stringify({
                        reviewSummary:
                          "Mock AI review - your deck has good synergy.",
                        deckOptions: [],
                      }),
                    },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 50,
                  total_tokens: 150,
                },
              },
              usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
              rateLimit: { remaining: 29, resetAt: Date.now() + 60000 },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      }

      if (url.includes("/api/chat")) {
        const explanation =
          "This card synergizes well with your deck because it provides efficient mana acceleration and fits your color identity.";
        const events = [
          { type: "provider", value: "openai" },
          { type: "text", value: explanation },
          { type: "done" },
        ];
        const sseData = events
          .map((event) => `data: ${JSON.stringify(event)}`)
          .join("\n");
        return Promise.resolve(
          new Response(sseData + "\n\n", {
            status: 200,
            headers: { "Content-Type": "text/event-stream; charset=utf-8" },
          }),
        );
      }

      return originalFetch(input, init);
    };
  });
}

test.describe("AI Deck Assistant", () => {
  test.beforeEach(async ({ page }) => {
    await loadDeck(page);
    await seedCardDatabase(page);
    await mockAiProxy(page);

    await page.goto("/deck-builder");
    await page.waitForLoadState("domcontentloaded");
  });

  test("should display initial state of AI Assistant", async ({ page }) => {
    const assistant = page.locator("text=AI Assistant");
    await expect(assistant).toBeVisible({ timeout: 15000 });

    const enableButton = page.locator("text=Enable AI Suggestions");
    await expect(enableButton).toBeVisible({ timeout: 10000 });
  });

  test("should allow searching and adding cards to deck", async ({ page }) => {
    const searchInput = page.getByTestId("card-search-input");
    await searchInput.fill("Sol Ring");

    const solRingResult = page.getByTestId("card-result-sol-ring");
    await expect(solRingResult).toBeVisible({ timeout: 10000 });

    await solRingResult.click();
    await page.waitForTimeout(500);
  });

  test("should handle AI explanation request when synergy is enabled", async ({
    page,
  }) => {
    const enableButton = page.locator("text=Enable AI Suggestions");
    await enableButton.click();

    await page.waitForTimeout(2000);

    const searchInput = page.getByTestId("card-search-input");
    await searchInput.fill("Sol Ring");
    const solRingResult = page.getByTestId("card-result-sol-ring");
    await expect(solRingResult).toBeVisible({ timeout: 10000 });
    await solRingResult.click();

    await page.waitForTimeout(1000);

    const assistant = page.locator("text=AI Assistant");
    await expect(assistant).toBeVisible({ timeout: 5000 });
  });

  test("should display search results when synergy model unavailable", async ({
    page,
  }) => {
    const enableButton = page.locator("text=Enable AI Suggestions");
    await enableButton.click();
    await page.waitForTimeout(1000);

    const searchInput = page.getByTestId("card-search-input");
    await searchInput.fill("Sol Ring");
    const solRingResult = page.getByTestId("card-result-sol-ring");
    await expect(solRingResult).toBeVisible({ timeout: 10000 });
    await solRingResult.click();

    await searchInput.clear();
    await searchInput.fill("Signet");

    const searchResults = page.locator('[data-testid^="card-result-"]').first();
    await expect(searchResults).toBeVisible({ timeout: 10000 });
  });
});

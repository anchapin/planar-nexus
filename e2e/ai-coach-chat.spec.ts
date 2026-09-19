import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: v1.7 conversational AI coach chat on /deck-coach (issue #1787).
 *
 * Where e2e/ai-streaming.spec.ts pins the /api/chat SSE wire contract via
 * page.evaluate, this spec drives the real chat UI: it types a question into
 * the Chat tab, watches the streamed answer render in the transcript, then
 * reloads the page and asserts the conversation history persists (IndexedDB
 * auto-resume — the v1.7 continuity acceptance).
 *
 * Mocking strategy (#1950): the coach endpoint is stubbed via
 * `window.fetch` replacement (addInitScript), NOT `page.route`. WebKit does
 * not offer fetches issued from a form submit-button click to Playwright
 * network interception — and under load it intermittently skips
 * keyboard-submitted fetches too — so `page.route` could never fulfill the
 * "persists the conversation" test's button-submitted request in webkit.
 * The unintercepted POST then followed the `trailingSlash: true` 308 to
 * /api/chat/coach/ and was answered by the real route (its "no LLM provider"
 * fallback text showed up in the transcript instead of the mocked stream).
 * Stubbing inside the page intercepts in JS, identically in every browser.
 *
 * The onboarding tour is already suppressed for every test by the shared
 * `storageState` in playwright.config.ts (`planar-nexus:onboarded=true`,
 * see AGENTS.md).
 *
 * #1786 lesson: every assertion is an unconditional `await expect(...)`.
 * No `if (await el.isVisible())` guards anywhere in this file.
 */

const QUESTION = "How can I improve my aggro matchup?";
/** Split across two SSE `text` events so the stream shape is realistic. */
const STREAMED_ANSWER = "Lightning Strike keeps aggressive decks honest.";

async function mockCoachStream(page: Page): Promise<void> {
  const chunks = [
    'data: {"type":"provider","value":"mock-provider"}\n\n',
    'data: {"type":"text","value":"Lightning "}\n\n',
    'data: {"type":"text","value":"Strike keeps aggressive decks honest."}\n\n',
    'data: {"type":"done"}\n\n',
  ];

  await page.addInitScript((sseBody: string) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      // Match both /api/chat/coach and the trailing-slash variant the
      // app never fetches but the redirect chain would produce.
      if (url.includes("/api/chat/coach")) {
        return Promise.resolve(
          new Response(sseBody, {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }),
        );
      }
      return originalFetch(input, init);
    };
  }, chunks.join(""));
}

interface StoredConversation {
  messages?: Array<{ content?: string }>;
}

/**
 * Resolve only after the FINALIZED assistant turn is durably in the
 * `PlanarNexusCoach` IndexedDB. The hook persists the user message the moment
 * it is sent and writes the completed assistant message only after the stream
 * ends (`persistCurrent` in the send path's `finally`) — reloading between
 * those two writes would resume a half-finished conversation and make the
 * continuity assertion racy. Waiting on the raw store (not the DOM sidebar)
 * is the deterministic signal that the final write landed.
 */
async function waitForConversationPersisted(
  page: Page,
  answer: string,
): Promise<void> {
  await page.waitForFunction(
    (expected) =>
      new Promise<boolean>((resolve) => {
        const req = indexedDB.open("PlanarNexusCoach");
        req.onsuccess = () => {
          const db = req.result;
          let getAll: IDBGetAllRequest;
          try {
            getAll = db
              .transaction("coach-conversations", "readonly")
              .objectStore("coach-conversations")
              .getAll();
          } catch {
            db.close();
            resolve(false);
            return;
          }
          getAll.onsuccess = () => {
            const records = (getAll.result ?? []) as StoredConversation[];
            const found = records.some((conv) =>
              (conv.messages ?? []).some((m) =>
                (m.content ?? "").includes(expected),
              ),
            );
            db.close();
            resolve(found);
          };
          getAll.onerror = () => {
            db.close();
            resolve(false);
          };
        };
        req.onerror = () => resolve(false);
      }),
    answer,
    { polling: 250, timeout: 10_000 },
  );
}

test.describe("AI Coach Chat (/deck-coach)", () => {
  test.beforeEach(async ({ page }) => {
    await mockCoachStream(page);
    await page.goto("/deck-coach");

    // The conversational surface lives behind the Chat tab.
    await page.getByRole("tab", { name: "Chat" }).click();
    await expect(page.getByLabel("Chat message input")).toBeVisible();
  });

  test("renders a streamed coach reply in the transcript", async ({ page }) => {
    const input = page.getByLabel("Chat message input");
    await input.fill(QUESTION);
    await input.press("Enter");

    const transcript = page.getByRole("log", { name: "Chat messages" });

    // The user's question echoes in the transcript...
    await expect(transcript).toContainText(QUESTION);
    // ...and the mocked SSE text events render as the streamed answer.
    await expect(transcript).toContainText(STREAMED_ANSWER);
  });

  test("persists the conversation across a page reload", async ({ page }) => {
    const input = page.getByLabel("Chat message input");
    await input.fill(QUESTION);
    await page.getByRole("button", { name: "Send message" }).click();

    const transcript = page.getByRole("log", { name: "Chat messages" });
    await expect(transcript).toContainText(STREAMED_ANSWER);

    // Let the post-stream persistence write land before reloading.
    await waitForConversationPersisted(page, STREAMED_ANSWER);

    await page.reload();
    await page.getByRole("tab", { name: "Chat" }).click();

    // v1.7 continuity: the prior conversation auto-resumes from storage.
    const resumed = page.getByRole("log", { name: "Chat messages" });
    await expect(resumed).toContainText(QUESTION);
    await expect(resumed).toContainText(STREAMED_ANSWER);
  });
});

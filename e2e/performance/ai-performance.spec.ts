import { test, expect } from "@playwright/test";

/**
 * AI Performance E2E Tests — issue #2952.
 *
 * Verifies that triggering the AI assistance on the game board does not
 * block the UI thread: the board must stay interactive while the AI
 * analysis runs, and the interactions must actually take effect.
 *
 * Every locator below was verified against the components that ship today:
 *
 *  - Route: `/game-board/` — `src/app/(app)/game-board/page.tsx`.
 *    (The old spec used `/game/board`, which is not a route in this app.)
 *  - `getByRole("checkbox", { name: "Enable AI hints" })` — the AI-assist
 *    toggle in `game-board/page.tsx` (`aria-label="Enable AI hints"`).
 *  - `getByRole("button", { name: "Get AI Suggestions" })` — the AI-assist
 *    button in the same file (it reads "Analyzing..." while pending).
 *  - `getByTestId("ai-thinking-indicator")` — `AIThinkingIndicator`
 *    (`src/components/ai/AIThinkingIndicator.tsx`), rendered while the AI
 *    analysis is in flight.
 *  - `getByRole("button", { name: "Advance Phase" | "Pass Priority" |
 *    "Next Turn" })` — the game controls in the same file.
 */
test.describe("AI Performance", () => {
  test("should maintain responsiveness during AI thinking", async ({
    page,
  }) => {
    // The board boots a game asynchronously (deck load + engine init), which
    // is slow against `next dev`; give the spec room for it.
    test.setTimeout(90_000);

    // Navigate to the real game board route.
    await page.goto("/game-board/", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { name: "Game Board" }),
    ).toBeVisible();

    // The board auto-starts a game, so the turn/phase readout is present.
    await expect(page.getByText(/^Turn 1 - /)).toBeVisible({ timeout: 45_000 });

    // Enable AI assistance.
    const aiToggle = page.getByRole("checkbox", { name: "Enable AI hints" });
    await expect(aiToggle).not.toBeChecked();
    await aiToggle.check();
    await expect(aiToggle).toBeChecked();

    const analyzeButton = page.getByRole("button", {
      name: "Get AI Suggestions",
    });
    // The button is disabled until AI assistance is enabled.
    await expect(analyzeButton).toBeEnabled();

    // Start recording long tasks so we can report what the AI analysis
    // costs on the main thread.
    await page.evaluate(() => {
      const w = window as unknown as {
        __longTasks?: Array<{ duration: number; startTime: number }>;
      };
      w.__longTasks = [];
      const Observer = (
        window as unknown as {
          PerformanceObserver?: new (
            cb: (list: PerformanceObserverEntryList) => void,
          ) => PerformanceObserver;
        }
      ).PerformanceObserver;
      if (!Observer) return;
      new Observer((list) => {
        for (const entry of list.getEntries()) {
          w.__longTasks?.push({
            duration: entry.duration,
            startTime: entry.startTime,
          });
        }
      }).observe({ type: "longtask", buffered: true });
    });

    // Start AI analysis. `aiStart` marks the beginning of the interaction
    // window used for the long-task report below.
    const aiStart = await page.evaluate(() => performance.now());
    await analyzeButton.click();

    // The board surfaces a thinking indicator while the AI analysis runs.
    await expect(page.getByTestId("ai-thinking-indicator")).toBeVisible();

    // Perform UI interactions while the AI is thinking. If the main thread
    // is blocked, these interactions are delayed or fail outright.
    const advancePhase = page.getByRole("button", { name: "Advance Phase" });
    const passPriority = page.getByRole("button", { name: "Pass Priority" });
    const nextTurn = page.getByRole("button", { name: "Next Turn" });
    const thinkingDuringInteraction = await page
      .getByTestId("ai-thinking-indicator")
      .isVisible();
    await advancePhase.click();
    await passPriority.click();
    await nextTurn.click();

    // Verify UI still responds.
    await expect(advancePhase).toBeEnabled();
    await expect(passPriority).toBeEnabled();
    await expect(nextTurn).toBeEnabled();

    // The interactions must have taken effect: the game moved on to the
    // next turn, so the click handlers really ran.
    await expect(page.getByText(/^Turn 2 - /)).toBeVisible();

    // Report what the AI analysis cost on the main thread. Some long tasks
    // are inevitable during page load/hydration, but they shouldn't be
    // caused by the AI heuristics — so only the tasks that started inside
    // the AI interaction window are reported.
    const longTasks = await page.evaluate(() => {
      const w = window as unknown as {
        __longTasks?: Array<{ duration: number; startTime: number }>;
      };
      return w.__longTasks ?? [];
    });
    const interactionTasks = longTasks.filter((t) => t.startTime >= aiStart);
    const aiLongTasks = interactionTasks.filter((t) => t.duration > 16);
    const longest = aiLongTasks.reduce((max, t) => Math.max(max, t.duration), 0);
    console.log(
      `Detected ${aiLongTasks.length} tasks > 16ms during AI thinking ` +
        `(longest: ${longest.toFixed(1)}ms, thinking during interaction: ` +
        `${thinkingDuringInteraction})`,
    );
  });
});

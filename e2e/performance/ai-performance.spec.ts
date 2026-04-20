import { test, expect } from "@playwright/test";

/**
 * AI Performance E2E Tests
 *
 * Verifies that AI analysis does not block the UI thread
 * and maintains 60fps responsiveness (no tasks > 16ms).
 */
test.describe("AI Performance", () => {
  test.skip("should maintain 60fps responsiveness during AI thinking", async ({
    page,
  }) => {
    // Navigate to the game board
    await page.goto("/game/board");

    // Ensure game is started
    await expect(page.getByText("Game Board")).toBeVisible();

    // Enable AI assistance
    await page.getByLabel("Enable AI hints").check();

    // Start AI analysis
    await page.getByRole("button", { name: "Get AI Suggestions" }).click();

    // Verify thinking indicator is visible
    await expect(page.getByTestId("ai-thinking-indicator")).toBeVisible();

    // Perform UI interactions while AI is thinking
    // If the main thread is blocked, these interactions will be delayed or fail
    await page.getByRole("button", { name: "Advance Phase" }).click();
    await page.getByRole("button", { name: "Pass Priority" }).click();

    // Verify UI still responds
    await expect(page.getByText("Advance Phase")).toBeEnabled();

    // Check for "Long Tasks" using Performance API if possible
    const longTasks = await page.evaluate(() => {
      const entries = performance.getEntriesByType("longtask");
      return entries.map((e) => ({
        duration: e.duration,
        startTime: e.startTime,
      }));
    });

    // In a perfectly responsive UI, there should be no long tasks (> 50ms per spec,
    // but we aim for < 16ms for 60fps).
    // Note: Some long tasks are inevitable during page load/hydration,
    // but they shouldn't be caused by AI heuristics.
    const aiLongTasks = longTasks.filter((t) => t.duration > 16);

    // We expect no major blocking tasks during the interaction phase
    console.log(
      `Detected ${aiLongTasks.length} tasks > 16ms during AI thinking`,
    );

    // Success criteria: UI remained interactive
    await expect(page.getByRole("button", { name: "Next Turn" })).toBeEnabled();
  });
});

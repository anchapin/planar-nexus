import { test, expect, seedCardDatabase, waitForDbSeed } from "./test-utils";

test.describe("Game Flow E2E", () => {
  test.beforeEach(async ({ page }) => {
    // Seed database with test cards
    await seedCardDatabase(page);
    await page.goto("/single-player");
    await waitForDbSeed(page);
  });

  test("should start a game and pass priority", async ({ page }) => {
    // Click AI tab
    await page.getByRole("tab", { name: "Play against AI" }).click();

    // Select a deck
    const deckSelect = page.locator("#deck-select");
    await deckSelect.click();

    // Select the first option (assuming "Test Deck" or similar is available)
    // If not, we might need to create a deck first, but let's assume one exists or the select works
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    // Start game
    const startButton = page.locator('button:has-text("Start Game vs AI")');
    await expect(startButton).toBeEnabled({ timeout: 10000 });
    await startButton.click();

    // Verify we are on the game board (URL pattern is /game/GAME-ID/...)
    await expect(page).toHaveURL(/.*\/game\/.*/, { timeout: 15000 });

    // Handle the Mulligan dialog that blocks the board
    const keepHandButton = page.getByRole("button", { name: "Keep Hand" });
    await expect(keepHandButton).toBeVisible();
    await keepHandButton.click();
    await expect(keepHandButton).toBeHidden();

    // Dismiss the Tutorial Tour overlay if it appears
    const skipTourButton = page.getByRole("button", { name: "Skip Tour" });
    try {
      // Wait a short bit for it to potentially appear
      await skipTourButton.waitFor({ state: "visible", timeout: 5000 });
      await skipTourButton.click();
      await expect(skipTourButton).toBeHidden();
    } catch {
      // Tour might not always appear in every test run/environment
      console.info("Tutorial tour skip button not found or already gone");
    }

    // Ensure any backdrop overlays are gone before proceeding
    // The error showed a 'fixed inset-0 bg-black/40 z-50' div
    await page
      .locator("div.fixed.inset-0.bg-black\\/40")
      .waitFor({ state: "hidden", timeout: 5000 })
      .catch(() => {
        console.warn("Overlay backdrop did not hide");
      });

    // Verify game board elements are visible after closing dialog
    // "Players" text is not present in the current UI; using "Game in Progress" instead
    await expect(page.getByText("Game in Progress")).toBeVisible();

    // Verify action button exists (UI uses "Next Phase" in the dashboard area)
    const nextPhaseButton = page.getByRole("button", { name: "Next Phase" });
    await expect(nextPhaseButton).toBeVisible();

    // Click Next Phase (using force if something is still lingering, but ideally wait for it)
    await nextPhaseButton.click({ force: true });

    // Verify game state is still active
    await expect(page.getByText("Game in Progress")).toBeVisible();
  });

  test("should allow selecting a card in hand", async ({ page }) => {
    // Click AI tab
    await page.getByRole("tab", { name: "Play against AI" }).click();

    // Select a deck
    const deckSelect = page.locator("#deck-select");
    await deckSelect.click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    // Start game — wait until a deck is selected and the button is genuinely
    // actionable before clicking (mirrors the stable sibling test above).
    // Clicking before the board setup is ready is what races under CI load.
    const startButton = page.locator('button:has-text("Start Game vs AI")');
    await expect(startButton).toBeEnabled({ timeout: 10000 });
    await startButton.click();

    // Wait for navigation to the game board before proceeding — mirrors the
    // stable sibling test. Without this readiness gate the test races ahead
    // of board load under CI load (#1159).
    await expect(page).toHaveURL(/.*\/game\/.*/, { timeout: 15000 });

    // Handle the Mulligan dialog — wait for the button to be visible and
    // interactive so the opening hand is actually dealt before we interact.
    const keepHandButton = page.getByRole("button", { name: "Keep Hand" });
    await expect(keepHandButton).toBeVisible();
    await keepHandButton.click();
    await expect(keepHandButton).toBeHidden();

    // Dismiss the Tutorial Tour
    const skipTourButton = page.getByRole("button", { name: "Skip Tour" });
    try {
      await skipTourButton.waitFor({ state: "visible", timeout: 5000 });
      await skipTourButton.click();
      await expect(skipTourButton).toBeHidden();
    } catch {
      console.info("Tour not found or already skipped");
    }

    // Wait for overlays to clear
    await page
      .locator("div.fixed.inset-0.bg-black\\/40")
      .waitFor({ state: "hidden", timeout: 5000 })
      .catch(() => {
        console.warn("Overlay backdrop did not hide");
      });

    // Wait for AI thinking indicator to disappear before interacting with the board.
    // If the AI is still thinking, card clicks may not register properly.
    const aiThinking = page.locator('[data-testid="ai-thinking-indicator"]');
    await aiThinking.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {
      console.warn("AI thinking indicator did not hide within 15s");
    });

    // Advance phase once to ensure we're past the initial setup phase.
    // During very early game phases (Beginning phase), card interactions may
    // not be fully processed. Clicking Next Phase moves us into Main Phase
    // where card selection is reliable.
    const nextPhaseButton = page.getByRole("button", { name: "Next Phase" });
    await nextPhaseButton.click({ force: true });

    // Locate cards in hand. Only the current player's cards expose
    // role="checkbox" (opponents render card backs), so this locator is
    // unambiguous — bind it once and reuse it for a stable interaction.
    const firstCard = page.getByRole("checkbox").first();

    // Readiness gate: wait until the opening hand has actually been dealt and
    // the card is visible AND interactive (enabled == selectable) before
    // interacting. This is the state-based wait that resolves the #1159 race
    // where the click landed before the hand was settled under CI load.
    await expect(firstCard).toBeVisible({ timeout: 10000 });
    await expect(firstCard).toBeEnabled();

    // Select the card using normal click (no force:true). This ensures
    // Playwright dispatches a proper pointer event that React's synthetic
    // event system will capture and process.
    await firstCard.click();

    // Verify it is selected. Use expect with timeout - Playwright's auto-retry
    // handles the race against React's async state update. The toHaveAttribute
    // assertion polls up to the expect timeout (5s by default) before failing.
    await expect(firstCard).toHaveAttribute("aria-pressed", "true", {
      timeout: 10000,
    });
  });
});

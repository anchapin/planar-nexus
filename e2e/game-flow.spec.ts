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
    } catch (error) {
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

    // Start game
    const startButton = page.locator('button:has-text("Start Game vs AI")');
    await startButton.click();

    // Handle the Mulligan dialog
    const keepHandButton = page.getByRole("button", { name: "Keep Hand" });
    await keepHandButton.click();
    await expect(keepHandButton).toBeHidden();

    // Dismiss the Tutorial Tour
    const skipTourButton = page.getByRole("button", { name: "Skip Tour" });
    try {
      await skipTourButton.waitFor({ state: "visible", timeout: 5000 });
      await skipTourButton.click();
      await expect(skipTourButton).toBeHidden();
    } catch (error) {
      console.info("Tour not found or already skipped");
    }

    // Wait for overlays to clear
    await page
      .locator("div.fixed.inset-0.bg-black\\/40")
      .waitFor({ state: "hidden", timeout: 5000 })
      .catch(() => {
        console.warn("Overlay backdrop did not hide");
      });

    // Locate cards in hand (they use checkboxes for selection)
    const handCards = page.getByRole("checkbox");
    await expect(handCards.first()).toBeVisible({ timeout: 10000 });

    // Select the first card - Use click() because it's a custom button-based checkbox
    await handCards.first().click();

    // Verify it is checked (custom component uses aria-pressed="true" for selection state)
    await expect(handCards.first()).toHaveAttribute("aria-pressed", "true");
  });
});

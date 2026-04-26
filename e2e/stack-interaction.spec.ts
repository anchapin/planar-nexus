import {
  test,
  expect,
  seedCardDatabase,
  waitForDbSeed,
  Page,
} from "./test-utils";

test.describe("Stack Interaction E2E", () => {
  test.beforeEach(async ({ page }) => {
    await seedCardDatabase(page);
    await page.goto("/single-player");
    await waitForDbSeed(page);
  });

  async function selectTestDeck(page: Page) {
    const deckSelect = page.locator("#self-play-deck");
    await deckSelect.click();
    await page.getByTestId("deck-option-starter-test").click();
  }

  // TODO: This test needs a different deck order (Mountain, Island, Lightning Bolt, Counterspell in opening hand)
  // which conflicts with standard-mechanics tests. Re-enable after implementing per-test deck config.
  test.skip("should handle responding to a spell on the stack", async ({
    page,
  }) => {
    await page.getByRole("tab", { name: "Self Play" }).click();
    await selectTestDeck(page);

    await page.locator('button:has-text("Start Self Play Session")').click();
    await expect(page).toHaveURL(/.*\/game\/.*/, { timeout: 15000 });

    const keepHandButton = page.getByTestId("keep-hand-button");
    await expect(keepHandButton).toBeVisible({ timeout: 15000 });
    await keepHandButton.click();

    try {
      const skipTourButton = page.getByRole("button", { name: "Skip Tour" });
      await skipTourButton.waitFor({ state: "visible", timeout: 5000 });
      await skipTourButton.click();
    } catch (_e) {
      /* skip tour */
    }

    await page
      .locator("div.fixed.inset-0.bg-black\\/40")
      .waitFor({ state: "hidden", timeout: 10000 });

    const advanceBtn = page.getByTestId("advance-phase-button");
    const passBtn = page.getByTestId("pass-priority-button");

    // PLAYER 1 TURN 1 (Auto-advanced to Main)
    const p1HandMountain = page
      .locator('[data-testid*="hand-card-mountain"]')
      .first();
    await expect(p1HandMountain).toBeVisible({ timeout: 15000 });
    await p1HandMountain.click();

    await page.getByTestId("end-turn-button").click();
    await page.waitForTimeout(1000);

    // PLAYER 2 TURN 1 (Turn 2 in Engine)
    await expect(page.getByTestId("turn-number")).toContainText("Turn 2", {
      timeout: 10000,
    });
    const p2AreaBottom = page.getByTestId("player-area-player-2");
    await expect(p2AreaBottom).toBeVisible({ timeout: 15000 });

    // P2 Turn starts in UNTAP. Advance to MAIN.
    for (let i = 0; i < 3; i++) {
      await expect(advanceBtn).toBeVisible();
      await advanceBtn.click();
      await page.waitForTimeout(500);
    }

    const p2HandIsland = page
      .locator('[data-testid*="hand-card-island"]')
      .first();
    await expect(p2HandIsland).toBeVisible({ timeout: 15000 });
    await p2HandIsland.click();

    await page.getByTestId("end-turn-button").click();
    await page.waitForTimeout(1000);

    // PLAYER 1 TURN 2 (Turn 3 in Engine)
    await expect(page.getByTestId("turn-number")).toContainText("Turn 3", {
      timeout: 10000,
    });
    const p1AreaBottom = page.getByTestId("player-area-player");
    await expect(p1AreaBottom).toBeVisible({ timeout: 15000 });

    // P1 Turn starts in UNTAP. Advance to MAIN.
    for (let i = 0; i < 3; i++) {
      await expect(advanceBtn).toBeVisible();
      await advanceBtn.click();
      await page.waitForTimeout(500);
    }

    await p1HandMountain.click();

    const bolt = page
      .locator('[data-testid*="hand-card-lightning-bolt"]')
      .first();
    await expect(bolt).toBeVisible({ timeout: 15000 });
    await bolt.click();

    // Target p2 (at top now)
    const p2AreaTop = page.getByTestId("player-area-player-2");
    await expect(p2AreaTop).toBeVisible({ timeout: 10000 });
    await p2AreaTop.click();

    // Check stack
    await expect(page.getByTestId("stack-display")).toContainText(
      "Lightning Bolt",
      { timeout: 15000 },
    );

    await expect(passBtn).toBeVisible();
    await passBtn.click();

    // PLAYER 2 HAS PRIORITY
    // Since it's Self Play, P2 might still be at the top or UI swapped?
    // Our sortedPlayers swaps so active player is at bottom.
    // When P1 is active, P1 is at bottom.
    // If P1 casts and passes, P1 is still active.

    const p2HandIsland2 = page
      .locator('[data-testid*="hand-card-island"]')
      .first();
    await expect(p2HandIsland2).toBeVisible({ timeout: 15000 });
    await p2HandIsland2.click();

    const counter = page
      .locator('[data-testid*="hand-card-counterspell"]')
      .first();
    await expect(counter).toBeVisible({ timeout: 15000 });
    await counter.click();

    const stackItem = page
      .getByTestId(/stack-item/i)
      .filter({ hasText: "Lightning Bolt" });
    await expect(stackItem).toBeVisible({ timeout: 15000 });
    await stackItem.click();

    const stackItems = page.getByTestId(/stack-item/i);
    await expect(stackItems).toHaveCount(2);
    await expect(stackItems.first()).toContainText("Counterspell");
    await expect(stackItems.nth(1)).toContainText("Lightning Bolt");

    await passBtn.click();
    await passBtn.click();

    await expect(page.getByText(/Countered/i)).toBeVisible({ timeout: 15000 });
  });
});

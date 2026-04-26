import {
  test,
  expect,
  seedCardDatabase,
  waitForDbSeed,
  Page,
} from "./test-utils";

test.describe("Complex Combat E2E", () => {
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

  // TODO: This test needs a different deck order (Mountain, Goblin Guide, Memnite in opening hand)
  // which conflicts with standard-mechanics tests. Re-enable after implementing per-test deck config.
  test.skip("should handle blocking and damage calculation correctly", async ({
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

    // PLAYER 1 TURN 1 (Auto-advanced to Main)
    const mountain = page
      .locator('[data-testid*="hand-card-mountain"]')
      .first();
    await expect(mountain).toBeVisible({ timeout: 15000 });
    await mountain.click();

    const goblin = page
      .locator('[data-testid*="hand-card-goblin-guide"]')
      .first();
    await expect(goblin).toBeVisible({ timeout: 15000 });
    await goblin.click();

    // End Turn (skip remaining phases)
    await page.getByTestId("end-turn-button").click();
    await page.waitForTimeout(1000);

    // PLAYER 2 TURN 1 (Turn 2 in Engine)
    await expect(page.getByTestId("turn-number")).toContainText("Turn 2", {
      timeout: 15000,
    });

    // P2 Turn starts and auto-advances to UPKEEP
    const advanceBtn = page.getByTestId("advance-phase-button");
    const phaseIndicator = page.locator(
      "div.text-xs.text-muted-foreground.capitalize",
    );

    // Advance to Main: Upkeep -> Draw -> Main
    await expect(advanceBtn).toBeVisible();
    await advanceBtn.click(); // Upkeep -> Draw
    await expect(phaseIndicator).toContainText("draw", { timeout: 15000 });

    await advanceBtn.click(); // Draw -> Main
    await expect(phaseIndicator).toContainText("main", { timeout: 15000 });

    const memnite = page.locator('[data-testid*="hand-card-memnite"]').first();
    await expect(memnite).toBeVisible({ timeout: 15000 });
    await memnite.click();

    await page.getByTestId("end-turn-button").click();
    await page.waitForTimeout(1000);

    // PLAYER 1 TURN 2 (Turn 3 in Engine)
    await expect(page.getByTestId("turn-number")).toContainText("Turn 3", {
      timeout: 10000,
    });

    // P1 Turn starts in UPKEEP. Advance to DECLARE ATTACKERS.
    // Upkeep -> Draw -> Main -> Begin Combat -> Declare Attackers
    await advanceBtn.click(); // Upkeep -> Draw
    await expect(phaseIndicator).toContainText("draw", { timeout: 15000 });

    await advanceBtn.click(); // Draw -> Main
    await expect(phaseIndicator).toContainText("main", { timeout: 15000 });

    await advanceBtn.click(); // Main -> Begin Combat
    await expect(phaseIndicator).toContainText("begin combat", {
      timeout: 15000,
    });

    await advanceBtn.click(); // Begin Combat -> Declare Attackers
    await expect(phaseIndicator).toContainText("declare attackers", {
      timeout: 15000,
    });

    const goblinOnBattlefield = page
      .locator("[data-testid*='battlefield-card-goblin-guide']")
      .first();
    await expect(goblinOnBattlefield).toBeVisible({ timeout: 20000 });
    await goblinOnBattlefield.click();

    // Proceed to Blockers
    await expect(advanceBtn).toBeVisible();
    await advanceBtn.click();

    // DECLARE BLOCKERS (for Player 2)
    await expect(page.getByTestId("combat-phase-blockers")).toBeVisible({
      timeout: 15000,
    });

    // Select attacker to block
    await page.locator('div:has-text("Goblin Guide")').last().click();

    const memniteBlocker = page.getByTestId(/blocker-card-memnite/i).first();
    await expect(memniteBlocker).toBeVisible({ timeout: 15000 });
    await memniteBlocker.click();

    const combatNextBtn = page.getByTestId("combat-next-button");
    await expect(combatNextBtn).toBeVisible();
    await combatNextBtn.click();

    if (await page.getByTestId("combat-phase-order").isVisible()) {
      await combatNextBtn.click();
    }

    await combatNextBtn.click();

    // Verify P2 life (should be at top now that P1 is active)
    const p2AreaTop = page.getByTestId("player-area-player-2");
    const p2Life = p2AreaTop.getByTestId("player-life");
    await expect(p2Life).toHaveText("20", { timeout: 10000 });

    // Verify Memnite in graveyard
    const p2DiscardPile = p2AreaTop.getByTestId("zone-button-graveyard");
    await expect(p2DiscardPile).toBeVisible({ timeout: 15000 });
    await expect(p2DiscardPile.getByText("1")).toBeVisible({ timeout: 15000 });
  });
});

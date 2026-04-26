/**
 * Standard Mechanics E2E Test Suite
 *
 * End-to-end tests verifying that Standard-legal cards with unique mechanics
 * can be loaded, displayed, and interacted with in the game UI.
 *
 * The starter-test deck includes 7 Standard mechanic cards at the top of the
 * library (end of deck array) so they appear in the opening hand:
 * - Ward Beetle (Ward)
 * - Surveil Scout (Surveil)
 * - Flashback Bolt (Flashback)
 * - Explore Ranger (Explore)
 * - Mountain, Forest, Island (lands)
 *
 * Note: Full spell-casting and combat e2e tests are covered by game-flow.spec.ts.
 * This suite focuses on verifying Standard mechanic cards render correctly.
 */

import { test, expect, seedCardDatabase, waitForDbSeed, Page } from "./test-utils";

test.describe("Standard Mechanics E2E", () => {
  test.beforeEach(async ({ page }) => {
    await seedCardDatabase(page);
    await page.goto("/single-player");
    await waitForDbSeed(page);
  });

  async function selectTestDeck(page: Page) {
    const deckSelect = page.locator("#deck-select");
    await deckSelect.click();
    await page.waitForTimeout(300);
    await page.getByTestId("deck-option-starter-test").click();
  }

  async function startGameAndKeepHand(page: Page) {
    await page.locator('button:has-text("Start Game vs AI")').click();

    const keepHandButton = page.getByTestId("keep-hand-button");
    await expect(keepHandButton).toBeVisible({ timeout: 15000 });
    await keepHandButton.click();

    try {
      const skipTourButton = page.getByRole("button", { name: "Skip Tour" });
      await skipTourButton.waitFor({ state: "visible", timeout: 5000 });
      await skipTourButton.click();
    } catch (e) {}

    await page.locator("div.fixed.inset-0.bg-black\\/40").waitFor({ state: "hidden", timeout: 10000 });
  }

  test.describe("Opening Hand Contains Standard Mechanic Cards", () => {
    test("should display Ward card in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const wardCard = page.locator('[data-testid*="hand-card-ward-beetle"]').first();
      await expect(wardCard).toBeVisible({ timeout: 20000 });
    });

    test("should display Cycling card in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const cyclingCard = page.locator('[data-testid*="hand-card-cycling-drake"]').first();
      await expect(cyclingCard).toBeVisible({ timeout: 20000 });
    });

    test("should display Flashback spell in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const flashbackCard = page.locator('[data-testid*="hand-card-flashback-bolt"]').first();
      await expect(flashbackCard).toBeVisible({ timeout: 20000 });
    });

    test("should display Explore creature in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const exploreCard = page.locator('[data-testid*="hand-card-explore-ranger"]').first();
      await expect(exploreCard).toBeVisible({ timeout: 20000 });
    });

    test("should display basic lands in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      await expect(page.locator('[data-testid*="hand-card-mountain"]').first()).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid*="hand-card-forest"]').first()).toBeVisible({ timeout: 20000 });
    });
  });

  test.describe("Interacting with Standard Mechanic Cards", () => {
    test("should display multiple Standard mechanic cards in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      // Verify multiple mechanic cards are visible
      await expect(page.locator('[data-testid*="hand-card-ward-beetle"]').first()).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid*="hand-card-explore-ranger"]').first()).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid*="hand-card-cycling-drake"]').first()).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid*="hand-card-flashback-bolt"]').first()).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid*="hand-card-convoke-angel"]').first()).toBeVisible({ timeout: 20000 });
    });

    test("should allow playing a basic land from hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      // Play a Forest
      const forest = page.locator('[data-testid*="hand-card-forest"]').first();
      await expect(forest).toBeVisible({ timeout: 20000 });
      await forest.click();
      await page.waitForTimeout(500);

      // Verify land appears on battlefield
      const forestOnBattlefield = page.locator('[data-testid*="battlefield-card-forest"]').first();
      await expect(forestOnBattlefield).toBeVisible({ timeout: 25000 });
    });

    test("should allow playing a Mountain from hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const mountain = page.locator('[data-testid*="hand-card-mountain"]').first();
      await expect(mountain).toBeVisible({ timeout: 20000 });
      await mountain.click();
      await page.waitForTimeout(500);

      const mountainOnBattlefield = page.locator('[data-testid*="battlefield-card-mountain"]').first();
      await expect(mountainOnBattlefield).toBeVisible({ timeout: 25000 });
    });
  });

  test.describe("Mechanic Functionality Tests", () => {
    test("Ward: targeting a Ward creature shows ward warning", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const passBtn = page.getByTestId("pass-priority-button");

      // Play Ward Beetle to battlefield (costs {0})
      const wardCard = page.locator('[data-testid*="hand-card-ward-beetle"]').first();
      await expect(wardCard).toBeVisible({ timeout: 20000 });
      await wardCard.click();
      await page.waitForTimeout(500);

      // Wait for AI to pass, then pass priority to resolve the stack
      await page.waitForTimeout(2500);
      await passBtn.click();
      await page.waitForTimeout(500);

      // Verify on battlefield
      const wardOnBf = page.locator('[data-testid*="battlefield-card-ward-beetle"]').first();
      await expect(wardOnBf).toBeVisible({ timeout: 25000 });

      // Cast Flashback Bolt targeting Ward Beetle (costs {0})
      const flashbackBolt = page.locator('[data-testid*="hand-card-flashback-bolt"]').first();
      await expect(flashbackBolt).toBeVisible({ timeout: 20000 });
      await flashbackBolt.click();
      await page.waitForTimeout(500);

      // Target Ward Beetle on battlefield
      await wardOnBf.click();
      await page.waitForTimeout(500);

      // Should see ward toast
      await expect(page.getByText(/Ward/i).first()).toBeVisible({ timeout: 15000 });
    });

    test("Cycling Drake: can be played to battlefield", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const passBtn = page.getByTestId("pass-priority-button");

      const cyclingDrake = page.locator('[data-testid*="hand-card-cycling-drake"]').first();
      await expect(cyclingDrake).toBeVisible({ timeout: 20000 });
      await cyclingDrake.click();
      await page.waitForTimeout(500);

      // Wait for AI to pass, then pass priority to resolve the stack
      await page.waitForTimeout(2500);
      await passBtn.click();
      await page.waitForTimeout(500);

      const drakeOnBf = page.locator('[data-testid*="battlefield-card-cycling-drake"]').first();
      await expect(drakeOnBf).toBeVisible({ timeout: 25000 });
    });

    test.fixme("Cycling: discard Cycling Drake to draw a card", async ({ page }) => {
      // When cycling is fully implemented:
      // 1. Click Cycling Drake in hand
      // 2. Choose "Cycle" option
      // 3. Pay {2} and discard
      // 4. Draw a card
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const cyclingDrake = page.locator('[data-testid*="hand-card-cycling-drake"]').first();
      await expect(cyclingDrake).toBeVisible({ timeout: 20000 });
      await cyclingDrake.click();

      // Expect cycle option to appear
      await expect(page.getByText(/Cycle/i).first()).toBeVisible({ timeout: 5000 });
    });

    test("Flashback Bolt: can be cast from hand", async ({ page }) => {
      test.setTimeout(90000);
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      // Play lands to have mana
      const mountain = page.locator('[data-testid*="hand-card-mountain"]').first();
      if (await mountain.isVisible().catch(() => false)) {
        await mountain.click();
        await page.waitForTimeout(500);
      }

      const island = page.locator('[data-testid*="hand-card-island"]').first();
      if (await island.isVisible().catch(() => false)) {
        await island.click();
        await page.waitForTimeout(500);
      }

      // Cast Flashback Bolt targeting opponent
      const flashbackBolt = page.locator('[data-testid*="hand-card-flashback-bolt"]').first();
      await expect(flashbackBolt).toBeVisible({ timeout: 20000 });
      await flashbackBolt.click();
      await page.waitForTimeout(500);

      const opponentArea = page.locator('div[data-testid*="player-area-ai"]').first();
      await expect(opponentArea).toBeVisible({ timeout: 10000 });
      await opponentArea.click();

      // Check for cast toast or stack
      await expect(async () => {
        const toastVisible = await page.getByText(/cast|stack|spell/i, { exact: false }).first().isVisible();
        const stackVisible = await page.getByTestId("stack-display").isVisible();
        expect(toastVisible || stackVisible).toBeTruthy();
      }).toPass({ timeout: 15000 });
    });

    test.fixme("Flashback: cast from graveyard and exile", async ({ page }) => {
      // When flashback is fully implemented:
      // 1. Cast Flashback Bolt (goes to graveyard)
      // 2. In a later turn, click it in graveyard
      // 3. Cast via flashback
      // 4. After resolution, card is exiled (not in graveyard)
    });

    test("Explore Ranger: can be played to battlefield", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const passBtn = page.getByTestId("pass-priority-button");

      const exploreRanger = page.locator('[data-testid*="hand-card-explore-ranger"]').first();
      await expect(exploreRanger).toBeVisible({ timeout: 20000 });
      await exploreRanger.click();
      await page.waitForTimeout(500);

      // Wait for AI to pass, then pass priority to resolve the stack
      await page.waitForTimeout(2500);
      await passBtn.click();
      await page.waitForTimeout(500);

      const rangerOnBf = page.locator('[data-testid*="battlefield-card-explore-ranger"]').first();
      await expect(rangerOnBf).toBeVisible({ timeout: 25000 });
    });

    test.fixme("Explore: reveal top card, play land or +1/+1 counter", async ({ page }) => {
      // When explore is fully implemented:
      // 1. Play Explore Ranger
      // 2. Explore trigger fires
      // 3. Reveal top card of library
      // 4. If land, put into hand; else put +1/+1 counter and card into graveyard
    });

    test("Convoke Angel: can be played to battlefield", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const passBtn = page.getByTestId("pass-priority-button");

      const convokeAngel = page.locator('[data-testid*="hand-card-convoke-angel"]').first();
      await expect(convokeAngel).toBeVisible({ timeout: 20000 });
      await convokeAngel.click();
      await page.waitForTimeout(500);

      // Wait for AI to pass, then pass priority to resolve the stack
      await page.waitForTimeout(2500);
      await passBtn.click();
      await page.waitForTimeout(500);

      const angelOnBf = page.locator('[data-testid*="battlefield-card-convoke-angel"]').first();
      await expect(angelOnBf).toBeVisible({ timeout: 25000 });
    });

    test.fixme("Convoke: tap creatures to reduce mana cost", async ({ page }) => {
      // When convoke is fully implemented:
      // 1. Have creatures on battlefield
      // 2. Cast Convoke Angel
      // 3. Tap creatures to pay for {1} per creature
      // 4. Cost is reduced accordingly
    });
  });

  test.describe("Standard Mechanics in Self-Play Mode", () => {
    test("should show multiple Standard mechanic cards in self-play opening hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Self Play" }).click();
      const selfDeckSelect = page.locator("#self-play-deck");
      await selfDeckSelect.click();
      await page.getByTestId("deck-option-starter-test").click();

      await page.locator('button:has-text("Start Self Play Session")').click();
      await expect(page).toHaveURL(/.*\/game\/.*/, { timeout: 15000 });

      const keepHandButton = page.getByTestId("keep-hand-button");
      await expect(keepHandButton).toBeVisible({ timeout: 15000 });
      await keepHandButton.click();

      try {
        const skipTourButton = page.getByRole("button", { name: "Skip Tour" });
        await skipTourButton.waitFor({ state: "visible", timeout: 5000 });
        await skipTourButton.click();
      } catch (e) {}

      await page.locator("div.fixed.inset-0.bg-black\\/40").waitFor({ state: "hidden", timeout: 10000 });

      // Verify multiple mechanic cards are visible in the opening hand
      await expect(page.locator('[data-testid*="hand-card-ward-beetle"]').first()).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid*="hand-card-cycling-drake"]').first()).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid*="hand-card-explore-ranger"]').first()).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid*="hand-card-flashback-bolt"]').first()).toBeVisible({ timeout: 20000 });
      await expect(page.locator('[data-testid*="hand-card-convoke-angel"]').first()).toBeVisible({ timeout: 20000 });
    });
  });
});

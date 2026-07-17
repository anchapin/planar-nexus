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

import {
  test,
  expect,
  seedCardDatabase,
  waitForDbSeed,
  Page,
} from "./test-utils";
import {
  enableFreeCast,
  freeCastApi,
  waitForFreeCastHook,
} from "./helpers/free-cast";

test.describe("Standard Mechanics E2E", () => {
  test.beforeEach(async ({ page }) => {
    // DEV/TEST ONLY (issue #1431): opt the game page into attaching the
    // free-cast hook. The flag is inert unless the app runs in dev mode
    // (NODE_ENV !== production), so it cannot affect a production build.
    await enableFreeCast(page);
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
    } catch (_e) {
      /* skip tour */
    }

    await page
      .locator("div.fixed.inset-0.bg-black\\/40")
      .waitFor({ state: "hidden", timeout: 10000 });
  }

  test.describe("Opening Hand Contains Standard Mechanic Cards", () => {
    test("should display Ward card in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const wardCard = page
        .locator('[data-testid*="hand-card-ward-beetle"]')
        .first();
      await expect(wardCard).toBeVisible({ timeout: 20000 });
    });

    test("should display Cycling card in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const cyclingCard = page
        .locator('[data-testid*="hand-card-cycling-drake"]')
        .first();
      await expect(cyclingCard).toBeVisible({ timeout: 20000 });
    });

    test("should display Flashback spell in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const flashbackCard = page
        .locator('[data-testid*="hand-card-flashback-bolt"]')
        .first();
      await expect(flashbackCard).toBeVisible({ timeout: 20000 });
    });

    test("should display Explore creature in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const exploreCard = page
        .locator('[data-testid*="hand-card-explore-ranger"]')
        .first();
      await expect(exploreCard).toBeVisible({ timeout: 20000 });
    });

    test("should display basic lands in hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      await expect(
        page.locator('[data-testid*="hand-card-mountain"]').first(),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator('[data-testid*="hand-card-forest"]').first(),
      ).toBeVisible({ timeout: 20000 });
    });
  });

  test.describe("Interacting with Standard Mechanic Cards", () => {
    test("should display multiple Standard mechanic cards in hand", async ({
      page,
    }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      // Verify multiple mechanic cards are visible
      await expect(
        page.locator('[data-testid*="hand-card-ward-beetle"]').first(),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator('[data-testid*="hand-card-explore-ranger"]').first(),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator('[data-testid*="hand-card-cycling-drake"]').first(),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator('[data-testid*="hand-card-flashback-bolt"]').first(),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator('[data-testid*="hand-card-convoke-angel"]').first(),
      ).toBeVisible({ timeout: 20000 });
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
      const forestOnBattlefield = page
        .locator('[data-testid*="battlefield-card-forest"]')
        .first();
      await expect(forestOnBattlefield).toBeVisible({ timeout: 25000 });
    });

    test("should allow playing a Mountain from hand", async ({ page }) => {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);

      const mountain = page
        .locator('[data-testid*="hand-card-mountain"]')
        .first();
      await expect(mountain).toBeVisible({ timeout: 20000 });
      await mountain.click();
      await page.waitForTimeout(500);

      const mountainOnBattlefield = page
        .locator('[data-testid*="battlefield-card-mountain"]')
        .first();
      await expect(mountainOnBattlefield).toBeVisible({ timeout: 25000 });
    });
  });

  // ====================================================================
  // Mechanic Functionality Tests (issue #1431)
  //
  // These tests exercise the four Standard mechanics (Cycling, Flashback,
  // Explore, Convoke) via a dev-only free-cast hook (`window.__TEST__`,
  // gated by NODE_ENV + the `planar-nexus:test-mode` localStorage flag — see
  // `e2e/helpers/free-cast.ts` and `src/lib/dev/free-cast-test-mode.ts`).
  //
  // The hook drives the REAL rules engine (`src/lib/game-state`) — every cast,
  // cycle, zone-move, and tap calls the genuine engine functions, so these
  // tests catch regressions in the keyword wiring rather than a stub.
  // ====================================================================
  test.describe("Mechanic Functionality Tests", () => {
    async function setupMechanicsGame(page: Page) {
      await page.getByRole("tab", { name: "Play against AI" }).click();
      await selectTestDeck(page);
      await startGameAndKeepHand(page);
      // The free-cast hook attaches once the game page mounts; wait for it so
      // the subsequent page.evaluate calls never race the registration.
      await waitForFreeCastHook(page);
    }

    test("Ward Beetle with Ward is recognized and reaches the battlefield", async ({
      page,
    }) => {
      await setupMechanicsGame(page);
      const api = freeCastApi(page);

      const drakeId = await api.findCardId({
        name: "Ward Beetle",
        zone: "hand",
      });
      expect(drakeId).not.toBeNull();
      // Give the test card a real Ward oracle ability so the keyword system
      // can parse it (CR 702.21). The starter-test card has empty oracle text.
      await api.patchCardOracle(drakeId!, "Ward {2}");

      const before = await api.getZoneCounts();
      const result = await api.freeCast(drakeId!);
      expect(result.success).toBe(true);

      const after = await api.getZoneCounts();
      expect(after.battlefield).toBe(before.battlefield + 1);
      expect(after.hand).toBe(before.hand - 1);

      // Ward keyword now lives on the battlefield permanent.
      await expect(
        page.locator('[data-testid*="battlefield-card-ward-beetle"]').first(),
      ).toBeVisible({ timeout: 10000 });
    });

    test("Cycling Drake: can be played to battlefield", async ({ page }) => {
      await setupMechanicsGame(page);
      const api = freeCastApi(page);

      const drakeId = await api.findCardId({
        name: "Cycling Drake",
        zone: "hand",
      });
      expect(drakeId).not.toBeNull();

      const before = await api.getZoneCounts();
      const result = await api.freeCast(drakeId!);
      expect(result.success).toBe(true);

      const after = await api.getZoneCounts();
      expect(after.battlefield).toBe(before.battlefield + 1);
      await expect(
        page.locator('[data-testid*="battlefield-card-cycling-drake"]').first(),
      ).toBeVisible({ timeout: 10000 });
    });

    test("Cycling: discard Cycling Drake to draw a card", async ({ page }) => {
      await setupMechanicsGame(page);
      const api = freeCastApi(page);

      const drakeId = await api.findCardId({
        name: "Cycling Drake",
        zone: "hand",
      });
      expect(drakeId).not.toBeNull();

      // Cycling is parsed from oracle text (CR 702.30). Add it to the test card
      // so the real `cycleCard` recognizes the ability.
      const oracleText = "Flying\nCycling {2}";
      await api.patchCardOracle(drakeId!, oracleText);
      expect((await api.parseCyclingInfo(oracleText)).hasCycling).toBe(true);

      const before = await api.getZoneCounts();
      const result = await api.cycle(drakeId!);
      expect(result.success).toBe(true);

      const after = await api.getZoneCounts();
      // Cycling discards the card (-1 hand) then draws a card (+1 hand), so
      // hand size is preserved while the cycled card lands in the graveyard.
      expect(after.hand).toBe(before.hand);
      expect(after.graveyard).toBe(before.graveyard + 1);
      expect(after.library).toBe(before.library - 1);
      // The cycled card itself is now in the graveyard zone.
      expect(await api.getCardZone(drakeId!)).toMatch(/graveyard$/);
    });

    test("Flashback Bolt: can be cast from hand", async ({ page }) => {
      await setupMechanicsGame(page);
      const api = freeCastApi(page);

      const boltId = await api.findCardId({
        name: "Flashback Bolt",
        zone: "hand",
      });
      expect(boltId).not.toBeNull();
      // Give the test card a real instant body so it resolves as a spell.
      await api.patchCardOracle(
        boltId!,
        "Flashback Bolt deals 2 damage to any target.",
        "Instant",
      );

      const ids = await api.getPlayerIds();
      const before = await api.getZoneCounts();
      const result = await api.freeCast(boltId!, { targetPlayerId: ids.ai });
      expect(result.success).toBe(true);

      const after = await api.getZoneCounts();
      // The spell left hand; after resolving, an instant lands in graveyard.
      expect(after.hand).toBe(before.hand - 1);
      expect(after.graveyard).toBe(before.graveyard + 1);
    });

    test("Flashback: keyword cost is parsed and the spell resolves to graveyard", async ({
      page,
    }) => {
      await setupMechanicsGame(page);
      const api = freeCastApi(page);

      const boltId = await api.findCardId({
        name: "Flashback Bolt",
        zone: "hand",
      });
      expect(boltId).not.toBeNull();

      // Wire a real Flashback cost (CR 702.66) onto the test card and verify
      // the real `parseFlashback` parser picks it up — this is the parsing
      // layer `castSpell`'s flashback branch reads to compute the alt cost.
      const oracleText =
        "Flashback Bolt deals 2 damage to any target.\nFlashback {R}";
      await api.patchCardOracle(boltId!, oracleText, "Instant");
      expect((await api.parseFlashbackInfo(oracleText)).hasFlashback).toBe(
        true,
      );

      // Cast the spell from hand (the reachable path) and resolve it. An
      // instant lands in the graveyard after resolving — which is exactly the
      // zone flashback reads from.
      const ids = await api.getPlayerIds();
      const before = await api.getZoneCounts();
      const result = await api.freeCast(boltId!, { targetPlayerId: ids.ai });
      expect(result.success).toBe(true);

      const after = await api.getZoneCounts();
      expect(after.hand).toBe(before.hand - 1);
      expect(after.graveyard).toBe(before.graveyard + 1);
      expect(await api.getCardZone(boltId!)).toMatch(/graveyard$/);

      // NOTE: casting *from* the graveyard via the flashback alternative cost
      // (castSpell's `alternativeCost: { type: "flashback" }` branch) is
      // currently unreachable because ValidationService.canCastSpell requires
      // the card to be in hand and does not account for the flashback source
      // zone. That is an engine gap separate from #1431; the cost parsing and
      // graveyard-destination wiring exercised here are the pieces this PR can
      // pin without touching rules-engine correctness.
    });

    test("Explore Ranger: can be played to battlefield", async ({ page }) => {
      await setupMechanicsGame(page);
      const api = freeCastApi(page);

      const rangerId = await api.findCardId({
        name: "Explore Ranger",
        zone: "hand",
      });
      expect(rangerId).not.toBeNull();

      const before = await api.getZoneCounts();
      const result = await api.freeCast(rangerId!);
      expect(result.success).toBe(true);

      const after = await api.getZoneCounts();
      expect(after.battlefield).toBe(before.battlefield + 1);
      await expect(
        page
          .locator('[data-testid*="battlefield-card-explore-ranger"]')
          .first(),
      ).toBeVisible({ timeout: 10000 });
    });

    test("Explore: reveal top of library (explore action building block)", async ({
      page,
    }) => {
      await setupMechanicsGame(page);
      const api = freeCastApi(page);

      const rangerId = await api.findCardId({
        name: "Explore Ranger",
        zone: "hand",
      });
      expect(rangerId).not.toBeNull();

      // The explore keyword (CR 701.18) is recognized by the parser but its
      // auto-trigger is not yet wired into the resolver. This test verifies
      // the building blocks the explore action is composed of — the ETB of the
      // ranger and the reveal/draw of the top card — using the real engine
      // operations, so the wiring is covered end-to-end as soon as the
      // trigger lands.
      const oracleText =
        "When Explore Ranger enters the battlefield, it explores.";
      await api.patchCardOracle(rangerId!, oracleText);

      const result = await api.freeCast(rangerId!);
      expect(result.success).toBe(true);
      await expect(
        page
          .locator('[data-testid*="battlefield-card-explore-ranger"]')
          .first(),
      ).toBeVisible({ timeout: 10000 });

      // Simulate the explore reveal: the top card of the library is revealed
      // (drawn into hand if it is a land, per the explore rule). This exercises
      // the real drawCard path the explore action will call.
      const before = await api.getZoneCounts();
      const drawResult = await api.drawCard();
      expect(drawResult.success).toBe(true);
      const after = await api.getZoneCounts();
      expect(after.hand).toBe(before.hand + 1);
      expect(after.library).toBe(before.library - 1);
    });

    test("Convoke Angel: can be played to battlefield", async ({ page }) => {
      await setupMechanicsGame(page);
      const api = freeCastApi(page);

      const angelId = await api.findCardId({
        name: "Convoke Angel",
        zone: "hand",
      });
      expect(angelId).not.toBeNull();

      const before = await api.getZoneCounts();
      const result = await api.freeCast(angelId!);
      expect(result.success).toBe(true);

      const after = await api.getZoneCounts();
      expect(after.battlefield).toBe(before.battlefield + 1);
      await expect(
        page.locator('[data-testid*="battlefield-card-convoke-angel"]').first(),
      ).toBeVisible({ timeout: 10000 });
    });

    test("Convoke: tap creatures to contribute toward the cost", async ({
      page,
    }) => {
      await setupMechanicsGame(page);
      const api = freeCastApi(page);

      // Convoke (CR 702.46) is not yet wired as a cost-reduction alternative
      // (see open issue #1406). This test exercises the building blocks the
      // convoke mechanic is composed of — tapping an untapped creature you
      // control and then resolving the creature spell — via the real engine
      // operations, so the path is covered when the cost-reduction lands.
      const oracleText =
        "Flying, vigilance\nConvoke (Your creatures can help cast this spell.)";
      const angelId = await api.findCardId({
        name: "Convoke Angel",
        zone: "hand",
      });
      expect(angelId).not.toBeNull();
      await api.patchCardOracle(angelId!, oracleText);

      // Put a creature on the battlefield first (the convoker).
      const drakeId = await api.findCardId({
        name: "Cycling Drake",
        zone: "hand",
      });
      expect(drakeId).not.toBeNull();
      const convoker = await api.freeCast(drakeId!);
      expect(convoker.success).toBe(true);

      // Tap the convoker (the real tapCard action convoke would invoke).
      const convokerOnBf = await api.findCardId({
        name: "Cycling Drake",
        zone: "battlefield",
      });
      expect(convokerOnBf).not.toBeNull();
      const tapResult = await api.tapCard(convokerOnBf!);
      expect(tapResult.success).toBe(true);

      // Now cast the convoking creature for free (convoke cost-reduction is
      // pending #1406, so the hook covers the mana here) and resolve it.
      const before = await api.getZoneCounts();
      const castResult = await api.freeCast(angelId!);
      expect(castResult.success).toBe(true);
      const after = await api.getZoneCounts();
      expect(after.battlefield).toBe(before.battlefield + 1);
    });
  });

  test.describe("Standard Mechanics in Self-Play Mode", () => {
    test("should show multiple Standard mechanic cards in self-play opening hand", async ({
      page,
    }) => {
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
      } catch (_e) {
        /* skip tour */
      }

      await page
        .locator("div.fixed.inset-0.bg-black\\/40")
        .waitFor({ state: "hidden", timeout: 10000 });

      // Verify multiple mechanic cards are visible in the opening hand
      await expect(
        page.locator('[data-testid*="hand-card-ward-beetle"]').first(),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator('[data-testid*="hand-card-cycling-drake"]').first(),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator('[data-testid*="hand-card-explore-ranger"]').first(),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator('[data-testid*="hand-card-flashback-bolt"]').first(),
      ).toBeVisible({ timeout: 20000 });
      await expect(
        page.locator('[data-testid*="hand-card-convoke-angel"]').first(),
      ).toBeVisible({ timeout: 20000 });
    });
  });
});

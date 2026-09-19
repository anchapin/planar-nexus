/**
 * Complex Combat E2E — blocking and combat damage math (CR 509 / CR 510),
 * issue #1914.
 *
 * Coverage split (see also e2e/stack-interaction.spec.ts):
 * - UI-driven: game start, land drop, land tap for mana, creature cast,
 *   attacker declaration by clicking the battlefield creature, phase
 *   advancement via the real control buttons, and outcome rendering
 *   (life totals, graveyard counts, battlefield updates).
 * - Engine-driven via the dev-only free-cast hook (`window.__TEST__`,
 *   issue #1431): the defender seat's actions. The self-play UI can only act
 *   as the named human seat ("Player"), so declaring blockers for the
 *   defender goes through the real `declareBlockers` engine call exposed by
 *   the hook. A full defender-seat UI (blocker picker for the non-active
 *   player) is a product gap tracked for follow-up — the wiring from engine
 *   combat state through React rendering IS covered here.
 *
 * Scenario (adapted from the original skipped test): P1 attacks with a
 * 2/2 Goblin Guide; the defender blocks with a 2/2 Grizzly Bears. Both
 * creatures trade (lethal damage both ways, CR 510.2), the defender takes no
 * combat damage (blocked, no trample), and both creatures land in their
 * owner's graveyards via state-based actions (CR 704.5f). The original
 * Memnite blocker (1/1) belonged to a per-test deck order that never
 * shipped; the 2/2-vs-2/2 trade exercises the same blocking math in both
 * directions.
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

test.describe("Complex Combat E2E", () => {
  test.beforeEach(async ({ page }) => {
    // DEV/TEST ONLY (issue #1431): opt the game page into attaching the
    // free-cast hook. Inert outside dev mode.
    await enableFreeCast(page);
    await seedCardDatabase(page);
    await page.goto("/single-player");
    await waitForDbSeed(page);
  });

  async function selectTestDeck(page: Page) {
    const deckSelect = page.locator("#self-play-deck");
    await deckSelect.click();
    await page.getByTestId("deck-option-starter-test").click();
  }

  async function startSelfPlaySession(page: Page) {
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

    await waitForFreeCastHook(page);
  }

  /**
   * Click "Advance Phase" until the phase tracker highlights `label`. The
   * tracker only renders text for the CURRENT phase, and each div carries a
   * stable title attribute, so this is unambiguous (e.g. title="Combat" is
   * begin_combat; "End Combat" is a different div).
   */
  async function advanceToPhase(page: Page, label: string) {
    const indicator = page.locator(
      `div[title="${label}"]:has-text("${label}")`,
    );
    const advanceBtn = page.getByRole("button", { name: "Advance Phase" });
    for (let i = 0; i < 8; i++) {
      await expect(advanceBtn).toBeVisible();
      await advanceBtn.click();
      try {
        await indicator.waitFor({ state: "visible", timeout: 3000 });
        return;
      } catch (_e) {
        /* phase not reached yet — keep advancing */
      }
    }
    throw new Error(`Did not reach the ${label} phase`);
  }

  test("should handle blocking and damage calculation correctly", async ({
    page,
  }) => {
    await startSelfPlaySession(page);
    const api = freeCastApi(page);
    const ids = await api.getPlayerIds();
    // In self-play the hook's "ai" id resolves to the second seat
    // ("You (Self Play)") — the defender in this scenario.
    const defenderId = ids.ai;

    // --- Per-test setup via the real engine (the deterministic
    // per-test-deck-order config from the original TODO never shipped) ---
    // Attacker-to-be: move a Goblin Guide from the library into P1's hand.
    // Goblin Guide has Haste in real Magic; the starter-test fixture has
    // empty oracle text, so patch it in (same pattern as
    // standard-mechanics.spec.ts) — otherwise summoning sickness correctly
    // forbids attacking the turn it resolves (CR 302.3).
    const goblinId = await api.findCardId({
      name: "Goblin Guide",
      zone: "library",
    });
    expect(goblinId).not.toBeNull();
    expect(await api.patchCardOracle(goblinId!, "Haste")).toBe(true);
    const moved = await api.moveCard(goblinId!, "hand");
    expect(moved.success).toBe(true);

    // Defender's blocker: the self-play opponent deck is the simple deck
    // (bears + basic lands), so the defender blocks with a Grizzly Bears.
    const bearId = await api.findCardId({
      name: "Grizzly Bears",
      zone: "library",
      playerId: defenderId,
    });
    expect(bearId).not.toBeNull();
    const placed = await api.moveCard(bearId!, "battlefield");
    expect(placed.success).toBe(true);

    // --- P1 turn, precombat main: play the opening-hand Mountain ---
    const mountain = page
      .locator('[data-testid*="hand-card-mountain"]')
      .first();
    await expect(mountain).toBeVisible({ timeout: 15000 });
    await mountain.click();

    const mountainOnBattlefield = page
      .locator('[data-testid*="battlefield-card-mountain"]')
      .first();
    await expect(mountainOnBattlefield).toBeVisible({ timeout: 25000 });

    // Tap the Mountain for {R} (real activateManaAbility path).
    await mountainOnBattlefield.click();

    // --- Cast Goblin Guide ({R}) through the real UI cast path ---
    const goblin = page
      .locator('[data-testid*="hand-card-goblin-guide"]')
      .first();
    await expect(goblin).toBeVisible({ timeout: 15000 });
    await goblin.click();
    // Gate on engine state (the toast text is duplicated by the live-region
    // announcer, so assert the spell reached the stack via the hook).
    await expect
      .poll(async () => await api.getCardZone(goblinId!), { timeout: 10000 })
      .toMatch(/^stack$/);

    // In self-play a UI cast is NOT auto-resolved (the auto-resolve branch
    // only exists for AI opponents), so the creature spell sits on the
    // stack until both seats pass priority. Advance Phase passes for
    // whoever holds priority, resolving the creature.
    const advanceBtn = page.getByRole("button", { name: "Advance Phase" });
    await expect(advanceBtn).toBeVisible();
    await advanceBtn.click();

    const goblinOnBattlefield = page
      .locator("[data-testid*='battlefield-card-goblin-guide']")
      .first();
    await expect(goblinOnBattlefield).toBeVisible({ timeout: 20000 });

    // --- Advance to Declare Attackers (Main 1 -> Combat -> Attack) ---
    await advanceToPhase(page, "Attack");

    // Declare the attacker by clicking the creature (real UI flow). Gate on
    // the toast so the declaration is committed before we pass priority.
    // (.first() — the live-region announcer duplicates toast text.)
    await goblinOnBattlefield.click();
    await expect(page.getByText("Attacker declared").first()).toBeVisible();

    // Pass priority to submit the declaration (P1 holds priority here as
    // the active player). Gate on the toast: the engine now has attackers.
    const passBtn = page.getByRole("button", { name: "Pass Priority" });
    await expect(passBtn).toBeVisible();
    await passBtn.click();
    await expect(page.getByText("Attackers declared").first()).toBeVisible();
    await advanceToPhase(page, "Block");

    // --- Defender declares the block through the real engine (the
    // self-play UI cannot act as the defender seat — see header note). ---
    const declared = await api.declareBlockers({ [goblinId!]: [bearId!] });
    expect(declared.success, JSON.stringify(declared)).toBe(true);

    // Both seats pass; entering the combat damage step resolves combat
    // (this is the #1914 fix — Advance Phase now resolves combat damage).
    await advanceBtn.click();

    // --- Assertions: 2/2 traded with 2/2, defender took nothing ---
    // Both creatures died via state-based actions (CR 704.5f).
    await expect
      .poll(async () => await api.getCardZone(goblinId!), {
        timeout: 10000,
      })
      .toMatch(/-graveyard$/);
    await expect
      .poll(async () => await api.getCardZone(bearId!), { timeout: 10000 })
      .toMatch(/-graveyard$/);

    // The attacker is gone from the battlefield.
    await expect(
      page.locator("[data-testid*='battlefield-card-goblin-guide']"),
    ).toHaveCount(0);

    // The defender (top seat) is untouched: blocked, no trample.
    // (Seat areas are keyed by sanitized player name — the self-play
    // opponent "You (Self Play)" yields a trailing dash.)
    const defenderArea = page.getByTestId("player-area-you-self-play-");
    await expect(defenderArea).toBeVisible();
    await expect(defenderArea.getByText("20", { exact: true })).toBeVisible();

    // The defender's discard pile holds the dead Bear.
    await expect(defenderArea.getByLabel("Discard Pile: 1 cards")).toBeVisible({
      timeout: 10000,
    });
  });
});

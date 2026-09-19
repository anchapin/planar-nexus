/**
 * Stack Interaction E2E — responding to a spell on the stack (CR 117.4 /
 * CR 701.5), issue #1914.
 *
 * Coverage split (see also e2e/complex-combat.spec.ts):
 * - UI-driven: game start, land drop, land tap for mana, targeted spell
 *   cast (targeting mode -> clicking the defender's zone), and outcome
 *   rendering (the defender's life total).
 * - Engine-driven via the dev-only free-cast hook (`window.__TEST__`,
 *   issue #1431): the defending seat's response. The self-play UI can only
 *   act as the named human seat and the stack UI component is currently
 *   unmounted, so the defender's counterspell and the LIFO/counter
 *   assertions go through the real engine calls exposed by the hook
 *   (`castOnStack` / `resolveStack` / `getStackInfo`). A defender-seat
 *   response UI is a product gap tracked for follow-up.
 *
 * Scenario (adapted from the original skipped test): P1 casts Lightning
 * Bolt targeting the defender; the defender responds with Counterspell
 * targeting the Bolt. The stack holds both spells in LIFO order
 * (Counterspell on top); when priority passes, only the Counterspell
 * resolves — the Bolt is countered (CR 701.5b: countered spell goes to its
 * OWNER's graveyard) and the defender never takes damage.
 *
 * The deterministic per-test deck order from the original TODO never
 * shipped, so the Bolt is pulled from the starter-test library and the
 * defender's counterspell is the established patch-a-simple-deck-card
 * pattern from standard-mechanics.spec.ts (oracle + type line patched onto
 * the opponent's simple-deck creature).
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

test.describe("Stack Interaction E2E", () => {
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

  test("should handle responding to a spell on the stack", async ({ page }) => {
    await startSelfPlaySession(page);
    const api = freeCastApi(page);
    const ids = await api.getPlayerIds();
    // In self-play the hook's "ai" id resolves to the second seat
    // ("You (Self Play)") — the responding player here.
    const responderId = ids.ai;

    // --- Per-test setup via the real engine ---
    // Pull a Lightning Bolt from the starter-test library into P1's hand
    // and give it a real instant body (the test fixture is a vanilla
    // creature card — same patch pattern as standard-mechanics).
    const boltId = await api.findCardId({
      name: "Lightning Bolt",
      zone: "library",
    });
    expect(boltId).not.toBeNull();
    const patchedBolt = await api.patchCardOracle(
      boltId!,
      "Lightning Bolt deals 3 damage to any target.",
      "Instant",
    );
    expect(patchedBolt).toBe(true);
    const movedBolt = await api.moveCard(boltId!, "hand");
    expect(movedBolt.success).toBe(true);

    // The responder's counterspell: patch a simple-deck creature in the
    // opponent's library into a functional Counterspell and move it to
    // their hand. ("Counter target spell." is parsed into a counter_spell
    // effect by the real effect-resolution layer.)
    const counterId = await api.findCardId({
      name: "Balduvian Bears",
      zone: "library",
      playerId: responderId,
    });
    expect(counterId).not.toBeNull();
    const patchedCounter = await api.patchCardOracle(
      counterId!,
      "Counter target spell.",
      "Instant",
    );
    expect(patchedCounter).toBe(true);
    const movedCounter = await api.moveCard(counterId!, "hand");
    expect(movedCounter.success).toBe(true);

    // --- P1 turn, precombat main: play and tap the opening-hand Mountain ---
    const mountain = page
      .locator('[data-testid*="hand-card-mountain"]')
      .first();
    await expect(mountain).toBeVisible({ timeout: 15000 });
    await mountain.click();

    const mountainOnBattlefield = page
      .locator('[data-testid*="battlefield-card-mountain"]')
      .first();
    await expect(mountainOnBattlefield).toBeVisible({ timeout: 25000 });
    await mountainOnBattlefield.click(); // tap for {R}

    // --- Cast Lightning Bolt through the real UI targeting flow ---
    const bolt = page
      .locator('[data-testid*="hand-card-lightning-bolt"]')
      .first();
    await expect(bolt).toBeVisible({ timeout: 15000 });
    await bolt.click(); // enters targeting mode ("any target")

    const responderArea = page.getByTestId("player-area-you-self-play-");
    await expect(responderArea).toBeVisible();
    await responderArea.getByLabel(/^Discard Pile/).click();

    // The stack UI is currently unmounted (stack-display.tsx is an orphaned
    // component), so assert the response window through the engine: the
    // spell sits on the stack awaiting priority passes (in self-play a UI
    // cast is NOT auto-resolved — that branch is AI-mode only).
    const stackAfterCast = await api.getStackInfo();
    expect(stackAfterCast).toHaveLength(1);
    expect(stackAfterCast[0].name).toBe("Lightning Bolt");
    const boltStackObjectId = stackAfterCast[0].id;

    // --- The responder answers on the stack (CR 117.4) ---
    const cast = await api.castOnStack(counterId!, {
      playerId: responderId,
      targetCardId: boltStackObjectId,
    });
    expect(cast.success).toBe(true);

    // LIFO: the Counterspell (cast second) is on top of the Bolt.
    const stackWithResponse = await api.getStackInfo();
    expect(stackWithResponse).toHaveLength(2);
    expect(stackWithResponse[0].name).toBe("Lightning Bolt");
    expect(stackWithResponse[1].name).toBe("Balduvian Bears");

    // Both seats pass -> only the top object (Counterspell) resolves.
    const resolved = await api.resolveStack();
    expect(resolved.success).toBe(true);

    // --- Assertions: the Bolt was countered, never resolved ---
    await expect
      .poll(async () => await api.getStackInfo(), { timeout: 10000 })
      .toHaveLength(0);

    // CR 701.5b — the countered spell's card goes to its OWNER's
    // graveyard (P1's, even though nothing else touched it).
    await expect
      .poll(async () => await api.getCardZone(boltId!), {
        timeout: 10000,
      })
      .toMatch(/-graveyard$/);

    // The resolved Counterspell itself landed in the responder's graveyard.
    await expect
      .poll(async () => await api.getCardZone(counterId!), {
        timeout: 10000,
      })
      .toMatch(/-graveyard$/);

    // The responder never took the 3 damage — the Bolt never resolved.
    await expect(responderArea.getByText("20", { exact: true })).toBeVisible();
  });
});

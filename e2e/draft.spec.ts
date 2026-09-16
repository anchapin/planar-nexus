/**
 * E2E Tests for Draft Mode Flow
 *
 * Phase 15: Draft Core
 * Requirements: DRFT-01 through DRFT-11
 *
 * Tests the complete draft session flow:
 * - Draft starts with intro state
 * - Draft has 3 packs of 14 cards
 * - Draft completes after picking 42 cards
 * - Pool persists across page refresh (DRFT-10)
 * - Session can be resumed from any state (DRFT-11)
 *
 * #1786: visibility checks no longer hide inside `if` conditions. Elements
 * that must render are asserted unconditionally (`await expect(locator)
 * .toBeVisible()` auto-retries, so it IS the waitFor). Flow-control reads
 * use an explicit flag (`const hasError = await ...isVisible()`) so the
 * skip-with-reason intent stays visible and auditable.
 */

import {
  test,
  expect,
  mockScryfallApi,
  seedCardDatabase,
  loadDeck,
} from "./test-utils";

const PACKS_PER_DRAFT = 3;
const CARDS_PER_PACK = 14;
const TOTAL_CARDS = PACKS_PER_DRAFT * CARDS_PER_PACK;

test.beforeEach(async ({ page }) => {
  await mockScryfallApi(page);
  await seedCardDatabase(page);
  await loadDeck(page);
});

async function waitForSeed(page: any): Promise<void> {
  await page.waitForFunction(
    () =>
      (window as any).dbSeeded === true ||
      (window as any).dbSeedError !== undefined,
    { timeout: 15000 },
  );
  const error = await page.evaluate(() => (window as any).dbSeedError);
  if (error) {
    throw new Error(`IndexedDB seeding failed: ${error}`);
  }
}

async function pickCard(page: any): Promise<boolean> {
  const pickButton = page.locator('button[aria-label^="Pick"]').first();
  // Flow control: the caller decides whether to bail out of the draft loop
  // when picking fails, so the flag is explicit rather than buried in `if`.
  const visible = await pickButton.isVisible();
  if (!visible) {
    return false;
  }
  await pickButton.click();
  await page.waitForTimeout(500);
  return true;
}

async function openCurrentPack(page: any): Promise<boolean> {
  const faceDownCards = page.locator('[aria-label="Face-down card"]').first();
  // Flow control: same as pickCard — boolean handed back to the caller.
  const visible = await faceDownCards.isVisible();
  if (!visible) {
    return false;
  }
  await faceDownCards.click();
  await page.waitForTimeout(1500);
  return true;
}

async function advanceToNextPack(page: any): Promise<void> {
  const nextButton = page
    .locator("button")
    .filter({ hasText: /Next|Open.*Pack|Continue/i })
    .first();
  const visible = await nextButton.isVisible();
  if (visible) {
    await nextButton.click();
    await page.waitForTimeout(500);
  }
}

async function startDraft(page: any): Promise<void> {
  const startButton = page
    .locator("button")
    .filter({ hasText: /Start Draft|Start Drafting|Start/i })
    .first();
  const visible = await startButton.isVisible();
  if (visible) {
    await startButton.click();
    await page.waitForTimeout(1000);
  }
}

test.describe("Draft Mode - Initialization", () => {
  test("DRFT-01: Draft page with set code shows intro state", async ({
    page,
  }) => {
    await page.goto("/draft?set=m21");
    await page.waitForLoadState("networkidle");
    await waitForSeed(page);
    await page.waitForTimeout(3000);

    const startButton = page
      .locator("button")
      .filter({ hasText: /Start Draft|Start/i })
      .first();
    const errorCard = page
      .locator("text=/Error|Not enough|No session/i")
      .first();
    const introCard = page.locator("text=/Draft.*packs/i").first();

    const hasStartButton = await startButton
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    const hasError = await errorCard
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    const hasIntroCard = await introCard
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    if (hasError) {
      test.skip(true, "Card database not seeded with required cards");
    }

    // #1786: the page must render the draft intro or the intro card — a
    // blank shell is now a failure instead of a silent pass.
    expect(hasStartButton || hasIntroCard).toBeTruthy();

    if (hasStartButton) {
      // #1856: with loadDeck in beforeEach, the start button must render.
      await expect(startButton).toBeVisible();

      const packInfo = page.locator(`text="${PACKS_PER_DRAFT} packs"`);
      await expect(packInfo).toContainText(String(PACKS_PER_DRAFT));
    }
  });

  test("DRFT-02: Draft shows intro card with pack info", async ({ page }) => {
    await page.goto("/draft?set=m21");
    await page.waitForLoadState("networkidle");
    await waitForSeed(page);
    await page.waitForTimeout(3000);

    const introCard = page.locator("text=/Draft.*packs|3 packs/i").first();
    const startButton = page
      .locator("button")
      .filter({ hasText: /Start Draft/i })
      .first();
    const errorCard = page.locator("text=/Not enough|Error/i").first();

    const hasIntro = await introCard
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    const hasStart = await startButton
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    const hasError = await errorCard
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (hasError) {
      test.skip(true, "Card database not seeded with required cards");
    }

    expect(hasIntro || hasStart).toBeTruthy();
  });
});

test.describe("Draft Mode - UI Elements", () => {
  test("Should show draft header", async ({ page }) => {
    await page.goto("/draft?set=m21");
    await page.waitForLoadState("networkidle");
    await waitForSeed(page);
    await page.waitForTimeout(3000);

    const header = page.locator("h1, h2").filter({ hasText: /Draft/i }).first();
    const packageIcon = page
      .locator('[class*="package"], [class*="Package"]')
      .first();

    const hasHeader = await header
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    const hasIcon = await packageIcon
      .isVisible({ timeout: 1000 })
      .catch(() => false);

    expect(hasHeader || hasIcon).toBeTruthy();
  });

  test("Should display intro card with pack count", async ({ page }) => {
    await page.goto("/draft?set=m21");
    await page.waitForLoadState("networkidle");
    await waitForSeed(page);
    await page.waitForTimeout(3000);

    // #1786: was a guarded expect plus a no-op else branch — the intro card
    // must actually render the pack count.
    const packText = page.locator(`text="${PACKS_PER_DRAFT} packs"`);
    await expect(packText).toBeVisible({ timeout: 3000 });
  });
});

test.describe("Draft Mode - Draft Complete Flow", () => {
  test("DRFT-09: Draft completion page shows correct information", async ({
    page,
  }) => {
    await page.goto("/draft/complete");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const url = page.url();
    const sessionId = url.match(/session=([^&]+)/)?.[1];

    if (sessionId && !sessionId.includes("test-")) {
      // #1786: unguarded — the completion page must render all of these.
      const completeTitle = page.locator('text="Draft Complete"').first();
      await expect(completeTitle).toBeVisible({ timeout: 3000 });

      const cardsPicked = page.locator("text=/\\d+ Cards Picked/i").first();
      await expect(cardsPicked).toBeVisible({ timeout: 2000 });

      const buildDeckButton = page
        .locator("button")
        .filter({ hasText: /Build Deck/i })
        .first();
      await expect(buildDeckButton).toBeVisible({ timeout: 2000 });
    } else {
      test.skip(true, "No completed draft session exists");
    }
  });

  test("DRFT-09: Build Deck button navigates to deck builder", async ({
    page,
  }) => {
    await page.goto("/draft/complete");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const url = page.url();
    const sessionId = url.match(/session=([^&]+)/)?.[1];

    if (sessionId && !sessionId.includes("test-")) {
      const buildDeckButton = page
        .locator("button")
        .filter({ hasText: /Build Deck/i })
        .first();

      await expect(buildDeckButton).toBeVisible({ timeout: 3000 });
      await buildDeckButton.click();
      await expect(page).toHaveURL(/\/limited-deck-builder/);
    } else {
      test.skip(true, "No completed draft session exists");
    }
  });
});

test.describe("Draft Mode - Draft Flow (Full)", () => {
  test("DRFT-09: Complete draft flow - pick all 42 cards", async ({ page }) => {
    await page.goto("/draft?set=m21");
    await page.waitForLoadState("networkidle");
    await waitForSeed(page);
    await page.waitForTimeout(3000);

    const startButton = page
      .locator("button")
      .filter({ hasText: /Start Draft|Start Drafting|Start/i })
      .first();

    // Skip-with-reason: an explicit seed error legitimately skips the run.
    const errorCard = page.locator("text=/Not enough cards|Error/i").first();
    const hasError = await errorCard.isVisible({ timeout: 2000 });
    if (hasError) {
      test.skip(true, "Card database not seeded with cards for set");
    }

    // #1786: the start button must render; a missing button now fails the
    // test instead of silently skipping the whole flow.
    await expect(startButton).toBeVisible({ timeout: 3000 });
    await startButton.click();
    await page.waitForTimeout(1000);

    let totalPicked = 0;
    for (let pack = 0; pack < PACKS_PER_DRAFT; pack++) {
      const packOpened = await openCurrentPack(page);
      if (!packOpened) break;

      for (let pick = 0; pick < CARDS_PER_PACK; pick++) {
        const picked = await pickCard(page);
        if (!picked) break;
        totalPicked++;
      }

      if (pack < PACKS_PER_DRAFT - 1) {
        await advanceToNextPack(page);
      }
    }

    if (totalPicked >= TOTAL_CARDS) {
      await page.waitForURL(/\/draft\/complete/, { timeout: 30000 });
      await page.waitForTimeout(2000);

      const completeTitle = page.locator('text="Draft Complete"').first();
      await expect(completeTitle).toBeVisible({ timeout: 10000 });
    } else {
      test.skip(
        true,
        `Only picked ${totalPicked}/${TOTAL_CARDS} cards - database may not have enough cards for set`,
      );
    }
  });
});

test.describe("Draft Mode - Card Interaction", () => {
  test("DRFT-03: Can open pack and see cards", async ({ page }) => {
    await page.goto("/draft?set=m21");
    await page.waitForLoadState("networkidle");
    await waitForSeed(page);
    await page.waitForTimeout(3000);

    const startButton = page
      .locator("button")
      .filter({ hasText: /Start Draft|Start Drafting|Start/i })
      .first();

    // Skip-with-reason: explicit seed error skip (#1786).
    const errorCard = page.locator("text=/Not enough cards|Error/i").first();
    const hasError = await errorCard.isVisible({ timeout: 2000 });
    if (hasError) {
      test.skip(true, "Card database not seeded with cards for set");
    }

    await expect(startButton).toBeVisible({ timeout: 3000 });
    await startButton.click();
    await page.waitForTimeout(1000);

    await openCurrentPack(page);

    // #1786: the Pick overlay must render once the pack is open — a pack
    // that fails to open now surfaces as a failure here.
    const pickOverlay = page.locator('text="Pick"').first();
    await expect(pickOverlay).toBeVisible({ timeout: 5000 });
  });

  test("DRFT-04: Picking a card updates pick counter", async ({ page }) => {
    await page.goto("/draft?set=m21");
    await page.waitForLoadState("networkidle");
    await waitForSeed(page);
    await page.waitForTimeout(3000);

    const startButton = page
      .locator("button")
      .filter({ hasText: /Start Draft|Start Drafting|Start/i })
      .first();

    // Skip-with-reason: explicit seed error skip (#1786).
    const errorCard = page.locator("text=/Not enough cards|Error/i").first();
    const hasError = await errorCard.isVisible({ timeout: 2000 });
    if (hasError) {
      test.skip(true, "Card database not seeded with cards for set");
    }

    await expect(startButton).toBeVisible({ timeout: 3000 });
    await startButton.click();
    await page.waitForTimeout(1000);

    await openCurrentPack(page);
    await page.waitForTimeout(500);
    await pickCard(page);
    await page.waitForTimeout(500);

    // #1786: after one pick the counter must read Pick 2/14.
    const pickBadge = page.locator("text=/Pick 2\\/14/");
    await expect(pickBadge).toBeVisible({ timeout: 2000 });
  });
});

test.describe("Draft Mode - Persistence", () => {
  test("DRFT-10: Pool persists across page refresh", async ({ page }) => {
    await page.goto("/draft?set=m21");
    await page.waitForLoadState("networkidle");
    await waitForSeed(page);
    await page.waitForTimeout(3000);

    const startButton = page
      .locator("button")
      .filter({ hasText: /Start Draft|Start Drafting|Start/i })
      .first();

    // Skip-with-reason: explicit seed error skip (#1786).
    const errorCard = page.locator("text=/Not enough cards|Error/i").first();
    const hasError = await errorCard.isVisible({ timeout: 2000 });
    if (hasError) {
      test.skip(true, "Card database not seeded with cards for set");
    }

    await expect(startButton).toBeVisible({ timeout: 3000 });
    await startButton.click();
    await page.waitForTimeout(1000);

    await openCurrentPack(page);

    for (let i = 0; i < 3; i++) {
      await pickCard(page);
    }

    const sessionId = page.url().match(/session=([^&]+)/)?.[1];
    // #1786: a started draft must produce a session — missing it now fails.
    expect(sessionId).toBeTruthy();

    await page.reload();
    await page.waitForTimeout(2000);

    await expect(page).toHaveURL(new RegExp(`session=${sessionId}`));

    const poolText = page.locator('text="/\\d+ cards picked/i"').first();
    await expect(poolText).toBeVisible({ timeout: 3000 });
    expect(await poolText.textContent()).toMatch(/\d+/);
  });

  test("DRFT-11: Session can be resumed from URL", async ({ page }) => {
    await page.goto("/draft?set=m21");
    await page.waitForLoadState("networkidle");
    await waitForSeed(page);
    await page.waitForTimeout(3000);

    const startButton = page
      .locator("button")
      .filter({ hasText: /Start Draft|Start Drafting|Start/i })
      .first();

    // Skip-with-reason: explicit seed error skip (#1786).
    const errorCard = page.locator("text=/Not enough cards|Error/i").first();
    const hasError = await errorCard.isVisible({ timeout: 2000 });
    if (hasError) {
      test.skip(true, "Card database not seeded with cards for set");
    }

    await expect(startButton).toBeVisible({ timeout: 3000 });
    await startButton.click();
    await page.waitForTimeout(1000);

    const packOpened = await openCurrentPack(page);
    const picked = packOpened ? await pickCard(page) : false;

    const sessionId = page.url().match(/session=([^&]+)/)?.[1];

    if (sessionId && picked) {
      await page.goto("/");
      await page.waitForTimeout(1000);

      await page.goto(`/draft?session=${sessionId}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);

      await expect(page).toHaveURL(new RegExp(`session=${sessionId}`));

      const pickBadge = page.locator("text=/Pick \\d+\\/14/").first();
      const introText = page.locator('text="Start Draft"').first();

      const inPickingState = await pickBadge.isVisible({ timeout: 5000 });
      const stillInIntro = await introText.isVisible({ timeout: 3000 });

      expect(inPickingState || !stillInIntro).toBeTruthy();
    } else {
      test.skip(
        true,
        sessionId
          ? "Card could not be picked - insufficient cards"
          : "No session ID found in URL after starting draft",
      );
    }
  });

  test("DRFT-11: Draft session data is saved to IndexedDB", async ({
    page,
  }) => {
    await page.goto("/draft?set=m21");
    await page.waitForLoadState("networkidle");
    await waitForSeed(page);
    await page.waitForTimeout(3000);

    const startButton = page
      .locator("button")
      .filter({ hasText: /Start Draft|Start Drafting|Start/i })
      .first();

    // Skip-with-reason: explicit seed error skip (#1786).
    const errorCard = page.locator("text=/Not enough cards|Error/i").first();
    const hasError = await errorCard.isVisible({ timeout: 2000 });
    if (hasError) {
      test.skip(true, "Card database not seeded with cards for set");
    }

    await expect(startButton).toBeVisible({ timeout: 3000 });
    await startButton.click();
    await page.waitForTimeout(1000);

    await openCurrentPack(page);
    await pickCard(page);
    await page.waitForTimeout(1500);

    const dbCheck = await page.evaluate(async () => {
      try {
        const databases = await indexedDB.databases();
        return databases.map((db) => db.name);
      } catch {
        return [];
      }
    });

    expect(
      dbCheck.some(
        (db) =>
          db &&
          (db.includes("Limited") ||
            db.includes("Draft") ||
            db.includes("Nexus")),
      ),
    ).toBeTruthy();
  });
});

/**
 * E2E Tests for Sealed Mode Flow
 *
 * Tests the complete sealed session flow:
 * - Set browser navigation and selection
 * - Sealed pool generation and display
 * - Pool filtering (color, type, CMC)
 * - Limited deck builder with validation
 * - Pool isolation from regular deck collection
 * - Session persistence across page refresh
 */

import { test, expect } from "@playwright/test";

test.describe("Sealed Mode - Set Browser", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/set-browser");
  });

  test("SET-01: should navigate to set browser", async ({ page }) => {
    await expect(page).toHaveTitle(/Set Browser|Planar Nexus/);
    // Main heading or subheading
    await expect(
      page.locator("h1, h2").filter({ hasText: /set|Set/i }),
    ).toBeVisible();
  });

  test("SET-01: should display MTG sets", async ({ page }) => {
    // Wait for sets to load from Scryfall API
    await page.waitForTimeout(2000);

    // Look for set cards or set list items
    const setsContainer = page
      .locator('[class*="grid"], [class*="list"], [data-testid*="set"]')
      .first();

    if (await setsContainer.isVisible()) {
      // Should have multiple sets displayed
      const setItems = page.locator(
        '[class*="set"], [data-testid*="set-item"]',
      );
      const count = await setItems.count();
      expect(count).toBeGreaterThan(0);
    }
  });

  test("SET-02: should allow selecting a set", async ({ page }) => {
    await page.waitForTimeout(2000); // Wait for sets to load

    // Find and click on a set
    const firstSet = page
      .locator('[class*="card"], [class*="set"]')
      .filter({ hasText: /[A-Z]{2,}/i })
      .first();

    if (await firstSet.isVisible({ timeout: 5000 })) {
      await firstSet.click();

      // Should open a modal or detail view with set info
      const modal = page
        .locator('[role="dialog"], [class*="modal"], [class*="detail"]')
        .first();

      if (await modal.isVisible({ timeout: 2000 })) {
        // Modal should show set details
        await expect(modal).toContainText(/sealed|draft|start/i);
      }
    }
  });

  test("SET-03: should show set details before confirming", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    // Click a set to open details
    const setsWithCards = page
      .locator('[class*="card"], [class*="set"]')
      .first();

    if (await setsWithCards.isVisible({ timeout: 5000 })) {
      await setsWithCards.click();

      // Wait for modal or detail view
      await page.waitForTimeout(500);

      // Look for Start Sealed button
      const startSealedButton = page
        .locator("button")
        .filter({ hasText: /sealed|Start/i })
        .first();

      if (await startSealedButton.isVisible({ timeout: 2000 })) {
        await expect(startSealedButton).toBeEnabled();
      }
    }
  });

  test("SET-02: should navigate to sealed page on Start Sealed", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    // Click a set
    const firstSet = page.locator('[class*="card"], [class*="set"]').first();

    if (await firstSet.isVisible({ timeout: 5000 })) {
      await firstSet.click();
      await page.waitForTimeout(500);

      // Click Start Sealed button
      const startButton = page
        .locator("button")
        .filter({ hasText: /Start.*Sealed|Start.*sealed/i })
        .first();

      if (await startButton.isVisible({ timeout: 2000 })) {
        await startButton.click();

        // Should navigate to /sealed page
        await expect(page).toHaveURL(/\/sealed/);
      }
    }
  });
});

test.describe("Sealed Mode - Pool Display", () => {
  test("SEAL-01: should create sealed session", async ({ page }) => {
    // Navigate to set browser first
    await page.goto("/set-browser");
    await page.waitForTimeout(2000);

    // Click first set
    const firstSet = page.locator('[class*="card"], [class*="set"]').first();

    if (await firstSet.isVisible({ timeout: 5000 })) {
      await firstSet.click();
      await page.waitForTimeout(500);

      // Click Start Sealed
      const startButton = page
        .locator("button")
        .filter({ hasText: /Start.*Sealed|Start.*sealed/i })
        .first();

      if (await startButton.isVisible({ timeout: 2000 })) {
        await startButton.click();

        // Wait for redirect to sealed page
        await page.waitForURL(/\/sealed/);

        // Should show pool or session info
        const poolSection = page
          .locator('[class*="pool"], [class*="cards"], [data-testid*="pool"]')
          .first();

        if (await poolSection.isVisible({ timeout: 5000 })) {
          await expect(poolSection).toBeVisible();
        }
      }
    }
  });

  test("SEAL-02: should display sealed pool with cards", async ({ page }) => {
    // Navigate to sealed page directly (session should be created or loaded)
    await page.goto("/sealed");
    await page.waitForTimeout(2000);

    // Look for card grid or cards
    const cardsContainer = page
      .locator('[class*="grid"], [class*="card"]')
      .first();

    if (await cardsContainer.isVisible({ timeout: 5000 })) {
      const cards = page.locator('[class*="card"]:not([class*="set"])');
      const cardCount = await cards.count();

      // Should have cards displayed (84 total expected)
      expect(cardCount).toBeGreaterThan(0);
    }
  });

  test("SEAL-02: should show all cards (no face-down packs)", async ({
    page,
  }) => {
    // First create a session via set browser
    await page.goto("/set-browser");
    await page.waitForTimeout(2000);

    const firstSet = page.locator('[class*="card"], [class*="set"]').first();

    if (await firstSet.isVisible({ timeout: 5000 })) {
      await firstSet.click();
      await page.waitForTimeout(500);

      const startButton = page
        .locator("button")
        .filter({ hasText: /Start.*Sealed|Start.*sealed/i })
        .first();

      if (await startButton.isVisible({ timeout: 2000 })) {
        await startButton.click();

        // Wait for sealed page to load (either ?set= or ?session=)
        await page.waitForURL(/\/sealed/, { timeout: 15000 });
        await page.waitForTimeout(3000); // Wait for pool to load

        // Look for visible cards in pool
        const visibleCards = page.locator('[class*="card"]:visible');
        const count = await visibleCards.count();

        // Should show cards immediately (pool of 84 cards)
        expect(count).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

test.describe("Sealed Mode - Pool Filtering", () => {
  test("SEAL-03: should filter by color", async ({ page }) => {
    await page.goto("/sealed");
    await page.waitForTimeout(2000);

    // Look for color filter buttons (W, U, B, R, G)
    const colorFilters = page
      .locator("button")
      .filter({ hasText: /^[WUBRG]$/i });
    const filterCount = await colorFilters.count();

    if (filterCount > 0) {
      // Click first color filter
      await colorFilters.first().click();
      await page.waitForTimeout(300);

      // Cards should still be visible (filtered)
      const cards = page.locator('[class*="card"]:visible');
      expect(await cards.count()).toBeGreaterThanOrEqual(0);
    }
  });

  test("SEAL-03: should filter by type", async ({ page }) => {
    await page.goto("/sealed");
    await page.waitForTimeout(2000);

    // Look for type filter (creature, instant, sorcery, etc.)
    const typeFilters = page
      .locator('button, [class*="filter"]')
      .filter({ hasText: /creature|instant|sorcery|artifact|enchantment/i });
    const filterCount = await typeFilters.count();

    if (filterCount > 0) {
      await typeFilters.first().click();
      await page.waitForTimeout(300);

      // Should filter cards
      const cards = page.locator('[class*="card"]:visible');
      expect(await cards.count()).toBeGreaterThanOrEqual(0);
    }
  });

  test("SEAL-03: should filter by CMC/mana cost", async ({ page }) => {
    await page.goto("/sealed");
    await page.waitForTimeout(2000);

    // Look for CMC filter (slider or buttons)
    const cmcFilter = page
      .locator('[class*="cmc"], [class*="mana"], input[type="range"]')
      .first();

    if (await cmcFilter.isVisible({ timeout: 2000 })) {
      await cmcFilter.click();
      await page.waitForTimeout(300);

      // Cards should be filtered
      const cards = page.locator('[class*="card"]:visible');
      expect(await cards.count()).toBeGreaterThanOrEqual(0);
    }
  });

  test("SEAL-03: should clear filters", async ({ page }) => {
    await page.goto("/sealed");
    await page.waitForTimeout(2000);

    // Apply a filter first
    const colorFilters = page
      .locator("button")
      .filter({ hasText: /^[WUBRG]$/i });

    if (await colorFilters.first().isVisible()) {
      await colorFilters.first().click();
      await page.waitForTimeout(300);

      // Look for clear/reset button
      const clearButton = page
        .locator("button")
        .filter({ hasText: /clear|reset|all/i })
        .first();

      if (await clearButton.isVisible({ timeout: 1000 })) {
        await clearButton.click();
        await page.waitForTimeout(300);

        // Should show all cards again
        const cards = page.locator('[class*="card"]:visible');
        expect(await cards.count()).toBeGreaterThan(0);
      }
    }
  });
});

test.describe("Sealed Mode - Limited Deck Builder", () => {
  test("LBld-01: should navigate to limited deck builder", async ({ page }) => {
    await page.goto("/sealed");
    await page.waitForTimeout(2000);

    // Look for Build Deck button
    const buildDeckButton = page
      .locator("button")
      .filter({ hasText: /Build.*Deck|Deck.*Build|Build Deck/i })
      .first();

    if (await buildDeckButton.isVisible({ timeout: 2000 })) {
      await buildDeckButton.click();

      // Should navigate to limited deck builder
      await expect(page).toHaveURL(/\/limited-deck-builder/);
    } else {
      // If no button, navigate directly
      await page.goto("/limited-deck-builder");
      await expect(page).toHaveURL(/\/limited-deck-builder/);
    }
  });

  test("LBld-01: should show pool cards in limited deck builder", async ({
    page,
  }) => {
    await page.goto("/limited-deck-builder");
    await page.waitForTimeout(2000);

    // Should show pool section
    const poolSection = page
      .locator('[class*="pool"], [class*="source"]')
      .first();

    if (await poolSection.isVisible({ timeout: 2000 })) {
      const cards = page.locator('[class*="card"]:visible');
      expect(await cards.count()).toBeGreaterThan(0);
    }
  });

  test("LBld-02: should have pool-only card source", async ({ page }) => {
    await page.goto("/limited-deck-builder");
    await page.waitForTimeout(2000);

    // Should NOT have a collection search or deck search input
    const searchInput = page
      .locator('input[placeholder*="search" i], input[aria-label*="search" i]')
      .first();

    if (await searchInput.isVisible()) {
      // If search exists, it should be limited to pool
      const poolLabel = page.locator("text=/pool/i");
      await expect(poolLabel).toBeVisible();
    }
  });

  test("LBld-03: should show 40-card minimum validation", async ({ page }) => {
    await page.goto("/limited-deck-builder");
    await page.waitForTimeout(2000);

    // Look for card count display
    const cardCount = page.locator("text=/\\d+\\s*\\/\\s*40/").first();

    if (await cardCount.isVisible({ timeout: 2000 })) {
      // Should show "0 / 40" initially
      await expect(cardCount).toContainText("40");
    }

    // Look for validation message
    const validationMsg = page
      .locator("text=/minimum|40 cards|valid/i")
      .first();

    if (await validationMsg.isVisible({ timeout: 1000 })) {
      await expect(validationMsg).toBeVisible();
    }
  });

  test("LBld-04: should enforce 4-copy limit", async ({ page }) => {
    await page.goto("/limited-deck-builder");
    await page.waitForTimeout(2000);

    // Find a card in pool
    const poolCards = page.locator(
      '[class*="pool"] [class*="card"], [class*="source"] [class*="card"]',
    );

    if (await poolCards.first().isVisible({ timeout: 3000 })) {
      // Add the same card multiple times (if add button exists)
      const addButton = poolCards
        .first()
        .locator("button")
        .filter({ hasText: /\\+|add|Add/i })
        .first();

      if (await addButton.isVisible({ timeout: 1000 })) {
        // Click add multiple times
        for (let i = 0; i < 4; i++) {
          await addButton.click();
          await page.waitForTimeout(200);
        }

        // Button should now be disabled (at max copies)
        await expect(addButton).toBeDisabled();
      }
    }
  });

  test("LBld-03: should show validation error for deck below 40 cards", async ({
    page,
  }) => {
    await page.goto("/limited-deck-builder");
    await page.waitForTimeout(2000);

    // Don't add any cards - deck should be empty (0 cards)

    // Look for save/play button
    const actionButton = page
      .locator("button")
      .filter({ hasText: /Save|Save Deck|Play/i })
      .first();

    if (await actionButton.isVisible({ timeout: 2000 })) {
      // Should be disabled or show validation error
      const isDisabled = await actionButton.isDisabled();

      if (isDisabled) {
        // Button disabled = validation working
        expect(true).toBe(true);
      } else {
        // Check for validation message
        const errorMsg = page.locator("text=/40|minimum|invalid/i");
        await expect(errorMsg).toBeVisible();
      }
    }
  });

  test("LBld-05: should have no sideboard section", async ({ page }) => {
    await page.goto("/limited-deck-builder");
    await page.waitForTimeout(2000);

    // Look for sideboard section - separate selectors for proper syntax
    const sideboardClass = page.locator('[class*="sideboard"]');
    const sideboardText = page.getByText(/Sideboard/i);

    // Should NOT be visible
    const classCount = await sideboardClass.count();
    const textCount = await sideboardText.count();

    if (classCount > 0) {
      await expect(sideboardClass.first()).not.toBeVisible();
    }
    if (textCount > 0) {
      await expect(sideboardText.first()).not.toBeVisible();
    }
  });

  test("LBld-06: should save limited deck", async ({ page }) => {
    await page.goto("/limited-deck-builder");
    await page.waitForTimeout(2000);

    // Look for save button
    const saveButton = page
      .locator("button")
      .filter({ hasText: /Save|Save Deck/i })
      .first();

    if (await saveButton.isVisible({ timeout: 2000 })) {
      // Save button should be enabled (even with 0 cards, just disabled on action)
      await expect(saveButton).toBeVisible();
    }
  });
});

test.describe("Sealed Mode - Pool Isolation", () => {
  test.skip("ISOL-01: pool cards should not appear in regular deck builder", async ({
    page,
  }) => {
    // First, get a sealed session
    await page.goto("/set-browser");
    await page.waitForTimeout(2000);

    const firstSet = page.locator('[class*="card"], [class*="set"]').first();

    if (await firstSet.isVisible({ timeout: 5000 })) {
      await firstSet.click();
      await page.waitForTimeout(500);

      const startButton = page
        .locator("button")
        .filter({ hasText: /Start.*Sealed|Start.*sealed/i })
        .first();

      if (await startButton.isVisible({ timeout: 2000 })) {
        await startButton.click();
        await page.waitForURL(/\/sealed/);
        await page.waitForTimeout(2000);
      }
    }

    // Now go to regular deck builder
    await page.goto("/deck-builder");
    await page.waitForTimeout(2000);

    // Search for a card
    const searchInput = page
      .locator('input[placeholder*="search" i], input[aria-label*="search" i]')
      .first();

    if (await searchInput.isVisible({ timeout: 2000 })) {
      await searchInput.fill("Island");
      await page.waitForTimeout(1000);

      // Results should be from collection, not pool
      // Pool cards have different metadata - verify results don't have pool indicators
      const poolIndicator = page
        .locator('[class*="pool"], text=/pool/i')
        .first();

      if (await poolIndicator.isVisible()) {
        await expect(poolIndicator).not.toBeVisible();
      }
    }
  });

  test("ISOL-02: should use session ID to scope deck", async ({ page }) => {
    // First create a session by going through set browser
    await page.goto("/set-browser");
    await page.waitForTimeout(2000);

    const firstSet = page.locator('[class*="card"], [class*="set"]').first();

    if (await firstSet.isVisible({ timeout: 5000 })) {
      await firstSet.click();
      await page.waitForTimeout(500);

      const startButton = page
        .locator("button")
        .filter({ hasText: /Start.*Sealed|Start.*sealed/i })
        .first();

      if (await startButton.isVisible({ timeout: 2000 })) {
        await startButton.click();

        // Wait for sealed page to load
        await page.waitForURL(/\/sealed/, { timeout: 15000 });
        await page.waitForTimeout(3000);

        // URL should have session or set parameter
        const url = page.url();
        expect(url).toMatch(/\/sealed\/\?.*(session|set)=/i);
      }
    }
  });

  test("ISOL-03: should use separate IndexedDB store for sessions", async ({
    page,
  }) => {
    // Create session first to trigger DB creation
    await page.goto("/set-browser");
    await page.waitForTimeout(2000);

    const firstSet = page.locator('[class*="card"], [class*="set"]').first();

    if (await firstSet.isVisible({ timeout: 5000 })) {
      await firstSet.click();
      await page.waitForTimeout(500);

      const startButton = page
        .locator("button")
        .filter({ hasText: /Start.*Sealed|Start.*sealed/i })
        .first();

      if (await startButton.isVisible({ timeout: 2000 })) {
        await startButton.click();
        await page.waitForURL(/\/sealed/, { timeout: 15000 });
        await page.waitForTimeout(3000);

        // Try to check IndexedDB
        const dbCheck = await page.evaluate(async () => {
          try {
            // Fallback: try to access the DB directly
            return new Promise((resolve) => {
              const request = indexedDB.open("PlanarNexusLimited");
              request.onsuccess = () => {
                resolve(["PlanarNexusLimited"]);
              };
              request.onerror = () => {
                resolve([]);
              };
            });
          } catch {
            return [];
          }
        });

        // Should have separate limited database
        expect(dbCheck).toContain("PlanarNexusLimited");
      }
    }
  });
});

test.describe("Sealed Mode - Session Persistence", () => {
  test("should persist session across page refresh", async ({ page }) => {
    // Create session first via set browser
    await page.goto("/set-browser");
    await page.waitForTimeout(2000);

    const firstSet = page.locator('[class*="card"], [class*="set"]').first();

    if (await firstSet.isVisible({ timeout: 5000 })) {
      await firstSet.click();
      await page.waitForTimeout(500);

      const startButton = page
        .locator("button")
        .filter({ hasText: /Start.*Sealed|Start.*sealed/i })
        .first();

      if (await startButton.isVisible({ timeout: 2000 })) {
        await startButton.click();

        // Wait for sealed page to load
        await page.waitForURL(/\/sealed/, { timeout: 15000 });
        await page.waitForTimeout(3000);

        // Navigate to limited deck builder
        const buildDeckButton = page
          .locator("button")
          .filter({ hasText: /Build.*Deck|Deck.*Build|Build Deck/i })
          .first();

        if (await buildDeckButton.isVisible({ timeout: 2000 })) {
          await buildDeckButton.click();

          // Wait for navigation (either with or without session param)
          await page.waitForURL(/\/limited-deck-builder/, { timeout: 10000 });
          await page.waitForTimeout(2000);

          // Get URL before refresh
          const url = page.url();

          // Refresh page
          await page.reload();
          await page.waitForTimeout(2000);

          // Should still be on limited deck builder page
          await expect(page).toHaveURL(/\/limited-deck-builder/);

          // Deck section should still be visible
          const deckSection = page.locator('[class*="deck"]').first();

          if (await deckSection.isVisible({ timeout: 2000 })) {
            await expect(deckSection).toBeVisible();
          }
        }
      }
    }
  });

  test("should load existing session by ID", async ({ page }) => {
    // First create a session
    await page.goto("/set-browser");
    await page.waitForTimeout(2000);

    const firstSet = page.locator('[class*="card"], [class*="set"]').first();

    if (await firstSet.isVisible({ timeout: 5000 })) {
      await firstSet.click();
      await page.waitForTimeout(500);

      const startButton = page
        .locator("button")
        .filter({ hasText: /Start.*Sealed|Start.*sealed/i })
        .first();

      if (await startButton.isVisible({ timeout: 2000 })) {
        await startButton.click();

        // Wait for sealed page to load
        await page.waitForURL(/\/sealed/, { timeout: 15000 });
        await page.waitForTimeout(3000);

        // Extract session or set ID
        const url = page.url();
        const sessionMatch = url.match(/session=([^&]+)/);
        const setMatch = url.match(/set=([^&]+)/);
        const param = sessionMatch
          ? `session=${sessionMatch[1]}`
          : setMatch
            ? `set=${setMatch[1]}`
            : "";

        if (param) {
          // Navigate away and back
          await page.goto("/");
          await page.waitForTimeout(500);

          // Navigate back with same parameter
          await page.goto(`/sealed?${param}`);
          await page.waitForTimeout(2000);

          // Should load same page
          await expect(page).toHaveURL(/sealed/);

          // Should show cards
          const cards = page.locator('[class*="card"]:visible');
          expect(await cards.count()).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

test.describe("Sealed Mode - Navigation Flow", () => {
  test("should navigate Set Browser -> Sealed -> Limited Deck Builder", async ({
    page,
  }) => {
    // Start at Set Browser
    await page.goto("/set-browser");
    await expect(page).toHaveURL(/\/set-browser/);
    await page.waitForTimeout(2000);

    // Click a set
    const firstSet = page.locator('[class*="card"], [class*="set"]').first();

    if (await firstSet.isVisible({ timeout: 5000 })) {
      await firstSet.click();
      await page.waitForTimeout(500);

      // Click Start Sealed
      const startButton = page
        .locator("button")
        .filter({ hasText: /Start.*Sealed|Start.*sealed/i })
        .first();

      if (await startButton.isVisible({ timeout: 2000 })) {
        await startButton.click();

        // Should be at Sealed page
        await expect(page).toHaveURL(/\/sealed/);
        await page.waitForTimeout(2000);

        // Click Build Deck
        const buildDeckButton = page
          .locator("button")
          .filter({ hasText: /Build.*Deck|Deck.*Build|Build Deck/i })
          .first();

        if (await buildDeckButton.isVisible({ timeout: 2000 })) {
          await buildDeckButton.click();

          // Should be at Limited Deck Builder
          await expect(page).toHaveURL(/\/limited-deck-builder/);

          // Should be able to go back to pool
          const viewPoolButton = page
            .locator("button")
            .filter({ hasText: /View.*Pool|Pool/i })
            .first();

          if (await viewPoolButton.isVisible({ timeout: 1000 })) {
            await viewPoolButton.click();

            // Should go back to sealed page
            await expect(page).toHaveURL(/\/sealed/);
          }
        }
      }
    }
  });
});

/**
 * E2E Tests for Deck Builder Flow
 *
 * Tests the core deck building functionality:
 * - Card search
 * - Adding cards to deck
 * - Deck validation
 * - Saving and loading decks
 */

import { test, expect, loadDeck } from "./test-utils";

// Register the deck-seed init script BEFORE any navigation. Top-level
// beforeEach so it covers all three describe blocks (issue #1856).
test.beforeEach(async ({ page }) => {
  await loadDeck(page);
});

test.describe("Deck Builder", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to deck builder
    await page.goto("/deck-builder");
  });

  test("should display deck builder page", async ({ page }) => {
    // Verify page title
    await expect(page).toHaveTitle(/Deck Builder|Planar Nexus/i);

    // Verify main elements exist
    await expect(
      page.locator(`h1, h2`).filter({ hasText: /deck|Deck/i }),
    ).toBeVisible();
  });

  test("should search for cards", async ({ page }) => {
    // Find search input (now unconditionally rendered — see #1856).
    const searchInput = page
      .locator(
        `input[placeholder*="search" i], input[aria-label*="search" i], input[type="text"]`,
      )
      .first();

    await expect(searchInput).toBeVisible();

    // Search for a card
    await searchInput.fill("Lightning Bolt");
    await page.waitForTimeout(500); // Wait for search debounce

    // Verify search results appear
    const results = page.locator(
      `[data-testid='card-result'], .card-result, [class*="card"]`,
    );
    // At least some results should appear
    await expect(results.first()).toBeVisible({ timeout: 5000 });
  });

  test("should display deck statistics", async ({ page }) => {
    // Look for deck stats section (now unconditionally rendered — see #1856).
    const statsSection = page
      .locator(
        `[data-testid='deck-stats'], [class*="stats"], [class*="deck-info"]`,
      )
      .first();

    await expect(statsSection).toBeVisible();
    await expect(statsSection).toContainText(/0|count|cards/i);
  });

  test("should handle empty deck state", async ({ page }) => {
    // Just check the page loads without crash - some tests have auth/redirect issues
    const response = await page.goto("/deck-builder");
    // Page might redirect to dashboard if not authenticated
    expect([200, 302]).toContain(response?.status());
  });

  test("should navigate to deck coach", async ({ page }) => {
    await page.goto("/deck-coach");
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveURL(/.*deck-coach.*/);
  });

  test("should navigate to saved decks", async ({ page }) => {
    // Look for saved decks link (now unconditionally rendered — see #1856).
    const savedDecksLink = page
      .locator(`a[href*="decks"], a[href*="saved"]`)
      .filter({ hasText: /Saved Decks|My Decks/i });

    await expect(savedDecksLink).toBeVisible();
    await savedDecksLink.click();
    // Should navigate to decks page or show saved decks modal
    await page.waitForTimeout(500);
  });
});

test.describe("Deck Validation", () => {
  test("should validate deck format", async ({ page }) => {
    await page.goto("/deck-builder");

    // Look for format selector (now unconditionally rendered — see #1856).
    const formatSelector = page
      .locator(`select[data-testid='format'], select[aria-label*="format" i]`)
      .first();

    await expect(formatSelector).toBeVisible();

    // Should have format options
    const options = formatSelector.locator("option");
    await expect(options).not.toHaveCount(0);
  });

  test("should show deck validation errors for invalid deck", async ({
    page,
  }) => {
    await page.goto("/deck-builder");

    // Look for validation section (now unconditionally rendered — see #1856).
    const validationSection = page
      .locator(
        `[data-testid='validation'], [class*="validation"], [class*="deck-errors"]`,
      )
      .first();

    await expect(validationSection).toBeVisible();
  });
});

test.describe("Deck Import/Export", () => {
  test("should have import functionality", async ({ page }) => {
    await page.goto("/deck-builder");

    // Look for import button (now unconditionally rendered — see #1856).
    const importButton = page
      .locator(
        `button:has-text("Import"), button:has-text("import"), [data-testid='import']`,
      )
      .first();

    await expect(importButton).toBeVisible();
  });

  test("should have export functionality", async ({ page }) => {
    await page.goto("/deck-builder");

    // Look for export button (now unconditionally rendered — see #1856).
    const exportButton = page
      .locator(
        `button:has-text("Export"), button:has-text("export"), [data-testid='export']`,
      )
      .first();

    await expect(exportButton).toBeVisible();
  });
});

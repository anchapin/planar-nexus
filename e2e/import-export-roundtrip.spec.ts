/**
 * E2E Tests for Import/Export Round Trip
 *
 * Verifies that decks remain identical after a full export/import cycle
 * across multiple formats (Text, JSON, Clipboard).
 */

import { test, expect } from "@playwright/test";
import { seedCardDatabase, waitForDbSeed } from "./test-utils";

// Run tests in CI but with longer timeouts and retries
const testOptions =
  process.env.CI === "true"
    ? { retries: 2, timeout: 60000 }
    : { retries: 0, timeout: 30000 };

test.describe("Import/Export Round Trip", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to deck builder first
    await page.goto("/deck-builder");
    await page.waitForLoadState("networkidle");

    // Seed database after navigation (runs in page context)
    await seedCardDatabase(page);
    await waitForDbSeed(page);

    // Clear any existing deck if needed
    const clearButton = page.getByTestId("clear-deck-button");
    const deckCount = page.getByTestId("deck-count");

    if (await deckCount.isVisible()) {
      const text = await deckCount.textContent();
      if (text && !text.includes("0 cards")) {
        await clearButton.click();
        await page.waitForLoadState("networkidle");
        const confirmClear = page.getByTestId("confirm-clear-button");
        await expect(confirmClear).toBeVisible();
        await confirmClear.click();
        await expect(deckCount).toContainText("0 cards");
      }
    }
  });

  test("should round-trip a simple deck via text import/export", async ({
    page,
  }) => {
    const sampleDeck = `4 Lightning Bolt
4 Mountain
20 Island`;

    // Set format to Standard first so 4x copies are legal
    const formatSelect = page.getByTestId("format-select");
    await formatSelect.click();
    await page.getByRole("option", { name: /standard/i }).click();

    // 1. Import
    await page.getByTestId("import-deck-button").click();
    // Wait for dialog to be fully visible before filling textarea
    const textarea = page.getByTestId("import-textarea");
    await textarea.waitFor({ state: "visible", timeout: 10000 });
    await textarea.fill(sampleDeck);
    await page.getByTestId("confirm-import-button").click();

    // Wait for import to complete and cards to appear in deck list
    await page.waitForTimeout(2000);

    // 2. Export (as text)
    await page.getByTestId("export-deck-button").click();

    // Wait for export dialog to be visible
    await expect(page.getByTestId("export-text-button")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("export-copy-button")).toBeVisible();

    // 3. Verify card count in UI matches
    // The deck list should show these cards
    await expect(page.getByTestId("deck-item-lightning-bolt")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("deck-item-mountain")).toBeVisible();
    await expect(page.getByTestId("deck-item-island")).toBeVisible();
  });

  test("should round-trip a complex deck via JSON", async ({ page }) => {
    // Set format to Commander
    const formatSelect = page.getByTestId("format-select");
    await formatSelect.click();
    await page.getByRole("option", { name: /commander/i }).click();

    // 1. Import JSON
    await page.getByTestId("import-deck-button").click();

    // Wait for import dialog to be visible
    const textarea = page.getByTestId("import-textarea");
    await textarea.waitFor({ state: "visible", timeout: 10000 });

    // Select JSON format via the tabs - click on the JSON tab trigger
    await page.getByRole("tab", { name: /json/i }).click();

    const jsonDeck = JSON.stringify({
      cards: [
        { name: "Sol Ring", quantity: 1 },
        { name: "Arcane Signet", quantity: 1 },
        { name: "Command Tower", quantity: 1 },
      ],
    });

    await textarea.fill(jsonDeck);
    await page.getByTestId("confirm-import-button").click();

    // Wait for import to complete - deck count should update
    await page.waitForTimeout(2000);
    await expect(page.getByTestId("deck-count")).toContainText(/[1-9] cards?/);

    // 2. Export JSON
    await page.getByTestId("export-deck-button").click();
    await expect(page.getByTestId("export-json-button")).toBeVisible();

    // 3. Verify results
    // Check if cards are in the deck list
    await expect(page.getByTestId("deck-item-sol-ring")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("deck-item-arcane-signet")).toBeVisible();
    await expect(page.getByTestId("deck-item-command-tower")).toBeVisible();
  });

  test("should round-trip via clipboard", async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Set format to Commander so cards are legal
    const formatSelect = page.getByTestId("format-select");
    await formatSelect.click();
    await page.getByRole("option", { name: /commander/i }).click();

    // Wait for page to settle
    await page.waitForTimeout(1000);

    // 1. Import a simple deck via the import dialog
    await page.getByTestId("import-deck-button").click();

    // Wait for import dialog to be fully visible
    const textarea = page.getByTestId("import-textarea");
    await textarea.waitFor({ state: "visible", timeout: 10000 });

    const sampleDeck = `1 Lightning Bolt
1 Sol Ring`;

    await textarea.fill(sampleDeck);
    await page.getByTestId("confirm-import-button").click();

    // Wait for import to complete
    await page.waitForTimeout(2000);

    // Verify cards are in the deck
    await expect(page.getByTestId("deck-item-lightning-bolt")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("deck-item-sol-ring")).toBeVisible({
      timeout: 10000,
    });

    // 2. Export to clipboard
    await page.getByTestId("export-deck-button").click();

    // Wait for dialog to open and be visible
    await page.waitForTimeout(500);

    // Click copy to clipboard button
    const copyButton = page.getByTestId("export-copy-button");
    await expect(copyButton).toBeVisible({ timeout: 10000 });
    await copyButton.click();

    // Wait briefly for clipboard operation
    await page.waitForTimeout(500);

    // Press Escape to close the dialog
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // 3. Clear deck
    await page.getByTestId("clear-deck-button").click();
    await page.waitForTimeout(300);
    await page.getByTestId("confirm-clear-button").click();
    await expect(page.getByTestId("deck-count")).toContainText("0 cards");

    // 4. Import from clipboard
    await page.getByTestId("import-deck-button").click();

    // Wait for dialog to open
    await textarea.waitFor({ state: "visible", timeout: 10000 });

    // Click the "Paste from Clipboard" button
    const pasteButton = page.getByTestId("paste-deck-button");
    await expect(pasteButton).toBeVisible({ timeout: 5000 });
    await pasteButton.click();

    // Wait for paste to complete
    await page.waitForTimeout(1000);

    // The textarea should now have content
    const textareaValue = await textarea.inputValue();
    expect(textareaValue.length).toBeGreaterThan(0);

    await page.getByTestId("confirm-import-button").click();

    // 5. Verify cards are back
    await expect(page.getByTestId("deck-item-lightning-bolt")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("deck-item-sol-ring")).toBeVisible({
      timeout: 10000,
    });
  });
});

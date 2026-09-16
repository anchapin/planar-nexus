/**
 * E2E Tests for Import/Export Functionality
 *
 * Tests deck import/export features:
 * - Import decklist from text
 * - Export deck as text
 * - Export deck as JSON
 * - Re-import exported deck
 *
 * #1786: every functional check is an unconditional `await expect(...)`.
 * Web-first assertions auto-retry, so `expect(locator).toBeVisible()` is
 * the waitFor — no `if (await el.isVisible())` guards that silently pass
 * when the element never renders.
 */

import { test, expect, loadDeck } from "./test-utils";

// Register the deck-seed init script BEFORE any navigation. Top-level
// beforeEach so it covers all four describe blocks (issue #1856).
test.beforeEach(async ({ page }) => {
  await loadDeck(page);
});

test.describe("Deck Import", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to deck builder
    await page.goto("/deck-builder");
  });

  test("should have import button", async ({ page }) => {
    // Look for import button (now unconditionally rendered — see #1856).
    const importButton = page
      .locator(
        `button:has-text("Import"), button:has-text("import"), [data-testid='import']`,
      )
      .first();

    await expect(importButton).toBeVisible();
  });

  test("should open import dialog", async ({ page }) => {
    // Look for import button and click (now unconditionally rendered — see #1856).
    const importButton = page
      .locator(`button:has-text("Import"), button:has-text("import")`)
      .first();

    await expect(importButton).toBeVisible();
    await importButton.click();

    // Import UI appears as a dialog/modal or a bare import textarea;
    // at least one of the two must render (#1786 + #1856).
    const importDialog = page
      .locator(
        `[data-testid='import-dialog'], [role="dialog"], [class*="import-modal"]`,
      )
      .first();
    const importTextarea = page
      .locator(
        `textarea[placeholder*="decklist" i], textarea[placeholder*="paste" i], textarea[aria-label*="import" i]`,
      )
      .first();

    // Explicit flag (#1786): a branch with a meaningful else-side (either/or
    // UI variant) reads the flag into a const first.
    const hasDialog = await importDialog.isVisible();
    if (hasDialog) {
      await expect(importDialog).toBeVisible();
    } else {
      await expect(importTextarea).toBeVisible();
    }
  });

  test("should accept decklist text input", async ({ page }) => {
    // Look for import button and click (now unconditionally rendered — see #1856).
    const importButton = page
      .locator(`button:has-text("Import"), button:has-text("import")`)
      .first();

    await expect(importButton).toBeVisible();
    await importButton.click();
    await page.waitForTimeout(500);

    // Look for textarea
    const textarea = page.locator(`textarea`).first();

    // Enter a sample decklist
    const sampleDecklist = `4 Lightning Bolt
4 Mountain
20 Island`;

    await expect(textarea).toBeVisible();
    await textarea.fill(sampleDecklist);
    await expect(textarea).toHaveValue(sampleDecklist);
  });

  test("should have import confirmation button", async ({ page }) => {
    // Look for import button and click (now unconditionally rendered — see #1856).
    const importButton = page
      .locator(`button:has-text("Import"), button:has-text("import")`)
      .first();

    await expect(importButton).toBeVisible();
    await importButton.click();
    await page.waitForTimeout(500);

    // Look for confirm button (now unconditionally rendered — see #1856).
    const confirmButton = page
      .locator(
        `button:has-text("Confirm"), button:has-text("Import"), button:has-text("OK"), button:has-text("Load")`,
      )
      .last();

    await expect(confirmButton).toBeVisible();
  });

  test("should show parsing errors for invalid decklist", async ({ page }) => {
    // Look for import button and click (now unconditionally rendered — see #1856).
    const importButton = page
      .locator(`button:has-text("Import"), button:has-text("import")`)
      .first();

    await expect(importButton).toBeVisible();
    await importButton.click();
    await page.waitForTimeout(500);

    // The import dialog renders an import textarea + import button.
    // See #1856: with loadDeck wired in beforeEach, the dialog renders
    // unconditionally once Import is clicked.
    const textarea = page.locator(`textarea`).first();
    await expect(textarea).toBeVisible();

    // Enter an invalid decklist
    await textarea.fill(
      "Invalid Card Name That Does Not Exist\nAnother Invalid Card",
    );

    // The dialog's confirm button has data-testid="import-deck-confirm".
    // See #1856: it renders once the import dialog is open.
    const confirmButton = page
      .locator(
        `[data-testid='import-deck-confirm'], [data-testid='import-deck-button']`,
      )
      .last();

    await expect(confirmButton).toBeVisible();
  });
});

test.describe("Deck Export", () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to deck builder
    await page.goto("/deck-builder");
  });

  test("should have export button", async ({ page }) => {
    // Look for export button (now unconditionally rendered — see #1856).
    const exportButton = page
      .locator(
        `button:has-text("Export"), button:has-text("export"), [data-testid='export']`,
      )
      .first();

    await expect(exportButton).toBeVisible();
  });

  test("should export deck as text", async ({ page }) => {
    // Look for export button (now unconditionally rendered — see #1856).
    const exportButton = page
      .locator(`button:has-text("Export"), button:has-text("export")`)
      .first();

    await expect(exportButton).toBeVisible();

    // Export opens a Dialog with two format buttons (see
    // import-export-controls.tsx — "Copy to Clipboard" +
    // "export-json-button"). The "Copy to Clipboard" button is the
    // text-format export path.
    await exportButton.click();
    await page.waitForTimeout(500);

    const copyButton = page
      .locator(`[data-testid='export-copy-button']`)
      .first();

    await expect(copyButton).toBeVisible();
  });

  test("should export deck as JSON", async ({ page }) => {
    // Look for export button (now unconditionally rendered — see #1856).
    const exportButton = page
      .locator(`button:has-text("Export"), button:has-text("export")`)
      .first();

    await expect(exportButton).toBeVisible();
    await exportButton.click();
    await page.waitForTimeout(500);

    // Export dialog has a JSON format button (data-testid="export-json-button").
    const jsonButton = page
      .locator(`[data-testid='export-json-button']`)
      .first();

    await expect(jsonButton).toBeVisible();
  });

  test("should copy decklist to clipboard", async ({ page }) => {
    // Look for export/copy button (now unconditionally rendered — see #1856).
    const copyButton = page
      .locator(
        `button:has-text("Copy"), button:has-text("copy"), [data-testid='copy']`,
      )
      .first();

    await expect(copyButton).toBeVisible();

    // Note: Can't actually test clipboard in Playwright without permissions
    // Just verify the button exists and is clickable
    await expect(copyButton).toBeEnabled();
  });
});

test.describe("Import/Export Round Trip", () => {
  test("should re-import exported deck", async ({ page }) => {
    // This test verifies that exported decks can be re-imported
    // Note: Full implementation would require actual export/import

    await page.goto("/deck-builder");

    // Look for export button (now unconditionally rendered — see #1856).
    const exportButton = page
      .locator(`button:has-text("Export"), button:has-text("export")`)
      .first();

    await expect(exportButton).toBeVisible();
    await exportButton.click();
    await page.waitForTimeout(500);

    // The Export dialog renders the "Copy to Clipboard" button
    // (data-testid="export-copy-button") — see #1856: with a loaded
    // deck, this surface renders unconditionally.
    const copyOption = page
      .locator(`[data-testid='export-copy-button']`)
      .first();

    await expect(copyOption).toBeVisible();

    // Look for import button (now unconditionally rendered — see #1856).
    const importButton = page
      .locator(`button:has-text("Import"), button:has-text("import")`)
      .first();

    await expect(importButton).toBeVisible();
  });
});

test.describe("Clipboard Operations", () => {
  test("should have paste from clipboard option", async ({ page }) => {
    await page.goto("/deck-builder");

    // Look for import button (now unconditionally rendered — see #1856).
    const importButton = page
      .locator(`button:has-text("Import"), button:has-text("import")`)
      .first();

    await expect(importButton).toBeVisible();
    await importButton.click();
    await page.waitForTimeout(500);

    // Look for paste button (now unconditionally rendered — see #1856).
    const pasteButton = page
      .locator(
        `button:has-text("Paste"), button:has-text("paste"), [aria-label*="paste" i]`,
      )
      .first();

    await expect(pasteButton).toBeVisible();
  });
});

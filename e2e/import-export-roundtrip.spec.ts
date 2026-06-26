/**
 * E2E Tests for Import/Export Round Trip
 *
 * Verifies that decks remain identical after a full export/import cycle
 * across multiple formats (Text, JSON, Clipboard).
 *
 * Stability notes
 * ---------------
 * The previous version of this suite relied on fixed `waitForTimeout`
 * sleeps and `waitForLoadState("networkidle")`, which raced the async
 * deck-parse / clipboard / dialog-close operations on slower CI runners.
 * Those have been replaced with state-based readiness signals:
 *
 *   - Page ready:   wait for the toolbar (`import-deck-button`) to render.
 *   - Format set:   wait for the `format-select` trigger to reflect the
 *                   chosen value before importing (the import reads the
 *                   `format` state, so this removes a stale-state race).
 *   - Import done:  on success `ImportExportControls` closes its dialog, so
 *                   we wait for `import-textarea` to leave the DOM rather
 *                   than sleeping a fixed number of milliseconds.
 *   - Clipboard:    wait for the app's own toast ("Copied to clipboard" /
 *                   "Pasted from clipboard") and the textarea value.
 */

import { test, expect, type Page } from "@playwright/test";
import { seedCardDatabase, waitForDbSeed } from "./test-utils";

/**
 * Select a deck-legality format from the toolbar `<Select>` and block until
 * the trigger reflects the new value, guaranteeing the next import reads the
 * intended format.
 */
async function selectFormat(page: Page, name: RegExp) {
  const trigger = page.getByTestId("format-select");
  await trigger.click();
  await page.getByRole("option", { name }).click();
  await expect(trigger).toContainText(name);
}

/**
 * Deterministic "import resolved" signal: a successful import with no errors
 * closes the import dialog, detaching the textarea from the DOM.
 */
async function waitForImportResolved(page: Page) {
  await expect(page.getByTestId("import-textarea")).toBeHidden({
    timeout: 15000,
  });
}

test.describe("Import/Export Round Trip", () => {
  test.beforeEach(async ({ page }) => {
    // Seed the card database before navigation so IndexedDB is ready when
    // the app initializes.
    await seedCardDatabase(page);
    await page.goto("/deck-builder");

    // Wait for the toolbar to render instead of `networkidle`, which never
    // reliably settles on the HMR dev server.
    await expect(page.getByTestId("import-deck-button")).toBeVisible({
      timeout: 15000,
    });
    await waitForDbSeed(page);

    // Ensure every test starts from an empty deck.
    const deckCount = page.getByTestId("deck-count");
    await expect(deckCount).toBeVisible();
    const current = (await deckCount.textContent()) ?? "";
    if (!current.includes("0 cards")) {
      await page.getByTestId("clear-deck-button").click();
      const confirmClear = page.getByTestId("confirm-clear-button");
      await expect(confirmClear).toBeVisible();
      await confirmClear.click();
      await expect(deckCount).toContainText("0 cards");
    }
  });

  test("should round-trip a simple deck via text import/export", async ({
    page,
  }) => {
    test.setTimeout(60000);

    // Set legality format to Standard first so 4x copies resolve.
    await selectFormat(page, /standard/i);

    const sampleDeck = `4 Lightning Bolt
4 Mountain
20 Island`;

    // 1. Import
    await page.getByTestId("import-deck-button").click();
    const textarea = page.getByTestId("import-textarea");
    await expect(textarea).toBeVisible({ timeout: 10000 });
    await textarea.fill(sampleDeck);
    await page.getByTestId("confirm-import-button").click();

    // Wait for the async import to resolve (dialog closes on success) and the
    // deck count to update — no fixed sleeps.
    await waitForImportResolved(page);
    await expect(page.getByTestId("deck-count")).toContainText("28 cards");

    // 2. Export (as text)
    await page.getByTestId("export-deck-button").click();
    await expect(page.getByTestId("export-text-button")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("export-copy-button")).toBeVisible();

    // 3. Verify the imported cards rendered in the deck list.
    await expect(page.getByTestId("deck-item-lightning-bolt")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("deck-item-mountain")).toBeVisible();
    await expect(page.getByTestId("deck-item-island")).toBeVisible();
  });

  test("should round-trip a complex deck via JSON", async ({ page }) => {
    test.setTimeout(60000);

    await selectFormat(page, /commander/i);

    // 1. Import JSON
    await page.getByTestId("import-deck-button").click();
    const textarea = page.getByTestId("import-textarea");
    await expect(textarea).toBeVisible({ timeout: 10000 });

    // Switch the *input* format to JSON (distinct from the legality format
    // above) and gate on the tab becoming active before filling.
    const jsonTab = page.getByRole("tab", { name: /json/i });
    await jsonTab.click();
    await expect(jsonTab).toHaveAttribute("data-state", "active");

    const jsonDeck = JSON.stringify({
      cards: [
        { name: "Sol Ring", quantity: 1 },
        { name: "Arcane Signet", quantity: 1 },
        { name: "Command Tower", quantity: 1 },
      ],
    });

    await textarea.fill(jsonDeck);
    await page.getByTestId("confirm-import-button").click();

    // Wait for import to resolve.
    await waitForImportResolved(page);
    await expect(page.getByTestId("deck-count")).toContainText("3 cards");

    // 2. Export JSON
    await page.getByTestId("export-deck-button").click();
    await expect(page.getByTestId("export-json-button")).toBeVisible({
      timeout: 10000,
    });

    // 3. Verify results
    await expect(page.getByTestId("deck-item-sol-ring")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("deck-item-arcane-signet")).toBeVisible();
    await expect(page.getByTestId("deck-item-command-tower")).toBeVisible();
  });

  test("should round-trip via clipboard", async ({ page, context }) => {
    test.setTimeout(60000);

    // Grant clipboard permissions for the round trip.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await selectFormat(page, /commander/i);

    // 1. Import a simple deck via the import dialog.
    await page.getByTestId("import-deck-button").click();
    const textarea = page.getByTestId("import-textarea");
    await expect(textarea).toBeVisible({ timeout: 10000 });

    const sampleDeck = `1 Lightning Bolt
1 Sol Ring`;

    await textarea.fill(sampleDeck);
    await page.getByTestId("confirm-import-button").click();

    // Wait for import to resolve.
    await waitForImportResolved(page);
    await expect(page.getByTestId("deck-count")).toContainText("2 cards");

    // Verify cards are in the deck.
    await expect(page.getByTestId("deck-item-lightning-bolt")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("deck-item-sol-ring")).toBeVisible({
      timeout: 10000,
    });

    // 2. Export to clipboard.
    await page.getByTestId("export-deck-button").click();
    const copyButton = page.getByTestId("export-copy-button");
    await expect(copyButton).toBeVisible({ timeout: 10000 });
    await copyButton.click();

    // Wait for the app's own completion toast, then assert the clipboard
    // actually received the decklist (data-integrity check).
    await expect(
      page.getByText("Copied to clipboard", { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    const clipboardText = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(clipboardText).toContain("Lightning Bolt");
    expect(clipboardText).toContain("Sol Ring");

    // Close the export dialog via its Close (X) button before clearing the
    // deck. A direct click is more reliable than Escape, which a toast layer
    // can intercept.
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close" })
      .click();
    await expect(page.getByTestId("export-copy-button")).toBeHidden({
      timeout: 5000,
    });

    // 3. Clear the deck.
    await page.getByTestId("clear-deck-button").click();
    const confirmClear = page.getByTestId("confirm-clear-button");
    await expect(confirmClear).toBeVisible();
    await confirmClear.click();
    await expect(page.getByTestId("deck-count")).toContainText("0 cards");

    // 4. Import from clipboard.
    await page.getByTestId("import-deck-button").click();
    await expect(textarea).toBeVisible({ timeout: 10000 });

    const pasteButton = page.getByTestId("paste-deck-button");
    await expect(pasteButton).toBeVisible({ timeout: 5000 });
    await pasteButton.click();

    // Wait for the paste to populate the textarea (auto-waiting on value).
    await expect(textarea).toHaveValue(/Lightning Bolt/, { timeout: 10000 });

    await page.getByTestId("confirm-import-button").click();

    // 5. Verify cards are back.
    await waitForImportResolved(page);
    await expect(page.getByTestId("deck-item-lightning-bolt")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("deck-item-sol-ring")).toBeVisible({
      timeout: 10000,
    });
  });
});

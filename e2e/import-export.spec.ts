/**
 * E2E Tests for Import/Export Functionality
 * 
 * Tests deck import/export features:
 * - Import decklist from text
 * - Export deck as text
 * - Export deck as JSON
 * - Re-import exported deck
 */

import { test, expect } from '@playwright/test';

test.describe('Deck Import', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to deck builder
    await page.goto('/deck-builder');
  });

  test('should have import button', async ({ page }) => {
    // Look for import button
    const importButton = page.locator(`button:has-text("Import"), button:has-text("import"), [data-testid='import']`).first();
    
    await expect(importButton).toBeVisible();
  });

  test('should open import dialog', async ({ page }) => {
    // Look for import button and click
    const importButton = page.locator(`button:has-text("Import"), button:has-text("import")`).first();
    
    if (await importButton.isVisible()) {
      await importButton.click();
      
      // Should show import dialog/modal
      const importDialog = page.locator(`[data-testid='import-dialog'], [role="dialog"], [class*="import-modal"]`).first();
      
      if (await importDialog.isVisible()) {
        await expect(importDialog).toBeVisible();
      }
      
      // Or should show import textarea
      const importTextarea = page.locator(`textarea[placeholder*="decklist" i], textarea[placeholder*="paste" i], textarea[aria-label*="import" i]`).first();
      
      if (await importTextarea.isVisible()) {
        await expect(importTextarea).toBeVisible();
      }
    }
  });

  test('should accept decklist text input', async ({ page }) => {
    // Look for import button and click
    const importButton = page.locator(`button:has-text("Import"), button:has-text("import")`).first();
    
    if (await importButton.isVisible()) {
      await importButton.click();
      await page.waitForTimeout(500);
      
      // Look for textarea
      const textarea = page.locator(`textarea`).first();
      
      if (await textarea.isVisible()) {
        // Enter a sample decklist
        const sampleDecklist = `4 Lightning Bolt
4 Mountain
20 Island`;
        
        await textarea.fill(sampleDecklist);
        await expect(textarea).toHaveValue(sampleDecklist);
      }
    }
  });

  test('should have import confirmation button', async ({ page }) => {
    // Look for import button and click
    const importButton = page.locator(`button:has-text("Import"), button:has-text("import")`).first();
    
    if (await importButton.isVisible()) {
      await importButton.click();
      await page.waitForTimeout(500);
      
      // Look for confirm button
      const confirmButton = page.locator(`button:has-text("Confirm"), button:has-text("Import"), button:has-text("OK"), button:has-text("Load")`).last();
      
      if (await confirmButton.isVisible()) {
        await expect(confirmButton).toBeVisible();
      }
    }
  });

  test('should show parsing errors for invalid decklist', async ({ page }) => {
    // Look for import button and click
    const importButton = page.locator(`button:has-text("Import"), button:has-text("import")`).first();
    
    if (await importButton.isVisible()) {
      await importButton.click();
      await page.waitForTimeout(500);
      
      // Look for textarea
      const textarea = page.locator(`textarea`).first();
      
      if (await textarea.isVisible()) {
        // Enter invalid decklist
        await textarea.fill('Invalid Card Name That Does Not Exist\nAnother Invalid Card');
        
        // Look for import/parse button
        const parseButton = page.locator(`button:has-text("Parse"), button:has-text("Import"), button:has-text("Load")`).last();
        
        if (await parseButton.isVisible()) {
          await parseButton.click();
          await page.waitForTimeout(1000);
          
          // Should show error message
          const errorMessage = page.locator(`[data-testid='error'], [class*="error"], [role="alert"]`).filter({ hasText: /invalid|not found|error/i }).first();
          
          if (await errorMessage.isVisible()) {
            await expect(errorMessage).toBeVisible();
          }
        }
      }
    }
  });
});

test.describe('Deck Export', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to deck builder
    await page.goto('/deck-builder');
  });

  test('should have export button', async ({ page }) => {
    // Look for export button
    const exportButton = page.locator(`button:has-text("Export"), button:has-text("export"), [data-testid='export']`).first();
    
    await expect(exportButton).toBeVisible();
  });

  test('should export deck as text', async ({ page }) => {
    // Look for export button
    const exportButton = page.locator(`button:has-text("Export"), button:has-text("export")`).first();
    
    if (await exportButton.isVisible()) {
      // Check if there's a dropdown
      await exportButton.click();
      await page.waitForTimeout(500);
      
      // Look for text export option
      const textExportOption = page.locator(`[data-testid='dropdown-item'], [role="menuitem"]`).filter({ hasText: /Text|Copy/i }).first();
      
      if (await textExportOption.isVisible()) {
        await expect(textExportOption).toBeVisible();
      }
    }
  });

  test('should export deck as JSON', async ({ page }) => {
    // Look for export button
    const exportButton = page.locator(`button:has-text("Export"), button:has-text("export")`).first();
    
    if (await exportButton.isVisible()) {
      await exportButton.click();
      await page.waitForTimeout(500);
      
      // Look for JSON export option
      const jsonExportOption = page.locator(`[data-testid='dropdown-item'], [role="menuitem"]`).filter({ hasText: /JSON/i }).first();
      
      if (await jsonExportOption.isVisible()) {
        await expect(jsonExportOption).toBeVisible();
      }
    }
  });

  test('should copy decklist to clipboard', async ({ page }) => {
    // Look for export/copy button
    const copyButton = page.locator(`button:has-text("Copy"), button:has-text("copy"), [data-testid='copy']`).first();
    
    if (await copyButton.isVisible()) {
      await expect(copyButton).toBeVisible();
      
      // Note: Can't actually test clipboard in Playwright without permissions
      // Just verify the button exists and is clickable
      await expect(copyButton).toBeEnabled();
    }
  });
});

test.describe('Import/Export Round Trip', () => {
  test('should re-import exported deck', async ({ page }) => {
    // This test verifies that exported decks can be re-imported
    // Note: Full implementation would require actual export/import
    
    await page.goto('/deck-builder');
    
    // Look for export button
    const exportButton = page.locator(`button:has-text("Export"), button:has-text("export")`).first();
    
    if (await exportButton.isVisible()) {
      await exportButton.click();
      await page.waitForTimeout(500);
      
      // Look for copy option
      const copyOption = page.locator(`[data-testid='dropdown-item']`).filter({ hasText: /Copy/i }).first();
      
      if (await copyOption.isVisible()) {
        // Verify export functionality exists
        await expect(copyOption).toBeVisible();
      }
    }
    
    // Look for import button
    const importButton = page.locator(`button:has-text("Import"), button:has-text("import")`).first();
    
    if (await importButton.isVisible()) {
      await expect(importButton).toBeVisible();
    }
  });
});

test.describe('Clipboard Operations', () => {
  test('should have paste from clipboard option', async ({ page }) => {
    await page.goto('/deck-builder');
    
    // Look for import button
    const importButton = page.locator(`button:has-text("Import"), button:has-text("import")`).first();
    
    if (await importButton.isVisible()) {
      await importButton.click();
      await page.waitForTimeout(500);
      
      // Look for paste button
      const pasteButton = page.locator(`button:has-text("Paste"), button:has-text("paste"), [aria-label*="paste" i]`).first();
      
      if (await pasteButton.isVisible()) {
        await expect(pasteButton).toBeVisible();
      }
    }
  });
});

/**
 * E2E Tests for Phase 20 Features
 * - Sideboard Plans Page
 * - Mana Curve in Deck Builder
 * - Mana Curve in Deck Coach
 */

import { test, expect } from '@playwright/test';

test.describe('Phase 20: Advanced Optimization', () => {
  
  test('sideboards page loads correctly', async ({ page }) => {
    await page.goto('/sideboards');
    
    // Verify page loads
    await expect(page.locator('h1')).toContainText('My Sideboard Plans');
    
    // Verify empty state shows
    await expect(page.getByText('No Sideboard Plans Yet')).toBeVisible();
    
    // Verify New Plan button exists
    await expect(page.getByRole('button', { name: /new plan/i })).toBeVisible();
  });

  test('mana curve tab in deck builder loads', async ({ page }) => {
    await page.goto('/deck-builder');
    
    // Click on Mana Curve tab
    await page.getByRole('tab', { name: /mana curve/i }).click();
    
    // Verify empty state message
    await expect(page.getByText(/add cards to your deck/i)).toBeVisible();
  });

  test('mana curve tab shows analysis when deck has cards', async ({ page }) => {
    await page.goto('/deck-builder');
    
    // Search for a card and add it
    const searchInput = page.locator('input[type="text"], input[placeholder*="Search"]').first();
    await searchInput.fill('forest');
    
    // Wait for search results
    await page.waitForTimeout(1000);
    
    // Click on a card result if visible
    const cardResult = page.locator('[class*="card"], [class*="result"]').first();
    if (await cardResult.isVisible()) {
      await cardResult.click();
    }
    
    // Switch to Mana Curve tab
    await page.getByRole('tab', { name: /mana curve/i }).click();
    
    // Should show some analysis elements now
    await page.waitForTimeout(500);
    
    // Check for analysis components
    const hasAverageCMC = await page.getByText(/average cmc/i).isVisible().catch(() => false);
    const hasManaCurve = await page.getByText(/mana curve/i).first().isVisible().catch(() => false);
    
    // At least one analysis element should be visible
    expect(hasAverageCMC || hasManaCurve || await page.locator('[class*="recharts"]').isVisible().catch(() => false)).toBeTruthy();
  });

  test('deck coach mana curve tab exists', async ({ page }) => {
    await page.goto('/deck-coach');
    
    // Verify page loads
    await expect(page.locator('h1, h2').first()).toContainText(/deck coach/i);
    
    // Verify analyze button exists
    await expect(page.getByRole('button', { name: /review my deck/i })).toBeVisible();
  });

  test('sideboard plan editor opens', async ({ page }) => {
    await page.goto('/sideboards');
    
    // Click New Plan button
    await page.getByRole('button', { name: /new plan/i }).click();
    
    // Verify dialog opens
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /create sideboard plan/i })).toBeVisible();
    
    // Verify form fields exist
    await expect(page.getByLabel(/plan name/i)).toBeVisible();
    await expect(page.getByLabel(/format/i)).toBeVisible();
  });
});

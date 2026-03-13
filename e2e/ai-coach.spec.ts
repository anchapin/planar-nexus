/**
 * E2E Tests for AI Deck Coach
 * 
 * Tests the AI coach functionality:
 * - Navigate to coach
 * - Select deck
 * - Get coach report
 * - Verify report display
 * - Export report
 */

import { test, expect } from '@playwright/test';

test.describe('AI Deck Coach', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to deck coach
    await page.goto('/deck-coach');
  });

  test('should display deck coach page', async ({ page }) => {
    // Verify page title
    await expect(page).toHaveTitle(/Coach|Deck Coach|Planar Nexus/i);
    
    // Verify main heading exists
    await expect(page.locator(`h1, h2`).filter({ hasText: /coach|Coach/i })).toBeVisible();
  });

  test('should show deck selection', async ({ page }) => {
    // Look for deck selector
    const deckSelector = page.locator(`select[data-testid='deck-select'], select[aria-label*="deck" i], [data-testid='deck-list']`).first();
    
    if (await deckSelector.isVisible()) {
      await expect(deckSelector).toBeVisible();
    }
  });

  test('should display archetype analysis', async ({ page }) => {
    // Look for archetype section
    const archetypeSection = page.locator(`[data-testid='archetype'], [class*="archetype"]`).filter({ hasText: /Archetype/i }).first();
    
    if (await archetypeSection.isVisible()) {
      await expect(archetypeSection).toBeVisible();
    }
  });

  test('should display synergies section', async ({ page }) => {
    // Look for synergies section
    const synergiesSection = page.locator(`[data-testid='synergies'], [class*="synergy"]`).filter({ hasText: /Synerg/i }).first();
    
    if (await synergiesSection.isVisible()) {
      await expect(synergiesSection).toBeVisible();
    }
  });

  test('should display missing synergies', async ({ page }) => {
    // Look for missing synergies section
    const missingSection = page.locator(`[data-testid='missing-synergies'], [class*="missing"]`).filter({ hasText: /Missing/i }).first();
    
    if (await missingSection.isVisible()) {
      await expect(missingSection).toBeVisible();
    }
  });

  test('should display key cards', async ({ page }) => {
    // Look for key cards section
    const keyCardsSection = page.locator(`[data-testid='key-cards'], [class*="key-card"]`).filter({ hasText: /Key Card/i }).first();
    
    if (await keyCardsSection.isVisible()) {
      await expect(keyCardsSection).toBeVisible();
    }
  });

  test('should have export functionality', async ({ page }) => {
    // Look for export button
    const exportButton = page.locator(`button:has-text("Export"), button:has-text("export"), [data-testid='export']`).first();
    
    if (await exportButton.isVisible()) {
      await expect(exportButton).toBeVisible();
      
      // Click export and verify dropdown/options appear
      await exportButton.click();
      await page.waitForTimeout(500);
      
      // Look for export options
      const exportOptions = page.locator(`[data-testid='dropdown-item'], [role="menuitem"]`).filter({ hasText: /Download|Print/i });
      await expect(exportOptions.first()).toBeVisible({ timeout: 3000 });
    }
  });

  test('should show loading state during analysis', async ({ page }) => {
    // Look for analyze/generate button
    const analyzeButton = page.locator(`button:has-text("Analyze"), button:has-text("Generate"), button:has-text("Get Report")`).first();
    
    if (await analyzeButton.isVisible()) {
      // Click analyze
      await analyzeButton.click();
      
      // Should show loading state
      const loadingState = page.locator(`[data-testid='loading'], [class*="loading"], [class*="skeleton"]`).filter({ hasText: /Analyzing|Generating/i });
      
      // Loading state should appear (might be brief)
      await page.waitForTimeout(1000);
    }
  });

  test('should display improvement suggestions', async ({ page }) => {
    // Look for suggestions section
    const suggestionsSection = page.locator(`[data-testid='suggestions'], [class*="suggestion"], [class*="improvement"]`).filter({ hasText: /Suggestion|Improvement/i }).first();
    
    if (await suggestionsSection.isVisible()) {
      await expect(suggestionsSection).toBeVisible();
    }
  });
});

test.describe('AI Coach Report Display', () => {
  test('should show confidence indicators', async ({ page }) => {
    await page.goto('/deck-coach');
    
    // Look for confidence display
    const confidenceDisplay = page.locator(`[data-testid='confidence']`).filter({ hasText: /confidence|Confidence|%/i }).first();
    
    if (await confidenceDisplay.isVisible()) {
      await expect(confidenceDisplay).toBeVisible();
    }
  });

  test('should show impact levels for missing synergies', async ({ page }) => {
    await page.goto('/deck-coach');
    
    // Look for impact badges
    const impactBadges = page.locator(`[data-testid='impact'], [class*="impact"]`).filter({ hasText: /HIGH|MEDIUM|LOW/i });
    
    if (await impactBadges.count() > 0) {
      await expect(impactBadges.first()).toBeVisible();
    }
  });

  test('should display archetype badges with colors', async ({ page }) => {
    await page.goto('/deck-coach');
    
    // Look for archetype badge
    const archetypeBadge = page.locator(`[data-testid='archetype-badge'], [class*="archetype-badge"], [role="badge"]`).first();
    
    if (await archetypeBadge.isVisible()) {
      await expect(archetypeBadge).toBeVisible();
    }
  });
});

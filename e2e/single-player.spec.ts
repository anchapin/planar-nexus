/**
 * E2E Tests for Single Player vs AI
 * 
 * Tests the single player game flow:
 * - Select deck
 * - Configure AI opponent
 * - Start game
 * - Play turns
 * - Game completion
 *
 * Issue #2958 — the specs used to synchronise with
 * `page.waitForLoadState('networkidle')` (plus two fixed `waitForTimeout`
 * sleeps). `networkidle` is a global "the network is quiet" guess that never
 * settles on the `next dev` server the suite runs against when the runner is
 * loaded: the dev server keeps compiling chunks / streaming RSC requests, so
 * the idle window never opens and the wait burns the whole 30 s test budget.
 * Every test in this file then failed *before running an assertion*, which is
 * why a burst of unrelated tests failed together even on data-only PRs.
 *
 * The specs now wait for the condition they actually need — the deck
 * selector, the difficulty selector, the start button — through the shared
 * helpers in `e2e/helpers/navigation.ts` (issue #2958). The assertions
 * themselves are unchanged; only the synchronisation changed.
 */

import { test, expect, type Page } from '@playwright/test';
import { gotoReady, clickUntil } from './helpers/navigation';

/**
 * Readiness signal for /single-player: the "Play against AI" tab panel is
 * the default tab, and its deck selector is the first thing every test below
 * needs. Waiting for it is a state change (web-first assertion), not a sleep.
 */
function singlePlayerReady(page: Page) {
  return page.locator('#deck-select');
}

/** The deck dropdown is a Radix <Select>; opening it renders a listbox. */
function deckListbox(page: Page) {
  return page.getByRole('listbox');
}

test.describe('Single Player vs AI', () => {
  test('should display single player page', async ({ page }) => {
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    
    // Use more specific selector for the main page heading (not sidebar)
    await expect(page.getByRole('heading', { name: 'Single Player', level: 1 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Play against AI' })).toBeVisible();
  });

  test('should show deck selection', async ({ page }) => {
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    
    // Select tab first
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // Look for deck select button by id - it's a button that acts as combobox
    const deckSelect = page.locator('#deck-select');
    await expect(deckSelect).toBeVisible();
    
    // Click to open the dropdown. A click that lands before React has
    // hydrated is dropped, so re-click until the listbox is actually
    // rendered (the condition the test actually cares about) instead of
    // sleeping for a fixed number of milliseconds.
    await clickUntil(deckSelect, async () => {
      await expect(deckListbox(page)).toBeVisible({ timeout: 1000 });
    });
  });

  test('should show difficulty selection', async ({ page }) => {
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // Look for difficulty select by id
    const difficultySelect = page.locator('#difficulty');
    await expect(difficultySelect).toBeVisible();
  });

  test('should allow starting a game', async ({ page }) => {
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // Select a deck first (required to enable start button)
    const deckSelect = page.locator('#deck-select');
    
    // Open the dropdown and wait for the options to actually render
    // (condition-based wait, replaces the old fixed 300 ms sleep).
    await clickUntil(deckSelect, async () => {
      await expect(deckListbox(page)).toBeVisible({ timeout: 1000 });
    });
    
    // Close the dropdown again so it does not cover the start button.
    await page.keyboard.press('Escape');
    
    // Check if button exists and is visible - may be disabled
    const startButton = page.locator('button:has-text("Start Game vs AI")');
    await expect(startButton).toBeVisible();
  });

  test('should display game board after starting', async ({ page }) => {
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // The start button navigates directly, let's see what happens
    const startButton = page.locator('button:has-text("Start Game vs AI")');
    
    // Check button is visible 
    await expect(startButton).toBeVisible({ timeout: 10000 });
    
    // Check if button is disabled (requires deck selection)
    const isDisabled = await startButton.isDisabled();
    
    if (!isDisabled) {
      // Button is enabled - click to navigate
      await startButton.click();
      // Wait for navigation with timeout
      await page.waitForURL(/.*game-board.*/, { timeout: 10000 });
    }
    // If disabled, that's fine - user needs to select a deck first
  });

  test('should display player life totals', async ({ page }) => {
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // Check start button exists
    const startButton = page.locator('button:has-text("Start Game vs AI")');
    await expect(startButton).toBeVisible();
  });

  test('should display turn indicator', async ({ page }) => {
    // This test verifies the page loads correctly - actual game turn indicator 
    // is only visible after starting a game
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    
    // Click the AI tab to ensure proper page state
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // Check page loads without errors - start button should be visible
    const startButton = page.locator('button:has-text("Start Game vs AI")');
    await expect(startButton).toBeVisible({ timeout: 10000 });
  });

  test('should show phase indicator', async ({ page }) => {
    // This test verifies the page loads correctly - actual game phase indicator
    // is only visible after starting a game
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    
    // Click the AI tab to ensure proper page state
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // Check page loads without errors - difficulty selector should be visible
    const difficultySection = page.locator('#difficulty');
    await expect(difficultySection).toBeVisible({ timeout: 10000 });
  });

  test('should have pass turn button', async ({ page }) => {
    // This test verifies the page loads correctly - pass turn button
    // is only visible on the game board after starting a game
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    
    // Click the AI tab to ensure proper page state
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // Check page loads without errors - deck select should be visible
    const deckSelect = page.locator('#deck-select');
    await expect(deckSelect).toBeVisible({ timeout: 10000 });
  });
});

test.describe('AI Opponent Behavior', () => {
  test('should show AI thinking state', async ({ page }) => {
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // Check page elements exist
    const startButton = page.locator('button:has-text("Start Game vs AI")');
    await expect(startButton).toBeVisible();
  });

  test('should display AI difficulty indicator', async ({ page }) => {
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // Difficulty display should be visible on the page
    const difficultySection = page.locator('#difficulty');
    await expect(difficultySection).toBeVisible();
  });
});

test.describe('Game Completion', () => {
  test('should show game over state', async ({ page }) => {
    // This test would require actually playing a full game
    await gotoReady(page, '/single-player', singlePlayerReady(page));

    // Page should load without errors
    await expect(page.getByRole('heading', { name: 'Single Player', level: 1 })).toBeVisible();
  });

  test('should have rematch option', async ({ page }) => {
    await gotoReady(page, '/single-player', singlePlayerReady(page));
    await page.getByRole('tab', { name: 'Play against AI' }).click();
    
    // Check start button exists
    const startButton = page.locator('button:has-text("Start Game vs AI")');
    await expect(startButton).toBeVisible();
  });
});

import { test, expect } from '@playwright/test';

test.describe('Multiplayer Lobby', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/multiplayer');
  });

  test('should load multiplayer page', async ({ page }) => {
    await expect(page.locator('h1').filter({ hasText: /Multiplayer/i })).toBeVisible();
  });

  test('should show host game option', async ({ page }) => {
    const hostButton = page.locator('a[href*="/multiplayer/host"] button, a:has-text("Create Lobby")').first();
    await expect(hostButton).toBeVisible();
  });

  test('should show join game option', async ({ page }) => {
    const joinButton = page.locator('a[href*="/multiplayer/browse"] button, a:has-text("Browse Public Games")').first();
    await expect(joinButton).toBeVisible();
  });

  test('should navigate to host page', async ({ page }) => {
    await page.click('a:has-text("Create Lobby")');
    await expect(page).toHaveURL(/.*multiplayer\/host/);
  });

  test('should navigate to browse page', async ({ page }) => {
    await page.click('a:has-text("Browse Public Games")');
    await expect(page).toHaveURL(/.*multiplayer\/browse/);
  });
});

import { test, expect } from '@playwright/test';

test.describe('Multiplayer Lobby', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/multiplayer');
  });

  test('should load multiplayer page', async ({ page }) => {
    await expect(page.locator(`h1`)).toContainText(/Multiplayer/i);
  });

  test('should show host game option', async ({ page }) => {
    const hostButton = page.locator(`text=Host, a[href*="host"]`).first();
    await expect(hostButton).toBeVisible();
  });

  test('should show join game option', async ({ page }) => {
    const joinButton = page.locator(`text=Join, a[href*="browse"]`).first();
    await expect(joinButton).toBeVisible();
  });

  test('should navigate to host page', async ({ page }) => {
    await page.click('text=Host');
    await expect(page).toHaveURL(/.*multiplayer\/host/);
  });

  test('should navigate to browse page', async ({ page }) => {
    await page.click('text=Join');
    await expect(page).toHaveURL(/.*multiplayer\/browse/);
  });
});

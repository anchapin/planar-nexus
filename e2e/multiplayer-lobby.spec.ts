import { test, expect } from '@playwright/test';

test.describe('Multiplayer Lobby', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/multiplayer');
    // Wait for page to fully load before running assertions
    await page.waitForLoadState('networkidle');
  });

  test('should load multiplayer page', async ({ page }) => {
    // Use getByRole to get the page heading specifically (not sidebar)
    await expect(page.getByRole('heading', { name: /Multiplayer/i, level: 1 })).toBeVisible();
  });

  test('should show host game option', async ({ page }) => {
    const hostButton = page.getByRole('link', { name: /create lobby/i });
    await expect(hostButton).toBeVisible();
  });

  test('should show join game option', async ({ page }) => {
    const joinButton = page.getByRole('link', { name: /browse public games/i });
    await expect(joinButton).toBeVisible();
  });

  test('should navigate to host page', async ({ page }) => {
    await page.getByRole('link', { name: /create lobby/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/.*multiplayer\/host/);
  });

  test('should navigate to browse page', async ({ page }) => {
    await page.getByRole('link', { name: /browse public games/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/.*multiplayer\/browse/);
  });
});

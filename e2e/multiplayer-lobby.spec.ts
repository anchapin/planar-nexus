import { test, expect } from '@playwright/test';

test.describe('Multiplayer Lobby', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/multiplayer');
  });

  test('should load multiplayer page', async ({ page }) => {
    // Use getByRole to get the page heading specifically (not sidebar)
    await expect(page.getByRole('heading', { name: /Multiplayer/i, level: 1 })).toBeVisible();
  });

  test('should show host game option', async ({ page }) => {
    const hostButton = page.locator(`text=Create Lobby`).first();
    await expect(hostButton).toBeVisible();
  });

  test('should show join game option', async ({ page }) => {
    const joinButton = page.locator(`text=Browse Public Games`).first();
    await expect(joinButton).toBeVisible();
  });

  test('should navigate to host page', async ({ page }) => {
    await page.click('text=Create Lobby');
    await expect(page).toHaveURL(/.*multiplayer\/host/);
  });

  test('should navigate to browse page', async ({ page }) => {
    await page.click('text=Browse Public Games');
    await expect(page).toHaveURL(/.*multiplayer\/browse/);
  });
});

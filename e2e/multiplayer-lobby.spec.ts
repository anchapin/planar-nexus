import { test, expect } from "@playwright/test";

test.describe("Multiplayer Lobby", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/multiplayer");
    // Wait for page to fully load before running assertions
    await page.waitForLoadState("networkidle");
  });

  test("should load multiplayer page", async ({ page }) => {
    // Use getByRole to get the page heading specifically (not sidebar)
    await expect(
      page.getByRole("heading", { name: /Multiplayer/i, level: 1 }),
    ).toBeVisible();
  });

  test("should show host game option", async ({ page }) => {
    const hostButton = page.getByRole("link", { name: /create p2p game/i });
    await expect(hostButton).toBeVisible();
  });

  test("should show join game option", async ({ page }) => {
    const joinButton = page.getByRole("link", { name: /enter code manually/i });
    await expect(joinButton).toBeVisible();
  });

  test("should navigate to host page", async ({ page }) => {
    await page.goto("/multiplayer");
    await page.waitForLoadState("networkidle");
    await page.getByRole("link", { name: /create p2p game/i }).click();
    await page.waitForURL(/.*p2p-host/, { timeout: 10000 });
    await expect(page).toHaveURL(/.*multiplayer\/p2p-host/);
  });

  test("should navigate to join page", async ({ page }) => {
    await page.goto("/multiplayer");
    await page.waitForLoadState("networkidle");

    // Wait for the link to be visible before clicking
    const joinLink = page.getByRole("link", { name: /enter code manually/i });
    await joinLink.waitFor({ state: "visible", timeout: 10000 });
    await joinLink.click();
    await page.waitForURL(/.*p2p-join/, { timeout: 10000 });
    await expect(page).toHaveURL(/.*multiplayer\/p2p-join/);
  });
});

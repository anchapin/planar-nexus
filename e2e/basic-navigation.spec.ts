import { test, expect } from "@playwright/test";

test.describe("Basic Navigation", () => {
  test("should load the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveTitle(/Planar Nexus/i);
  });

  test("should navigate to deck builder", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("nav a[href='/deck-builder']").click();
    await expect(page).toHaveURL(/.*deck-builder/);
  });

  test("should navigate to single player", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("nav a[href='/single-player']").click();
    await expect(page).toHaveURL(/.*single-player/);
  });

  test("should navigate to multiplayer", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("nav a[href='/multiplayer']").click();
    await expect(page).toHaveURL(/.*multiplayer/);
  });

  test("should navigate to deck coach", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");
    await page.locator("nav a[href='/deck-coach']").click();
    await expect(page).toHaveURL(/.*deck-coach/);
  });
});

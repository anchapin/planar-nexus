import { test, expect, type Page } from "@playwright/test";

/**
 * Basic sidebar navigation (#921).
 *
 * These tests exercise the REAL application navigation by clicking the sidebar
 * links rendered by <AppSidebar />, instead of calling page.goto() for each
 * route. Each test starts from the dashboard, clicks a sidebar link, and then
 * asserts BOTH the resulting URL and a unique on-page element, so we catch
 * broken nav links, dead routes, and regressions in the sidebar itself.
 */

// The sidebar is rendered inside a stable container. Scoping to it matters
// because the dashboard also renders feature-card links that share labels
// (e.g. "Deck Builder", "AI Deck Coach") with the sidebar nav.
const SIDEBAR = '[data-sidebar="sidebar"]';

/** Click a sidebar nav link by its accessible name and assert the destination. */
async function navigateViaSidebar(
  page: Page,
  linkName: string,
  urlRegex: RegExp,
  headingName: string,
) {
  await page
    .locator(SIDEBAR)
    .getByRole("link", { name: linkName, exact: true })
    .click();

  await expect(page).toHaveURL(urlRegex);
  await expect(
    page.getByRole("heading", { name: headingName, level: 1, exact: true }),
  ).toBeVisible();
}

test.describe("Basic Navigation", () => {
  test.beforeEach(async ({ page }) => {
    // Start every test from a known page so navigation state is predictable.
    await page.goto("/dashboard");
    // Ensure the app shell (sidebar) is mounted before interacting with it.
    await expect(page.locator(SIDEBAR)).toBeVisible();
  });

  test("should load the dashboard with the app shell", async ({ page }) => {
    await expect(page).toHaveTitle(/Planar Nexus/i);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(
      page.getByRole("heading", { name: "Welcome to Planar Nexus" }),
    ).toBeVisible();
    // The sidebar itself is present and exposes its primary destinations.
    await expect(
      page.locator(SIDEBAR).getByRole("link", { name: "Deck Builder" }),
    ).toBeAttached();
  });

  test("should navigate to Deck Builder via sidebar", async ({ page }) => {
    await navigateViaSidebar(
      page,
      "Deck Builder",
      /\/deck-builder/,
      "Deck Builder",
    );
  });

  test("should navigate to Single Player via sidebar", async ({ page }) => {
    await navigateViaSidebar(
      page,
      "Single Player",
      /\/single-player/,
      "Single Player",
    );
  });

  test("should navigate to Multiplayer via sidebar", async ({ page }) => {
    await navigateViaSidebar(page, "Multiplayer", /\/multiplayer/, "Multiplayer");
  });

  test("should navigate to AI Deck Coach via sidebar", async ({ page }) => {
    await navigateViaSidebar(
      page,
      "AI Deck Coach",
      /\/deck-coach/,
      "AI Deck Coach",
    );
  });

  test("should reflect the active route in the sidebar", async ({ page }) => {
    await page
      .locator(SIDEBAR)
      .getByRole("link", { name: "Multiplayer", exact: true })
      .click();

    await expect(page).toHaveURL(/\/multiplayer/);

    // The app marks the current route as active in <AppSidebar />; assert that
    // the clicked link is the one highlighted as the current destination.
    const multiplayerLink = page
      .locator(SIDEBAR)
      .getByRole("link", { name: "Multiplayer", exact: true });
    await expect(multiplayerLink).toHaveAttribute("data-active", "true");
  });
});

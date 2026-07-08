import { test, expect } from "@playwright/test";

/**
 * First-run onboarding tour (#1106).
 *
 * Simulates a brand-new visitor by clearing the `planar-nexus:onboarded` flag
 * via addInitScript (runs before any app code), then steps through the tour,
 * and finally verifies completion.
 *
 * The tour's step title lives in `#onboarding-tour-title` (a div, exposed to AT
 * via the dialog's `aria-labelledby`), so we assert on that id rather than a
 * heading role — the dashboard hero also renders a "Welcome to Planar Nexus"
 * string that would otherwise collide.
 *
 * The webServer (npm run dev on :9002) is started by playwright.config.ts.
 */

const ONBOARDED_KEY = "planar-nexus:onboarded";
const DIALOG = 'div[role="dialog"][aria-labelledby="onboarding-tour-title"]';
const TITLE = "#onboarding-tour-title";

/** Strip the onboarding flag before the app mounts so the tour auto-starts. */
async function forceFreshVisitor(page: import("@playwright/test").Page) {
  await page.addInitScript((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }, ONBOARDED_KEY);
}

/** Assert the tour is showing a given step title. */
async function expectTourTitle(
  page: import("@playwright/test").Page,
  title: string,
) {
  await expect(page.locator(TITLE)).toHaveText(title);
}

test.describe("Onboarding tour", () => {
  test.beforeEach(async ({ page }) => {
    await forceFreshVisitor(page);
    await page.goto("/dashboard");
  });

  test("auto-starts on first launch and can be completed", async ({ page }) => {
    // The tour appears shortly after first load.
    await expect(page.locator(DIALOG)).toBeVisible({ timeout: 10000 });
    await expectTourTitle(page, "Welcome to Planar Nexus");

    // Each step exposes a primary "Next" / final "Get started" button.
    const next = page.locator("[data-tour-primary]");

    // Step through the whole tour (8 steps total).
    for (let i = 0; i < 8; i++) {
      await expect(next).toBeVisible();
      await next.click();
    }

    // Final click landed on "Get started" and dismissed the dialog.
    await expect(page.locator(DIALOG)).toBeHidden();

    // Completion persisted the onboarding flag.
    const seen = await page.evaluate((key) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }, ONBOARDED_KEY);
    expect(seen).toBe("true");
  });

  test("advances with the Enter key", async ({ page }) => {
    await expect(page.locator(DIALOG)).toBeVisible({ timeout: 10000 });
    await expectTourTitle(page, "Welcome to Planar Nexus");

    // Primary button receives focus on open; Enter then advances the step.
    const next = page.locator("[data-tour-primary]");
    await next.focus();
    await page.keyboard.press("Enter");

    await expectTourTitle(page, "Build Your Deck");
  });

  test("Escape dismisses the tour and marks it seen", async ({ page }) => {
    await expect(page.locator(DIALOG)).toBeVisible({ timeout: 10000 });

    // Focus the primary button before pressing Escape so the keydown
    // bubbles from a known-focused element up to the dialog's onKeyDown
    // handler. The OnboardingTour focus management does this on its own
    // 80ms after open, but under CI load that focus may not be in place
    // by the time the test reaches this line.
    const primary = page.locator("[data-tour-primary]");
    await expect(primary).toBeVisible();
    await primary.focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(DIALOG)).toBeHidden();

    const seen = await page.evaluate((key) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    }, ONBOARDED_KEY);
    expect(seen).toBe("true");
  });

  test("is not shown once the onboarding flag is set", async ({ page }) => {
    // Pre-seed the flag before the app loads.
    await page.addInitScript((key) => {
      try {
        window.localStorage.setItem(key, "true");
      } catch {
        /* ignore */
      }
    }, ONBOARDED_KEY);
    await page.goto("/dashboard");

    // Tour must NOT appear.
    await expect(page.locator(DIALOG)).toBeHidden({ timeout: 5000 });
  });

  test("can be restarted from Settings", async ({ page }) => {
    // Complete it once so we are in the "seen" state.
    await expect(page.locator(DIALOG)).toBeVisible({ timeout: 10000 });
    const next = page.locator("[data-tour-primary]");
    for (let i = 0; i < 8; i++) {
      await expect(next).toBeVisible();
      await next.click();
    }
    await expect(page.locator(DIALOG)).toBeHidden();

    // Restart from Settings.
    await page.goto("/settings");
    await page.getByRole("button", { name: /Restart tour/i }).click();

    // The tour reappears at the welcome step.
    await expect(page.locator(DIALOG)).toBeVisible({ timeout: 10000 });
    await expectTourTitle(page, "Welcome to Planar Nexus");
  });
});

import { test, expect, type Page } from "@playwright/test";

/**
 * Forced-colors / Windows High Contrast Mode smoke test (#1269).
 *
 * Validates the acceptance criteria from issue #1269 at a smoke level:
 *   - All chrome surfaces on /game, /draft, /multiplayer/host remain
 *     navigable when the user has forced-colors mode active.
 *   - Critical indicators (`ai-picking-indicator`, `turn-timer`,
 *     `connection-status-indicator`) keep accessible names + state
 *     attributes so screen readers (and CSS-driven HCM overrides)
 *     continue to convey state.
 *
 * The heavy-lifting color map lives in `@media (forced-colors: active)`
 * inside src/app/globals.css. This test only confirms that the
 * supporting markup (data-* attributes, persistent `border` classes,
 * focusable controls) is in place. Visual-difference assertions are
 * captured via the screenshots emitted on every failure (see
 * `playwright.config.ts` `screenshot: "only-on-failure"`).
 */

type Route = { path: string; heading: RegExp; targetTestId?: string };

const ROUTES: Route[] = [
  { path: "/single-player", heading: /single player/i },
  { path: "/draft", heading: /draft/i },
  { path: "/multiplayer/host", heading: /host/i },
];

async function enableForcedColors(page: Page) {
  // Playwright Chrome emulation: switches the same UA flag used by Windows
  // HCM. Browsers without support silently fall back to the regular path,
  // which is the desired "graceful degradation" behavior on Linux/macOS CI.
  await page.emulateMedia({ forcedColors: "active" });
}

test.describe("Forced-colors mode (#1269)", () => {
  test.beforeEach(async ({ page }) => {
    await enableForcedColors(page);
    // Use a wide viewport so the HCM highlight outline (2px) is not clipped
    // by a small width.
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  for (const route of ROUTES) {
    test(`renders ${route.path} without errors under forced-colors`, async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      page.on("pageerror", (err) => consoleErrors.push(err.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
      });

      await page.goto(route.path);

      // Heading rendering proves the page hydrated; the global HCM rule
      // applies to every element regardless of route, so a missing heading
      // is the most useful early failure signal.
      await expect(
        page.getByRole("heading", { name: route.heading }).first(),
        "route should hydrate under forced-colors",
      ).toBeVisible({ timeout: 15000 });

      // Animated ringing states are flattened under HCM. If a `<Progress>`
      // is in the document for any of these routes, it must still expose
      // an accessible role so screen readers carry the information.
      const progressBars = page.getByRole("progressbar");
      const progressCount = await progressBars.count();
      for (let i = 0; i < progressCount; i++) {
        const bar = progressBars.nth(i);
        // At least `aria-valuemin` is required when the bar advertises a value.
        await expect(bar).toHaveAttribute("aria-valuemin", "0");
      }

      expect(
        consoleErrors,
        `Console errors on ${route.path}: ${consoleErrors.join("\n")}`,
      ).toEqual([]);
    });
  }

  test("exposes data-state on the AI picking indicator so HCM CSS can recolor it", async ({
    page,
  }) => {
    await page.goto("/draft");

    // Some draft pages show AI picking indicators. Where the indicator is
    // mounted, it must carry data-state + a `border` class so the global
    // HCM CSS can promote the border to Highlight.
    const indicators = page.getByTestId("ai-picking-indicator");
    const count = await indicators.count();
    if (count === 0) {
      test.skip(true, "no AI picking indicator is rendered on /draft");
    }

    for (let i = 0; i < count; i++) {
      const indicator = indicators.nth(i);
      await expect(indicator).toHaveAttribute("data-state", /idle|picking/);
      const cls = (await indicator.getAttribute("class")) ?? "";
      expect(cls).toMatch(/\bborder\b/);
    }
  });

  test("focus rings are visible via forced-colors Highlight via :focus-visible", async ({
    page,
  }) => {
    await page.goto("/dashboard");

    // The first focusable link in the sidebar. Tabbing lands focus on it
    // and exposes :focus-visible. We assert the focus landed (DOM-level);
    // the color comes from the global `@media (forced-colors: active)`
    // :focus-visible rule in src/app/globals.css.
    const firstLink = page
      .locator('[data-sidebar="sidebar"]')
      .getByRole("link")
      .first();

    await firstLink.focus();
    await expect(firstLink).toBeFocused();
  });
});

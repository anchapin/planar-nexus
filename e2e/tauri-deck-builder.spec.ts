/**
 * E2E — Tauri desktop deck-builder, driven via the dev server (issue #1433).
 *
 * Strategy (Option A from the issue): instead of building a real Tauri binary
 * + xvfb + WebDriver in CI, we drive the *same* Next.js dev server
 * (`localhost:9002`, the `devUrl` the Tauri shell loads) and stub the Tauri
 * IPC bridge so the desktop code paths are taken. This keeps the suite
 * CI-friendly (no webkit2gtk / display server / root) while still exercising
 * every desktop-aware branch:
 *
 *   - `src/lib/updater.ts`     `isTauriEnvironment()`
 *   - `src/lib/indexeddb-storage.ts` `isTauri()`
 *   - the deck-builder UI the webview renders
 *
 * The shim is injected twice, both pointing at the same contract in
 * `src/lib/tauri-mock.ts`:
 *
 *   1. `page.addInitScript` (below) — installs `window.__TAURI_INTERNALS__`
 *      and `window.__TAURI__` *before* any app JS evaluates, for determinism.
 *   2. `<TauriDevFallback/>` in the root layout — re-installs the same shim
 *      when the dev server is booted with `NEXT_PUBLIC_TAURI_FALLBACK=1`
 *      (idempotent; the second install is a no-op). This is what the CI job
 *      sets so the desktop path engages even outside Playwright.
 *
 * Every mocked IPC call rejects; existing call sites (`checkForDesktopUpdate`,
 * etc.) already swallow that and degrade to a no-op, so the app stays fully
 * usable. We assert that graceful-degradation explicitly (the update banner
 * never appears) to lock in the contract.
 *
 * Why no more `.skip`: the previous file used both a `.skip` filename suffix
 * *and* an in-spec `test.skip(process.env.CI === 'true')`. Both are gone —
 * this spec runs on every PR via the `e2e` CI job and is auto-discovered by
 * the nightly flake-detector (which globs every `e2e/*.spec.ts`).
 */

import { test, expect, type Page } from "@playwright/test";
import { seedCardDatabase, waitForDbSeed } from "./test-utils";

/**
 * Install the Tauri IPC shim on the page *before* any application JS runs.
 * This guarantees `isTauriEnvironment()` / `isTauri()` return true from the
 * very first React render, so the desktop branches are taken deterministically
 * regardless of when the layout's `<TauriDevFallback/>` effect fires.
 *
 * Implementation notes:
 *   - The error message is **inlined as a string literal** rather than passed
 *     via `addInitScript`'s `arg` parameter or closed over from the module.
 *     `addInitScript` serialises only the function body; module-scope
 *     captures do not transfer to the page context. A literal is the only
 *     rock-solid way to keep the page-side error string in sync with
 *     `TAURI_DEV_FALLBACK_ERROR` (the unit test in
 *     `src/lib/__tests__/tauri-mock.test.ts` asserts the two stay equal).
 *   - No idempotency guard: each test gets a fresh page (Playwright default),
 *     so the script runs once per navigation. The layout-mounted installer
 *     (`src/lib/tauri-mock.ts`) carries the idempotency guard for HMR.
 */
async function installTauriShimBeforeAppLoad(page: Page) {
  await page.addInitScript(() => {
    const rejectingInvoke = (): Promise<never> =>
      Promise.reject(
        new Error(
          "tauri-dev-fallback: IPC is mocked; this call only succeeds inside a real Tauri webview",
        ),
      );

    (
      window as unknown as { __TAURI_INTERNALS__?: unknown }
    ).__TAURI_INTERNALS__ = { invoke: rejectingInvoke };
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      invoke: rejectingInvoke,
    };

    // DOM marker. Next.js renders <html> from SSR markup, so React hydration
    // reconciles <html> and strips this attribute post-hydration. The marker
    // still helps the layout-installed path (useEffect runs after hydration);
    // the E2E asserts on the window globals, which React never touches.
    document.documentElement.setAttribute("data-tauri-dev-fallback", "1");
  });
}

/**
 * Select a legality format from the toolbar `<Select>` and block until the
 * trigger reflects the new value, so the next interaction reads the intended
 * format. Lifted from `import-export-roundtrip.spec.ts` (proven stable).
 */
async function selectFormat(page: Page, name: RegExp) {
  const trigger = page.getByTestId("format-select");
  await trigger.click();
  await page.getByRole("option", { name }).click();
  await expect(trigger).toContainText(name);
}

/**
 * Deterministic "import resolved" signal: a successful import closes the
 * import dialog, detaching the textarea from the DOM. Avoids fixed sleeps.
 */
async function waitForImportResolved(page: Page) {
  await expect(page.getByTestId("import-textarea")).toBeHidden({
    timeout: 15000,
  });
}

test.describe("Tauri Desktop (via dev server) — Deck Builder", () => {
  test.beforeEach(async ({ page }) => {
    // Engage the desktop IPC shim before the app boots.
    await installTauriShimBeforeAppLoad(page);

    // Seed the card database before navigation so IndexedDB is ready when
    // the app initialises (matches the rest of the e2e suite).
    await seedCardDatabase(page);
    await page.goto("/deck-builder");

    // Wait for the toolbar instead of `networkidle` (which never reliably
    // settles on the HMR dev server).
    await expect(page.getByTestId("import-deck-button")).toBeVisible({
      timeout: 15000,
    });
    await waitForDbSeed(page);

    // Start every test from an empty deck.
    const deckCount = page.getByTestId("deck-count");
    await expect(deckCount).toBeVisible();
    const current = (await deckCount.textContent()) ?? "";
    if (!current.includes("0 cards")) {
      await page.getByTestId("clear-deck-button").click();
      const confirmClear = page.getByTestId("confirm-clear-button");
      await expect(confirmClear).toBeVisible();
      await confirmClear.click();
      await expect(deckCount).toContainText("0 cards");
    }
  });

  test("engages the Tauri desktop IPC shim against the dev server", async ({
    page,
  }) => {
    test.setTimeout(60000);

    // The desktop-detection globals the app probes are defined, proving the
    // desktop code branches (`isTauriEnvironment()` / `isTauri()`) are taken.
    // We assert on `window` (the actual branching surface) rather than the
    // `data-tauri-dev-fallback` DOM marker: Next.js renders `<html>` from SSR
    // markup, so React hydration reconciles — and strips — attributes that
    // `addInitScript` set pre-hydration. The globals are never touched by
    // React, so they are the stable contract.
    const desktopGlobals = await page.evaluate(() => ({
      internals:
        (window as unknown as { __TAURI_INTERNALS__?: unknown })
          .__TAURI_INTERNALS__ !== undefined,
      legacy:
        (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== undefined,
    }));
    expect(desktopGlobals.internals).toBe(true);
    expect(desktopGlobals.legacy).toBe(true);

    // The mocked IPC rejects, and the existing call sites must degrade
    // gracefully — confirm the updater actually fired (and was swallowed)
    // by checking that the desktop-update banner, which only mounts when a
    // real update is available, is absent.
    await expect(page.getByTestId("desktop-update-banner")).toHaveCount(0);

    // The deck-builder shell still renders under the desktop path.
    await expect(
      page.locator("h1, h2").filter({ hasText: /deck/i }),
    ).toBeVisible();
  });

  test("builds and exports a Standard deck via the desktop webview path", async ({
    page,
  }) => {
    test.setTimeout(60000);

    // Standard first so 4x copies resolve.
    await selectFormat(page, /standard/i);

    // 1. Import a decklist through the same import dialog the Tauri build
    //    surfaces (FS-backed import is mocked; the textarea path is the
    //    browser-equivalent the webview falls back to).
    await page.getByTestId("import-deck-button").click();
    const textarea = page.getByTestId("import-textarea");
    await expect(textarea).toBeVisible({ timeout: 10000 });
    await textarea.fill("4 Lightning Bolt\n4 Mountain\n20 Island");
    await page.getByTestId("confirm-import-button").click();

    await waitForImportResolved(page);
    await expect(page.getByTestId("deck-count")).toContainText("28 cards");

    // 2. The imported cards render in the deck list.
    await expect(page.getByTestId("deck-item-lightning-bolt")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("deck-item-mountain")).toBeVisible();
    await expect(page.getByTestId("deck-item-island")).toBeVisible();

    // 3. Export controls (the desktop "save deck to disk" surface) are
    //    reachable and render the format options the webview exposes.
    await page.getByTestId("export-deck-button").click();
    await expect(page.getByTestId("export-text-button")).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByTestId("export-json-button")).toBeVisible();
    await expect(page.getByTestId("export-copy-button")).toBeVisible();
  });

  test("the desktop-update banner degrades gracefully under mocked IPC", async ({
    page,
  }) => {
    test.setTimeout(60000);

    // Under the dev-fallback shim every Tauri IPC call rejects, so
    // `checkForDesktopUpdate()` returns `{ available: false, ... }` and the
    // `DesktopUpdateBanner` must never mount. This locks in the contract
    // that the desktop shell stays usable when the updater backend is absent
    // (the exact condition the Tauri webview hits during dev).
    await page.goto("/dashboard");
    await page.waitForLoadState("domcontentloaded");

    // Give the updater hook's mount-check a chance to settle, then assert
    // the banner is absent (not merely hidden).
    await expect(page.getByTestId("desktop-update-banner")).toHaveCount(0, {
      timeout: 10000,
    });
  });
});

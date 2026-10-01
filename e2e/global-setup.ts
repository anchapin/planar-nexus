import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
  type FullConfig,
} from "@playwright/test";

/**
 * Global setup: warm every route the E2E specs visit before any test runs.
 *
 * Why
 * ---
 * The suite runs against `next dev`, which compiles each route on its first
 * request. A cold compile takes 10-20s locally (`/multiplayer` ~10s,
 * `/deck-builder` ~19.5s), longer on a CI runner. Two failure classes in the
 * cross-browser job line up with that:
 *
 *  - firefox `import-export.spec.ts` failed with the page still showing
 *    "Loading deck builder" when the 5s expect timeout ran out.
 *  - webkit multiplayer specs saw a second document load of the same URL a
 *    few hundred ms after the HMR socket connected, wiping injected harness
 *    state. Main run 36927169441 also logged two `ChunkLoadError`s, and the
 *    app router answers a failed chunk load with a full reload. Pages
 *    requesting chunks that are still compiling is the prime suspect.
 *
 * Loading each route once in a real browser compiles both the server entry
 * and the client chunks (including lazy ones requested during render), so
 * tests start against an already-compiled app.
 *
 * Behaviour
 * ---------
 *  - Runs after Playwright's webServer is up (plugin setup precedes
 *    globalSetup).
 *  - Uses whichever browser is installed: the chromium job only installs
 *    chromium, the cross-browser job only firefox + webkit.
 *  - Never fails the run: a route that errors or times out is logged and
 *    skipped, and the specs report real failures as before.
 *  - Set `E2E_SKIP_WARMUP=1` to skip (e.g. against a warm local server).
 */

/** Routes the specs navigate to. Query strings don't affect compilation. */
export const WARMUP_ROUTES = [
  "/",
  "/dashboard/",
  "/single-player/",
  "/deck-builder/",
  "/deck-coach/",
  "/multiplayer/",
  "/multiplayer/p2p-host/",
  "/multiplayer/p2p-join/",
  "/sealed/",
  "/draft/",
  "/draft/complete/",
  "/limited-deck-builder/",
  "/sideboards/",
  "/set-browser/",
  "/settings/",
  "/game/board/",
] as const;

const NAV_TIMEOUT_MS = 180_000;
const IDLE_TIMEOUT_MS = 20_000;

async function launchAnyBrowser(): Promise<Browser | null> {
  const candidates: BrowserType[] = [chromium, firefox, webkit];
  for (const type of candidates) {
    try {
      return await type.launch();
    } catch {
      // Not installed in this job; try the next one.
    }
  }
  return null;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.E2E_SKIP_WARMUP === "1") {
    console.info("[warmup] skipped (E2E_SKIP_WARMUP=1)");
    return;
  }

  const baseURL =
    (config.projects[0]?.use?.baseURL as string | undefined) ??
    process.env.BASE_URL ??
    "http://localhost:9002";

  const browser = await launchAnyBrowser();
  if (!browser) {
    console.warn("[warmup] no Playwright browser installed; skipping");
    return;
  }

  const started = Date.now();
  console.info(
    `[warmup] compiling ${WARMUP_ROUTES.length} routes on ${baseURL} ` +
      `with ${browser.browserType().name()}`,
  );

  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    for (const route of WARMUP_ROUTES) {
      const t0 = Date.now();
      try {
        const response = await page.goto(route, {
          waitUntil: "load",
          timeout: NAV_TIMEOUT_MS,
        });
        // Lazy chunks are requested during render; let them finish compiling.
        await page
          .waitForLoadState("networkidle", { timeout: IDLE_TIMEOUT_MS })
          .catch(() => undefined);
        console.info(
          `[warmup] ${route} ${response?.status() ?? "-"} ` +
            `${((Date.now() - t0) / 1000).toFixed(1)}s`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(
          `[warmup] ${route} failed after ` +
            `${((Date.now() - t0) / 1000).toFixed(1)}s: ` +
            message.split("\n")[0],
        );
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }

  console.info(
    `[warmup] done in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
}

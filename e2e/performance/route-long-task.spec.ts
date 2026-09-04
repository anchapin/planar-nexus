/**
 * Per-route long-task regression budget — issue #1575 (acceptance #5).
 *
 * For every high-traffic route under the `(app)` group, load the page
 * with the CPU throttled to 4x and assert that no main-thread long-task
 * exceeds 200ms during the initial render window.
 *
 * Why CPU-4x? The 50 ms rAIL budget is the in-the-wild target; a 4x
 * throttle amplifies real stalls by 4x, so a >200ms observation in the
 * throttled browser corresponds to a >50ms real stall that would be
 * visible to a real user on a low-end device. This is the regression
 * budget the Phase 32 VALIDATION doc commits to.
 *
 * The Long-Task API exposes entries via `performance.getEntriesByType
 * ('longtask')`; we read that array after each navigation. We deliberately
 * do NOT depend on the `<LongTaskProbe>`'s `getLongTaskLog()` because the
 * ring buffer is in-process and a fresh page navigation starts a new
 * buffer — `performance.getEntriesByType` returns the browser-recorded
 * entries directly and survives across navigations until the document is
 * unloaded.
 */

import { test, expect, type CDPSession, type Page } from "@playwright/test";

/** Apply 4x CPU throttling to the page via CDP. */
async function throttleCPU4x(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return cdp;
}

/**
 * Read the long-task entries the browser has recorded for the current
 * document. Returns `[]` when the runtime does not support `longtask`
 * (WebKit, some Firefox configurations) — in which case the assertion is
 * trivially satisfied.
 */
async function readLongTasks(
  page: Page,
): Promise<Array<{ duration: number; startTime: number; name: string }>> {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType("longtask");
    return entries.map((entry) => ({
      duration: entry.duration,
      startTime: entry.startTime,
      name: entry.name,
    }));
  });
}

/**
 * Routes that previously had zero observability for main-thread stalls.
 * Listed in the issue's acceptance criterion #5 plus `single-player`
 * (the AI simulation surface). Each route must render without producing
 * any entry > 200 ms under the 4x CPU throttle.
 *
 * The route path is the actual Next.js App-Router URL. The `waitFor`
 * selector is a best-effort signal that the page has rendered past the
 * shell — using `domcontentloaded` plus a small settle window instead of
 * a hard-coded data-testid so the test does not couple to internal
 * component shape.
 */
const ROUTES: ReadonlyArray<{
  name: string;
  path: string;
  /** Minimum time (ms) we wait after `domcontentloaded` to capture the
   *  initial-render long-task window. Tuned to 1500ms to cover React
   *  hydration + first meaningful paint under the 4x throttle. */
  settleMs: number;
}> = [
  { name: "deck-coach", path: "/deck-coach", settleMs: 1500 },
  { name: "collection", path: "/collection", settleMs: 1500 },
  { name: "multiplayer", path: "/multiplayer", settleMs: 1500 },
  { name: "draft", path: "/draft", settleMs: 1500 },
  { name: "single-player", path: "/single-player", settleMs: 1500 },
];

for (const route of ROUTES) {
  test(`route ${route.name} produces zero long-tasks > 200ms during initial render (#1575)`, async ({
    page,
  }) => {
    test.setTimeout(30_000);
    await throttleCPU4x(page);

    await page.goto(route.path, { waitUntil: "domcontentloaded" });
    // Give the page a generous settle window so initial-render stalls
    // (hydration, virtualized list mount, first IndexedDB read) have a
    // chance to surface as long-task entries. Without this we would miss
    // stalls that happen during the first 100-300ms of layout work.
    await page.waitForTimeout(route.settleMs);

    const tasks = await readLongTasks(page);
    const offending = tasks.filter((t) => t.duration > 200);

    if (offending.length > 0) {
      // Surface the worst offenders in the failure message so a
      // regression has actionable context.
      const summary = offending
        .map(
          (t) =>
            `  - duration=${t.duration.toFixed(1)}ms startTime=${t.startTime.toFixed(1)}ms name=${t.name}`,
        )
        .join("\n");
      throw new Error(
        `${route.name} produced ${offending.length} long-task(s) > 200ms under CPU-4x throttle:\n${summary}`,
      );
    }

    // We deliberately allow tasks up to 200ms — the issue's regression
    // budget. Anything tighter would be flaky on a busy CI runner.
    expect(offending).toEqual([]);
  });
}

test.describe("Long-Task API support", () => {
  test("the running browser supports the longtask PerformanceObserver entry type (#1575)", async ({
    page,
  }) => {
    const supported = await page.evaluate(() => {
      const PO = (
        window as unknown as {
          PerformanceObserver?: {
            supportedEntryTypes?: { includes: (t: string) => boolean };
          };
        }
      ).PerformanceObserver;
      return (
        typeof PO === "function" &&
        (PO.supportedEntryTypes?.includes("longtask") ?? false)
      );
    });
    if (!supported) {
      test.skip(true, "Long-Task API not supported in this browser runtime");
    }
    expect(supported).toBe(true);
  });
});

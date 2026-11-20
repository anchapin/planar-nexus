/**
 * Shared navigation / readiness helpers for the E2E suite.
 *
 * Issue #2958 — the shared root cause of the "everything fails together" burst
 * ---------------------------------------------------------------------------
 * The specs used to synchronise with `page.waitForLoadState("networkidle")`
 * right after every `page.goto(...)`:
 *
 *     await page.goto("/multiplayer");
 *     await page.waitForLoadState("networkidle");   // <-- the shared flaw
 *
 * `networkidle` means "no network request has been in flight for 500 ms".
 * That is a *global* condition of the whole page, and it is never guaranteed
 * to happen on the `next dev` server the suite runs against:
 *
 *   - `next dev` compiles routes on demand, so a cold route answers with a
 *     burst of chunk requests;
 *   - the app keeps a long-lived dev connection (HMR / RSC) open, and fires
 *     background fetches (card database, session state, prefetches);
 *   - under CI load those requests chain together with gaps smaller than
 *     500 ms, so the idle window never opens.
 *
 * When the idle window never opens, `waitForLoadState("networkidle")` blocks
 * until Playwright's default 30 s timeout — which is exactly the test
 * timeout. The test therefore fails with "Test timeout of 30000ms exceeded"
 * *before a single assertion runs*, and the whole file goes down with it.
 * That is why a burst of ~20 unrelated tests in three different specs (and on
 * data-only PRs) failed together while other runs of the same commit were
 * green: the tests were synchronising on the network being quiet instead of
 * on the thing they actually need.
 *
 * The fix (mirroring the pattern already proven in `e2e/import-export.spec.ts`
 * and `e2e/import-export-roundtrip.spec.ts`, which replaced their sleeps and
 * `networkidle` waits with state-based readiness signals):
 *
 *   wait for the *condition the test needs* — a locator that proves the page
 *   is ready — instead of a blanket network-idle guess.
 *
 * These helpers centralise that so every spec does it the same way:
 *
 *   - `gotoReady()` / `reloadReady()`: navigate and wait for a readiness
 *     locator (web-first assertions auto-retry, so this *is* the wait).
 *   - `clickUntil()`: perform a click that only works after React has
 *     hydrated, retrying the click until its effect is observable — the
 *     pattern already used by `e2e/qr-join-flow.spec.ts` (#1950, #2383).
 */

import { expect, type Locator, type Page } from "@playwright/test";

/**
 * How long a readiness condition may take to become true.
 *
 * Deliberately larger than Playwright's default 5 s expect timeout: the
 * whole point is to absorb a slow (but successful) page load instead of
 * failing the test. It is still far below the 30 s test timeout, so a
 * genuinely broken page still fails fast instead of eating the budget.
 */
export const READY_TIMEOUT_MS = 15_000;

/**
 * Wait until `locator` is visible.
 *
 * `expect(...).toBeVisible()` is a web-first assertion: it polls until the
 * condition holds or the timeout expires. That makes it a *condition-based*
 * wait, unlike `waitForLoadState("networkidle")` or `waitForTimeout()`.
 */
export async function waitForReady(
  locator: Locator,
  timeout: number = READY_TIMEOUT_MS,
): Promise<void> {
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Navigate to `path` and wait until `ready` is visible.
 *
 * `page.goto()` keeps its default `waitUntil: "load"`, i.e. it waits for the
 * document (and its scripts) to arrive — a deterministic event that always
 * happens. The *readiness* of the app for the test is expressed by `ready`,
 * which is the condition the test actually needs.
 */
export async function gotoReady(
  page: Page,
  path: string,
  ready: Locator,
  timeout: number = READY_TIMEOUT_MS,
): Promise<void> {
  await page.goto(path);
  await waitForReady(ready, timeout);
}

/**
 * Reload the current page and wait until `ready` is visible again.
 */
export async function reloadReady(
  page: Page,
  ready: Locator,
  timeout: number = READY_TIMEOUT_MS,
): Promise<void> {
  await page.reload();
  await waitForReady(ready, timeout);
}

/**
 * Click `trigger` until `effect` holds.
 *
 * A click that lands before React has hydrated is silently dropped: the
 * element is in the DOM (server-rendered) but no listener is attached yet.
 * The symptom is a test that waits forever for a state that can only be
 * reached by a *second* click. `expect(...).toPass()` re-runs the whole
 * block until the effect is observable, so the spec no longer depends on
 * when hydration happened (#1950, #2383).
 *
 * `effect` must throw (e.g. via a failing `expect`) while the effect is not
 * yet observable.
 */
export async function clickUntil(
  trigger: Locator,
  effect: () => Promise<void>,
  timeout: number = READY_TIMEOUT_MS,
): Promise<void> {
  await expect(async () => {
    await trigger.click();
    await effect();
  }).toPass({ timeout });
}

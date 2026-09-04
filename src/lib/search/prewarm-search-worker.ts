/**
 * @fileoverview Pre-warm the Orama card-search worker on app-shell mount
 * (issue #1576).
 *
 * `indexCardsInWorker()` (`src/lib/card-database.ts:301-321`) is otherwise
 * only invoked from inside `initializeCardDatabase()`, which `card-search.tsx`
 * only calls on `/deck-builder` mount. Until the worker is fed its card
 * documents, `searchWorkerClient.getSearchApi()` returns a ready proxy backed
 * by an EMPTY worker index, so the user's first keystroke pays 200–600ms of
 * `api.index(docs)` time on a 5k-card collection — and because the empty
 * result is not thrown as an error, the fallback through `cardSearchIndex`
 * never fires (`card-database.ts:301-318`).
 *
 * The (app) shell layout mounts before any specific route, so it is the
 * natural pre-warm site: schedule the index call during idle time and the
 * worker is warm by the time the user reaches a card-search input.
 *
 * Design notes:
 *   - SSR-safe: `schedule()` is a no-op when `window` is undefined, so the
 *     helper can be imported by server-rendered code without exploding.
 *   - Fire-and-forget: the call site never awaits the promise. Prewarm is a
 *     performance hint, not a correctness prerequisite.
 *   - Failure-quiet: `indexCardsInWorker()` already wraps the worker call in
 *     a try/catch and warns to the console; we log a separate warning here
 *     only if the wrapped rejection escapes — which it should not, by design.
 *   - Idempotent: repeated `schedule()` calls collapse into a single schedule
 *     so React 19's StrictMode double-mount or HMR does not double the work.
 */

import { indexCardsInWorker } from "@/lib/card-database";
import { searchWorkerClient } from "./search-worker-client";

/**
 * Lifecycle of the prewarm operation. UI surfaces that want to render an
 * "Indexing…" hint while the worker is being warmed can subscribe via
 * {@link searchWorkerPrewarm.subscribe}.
 */
export type PrewarmStatus =
  "idle" | "scheduled" | "running" | "ready" | "fallback" | "error";

/** Listener invoked on every status transition. */
export type PrewarmListener = (status: PrewarmStatus) => void;

/** Fallback delay for environments without `requestIdleCallback`. */
const PREWARM_TIMEOUT_MS = 1000;

/**
 * Minimal subset of the runtime we need from `window`. Defined as a
 * structural type so SSR / Node / workers can satisfy it with `undefined`
 * without depending on the DOM lib's `Window` interface.
 */
export type WindowLike =
  | {
      requestIdleCallback?: (callback: () => void) => number;
      setTimeout: typeof setTimeout;
    }
  | undefined;

/**
 * Returns the runtime window (or `undefined` under SSR). Held in a private
 * function rather than reading `window` directly inside `schedule()` so the
 * module can be exercised under jest without depending on jsdom's
 * non-configurable `globalThis.window` slot.
 * @internal
 */
function detectRuntimeWindow(): WindowLike {
  if (typeof window === "undefined") return undefined;
  return window as WindowLike;
}

class SearchWorkerPrewarmManager {
  private static instance: SearchWorkerPrewarmManager | null = null;

  private status: PrewarmStatus = "idle";
  private listeners = new Set<PrewarmListener>();
  private scheduled = false;

  static getInstance(): SearchWorkerPrewarmManager {
    if (!SearchWorkerPrewarmManager.instance) {
      SearchWorkerPrewarmManager.instance = new SearchWorkerPrewarmManager();
    }
    return SearchWorkerPrewarmManager.instance;
  }

  /**
   * Current status of the prewarm operation. See {@link PrewarmStatus}.
   */
  getStatus(): PrewarmStatus {
    return this.status;
  }

  /**
   * Subscribe to status transitions. The listener is invoked synchronously
   * with the current status on registration, so callers do not need to
   * query `getStatus()` separately. Returns an unsubscribe function.
   */
  subscribe(listener: PrewarmListener): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private setStatus(next: PrewarmStatus): void {
    if (this.status === next) return;
    this.status = next;
    for (const listener of this.listeners) listener(next);
  }

  /**
   * Schedule the Orama worker index warm-up. Production callers should use
   * this method; tests may prefer {@link scheduleWith} to inject a fake
   * `window`-like object.
   *
   * Uses `requestIdleCallback` when available (Chromium ≥ 47, Firefox ≥ 55,
   * Safari 16.4+) — falling back to `setTimeout(_, PREWARM_TIMEOUT_MS)` so
   * the call still fires on engines that lack the idle API. SSR-safe (`window`
   * undefined → no-op).
   *
   * Idempotency is two-tier: a `scheduled` flag tracks whether an idle /
   * timer callback is in flight (cleared at the top of `run()`), and a
   * status guard refuses to start a second warm-up while the previous run
   * is still executing (`"scheduled"` or `"running"`). After the run
   * settles — `ready` / `fallback` / `error` — another `schedule()` call
   * resumes a fresh warm-up, which is what `_resetForTesting()` relies on
   * to keep tests isolated.
   */
  schedule(): void {
    this.scheduleWith(detectRuntimeWindow());
  }

  /**
   * Like {@link schedule}, but accepts an explicit window-like object.
   * Tests pass `undefined` to verify the SSR no-op path without depending
   * on jsdom's non-configurable `globalThis.window`.
   * @internal
   */
  scheduleWith(win: WindowLike): void {
    if (!win) return;
    if (this.scheduled) return;
    if (this.status === "scheduled" || this.status === "running") return;

    this.scheduled = true;
    this.setStatus("scheduled");

    const run = async (): Promise<void> => {
      this.scheduled = false;

      // Skip if the worker is unavailable — `indexCardsInWorker` already
      // checks `getSearchApi()` internally, but reporting the fallback up
      // front lets UI subscribers finish their "Indexing…" indicator
      // without an extra await round-trip on the worker call.
      if (searchWorkerClient.getStatus() === "fallback") {
        this.setStatus("fallback");
        return;
      }

      this.setStatus("running");
      try {
        await indexCardsInWorker();
        this.setStatus("ready");
      } catch (error) {
        console.warn(
          "[prewarm-search-worker] worker index warm-up failed:",
          error,
        );
        this.setStatus("error");
      }
    };

    if (typeof win.requestIdleCallback === "function") {
      win.requestIdleCallback(run);
    } else {
      // Pin to `win.setTimeout` if present (so a test fakes a window
      // without real timers); otherwise fall back to the global setTimeout.
      const timer = win.setTimeout ?? setTimeout;
      timer(run, PREWARM_TIMEOUT_MS);
    }
  }

  /**
   * Reset internal state for tests. Production callers should not need this.
   * @internal
   */
  static _resetForTesting(): void {
    // Reset state IN PLACE rather than nulling the singleton: the
    // module-level `searchWorkerPrewarm` and `prewarmSearchWorker()`
    // closures hold a reference to the original instance. Re-pointing the
    // static `instance` field would diverge their references from the next
    // `getInstance()` return value and silently miss mutations made through
    // the closure.
    if (SearchWorkerPrewarmManager.instance) {
      const inst = SearchWorkerPrewarmManager.instance;
      inst.listeners.clear();
      inst.scheduled = false;
      inst.status = "idle";
    }
  }
}

export { SearchWorkerPrewarmManager };
export const searchWorkerPrewarm = SearchWorkerPrewarmManager.getInstance();

/**
 * Convenience wrapper: schedule the prewarm and let the helper own the
 * singleton state. Returns nothing — prewarm is fire-and-forget.
 */
export function prewarmSearchWorker(): void {
  searchWorkerPrewarm.schedule();
}

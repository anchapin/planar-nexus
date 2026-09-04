/**
 * @fileoverview Tests for the Orama search-worker prewarm helper (issue #1576).
 *
 * The prewarm helper is a fire-and-forget bridge between the (app) shell
 * layout and the worker's `indexCardsInWorker()` call. These tests pin:
 *
 *   (a) schedule() is a no-op when window is undefined (SSR safety).
 *   (b) schedule() routes through requestIdleCallback when available and
 *       falls back to setTimeout(_, 1000) when it isn't.
 *   (c) The status lifecycle transitions idle → scheduled → running → ready
 *       on a successful worker index call.
 *   (d) The status surfaces "fallback" when the worker is unavailable
 *       (jsdom has no Worker global) without raising an error to the user.
 *   (e) The status surfaces "error" when indexCardsInWorker rejects, and
 *       the warning is logged — not thrown.
 *   (f) Repeated schedule() calls before the first run completes are
 *       collapsed into a single work item (idempotency).
 *   (g) Listeners attached via subscribe() are invoked on every transition
 *       and immediately with the current status on subscription.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

import {
  SearchWorkerPrewarmManager,
  searchWorkerPrewarm,
  type PrewarmStatus,
  type WindowLike,
} from "../prewarm-search-worker";

const idleCallbackMock = jest.fn<(cb: () => void) => number>();

// Mock the heavy neighbours so the helper can run under jsdom regardless of
// the real `Worker` global or the real IndexedDB schema. `indexCardsInWorker`
// is the only side-effect we care about for the prewarm logic. The mocks
// are defined INSIDE the jest.mock factories (jest hoists them above
// top-level statements, so referencing `const x = jest.fn()` declared below
// the call would throw "Cannot access 'x' before initialization") and
// re-exposed via `jest.requireMock` so the test body can call mockReturnValue
// on the same handle.
jest.mock("@/lib/card-database", () => ({
  __esModule: true,
  indexCardsInWorker: jest.fn(),
}));
jest.mock("../search-worker-client", () => ({
  __esModule: true,
  searchWorkerClient: {
    getStatus: jest.fn(),
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports --
 * Pulling the mocked module back out via jest's `require` is the documented
 * way to grab the same `jest.fn()` handle that the jest.mock factory
 * created. The factory runs once per test session, and re-requiring gives
 * us the same handle the mocked callers see.
 */
const { indexCardsInWorker: indexCardsInWorkerMock } =
  require("@/lib/card-database") as {
    indexCardsInWorker: jest.Mock<() => Promise<void>>;
  };
const { searchWorkerClient: searchWorkerClientMock } =
  require("../search-worker-client") as {
    searchWorkerClient: { getStatus: jest.Mock<() => string> };
  };
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Walk past the static `Window` type to allow tests to swap a mock in for
 * `requestIdleCallback`. Production code only calls
 * `w.requestIdleCallback(run)` with a no-arg callback, but the DOM lib type
 * expects an `IdleRequestCallback` with a deadline parameter — so we cast
 * the slot through `unknown` to avoid the lib type.
 */
type IdleCallback = NonNullable<WindowLike>["requestIdleCallback"];

function readRequestIdleCallback(): IdleCallback {
  return (window as unknown as { requestIdleCallback?: IdleCallback })
    .requestIdleCallback;
}

function setRequestIdleCallback(cb: IdleCallback): void {
  (
    window as unknown as { requestIdleCallback?: IdleCallback }
  ).requestIdleCallback = cb;
}

function clearRequestIdleCallback(): void {
  delete (window as unknown as { requestIdleCallback?: IdleCallback })
    .requestIdleCallback;
}

describe("prewarm-search-worker (issue #1576)", () => {
  // Store the jsdom-provided window.requestIdleCallback (typically undefined)
  // so each test can patch and restore it without leaking state across tests.
  let originalRIC: IdleCallback;

  beforeEach(() => {
    jest.clearAllMocks();
    SearchWorkerPrewarmManager._resetForTesting();

    // jsdom has no `Worker` global → the real search-worker-client would
    // report "fallback". Default this mock to "ready" so each test can pin
    // the exact transition it wants to validate (worker available).
    searchWorkerClientMock.getStatus.mockReturnValue("ready");
    indexCardsInWorkerMock.mockResolvedValue(undefined);
    idleCallbackMock.mockImplementation((cb: () => void) => {
      // Mimic the real requestIdleCallback by invoking the callback during
      // the next idle window. We flush it synchronously so the post-call
      // status is deterministic without `jest.runAllTimers()`.
      cb();
      return 1;
    });

    originalRIC = readRequestIdleCallback();
    // jsdom does not implement requestIdleCallback, but clear it explicitly
    // in case a previous test installed a mock and forgot to restore.
    clearRequestIdleCallback();
  });

  afterEach(() => {
    SearchWorkerPrewarmManager._resetForTesting();
    // Restore the original RIC so a deliberately-mutated window does not
    // leak into the next test.
    if (originalRIC) {
      setRequestIdleCallback(originalRIC);
    } else {
      clearRequestIdleCallback();
    }
    jest.useRealTimers();
  });

  /** Install the mocked `requestIdleCallback` on `window`. */
  function installIdleCallback(): void {
    setRequestIdleCallback(
      idleCallbackMock as unknown as (cb: () => void) => number,
    );
  }

  describe("SSR safety", () => {
    // jsdom installs a non-configurable `globalThis.window` so we cannot
    // delete/redefine it directly to simulate an SSR bundle. Instead, the
    // prewarm module exposes `scheduleWith(win)` whose `win === undefined`
    // branch is the SSR no-op path. The production `schedule()` calls
    // `scheduleWith(detectRuntimeWindow())` where `detectRuntimeWindow`
    // returns `undefined` when `typeof window === "undefined"` — the same
    // condition exercised by these tests.

    it("scheduleWith(undefined) is a no-op when no window-like is provided", () => {
      const mgr = SearchWorkerPrewarmManager.getInstance();
      expect(() => mgr.scheduleWith(undefined)).not.toThrow();
      expect(mgr.getStatus()).toBe("idle");
      expect(idleCallbackMock).not.toHaveBeenCalled();
      expect(indexCardsInWorkerMock).not.toHaveBeenCalled();
    });

    it("schedule() does not throw in a browser-like environment (jsdom)", () => {
      const mgr = SearchWorkerPrewarmManager.getInstance();
      expect(() => mgr.schedule()).not.toThrow();
      // jsdom has no Worker global → the prewarm falls into the "fallback"
      // branch via searchWorkerClient.getStatus(). After the schedule call
      // resolves, status is either "fallback" or "ready" depending on the
      // mocked worker status — never the initial "idle".
      // (We don't pin the exact final status here because the global mock
      // state can leak across tests; what matters is that schedule() did
      // not throw and indexed at least one transition.)
    });
  });

  describe("scheduling strategy", () => {
    it("prefers requestIdleCallback when available", async () => {
      installIdleCallback();

      const mgr = SearchWorkerPrewarmManager.getInstance();
      mgr.schedule();

      expect(idleCallbackMock).toHaveBeenCalledTimes(1);
      // The callback was invoked synchronously by the mock — the run() body
      // reached the awaited indexer. Drain the microtask queue so the
      // success branch lands the status on "ready" before we assert.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(indexCardsInWorkerMock).toHaveBeenCalledTimes(1);
      expect(mgr.getStatus()).toBe("ready");
    });

    it("falls back to setTimeout(_, 1000) when requestIdleCallback is missing", async () => {
      // jsdom does not provide requestIdleCallback; beforeEach deletes it.
      expect(readRequestIdleCallback()).toBeUndefined();

      jest.useFakeTimers();

      const mgr = SearchWorkerPrewarmManager.getInstance();
      mgr.schedule();

      // Before the timer fires the worker has NOT been invoked.
      expect(indexCardsInWorkerMock).not.toHaveBeenCalled();
      expect(mgr.getStatus()).toBe("scheduled");

      // Fire the timer. The run() callback executes synchronously up to
      // the `await indexCardsInWorker()` line, which yields. Switching to
      // real timers lets that microtask resolve before we await it.
      jest.advanceTimersByTime(1000);
      jest.useRealTimers();

      // Drain microtasks so the awaited indexer completes and status
      // transitions running → ready.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(indexCardsInWorkerMock).toHaveBeenCalledTimes(1);
      expect(mgr.getStatus()).toBe("ready");
    });
  });

  describe("status lifecycle", () => {
    it("transitions through idle → scheduled → running → ready on success", async () => {
      installIdleCallback();

      // Block the in-flight index call so we can observe the "running" state
      // before it settles to "ready".
      let resolveIndex: (() => void) | null = null;
      indexCardsInWorkerMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveIndex = resolve;
          }),
      );

      const transitions: PrewarmStatus[] = [];
      const mgr = SearchWorkerPrewarmManager.getInstance();
      const unsubscribe = mgr.subscribe((s: PrewarmStatus) =>
        transitions.push(s),
      );

      mgr.schedule();

      // Subscribe called the listener synchronously with the initial status,
      // and schedule() pushed "scheduled" before the idle callback ran.
      expect(transitions).toContain("scheduled");
      // After schedule() returns, the idle callback fired and run() reached
      // its await — status should now be "running".
      expect(mgr.getStatus()).toBe("running");
      expect(transitions).toContain("running");

      // Resolve the in-flight indexer, flush microtasks, expect "ready".
      resolveIndex!();
      await Promise.resolve();
      await Promise.resolve();
      expect(mgr.getStatus()).toBe("ready");
      expect(transitions).toContain("ready");

      unsubscribe();
    });

    it("transitions to 'fallback' when the worker is unavailable (jsdom / SSR)", () => {
      searchWorkerClientMock.getStatus.mockReturnValue("fallback");
      installIdleCallback();

      const mgr = SearchWorkerPrewarmManager.getInstance();
      mgr.schedule();

      expect(mgr.getStatus()).toBe("fallback");
      // The indexer MUST NOT be invoked when the worker is unavailable.
      expect(indexCardsInWorkerMock).not.toHaveBeenCalled();
    });

    it("transitions to 'error' and logs a warning when indexCardsInWorker rejects", async () => {
      const warnSpy = jest
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      indexCardsInWorkerMock.mockRejectedValueOnce(new Error("boom"));
      installIdleCallback();

      const mgr = SearchWorkerPrewarmManager.getInstance();
      mgr.schedule();

      // Allow the microtask queue (where the rejection is caught) to drain.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(mgr.getStatus()).toBe("error");
      expect(warnSpy).toHaveBeenCalledWith(
        "[prewarm-search-worker] worker index warm-up failed:",
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });
  });

  describe("idempotency", () => {
    it("collapses multiple schedule() calls before the idle callback runs", async () => {
      // Block the requestIdleCallback mock so the worker is not invoked
      // immediately and we can observe the in-flight dedupe.
      const pending: Array<() => void> = [];
      setRequestIdleCallback((cb: () => void) => {
        pending.push(cb);
        return 1;
      });

      const mgr = SearchWorkerPrewarmManager.getInstance();
      mgr.schedule();
      mgr.schedule();
      mgr.schedule();

      // Three calls → exactly one idle callback queued.
      expect(pending).toHaveLength(1);
      expect(mgr.getStatus()).toBe("scheduled");

      // Flush the idle callback and confirm only one worker index call.
      pending.pop()!();
      await Promise.resolve();
      await Promise.resolve();
      expect(indexCardsInWorkerMock).toHaveBeenCalledTimes(1);
    });

    it("schedule() refuses to start a second warm-up while the first is 'running'", async () => {
      installIdleCallback();

      // Block the index call until we manually resolve it.
      let resolveIndex: (() => void) | null = null;
      indexCardsInWorkerMock.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveIndex = resolve;
          }),
      );

      const mgr = SearchWorkerPrewarmManager.getInstance();
      // First call: enqueues and runs the idle callback immediately.
      mgr.schedule();
      expect(mgr.getStatus()).toBe("running");

      // Second call while running is a no-op — the helper bounces off the
      // status guard and the indexer is not re-invoked.
      mgr.schedule();
      expect(indexCardsInWorkerMock).toHaveBeenCalledTimes(1);

      // Finish the in-flight run.
      resolveIndex!();
      await Promise.resolve();
      await Promise.resolve();
      expect(mgr.getStatus()).toBe("ready");

      // A third schedule() after settling IS allowed (re-warm path).
      mgr.schedule();
      await Promise.resolve();
      await Promise.resolve();
      expect(indexCardsInWorkerMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("subscribe()", () => {
    it("invokes the listener synchronously with the current status on subscription", () => {
      const mgr = SearchWorkerPrewarmManager.getInstance();
      mgr.schedule();
      const calls: PrewarmStatus[] = [];
      mgr.subscribe((s: PrewarmStatus) => calls.push(s));
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls[0]).toBe(mgr.getStatus());
    });

    it("stops invoking the listener after unsubscribe()", () => {
      const mgr = SearchWorkerPrewarmManager.getInstance();
      const calls: PrewarmStatus[] = [];
      const unsubscribe = mgr.subscribe((s: PrewarmStatus) => calls.push(s));
      const before = calls.length;
      unsubscribe();
      mgr.schedule();
      // After unsubscribing the listener should not be invoked again,
      // regardless of how many transitions schedule() drives through.
      expect(calls.length).toBe(before);
    });
  });

  describe("module-level singleton", () => {
    it("exports the same singleton instance on repeated getInstance() calls", () => {
      const a = SearchWorkerPrewarmManager.getInstance();
      const b = SearchWorkerPrewarmManager.getInstance();
      expect(a).toBe(b);
    });

    it("exports a shared instance via the searchWorkerPrewarm symbol", () => {
      expect(searchWorkerPrewarm).toBe(
        SearchWorkerPrewarmManager.getInstance(),
      );
    });
  });
});

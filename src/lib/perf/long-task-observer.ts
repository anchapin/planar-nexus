/**
 * Long-Task API observer — issue #1245.
 *
 * Subscribes to the browser `PerformanceObserver` `longtask` entry stream and
 * forwards entries (main-thread tasks > 50ms) to any subscribers.
 *
 * The Long-Task API is the browser's first-class signal that the main thread
 * has been blocked past the 50ms rAIL/perceived-instant budget. Phase 32 ships
 * the AI worker off the main thread, but we still need to surface when (a)
 * the worker hands work back to the main thread, or (b) any other main-thread
 * work exceeds 50ms while the AI is "thinking". The game board uses this
 * signal to flip a `slowThinking` flag and surface a thinking-slowly badge
 * (see `ai-picking-indicator.tsx`).
 *
 * SSR-safe: when `PerformanceObserver` or `window` is undefined
 * (server-render, tests, ancient browsers, jsdom without the polyfill), the
 * module exposes no-op `subscribe` / `start` / `stop` so callers don't have to
 * branch on environment.
 *
 * The observer is a single shared instance per page; `subscribeLongTask`
 * returns an unsubscribe handle so React effects can release their listener
 * on unmount. Multiple subscribers are supported.
 */

type LongTaskEntry = PerformanceEntry & {
  readonly entryType: "longtask";
  readonly startTime: DOMHighResTimeStamp;
  readonly duration: DOMHighResTimeStamp;
  readonly name: string;
  readonly attribution: readonly TaskAttributionTiming[];
};

type TaskAttributionTiming = PerformanceEntry & {
  readonly entryType: "taskattribution";
  readonly startTime: DOMHighResTimeStamp;
  readonly duration: DOMHighResTimeStamp;
  readonly name: string;
  readonly containerType: string;
  readonly containerSrc?: string;
  readonly containerId?: string;
  readonly containerName?: string;
};

export type LongTaskListener = (entry: LongTaskEntry) => void;

/**
 * Minimal structural type of `PerformanceObserver` so the module stays
 * importable in SSR / Node test contexts where the constructor is undefined.
 * The real type from `lib.dom.d.ts` has a wider surface; we only use
 * `observe` / `disconnect` / `supportedEntryTypes`, so this is enough for
 * both real browsers and synthetic observers used in tests.
 */
export interface PerformanceObserverLike {
  observe: (options: { entryTypes: string[] }) => void;
  disconnect: () => void;
  readonly supportedEntryTypes?: readonly string[];
}

type PerformanceObserverCtorLike = new (
  callback: (list: { getEntries: () => readonly PerformanceEntry[] }) => void,
) => PerformanceObserverLike;

const LONG_TASK_ENTRY_TYPE = "longtask";

interface LongTaskObserverState {
  /** The currently-active observer, or null if not built / disconnected. */
  observer: PerformanceObserverLike | null;
  listeners: Set<LongTaskListener>;
  /** Entries received while no listener was subscribed. Drained on subscribe. */
  buffered: PerformanceEntry[];
  /**
   * `true` once the runtime has confirmed `longtask` is supported
   * (or `false` after probing). Cached so we don't construct a probe
   * observer twice.
   *   - `true`  → supported
   *   - `false` → unsupported (or not probed yet)
   */
  supportedKnown: boolean;
  support: boolean;
}

const state: LongTaskObserverState = {
  observer: null,
  listeners: new Set(),
  buffered: [],
  supportedKnown: false,
  support: false,
};

function getConstructor():
  | PerformanceObserverCtorLike
  | undefined {
  return (globalThis as { PerformanceObserver?: PerformanceObserverCtorLike })
    .PerformanceObserver;
}

/**
 * Build an observer wired to dispatch entries to listeners (or buffer them
 * when there are no listeners). Returns null in SSR / unsupported runs.
 */
function buildObserver(): PerformanceObserverLike | null {
  if (typeof window === "undefined") return null;
  const Ctor = getConstructor();
  if (!Ctor) return null;
  try {
    return new Ctor((list) => {
      const entries = list.getEntries();
      if (!entries.length) return;
      for (const entry of entries) {
        // We only subscribe for `longtask`, but a misconfigured entryTypes
        // list would surface other types — defensively narrow.
        if (entry.entryType !== LONG_TASK_ENTRY_TYPE) continue;
        if (state.listeners.size === 0) {
          state.buffered.push(entry);
          continue;
        }
        for (const listener of state.listeners) {
          listener(entry as LongTaskEntry);
        }
      }
    });
  } catch {
    return null;
  }
}

/**
 * Probe (once per page) whether `longtask` is in the UA's
 * `PerformanceObserver.supportedEntryTypes`. The probe observer is built with
 * a no-op callback and immediately disconnected so it doesn't double-count
 * with the real observer.
 */
function probeSupport(): boolean {
  if (typeof window === "undefined") return false;
  const Ctor = getConstructor();
  if (!Ctor) return false;
  let probe: PerformanceObserverLike | null = null;
  try {
    // Probe only exists so we can read `supportedEntryTypes`; the callback
    // is intentionally inert. We assign to a free variable to satisfy
    // `no-empty-function` without forking the constructor signature.
    const swallow = (): void => {
      void swallow;
    };
    probe = new Ctor(() => {
      swallow();
    });
  } catch {
    state.supportedKnown = true;
    state.support = false;
    return false;
  }
  state.support =
    probe.supportedEntryTypes?.includes(LONG_TASK_ENTRY_TYPE) ?? false;
  state.supportedKnown = true;
  try {
    probe.disconnect();
  } catch {
    // ignore
  }
  return state.support;
}

/**
 * Returns whether the Long-Task API is available in the current runtime.
 * Safe to call during SSR — returns `false` when `PerformanceObserver` is
 * missing or `longtask` isn't in `supportedEntryTypes`.
 */
export function isLongTaskObserverSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!state.supportedKnown) {
    return probeSupport();
  }
  return state.support;
}

/**
 * Register a listener for long-task entries. The listener is invoked with
 * each `PerformanceEntry` whose `entryType === "longtask"` (main-thread task
 * with duration > 50ms).
 *
 * Returns an unsubscribe function. Calling unsubscribe removes the listener
 * and (when no listeners remain) disconnects the underlying observer so the
 * main-thread bookkeeping cost drops back to zero.
 *
 * Multiple subscribers are supported; entries fan out to each. Entries that
 * arrived before this listener subscribed are drained once on subscribe so
 * late subscribers still see them.
 *
 * @example
 * ```ts
 * const stop = subscribeLongTask((entry) => {
 *   console.warn(`Main thread was blocked for ${entry.duration}ms`);
 * });
 * // later…
 * stop();
 * ```
 */
export function subscribeLongTask(listener: LongTaskListener): () => void {
  state.listeners.add(listener);

  // Late subscribers see anything buffered while no listener was attached.
  if (state.buffered.length > 0) {
    const drained = state.buffered;
    state.buffered = [];
    for (const entry of drained) {
      listener(entry as LongTaskEntry);
    }
  }

  // Spin the observer up on the first subscribe, but only if the runtime
  // actually supports `longtask` — otherwise we'd just build a phantom
  // observer whose callbacks never fire (or throw).
  if (state.listeners.size === 1 && state.observer === null) {
    if (isLongTaskObserverSupported()) {
      const observer = buildObserver();
      if (observer) {
        try {
          observer.observe({ entryTypes: [LONG_TASK_ENTRY_TYPE] });
          state.observer = observer;
        } catch {
          state.observer = null;
        }
      }
    }
  }

  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0 && state.observer) {
      try {
        state.observer.disconnect();
      } catch {
        // ignore
      }
      state.observer = null;
    }
  };
}

/**
 * Start the observer eagerly (build it even if no listener is attached yet).
 * Useful when callers want to capture a baseline before subscribers show up —
 * entries that arrive before any subscribe are buffered and replayed once a
 * subscriber attaches.
 *
 * Idempotent. No-op in SSR / unsupported environments.
 */
export function start(): void {
  if (typeof window === "undefined") return;
  if (!isLongTaskObserverSupported()) return;
  if (state.observer !== null) return;
  const observer = buildObserver();
  if (!observer) return;
  try {
    observer.observe({ entryTypes: [LONG_TASK_ENTRY_TYPE] });
    state.observer = observer;
  } catch {
    state.observer = null;
  }
}

/**
 * Stop the observer. Safe to call from SSR — becomes a no-op when no
 * observer was ever constructed. Listeners are kept so callers can resume
 * later via `start()` or by re-subscribing.
 */
export function stop(): void {
  if (state.observer) {
    try {
      state.observer.disconnect();
    } catch {
      // ignore
    }
  }
  state.observer = null;
}

/**
 * Test-only escape hatch. Resets the singleton so each test gets a clean
 * subscriber set and observer handle. Production callers should never need
 * this — it is exported for `@jest-environment jsdom` suites.
 *
 * @internal
 */
export function __resetLongTaskObserverForTests(): void {
  if (state.observer) {
    try {
      state.observer.disconnect();
    } catch {
      // ignore
    }
  }
  state.observer = null;
  state.listeners.clear();
  state.buffered = [];
  state.supportedKnown = false;
  state.support = false;
}

export type { LongTaskEntry };

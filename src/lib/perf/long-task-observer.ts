/**
 * Long-Task API observer — issue #1245 + issue #1575.
 *
 * Subscribes to the browser `PerformanceObserver` `longtask` entry stream and
 * forwards entries (main-thread tasks > 50ms) to any subscribers. Also keeps
 * a rolling ring buffer of recent entries (capped at 100 records or 60s old,
 * whichever evicts first) accessible via {@link getLongTaskLog} so the
 * app-wide `<LongTaskProbe>` mounted in `src/app/(app)/layout.tsx` can
 * surface stall counts on routes that previously had zero observability
 * (deck-builder, collection, deck-coach, multiplayer, draft, …).
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
 * branch on environment. The ring buffer stays empty during SSR.
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
 * The shape we record into the rolling ring buffer. We strip
 * `TaskAttributionTiming[]` from the raw entry to keep the per-entry memory
 * footprint ~150 bytes; with the buffer cap (100 entries) the worst-case
 * ceiling stays under 50 KB. Callers can recover the full entry via
 * `performance.getEntriesByType("longtask")` if they need the attribution
 * graph for diagnostics.
 */
export interface LongTaskLogEntry {
  /** Coarse source of the long task — currently always "longtask". */
  readonly entryType: "longtask";
  /** DOMHighResTimeStamp when the long task started (ms since timeOrigin). */
  readonly startTime: DOMHighResTimeStamp;
  /** Duration of the long task in ms (already > 50 ms by definition). */
  readonly duration: DOMHighResTimeStamp;
  /** The `name` field of the underlying PerformanceEntry (e.g. "self"). */
  readonly name: string;
  /**
   * Coarse attribution category. The raw `attribution` array can be very
   * deep; we collapse it to a single short string so the buffer stays small.
   * `undefined` when the entry arrived without attribution.
   */
  readonly attribution: string | undefined;
}

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
  /**
   * Rolling ring buffer of recent `LongTaskLogEntry` records. Bounded by
   * `LOG_MAX_ENTRIES` and `LOG_MAX_AGE_MS` (whichever evicts first) so the
   * buffer's memory ceiling stays under 50 KB even on a busy app page.
   *
   * Read via {@link getLongTaskLog} (returns a defensive copy). Cleared via
   * {@link clearLongTaskLog}. Populated by {@link recordLongTaskEntry},
   * which is invoked from the singleton observer's callback so every
   * long-task entry — whether or not a consumer is subscribed — lands in the
   * log. This is the buffer the `<LongTaskProbe>` component reads to surface
   * app-wide stall counts to diagnostics (issue #1575).
   */
  log: LongTaskLogEntry[];
}

/** Maximum number of entries kept in the rolling ring buffer. */
const LOG_MAX_ENTRIES = 100;

/** Maximum age (ms) of any entry kept in the rolling ring buffer. */
const LOG_MAX_AGE_MS = 60_000;

const state: LongTaskObserverState = {
  observer: null,
  listeners: new Set(),
  buffered: [],
  supportedKnown: false,
  support: false,
  log: [],
};

function getConstructor(): PerformanceObserverCtorLike | undefined {
  return (globalThis as { PerformanceObserver?: PerformanceObserverCtorLike })
    .PerformanceObserver;
}

/**
 * Build an observer wired to dispatch entries to listeners (or buffer them
 * when there are no listeners). Returns null in SSR / unsupported runs.
 *
 * Note: the observer does NOT auto-push entries into the ring buffer; that
 * is the listener's responsibility (the `<LongTaskProbe>` records, the
 * `game-board-client` slow-thinking counter does not). Auto-recording here
 * would double-count for any listener that also records.
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
  state.log = [];
}

/**
 * Collapse a raw `LongTaskEntry` into a compact {@link LongTaskLogEntry}.
 * Exposed so test fixtures can build records without round-tripping the
 * browser observer; production callers should let the singleton callback
 * record entries itself.
 */
export function toLongTaskLogEntry(entry: LongTaskEntry): LongTaskLogEntry {
  const first = entry.attribution?.[0];
  const attribution =
    first === undefined
      ? undefined
      : typeof first.containerType === "string" &&
          first.containerType.length > 0
        ? first.containerType
        : first.name;
  return {
    entryType: "longtask",
    startTime: entry.startTime,
    duration: entry.duration,
    name: entry.name,
    attribution,
  };
}

/**
 * Push a long-task entry into the rolling ring buffer. Evicts the oldest
 * entries when the buffer exceeds {@link LOG_MAX_ENTRIES} OR when an entry
 * is older than {@link LOG_MAX_AGE_MS} relative to `performance.now()`. Safe
 * to call during SSR — the buffer stays empty but the call does not throw.
 *
 * Idempotent against duplicate entries? No — the browser does not dedupe
 * `longtask` entries, so we record each one. That matches the raw
 * `performance.getEntriesByType("longtask")` count 1:1, which is what
 * downstream diagnostics expect.
 */
export function recordLongTaskEntry(entry: LongTaskEntry): void {
  if (typeof window === "undefined") return;
  const record = toLongTaskLogEntry(entry);
  state.log.push(record);
  evictLongTaskLog();
}

/**
 * Trim the ring buffer to its bounds. Exposed so the
 * `<LongTaskProbe>` component can call it on mount (entries that arrived
 * >60s ago are irrelevant to a freshly-mounted page) and so test fixtures
 * can age-out entries deterministically by stubbing `performance.now`.
 */
function evictLongTaskLog(now: number = readNow()): void {
  // 1. Time-based eviction — drop entries older than the rolling window.
  const cutoff = now - LOG_MAX_AGE_MS;
  let dropIdx = 0;
  while (dropIdx < state.log.length && state.log[dropIdx]!.startTime < cutoff) {
    dropIdx += 1;
  }
  if (dropIdx > 0) {
    state.log.splice(0, dropIdx);
  }
  // 2. Size-based eviction — keep only the most recent LOG_MAX_ENTRIES.
  const overflow = state.log.length - LOG_MAX_ENTRIES;
  if (overflow > 0) {
    state.log.splice(0, overflow);
  }
}

function readNow(): DOMHighResTimeStamp {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
}

/**
 * Return a defensive, frozen snapshot of the rolling ring buffer. The
 * returned array is a fresh copy with each entry deep-frozen so callers
 * cannot mutate the singleton state by accident. Order is chronological
 * (oldest first), matching `performance.getEntriesByType("longtask")`.
 *
 * Safe to call during SSR — returns an empty array.
 */
export function getLongTaskLog(): readonly LongTaskLogEntry[] {
  if (typeof window === "undefined") return [];
  // We deliberately do NOT evict on read; eviction happens at record time
  // (and on probe mount). Reading is a passive diagnostic.
  return Object.freeze(state.log.map(freezeLongTaskLogEntry));
}

function freezeLongTaskLogEntry(entry: LongTaskLogEntry): LongTaskLogEntry {
  return Object.freeze({ ...entry });
}

/**
 * Clear the rolling ring buffer. Intended for tests and for any future
 * "reset diagnostics" affordance in a developer panel; production render
 * paths should not call it.
 */
export function clearLongTaskLog(): void {
  state.log = [];
}

export type { LongTaskEntry };

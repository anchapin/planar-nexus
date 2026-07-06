/**
 * Tests for the Long-Task API observer — issue #1245.
 *
 * Covers:
 *   - SSR/no-`window` fallback path is a no-op (start/stop/subscribe all safe).
 *   - No-support path (real `PerformanceObserver` is missing or doesn't list
 *     `longtask`) is also a no-op.
 *   - A real observer forwards entries to all subscribers.
 *   - Buffered entries are drained on subscribe (late subscribers see history).
 *   - Last subscriber leaving tears down the underlying observer.
 *   - start()/stop() lifecycle: start enables, stop disconnects.
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
  subscribeLongTask,
  start,
  stop,
  isLongTaskObserverSupported,
  __resetLongTaskObserverForTests,
  type LongTaskEntry,
} from "../long-task-observer";

interface FakeObserver {
  callback: (list: { getEntries: () => PerformanceEntry[] }) => void;
  observe: jest.Mock;
  disconnect: jest.Mock;
  supportedEntryTypes: readonly string[];
}

interface PerformanceObserverMockHandle {
  PerformanceObserver: jest.Mock;
  instances: FakeObserver[];
  install: () => void;
  uninstall: () => void;
}

function installPerformanceObserver(
  supportedTypes: readonly string[] = ["longtask"],
): PerformanceObserverMockHandle {
  const instances: FakeObserver[] = [];
  const PerformanceObserverMock = jest.fn().mockImplementation((callback) => {
    const observer: FakeObserver = {
      callback: callback as FakeObserver["callback"],
      observe: jest.fn(),
      disconnect: jest.fn(),
      supportedEntryTypes: supportedTypes,
    };
    instances.push(observer);
    return observer;
  });
  const original = (globalThis as { PerformanceObserver?: unknown })
    .PerformanceObserver;
  (globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
    PerformanceObserverMock;
  return {
    PerformanceObserver: PerformanceObserverMock,
    instances,
    install: () => {
      // already installed above; provided for symmetry with `uninstall`.
    },
    uninstall: () => {
      if (original === undefined) {
        delete (globalThis as { PerformanceObserver?: unknown })
          .PerformanceObserver;
      } else {
        (globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
          original;
      }
    },
  };
}

function makeLongTaskEntry(overrides: Partial<LongTaskEntry> = {}): LongTaskEntry {
  return {
    name: "self",
    entryType: "longtask",
    startTime: 0,
    duration: 75,
    attribution: [],
    toJSON() {
      return {};
    },
    ...overrides,
  } as unknown as LongTaskEntry;
}

/**
 * Returns the most recently constructed fake observer in the handle, which is
 * the one that ends up as the singleton's `state.observer`. The first
 * constructed observer is usually the support-probe (created by
 * `isLongTaskObserverSupported()`); we want the real one the observer module
 * used to dispatch entries.
 */
function realObserver(handle: PerformanceObserverMockHandle): FakeObserver {
  const last = handle.instances.at(-1);
  if (!last) {
    throw new Error(
      "expected at least one PerformanceObserver instance to have been constructed",
    );
  }
  return last;
}

beforeEach(() => {
  __resetLongTaskObserverForTests();
});

afterEach(() => {
  __resetLongTaskObserverForTests();
});

describe("isLongTaskObserverSupported", () => {
  it("returns false on SSR (no window)", () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      // The SSR probe checks `typeof window === "undefined"`; deleting it
      // makes the check pass for this runtime test too.
      expect(isLongTaskObserverSupported()).toBe(false);
    } finally {
      if (originalWindow !== undefined) {
        (globalThis as { window: unknown }).window = originalWindow;
      }
    }
  });

  it("returns false when PerformanceObserver is missing", () => {
    const original = (globalThis as { PerformanceObserver?: unknown })
      .PerformanceObserver;
    delete (globalThis as { PerformanceObserver?: unknown })
      .PerformanceObserver;
    try {
      expect(isLongTaskObserverSupported()).toBe(false);
    } finally {
      if (original !== undefined) {
        (globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
          original;
      }
    }
  });

  it("returns true when longtask is in supportedEntryTypes", () => {
    const handle = installPerformanceObserver(["longtask", "measure"]);
    try {
      expect(isLongTaskObserverSupported()).toBe(true);
    } finally {
      handle.uninstall();
    }
  });

  it("returns false when longtask is NOT in supportedEntryTypes", () => {
    const handle = installPerformanceObserver(["measure", "navigation"]);
    try {
      expect(isLongTaskObserverSupported()).toBe(false);
    } finally {
      handle.uninstall();
    }
  });
});

describe("SSR / no-support fallback", () => {
  it("subscribeLongTask is a no-op when window is undefined", () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      const listener = jest.fn();
      const stop = subscribeLongTask(listener);
      // Listener was registered internally so future `start()` would route
      // to it, but during SSR there's no observer to call it.
      stop();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      if (originalWindow !== undefined) {
        (globalThis as { window: unknown }).window = originalWindow;
      }
    }
  });

  it("start/stop are no-ops when PerformanceObserver is missing", () => {
    const original = (globalThis as { PerformanceObserver?: unknown })
      .PerformanceObserver;
    delete (globalThis as { PerformanceObserver?: unknown })
      .PerformanceObserver;
    try {
      expect(() => start()).not.toThrow();
      expect(() => stop()).not.toThrow();
      expect(isLongTaskObserverSupported()).toBe(false);
    } finally {
      if (original !== undefined) {
        (globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
          original;
      }
    }
  });
});

describe("subscribeLongTask — happy path", () => {
  it("forwards a long-task entry to a subscriber after the observer fires", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      const listener = jest.fn();
      const stop = subscribeLongTask(listener);
      const observer = realObserver(handle);

      // The observer should have been told to watch `longtask` entries.
      expect(observer.observe).toHaveBeenCalledWith({
        entryTypes: ["longtask"],
      });

      // Dispatch a synthetic entry.
      const entry = makeLongTaskEntry({ duration: 120 });
      observer.callback({ getEntries: () => [entry] });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(entry);

      stop();
    } finally {
      handle.uninstall();
    }
  });

  it("fans out an entry to multiple subscribers via a single observer", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      const a = jest.fn();
      const b = jest.fn();
      const stopA = subscribeLongTask(a);
      const stopB = subscribeLongTask(b);

      // Second subscribe must NOT build a second observer.
      const observer = realObserver(handle);
      expect(observer.observe).toHaveBeenCalledTimes(1);

      observer.callback({
        getEntries: () => [makeLongTaskEntry({ duration: 80 })],
      });

      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);

      stopA();
      stopB();
    } finally {
      handle.uninstall();
    }
  });

  it("filters out entries whose entryType !== 'longtask'", () => {
    const handle = installPerformanceObserver(["longtask", "measure"]);
    try {
      const listener = jest.fn();
      const stop = subscribeLongTask(listener);
      const observer = realObserver(handle);

      const measureLike = {
        name: "self",
        entryType: "measure" as const,
        startTime: 0,
        duration: 50,
        toJSON() {
          return {};
        },
      };
      observer.callback({ getEntries: () => [measureLike] });

      expect(listener).not.toHaveBeenCalled();

      observer.callback({
        getEntries: () => [makeLongTaskEntry({ duration: 200 })],
      });
      expect(listener).toHaveBeenCalledTimes(1);

      stop();
    } finally {
      handle.uninstall();
    }
  });

  it("buffers entries that arrive before any listener and drains them on subscribe", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      // `start()` builds the observer eagerly with no listeners, so entries
      // accumulate in `state.buffered`.
      start();
      const observer = realObserver(handle);
      const buffered = makeLongTaskEntry({ duration: 90 });
      observer.callback({ getEntries: () => [buffered] });

      const listener = jest.fn();
      const stop = subscribeLongTask(listener);

      // Buffered entry should have been delivered to the new subscriber.
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(buffered);

      stop();
    } finally {
      handle.uninstall();
    }
  });
});

describe("subscribeLongTask — lifecycle", () => {
  it("disconnects the observer when the last subscriber unsubscribes", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      const stop = subscribeLongTask(jest.fn());
      const observer = realObserver(handle);
      expect(observer.disconnect).not.toHaveBeenCalled();

      stop();

      expect(observer.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      handle.uninstall();
    }
  });

  it("keeps the observer alive while at least one subscriber remains", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      const stopA = subscribeLongTask(jest.fn());
      const stopB = subscribeLongTask(jest.fn());
      const observer = realObserver(handle);

      stopA();
      expect(observer.disconnect).not.toHaveBeenCalled();

      stopB();
      expect(observer.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      handle.uninstall();
    }
  });

  it("stop() on a stopped system is still safe", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      const stop = subscribeLongTask(jest.fn());
      const observer = realObserver(handle);

      stop();
      // Calling stop() again on a disconnected system is still safe.
      expect(() => stop()).not.toThrow();
      expect(observer.disconnect).toHaveBeenCalled();
    } finally {
      handle.uninstall();
    }
  });
});

describe("start() / stop() explicit lifecycle", () => {
  it("start() builds an observer eagerly so entries can buffer pre-subscribe", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      start();
      // The eager observer is built immediately (no listener required).
      const observer = realObserver(handle);
      expect(observer.observe).toHaveBeenCalledWith({
        entryTypes: ["longtask"],
      });

      stop();
      expect(observer.disconnect).toHaveBeenCalled();
    } finally {
      handle.uninstall();
    }
  });

  it("start() with no longtask support is a no-op (no observe call, no listener)", () => {
    // Constructor returns valid instances but the supported list excludes
    // `longtask`. start() must not throw, must not call observe() with
    // `longtask`, and must not surface entries to listeners.
    const handle = installPerformanceObserver(["measure"]);
    try {
      const listener = jest.fn();
      const stop = subscribeLongTask(listener);
      start();

      const observer = realObserver(handle);
      // The probe instance is built by `isLongTaskObserverSupported` and
      // immediately disconnected; a fresh subscribe + start cycle must not
      // call `observe({entryTypes: ["longtask"]})` because it's unsupported.
      expect(observer.observe).not.toHaveBeenCalledWith({
        entryTypes: ["longtask"],
      });

      // Calling the probe's callback manually still routes through the
      // closure that buffers for any subscriber — but the listening path is
      // short-circuited because we never called observe() on the real
      // observer in the unsupported case.
      stop();
      expect(listener).not.toHaveBeenCalled();
    } finally {
      handle.uninstall();
    }
  });
});

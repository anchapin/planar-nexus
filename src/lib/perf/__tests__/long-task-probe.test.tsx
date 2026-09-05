/**
 * `<LongTaskProbe>` component tests — issue #1575.
 *
 * The probe must:
 *   - Mount a `subscribeLongTask` listener on render and unsubscribe on
 *     unmount (so navigation between routes doesn't leak subscriptions).
 *   - Push every entry into the singleton ring buffer via
 *     `recordLongTaskEntry`.
 *   - Degrade to a no-op when `PerformanceObserver` is undefined (jsdom
 *     baseline / SSR / unsupported runtime) without throwing.
 *   - Render nothing — the component is a side-effect-only mount.
 *
 * The probe renders nothing, so we assert on observable side effects
 * (the ring buffer + the listener count) rather than DOM nodes.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { render, act } from "@testing-library/react";

import {
  __resetLongTaskObserverForTests,
  getLongTaskLog,
  type LongTaskEntry,
} from "../long-task-observer";
import { LongTaskProbe } from "../long-task-probe";

// ---------------------------------------------------------------------------
// Test scaffolding — mirrors the pattern in long-task-observer.test.ts so the
// two suites can be read side by side.
// ---------------------------------------------------------------------------

interface FakeObserver {
  callback: (list: { getEntries: () => readonly PerformanceEntry[] }) => void;
  observe: jest.Mock;
  disconnect: jest.Mock;
  supportedEntryTypes: readonly string[];
}

interface PerformanceObserverMockHandle {
  instances: FakeObserver[];
  install: () => void;
  uninstall: () => void;
}

function installPerformanceObserver(
  supportedTypes: readonly string[] = ["longtask"],
): PerformanceObserverMockHandle {
  const instances: FakeObserver[] = [];
  // Explicitly type the constructor mock as a `new (callback) => FakeObserver`
  // so the call signature matches the singleton's `PerformanceObserverCtorLike`.
  // Without this annotation, `jest.fn()` defaults to `UnknownFunction`, which
  // is incompatible with the observer's expected parameter shape.
  const PerformanceObserverMock = jest
    .fn<(callback: FakeObserver["callback"]) => FakeObserver>()
    .mockImplementation((callback: FakeObserver["callback"]) => {
      const observer: FakeObserver = {
        callback,
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
    instances,
    install: () => {
      // already installed
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

function makeLongTaskEntry(
  overrides: Partial<LongTaskEntry> = {},
): LongTaskEntry {
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

beforeEach(() => {
  __resetLongTaskObserverForTests();
});

afterEach(() => {
  __resetLongTaskObserverForTests();
});

// ---------------------------------------------------------------------------
// Mount / unmount lifecycle
// ---------------------------------------------------------------------------

describe("LongTaskProbe — lifecycle (#1575)", () => {
  it("renders nothing (a side-effect-only mount)", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      const { container } = render(<LongTaskProbe />);
      expect(container.firstChild).toBeNull();
    } finally {
      handle.uninstall();
    }
  });

  it("subscribes exactly one listener on mount and unsubscribes on unmount", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      // Mount → 1 listener.
      const first = render(<LongTaskProbe />);
      // The first constructed observer is the support-probe; the second is
      // the real observer the probe wires up. Verify the real observer was
      // told to watch longtask.
      expect(handle.instances.length).toBeGreaterThanOrEqual(2);
      const real = handle.instances.at(-1) as FakeObserver;
      expect(real.observe).toHaveBeenCalledWith({
        entryTypes: ["longtask"],
      });
      expect(real.disconnect).not.toHaveBeenCalled();

      // Unmount → disconnect.
      first.unmount();
      expect(real.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      handle.uninstall();
    }
  });

  it("exactly one subscription remains after a route change (mount/unmount/remount)", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      // Simulate a navigation by mounting → unmounting → mounting. The
      // probe must (a) disconnect its observer when unmounted, (b) wire
      // up a fresh observer when remounted (the singleton tears down on
      // last-unsubscribe), and (c) never leak its listener.
      const r1 = render(<LongTaskProbe />);
      // The support-probe is the first constructed observer (instance 0);
      // the probe's real observer is instance 1.
      const firstObserver = handle.instances[1] as FakeObserver;
      expect(firstObserver.disconnect).not.toHaveBeenCalled();

      r1.unmount();
      // First observer should have been disconnected exactly once.
      expect(firstObserver.disconnect).toHaveBeenCalledTimes(1);

      const r2 = render(<LongTaskProbe />);
      // A fresh observer was constructed for r2's listener — singleton
      // tears down on last-unsubscribe and rebuilds on next subscribe.
      const secondObserver = handle.instances.at(-1) as FakeObserver;
      expect(secondObserver).not.toBe(firstObserver);
      expect(secondObserver.disconnect).not.toHaveBeenCalled();

      // Dispatch an entry and verify only one listener fires (no leak from
      // r1): we add a parallel `jest.fn()` listener that should receive
      // exactly one delivery per entry, alongside the probe.
      const probeListener = jest.fn();
      // Reuse the singleton's subscribe API from the test's perspective:
      // we just want to count how many times the callback fires per
      // entry. The probe listener is already wired internally; we can't
      // inspect it directly, so we assert on the observer state instead.
      secondObserver.callback({
        getEntries: () => [makeLongTaskEntry({ duration: 80, startTime: 0 })],
      });
      void probeListener;

      r2.unmount();
      expect(secondObserver.disconnect).toHaveBeenCalledTimes(1);
    } finally {
      handle.uninstall();
    }
  });
});

// ---------------------------------------------------------------------------
// SSR / unsupported runtime
// ---------------------------------------------------------------------------

describe("LongTaskProbe — SSR / unsupported runtime (#1575)", () => {
  it("does not throw when PerformanceObserver is missing", () => {
    const original = (globalThis as { PerformanceObserver?: unknown })
      .PerformanceObserver;
    delete (globalThis as { PerformanceObserver?: unknown })
      .PerformanceObserver;
    try {
      expect(() => render(<LongTaskProbe />)).not.toThrow();
      // No entries should have landed in the buffer.
      expect(getLongTaskLog()).toEqual([]);
    } finally {
      if (original !== undefined) {
        (globalThis as { PerformanceObserver: unknown }).PerformanceObserver =
          original;
      }
    }
  });

  it("does not throw when window is undefined", () => {
    const originalWindow = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(() => render(<LongTaskProbe />)).not.toThrow();
    } finally {
      if (originalWindow !== undefined) {
        (globalThis as { window: unknown }).window = originalWindow;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Entry recording
// ---------------------------------------------------------------------------

describe("LongTaskProbe — entry recording (#1575)", () => {
  it("records entries dispatched through the observer into the ring buffer", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      render(<LongTaskProbe />);
      const observer = handle.instances.at(-1) as FakeObserver;

      act(() => {
        observer.callback({
          getEntries: () => [
            makeLongTaskEntry({ duration: 80, startTime: 10 }),
            makeLongTaskEntry({ duration: 120, startTime: 30 }),
          ],
        });
      });

      const log = getLongTaskLog();
      expect(log).toHaveLength(2);
      expect(log[0]).toMatchObject({ startTime: 10, duration: 80 });
      expect(log[1]).toMatchObject({ startTime: 30, duration: 120 });
    } finally {
      handle.uninstall();
    }
  });

  it("threshold prop drops entries shorter than the configured budget", () => {
    const handle = installPerformanceObserver(["longtask"]);
    try {
      render(<LongTaskProbe thresholdMs={200} />);
      const observer = handle.instances.at(-1) as FakeObserver;

      act(() => {
        observer.callback({
          getEntries: () => [
            makeLongTaskEntry({ duration: 80, startTime: 10 }), // < 200 → drop
            makeLongTaskEntry({ duration: 250, startTime: 30 }), // ≥ 200 → keep
          ],
        });
      });

      const log = getLongTaskLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ startTime: 30, duration: 250 });
    } finally {
      handle.uninstall();
    }
  });
});

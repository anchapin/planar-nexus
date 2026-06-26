import { renderHook, act } from "@testing-library/react";
import { usePrefersReducedMotion } from "../use-prefers-reduced-motion";

/**
 * Minimal MediaQueryList stub used to drive the hook under jsdom. The global
 * matchMedia mock installed in jest.setup.js returns a fresh stub for every
 * call; these helpers swap the implementation per test.
 */
type Listener = (event: { matches: boolean }) => void;

interface MqlStub {
  readonly matches: boolean;
  media: string;
  onchange: null;
  addEventListener: (type: string, cb: Listener) => void;
  removeEventListener: (type: string, cb: Listener) => void;
  addListener: (cb: Listener) => void;
  removeListener: (cb: Listener) => void;
  dispatchEvent: () => boolean;
}

function installMatchMedia(matches: boolean): {
  mql: MqlStub;
  emit: (next: boolean) => void;
} {
  const listeners: Listener[] = [];
  let current = matches;
  const mql: MqlStub = {
    // `matches` is a live view of `current` — the hook reads `mql.matches`
    // inside its listener, so it must reflect the latest emitted value.
    get matches() {
      return current;
    },
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener: (_type, cb) => listeners.push(cb),
    removeEventListener: (_type, cb) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    addListener: (cb) => listeners.push(cb),
    removeListener: (cb) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent: () => true,
  };

  const matchMediaSpy = jest.fn().mockImplementation(() => mql);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: matchMediaSpy,
  });

  return {
    mql,
    emit: (next: boolean) => {
      current = next;
      // matchMedia listeners receive a MediaQueryListEvent-like object.
      listeners.forEach((cb) => cb({ matches: current }));
    },
  };
}

describe("usePrefersReducedMotion", () => {
  it("reports false when the OS preference is not set", () => {
    installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
  });

  it("reports true when the OS preference is 'reduce'", () => {
    installMatchMedia(true);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(true);
  });

  it("reacts to media-query changes at runtime", () => {
    const { emit } = installMatchMedia(false);
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    act(() => emit(true));
    expect(result.current).toBe(true);

    act(() => emit(false));
    expect(result.current).toBe(false);
  });

  it("returns false (SSR-safe default) when matchMedia is unavailable", () => {
    // Simulate an environment without matchMedia (SSR / older browser).
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const { result, unmount } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    // Should not throw on unmount either.
    expect(() => unmount()).not.toThrow();
  });
});

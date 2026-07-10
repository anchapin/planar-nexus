/**
 * Unit tests for src/hooks/use-desktop-update.ts (issue #1403).
 *
 * Strategy: mock the upstream `src/lib/updater` module so the hook sees a
 * deterministic discriminated result per test. We assert:
 *
 *   - "unsupported" status when not running under Tauri (the only state
 *     the banner cares about).
 *   - "checked" status with `updateAvailable: true` when the upstream
 *     reports an available update.
 *   - "checked" status with `updateAvailable: false` when the upstream
 *     reports no update.
 *   - `recheck()` forces a fresh call to the upstream.
 *   - The hook can be safely unmounted (no leaked intervals, no thrown
 *     effects).
 */

import { renderHook, act } from "@testing-library/react";

jest.mock("../../lib/updater", () => {
  const actual = jest.requireActual("../../lib/updater");
  return {
    ...actual,
    isTauriEnvironment: jest.fn(),
    checkForDesktopUpdate: jest.fn(),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mocked = jest.mocked(require("../../lib/updater"));

import { useDesktopUpdate } from "../use-desktop-update";

describe("useDesktopUpdate (issue #1403)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reports 'unsupported' when not running in Tauri", () => {
    mocked.isTauriEnvironment.mockReturnValue(false);
    const { result } = renderHook(() => useDesktopUpdate());
    expect(result.current.status).toBe("unsupported");
    expect(result.current.isSupported).toBe(false);
    expect(result.current.updateAvailable).toBe(false);
  });

  it("transitions to 'checked' + updateAvailable when the upstream reports an update", async () => {
    mocked.isTauriEnvironment.mockReturnValue(true);
    mocked.checkForDesktopUpdate.mockResolvedValue({
      available: true,
      version: "1.2.3",
      notes: "Bug fixes",
      publishedAt: "2026-07-10T12:00:00Z",
      pubkeyFingerprint: "dW50cnVzdGVkIGNvbW1lbm",
    });

    const { result } = renderHook(() => useDesktopUpdate());

    // The initial status is `idle`; the check is kicked off in an effect
    // so we have to flush microtasks before observing `checked`. Note
    // that React 19 + renderHook fires effects eagerly, so the first
    // observed status may already be `checking`; we only assert that
    // the *terminal* status after the async work settles is `checked`.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("checked");
    expect(result.current.updateAvailable).toBe(true);
    expect(result.current.result?.available).toBe(true);
    expect(mocked.checkForDesktopUpdate).toHaveBeenCalledTimes(1);
  });

  it("transitions to 'checked' + updateAvailable=false when no update is available", async () => {
    mocked.isTauriEnvironment.mockReturnValue(true);
    mocked.checkForDesktopUpdate.mockResolvedValue({
      available: false,
      currentVersion: "1.0.0",
    });

    const { result } = renderHook(() => useDesktopUpdate());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("checked");
    expect(result.current.updateAvailable).toBe(false);
  });

  it("recheck() triggers a fresh checkForDesktopUpdate call", async () => {
    mocked.isTauriEnvironment.mockReturnValue(true);
    mocked.checkForDesktopUpdate.mockResolvedValue({
      available: false,
      currentVersion: "1.0.0",
    });

    const { result } = renderHook(() => useDesktopUpdate());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const callsBefore = mocked.checkForDesktopUpdate.mock.calls.length;

    await act(async () => {
      await result.current.recheck();
    });
    expect(mocked.checkForDesktopUpdate.mock.calls.length).toBe(
      callsBefore + 1,
    );
  });

  it("does not run any check when disabled (even in Tauri)", async () => {
    mocked.isTauriEnvironment.mockReturnValue(true);
    mocked.checkForDesktopUpdate.mockResolvedValue({
      available: false,
      currentVersion: "1.0.0",
    });
    const { result } = renderHook(() => useDesktopUpdate({ disabled: true }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("unsupported");
    expect(mocked.checkForDesktopUpdate).not.toHaveBeenCalled();
  });

  it("unmounts cleanly without throwing", () => {
    mocked.isTauriEnvironment.mockReturnValue(false);
    const { unmount } = renderHook(() => useDesktopUpdate());
    expect(() => unmount()).not.toThrow();
  });
});

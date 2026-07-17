/**
 * @fileoverview Integration tests for the localStorage validation added to the
 * replay viewer in issue #1429.
 *
 * Covers `useReplayStorage`'s mount `useEffect`, which previously did a bare
 * `JSON.parse(stored)` and would feed arbitrary JSON straight into the replay
 * list state, crashing the viewer on mount.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { renderHook, waitFor } from "@testing-library/react";

import { useReplayStorage } from "../replay-viewer";

const STORAGE_KEY = "planar-nexus-replays";

const validReplay = {
  id: "replay-1",
  metadata: {
    format: "commander",
    playerNames: ["Alice", "Bob"],
    startingLife: 40,
    isCommander: true,
    gameStartDate: 1700000000000,
  },
  actions: [],
  currentPosition: 0,
  totalActions: 0,
  createdAt: 1700000000000,
  lastModifiedAt: 1700000000000,
};

describe("useReplayStorage — localStorage validation (#1429)", () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    localStorage.clear();
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  it("loads valid replays from localStorage", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([validReplay]));
    const { result } = renderHook(() => useReplayStorage());
    await waitFor(() => {
      expect(result.current.replays).toHaveLength(1);
    });
    expect(result.current.replays[0].id).toBe("replay-1");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls back to empty and does NOT throw on malformed JSON", async () => {
    localStorage.setItem(STORAGE_KEY, "}{ not json at all");
    const { result } = renderHook(() => useReplayStorage());
    await waitFor(() => {
      expect(result.current.replays).toEqual([]);
    });
    // Poisoned key cleared so the next mount starts clean.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("falls back to empty on a cross-version shape (missing required fields)", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: "x" }]));
    const { result } = renderHook(() => useReplayStorage());
    await waitFor(() => {
      expect(result.current.replays).toEqual([]);
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("neutralizes a prototype-pollution payload without crashing", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ __proto__: { polluted: "PWNED" } }),
    );
    const { result } = renderHook(() => useReplayStorage());
    await waitFor(() => {
      expect(result.current.replays).toEqual([]);
    });
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  it("survives a non-array root (e.g. an object smuggled in by an extension)", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ surprise: "not a replay list" }),
    );
    const { result } = renderHook(() => useReplayStorage());
    await waitFor(() => {
      expect(result.current.replays).toEqual([]);
    });
  });
});

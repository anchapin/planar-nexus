/**
 * @fileoverview Integration tests for the localStorage validation added to
 * deck-statistics in issue #1429.
 *
 * Covers the two read sites the issue flags:
 *  - the mount `useEffect` that hydrates `statistics` from localStorage, and
 *  - `importStats(json)`, which previously accepted ANY array of ANY shape and
 *    wrote it back to localStorage (silent data loss).
 *
 * recharts is stubbed because importing deck-statistics.tsx pulls it in at
 * module load; only the `usePersistedDeckStatistics` hook is exercised here.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { renderHook, act, waitFor } from "@testing-library/react";

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Bar: () => <div />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Pie: () => <div />,
  Cell: () => null,
  Legend: () => null,
}));

import { usePersistedDeckStatistics } from "../deck-statistics";

const STORAGE_KEY = "deck-statistics";

const validStats = [
  {
    deckId: "d1",
    deckName: "Mono Red",
    format: "standard",
    totalGames: 10,
    wins: 6,
    losses: 3,
    draws: 1,
    winRate: 60,
    averageGameDuration: 300,
    records: [
      {
        id: "r1",
        deckId: "d1",
        deckName: "Mono Red",
        format: "standard",
        result: "win" as const,
        date: 1700000000000,
        duration: 300,
      },
    ],
    colorDistribution: { R: 20 },
    manaCurve: { "1": 4 },
    lastPlayed: 1700000000000,
  },
];

describe("usePersistedDeckStatistics — localStorage validation (#1429)", () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    localStorage.clear();
  });

  it("loads valid statistics from localStorage", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validStats));
    const { result } = renderHook(() =>
      usePersistedDeckStatistics({ storageKey: STORAGE_KEY }),
    );
    await waitFor(() => {
      expect(result.current.statistics).toHaveLength(1);
    });
    expect(result.current.statistics[0].deckId).toBe("d1");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls back to empty and does NOT throw on malformed JSON", async () => {
    localStorage.setItem(STORAGE_KEY, "{this is not valid json");
    const { result } = renderHook(() =>
      usePersistedDeckStatistics({ storageKey: STORAGE_KEY }),
    );
    await waitFor(() => {
      expect(result.current.statistics).toEqual([]);
    });
    // Poisoned key is cleared so the next mount is clean.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("falls back to empty on cross-version shape (missing required fields)", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ deckId: "d1" }]));
    const { result } = renderHook(() =>
      usePersistedDeckStatistics({ storageKey: STORAGE_KEY }),
    );
    await waitFor(() => {
      expect(result.current.statistics).toEqual([]);
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("neutralizes a prototype-pollution payload without crashing or polluting", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ __proto__: { polluted: "PWNED" } }),
    );
    const { result } = renderHook(() =>
      usePersistedDeckStatistics({ storageKey: STORAGE_KEY }),
    );
    await waitFor(() => {
      expect(result.current.statistics).toEqual([]);
    });
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  describe("importStats", () => {
    it("accepts a valid array, updates state, and persists", () => {
      const { result } = renderHook(() =>
        usePersistedDeckStatistics({ storageKey: STORAGE_KEY }),
      );

      let ok = false;
      act(() => {
        ok = result.current.importStats(JSON.stringify(validStats));
      });
      expect(ok).toBe(true);
      expect(result.current.statistics).toHaveLength(1);
      expect(localStorage.getItem(STORAGE_KEY)).toBeTruthy();
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      expect(stored[0].deckId).toBe("d1");
    });

    it("rejects a non-array object and leaves localStorage untouched", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validStats));
      const before = localStorage.getItem(STORAGE_KEY);

      const { result } = renderHook(() =>
        usePersistedDeckStatistics({ storageKey: STORAGE_KEY }),
      );

      const ok = result.current.importStats(
        JSON.stringify({ not: "an array" }),
      );
      expect(ok).toBe(false);
      // The previously-valid stored value must be preserved (no overwrite).
      expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    });

    it("rejects malformed JSON and leaves localStorage untouched", () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(validStats));
      const before = localStorage.getItem(STORAGE_KEY);

      const { result } = renderHook(() =>
        usePersistedDeckStatistics({ storageKey: STORAGE_KEY }),
      );

      const ok = result.current.importStats("{not json");
      expect(ok).toBe(false);
      expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    });

    it("rejects an array containing a wrong-shape element and does not persist", () => {
      const { result } = renderHook(() =>
        usePersistedDeckStatistics({ storageKey: STORAGE_KEY }),
      );

      const ok = result.current.importStats(
        JSON.stringify([{ deckId: "d1", bogus: true }]),
      );
      expect(ok).toBe(false);
      // Nothing was written.
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});

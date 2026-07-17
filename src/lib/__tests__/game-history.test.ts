/**
 * @fileoverview Game history persistence tests (issue #1432).
 *
 * Pins the real save/restore contract of `src/lib/game-history.ts` across
 * three orthogonal axes required by the issue:
 *   1. Save/restore round-trips (sync localStorage + async IndexedDB paths)
 *   2. Version/schema handling — the loader performs NO validation, it casts
 *      `JSON.parse(stored) as GameRecord[]` (QA report §3.9). We pin that
 *      real behavior so a future safe-parse migration is a visible diff.
 *   3. Adversarial JSON — malformed, non-array, prototype-pollution-ish and
 *      oversized payloads. The sync loader catches and returns []; the
 *      un-validated cast is documented via the schema-mismatch tests.
 *
 * `fake-indexeddb` (loaded in jest.setup.js) backs the async path.
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
  GameRecord,
  GameResult,
  GameMode,
  getAllGameRecords,
  getAllGameRecordsAsync,
  saveGameRecord,
  getPlayerStats,
  getRecentGames,
  clearGameHistory,
  createGameRecord,
} from "../game-history";

const STORAGE_KEY = "planar-nexus-game-history";

/** Build a representative record with the optional fields populated. */
function makeRecord(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    id: `game-${Math.random().toString(36).slice(2)}`,
    date: 1_700_000_000_000,
    mode: "vs_ai",
    result: "win",
    playerDeck: "mono-red",
    opponentDeck: "mono-blue",
    difficulty: "hard",
    turns: 12,
    playerLifeAtEnd: 18,
    opponentLifeAtEnd: 0,
    mulligans: 1,
    notes: "kept a risky hand",
    mistakes: ["attacked into a blocker"],
    summary: "close game",
    ...overrides,
  };
}

/** Write a raw value to the localStorage slot the module reads from. */
function seedLocalStorage(raw: string): void {
  localStorage.setItem(STORAGE_KEY, raw);
}

describe("game-history", () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearGameHistory();
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    await clearGameHistory();
    localStorage.clear();
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------
  // Legacy smoke tests (preserved from the original suite so we never lose
  // the "module loads and returns arrays" floor).
  // ---------------------------------------------------------------------
  describe("smoke", () => {
    it("getAllGameRecords returns an empty array initially", () => {
      expect(getAllGameRecords()).toEqual([]);
    });

    it("getPlayerStats returns a stats object", () => {
      expect(getPlayerStats()).toBeDefined();
      expect(getPlayerStats().totalGames).toBe(0);
    });

    it("getRecentGames respects the limit parameter", () => {
      expect(getRecentGames(5).length).toBeLessThanOrEqual(5);
    });

    it("clearGameHistory does not throw", async () => {
      await expect(clearGameHistory()).resolves.not.toThrow();
    });
  });

  // ---------------------------------------------------------------------
  // 1. Save / restore round-trips
  // ---------------------------------------------------------------------
  describe("save/restore round-trip (sync localStorage path)", () => {
    it("round-trips a fully-populated record through getAllGameRecords", async () => {
      const record = makeRecord();
      await saveGameRecord(record);

      const restored = getAllGameRecords();
      expect(restored).toHaveLength(1);
      expect(restored[0]).toEqual(record);
    });

    it("prepends new records (most-recent-first ordering)", async () => {
      const first = makeRecord({ id: "g1", date: 100 });
      const second = makeRecord({ id: "g2", date: 200 });
      await saveGameRecord(first);
      await saveGameRecord(second);

      const restored = getAllGameRecords();
      expect(restored.map((r) => r.id)).toEqual(["g2", "g1"]);
    });

    it("caps the history at 1000 entries (unshift + splice(1000))", async () => {
      // Seed 1000 records in storage order [seed-0 .. seed-999].
      const records: GameRecord[] = Array.from({ length: 1000 }, (_, i) =>
        makeRecord({ id: `seed-${i}`, date: i }),
      );
      seedLocalStorage(JSON.stringify(records));

      // saveGameRecord does: read(1000) → unshift(newest) → 1001 → splice(1000)
      // which drops the LAST array element (seed-999), keeping the newest up front.
      const newest = makeRecord({ id: "newest", date: 9999 });
      await saveGameRecord(newest);

      const restored = getAllGameRecords();
      expect(restored).toHaveLength(1000);
      expect(restored[0].id).toBe("newest");
      // The tail entry (seed-999) is what gets spliced off.
      expect(restored.some((r) => r.id === "seed-999")).toBe(false);
      // seed-0 survives near the front (index 1).
      expect(restored[1].id).toBe("seed-0");
    });

    it("round-trips records carrying optional actions/mistakes/summary", async () => {
      const record = makeRecord({
        actions: [
          {
            type: "cast_spell",
            playerId: "p1",
            timestamp: 1,
            data: { cardId: "c1" },
          },
        ],
        mistakes: ["a", "b"],
        summary: "text",
      });
      await saveGameRecord(record);
      expect(getAllGameRecords()[0]).toEqual(record);
    });
  });

  describe("save/restore round-trip (async IndexedDB path)", () => {
    it("round-trips a record through getAllGameRecordsAsync via IndexedDB", async () => {
      const record = makeRecord({ id: "async-1" });
      await saveGameRecord(record);

      const restored = await getAllGameRecordsAsync();
      expect(restored).toHaveLength(1);
      expect(restored[0]).toEqual(record);
    });

    it("sorts the IndexedDB path by date descending", async () => {
      await saveGameRecord(makeRecord({ id: "old", date: 100 }));
      await saveGameRecord(makeRecord({ id: "new", date: 500 }));

      const restored = await getAllGameRecordsAsync();
      expect(restored.map((r) => r.id)).toEqual(["new", "old"]);
    });

    it("falls back to localStorage when IndexedDB is empty", async () => {
      const record = makeRecord({ id: "fallback" });
      seedLocalStorage(JSON.stringify([record]));

      const restored = await getAllGameRecordsAsync();
      expect(restored).toHaveLength(1);
      expect(restored[0].id).toBe("fallback");
    });
  });

  // ---------------------------------------------------------------------
  // 2. Version / schema mismatch
  //
  // The module has NO version field and NO schema validation: it does
  // `JSON.parse(stored) as GameRecord[]` and returns it verbatim (QA §3.9).
  // We pin that real behavior so a future safe-parse/ migrate change is a
  // deliberate, visible diff rather than a silent semantics shift.
  // ---------------------------------------------------------------------
  describe("version / schema handling (no validation — pins QA-3.9)", () => {
    it("returns a persisted object verbatim even when it is not a GameRecord[]", () => {
      // A "versioned" envelope that is clearly not the documented shape.
      seedLocalStorage(JSON.stringify({ version: 99, payload: "stale" }));

      const restored = getAllGameRecords();
      // Real behavior: silent cast, the whole object is returned as-is.
      expect(restored).toEqual({ version: 99, payload: "stale" } as never);
    });

    it("does not migrate or reject older-shape data — it passes it through", () => {
      const legacy = [{ who: "knows", not: "a-record" }];
      seedLocalStorage(JSON.stringify(legacy));
      expect(getAllGameRecords()).toEqual(legacy as never);
    });

    it("getPlayerStats throws when storage holds a non-iterable shape", () => {
      // Downstream consumer assumes an array; the loader does not guarantee
      // one. This pins the blast radius of the un-validated cast.
      seedLocalStorage(JSON.stringify({ not: "an array" }));
      expect(() => getPlayerStats()).toThrow();
    });
  });

  // ---------------------------------------------------------------------
  // 3. Adversarial / malformed JSON
  // ---------------------------------------------------------------------
  describe("adversarial JSON (sync loader fails safe)", () => {
    it("returns [] and logs when localStorage holds malformed JSON", () => {
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      seedLocalStorage("{ not valid json,,, ");

      expect(getAllGameRecords()).toEqual([]);
      expect(errSpy).toHaveBeenCalled();
    });

    it("returns [] when the slot is empty", () => {
      localStorage.removeItem(STORAGE_KEY);
      expect(getAllGameRecords()).toEqual([]);
    });

    it("treats JSON `null` as a non-array value (silent cast, not [])", () => {
      // `null` parses successfully so the try/catch does NOT fire; the loader
      // returns `null as GameRecord[]`. Pinning real behavior.
      seedLocalStorage("null");
      expect(getAllGameRecords()).toBeNull();
    });

    it("does not pollute Object.prototype via a __proto__ key", () => {
      // JSON.parse handles `__proto__` without mutating the global prototype
      // (it uses property definition semantics). The security-relevant
      // guarantee is that unrelated objects stay clean.
      seedLocalStorage(
        JSON.stringify({ __proto__: { polluted: "yes" }, id: "x" }),
      );

      getAllGameRecords(); // returns the parsed object; never throws here
      expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
      // A pristine object's prototype must be untouched.
      expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    });

    it("survives a large payload (no length-based crash)", () => {
      const big: GameRecord[] = Array.from({ length: 500 }, (_, i) =>
        makeRecord({ id: `big-${i}`, notes: "x".repeat(500) }),
      );
      seedLocalStorage(JSON.stringify(big));

      const restored = getAllGameRecords();
      expect(restored).toHaveLength(500);
    });
  });

  describe("adversarial JSON (async loader fails safe with fallback)", () => {
    it("returns [] and falls back when IndexedDB read throws", async () => {
      const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      // Force the async path to throw by poisoning localStorage fallback too,
      // then exercise the outer catch (which logs and retries localStorage).
      seedLocalStorage("not json");

      // IndexedDB is empty here so it will hit the localStorage fallback, which
      // throws (malformed JSON); the inner catch swallows and returns [].
      const restored = await getAllGameRecordsAsync();
      expect(restored).toEqual([]);
      expect(errSpy).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------
  // createGameRecord factory + getPlayerStats aggregation
  // ---------------------------------------------------------------------
  describe("createGameRecord", () => {
    it("produces a record with a generated id, date and all provided fields", () => {
      const before = Date.now();
      const record = createGameRecord({
        mode: "self_play",
        result: "draw",
        playerDeck: "d",
        turns: 7,
        playerLifeAtEnd: 5,
        mulligans: 0,
      });
      const after = Date.now();

      expect(record.id).toMatch(/^game-/);
      expect(record.mode).toBe("self_play");
      expect(record.result).toBe("draw");
      expect(record.date).toBeGreaterThanOrEqual(before);
      expect(record.date).toBeLessThanOrEqual(after);
    });
  });

  describe("getPlayerStats aggregation", () => {
    type ModeResult = {
      mode: GameMode;
      result: GameResult;
      difficulty?: string;
    };

    function seedStats(rows: ModeResult[]): void {
      const records: GameRecord[] = rows.map((r, i) =>
        makeRecord({
          id: `s-${i}`,
          mode: r.mode,
          result: r.result,
          difficulty: r.difficulty,
          turns: 10,
          playerLifeAtEnd: 20,
        }),
      );
      seedLocalStorage(JSON.stringify(records));
    }

    it("aggregates overall + per-mode + per-difficulty win rates", () => {
      seedStats([
        { mode: "vs_ai", result: "win", difficulty: "hard" },
        { mode: "vs_ai", result: "loss", difficulty: "hard" },
        { mode: "vs_ai", result: "win", difficulty: "easy" },
        { mode: "self_play", result: "draw" },
      ]);

      const stats = getPlayerStats();
      expect(stats.totalGames).toBe(4);
      expect(stats.wins).toBe(2);
      expect(stats.losses).toBe(1);
      expect(stats.draws).toBe(1);
      expect(stats.winRate).toBe(50);

      expect(stats.vsAiStats.games).toBe(3);
      expect(stats.vsAiStats.wins).toBe(2);
      expect(stats.vsAiStats.winRate).toBe(67);

      expect(stats.selfPlayStats.games).toBe(1);
      expect(stats.selfPlayStats.draws).toBe(1);

      expect(stats.difficultyStats.hard.games).toBe(2);
      expect(stats.difficultyStats.hard.winRate).toBe(50);
      expect(stats.difficultyStats.easy.winRate).toBe(100);

      // recentForm reflects storage order (most-recent-first).
      expect(stats.recentForm).toEqual(["win", "loss", "win", "draw"]);
    });

    it("returns zeroed stats for empty history", () => {
      const stats = getPlayerStats();
      expect(stats.totalGames).toBe(0);
      expect(stats.winRate).toBe(0);
      expect(stats.recentForm).toEqual([]);
    });

    it("ignores the playerId argument (currently unused)", () => {
      seedStats([{ mode: "vs_ai", result: "win", difficulty: "easy" }]);
      expect(getPlayerStats("anyone")).toEqual(getPlayerStats(undefined));
    });
  });
});

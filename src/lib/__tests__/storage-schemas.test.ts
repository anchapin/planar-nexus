/**
 * @fileoverview Unit tests for the localStorage runtime-validation layer
 * (issue #1429).
 *
 * These cover the zod schemas, the {@link stripDangerousKeys} prototype-
 * pollution sanitizer, and the {@link safeParseJson} helper in isolation. The
 * per-module integration tests (deck-statistics, replay-viewer, achievements,
 * use-local-storage) build on these primitives.
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
  stripDangerousKeys,
  safeParseJson,
  DeckStatisticsSchema,
  DeckStatisticsArraySchema,
  ReplaySchema,
  ReplayArraySchema,
  PlayerAchievementsSchema,
  PlayerStatsSchema,
} from "../storage-schemas";

describe("stripDangerousKeys", () => {
  afterEach(() => {
    // Belt-and-suspenders: ensure no test ever polluted the global prototype.
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  it("removes __proto__, constructor, and prototype keys from a flat object", () => {
    const input = JSON.parse(
      '{"a":1,"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"prototype":{"x":1}}',
    );
    const cleaned = stripDangerousKeys(input) as Record<string, unknown>;
    expect(Object.keys(cleaned).sort()).toEqual(["a"]);
    expect(cleaned.a).toBe(1);
  });

  it("recurses into nested objects and arrays", () => {
    const input = {
      ok: true,
      list: [{ good: 1, __proto__: { poisoned: 1 } }],
      nested: { keep: 2, constructor: { prototype: { hit: 1 } } },
    };
    const cleaned = stripDangerousKeys(input) as Record<string, unknown>;
    expect(cleaned.ok).toBe(true);
    expect((cleaned.list as unknown[])[0]).toEqual({ good: 1 });
    expect(cleaned.nested).toEqual({ keep: 2 });
  });

  it("returns primitives and null untouched", () => {
    expect(stripDangerousKeys(42)).toBe(42);
    expect(stripDangerousKeys("hi")).toBe("hi");
    expect(stripDangerousKeys(null)).toBe(null);
    expect(stripDangerousKeys(true)).toBe(true);
  });

  it("does NOT pollute Object.prototype even when fed a hostile payload", () => {
    JSON.parse(
      '{"__proto__":{"polluted":"PWNED"},"constructor":{"prototype":{"polluted2":"PWNED"}}}',
    );
    // Sanitizing a hostile payload must leave the global prototype clean.
    stripDangerousKeys(
      JSON.parse(
        '{"__proto__":{"polluted":"PWNED"},"constructor":{"prototype":{"polluted2":"PWNED"}}}',
      ),
    );
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
    expect(
      (Object.prototype as Record<string, unknown>).polluted2,
    ).toBeUndefined();
  });

  it("preserves Map / Set / Date / RegExp instances", () => {
    const m = new Map([["a", 1]]);
    const s = new Set([1, 2]);
    const d = new Date(0);
    const r = /foo/;
    const cleaned = stripDangerousKeys({
      m,
      s,
      d,
      r,
      __proto__: { x: 1 },
    }) as Record<string, unknown>;
    expect(cleaned.m).toBe(m);
    expect(cleaned.s).toBe(s);
    expect(cleaned.d).toBe(d);
    expect(cleaned.r).toBe(r);
  });
});

describe("DeckStatisticsSchema", () => {
  const validStat = {
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
        result: "win",
        date: 1700000000000,
        duration: 300,
      },
    ],
    colorDistribution: { R: 20 },
    manaCurve: { "1": 4, "2": 6 },
    lastPlayed: 1700000000000,
  };

  it("accepts a fully-valid entry", () => {
    expect(DeckStatisticsSchema.safeParse(validStat).success).toBe(true);
  });

  it("accepts when clearly-optional fields are absent", () => {
    const { lastPlayed, ...withoutOptional } = validStat;
    void lastPlayed;
    expect(DeckStatisticsSchema.safeParse(withoutOptional).success).toBe(true);
  });

  it("rejects an invalid result enum (cross-version drift)", () => {
    expect(
      DeckStatisticsSchema.safeParse({
        ...validStat,
        records: [{ ...validStat.records[0], result: "tie" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a missing required scalar", () => {
    const { winRate, ...missing } = validStat;
    void winRate;
    expect(DeckStatisticsSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects wrong scalar types", () => {
    expect(
      DeckStatisticsSchema.safeParse({ ...validStat, wins: "six" }).success,
    ).toBe(false);
  });

  it("array schema rejects a non-array root", () => {
    expect(DeckStatisticsArraySchema.safeParse({ not: "array" }).success).toBe(
      false,
    );
  });
});

describe("ReplaySchema", () => {
  const validReplay = {
    id: "replay-1",
    metadata: {
      format: "commander",
      playerNames: ["A", "B"],
      startingLife: 40,
      isCommander: true,
      gameStartDate: 1700000000000,
      winners: ["A"],
    },
    actions: [
      {
        sequenceNumber: 1,
        action: { type: "draw_card", playerId: "A" },
        resultingState: { players: {}, turn: { turnNumber: 1 } },
        description: "A drew a card",
        recordedAt: 1700000000000,
      },
    ],
    currentPosition: 0,
    totalActions: 1,
    createdAt: 1700000000000,
    lastModifiedAt: 1700000000000,
  };

  it("accepts a valid replay including opaque nested game state", () => {
    expect(ReplaySchema.safeParse(validReplay).success).toBe(true);
  });

  it("rejects a replay missing required metadata fields", () => {
    expect(
      ReplaySchema.safeParse({
        ...validReplay,
        metadata: { format: "commander" },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-string id", () => {
    expect(ReplaySchema.safeParse({ ...validReplay, id: 123 }).success).toBe(
      false,
    );
  });

  it("array schema accepts a list and rejects garbage", () => {
    expect(ReplayArraySchema.safeParse([validReplay]).success).toBe(true);
    expect(ReplayArraySchema.safeParse("nope").success).toBe(false);
  });
});

describe("PlayerAchievementsSchema", () => {
  const valid = {
    playerId: "p1",
    achievements: [
      { achievementId: "first_game", currentProgress: 1, unlocked: true },
      { achievementId: "games_10", currentProgress: 3, unlocked: false },
    ],
    totalPoints: 10,
    lastUpdated: 1700000000000,
  };

  it("accepts a valid record", () => {
    expect(PlayerAchievementsSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a non-array achievements list", () => {
    expect(
      PlayerAchievementsSchema.safeParse({ ...valid, achievements: "nope" })
        .success,
    ).toBe(false);
  });

  it("rejects a non-boolean unlocked flag", () => {
    expect(
      PlayerAchievementsSchema.safeParse({
        ...valid,
        achievements: [
          { achievementId: "x", currentProgress: 0, unlocked: "yes" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("PlayerStatsSchema", () => {
  it("accepts a string->number map", () => {
    expect(
      PlayerStatsSchema.safeParse({ games_played: 5, wins: 2 }).success,
    ).toBe(true);
  });

  it("rejects non-numeric values", () => {
    expect(PlayerStatsSchema.safeParse({ games_played: "five" }).success).toBe(
      false,
    );
  });

  it("rejects a non-object root", () => {
    expect(PlayerStatsSchema.safeParse([1, 2, 3]).success).toBe(false);
    expect(PlayerStatsSchema.safeParse("oops").success).toBe(false);
  });
});

describe("safeParseJson", () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    localStorage.clear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    localStorage.clear();
  });

  it("returns reason 'empty' for null/undefined/empty string", () => {
    const fromNull = safeParseJson(null, DeckStatisticsArraySchema);
    expect(fromNull).toEqual({ success: false, value: null, reason: "empty" });

    const fromUndef = safeParseJson(undefined, DeckStatisticsArraySchema);
    expect(fromUndef.success).toBe(false);
    if (!fromUndef.success) expect(fromUndef.reason).toBe("empty");

    const fromEmpty = safeParseJson("", DeckStatisticsArraySchema);
    expect(fromEmpty.success).toBe(false);
    if (!fromEmpty.success) expect(fromEmpty.reason).toBe("empty");
  });

  it("returns reason 'invalid-json' for unparseable strings and never throws", () => {
    const result = safeParseJson("{not json", DeckStatisticsArraySchema);
    expect(result).toEqual({
      success: false,
      value: null,
      reason: "invalid-json",
    });
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns reason 'schema-failed' for valid JSON of the wrong shape", () => {
    const result = safeParseJson('{"winRate":"x"}', DeckStatisticsArraySchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("schema-failed");
    }
    expect(warnSpy).toHaveBeenCalled();
  });

  it("returns the parsed value on success", () => {
    const payload = [
      {
        deckId: "d1",
        deckName: "N",
        format: "standard",
        totalGames: 1,
        wins: 1,
        losses: 0,
        draws: 0,
        winRate: 100,
        averageGameDuration: 10,
        records: [],
        colorDistribution: {},
        manaCurve: {},
      },
    ];
    const result = safeParseJson(
      JSON.stringify(payload),
      DeckStatisticsArraySchema,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].deckId).toBe("d1");
    }
  });

  it("clears the poisoned key on failure when removeOnFailure is set", () => {
    localStorage.setItem("deck-statistics", "{broken");
    safeParseJson(
      localStorage.getItem("deck-statistics"),
      DeckStatisticsArraySchema,
      {
        removeOnFailure: "deck-statistics",
      },
    );
    expect(localStorage.getItem("deck-statistics")).toBeNull();
  });

  it("does NOT clear the key when removeOnFailure is omitted", () => {
    localStorage.setItem("deck-statistics", "{broken");
    safeParseJson(
      localStorage.getItem("deck-statistics"),
      DeckStatisticsArraySchema,
    );
    expect(localStorage.getItem("deck-statistics")).toBe("{broken");
  });

  it("neutralizes a prototype-pollution payload and fails validation", () => {
    // A hostile payload whose ONLY own key is __proto__ → after stripping it
    // becomes {} → must fail the (non-empty) schema and never pollute.
    const hostile = JSON.parse('{"__proto__":{"polluted":"PWNED"}}');
    const result = safeParseJson(
      JSON.stringify(hostile),
      DeckStatisticsArraySchema,
    );
    expect(result.success).toBe(false);
    expect(
      (Object.prototype as Record<string, unknown>).polluted,
    ).toBeUndefined();
  });

  it("survives a hostile 1MB oversized payload without throwing", () => {
    const huge = "{".repeat(1_000_000);
    const result = safeParseJson(huge, DeckStatisticsArraySchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(["invalid-json", "schema-failed"]).toContain(result.reason);
    }
  });
});

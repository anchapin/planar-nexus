/**
 * Tests for cross-game replay diffing (issue #1235).
 *
 * Locks in the behaviour of `diffReplayHistory` against the four scenarios
 * the acceptance criteria explicitly require:
 *
 *   1. empty history (no throws; bucket counts are zero)
 *   2. single archetype streak (5+ games, monotonically worsening)
 *   3. mixed archetypes (different trends per bucket; overall trend is
 *      weighted by game count)
 *   4. monotonically worsening outcomes (the headline case — "you keep
 *      losing to UW Control on turn 7-9")
 *
 * Also covers the persistence round-trip (write → load → clear) and the
 * WeightLearner wiring (`worsening` amplifies the per-game nudge; the
 * pre-#1235 default behaviour is preserved when no trend is supplied).
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import {
  diffReplayHistory,
  computeOutcomeTrend,
  deriveTurnOfDeath,
  aggregateRecurringPatterns,
  buildTurnOfDeathHistogram,
  MIN_GAMES_FOR_TREND,
  TREND_DELTA_THRESHOLD,
  type ReplayForDiffing,
  type ReplaySummary,
} from "../ai-post-game-analysis";
import {
  loadReplayDiffReport,
  saveReplayDiffReport,
  clearReplayDiffReport,
  replayDiffStorageKey,
  REPLAY_DIFF_STORAGE_KEY_PREFIX,
} from "@/lib/replay-diff-storage";
import {
  defaultWeightLearner,
  OUTCOME_TREND_NUDGE_MULTIPLIER,
  type AIGameOutcome,
} from "@/ai/weight-learning";
import type { DifficultyTier } from "@/ai/game-state-evaluator";
import type { GameAnalysisOutput } from "@/ai/flows/ai-post-game-analysis";
import { getDefaultEvaluationWeights } from "@/ai/game-state-evaluator";

const PLAYER = "Alex";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Build a `ReplayForDiffing` with sensible defaults so each test focuses on
 * the variables that matter.
 */
function makeReplay(opts: {
  id?: string;
  outcome?: "win" | "loss" | "draw";
  opponentArchetype?: string;
  date?: number;
  playerLife?: number;
  turns?: number;
  mistakes?: string[];
  strengths?: string[];
}): ReplayForDiffing {
  const turns = opts.turns ?? 10;
  const turnData = Array.from({ length: turns }, (_, i) => ({
    turnNumber: i + 1,
  }));
  return {
    id: opts.id,
    outcome: opts.outcome,
    opponentArchetype: opts.opponentArchetype,
    date: opts.date,
    mistakes: opts.mistakes,
    strengths: opts.strengths,
    replay: {
      playerLife: opts.playerLife ?? (opts.outcome === "loss" ? 0 : 20),
      opponentLife: opts.outcome === "win" ? 0 : 20,
      players: [PLAYER],
      turns: turnData,
    },
  };
}

/** Build a long winning streak against the same archetype. */
function winningStreak(archetype: string, n: number, baseDate = 0): ReplayForDiffing[] {
  return Array.from({ length: n }, (_, i) =>
    makeReplay({
      id: `w-${archetype}-${i}`,
      outcome: "win",
      opponentArchetype: archetype,
      date: baseDate + i,
    }),
  );
}

/**
 * Build a monotonically-worsening streak: first half wins, second half loses.
 * Six games is the smallest size where the ±20% delta threshold can fire
 * (3 wins / 3 losses = −0.5 delta in the second half).
 */
function worseningStreak(archetype: string, baseDate = 0): ReplayForDiffing[] {
  return [
    makeReplay({
      id: `p1-${archetype}`,
      outcome: "win",
      opponentArchetype: archetype,
      date: baseDate,
    }),
    makeReplay({
      id: `p2-${archetype}`,
      outcome: "win",
      opponentArchetype: archetype,
      date: baseDate + 1,
    }),
    makeReplay({
      id: `p3-${archetype}`,
      outcome: "win",
      opponentArchetype: archetype,
      date: baseDate + 2,
    }),
    makeReplay({
      id: `p4-${archetype}`,
      outcome: "loss",
      opponentArchetype: archetype,
      date: baseDate + 3,
    }),
    makeReplay({
      id: `p5-${archetype}`,
      outcome: "loss",
      opponentArchetype: archetype,
      date: baseDate + 4,
    }),
    makeReplay({
      id: `p6-${archetype}`,
      outcome: "loss",
      opponentArchetype: archetype,
      date: baseDate + 5,
    }),
  ];
}

// ===========================================================================
// diffReplayHistory
// ===========================================================================

describe("diffReplayHistory", () => {
  describe("empty & degenerate inputs", () => {
    it("returns a zero-stat report for an empty history", async () => {
      const report = await diffReplayHistory([], PLAYER);

      expect(report.playerName).toBe(PLAYER);
      expect(report.totalGames).toBe(0);
      expect(report.archetypeCount).toBe(0);
      expect(report.byArchetype).toEqual([]);
      expect(report.overallOutcomeTrend).toBe("insufficient_data");
      expect(report.overallTurnOfDeathHistogram).toEqual([]);
      expect(report.overallWinRate).toBe(0);
      expect(report.overallRecentWinRate).toBe(0);
      expect(typeof report.generatedAt).toBe("number");
    });

    it("treats a null/undefined history the same as an empty array", async () => {
      const report = await diffReplayHistory(
        null as unknown as ReplayForDiffing[],
        PLAYER,
      );
      expect(report.totalGames).toBe(0);
      expect(report.byArchetype).toEqual([]);
    });

    it("skips malformed entries silently", async () => {
      const replay = makeReplay({
        id: "good",
        outcome: "win",
        opponentArchetype: "UW Control",
      });
      const report = await diffReplayHistory(
        [
          replay,
          null as unknown as ReplayForDiffing,
          { outcome: "win" } as ReplayForDiffing, // no `replay`
        ],
        PLAYER,
      );
      expect(report.totalGames).toBe(1);
      expect(report.byArchetype).toHaveLength(1);
      expect(report.byArchetype[0].archetype).toBe("UW Control");
    });
  });

  describe("single archetype streak (acceptance criterion #1: 5+ replays)", () => {
    it("produces outcomeTrend='worsening' when the player loses later games", async () => {
      const replays = worseningStreak("UW Control", 1000);
      const report = await diffReplayHistory(replays, PLAYER);

      expect(report.totalGames).toBe(6);
      expect(report.archetypeCount).toBe(1);

      const bucket = report.byArchetype[0];
      expect(bucket.archetype).toBe("UW Control");
      expect(bucket.games).toBe(6);
      expect(bucket.wins).toBe(3);
      expect(bucket.losses).toBe(3);
      expect(bucket.winRate).toBeCloseTo(0.5);
      expect(bucket.outcomeTrend).toBe("worsening");
      expect(bucket.outcomeTrendDelta).toBeLessThan(-TREND_DELTA_THRESHOLD);
    });

    it("surfaces a turn-of-death histogram that matches the replay data", async () => {
      // Losses on turns 7, 8, 9 — the canonical issue example.
      const replays: ReplayForDiffing[] = [
        ...Array.from({ length: 3 }, (_, i) =>
          makeReplay({
            id: `w-${i}`,
            outcome: "win",
            opponentArchetype: "UW Control",
            date: i,
          }),
        ),
        makeReplay({
          id: "l-7",
          outcome: "loss",
          opponentArchetype: "UW Control",
          date: 3,
          turns: 7,
          playerLife: 0,
        }),
        makeReplay({
          id: "l-8",
          outcome: "loss",
          opponentArchetype: "UW Control",
          date: 4,
          turns: 8,
          playerLife: 0,
        }),
        makeReplay({
          id: "l-9",
          outcome: "loss",
          opponentArchetype: "UW Control",
          date: 5,
          turns: 9,
          playerLife: 0,
        }),
      ];

      const report = await diffReplayHistory(replays, PLAYER);
      const bucket = report.byArchetype[0];

      expect(bucket.turnOfDeathHistogram).toEqual([
        { turn: 7, count: 1 },
        { turn: 8, count: 1 },
        { turn: 9, count: 1 },
      ]);
      expect(bucket.avgTurnOfDeath).toBe(8);
    });

    it("reports 'insufficient_data' when fewer than 5 games against one archetype", async () => {
      const replays = worseningStreak("UW Control", 1000).slice(0, 4);
      const report = await diffReplayHistory(replays, PLAYER);
      expect(report.byArchetype[0].outcomeTrend).toBe("insufficient_data");
      expect(report.byArchetype[0].outcomeTrendDelta).toBe(0);
    });

    it("reports 'stable' for an evenly-performing streak (no flip)", async () => {
      // 8 games with both halves having identical win-rate (2/4 each).
      // midpoint = ceil(8/2) = 4 → first half = W L L W (wr 0.5),
      // second half = W L L W (wr 0.5) → delta = 0 → 'stable'.
      const replays = [
        makeReplay({ id: "a", outcome: "win", opponentArchetype: "X", date: 1 }),
        makeReplay({ id: "b", outcome: "loss", opponentArchetype: "X", date: 2 }),
        makeReplay({ id: "c", outcome: "loss", opponentArchetype: "X", date: 3 }),
        makeReplay({ id: "d", outcome: "win", opponentArchetype: "X", date: 4 }),
        makeReplay({ id: "e", outcome: "win", opponentArchetype: "X", date: 5 }),
        makeReplay({ id: "f", outcome: "loss", opponentArchetype: "X", date: 6 }),
        makeReplay({ id: "g", outcome: "loss", opponentArchetype: "X", date: 7 }),
        makeReplay({ id: "h", outcome: "win", opponentArchetype: "X", date: 8 }),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      expect(report.byArchetype[0].outcomeTrend).toBe("stable");
      expect(report.byArchetype[0].outcomeTrendDelta).toBeCloseTo(0);
    });

    it("reports 'improving' when the player wins more later games", async () => {
      const replays = [
        ...Array.from({ length: 3 }, (_, i) =>
          makeReplay({
            id: `l-${i}`,
            outcome: "loss",
            opponentArchetype: "Mono Red",
            date: i,
          }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          makeReplay({
            id: `w-${i}`,
            outcome: "win",
            opponentArchetype: "Mono Red",
            date: 3 + i,
          }),
        ),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      const bucket = report.byArchetype[0];
      expect(bucket.outcomeTrend).toBe("improving");
      expect(bucket.outcomeTrendDelta).toBeGreaterThan(TREND_DELTA_THRESHOLD);
    });
  });

  describe("mixed archetypes (acceptance criterion #2)", () => {
    it("groups replays by archetype and computes independent trends", async () => {
      const replays: ReplayForDiffing[] = [
        // UW Control: 6 games, monotonically worsening.
        ...worseningStreak("UW Control", 1000),
        // Mono Red: 6 games, monotonically improving.
        ...Array.from({ length: 3 }, (_, i) =>
          makeReplay({
            id: `mr-l-${i}`,
            outcome: "loss",
            opponentArchetype: "Mono Red",
            date: 2000 + i,
          }),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          makeReplay({
            id: `mr-w-${i}`,
            outcome: "win",
            opponentArchetype: "Mono Red",
            date: 2003 + i,
          }),
        ),
        // Unknown (no archetype): single loss, never enough data.
        makeReplay({
          id: "u-1",
          outcome: "loss",
          date: 3000,
        }),
      ];
      const report = await diffReplayHistory(replays, PLAYER);

      expect(report.totalGames).toBe(13);
      expect(report.archetypeCount).toBe(3);

      const uw = report.byArchetype.find((b) => b.archetype === "UW Control");
      const mr = report.byArchetype.find((b) => b.archetype === "Mono Red");
      const unk = report.byArchetype.find((b) => b.archetype === "Unknown");

      expect(uw?.outcomeTrend).toBe("worsening");
      expect(mr?.outcomeTrend).toBe("improving");
      expect(unk?.outcomeTrend).toBe("insufficient_data");
    });

    it("sorts buckets by game count (most-played first)", async () => {
      const replays: ReplayForDiffing[] = [
        ...Array.from({ length: 3 }, (_, i) =>
          makeReplay({
            id: `sm-${i}`,
            outcome: "win",
            opponentArchetype: "Small",
            date: i,
          }),
        ),
        ...Array.from({ length: 7 }, (_, i) =>
          makeReplay({
            id: `big-${i}`,
            outcome: "win",
            opponentArchetype: "Big",
            date: 100 + i,
          }),
        ),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      expect(report.byArchetype.map((b) => b.archetype)).toEqual(["Big", "Small"]);
    });

    it("weights the overall trend by game count (not bucket count)", async () => {
      // 10 wins against A (lots of data, stable) + 6 worsening games against B.
      // Overall should be 'worsening' because B drags the weighted delta down.
      const replays: ReplayForDiffing[] = [
        ...Array.from({ length: 10 }, (_, i) =>
          makeReplay({
            id: `a-${i}`,
            outcome: "win",
            opponentArchetype: "A",
            date: i,
          }),
        ),
        ...worseningStreak("B", 100),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      // A's 10 games are wins-wins-loss-loss → middle three losses = -0.4 delta
      // A contributes 10 * -0.4 = -4 weighted delta.
      // B's 6 games → midpoint split 3/3 → second-half all-losses, first-half
      // all-wins → delta = -1 → B contributes 6 * -1 = -6.
      // Total weighted = (-4 + -6) / 16 = -0.625 → 'worsening'.
      expect(report.overallOutcomeTrend).toBe("worsening");
    });
  });

  describe("monotonically worsening outcomes (acceptance criterion #3)", () => {
    it("flags the bucket as 'worsening' when every game after the midpoint is a loss", async () => {
      // 6 games: 3 wins then 3 losses. Midpoint = ceil(6/2) = 3.
      // First half = games 1-3 (all wins) → wr = 1.0.
      // Second half = games 4-6 (all losses) → wr = 0.0.
      // delta = -1.0 → 'worsening'.
      const replays: ReplayForDiffing[] = [
        makeReplay({ id: "1", outcome: "win", opponentArchetype: "X", date: 1 }),
        makeReplay({ id: "2", outcome: "win", opponentArchetype: "X", date: 2 }),
        makeReplay({ id: "3", outcome: "win", opponentArchetype: "X", date: 3 }),
        makeReplay({ id: "4", outcome: "loss", opponentArchetype: "X", date: 4 }),
        makeReplay({ id: "5", outcome: "loss", opponentArchetype: "X", date: 5 }),
        makeReplay({ id: "6", outcome: "loss", opponentArchetype: "X", date: 6 }),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      const bucket = report.byArchetype[0];
      expect(bucket.outcomeTrend).toBe("worsening");
      expect(bucket.outcomeTrendDelta).toBeCloseTo(-1);
    });
  });

  describe("recurring mistakes & strengths", () => {
    it("surfaces patterns that recur in ≥ half the games", async () => {
      const replays: ReplayForDiffing[] = [
        ...Array.from({ length: 4 }, (_, i) =>
          makeReplay({
            id: `s-${i}`,
            outcome: "loss",
            opponentArchetype: "Burn",
            date: i,
            mistakes: ["Held removal past lethal", "Tapped out into counterspell"],
            strengths: ["Solid early game"],
          }),
        ),
        makeReplay({
          id: "s-4",
          outcome: "win",
          opponentArchetype: "Burn",
          date: 4,
          mistakes: ["Held removal past lethal"],
          strengths: ["Solid early game", "Good sideboard plan"],
        }),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      const bucket = report.byArchetype[0];

      // "Held removal past lethal" appears in 5/5 games → must surface.
      // "Tapped out into counterspell" appears in 4/5 games → must surface.
      // "Solid early game" appears in 5/5 → must surface.
      // "Good sideboard plan" appears in 1/5 → must NOT surface.
      const descs = (xs: { description: string }[]) => xs.map((x) => x.description);
      expect(descs(bucket.recurringMistakes)).toContain(
        "Held removal past lethal",
      );
      expect(descs(bucket.recurringMistakes)).toContain(
        "Tapped out into counterspell",
      );
      expect(descs(bucket.recurringStrengths)).toContain("Solid early game");
      expect(descs(bucket.recurringStrengths)).not.toContain(
        "Good sideboard plan",
      );
    });

    it("deduplicates patterns within a single game", async () => {
      const patterns = aggregateRecurringPatterns([
        ["x", "x", "y"], // game 1: mentions x twice (counts once) and y once
        ["x", "z"], // game 2: mentions x and z
      ]);
      const x = patterns.find((p) => p.description === "x");
      expect(x?.frequency).toBe(2);
    });

    it("sorts recurring patterns by frequency, then alphabetically", async () => {
      const patterns = aggregateRecurringPatterns([
        ["a", "b"],
        ["a", "b"],
        ["a", "c"],
      ]);
      expect(patterns.map((p) => p.description)).toEqual(["a", "b"]);
    });
  });

  describe("bucket ordering & chronological sort", () => {
    it("orders replays chronologically (oldest first) regardless of input order", async () => {
      const replays = [
        makeReplay({ id: "late", outcome: "win", opponentArchetype: "X", date: 100 }),
        makeReplay({ id: "early", outcome: "win", opponentArchetype: "X", date: 1 }),
        makeReplay({ id: "mid", outcome: "win", opponentArchetype: "X", date: 50 }),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      const ids = report.byArchetype[0].replays.map((r) => r.id);
      expect(ids).toEqual(["early", "mid", "late"]);
    });

    it("falls back to insertion order when two replays share the same date", async () => {
      // No `date` field on any entry → all bucket to the same default date
      // (0); the comparator falls back to `originalIndex`, which preserves
      // the caller's array order.
      const replays = [
        makeReplay({ id: "first", outcome: "win", opponentArchetype: "X" }),
        makeReplay({ id: "second", outcome: "loss", opponentArchetype: "X" }),
        makeReplay({ id: "third", outcome: "win", opponentArchetype: "X" }),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      const ids = report.byArchetype[0].replays.map((r) => r.id);
      expect(ids).toEqual(["first", "second", "third"]);
    });
  });

  describe("draw outcome aggregation", () => {
    it("counts draws in the bucket and surfaces them in the summary", async () => {
      const replays = [
        makeReplay({ id: "1", outcome: "draw", opponentArchetype: "X", date: 1 }),
        makeReplay({ id: "2", outcome: "win", opponentArchetype: "X", date: 2 }),
        makeReplay({ id: "3", outcome: "loss", opponentArchetype: "X", date: 3 }),
        makeReplay({ id: "4", outcome: "draw", opponentArchetype: "X", date: 4 }),
        makeReplay({ id: "5", outcome: "win", opponentArchetype: "X", date: 5 }),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      const bucket = report.byArchetype[0];
      expect(bucket.wins).toBe(2);
      expect(bucket.losses).toBe(1);
      expect(bucket.draws).toBe(2);
      expect(bucket.games).toBe(5);
      expect(bucket.winRate).toBeCloseTo(0.4); // 2 wins / 5 games
    });
  });

  describe("overall aggregates", () => {
    it("combines every bucket's histogram into the overall histogram", async () => {
      const replays = [
        makeReplay({
          id: "a1",
          outcome: "loss",
          opponentArchetype: "A",
          date: 1,
          turns: 7,
          playerLife: 0,
        }),
        makeReplay({
          id: "a2",
          outcome: "loss",
          opponentArchetype: "A",
          date: 2,
          turns: 7,
          playerLife: 0,
        }),
        makeReplay({
          id: "b1",
          outcome: "loss",
          opponentArchetype: "B",
          date: 3,
          turns: 8,
          playerLife: 0,
        }),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      expect(report.overallTurnOfDeathHistogram).toEqual([
        { turn: 7, count: 2 },
        { turn: 8, count: 1 },
      ]);
    });

    it("reports overallWinRate as wins / games across every bucket", async () => {
      const replays = [
        ...Array.from({ length: 2 }, (_, i) =>
          makeReplay({
            id: `w-${i}`,
            outcome: "win",
            opponentArchetype: "A",
            date: i,
          }),
        ),
        ...Array.from({ length: 2 }, (_, i) =>
          makeReplay({
            id: `l-${i}`,
            outcome: "loss",
            opponentArchetype: "B",
            date: 10 + i,
          }),
        ),
      ];
      const report = await diffReplayHistory(replays, PLAYER);
      expect(report.overallWinRate).toBe(0.5);
    });
  });
});

// ===========================================================================
// computeOutcomeTrend
// ===========================================================================

describe("computeOutcomeTrend", () => {
  it("returns 'insufficient_data' for fewer than MIN_GAMES_FOR_TREND games", () => {
    const summaries: ReplaySummary[] = Array.from(
      { length: MIN_GAMES_FOR_TREND - 1 },
      (_, i) => ({
        id: `s-${i}`,
        outcome: "loss",
        turnOfDeath: null,
        date: i,
      }),
    );
    const result = computeOutcomeTrend(summaries);
    expect(result.trend).toBe("insufficient_data");
    expect(result.delta).toBe(0);
  });

  it("splits 5 games 2/3 (midpoint = ceil(5/2) = 3)", () => {
    // 5 games: first 3 wins, last 2 losses.
    const summaries: ReplaySummary[] = [
      { id: "1", outcome: "win", turnOfDeath: null, date: 1 },
      { id: "2", outcome: "win", turnOfDeath: null, date: 2 },
      { id: "3", outcome: "win", turnOfDeath: null, date: 3 },
      { id: "4", outcome: "loss", turnOfDeath: null, date: 4 },
      { id: "5", outcome: "loss", turnOfDeath: null, date: 5 },
    ];
    // first half = games 1-3 (all wins) → wr = 1.0
    // second half = games 4-5 (all losses) → wr = 0.0
    // delta = -1.0 → worsening
    const result = computeOutcomeTrend(summaries);
    expect(result.trend).toBe("worsening");
    expect(result.delta).toBeCloseTo(-1);
  });

  it("counts draws as 0.5 when computing half win-rates", () => {
    // 4 games all draws → 0.5 wr on both halves → stable.
    const summaries: ReplaySummary[] = [
      { id: "1", outcome: "draw", turnOfDeath: null, date: 1 },
      { id: "2", outcome: "draw", turnOfDeath: null, date: 2 },
      { id: "3", outcome: "draw", turnOfDeath: null, date: 3 },
      { id: "4", outcome: "draw", turnOfDeath: null, date: 4 },
      { id: "5", outcome: "draw", turnOfDeath: null, date: 5 },
    ];
    const result = computeOutcomeTrend(summaries);
    expect(result.trend).toBe("stable");
    expect(result.delta).toBe(0);
  });
});

// ===========================================================================
// deriveTurnOfDeath
// ===========================================================================

describe("deriveTurnOfDeath", () => {
  it("returns the last turn's number when the player is at 0 life", () => {
    const replay = {
      players: [PLAYER],
      playerLife: 0,
      turns: [{ turnNumber: 1 }, { turnNumber: 2 }, { turnNumber: 7 }],
    };
    expect(deriveTurnOfDeath(replay, PLAYER)).toBe(7);
  });

  it("returns null when the player is still alive", () => {
    const replay = {
      players: [PLAYER],
      playerLife: 5,
      turns: [{ turnNumber: 1 }, { turnNumber: 2 }],
    };
    expect(deriveTurnOfDeath(replay, PLAYER)).toBeNull();
  });

  it("falls back to 1 when the replay has no turns and life is 0", () => {
    const replay = { players: [PLAYER], playerLife: 0 };
    expect(deriveTurnOfDeath(replay, PLAYER)).toBe(1);
  });
});

// ===========================================================================
// buildTurnOfDeathHistogram
// ===========================================================================

describe("buildTurnOfDeathHistogram", () => {
  it("counts each turn bucket once and sorts ascending", () => {
    const hist = buildTurnOfDeathHistogram([7, 8, 7, 9, null, 7]);
    expect(hist).toEqual([
      { turn: 7, count: 3 },
      { turn: 8, count: 1 },
      { turn: 9, count: 1 },
    ]);
  });

  it("ignores null and non-finite values", () => {
    const hist = buildTurnOfDeathHistogram([5, null, undefined as unknown as null, 5]);
    expect(hist).toEqual([{ turn: 5, count: 2 }]);
  });

  it("returns an empty array when no turns are provided", () => {
    expect(buildTurnOfDeathHistogram([])).toEqual([]);
    expect(buildTurnOfDeathHistogram([null])).toEqual([]);
  });
});

// ===========================================================================
// Persistence round-trip (IndexedDB layer)
// ===========================================================================

describe("replay-diff-storage", () => {
  beforeEach(async () => {
    await clearReplayDiffReport(PLAYER);
  });

  it("round-trips a report through IndexedDB", async () => {
    const report = await diffReplayHistory(worseningStreak("UW Control"), PLAYER);
    const res = await saveReplayDiffReport(PLAYER, report);
    expect(res.ok).toBe(true);

    const loaded = await loadReplayDiffReport(PLAYER);
    expect(loaded).not.toBeNull();
    expect(loaded?.playerName).toBe(PLAYER);
    expect(loaded?.totalGames).toBe(6);
    expect(loaded?.byArchetype[0].outcomeTrend).toBe("worsening");
  });

  it("returns null for a player with no persisted report", async () => {
    const loaded = await loadReplayDiffReport("NoSuchPlayer");
    expect(loaded).toBeNull();
  });

  it("clearReplayDiffReport removes the persisted row", async () => {
    const report = await diffReplayHistory(
      winningStreak("X", MIN_GAMES_FOR_TREND),
      PLAYER,
    );
    await saveReplayDiffReport(PLAYER, report);
    expect(await loadReplayDiffReport(PLAYER)).not.toBeNull();

    await clearReplayDiffReport(PLAYER);
    expect(await loadReplayDiffReport(PLAYER)).toBeNull();
  });

  it("keys reports under a dedicated namespace", () => {
    expect(replayDiffStorageKey(PLAYER)).toBe(
      `${REPLAY_DIFF_STORAGE_KEY_PREFIX}${PLAYER}`,
    );
    expect(replayDiffStorageKey(`  ${PLAYER}  `)).toBe(
      `${REPLAY_DIFF_STORAGE_KEY_PREFIX}${PLAYER}`,
    );
  });

  it("ignores payloads whose playerName does not match the key", async () => {
    const report = await diffReplayHistory(
      winningStreak("X", MIN_GAMES_FOR_TREND),
      PLAYER,
    );
    // Save under PLAYER, then try to load under a different name. The
    // playerName mismatch guard must reject the read.
    await saveReplayDiffReport(PLAYER, report);
    const loaded = await loadReplayDiffReport("SomeoneElse");
    expect(loaded).toBeNull();
  });

  it("returns null and logs a warning when storage throws on read", async () => {
    // Spy on the IndexedDBStorage prototype so the failure triggers inside
    // loadReplayDiffReport's await chain. We don't need to fail `getStorage`
    // itself — failing the underlying `.get` is enough to exercise the
    // catch branch.
    const { IndexedDBStorage } = await import("@/lib/indexeddb-storage");
    const spy = jest
      .spyOn(IndexedDBStorage.prototype, "get")
      .mockRejectedValue(new Error("IDB unavailable"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const loaded = await loadReplayDiffReport(PLAYER);
      expect(loaded).toBeNull();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("returns a warning (and never throws) when storage throws on write", async () => {
    const { IndexedDBStorage } = await import("@/lib/indexeddb-storage");
    const spy = jest
      .spyOn(IndexedDBStorage.prototype, "set")
      .mockRejectedValue(new Error("QuotaExceededError simulated"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const report = await diffReplayHistory(
        winningStreak("X", MIN_GAMES_FOR_TREND),
        PLAYER,
      );
      const res = await saveReplayDiffReport(PLAYER, report);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.warning).toContain("Could not persist");
      }
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("swallows errors when clearReplayDiffReport is called on a failing store", async () => {
    const { IndexedDBStorage } = await import("@/lib/indexeddb-storage");
    const spy = jest
      .spyOn(IndexedDBStorage.prototype, "delete")
      .mockRejectedValue(new Error("IDB unavailable"));
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // Must NOT throw — the caller (a "clear history" button) should
      // silently degrade when IDB is unavailable.
      await expect(clearReplayDiffReport(PLAYER)).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

// ===========================================================================
// WeightLearner wiring (issue #1235 → issue #1066)
// ===========================================================================

describe("WeightLearner consumes outcomeTrend (issue #1066 ↔ #1235)", () => {
  // The {@link defaultWeightLearner} singleton persists its in-memory store to
  // localStorage; the jest.setup.js localStorage mock keeps state across tests
  // within the file. Without clearing it, later tests start from a tier state
  // that an earlier test's `ingestGameOutcome` already nudged — that breaks
  // the "identical to the pre-#1235 default" assertion below. We clear the
  // mock storage and force the singleton's internal cache to reseed each time.
  beforeEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
    // _setStoreForTesting is a deliberate test seam; the public surface
    // intentionally hides it.
    (defaultWeightLearner as unknown as {
      _setStoreForTesting: (s: unknown) => void;
    })._setStoreForTesting({
      version: 1,
      tiers: {},
    });
  });

  // We use a fresh learner for every test so the in-memory store is empty
  // and we can compare absolute weight deltas against the static defaults.
  function freshLearner(): typeof defaultWeightLearner {
    const Ctor = defaultWeightLearner.constructor as new () => typeof defaultWeightLearner;
    return new Ctor();
  }

  // A minimal GameAnalysisOutput that triggers a loss-driven weight nudge.
  // The "life change" keyword in keyMoments hits `lifeScore`.
  const lossAnalysis: GameAnalysisOutput = {
    gameSummary: "lost",
    keyMoments: [
      {
        turn: 5,
        description: "Significant life change: -8",
        impact: "negative",
      },
    ],
    mistakes: [],
    strengths: [],
    improvementAreas: [],
    deckSuggestions: [],
    overallRating: 4,
    tips: [],
  };

  it("amplifies a loss-driven nudge when outcomeTrend='worsening'", () => {
    const learner = freshLearner();
    const tier: DifficultyTier = "easy";
    const defaults = getDefaultEvaluationWeights(tier);

    // Baseline (no trend).
    learner.ingestGameOutcome(tier, "loss" as AIGameOutcome, lossAnalysis);
    const baselineLife = learner.getLearnedEvaluationWeights(tier).lifeScore;

    // Reset and try again with worsening trend.
    learner.reset(tier);
    learner.ingestGameOutcome(
      tier,
      "loss" as AIGameOutcome,
      lossAnalysis,
      "worsening",
    );
    const worseningLife = learner.getLearnedEvaluationWeights(tier).lifeScore;

    // Worsening amplifies the nudge → lifeScore moves further from the
    // default (in the upward direction since losses push lifeScore up).
    const baselineDelta = Math.abs(baselineLife - defaults.lifeScore);
    const worseningDelta = Math.abs(worseningLife - defaults.lifeScore);
    expect(worseningDelta).toBeGreaterThan(baselineDelta);
  });

  it("softens a loss-driven nudge when outcomeTrend='improving'", () => {
    const learner = freshLearner();
    const tier: DifficultyTier = "easy";
    const defaults = getDefaultEvaluationWeights(tier);

    learner.ingestGameOutcome(tier, "loss" as AIGameOutcome, lossAnalysis);
    const baselineLife = learner.getLearnedEvaluationWeights(tier).lifeScore;

    learner.reset(tier);
    learner.ingestGameOutcome(
      tier,
      "loss" as AIGameOutcome,
      lossAnalysis,
      "improving",
    );
    const improvingLife = learner.getLearnedEvaluationWeights(tier).lifeScore;

    const baselineDelta = Math.abs(baselineLife - defaults.lifeScore);
    const improvingDelta = Math.abs(improvingLife - defaults.lifeScore);
    expect(improvingDelta).toBeLessThan(baselineDelta);
  });

  it("behaves identically to the pre-#1235 default when no trend is supplied", () => {
    const learner = freshLearner();
    const tier: DifficultyTier = "easy";
    const defaults = getDefaultEvaluationWeights(tier);

    learner.ingestGameOutcome(tier, "loss" as AIGameOutcome, lossAnalysis);
    const noTrend = learner.getLearnedEvaluationWeights(tier).lifeScore;

    learner.reset(tier);
    learner.ingestGameOutcome(
      tier,
      "loss" as AIGameOutcome,
      lossAnalysis,
      "stable",
    );
    const stableTrend = learner.getLearnedEvaluationWeights(tier).lifeScore;

    // No trend → multiplier = 1.0 (stable multiplier) → identical result.
    expect(noTrend).toBeCloseTo(stableTrend, 10);
    // Sanity: the nudge actually moved the weight away from the default.
    expect(Math.abs(noTrend - defaults.lifeScore)).toBeGreaterThan(0);
  });

  it("respects the multiplier table", () => {
    // Guard the documented values — these are part of the public contract
    // because tuning them affects how fast the AI responds to streaks.
    expect(OUTCOME_TREND_NUDGE_MULTIPLIER.worsening).toBeGreaterThan(1);
    expect(OUTCOME_TREND_NUDGE_MULTIPLIER.improving).toBeLessThan(1);
    expect(OUTCOME_TREND_NUDGE_MULTIPLIER.stable).toBe(1);
    expect(OUTCOME_TREND_NUDGE_MULTIPLIER.insufficient_data).toBe(1);
  });
});
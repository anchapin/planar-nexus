/**
 * Tests for the headless simulation harness itself (issue #1065).
 *
 * These cover the harness contract — deterministic, always terminates, emits
 * win-rate stats — NOT the difficulty tuning targets (those live in
 * difficulty-winrate.test.ts).
 */
import {
  simulateGame,
  simulateMatchup,
  buildDeck,
  mulberry32,
  type GameConfig,
} from "@/ai/simulation/game-simulator";

const baseGame: GameConfig = {
  playerDifficulty: "medium",
  opponentDifficulty: "medium",
  seed: 42,
};

describe("game-simulator — deck pool", () => {
  it.each(["aggro", "midrange", "control"] as const)(
    "builds a legal 60-card %s deck",
    (arch) => {
      const deck = buildDeck(arch);
      expect(deck).toHaveLength(60);
      const lands = deck.filter((c) =>
        (c.type_line || "").toLowerCase().includes("land"),
      );
      expect(lands.length).toBeGreaterThanOrEqual(24);
      const creatures = deck.filter((c) =>
        (c.type_line || "").toLowerCase().includes("creature"),
      );
      expect(creatures.length).toBeGreaterThan(0);
    },
  );
});

describe("game-simulator — determinism", () => {
  it("mulberry32 is reproducible", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("same seed → identical game outcome", () => {
    const g1 = simulateGame({ ...baseGame, seed: 7 });
    const g2 = simulateGame({ ...baseGame, seed: 7 });
    expect(g2.winner).toBe(g1.winner);
    expect(g2.turns).toBe(g1.turns);
    expect(g2.endReason).toBe(g1.endReason);
  });

  it("different seeds can differ", () => {
    // Not every seed must diverge, but across several seeds at least one
    // terminal turn-count should differ (sanity that the seed flows in).
    const turns = new Set<number>();
    for (let s = 1; s <= 8; s++) {
      turns.add(simulateGame({ ...baseGame, seed: s }).turns);
    }
    expect(turns.size).toBeGreaterThan(1);
  });
});

describe("game-simulator — termination", () => {
  it("always reaches a terminal state within the turn cap", () => {
    for (const tier of ["easy", "medium", "hard", "expert"] as const) {
      const outcome = simulateGame({
        ...baseGame,
        playerDifficulty: tier,
        opponentDifficulty: tier,
        maxTurns: 60,
      });
      expect(outcome.turns).toBeLessThanOrEqual(60);
      // Every game must have a decisive or drawn result recorded.
      expect(outcome.endReason).toMatch(/life|turn_cap/);
    }
  });

  it("respects a tiny turn cap (forces a draw)", () => {
    const outcome = simulateGame({ ...baseGame, maxTurns: 1 });
    expect(outcome.turns).toBe(1);
    expect(outcome.endReason).toBe("turn_cap");
    expect(outcome.winner).toBeNull();
  });

  it("does not loop forever on a stalling board (cap fires)", () => {
    // Two pure-control decks with high-toughness walls can stall; the cap must
    // still terminate the game.
    const outcome = simulateGame({
      ...baseGame,
      playerDeck: "control",
      opponentDeck: "control",
      maxTurns: 40,
    });
    expect(outcome.turns).toBeLessThanOrEqual(40);
  });
});

describe("game-simulator — aggregation", () => {
  it("simulateMatchup aggregates wins/losses/draws and winRate", () => {
    const result = simulateMatchup("medium", "medium", {
      games: 12,
      seed: 100,
    });
    expect(result.games).toBe(12);
    expect(result.wins + result.losses + result.draws).toBe(12);
    expect(result.winRate).toBeCloseTo(result.wins / 12, 5);
    expect(result.avgTurns).toBeGreaterThan(0);
    expect(result.avgTurns).toBeLessThan(80);
  });

  it("winRate is bounded in [0,1]", () => {
    const result = simulateMatchup("easy", "expert", {
      games: 10,
      seed: 5,
    });
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(1);
  });
});

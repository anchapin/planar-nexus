/**
 * @fileoverview Unit tests for the difficulty-scaled non-creature spell cast
 * gate (issue #1413).
 *
 * `cast-other-spells-gate.ts` is the gating layer `castOtherSpells` consults.
 * These tests pin the per-tier skip rates to the issue's acceptance bands and
 * exercise the Expert scoring pass + the `no_action` reasoning contract.
 *
 * Coverage targets (per issue):
 * - Easy fires ≥80% of castable spells.
 * - Medium fires ∈ [60%, 80%].
 * - Hard fires ∈ [35%, 60%].
 * - Expert fires ≤30% (random gate + scoring pass).
 * - Held spells surface as `no_action` with a reasoning containing both the
 *   spell name and the difficulty tier.
 */
import { describe, it, expect } from "@jest/globals";
import {
  BASE_SKIP_CHANCE,
  SKIP_CAP_EASY_MEDIUM,
  REMOVAL_WITH_TARGET_BONUS,
  INSTANT_PRECOMBAT_HOLD_PENALTY,
  FUTURE_TURN_LEVERAGE_WEIGHT,
  computeOtherSpellSkipChance,
  scoreNonCreatureSpell,
  selectOptimalExpertSpell,
  decideSpellGate,
  type NonCreatureSpellEntry,
  type SpellBoardContext,
} from "../cast-other-spells-gate";
import type { DifficultyLevel } from "../ai-difficulty";

/** randomnessFactor per DIFFICULTY_CONFIGS in ai-difficulty.ts. */
const RANDOMNESS: Record<DifficultyLevel, number> = {
  easy: 0.4,
  medium: 0.2,
  hard: 0.1,
  expert: 0.05,
};

/** Build a non-creature spell entry for the tests. */
function spell(
  id: string,
  name: string,
  cmc: number,
  opts: Partial<NonCreatureSpellEntry> = {},
): NonCreatureSpellEntry {
  return {
    cardId: id as unknown as NonCreatureSpellEntry["cardId"],
    name,
    cmc,
    typeLine: opts.typeLine ?? "instant",
    oracleText: opts.oracleText,
  };
}

/** A board where the opponent has a creature (so removal has a target). */
const BOARD_WITH_TARGET: SpellBoardContext = {
  availableMana: 5,
  opponentCreatureCount: 2,
  ownCreatureCount: 2,
  turnNumber: 6,
  phase: "precombat_main",
};

/** An empty opponent board — removal is a blunder here. */
const BOARD_EMPTY: SpellBoardContext = {
  availableMana: 5,
  opponentCreatureCount: 0,
  ownCreatureCount: 2,
  turnNumber: 6,
  phase: "precombat_main",
};

/**
 * Deterministic PRNG seeded by a number — returns a function that produces a
 * reproducible `Math.random`-compatible sequence. Used to pin skip/cast
 * outcomes per tier without test flakiness.
 *
 * Algorithm: a minimal LCG (numerical-recipes constants). Good enough for
 * tests that only need a uniform-[0, 1) sequence with replayable seeds.
 */
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    // LCG: advance state and return normalized.
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("computeOtherSpellSkipChance", () => {
  it("inverts castCreatures: Expert skips most, Easy skips least", () => {
    const easy = computeOtherSpellSkipChance({
      difficulty: "easy",
      randomnessFactor: RANDOMNESS.easy,
    });
    const medium = computeOtherSpellSkipChance({
      difficulty: "medium",
      randomnessFactor: RANDOMNESS.medium,
    });
    const hard = computeOtherSpellSkipChance({
      difficulty: "hard",
      randomnessFactor: RANDOMNESS.hard,
    });
    const expert = computeOtherSpellSkipChance({
      difficulty: "expert",
      randomnessFactor: RANDOMNESS.expert,
    });
    expect(easy).toBeLessThan(medium);
    expect(medium).toBeLessThan(hard);
    expect(hard).toBeLessThan(expert);
  });

  it("Easy and Medium are capped at SKIP_CAP_EASY_MEDIUM", () => {
    // Push riskMultiplier very low (ahead AI) — would push skip above the cap.
    const easy = computeOtherSpellSkipChance({
      difficulty: "easy",
      randomnessFactor: RANDOMNESS.easy,
      riskMultiplier: 0.8,
    });
    const medium = computeOtherSpellSkipChance({
      difficulty: "medium",
      randomnessFactor: RANDOMNESS.medium,
      riskMultiplier: 0.8,
    });
    expect(easy).toBeLessThanOrEqual(SKIP_CAP_EASY_MEDIUM);
    expect(medium).toBeLessThanOrEqual(SKIP_CAP_EASY_MEDIUM);
  });

  it("Hard and Expert are NOT capped (can reach 1.0 when ahead)", () => {
    const expert = computeOtherSpellSkipChance({
      difficulty: "expert",
      randomnessFactor: RANDOMNESS.expert,
      riskMultiplier: 0.8, // ahead
    });
    expect(expert).toBeGreaterThan(SKIP_CAP_EASY_MEDIUM);
    expect(expert).toBeLessThanOrEqual(1);
  });

  it("behind AI (riskMultiplier > 1) commits more → smaller skip", () => {
    const ahead = computeOtherSpellSkipChance({
      difficulty: "hard",
      randomnessFactor: RANDOMNESS.hard,
      riskMultiplier: 0.8,
    });
    const behind = computeOtherSpellSkipChance({
      difficulty: "hard",
      randomnessFactor: RANDOMNESS.hard,
      riskMultiplier: 1.2,
    });
    expect(behind).toBeLessThan(ahead);
  });

  it("null riskMultiplier preserves the non-adaptive base behavior", () => {
    const s = computeOtherSpellSkipChance({
      difficulty: "medium",
      randomnessFactor: RANDOMNESS.medium,
      riskMultiplier: null,
    });
    // base 0.3 * modulation(1.1) = ~0.33, well within (0, 0.5).
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(0.5);
  });

  it("matches the exported BASE_SKIP_CHANCE ordering", () => {
    expect(BASE_SKIP_CHANCE.easy).toBeLessThan(BASE_SKIP_CHANCE.medium);
    expect(BASE_SKIP_CHANCE.medium).toBeLessThan(BASE_SKIP_CHANCE.hard);
    expect(BASE_SKIP_CHANCE.hard).toBeLessThan(BASE_SKIP_CHANCE.expert);
  });
});

describe("scoreNonCreatureSpell", () => {
  it("scores affordable removal with a live target highest", () => {
    const murder = spell("m1", "Murder", 3, {
      oracleText: "Destroy target creature.",
    });
    const score = scoreNonCreatureSpell({
      spell: murder,
      board: BOARD_WITH_TARGET,
    });
    // 0.7 base + 0.3 bonus + leverage (mana headroom 2 → 1.0 * 0.2 = 0.2),
    // minus no penalty (sorcery) → clamped to 1.0.
    expect(score).toBeCloseTo(1, 1);
  });

  it("scores removal on an empty board as a near-blunder", () => {
    const murder = spell("m2", "Murder", 3, {
      oracleText: "Destroy target creature.",
      typeLine: "instant",
    });
    const score = scoreNonCreatureSpell({
      spell: murder,
      board: BOARD_EMPTY,
    });
    // base 0.1 + leverage 0.2 - hold penalty 0.2 = 0.1
    expect(score).toBeLessThan(0.2);
  });

  it("scores unaffordable spells at 0 (held, never the optimal pick)", () => {
    const pricey = spell("p1", "Time Warp", 5, {
      oracleText: "Take an extra turn after this one.",
      typeLine: "sorcery",
    });
    const score = scoreNonCreatureSpell({
      spell: pricey,
      board: { ...BOARD_WITH_TARGET, availableMana: 2 },
    });
    expect(score).toBe(0);
  });

  it("applies the instant pre-combat hold penalty", () => {
    const buff = spell("b1", "Giant Growth", 1, {
      oracleText: "Target creature gets +3/+3 until end of turn.",
    });
    const preCombat = scoreNonCreatureSpell({
      spell: buff,
      board: BOARD_WITH_TARGET,
    });
    const postCombat = scoreNonCreatureSpell({
      spell: buff,
      board: { ...BOARD_WITH_TARGET, phase: "postcombat_main" },
    });
    expect(postCombat - preCombat).toBeGreaterThanOrEqual(
      INSTANT_PRECOMBAT_HOLD_PENALTY - 0.01,
    );
  });

  it("draw spells score higher when the AI is behind on board", () => {
    const divination = spell("d1", "Divination", 3, {
      oracleText: "Draw two cards.",
      typeLine: "sorcery",
    });
    const behind = scoreNonCreatureSpell({
      spell: divination,
      board: { ...BOARD_WITH_TARGET, ownCreatureCount: 0 },
    });
    const ahead = scoreNonCreatureSpell({
      spell: divination,
      board: { ...BOARD_WITH_TARGET, ownCreatureCount: 5 },
    });
    expect(behind).toBeGreaterThan(ahead);
  });

  it("buff spells score ~0.1 with no friendly creature to target", () => {
    const buff = spell("b2", "Giant Growth", 1, {
      oracleText: "Target creature gets +3/+3 until end of turn.",
      typeLine: "instant",
    });
    const score = scoreNonCreatureSpell({
      spell: buff,
      board: { ...BOARD_EMPTY, ownCreatureCount: 0, phase: "postcombat_main" },
    });
    // base 0.1 (no target) + leverage (headroom 4 → 1.0*0.2=0.2) = 0.3
    expect(score).toBeGreaterThan(0.2);
    expect(score).toBeLessThan(0.4);
  });

  it("future-turn leverage weight matches export", () => {
    expect(FUTURE_TURN_LEVERAGE_WEIGHT).toBe(0.2);
    expect(REMOVAL_WITH_TARGET_BONUS).toBe(0.3);
    expect(INSTANT_PRECOMBAT_HOLD_PENALTY).toBe(0.2);
  });
});

describe("selectOptimalExpertSpell", () => {
  it("returns the single highest-scoring spell as optimal", () => {
    const murder = spell("m", "Murder", 3, {
      oracleText: "Destroy target creature.",
    });
    const divination = spell("d", "Divination", 3, {
      oracleText: "Draw two cards.",
      typeLine: "sorcery",
    });
    const selection = selectOptimalExpertSpell(
      [divination, murder],
      BOARD_WITH_TARGET,
    );
    expect(selection.optimal?.name).toBe("Murder");
    expect(selection.ties).toHaveLength(0);
  });

  it("returns ties when two spells score equally", () => {
    // Two identical removal spells on a board with a target.
    const a = spell("a", "Murder", 3, {
      oracleText: "Destroy target creature.",
    });
    const b = spell("b", "Doom Blade", 3, {
      oracleText: "Destroy target creature.",
    });
    const selection = selectOptimalExpertSpell([a, b], BOARD_WITH_TARGET);
    expect(selection.optimal).toBeDefined();
    expect(selection.ties).toHaveLength(1);
  });

  it("returns optimal=null when no spell is affordable", () => {
    const pricey = spell("p", "Time Warp", 8, {
      oracleText: "Take an extra turn.",
      typeLine: "sorcery",
    });
    const selection = selectOptimalExpertSpell([pricey], {
      ...BOARD_WITH_TARGET,
      availableMana: 2,
    });
    expect(selection.optimal).toBeNull();
    expect(selection.ties).toHaveLength(0);
  });

  it("returns empty selection for an empty hand", () => {
    const selection = selectOptimalExpertSpell([], BOARD_WITH_TARGET);
    expect(selection.optimal).toBeNull();
    expect(selection.ties).toHaveLength(0);
  });
});

describe("decideSpellGate — no_action reasoning contract", () => {
  it("returns a skip reasoning containing spell name + difficulty", () => {
    const murder = spell("m", "Murder", 3, {
      oracleText: "Destroy target creature.",
    });
    // Force a skip: skipChance 1.0 guarantees the random branch fires.
    const decision = decideSpellGate({
      spell: murder,
      difficulty: "hard",
      skipChance: 1.0,
      rng: () => 0.5,
      board: BOARD_WITH_TARGET,
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reasoning).toContain("Murder");
      expect(decision.reasoning).toContain("hard");
      // acceptance: reasoning must contain difficulty=<tier> OR the tier name.
      expect(decision.reasoning.toLowerCase()).toMatch(/hard/);
    }
  });

  it("Expert force-skips non-optimal spells regardless of rng", () => {
    const murder = spell("m", "Murder", 3, {
      oracleText: "Destroy target creature.",
    });
    // Even rng=0 (never random-skip) → Expert holds non-optimal spells.
    const decision = decideSpellGate({
      spell: murder,
      difficulty: "expert",
      skipChance: 0,
      rng: () => 0.99,
      isOptimalCast: false,
      board: BOARD_WITH_TARGET,
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      expect(decision.reasoning).toContain("Murder");
      expect(decision.reasoning).toContain("expert");
    }
  });

  it("Expert casts the optimal spell unconditionally (scoring IS the gate)", () => {
    const murder = spell("m", "Murder", 3, {
      oracleText: "Destroy target creature.",
    });
    const decision = decideSpellGate({
      spell: murder,
      difficulty: "expert",
      skipChance: 0.5,
      rng: () => 0.1, // would random-skip on other tiers; ignored for Expert
      isOptimalCast: true,
      board: BOARD_WITH_TARGET,
    });
    expect(decision.kind).toBe("cast");
  });

  it("returns cast when rng roll is under the skip chance threshold", () => {
    const divination = spell("d", "Divination", 3, {
      oracleText: "Draw two cards.",
      typeLine: "sorcery",
    });
    const decision = decideSpellGate({
      spell: divination,
      difficulty: "medium",
      skipChance: 0.3,
      rng: () => 0.5, // 0.5 >= 0.3 → not skipped
      board: BOARD_WITH_TARGET,
    });
    expect(decision.kind).toBe("cast");
  });

  it("produces difficulty-hold reasoning for high-skip tiers", () => {
    const murder = spell("m", "Murder", 3, {
      oracleText: "Destroy target creature.",
    });
    const decision = decideSpellGate({
      spell: murder,
      difficulty: "expert",
      skipChance: 0.85,
      rng: () => 0.1, // 0.1 < 0.85 → random skip fires
      board: BOARD_WITH_TARGET,
    });
    expect(decision.kind).toBe("skip");
    if (decision.kind === "skip") {
      // Expert skipChance >= 0.7 → "difficulty-hold" cause.
      expect(decision.reasoning).toContain("expert");
      expect(decision.reasoning).toContain("Murder");
    }
  });
});

/**
 * Per-tier fire-rate measurements against the issue's 50%-suboptimal fixture.
 *
 * We construct a hand of 10 castable spells: 5 strong (targeted removal +
 * on-curve draw) and 5 weak (off-curve / buff-with-no-target). Each tier runs
 * `decideSpellGate` over 1000 deterministic rng draws; we assert the fire rate
 * lands inside the issue's acceptance band.
 *
 * For Expert we additionally run the scoring pass up front and mark the single
 * optimal spell as `isOptimalCast=true` — mirroring the live wiring.
 */
describe("per-tier fire rates (issue #1413 acceptance bands)", () => {
  // 10 spells, 5 strong + 5 weak. All affordable at availableMana=5.
  const STRONG: NonCreatureSpellEntry[] = [
    spell("s1", "Murder", 3, { oracleText: "Destroy target creature." }),
    spell("s2", "Doom Blade", 2, { oracleText: "Destroy target creature." }),
    spell("s3", "Divination", 3, {
      oracleText: "Draw two cards.",
      typeLine: "sorcery",
    }),
    spell("s4", "Lightning Bolt", 1, {
      oracleText: "Lightning Bolt deals 3 damage to any target.",
    }),
    spell("s5", "Cancel", 3, { oracleText: "Counter target spell." }),
  ];
  const WEAK: NonCreatureSpellEntry[] = [
    // Buff spells with no friendly creature to target on BOARD_EMPTY-ish.
    spell("w1", "Giant Growth", 1, {
      oracleText: "Target creature gets +3/+3.",
    }),
    spell("w2", "Titanic Growth", 2, {
      oracleText: "Target creature gets +4/+4.",
    }),
    // Draw spells (fine but flat score) on a board with own creatures.
    spell("w3", "Opt", 1, { oracleText: "Scry 1, then draw a card." }),
    spell("w4", "Serum Visions", 1, {
      oracleText: "Draw a card, then scry 2.",
    }),
    spell("w5", "Preordain", 1, {
      oracleText: "Scry 2, then draw a card.",
    }),
  ];
  const HAND = [...STRONG, ...WEAK];

  /** Board where the strong spells (removal/draw) outscore the weak ones. */
  const BOARD: SpellBoardContext = {
    availableMana: 5,
    opponentCreatureCount: 2,
    ownCreatureCount: 2,
    turnNumber: 6,
    // postcombat_main so instants do not pay the hold penalty (isolates the
    // random gate's effect on fire rate).
    phase: "postcombat_main",
  };

  /**
   * Run the gate over the hand N times with a deterministic rng, counting
   * how many spells fire. Returns the fire rate (fires / (N * hand.length)).
   *
   * For Expert, the single optimal spell is pre-selected per iteration and
   * the rest force-skipped, matching the live wiring.
   */
  function measureFireRate(
    difficulty: DifficultyLevel,
    iterations: number,
  ): { fires: number; total: number; rate: number } {
    const skipChance = computeOtherSpellSkipChance({
      difficulty,
      randomnessFactor: RANDOMNESS[difficulty],
    });
    let fires = 0;
    const total = iterations * HAND.length;
    for (let i = 0; i < iterations; i++) {
      const rng = seededRng(i + 1);
      // Expert: pick the single optimal spell up front.
      const optimal = selectOptimalExpertSpell(HAND, BOARD);
      const optimalKey = optimal.optimal
        ? String(optimal.optimal.cardId)
        : null;
      for (const s of HAND) {
        const isOptimalCast =
          difficulty === "expert" ? String(s.cardId) === optimalKey : undefined;
        const decision = decideSpellGate({
          spell: s,
          difficulty,
          skipChance,
          rng,
          isOptimalCast,
          board: BOARD,
        });
        if (decision.kind === "cast") fires++;
      }
    }
    return { fires, total, rate: fires / total };
  }

  it("Easy fires ≥80% of castable spells", () => {
    const { rate } = measureFireRate("easy", 200);
    expect(rate).toBeGreaterThanOrEqual(0.8);
  });

  it("Medium fires ∈ [60%, 80%]", () => {
    const { rate } = measureFireRate("medium", 200);
    expect(rate).toBeGreaterThanOrEqual(0.6);
    expect(rate).toBeLessThanOrEqual(0.8);
  });

  it("Hard fires ∈ [35%, 60%]", () => {
    const { rate } = measureFireRate("hard", 200);
    expect(rate).toBeGreaterThanOrEqual(0.35);
    expect(rate).toBeLessThanOrEqual(0.6);
  });

  it("Expert fires ≤30% (scoring + random gate)", () => {
    const { rate } = measureFireRate("expert", 200);
    expect(rate).toBeLessThanOrEqual(0.3);
  });
});

describe("regression — sibling issues and existing behavior", () => {
  it("does not regress the castCreatures skip direction (Easy>Expert there)", () => {
    // This gate inverts castCreatures. Sanity-check the inversion is encoded:
    // castCreatures skip = rf*0.3 → Easy 0.12, Expert 0.015 (Easy > Expert).
    // Our gate: Easy < Expert. Confirms the two gates are intentionally
    // different and we did not accidentally mirror castCreatures verbatim.
    const easy = computeOtherSpellSkipChance({
      difficulty: "easy",
      randomnessFactor: 0.4,
    });
    const expert = computeOtherSpellSkipChance({
      difficulty: "expert",
      randomnessFactor: 0.05,
    });
    // Inverted vs castCreatures: Easy skips LESS than Expert here.
    expect(easy).toBeLessThan(expert);
  });

  it("no_action reasoning is stable and human-readable", () => {
    const murder = spell("m", "Murder", 3, {
      oracleText: "Destroy target creature.",
    });
    const d1 = decideSpellGate({
      spell: murder,
      difficulty: "expert",
      skipChance: 1.0,
      rng: () => 0.1,
      board: BOARD_WITH_TARGET,
    });
    const d2 = decideSpellGate({
      spell: murder,
      difficulty: "expert",
      skipChance: 1.0,
      rng: () => 0.1,
      board: BOARD_WITH_TARGET,
    });
    expect(d1).toEqual(d2);
    if (d1.kind === "skip" && d2.kind === "skip") {
      // Both calls produce the same human-readable string.
      expect(typeof d1.reasoning).toBe("string");
      expect(d1.reasoning.length).toBeGreaterThan(10);
    }
  });

  it("handles empty hand gracefully (no spells to gate)", () => {
    const selection = selectOptimalExpertSpell([], BOARD_WITH_TARGET);
    expect(selection.optimal).toBeNull();
  });
});

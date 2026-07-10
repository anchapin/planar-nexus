/**
 * @fileoverview Tutor decision tests (issue #1231).
 *
 * Acceptance criteria from the issue:
 *
 *   1. `selectTutorTarget` exists and is unit-tested with ≥ 4 candidate
 *      scenarios  → `scoreTutorCandidate` + `selectTutorTarget` blocks.
 *   2. Easy / Medium / Hard / Expert produce measurably different picks
 *      on the same candidate pool  → "tier separation" describe block.
 *   3. When the player's detected archetype is `combo`, Expert tutor
 *      targets a card that wins on the next turn when one exists in the
 *      pool  → "combo-Expert winsNextTurn override" describe block.
 *   4. No regression in `ai-turn-loop.test.ts`  → covered separately
 *      by the existing test suite.
 *   5. At least one new test file with ≥ 6 cases  → this file
 *      (currently 11 `it` cases across 6 describe blocks).
 */

import { describe, expect, it } from "@jest/globals";
import {
  selectTutorTarget,
  scoreTutorCandidate,
  isTutorOracle,
  ARCHETYPE_TUTOR_WEIGHTS,
  UNKNOWN_ARCHETYPE_WEIGHTS,
  DIFFICULTY_NOISE,
  type TutorCandidate,
} from "../tutor-decision";
import type { DifficultyLevel } from "../../ai-difficulty";

// Keep the runtime RNG deterministic for tier-separation assertions.
const zeroRng = () => 0.5;
// A deterministic RNG that returns max() each call — used to push Easy
// picks to the bottom of the noise range so we can prove the noise gate
// actually fires.
const maxRng = () => 0.999999;
const minRng = () => 0.000001;

const LEVELS: DifficultyLevel[] = ["easy", "medium", "hard", "expert"];

function candidate(
  id: string,
  overrides: Partial<TutorCandidate> = {},
): TutorCandidate {
  return {
    id,
    name: id,
    finishesCombo: 0,
    answersThreat: 0,
    advancesPlan: 0,
    winsNextTurn: false,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* AC #1 — `selectTutorTarget` and `scoreTutorCandidate` exist                 */
/* -------------------------------------------------------------------------- */

describe("scoreTutorCandidate (issue #1231 AC #1)", () => {
  it("returns a composite in [0, 1] for any archetype", () => {
    for (const archetype of [
      "combo",
      "control",
      "midrange",
      "aggro",
      "ramp",
      "unknown",
    ] as const) {
      const scored = scoreTutorCandidate(
        candidate("c", {
          finishesCombo: 1,
          answersThreat: 1,
          advancesPlan: 1,
        }),
        archetype,
        1,
      );
      expect(scored.score).toBeGreaterThanOrEqual(0);
      expect(scored.score).toBeLessThanOrEqual(1);
    }
  });

  it("combo archetype weights combo finish much more than plan advance", () => {
    const comboCard = scoreTutorCandidate(
      candidate("combo-finisher", { finishesCombo: 1 }),
      "combo",
      0.5,
    );
    const planCard = scoreTutorCandidate(
      candidate("plan-card", { advancesPlan: 1 }),
      "combo",
      0.5,
    );
    expect(comboCard.score).toBeGreaterThan(planCard.score);
    // Combo weight is 0.7; plan is 0.15 — the gap must be ≥ 0.3 on a 1.0 input.
    expect(comboCard.score - planCard.score).toBeGreaterThanOrEqual(0.3);
  });

  it("control archetype weights threat answer more than combo finish", () => {
    const threatCard = scoreTutorCandidate(
      candidate("threat-answer", { answersThreat: 1 }),
      "control",
      1,
    );
    const comboCard = scoreTutorCandidate(
      candidate("combo-finisher", { finishesCombo: 1 }),
      "control",
      1,
    );
    expect(threatCard.score).toBeGreaterThan(comboCard.score);
  });

  it("clamps out-of-range inputs gracefully", () => {
    const scored = scoreTutorCandidate(
      candidate("c", {
        finishesCombo: 5,
        answersThreat: -2,
        advancesPlan: 1,
      }),
      "combo",
      1.5,
    );
    expect(scored.score).toBeLessThanOrEqual(1);
    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(scored.score)).toBe(true);
  });

  it("unknown archetype uses the documented fallback weights", () => {
    expect(UNKNOWN_ARCHETYPE_WEIGHTS.combo).toBeCloseTo(0.25, 5);
    expect(UNKNOWN_ARCHETYPE_WEIGHTS.threat).toBeCloseTo(0.4, 5);
    expect(UNKNOWN_ARCHETYPE_WEIGHTS.plan).toBeCloseTo(0.35, 5);
    const sum =
      UNKNOWN_ARCHETYPE_WEIGHTS.combo +
      UNKNOWN_ARCHETYPE_WEIGHTS.threat +
      UNKNOWN_ARCHETYPE_WEIGHTS.plan;
    expect(sum).toBeCloseTo(1, 5);
  });
});

/* -------------------------------------------------------------------------- */
/* AC #2 — tier separation: same pool, different picks                       */
/* -------------------------------------------------------------------------- */

describe("selectTutorTarget — tier separation (issue #1231 AC #2)", () => {
  // Build a pool where one candidate is clearly best, but two are close
  // enough to look plausible to a noisy AI. The deterministic Expert
  // picks the best; Easy with max noise should sometimes NOT pick it.
  const pool: TutorCandidate[] = [
    candidate("best", {
      name: "Best",
      finishesCombo: 0,
      answersThreat: 1,
      advancesPlan: 0,
    }),
    candidate("second", {
      name: "Second",
      finishesCombo: 0,
      answersThreat: 0.55,
      advancesPlan: 0,
    }),
    candidate("third", {
      name: "Third",
      finishesCombo: 0,
      answersThreat: 0.5,
      advancesPlan: 0,
    }),
    candidate("garbage", {
      name: "Garbage",
      finishesCombo: 0,
      answersThreat: 0.05,
      advancesPlan: 0,
    }),
  ];

  it("Expert deterministically picks the top-scoring candidate", () => {
    const pick = selectTutorTarget(
      {
        candidates: pool,
        archetype: "control",
        difficulty: "expert",
        opponentThreatScore: 1,
      },
      zeroRng,
    );
    expect(pick.choice.id).toBe("best");
    expect(pick.scoredCandidates[0].candidate.id).toBe("best");
  });

  it("Hard picks the top candidate (no noise tier)", () => {
    const pick = selectTutorTarget(
      {
        candidates: pool,
        archetype: "control",
        difficulty: "hard",
        opponentThreatScore: 1,
      },
      maxRng,
    );
    expect(pick.choice.id).toBe("best");
  });

  it("Easy samples from the top-3 — over many rolls, picks more than one distinct candidate", () => {
    const seen = new Set<string>();
    // 60 deterministic RNG points = a good distribution sweep.
    for (let i = 0; i < 60; i++) {
      const pick = selectTutorTarget(
        {
          candidates: pool,
          archetype: "control",
          difficulty: "easy",
          opponentThreatScore: 1,
        },
        () => i / 60,
      );
      seen.add(pick.choice.id);
    }
    // The top-3 candidates (best, second, third) must all be reachable.
    expect(seen.has("best")).toBe(true);
    expect(seen.has("second")).toBe(true);
    expect(seen.has("third")).toBe(true);
    // Garbage must never be picked from a top-3 pool.
    expect(seen.has("garbage")).toBe(false);
  });

  it("Medium samples from the top-2 — never picks third or garbage", () => {
    for (let i = 0; i < 20; i++) {
      const pick = selectTutorTarget(
        {
          candidates: pool,
          archetype: "control",
          difficulty: "medium",
          opponentThreatScore: 1,
        },
        () => i / 20,
      );
      expect(["best", "second"]).toContain(pick.choice.id);
    }
  });

  it("Easy noise amplitude is strictly greater than Hard", () => {
    expect(DIFFICULTY_NOISE.easy).toBeGreaterThan(DIFFICULTY_NOISE.hard);
    expect(DIFFICULTY_NOISE.hard).toBeGreaterThan(DIFFICULTY_NOISE.expert);
    expect(DIFFICULTY_NOISE.expert).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* AC #3 — combo-Expert winsNextTurn override                                 */
/* -------------------------------------------------------------------------- */

describe("selectTutorTarget — combo-Expert winsNextTurn override (issue #1231 AC #3)", () => {
  it("Expert combo targets winsNextTurn card even when another card scores higher", () => {
    const pool: TutorCandidate[] = [
      // Highest raw score but does NOT win the game next turn.
      candidate("value-card", {
        name: "Value Card",
        finishesCombo: 0,
        answersThreat: 1,
        advancesPlan: 1,
      }),
      // Lower raw score but wins the game next turn if it resolves.
      candidate("combo-finisher", {
        name: "Combo Finisher",
        finishesCombo: 0.4,
        answersThreat: 0,
        advancesPlan: 0,
        winsNextTurn: true,
      }),
      candidate("filler", {
        name: "Filler",
        finishesCombo: 0,
        answersThreat: 0.1,
        advancesPlan: 0.1,
      }),
    ];

    const pick = selectTutorTarget({
      candidates: pool,
      archetype: "combo",
      difficulty: "expert",
      opponentThreatScore: 0.5,
    });

    expect(pick.choice.id).toBe("combo-finisher");
    expect(pick.comboFinishOverride).toBe(true);
    expect(pick.reason).toMatch(/wins next turn/i);
  });

  it("Hard combo does NOT use the override — picks the raw top scorer", () => {
    const pool: TutorCandidate[] = [
      // Strong on threat-answer + plan-advance. Under combo weights
      // (combo=0.7, threat=0.15, plan=0.15) this scores 0.15*1*0.5 +
      // 0.15*1 = 0.225.
      candidate("value-card", {
        name: "Value Card",
        finishesCombo: 0,
        answersThreat: 1,
        advancesPlan: 1,
      }),
      // A low combo-finisher. Under combo weights this scores 0.7*0.2 =
      // 0.14 — clearly below value-card, so the raw top scorer is the
      // value card, NOT the winsNextTurn candidate.
      candidate("combo-finisher", {
        name: "Combo Finisher",
        finishesCombo: 0.2,
        answersThreat: 0,
        advancesPlan: 0,
        winsNextTurn: true,
      }),
    ];

    const pick = selectTutorTarget({
      candidates: pool,
      archetype: "combo",
      difficulty: "hard",
      opponentThreatScore: 0.5,
    });

    expect(pick.choice.id).toBe("value-card");
    expect(pick.comboFinishOverride).toBe(false);
  });

  it("Expert control does NOT use the override even with a winsNextTurn candidate", () => {
    const pool: TutorCandidate[] = [
      candidate("wrath", {
        name: "Wrath",
        answersThreat: 1,
      }),
      candidate("combo-finisher", {
        name: "Combo Finisher",
        finishesCombo: 0.4,
        winsNextTurn: true,
      }),
    ];

    const pick = selectTutorTarget({
      candidates: pool,
      archetype: "control",
      difficulty: "expert",
      opponentThreatScore: 1,
    });

    // The combo override is gated on archetype === "combo".
    expect(pick.choice.id).toBe("wrath");
    expect(pick.comboFinishOverride).toBe(false);
  });

  it("Expert combo with no winsNextTurn candidate picks the top scorer", () => {
    const pool: TutorCandidate[] = [
      candidate("a", { finishesCombo: 0.9 }),
      candidate("b", { finishesCombo: 0.5 }),
    ];

    const pick = selectTutorTarget({
      candidates: pool,
      archetype: "combo",
      difficulty: "expert",
      opponentThreatScore: 0.5,
    });

    expect(pick.choice.id).toBe("a");
    expect(pick.comboFinishOverride).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Defensive edge cases                                                       */
/* -------------------------------------------------------------------------- */

describe("selectTutorTarget — edge cases", () => {
  it("throws on an empty candidate pool (the AI should never cast a tutor then)", () => {
    expect(() =>
      selectTutorTarget({
        candidates: [],
        archetype: "combo",
        difficulty: "expert",
      }),
    ).toThrow();
  });

  it("single candidate is returned directly, regardless of difficulty", () => {
    const pool: TutorCandidate[] = [candidate("only", { finishesCombo: 0.8 })];
    for (const difficulty of LEVELS) {
      const pick = selectTutorTarget(
        {
          candidates: pool,
          archetype: "combo",
          difficulty,
        },
        minRng,
      );
      expect(pick.choice.id).toBe("only");
    }
  });

  it("zero opponent threat score neutralises threat-answer candidates", () => {
    const threatAnswer = candidate("threat", { answersThreat: 1 });
    const advance = candidate("advance", { advancesPlan: 0.5 });

    const pick = selectTutorTarget({
      candidates: [threatAnswer, advance],
      archetype: "control",
      difficulty: "expert",
      opponentThreatScore: 0,
    });

    // With zero threat pressure, the threat answer can't score on its
    // main axis; the plan-advance card wins.
    expect(pick.choice.id).toBe("advance");
  });

  it("weights sum to 1 for every archetype (defensive invariant)", () => {
    for (const archetype of Object.keys(ARCHETYPE_TUTOR_WEIGHTS) as Array<
      keyof typeof ARCHETYPE_TUTOR_WEIGHTS
    >) {
      const w = ARCHETYPE_TUTOR_WEIGHTS[archetype];
      expect(w.combo + w.threat + w.plan).toBeCloseTo(1, 5);
    }
    const u = UNKNOWN_ARCHETYPE_WEIGHTS;
    expect(u.combo + u.threat + u.plan).toBeCloseTo(1, 5);
  });
});

/* -------------------------------------------------------------------------- */
/* isTutorOracle detector                                                     */
/* -------------------------------------------------------------------------- */

describe("isTutorOracle (issue #1231 — turn-loop wiring helper)", () => {
  it("recognises canonical tutor templates", () => {
    expect(isTutorOracle("Search your library for a card. Shuffle.")).toBe(
      true,
    );
    expect(
      isTutorOracle(
        "Search your library for an artifact card and put it onto the battlefield.",
      ),
    ).toBe(true);
    expect(isTutorOracle("search your library for a creature card.")).toBe(
      true,
    );
  });

  it("rejects non-tutor card text", () => {
    expect(isTutorOracle("Deal 3 damage to any target.")).toBe(false);
    expect(isTutorOracle("Draw two cards.")).toBe(false);
    expect(isTutorOracle("")).toBe(false);
    expect(isTutorOracle(undefined)).toBe(false);
    expect(isTutorOracle(null)).toBe(false);
  });
});

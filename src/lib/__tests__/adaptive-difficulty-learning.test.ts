/**
 * @fileoverview Tests for the end-of-game learning loop (issue #1066).
 *
 * Verifies that game outcomes + post-game analysis are folded back into the
 * AI's evaluation weights in a principled, bounded, smoothed, persisted and
 * resettable way. Covers:
 *
 *   - decisive-factor extraction (keyword → weight mapping)
 *   - adjustment DIRECTION (loss nudges decisive factors up; win normalizes;
 *     draw is a no-op)
 *   - adjustment BOUNDS (band clamp keeps tiers from collapsing; Expert ≈ 0)
 *   - SMOOTHING (a single game can't swing the AI — bounded per-game footprint)
 *   - PERSISTENCE round-trip (learned weights survive a fresh learner load)
 *   - RESET (one tier + full)
 *   - the orchestration entry points in adaptive-difficulty.ts
 *   - quota-safe persistence (QuotaExceededError never throws)
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
  WeightLearner,
  toDifficultyTier,
  weightsForPhrase,
  extractDecisiveFactors,
  computeTargetWeights,
  clampToBand,
  emaStep,
  loadLearnedStore,
  saveLearnedStore,
  normalizeTierState,
  ingestGameOutcome,
  resetLearnedWeights,
  getLearnedEvaluationWeights,
  LEARNED_WEIGHTS_STORAGE_KEY,
  EMA_ALPHA,
  MAX_PER_GAME_FRACTION,
  MIN_BAND_FRACTION,
  MAX_BAND_FRACTION,
  TIER_LEARN_FACTOR,
  type AIGameOutcome,
  type IngestResult,
} from "@/ai/weight-learning";
import {
  getDefaultEvaluationWeights,
  DefaultWeights,
  type DifficultyTier,
  type EvaluationWeights,
} from "@/ai/game-state-evaluator";
import type { GameAnalysisOutput } from "@/ai/flows/ai-post-game-analysis";
import {
  ingestGameOutcomeIntoWeights,
  getEvaluationWeightsForDifficulty,
  resetLearnedWeightsForDifficulty,
} from "../adaptive-difficulty";

const TIERS: DifficultyTier[] = ["easy", "medium", "hard", "expert"];

/** Build a GameAnalysisOutput with the given free-text signals. */
function analysis(opts: {
  keyMoments?: Array<{ description: string; impact: "positive" | "negative" | "neutral" }>;
  mistakes?: Array<{ description: string; severity: "major" | "minor" }>;
  improvementAreas?: string[];
  deckSuggestions?: Array<{ card: string; reason: string }>;
  overallRating?: number;
}): GameAnalysisOutput {
  return {
    gameSummary: "test",
    keyMoments: (opts.keyMoments ?? []).map((m, i) => ({
      turn: i + 1,
      description: m.description,
      impact: m.impact,
    })),
    mistakes: (opts.mistakes ?? []).map((m, i) => ({
      turn: i + 1,
      description: m.description,
      severity: m.severity,
      suggestion: "",
    })),
    strengths: [],
    improvementAreas: opts.improvementAreas ?? [],
    deckSuggestions: opts.deckSuggestions ?? [],
    overallRating: opts.overallRating ?? 5,
    tips: [],
  };
}

/** An analysis that flags life as the decisive factor (a life-decided loss). */
function lifeDecisiveLossAnalysis(): GameAnalysisOutput {
  return analysis({
    keyMoments: [
      { description: "Significant life change: -8", impact: "negative" },
    ],
    improvementAreas: ["Improve defensive strategies to preserve life total"],
  });
}

/** An analysis that flags card advantage as the decisive factor. */
function cardAdvantageAnalysis(): GameAnalysisOutput {
  return analysis({
    keyMoments: [
      { description: "Card advantage shift: -3", impact: "negative" },
    ],
    mistakes: [
      { description: "Wasted a draw spell", severity: "major" },
    ],
  });
}

describe("weight-learning — tier mapping", () => {
  it("collapses UI ladder rungs onto the four evaluator tiers", () => {
    expect(toDifficultyTier("beginner")).toBe("easy");
    expect(toDifficultyTier("easy")).toBe("easy");
    expect(toDifficultyTier("normal")).toBe("medium");
    expect(toDifficultyTier("medium")).toBe("medium");
    expect(toDifficultyTier("hard")).toBe("hard");
    expect(toDifficultyTier("expert")).toBe("expert");
    expect(toDifficultyTier("master")).toBe("expert");
  });

  it("falls back to medium for unknown values (never throws)", () => {
    expect(toDifficultyTier("nightmare")).toBe("medium");
    expect(toDifficultyTier("")).toBe("medium");
    expect(toDifficultyTier("EASY")).toBe("easy"); // case-insensitive
  });
});

describe("weight-learning — keyword → weight mapping", () => {
  it("maps life/damage phrases to lifeScore", () => {
    expect(weightsForPhrase("Significant life change: -8")).toMatchObject({
      lifeScore: 1,
    });
    expect(weightsForPhrase("took lethal damage")).toMatchObject({
      lifeScore: 1,
    });
  });

  it("maps card-advantage phrases to cardAdvantage (+handQuality)", () => {
    const m = weightsForPhrase("Card advantage shift: -3");
    expect(m.cardAdvantage).toBe(1);
    expect(m.handQuality).toBe(0.5);
  });

  it("maps combat/creature phrases to creaturePower", () => {
    const m = weightsForPhrase("bad combat trick, attacked into a blocker");
    expect(m.creaturePower).toBe(1);
  });

  it("maps interaction phrases to stackPressureScore", () => {
    expect(weightsForPhrase("missed removal on a key threat")).toMatchObject({
      stackPressureScore: 1,
    });
    expect(weightsForPhrase("did not hold up a counterspell")).toMatchObject({
      stackPressureScore: 1,
    });
  });

  it("returns empty for unrelated phrases", () => {
    expect(weightsForPhrase("shuffled the deck")).toEqual({});
  });

  it("extractDecisiveFactors aggregates signals across the analysis", () => {
    const factors = extractDecisiveFactors(
      analysis({
        keyMoments: [{ description: "life change", impact: "negative" }],
        mistakes: [
          { description: "missed removal", severity: "major" },
          { description: "bad block", severity: "minor" },
        ],
        improvementAreas: ["Improve defensive strategies"],
      }),
    );
    expect(factors.get("lifeScore")).toBeGreaterThan(0);
    expect(factors.get("stackPressureScore")).toBeGreaterThan(0);
    expect(factors.get("creaturePower")).toBeGreaterThan(0);
    // major mistake weights double minor
    expect(factors.get("stackPressureScore")).toBeGreaterThan(
      factors.get("creaturePower")!,
    );
  });
});

describe("weight-learning — pure math", () => {
  it("clampToBand keeps value within [default·min, default·max]", () => {
    expect(clampToBand(100, 10, 0.5, 1.6)).toBe(16); // hi clamp
    expect(clampToBand(0, 10, 0.5, 1.6)).toBe(5); // lo clamp
    expect(clampToBand(11, 10, 0.5, 1.6)).toBe(11); // inside, untouched
  });

  it("clampToBand leaves zero/negative defaults untouched (design pins)", () => {
    expect(clampToBand(1000, 0, 0.5, 1.6)).toBe(1000);
    expect(clampToBand(1000, -1, 0.5, 1.6)).toBe(1000);
  });

  it("emaStep moves learned a fraction toward target", () => {
    expect(emaStep(0, 10, 0.25)).toBeCloseTo(2.5);
    expect(emaStep(10, 10, 0.25)).toBe(10); // already at target
  });
});

describe("weight-learning — adjustment DIRECTION", () => {
  let learner: WeightLearner;

  beforeEach(() => {
    localStorage.clear();
    learner = new WeightLearner();
  });

  it("on an AI LOSS with life decisive, lifeScore INCREASES", () => {
    const before = learner.getLearnedEvaluationWeights("medium").lifeScore;
    learner.ingestGameOutcome("medium", "loss", lifeDecisiveLossAnalysis());
    const after = learner.getLearnedEvaluationWeights("medium").lifeScore;
    expect(after).toBeGreaterThan(before);
  });

  it("on an AI LOSS with card-advantage decisive, cardAdvantage INCREASES", () => {
    const before = learner.getLearnedEvaluationWeights("medium").cardAdvantage;
    learner.ingestGameOutcome("medium", "loss", cardAdvantageAnalysis());
    const after = learner.getLearnedEvaluationWeights("medium").cardAdvantage;
    expect(after).toBeGreaterThan(before);
  });

  it("on an AI LOSS, UNRELATED weights do not change", () => {
    const before = learner.getLearnedEvaluationWeights("medium").poisonScore;
    learner.ingestGameOutcome("medium", "loss", lifeDecisiveLossAnalysis());
    const after = learner.getLearnedEvaluationWeights("medium").poisonScore;
    // poison not mentioned → held in place
    expect(after).toBeCloseTo(before, 10);
  });

  it("on an AI WIN, weights ease toward defaults (no decisive up-nudge)", () => {
    // First, push lifeScore above default via a loss so we have drift to unwind.
    learner.ingestGameOutcome("medium", "loss", lifeDecisiveLossAnalysis());
    const drifted = learner.getLearnedEvaluationWeights("medium").lifeScore;
    const def = getDefaultEvaluationWeights("medium").lifeScore;
    expect(drifted).toBeGreaterThan(def);

    // Now a win: lifeScore should move BACK toward default (decrease).
    learner.ingestGameOutcome("medium", "win", lifeDecisiveLossAnalysis());
    const afterWin = learner.getLearnedEvaluationWeights("medium").lifeScore;
    expect(afterWin).toBeLessThan(drifted);
  });

  it("on a DRAW, nothing changes", () => {
    const before = learner.getLearnedEvaluationWeights("medium");
    const res = learner.ingestGameOutcome(
      "medium",
      "draw",
      lifeDecisiveLossAnalysis(),
    );
    const after = learner.getLearnedEvaluationWeights("medium");
    expect(after).toEqual(before);
    expect(res.applied).toBe(false);
    expect(res.changes).toEqual({});
  });

  it("records gamesPlayed per tier", () => {
    expect(learner.gamesPlayed("medium")).toBe(0);
    learner.ingestGameOutcome("medium", "loss", lifeDecisiveLossAnalysis());
    learner.ingestGameOutcome("medium", "win", lifeDecisiveLossAnalysis());
    expect(learner.gamesPlayed("medium")).toBe(2);
  });
});

describe("weight-learning — adjustment BOUNDS", () => {
  let learner: WeightLearner;

  beforeEach(() => {
    localStorage.clear();
    learner = new WeightLearner();
  });

  it("never lets a weight leave the [min,max]·default band, even after many games", () => {
    for (let i = 0; i < 50; i++) {
      learner.ingestGameOutcome("easy", "loss", lifeDecisiveLossAnalysis());
    }
    const w = learner.getLearnedEvaluationWeights("easy");
    const def = getDefaultEvaluationWeights("easy");
    for (const key of Object.keys(def) as (keyof EvaluationWeights)[]) {
      const d = def[key];
      if (d <= 0) continue;
      expect(w[key]).toBeGreaterThanOrEqual(d * MIN_BAND_FRACTION - 1e-9);
      expect(w[key]).toBeLessThanOrEqual(d * MAX_BAND_FRACTION + 1e-9);
    }
  });

  it("keeps every tier's weights within its band by default", () => {
    for (const tier of TIERS) {
      const w = learner.getLearnedEvaluationWeights(tier);
      const def = getDefaultEvaluationWeights(tier);
      for (const key of Object.keys(def) as (keyof EvaluationWeights)[]) {
        const d = def[key];
        if (d <= 0) continue;
        expect(w[key]).toBeGreaterThanOrEqual(d * MIN_BAND_FRACTION - 1e-9);
        expect(w[key]).toBeLessThanOrEqual(d * MAX_BAND_FRACTION + 1e-9);
      }
    }
  });

  it("EXPERT adjustments are bounded to ~0 (near-default after a losing streak)", () => {
    for (let i = 0; i < 20; i++) {
      learner.ingestGameOutcome("expert", "loss", lifeDecisiveLossAnalysis());
    }
    const w = learner.getLearnedEvaluationWeights("expert");
    const def = getDefaultEvaluationWeights("expert");
    // Expert learn factor is ~0.03, so lifeScore must stay within ~3% of default.
    const rel = Math.abs(w.lifeScore - def.lifeScore) / def.lifeScore;
    expect(rel).toBeLessThan(0.05);
    expect(TIER_LEARN_FACTOR.expert).toBeLessThan(0.05);
  });

  it("computeTargetWeights clamps the per-game fraction to MAX_PER_GAME_FRACTION", () => {
    // Flood the analysis with many life signals so the raw fraction would
    // explode without the per-game cap.
    const flooded = analysis({
      keyMoments: Array.from({ length: 20 }, () => ({
        description: "life change -8",
        impact: "negative" as const,
      })),
      mistakes: Array.from({ length: 20 }, () => ({
        description: "missed life gain",
        severity: "major" as const,
      })),
    });
    const factors = extractDecisiveFactors(flooded);
    const def = getDefaultEvaluationWeights("medium");
    const target = computeTargetWeights(def, def, factors, "loss", "easy");
    // lifeScore target should be capped at default·(1 + MAX_PER_GAME_FRACTION·easyFactor)
    const expectedMax = def.lifeScore * (1 + MAX_PER_GAME_FRACTION * TIER_LEARN_FACTOR.easy);
    expect(target.lifeScore).toBeLessThanOrEqual(expectedMax + 1e-9);
  });
});

describe("weight-learning — SMOOTHING (no wild swings from one game)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("a single game moves a decisive weight by at most EMA_ALPHA·MAX_PER_GAME_FRACTION·default", () => {
    const learner = new WeightLearner();
    const def = getDefaultEvaluationWeights("medium").lifeScore;
    const before = learner.getLearnedEvaluationWeights("medium").lifeScore;
    learner.ingestGameOutcome("medium", "loss", lifeDecisiveLossAnalysis());
    const after = learner.getLearnedEvaluationWeights("medium").lifeScore;
    const delta = after - before;
    const maxTheoreticalStep = EMA_ALPHA * MAX_PER_GAME_FRACTION * def + 1e-9;
    expect(delta).toBeGreaterThan(0); // actually moved
    expect(delta).toBeLessThanOrEqual(maxTheoreticalStep);
  });

  it("many small games converge smoothly (monotonic for a one-sided streak)", () => {
    const learner = new WeightLearner();
    const def = getDefaultEvaluationWeights("easy").lifeScore;
    let prev = learner.getLearnedEvaluationWeights("easy").lifeScore;
    const series: number[] = [prev];
    for (let i = 0; i < 15; i++) {
      learner.ingestGameOutcome("easy", "loss", lifeDecisiveLossAnalysis());
      const cur = learner.getLearnedEvaluationWeights("easy").lifeScore;
      series.push(cur);
      // lifeScore must increase monotonically toward the band ceiling…
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = cur;
    }
    // …and stay strictly inside the band ceiling.
    expect(series[series.length - 1]).toBeLessThanOrEqual(
      def * MAX_BAND_FRACTION + 1e-9,
    );
  });

  it("alternating win/loss stays near the default (no cumulative runaway)", () => {
    const learner = new WeightLearner();
    const def = getDefaultEvaluationWeights("easy").lifeScore;
    for (let i = 0; i < 40; i++) {
      learner.ingestGameOutcome(
        "easy",
        i % 2 === 0 ? "loss" : "win",
        lifeDecisiveLossAnalysis(),
      );
    }
    const final = learner.getLearnedEvaluationWeights("easy").lifeScore;
    // Alternating should keep lifeScore close to default (well inside band).
    expect(Math.abs(final - def) / def).toBeLessThan(MAX_BAND_FRACTION - 1);
  });
});

describe("weight-learning — PERSISTENCE (round-trip)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists learned weights across a fresh WeightLearner load", () => {
    const a = new WeightLearner();
    a.ingestGameOutcome("medium", "loss", lifeDecisiveLossAnalysis());
    a.ingestGameOutcome("medium", "loss", lifeDecisiveLossAnalysis());
    const persisted = a.getLearnedEvaluationWeights("medium").lifeScore;

    // A brand-new learner must observe the same value from localStorage.
    const b = new WeightLearner();
    expect(b.getLearnedEvaluationWeights("medium").lifeScore).toBeCloseTo(
      persisted,
      10,
    );
    expect(b.gamesPlayed("medium")).toBe(2);
  });

  it("writes a versioned, parseable payload to localStorage", () => {
    const a = new WeightLearner();
    a.ingestGameOutcome("easy", "loss", lifeDecisiveLossAnalysis());
    const raw = localStorage.getItem(LEARNED_WEIGHTS_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(1);
    expect(parsed.tiers.easy.gamesPlayed).toBe(1);
  });

  it("loadLearnedStore returns null on corrupt JSON", () => {
    localStorage.setItem(LEARNED_WEIGHTS_STORAGE_KEY, "{not json");
    expect(loadLearnedStore()).toBeNull();
  });

  it("loadLearnedStore rejects a wrong-version payload", () => {
    localStorage.setItem(
      LEARNED_WEIGHTS_STORAGE_KEY,
      JSON.stringify({ version: 999, tiers: {} }),
    );
    expect(loadLearnedStore()).toBeNull();
  });

  it("saveLearnedStore returns ok:true on a healthy store", () => {
    const res = saveLearnedStore({ version: 1, tiers: {} });
    expect(res.ok).toBe(true);
  });

  it("normalizeTierState repairs missing keys + out-of-band values", () => {
    const repaired = normalizeTierState("medium", {
      gamesPlayed: 3,
      weights: { lifeScore: 9999 } as unknown as EvaluationWeights,
    });
    const def = getDefaultEvaluationWeights("medium").lifeScore;
    expect(repaired.gamesPlayed).toBe(3);
    expect(repaired.weights.lifeScore).toBeLessThanOrEqual(def * MAX_BAND_FRACTION);
    // Missing keys are backfilled from defaults.
    expect(repaired.weights.cardAdvantage).toBe(
      getDefaultEvaluationWeights("medium").cardAdvantage,
    );
  });
});

describe("weight-learning — RESET", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reset(tier) returns that tier to static defaults while leaving others", () => {
    const learner = new WeightLearner();
    learner.ingestGameOutcome("easy", "loss", lifeDecisiveLossAnalysis());
    learner.ingestGameOutcome("hard", "loss", lifeDecisiveLossAnalysis());
    learner.reset("easy");

    expect(learner.getLearnedEvaluationWeights("easy").lifeScore).toBe(
      getDefaultEvaluationWeights("easy").lifeScore,
    );
    expect(learner.gamesPlayed("easy")).toBe(0);
    // Hard untouched.
    expect(learner.gamesPlayed("hard")).toBe(1);
  });

  it("reset() with no arg wipes all tiers", () => {
    const learner = new WeightLearner();
    learner.ingestGameOutcome("easy", "loss", lifeDecisiveLossAnalysis());
    learner.ingestGameOutcome("expert", "loss", lifeDecisiveLossAnalysis());
    learner.reset();
    for (const tier of TIERS) {
      expect(learner.gamesPlayed(tier)).toBe(0);
      expect(learner.getLearnedEvaluationWeights(tier)).toEqual(
        getDefaultEvaluationWeights(tier),
      );
    }
  });

  it("resetLearnedWeights (singleton) survives a reload", () => {
    // Seed the singleton.
    ingestGameOutcome("medium", "loss", lifeDecisiveLossAnalysis());
    expect(resetLearnedWeights().ok).toBe(true);
    // A fresh learner sees the reset state.
    const fresh = new WeightLearner();
    expect(fresh.gamesPlayed("medium")).toBe(0);
  });
});

describe("weight-learning — QUOTA safety (#1085)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("ingestGameOutcome does not throw when localStorage.setItem rejects with QuotaExceededError", () => {
    const learner = new WeightLearner();
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const err: Error & { name: string } = new Error("no space");
      err.name = "QuotaExceededError";
      throw err;
    });

    let result: IngestResult | undefined;
    expect(() => {
      result = learner.ingestGameOutcome(
        "medium",
        "loss",
        lifeDecisiveLossAnalysis(),
      );
    }).not.toThrow();

    // The in-memory update still happened…
    expect(result?.tier).toBe("medium");
    expect(result?.gamesPlayedAtTier).toBe(1);
    // …but a quota warning is surfaced instead of a crash.
    expect(result?.persistenceWarning).toBeTruthy();
    expect(result?.persistenceWarning).toMatch(/storage/i);

    jest.restoreAllMocks();
  });

  it("saveLearnedStore returns {ok:false, warning} on quota error", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      const err: Error & { name: string } = new Error("full");
      err.name = "QuotaExceededError";
      throw err;
    });
    const res = saveLearnedStore({ version: 1, tiers: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.warning.length).toBeGreaterThan(0);
    }
    jest.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// Orchestration entry points in src/lib/adaptive-difficulty.ts
// ---------------------------------------------------------------------------

describe("adaptive-difficulty — learning-loop orchestration", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset the singleton between tests so the module-level learner is clean.
    resetLearnedWeights();
  });

  afterEach(() => {
    localStorage.clear();
    resetLearnedWeights();
  });

  it("ingestGameOutcomeIntoWeights maps the UI difficulty to a tier and closes the loop", () => {
    const res = ingestGameOutcomeIntoWeights({
      difficulty: "normal", // → medium
      outcome: "loss",
      analysis: lifeDecisiveLossAnalysis(),
    });
    expect(res.tier).toBe("medium");
    expect(res.outcome).toBe("loss");
    expect(res.gamesPlayedAtTier).toBe(1);
  });

  it("ingestGameOutcomeIntoWeights actually nudges the observable weights for the tier", () => {
    const def = getEvaluationWeightsForDifficulty("normal").lifeScore;
    ingestGameOutcomeIntoWeights({
      difficulty: "normal",
      outcome: "loss",
      analysis: lifeDecisiveLossAnalysis(),
    });
    const learned = getEvaluationWeightsForDifficulty("normal").lifeScore;
    expect(learned).toBeGreaterThan(def);
  });

  it("beginner/master UI rungs route to easy/expert tiers respectively", () => {
    const r1 = ingestGameOutcomeIntoWeights({
      difficulty: "beginner",
      outcome: "loss",
      analysis: lifeDecisiveLossAnalysis(),
    });
    expect(r1.tier).toBe("easy");
    const r2 = ingestGameOutcomeIntoWeights({
      difficulty: "master",
      outcome: "loss",
      analysis: lifeDecisiveLossAnalysis(),
    });
    expect(r2.tier).toBe("expert");
  });

  it("getEvaluationWeightsForDifficulty returns defaults before any learning", () => {
    const w = getEvaluationWeightsForDifficulty("hard");
    expect(w).toEqual(DefaultWeights.hard);
  });

  it("resetLearnedWeightsForDifficulty clears a single UI tier", () => {
    ingestGameOutcomeIntoWeights({
      difficulty: "easy",
      outcome: "loss",
      analysis: lifeDecisiveLossAnalysis(),
    });
    expect(getLearnedEvaluationWeights("easy").lifeScore).not.toBe(
      DefaultWeights.easy.lifeScore,
    );
    resetLearnedWeightsForDifficulty("beginner"); // beginner → easy
    expect(getLearnedEvaluationWeights("easy").lifeScore).toBe(
      DefaultWeights.easy.lifeScore,
    );
  });

  it("accepts an explicit learner for hermetic testing (no singleton/global state)", () => {
    const isolated = new WeightLearner();
    const def = isolated.getLearnedEvaluationWeights("hard").lifeScore;
    const res = ingestGameOutcomeIntoWeights(
      {
        difficulty: "hard",
        outcome: "loss",
        analysis: lifeDecisiveLossAnalysis(),
      },
      isolated,
    );
    expect(res.tier).toBe("hard");
    expect(isolated.getLearnedEvaluationWeights("hard").lifeScore).toBeGreaterThan(
      def,
    );
    // Singleton was NOT touched.
    expect(getLearnedEvaluationWeights("hard").lifeScore).toBe(
      DefaultWeights.hard.lifeScore,
    );
  });
});

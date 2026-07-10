/**
 * @fileoverview Tutor / library-search target selection (issue #1231).
 *
 * Tutor cards ("search your library for a card") are a defining feature of
 * combo and toolbox decks — see `archetype-signatures.ts` (which already
 * counts `tutors ≥ 8 → +25` to the combo score). The AI turn loop casts
 * tutor spells as generic non-creature spells and previously had no
 * explicit logic for *which* card to fetch: target selection was implicit
 * in `chooseCardToCast` / sequence heuristics.
 *
 * Tutor decisions are the highest-leverage turn in many games. Easy AI
 * fetches the first reasonable match; Expert AI fetches the card that
 * wins the game if it resolves next turn. This module makes that scaling
 * explicit and unit-testable:
 *
 *   1. {@link selectTutorTarget} — the public entry point. Pure: takes a
 *      context (candidates + gameState + difficulty + archetype) and an
 *      optional deterministic RNG, returns the chosen card plus a
 *      machine-checkable rationale.
 *   2. {@link isTutorOracle} — oracle-text detector used by the turn loop
 *      to identify tutor spells when they hit the stack.
 *   3. {@link scoreTutorCandidate} — pure scoring function exposed so the
 *      AI's heuristic layer can inspect "why" a card was chosen without
 *      re-running the selector.
 *
 * Tier separation (acceptance criteria #2) is enforced by
 * {@link DIFFICULTY_NOISE} plus the per-tier sampling strategy in
 * {@link selectTutorTarget}. The combo-Expert "win on the next turn" rule
 * (acceptance criteria #3) is the `winsNextTurn` override in
 * {@link selectTutorTarget}.
 */

import type { DifficultyLevel } from "../ai-difficulty";
import type { DeckArchetype } from "../game-state-evaluator";

/* -------------------------------------------------------------------------- */
/* Public types                                                               */
/* -------------------------------------------------------------------------- */

/**
 * One card the AI can tutor for. A minimal, engine-agnostic shape so the
 * selector stays pure and testable without dragging the full
 * {@link CardInstance} graph into unit tests. The caller is responsible
 * for projecting candidate cards into this shape — typically via a small
 * adapter in `ai-turn-loop.ts` that reads the relevant `oracle_text`,
 * `type_line` and effect flags off the engine state.
 *
 * Every flag is a 0..1 hint about *why* a candidate is a good tutor
 * target. They are deliberately coarse so that scoring stays
 * deterministic at Expert and human-readable in tests.
 */
export interface TutorCandidate {
  /** Stable card ID (e.g. the engine `CardInstanceId`). */
  id: string;
  /** Human-readable name — used in rationale strings and tests only. */
  name: string;
  /**
   * 0..1 — does this card finish a known combo the AI is currently
   * assembling? Combo archetype weights this much more heavily than
   * other archetypes.
   */
  finishesCombo: number;
  /**
   * 0..1 — does this card answer (remove / counter / blank) the
   * opponent's biggest current threat? Midrange / control decks weight
   * this most.
   */
  answersThreat: number;
  /**
   * 0..1 — does this card advance the AI's own gameplan (ramp,
   * card-advantage, plan-congruent permanent)? Aggro weights this
   * most.
   */
  advancesPlan: number;
  /**
   * True iff fetching this card now would let the AI win on its next
   * turn (e.g. the missing combo piece when the other pieces are in
   * hand and the mana is up). Per the issue's acceptance criteria #3,
   * Expert `combo` archetype must target this card when one is
   * available in the pool.
   */
  winsNextTurn?: boolean;
}

/**
 * Context for {@link selectTutorTarget}. `gameState` is intentionally
 * optional / loosely typed — the selector only reads the fields it needs
 * to derive the opponent threat signal. Callers that don't have an
 * `AIGameState` handy (unit tests) can pass a synthetic object.
 */
export interface TutorTargetContext {
  /** Candidates visible to the tutor (e.g. top 5 cards the tutor may fetch). */
  candidates: TutorCandidate[];
  /** Detected AI archetype — drives the per-archetype scoring weights. */
  archetype: DeckArchetype;
  /** Skill tier — drives noise, sampling strategy, and the combo override. */
  difficulty: DifficultyLevel;
  /**
   * Synthetic game-state hint: 0..1 score of the opponent's biggest
   * current threat (composite of board, life, intent). When omitted the
   * selector falls back to a neutral 0.5 so unit tests without a full
   * game state still work.
   */
  opponentThreatScore?: number;
}

/**
 * A scored candidate row. Returned by {@link scoreTutorCandidate} and
 * surfaced through the selector's `scoredCandidates` field so the AI's
 * "why" layer (telegraph, debugger overlay) can inspect the breakdown
 * without rerunning the math.
 */
export interface ScoredTutorCandidate {
  candidate: TutorCandidate;
  /** Composite score after per-archetype / per-difficulty weighting. */
  score: number;
  /** Per-axis contributions (combo, threat answer, plan advance). */
  contributions: {
    combo: number;
    threat: number;
    plan: number;
  };
}

/** Decision returned by {@link selectTutorTarget}. */
export interface TutorTargetDecision {
  /** The chosen card — never `null` because the caller must pass ≥ 1 candidate. */
  choice: TutorCandidate;
  /** All candidates, sorted by score (descending). */
  scoredCandidates: ScoredTutorCandidate[];
  /** Difficulty tier of the decision (echo of `context.difficulty`). */
  difficulty: DifficultyLevel;
  /** Short machine-readable rationale for the AI telegraph / debugger. */
  reason: string;
  /** True iff the choice was forced by the combo-Expert `winsNextTurn` override. */
  comboFinishOverride: boolean;
}

/* -------------------------------------------------------------------------- */
/* Scoring                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Per-archetype weight vector for the composite tutor score. Combo decks
 * weight finishing the combo far more than anything else; aggro weights
 * plan advance; control / midrange weight threat answers. Numbers are
 * normalised so the composite stays in `[0, 1]` when the candidate
 * contributions are also in `[0, 1]`.
 */
export const ARCHETYPE_TUTOR_WEIGHTS: Record<
  Exclude<DeckArchetype, "unknown">,
  { combo: number; threat: number; plan: number }
> = {
  combo: { combo: 0.7, threat: 0.15, plan: 0.15 },
  control: { combo: 0.1, threat: 0.6, plan: 0.3 },
  midrange: { combo: 0.2, threat: 0.45, plan: 0.35 },
  aggro: { combo: 0.15, threat: 0.3, plan: 0.55 },
  ramp: { combo: 0.3, threat: 0.2, plan: 0.5 },
};

/**
 * Fallback weights used when the detected archetype is `unknown`. Chosen
 * to be roughly midrange so an unclassified deck still behaves sensibly
 * (no extreme preference for any one axis).
 */
export const UNKNOWN_ARCHETYPE_WEIGHTS: {
  combo: number;
  threat: number;
  plan: number;
} = { combo: 0.25, threat: 0.4, plan: 0.35 };

/**
 * Difficulty-keyed noise amplitude applied to each candidate's composite
 * score during sampling. The tier separation (acceptance criterion #2) is
 * enforced here plus by the per-tier sampling strategy in
 * {@link selectTutorTarget}. Expert has zero noise so it is fully
 * deterministic given the same context.
 *
 * Noise is bounded so a high-noise Easy pick still picks from the
 * top-half — it never flips the rank completely (otherwise the AI would
 * look broken even at Easy).
 */
export const DIFFICULTY_NOISE: Record<DifficultyLevel, number> = {
  easy: 0.35,
  medium: 0.18,
  hard: 0.06,
  expert: 0,
};

/**
 * Pure scoring of a single tutor candidate. Public so the AI's
 * debugger/telegraph layer can attach the breakdown to its "why" output
 * without re-running the selector.
 *
 * Score is `clamp01(weights.combo * finishesCombo + weights.threat *
 * answersThreat + weights.plan * advancesPlan)`. The weights resolve to
 * {@link UNKNOWN_ARCHETYPE_WEIGHTS} when the archetype is `unknown`.
 */
export function scoreTutorCandidate(
  candidate: TutorCandidate,
  archetype: DeckArchetype,
  opponentThreatScore: number,
): ScoredTutorCandidate {
  const weights =
    archetype === "unknown"
      ? UNKNOWN_ARCHETYPE_WEIGHTS
      : ARCHETYPE_TUTOR_WEIGHTS[archetype];

  // Threat-answer sub-score is multiplied by the actual opponent threat
  // so that answering a non-threat (low opponentThreatScore) yields a
  // smaller composite — a card that blanks a vanilla 1/1 isn't a tutor
  // target, but a card that kills a 20-power Voltron commander is.
  const threat = clamp01(candidate.answersThreat * opponentThreatScore);

  const combo = clamp01(candidate.finishesCombo);
  const plan = clamp01(candidate.advancesPlan);

  const score = clamp01(
    weights.combo * combo + weights.threat * threat + weights.plan * plan,
  );

  return {
    candidate,
    score,
    contributions: { combo, threat, plan },
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Default RNG. Production callers pass `Math.random`; unit tests pass a
 * deterministic stub so the Easy-tier sampling is reproducible.
 */
export type TutorRng = () => number;

/**
 * Pick the best card from `context.candidates` to tutor for, scaling the
 * decision quality by difficulty and archetype.
 *
 * Tier separation (acceptance criterion #2):
 *   - **easy**:   sample uniformly from the top-3 candidates after noise.
 *                 Acceptable to pick a non-best card — the AI is meant to
 *                 look beatable.
 *   - **medium**: sample uniformly from the top-2 candidates after noise.
 *   - **hard**:   pick the top candidate; small noise applied only to
 *                 break ties on near-equal scores.
 *   - **expert**: pick the score-maximising candidate deterministically.
 *
 * Combo-Expert override (acceptance criterion #3): when the archetype is
 * `combo`, difficulty is `expert`, and *any* candidate has
 * `winsNextTurn === true`, the selector picks the highest-scoring such
 * candidate regardless of total score.
 *
 * Edge cases:
 *   - Empty `candidates` throws — the AI should never cast a tutor with
 *     no library to search.
 *   - Single candidate returns it directly (no noise).
 */
export function selectTutorTarget(
  context: TutorTargetContext,
  rng: TutorRng = Math.random,
): TutorTargetDecision {
  if (!context.candidates || context.candidates.length === 0) {
    throw new Error("selectTutorTarget: candidates must be non-empty");
  }

  const opponentThreatScore = context.opponentThreatScore ?? 0.5;

  // 1) Pure scoring pass — pure function of (candidate, archetype,
  //    opponentThreatScore). Deterministic, no noise yet.
  const scored: ScoredTutorCandidate[] = context.candidates.map((c) =>
    scoreTutorCandidate(c, context.archetype, opponentThreatScore),
  );

  // 2) Sort by composite score, descending.
  scored.sort((a, b) => b.score - a.score);

  // 3) Combo-Expert "winsNextTurn" override — applies *before* noise
  //    so the AI does not gamble with a guaranteed win.
  if (context.difficulty === "expert" && context.archetype === "combo") {
    const finishers = scored.filter(
      (s) => s.candidate.winsNextTurn === true && s.score > 0,
    );
    if (finishers.length > 0) {
      const choice = finishers[0].candidate;
      return {
        choice,
        scoredCandidates: scored,
        difficulty: context.difficulty,
        reason: `Combo-Expert override: tutoring ${choice.name} — wins next turn`,
        comboFinishOverride: true,
      };
    }
  }

  // 4) Difficulty-tier sampling on the noise-perturbed scores.
  const noiseAmp = DIFFICULTY_NOISE[context.difficulty];
  const noisy = scored.map((s) => {
    if (noiseAmp === 0) return { s, jitter: 0 };
    // rng() ∈ [0,1) — center it to ±noiseAmp/2.
    const jitter = (rng() - 0.5) * noiseAmp;
    return { s, jitter };
  });
  const ranked = [...noisy].sort(
    (a, b) => b.s.score + b.jitter - (a.s.score + a.jitter),
  );

  const topN =
    context.difficulty === "easy" ? 3 : context.difficulty === "medium" ? 2 : 1;

  const pool = ranked.slice(0, Math.min(topN, ranked.length));
  const pick =
    pool.length === 1 ? pool[0] : pool[Math.floor(rng() * pool.length)];

  const reason = buildReason(context.difficulty, pick.s, pool, scored);
  return {
    choice: pick.s.candidate,
    scoredCandidates: scored,
    difficulty: context.difficulty,
    reason,
    comboFinishOverride: false,
  };
}

function buildReason(
  difficulty: DifficultyLevel,
  picked: ScoredTutorCandidate,
  pool: { s: ScoredTutorCandidate; jitter: number }[],
  scored: ScoredTutorCandidate[],
): string {
  const rank = scored.findIndex((s) => s.candidate.id === picked.candidate.id);
  const baseline = scored[0];
  const tierLabel =
    difficulty === "expert"
      ? "Expert"
      : difficulty === "hard"
        ? "Hard"
        : difficulty === "medium"
          ? "Medium"
          : "Easy";
  if (rank === 0) {
    return `${tierLabel} tutors ${picked.candidate.name} (top score ${picked.score.toFixed(2)})`;
  }
  return `${tierLabel} tutors ${picked.candidate.name} (score ${picked.score.toFixed(2)}, rank ${rank + 1} of ${scored.length}; best was ${baseline.candidate.name} at ${baseline.score.toFixed(2)})`;
}

/* -------------------------------------------------------------------------- */
/* Oracle-text detection                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Heuristic oracle-text detector for "search your library for a card"
 * tutor effects. The pattern matches the canonical Magic templating
 * ("Search your library for a card", "search your library for an X",
 * case-insensitive) which covers the overwhelming majority of tutors
 * (Demonic Tutor, Vampiric Tutor, Mystical Tutor, Chord of Calling,
 * Collected Conjuring, Finale of Promise, …).
 *
 * The detector is intentionally permissive — false positives only mean
 * the AI consults `selectTutorTarget` for a non-tutor spell, which is
 * harmless because the selector then picks a "best" candidate that the
 * AI never actually uses.
 */
export function isTutorOracle(oracleText: string | undefined | null): boolean {
  if (!oracleText) return false;
  return /search your library for/i.test(oracleText);
}

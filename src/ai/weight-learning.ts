/**
 * @fileoverview End-of-game learning loop — feeds replay outcomes back into
 *               the AI's evaluation weights (issue #1066).
 *
 * Problem this closes
 * -------------------
 * `src/ai/flows/ai-post-game-analysis.ts` produces a rich, structured analysis
 * of a finished game (key moments, mistakes, what decided the game), but that
 * signal was *terminal*: nothing fed it back into the AI. The
 * {@link GameStateEvaluator}'s weights stayed at the static {@link DefaultWeights}
 * forever, so the opponent never improved from game to game. Meanwhile
 * `src/lib/adaptive-difficulty.ts` only *recommended a different tier* — it never
 * retuned the weights themselves.
 *
 * What this module does
 * ---------------------
 * It is a small, interpretable, heuristic online learner (NOT a neural net).
 * After each single-player game the post-game flow calls {@link ingestGameOutcome},
 * handing it the AI's `win`/`loss`/`draw` outcome plus the
 * {@link GameAnalysisOutput}. The learner:
 *
 *   1. Extracts the *decisive factors* of the game (life mattered? card
 *      advantage? a combat trick? a missed removal?) from the analysis via a
 *      fixed, keyword-driven mapping ({@link extractDecisiveFactors}).
 *   2. Computes a target value for each affected weight: on an AI **loss** the
 *      decisive factors are nudged **up** (the AI under-weighted what beat it);
 *      on an AI **win** weights are eased a fraction back toward the static
 *      defaults to prevent over-fitting/monotonic drift; draws are a no-op.
 *   3. Moves the stored weight toward the target with a bounded EMA step
 *      ({@link emaStep}) so no single game can swing the AI.
 *   4. Clamps every weight to a band around its static default
 *      ({@link clampToBand}) so tiers can never collapse into each other.
 *   5. Persists the learned weights **per tier** to localStorage (local-first),
 *      gracefully degrading on {@link QuotaExceededError} (issue #1085) so a
 *      full disk never crashes the game.
 *
 * Scope & cooperation
 * -------------------
 * Learning is scoped per {@link DifficultyTier} (the four evaluator tiers), so a
 * stronger AI never inherits a weaker one's weights. It cooperates with — but
 * stays distinct from — `adaptive-difficulty.ts`: that module still decides
 * *which tier* to recommend; this module retunes the weights *within* a tier.
 * Expert adjustments are gated to ~0 (the Expert tier is meant to be
 * near-optimal), satisfying the issue's "Expert bounded to ~0" criterion.
 *
 * The learned weights are exposed via {@link getLearnedEvaluationWeights} and are
 * intended to be supplied to {@link GameStateEvaluator.setWeights} at game start
 * (see the orchestration helper `ingestGameOutcomeIntoWeights` in
 * `src/lib/adaptive-difficulty.ts`).
 */

import {
  type EvaluationWeights,
  type DifficultyTier,
  getDefaultEvaluationWeights,
} from "./game-state-evaluator";
import type { GameAnalysisOutput } from "./flows/ai-post-game-analysis";
import { isQuotaExceededError } from "@/lib/storage-quota";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

/** The AI's result for a finished game (from the AI's own point of view). */
export type AIGameOutcome = "win" | "loss" | "draw";

/**
 * Learned state for a single tier.
 *
 * `weights` holds the *absolute* (already-EMA-smoothed, band-clamped) values for
 * each weight key, seeded from the static defaults the first time the tier is
 * seen. `gamesPlayed` drives the incremental average and is surfaced for
 * diagnostics.
 */
export interface TierLearnState {
  gamesPlayed: number;
  weights: EvaluationWeights;
}

/** Persisted shape (versioned for future migration). */
export interface LearnedWeightsStore {
  version: number;
  tiers: Partial<Record<DifficultyTier, TierLearnState>>;
}

/** Summary of one ingest call, returned for logging/UI. */
export interface IngestResult {
  tier: DifficultyTier;
  outcome: AIGameOutcome;
  gamesPlayedAtTier: number;
  /** Whether the computed adjustment was committed to the in-memory store. */
  applied: boolean;
  /** Weights that changed (key → new absolute value), for telemetry/UI. */
  changes: Partial<Record<keyof EvaluationWeights, number>>;
  /** Set when persistence was skipped (e.g. quota exhausted). Never thrown. */
  persistenceWarning?: string;
}

// ---------------------------------------------------------------------------
// TUNABLE CONSTANTS — bounded, smoothed, documented
// ---------------------------------------------------------------------------

/**
 * Per-tier learning gate. Scales the *magnitude* of every nudge, so:
 *   - Easy    can drift within a forgiving band (the issue asks for this),
 *   - Hard    moves slowly,
 *   - Expert  is effectively frozen (≈0.03×) → "Expert bounded to ~0".
 *
 * This does NOT change the band clamp, so even at full Easy the weights can
 * never leave the [MIN_BAND_FRACTION, MAX_BAND_FRACTION]·default envelope.
 */
export const TIER_LEARN_FACTOR: Record<DifficultyTier, number> = {
  easy: 1.0,
  medium: 0.6,
  hard: 0.3,
  expert: 0.03,
};

/**
 * EMA coefficient applied to each per-game step. `learned += EMA_ALPHA *
 * (target - learned)`. With EMA_ALPHA = 0.25 a single game can move a weight at
 * most 25% of the way toward its (already bounded) target, so a single wild
 * game is structurally incapable of distorting the AI — the "no wild swings"
 * acceptance criterion.
 */
export const EMA_ALPHA = 0.25;

/**
 * Maximum nudge applied to a single weight in one game, expressed as a fraction
 * of that weight's static default. Combined with EMA smoothing this keeps the
 * per-game footprint tiny even when many decisive factors point the same way.
 */
export const MAX_PER_GAME_FRACTION = 0.25;

/**
 * Hard band around the static default that a learned weight can never leave:
 *   learned ∈ [default · MIN_BAND_FRACTION, default · MAX_BAND_FRACTION].
 *
 * This is the structural guarantee that tiers never collapse (Easy can never
 * out-value Expert on a factor, because each is clamped near its own default)
 * and that a single factor can never run away to dominance.
 */
export const MIN_BAND_FRACTION = 0.5;
export const MAX_BAND_FRACTION = 1.6;

/**
 * Fraction of the (target − default) gap applied when easing back toward the
 * static default on an AI win. Small, so a winning streak only slowly unwinds
 * any drift accumulated during a prior losing streak.
 */
export const WIN_NORMALIZE_FRACTION = 0.1;

/** localStorage key (versioned for forward migration). */
export const LEARNED_WEIGHTS_STORAGE_KEY = "planar-nexus:ai-learned-weights:v1";

/** Current persisted schema version. */
export const LEARNED_WEIGHTS_VERSION = 1;

// ---------------------------------------------------------------------------
// TIER MAPPING
// ---------------------------------------------------------------------------

const TIER_ALIAS: Record<string, DifficultyTier> = {
  // UI ladder (src/lib/adaptive-difficulty.ts) → evaluator tier
  beginner: "easy",
  easy: "easy",
  normal: "medium",
  medium: "medium",
  hard: "hard",
  expert: "expert",
  master: "expert",
};

/**
 * Collapse any UI/archival difficulty name onto the four {@link DifficultyTier}
 * values that actually own weights. Unknown values fall back to `medium` (the
 * evaluator's own default) so we never throw on a surprising input — we simply
 * don't learn for it precisely.
 */
export function toDifficultyTier(level: string): DifficultyTier {
  return TIER_ALIAS[String(level).toLowerCase()] ?? "medium";
}

// ---------------------------------------------------------------------------
// DECISIVE-FACTOR EXTRACTION (principled keyword → weight mapping)
// ---------------------------------------------------------------------------

/**
 * Map a single phrase (a key-moment description, a mistake, an improvement
 * area, …) onto the evaluation weights that "should have mattered more".
 *
 * This is the heart of the loop's *principled* (not random) mapping: it reads
 * the textual signals the heuristic analyser already produces and decides which
 * numeric weight each one implicates. The mapping is intentionally conservative
 * — a phrase only implicates a weight when it names that factor explicitly.
 *
 * Exported for unit testing.
 */
export function weightsForPhrase(
  phrase: string,
): Partial<Record<keyof EvaluationWeights, number>> {
  const p = phrase.toLowerCase();
  const out: Partial<Record<keyof EvaluationWeights, number>> = {};

  // Life / damage / survival → lifeScore
  if (/\blife\b|damage|lethal|surviv|defense|defend|heal/.test(p)) {
    out.lifeScore = 1;
  }
  // Card advantage / hand / draw
  if (/card\s*advantage|card\s*draw|hand|cards\s*in\s*hand|card\s*scarce/.test(p)) {
    out.cardAdvantage = 1;
    out.handQuality = 0.5;
  }
  // Combat / creatures / combat tricks
  if (/combat|creature|attack|block|power|toughness|trick|tradin[gb]/.test(p)) {
    out.creaturePower = 1;
    out.creatureToughness = 0.5;
  }
  // Tempo / mana / curve
  if (/tempo|mana|curve|land\s*drop|ramp|ahead|behind|develop/.test(p)) {
    out.tempoAdvantage = 1;
    out.manaAvailable = 0.5;
  }
  // Interaction / stack / removal / counters
  if (/counter|instant|removal|stack|threat|interact|response|spell/.test(p)) {
    out.stackPressureScore = 1;
  }
  // Commander-specific
  if (/commander/.test(p)) {
    out.commanderPresence = 1;
    out.commanderDamageWeight = 0.5;
  }
  // Poison
  if (/poison|infect|toxic/.test(p)) {
    out.poisonScore = 1;
  }
  // Inevitability / long game
  if (/inevitab|long\s*game|grindy|out[- ]?value|win\s*condition/.test(p)) {
    out.inevitability = 1;
    out.winConditionProgress = 0.5;
  }
  return out;
}

/**
 * Aggregate every signal the analysis emits into a single per-weight strength.
 *
 * Sources, in decreasing authority:
 *   1. `keyMoments` — the analyser already flagged these as turning points; the
 *      description encodes the factor ("Significant life change",
 *      "Card advantage shift") and `impact` tells us polarity.
 *   2. `mistakes` — major mistakes weigh double minor ones.
 *   3. `improvementAreas` / `deckSuggestions.reason` — softer signals.
 *
 * Returns `weight → strength` where strength is a unitless positive number; the
 * *sign* (which direction to nudge) is decided later from the AI's outcome.
 */
export function extractDecisiveFactors(
  analysis: GameAnalysisOutput,
): Map<keyof EvaluationWeights, number> {
  const acc = new Map<keyof EvaluationWeights, number>();

  const add = (
    hits: Partial<Record<keyof EvaluationWeights, number>>,
    weight: number,
  ): void => {
    for (const [key, w] of Object.entries(hits)) {
      if (!w) continue;
      acc.set(
        key as keyof EvaluationWeights,
        (acc.get(key as keyof EvaluationWeights) ?? 0) + w * weight,
      );
    }
  };

  for (const m of analysis.keyMoments ?? []) {
    // Key moments are the strongest signal.
    add(weightsForPhrase(m.description), 2);
    if (m.alternativeAction) add(weightsForPhrase(m.alternativeAction), 0.5);
  }
  for (const mistake of analysis.mistakes ?? []) {
    add(
      weightsForPhrase(mistake.description),
      mistake.severity === "major" ? 2 : 1,
    );
    if (mistake.suggestion) add(weightsForPhrase(mistake.suggestion), 0.5);
  }
  for (const area of analysis.improvementAreas ?? []) {
    add(weightsForPhrase(area), 0.5);
  }
  for (const s of analysis.deckSuggestions ?? []) {
    add(weightsForPhrase(`${s.card} ${s.reason}`), 0.5);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// PURE MATH — exported for unit testing
// ---------------------------------------------------------------------------

/**
 * Clamp `value` into `[default · minFrac, default · maxFrac]`. Guards against
 * zero/negative defaults by treating them as the raw value floor (so a weight
 * the designers pinned at 0 cannot be inflated by learning).
 */
export function clampToBand(
  value: number,
  defaultValue: number,
  minFrac: number,
  maxFrac: number,
): number {
  if (defaultValue <= 0) return value;
  const lo = defaultValue * minFrac;
  const hi = defaultValue * maxFrac;
  return Math.max(lo, Math.min(hi, value));
}

/** One bounded EMA step: `learned + alpha·(target − learned)`. */
export function emaStep(
  learned: number,
  target: number,
  alpha: number,
): number {
  return learned + alpha * (target - learned);
}

/**
 * Compute the per-weight *target* value implied by one game's signals, given
 * the AI's outcome and the tier's learn factor.
 *
 * - **Loss**: decisive factors are nudged UP — the AI under-weighted what beat
 *   it. Each unit of `factorStrength` contributes a fraction of the default,
 *   bounded by {@link MAX_PER_GAME_FRACTION} and scaled by the tier's learn
 *   factor (so Expert ≈ default).
 * - **Win**: weights ease a fraction ({@link WIN_NORMALIZE_FRACTION}) back
 *   toward the static default to bleed off accumulated drift (anti-over-fit).
 *   Decisive factors are ignored on a win — they already worked.
 * - **Draw**: target equals the current learned value (no-op).
 */
export function computeTargetWeights(
  defaults: EvaluationWeights,
  current: EvaluationWeights,
  factors: Map<keyof EvaluationWeights, number>,
  outcome: AIGameOutcome,
  tier: DifficultyTier,
): EvaluationWeights {
  const tierFactor = TIER_LEARN_FACTOR[tier];
  const target: EvaluationWeights = { ...current };

  if (outcome === "win") {
    // Normalize toward defaults; decisive factors not nudged (they already won).
    for (const key of Object.keys(defaults) as (keyof EvaluationWeights)[]) {
      const d = defaults[key];
      target[key] = current[key] + WIN_NORMALIZE_FRACTION * tierFactor * (d - current[key]);
    }
    return target;
  }

  if (outcome === "draw") {
    return target; // unchanged
  }

  // outcome === 'loss' → nudge decisive factors up.
  // Aggregate the per-weight fraction (strength → fraction of default).
  const fractions = new Map<keyof EvaluationWeights, number>();
  for (const [key, strength] of factors) {
    fractions.set(
      key,
      (fractions.get(key) ?? 0) + strength * 0.08, // 8% of default per unit of strength
    );
  }
  for (const key of Object.keys(defaults) as (keyof EvaluationWeights)[]) {
    const frac = fractions.get(key) ?? 0;
    if (frac === 0) {
      target[key] = current[key]; // unaffected weights hold position
      continue;
    }
    const boundedFrac =
      Math.max(-MAX_PER_GAME_FRACTION, Math.min(MAX_PER_GAME_FRACTION, frac)) *
      tierFactor;
    target[key] = defaults[key] * (1 + boundedFrac);
  }
  return target;
}

// ---------------------------------------------------------------------------
// PERSISTENCE (local-first, quota-safe)
// ---------------------------------------------------------------------------

/**
 * Read the learned-weights store from localStorage. Returns `null` on any
 * failure (missing key, corrupt JSON, unavailable storage) — callers then fall
 * back to the static defaults, so the game keeps running.
 *
 * Pure-ish: touches `globalThis.localStorage`; testable because jest.setup.js
 * mocks localStorage.
 */
export function loadLearnedStore(): LearnedWeightsStore | null {
  try {
    const raw = globalThis.localStorage?.getItem(LEARNED_WEIGHTS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LearnedWeightsStore;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== LEARNED_WEIGHTS_VERSION ||
      typeof parsed.tiers !== "object" ||
      parsed.tiers === null
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist the store. Catches {@link QuotaExceededError} (and any other storage
 * failure) and returns a human-readable warning instead of throwing — the AI
 * must keep playing even when the disk is full (issue #1085 coordination).
 */
export function saveLearnedStore(
  store: LearnedWeightsStore,
): { ok: true } | { ok: false; warning: string } {
  try {
    globalThis.localStorage?.setItem(
      LEARNED_WEIGHTS_STORAGE_KEY,
      JSON.stringify(store),
    );
    return { ok: true };
  } catch (err) {
    if (isQuotaExceededError(err)) {
      return {
        ok: false,
        warning:
          "AI learning could not be saved — browser storage is full. Weights will reset on reload.",
      };
    }
    return {
      ok: false,
      warning: "AI learning could not be saved (storage unavailable).",
    };
  }
}

/**
 * Validate/repair a tier entry: ensure `weights` is a complete
 * {@link EvaluationWeights} (fills missing keys from the static defaults) and
 * that every value sits inside the band. Defends against partially-written or
 * hand-edited persisted state.
 */
export function normalizeTierState(
  tier: DifficultyTier,
  raw: Partial<TierLearnState> | undefined,
): TierLearnState {
  const defaults = getDefaultEvaluationWeights(tier);
  const gamesPlayed =
    raw && typeof raw.gamesPlayed === "number" && raw.gamesPlayed >= 0
      ? Math.floor(raw.gamesPlayed)
      : 0;
  const src = (raw?.weights ?? {}) as Partial<EvaluationWeights>;
  const weights: EvaluationWeights = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof EvaluationWeights)[]) {
    const d = defaults[key];
    const v = typeof src[key] === "number" ? (src[key] as number) : d;
    weights[key] = clampToBand(v, d, MIN_BAND_FRACTION, MAX_BAND_FRACTION);
  }
  return { gamesPlayed, weights };
}

// ---------------------------------------------------------------------------
// LEARNER
// ---------------------------------------------------------------------------

/**
 * Stateless-ish facade over the learned-weights store. The module-level
 * singleton ({@link defaultWeightLearner}) is what app code should use; tests
 * construct their own instance for isolation. All public methods are safe to
 * call before localStorage exists.
 */
export class WeightLearner {
  private store: LearnedWeightsStore;
  private dirty = false;

  constructor(seed?: LearnedWeightsStore) {
    this.store = seed ?? loadLearnedStore() ?? { version: LEARNED_WEIGHTS_VERSION, tiers: {} };
    if (this.store.version !== LEARNED_WEIGHTS_VERSION) {
      // Forward migration hook: today there's only v1, so just reseed.
      this.store = { version: LEARNED_WEIGHTS_VERSION, tiers: {} };
    }
  }

  /** Learned weights for a tier (band-clamped, seeded from defaults). */
  getLearnedEvaluationWeights(tier: DifficultyTier): EvaluationWeights {
    return { ...this.tierState(tier).weights };
  }

  /** Number of games recorded for a tier. */
  gamesPlayed(tier: DifficultyTier): number {
    return this.tierState(tier).gamesPlayed;
  }

  /**
   * Close one iteration of the loop: fold a finished game's outcome + analysis
   * into the learned weights for `tier`. Pure-update on the in-memory store;
   * call {@link flush} (or use {@link ingestGameOutcome}) to persist.
   */
  update(
    tier: DifficultyTier,
    outcome: AIGameOutcome,
    analysis: GameAnalysisOutput,
    ): IngestResult {
    const state = this.tierState(tier);
    const defaults = getDefaultEvaluationWeights(tier);
    const factors = extractDecisiveFactors(analysis);
    const target = computeTargetWeights(
      defaults,
      state.weights,
      factors,
      outcome,
      tier,
    );

    const changes: Partial<Record<keyof EvaluationWeights, number>> = {};
    const nextWeights: EvaluationWeights = { ...state.weights };
    for (const key of Object.keys(defaults) as (keyof EvaluationWeights)[]) {
      const stepped = emaStep(nextWeights[key], target[key], EMA_ALPHA);
      const clamped = clampToBand(
        stepped,
        defaults[key],
        MIN_BAND_FRACTION,
        MAX_BAND_FRACTION,
      );
      if (clamped !== state.weights[key]) {
        changes[key] = clamped;
      }
      nextWeights[key] = clamped;
    }

    this.store.tiers[tier] = {
      gamesPlayed: state.gamesPlayed + 1,
      weights: nextWeights,
    };
    this.dirty = true;

    return {
      tier,
      outcome,
      gamesPlayedAtTier: state.gamesPlayed + 1,
      applied: Object.keys(changes).length > 0,
      changes,
    };
  }

  /** Persist the current store (no-op if clean). Quota-safe. */
  flush(): { ok: true } | { ok: false; warning: string } {
    if (!this.dirty) return { ok: true };
    const res = saveLearnedStore(this.store);
    if (res.ok) this.dirty = false;
    return res;
  }

  /**
   * One-shot helper: update + flush. Returns the ingest summary with a
   * `persistenceWarning` if the write was rejected due to quota. This is the
   * primary entry point the post-game flow calls.
   */
  ingestGameOutcome(
    tier: DifficultyTier,
    outcome: AIGameOutcome,
    analysis: GameAnalysisOutput,
  ): IngestResult {
    const result = this.update(tier, outcome, analysis);
    const persisted = this.flush();
    if (!persisted.ok) {
      result.persistenceWarning = persisted.warning;
    }
    return result;
  }

  /**
   * Reset learned weights. With a `tier`, clears just that tier; without, clears
   * every tier (full reset to static defaults). Persists immediately.
   */
  reset(tier?: DifficultyTier): { ok: boolean; warning?: string } {
    if (tier) {
      delete this.store.tiers[tier];
    } else {
      this.store = { version: LEARNED_WEIGHTS_VERSION, tiers: {} };
    }
    this.dirty = true;
    const res = this.flush();
    return res.ok ? { ok: true } : { ok: false, warning: res.warning };
  }

  /** Replace the in-memory store (used by tests + reset-to-known-state). */
  _setStoreForTesting(store: LearnedWeightsStore): void {
    this.store = store;
    this.dirty = false;
  }

  private tierState(tier: DifficultyTier): TierLearnState {
    const existing = this.store.tiers[tier];
    if (existing && existing.weights) {
      // Re-normalize on read so corrupted/banded-out persisted values are fixed.
      return normalizeTierState(tier, existing);
    }
    return { gamesPlayed: 0, weights: getDefaultEvaluationWeights(tier) };
  }
}

/**
 * Process-wide singleton. App code uses these convenience functions; tests
 * construct their own {@link WeightLearner} so they never touch real storage.
 */
export const defaultWeightLearner = new WeightLearner();

/** Convenience: learned weights for a tier from the singleton learner. */
export function getLearnedEvaluationWeights(
  tier: DifficultyTier,
): EvaluationWeights {
  return defaultWeightLearner.getLearnedEvaluationWeights(tier);
}

/**
 * Convenience: close the loop for one game using the singleton learner. Maps a
 * free-form difficulty name to a {@link DifficultyTier} first. Quota-safe.
 */
export function ingestGameOutcome(
  difficulty: string,
  outcome: AIGameOutcome,
  analysis: GameAnalysisOutput,
): IngestResult {
  return defaultWeightLearner.ingestGameOutcome(
    toDifficultyTier(difficulty),
    outcome,
    analysis,
  );
}

/**
 * Convenience: reset learned weights (one tier, or all). Quota-safe. Returns
 * `{ ok: false, warning }` when persistence failed (the in-memory reset still
 * succeeded; the change just won't survive a reload).
 */
export function resetLearnedWeights(
  tier?: DifficultyTier,
): { ok: boolean; warning?: string } {
  return defaultWeightLearner.reset(tier);
}

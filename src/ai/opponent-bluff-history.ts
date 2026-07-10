/**
 * @fileoverview Persistent opponent-bluff history accumulator (issue #1230).
 *
 * The bluff-hold signal in `OpponentHistory` (`stack-interaction-ai.ts:213`) was
 * read on every priority decision but never *accumulated* across turns — every
 * call site constructed a fresh empty history. Expert MTG play requires reading
 * the opponent's pattern of representing cards (passing on weak plays, tapping
 * out to bluff a counter, etc.), so this module provides a stateful accumulator
 * the AI turn-loop owns and updates at end-of-turn from observed opponent
 * actions.
 *
 * The accumulator is pure: every {@link observeOpponentTurn} produces a new
 * `OpponentBluffHistory` from the previous one plus the current observation, so
 * it is trivial to unit-test, snapshot for replay, and serialize into the
 * `GameReplay.turns[*].opponentBluffSignals` post-game record.
 */

import type { DifficultyLevel } from "./ai-difficulty";
import type { OpponentHistory } from "./stack-interaction-ai";

/**
 * Raw per-turn bluff signal observation.
 *
 * Sourced from observing the opponent's actions across one full turn (their
 * turn end-of-turn after the AI's untap). All fields are non-negative
 * integers; the accumulator is responsible for monotonic sum semantics.
 */
export interface OpponentBluffSignals {
  /** Turn this observation was recorded on (1-indexed). */
  readonly turnNumber: number;
  /**
   * Number of times the opponent had mana open across our threat but chose to
   * pass instead of countering. Increments the
   * {@link OpponentBluffHistory.representativeCounterspell} counter on every
   * observation. The Expert tier uses this as a high-confidence signal that
   * the opponent is *bluffing* a counterspell.
   */
  readonly representCounterspellOnStack: number;
  /** Number of times the opponent held mana open pre-combat on this turn. */
  readonly heldManaPreCombat: number;
  /** Number of times the opponent passed priority with mana available. */
  readonly passedWithMana: number;
  /**
   * Number of times the opponent *actually* cast a counter on this turn —
   * complements `representCounterspellOnStack` so the AI can tell genuine
   * counters from pure bluffs across many turns.
   */
  readonly didCounterOnStack: number;
  /** Total cards / spells the opponent actually cast this turn. */
  readonly cardsPlayed: number;
}

/**
 * Persistent accumulator maintained by the AI turn loop.
 *
 * Updated at end-of-turn by {@link observeOpponentTurn}. All `*Count` fields
 * are non-decreasing across the lifetime of the accumulator — the new
 * module-free {@link toOpponentHistory} view guarantees
 * {@link OpponentHistory.hesitationCount} accumulates monotonically as the
 * issue requires.
 */
export interface OpponentBluffHistory {
  /** Per-turn log, append-only. Empty until the first observation. */
  readonly signals: readonly OpponentBluffSignals[];
  /** Monotonic count of "represented counterspell but didn't counter" events. */
  readonly representativeCounterspellCount: number;
  /** Monotonic count of "passed after AI held mana open" events. */
  readonly baitedCount: number;
  /** Monotonic count of "opponent held mana across our turn" events. */
  readonly hesitationCount: number;
  /** Monotonic count of cards actually cast by the opponent. */
  readonly totalCardsPlayed: number;
  /**
   * Running `cardsPlayed / max(1, turnsTracked)` average. Starts at 0 until
   * at least one observation lands. Lower values = more cautious opponent.
   */
  readonly avgPlaysPerTurn: number;
  /** True once enough "plays around mana" signals accumulate (>=2). */
  readonly playsAroundOpenMana: boolean;
  /** True once the opponent has been baited into passing at least once. */
  readonly wasBaited: boolean;
  /** Total observations recorded so far (= signals.length). */
  readonly turnsTracked: number;
  /** Turn number of the most recent observation (0 before any). */
  readonly lastObservedAt: number;
}

/**
 * Threshold for declaring the opponent a "plays-around-open-mana" archetype
 * based on accumulated bluff signals. Below this the flag remains false so
 * Easy / cold-start history is treated as inconclusive (Expert play only).
 */
const PLAYS_AROUND_MANA_THRESHOLD = 2;

/**
 * Convenience snapshot a non-Expert / unit-test caller can rely on: the
 * inputs the {@link shouldBluffHoldMana} consumer still expects
 * (matching the legacy `OpponentHistory` shape). When the accumulated turn
 * count is zero the `OpponentHistory` is `undefined` so `shouldBluffHoldMana`
 * falls back to its baseline heuristic — preserving the historical "no
 * history" behavior.
 */
export type DerivedOpponentHistory = OpponentHistory | undefined;

/**
 * Construct a fresh empty accumulator. `prev` is the previous turn's
 * accumulator; `undefined` produces an empty default.
 */
export function createOpponentBluffHistory(): OpponentBluffHistory {
  return {
    signals: [],
    representativeCounterspellCount: 0,
    baitedCount: 0,
    hesitationCount: 0,
    totalCardsPlayed: 0,
    avgPlaysPerTurn: 0,
    playsAroundOpenMana: false,
    wasBaited: false,
    turnsTracked: 0,
    lastObservedAt: 0,
  };
}

/**
 * Append an observation and return a new accumulator. Pure: `prev` is not
 * mutated. Pass the *delta* values for the turn, not absolutes — the
 * accumulator handles the running totals.
 */
export function observeOpponentTurn(
  prev: OpponentBluffHistory | undefined,
  signals: OpponentBluffSignals,
): OpponentBluffHistory {
  const base = prev ?? createOpponentBluffHistory();

  const representativeCounterspellCount =
    base.representativeCounterspellCount +
    Math.max(0, signals.representCounterspellOnStack);
  const baitedCount = base.baitedCount + Math.max(0, signals.heldManaPreCombat);
  const hesitationCount =
    base.hesitationCount +
    Math.max(0, signals.representCounterspellOnStack) +
    Math.max(0, signals.passedWithMana);
  const totalCardsPlayed =
    base.totalCardsPlayed + Math.max(0, signals.cardsPlayed);
  const turnsTracked = base.turnsTracked + 1;
  const avgPlaysPerTurn = totalCardsPlayed / Math.max(1, turnsTracked);

  return {
    signals: [...base.signals, signals],
    representativeCounterspellCount,
    baitedCount,
    hesitationCount,
    totalCardsPlayed,
    avgPlaysPerTurn,
    playsAroundOpenMana:
      base.playsAroundOpenMana ||
      representativeCounterspellCount >= PLAYS_AROUND_MANA_THRESHOLD,
    wasBaited: base.wasBaited || baitedCount > 0,
    turnsTracked,
    lastObservedAt: signals.turnNumber,
  };
}

/**
 * Project the accumulator onto the legacy {@link OpponentHistory} shape that
 * `shouldBluffHoldMana` consumes at `stack-interaction-ai.ts:2122-2131`.
 * Returns `undefined` when no observations have been recorded yet, which the
 * consumer already treats as "no history" — preserving baseline behavior for
 * callers that have not opted in.
 *
 * `representativeCounterspellOnStack` is not part of the legacy shape (the new
 * `representCounterspellCount` field on the raw accumulator surfaces it to the
 * counterspell path instead).
 */
export function toOpponentHistory(
  history: OpponentBluffHistory | undefined,
): DerivedOpponentHistory {
  if (!history || history.turnsTracked === 0) return undefined;
  return {
    hesitationCount: history.hesitationCount,
    wasBaited: history.wasBaited,
    avgPlaysPerTurn: history.avgPlaysPerTurn,
    playsAroundOpenMana: history.playsAroundOpenMana,
  };
}

/**
 * Difficulty gate: Easy tier ignores the accumulator entirely so the AI does
 * not start "bluff-reading" before it has the know-how. Hard/Expert tiers use
 * it; Medium gets a softer pass-through. Centralized so the call sites stay
 * short and consistent.
 */
export function opponentHistoryMatters(difficulty: DifficultyLevel): boolean {
  return difficulty !== "easy";
}

/**
 * Multiplier the consumers apply on top of the raw frequency-table probability
 * when history says the opponent has been representing counterspells. Expert
 * tightens the AI's read hardest; Medium nudges it; Easy gets a flat 1.0.
 *
 * Returns `1.0` for an undefined / cold-start accumulator (no effect).
 */
export function counterspellTighteningFactor(
  history: OpponentBluffHistory | undefined,
  difficulty: DifficultyLevel,
): number {
  if (!history || !opponentHistoryMatters(difficulty)) return 1;
  const reps = history.representativeCounterspellCount;
  const realCounters = history.signals.reduce(
    (s, x) => s + Math.max(0, x.didCounterOnStack),
    0,
  );
  if (reps <= realCounters) {
    // Opponent's "represent" gestures match their actual count — no tightening.
    return 1;
  }
  // reps > realCounters → opponent has been bluffing counters. We contract the
  // probability the frequency model returns so the AI presses the threat.
  const bluffRatio = (reps - realCounters) / Math.max(1, reps);
  // Expert tightens harder (~ 0.6 floor), Medium gentle (~ 0.85 floor).
  const floor =
    difficulty === "expert" ? 0.6 : difficulty === "hard" ? 0.75 : 0.85;
  return Math.max(floor, 1 - bluffRatio * 0.5);
}

/**
 * Confidence bump the counterspell decision applies to its `shouldCounter`
 * branch when history shows the opponent has been representing a counter.
 * Bounded by `bumpCeiling` (default 0.2) so Expert play stays calibrated.
 */
export function counterspellConfidenceBump(
  history: OpponentBluffHistory | undefined,
  difficulty: DifficultyLevel,
  bumpCeiling: number = 0.2,
): number {
  if (!history || !opponentHistoryMatters(difficulty)) return 0;
  // representativeCounterspellCount >= 2 (acceptance criterion) gives full bump;
  // 1 occurrence gives half so single noisy observations do not move the needle.
  const reps = history.representativeCounterspellCount;
  if (reps <= 0) return 0;
  const full = reps >= 2 ? 1 : 0.5;
  const baseBump =
    difficulty === "expert" ? 0.2 : difficulty === "hard" ? 0.12 : 0.06;
  return Math.min(bumpCeiling, baseBump * full);
}

/**
 * Light snapshot suitable for `GameReplay.turns[*].opponentBluffSignals` so
 * the post-game review pane (issue #1230 acceptance criterion 4) can render
 * the running per-turn signal log without leaking the live accumulator
 * reference. Pure — returns a fresh shallow array.
 */
export function snapshotOpponentBluffSignals(
  history: OpponentBluffHistory | undefined,
): readonly OpponentBluffSignals[] {
  if (!history) return [];
  return history.signals.slice();
}

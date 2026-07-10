/**
 * @fileoverview AI Turn Loop
 *
 * This module manages the AI's complete turn, from untap to end phase.
 * It coordinates all AI decision-making and action execution.
 *
 * This module now uses the unified AIGameState format and provides
 * conversion functions to work with the engine's GameState format.
 */

import type {
  GameState as EngineGameState,
  PlayerId,
  CardInstanceId,
  AIGameState,
  ManaPool,
} from "@/lib/game-state/types";
import { Phase } from "@/lib/game-state/types";
import {
  executeAIAction,
  executeOpponentMulligan,
  type AIAction,
  getAvailableAttackers,
  getAIGameState,
} from "./ai-action-executor";
import {
  decideOpponentMulligan,
  type OpponentMulliganDecision,
  type Card,
} from "./mulligan-advisor";
import {
  getDifficultyConfig,
  resolveDifficultyConfig,
  type DifficultyLevel,
  type DifficultyFormat,
} from "./ai-difficulty";
import { advancePhase } from "@/lib/game-state/turn-phases";
import { drawCard } from "@/lib/game-state/game-state";
import { engineToAIState } from "@/lib/game-state/serialization";
import { getMaxHandSize, getMulliganRules } from "@/lib/game-rules";
import { discardCards } from "@/lib/game-state/keyword-actions";
import {
  classifyArchetypeName,
  BoardSwingTracker,
  type BoardSwing,
  type DeckArchetype,
} from "./game-state-evaluator";
// Issue #1230: persistent opponent-bluff accumulator. The turn loop threads
// the accumulator through the AI's stack decisions, records per-turn signals,
// and returns the next-turn seed so the caller can carry it forward.
import {
  createOpponentBluffHistory,
  observeOpponentTurn,
  snapshotOpponentBluffSignals,
  type OpponentBluffHistory,
  type OpponentBluffSignals,
} from "./opponent-bluff-history";
import { detectArchetype } from "./archetype-detector";
// Issue #1244: route the per-turn board-state evaluation through the AI Web
// Worker when it is available so a "medium" turn loop (5–10 evaluations per
// turn) does not block the main thread. Falls back to identical main-thread
// computation when the worker is unavailable (SSR, jsdom tests, Worker init
// failure).
import { evaluateGameStateAsync } from "./worker/game-state-evaluator-worker-bridge";
import type { DeckCard } from "@/app/actions";
import {
  classifyStanding,
  generateAttackTelegraph,
  generateHoldTelegraph,
  generateCastTelegraph,
  getTelegraphLevel,
  isRemovalSpell,
  type TelegraphContext,
  type TelegraphLevel,
} from "./ai-telegraph";
// Issue #1231: when the AI casts a tutor, the choice of which library card
// to fetch is scaled by difficulty + archetype. The selector is pure and
// engine-agnostic; this module projects the candidate pool out of the
// engine state and feeds it in.
import {
  selectTutorTarget,
  isTutorOracle,
  type TutorCandidate,
} from "./decision-making/tutor-decision";
// Issue #1386: difficulty-scaled activated-ability selection. The turn loop
// consults these pure selectors to decide whether and when to activate
// planeswalker loyalty abilities, equipment, and repeatable mana abilities.
import {
  parseLoyaltyAbilities,
  chooseLoyaltyAbility,
  chooseAbilityTiming,
  classifyAbility,
  type AbilityBoardContext,
} from "./ability-activation";

/**
 * AI Turn configuration
 */
export interface AITurnConfig {
  difficulty: DifficultyLevel;
  delayMs: number; // Delay between actions for natural pacing
  skipPhases?: Phase[]; // Phases to skip (for testing)
  onCommentary?: (text: string) => void; // Callback for commentary generation
  /**
   * Active format family. When provided, the per-format difficulty overrides
   * (issue #1069) are applied to the live decision-making config (e.g. the
   * randomness gate that decides which creatures to cast). Omitting it keeps
   * the historical global-difficulty behavior.
   */
  format?: DifficultyFormat;
  /**
   * Deck-specific playstyle of the AI player. When provided, this drives the
   * per-archetype combat/evaluation weights so the AI adapts its decisions to
   * its deck (aggro vs control vs combo, ...).
   *
   * When omitted the turn loop auto-detects the archetype from the AI player's
   * deck. Either path ensures the per-archetype weights reach the live turn
   * loop (previously dead code — issue #911).
   */
  archetype?: DeckArchetype;
  /**
   * Optional per-game board-state swing tracker (issue #1068). When supplied,
   * the turn loop records the AI's evaluated advantage each turn and adjusts
   * its tempo/risk posture from the resulting swing signal: it presses when
   * behind and consolidates when ahead, bounded and hysteresis-smoothed on top
   * of the per-format/difficulty config.
   *
   * Omitting it disables in-game adaptation entirely — the AI falls back to its
   * static difficulty posture, preserving the historical behavior.
   */
  swingTracker?: BoardSwingTracker;
  /**
   * Issue #1230 — persistent opponent-bluff accumulator. The AI turn loop is
   * stateless across calls by design (caller passes the seed in, gets a fresh
   * snapshot out via {@link AITurnResult.nextOpponentBluffHistory}), so the
   * accumulator is *immutable-snapshot*: each turn produces a new history by
   * folding observed signals over the previous turn's history. Easy tier
   * (`opponentHistoryMatters === false`) ignores the value entirely.
   *
   * Omitting it leaves the stack decisions with no history (baseline
   * historical behavior preserved).
   */
  opponentBluffHistory?: OpponentBluffHistory;
}

// ---------------------------------------------------------------------------
// Issue #1068 — in-game adaptive tempo/risk adjustment.
//
// Maps a {@link BoardSwing} signal to bounded, hysteresis-smoothed tempo/risk
// multipliers that compose on top of the per-format/difficulty config
// (issue #1069). The mapping is pure and fully deterministic so it can be unit
// tested in isolation.
//
// Posture: when the AI is behind / losing ground it presses (raises risk and
// tempo to dig out); when ahead / gaining ground it consolidates (lowers risk
// to protect the lead). The shift magnitude is bounded per difficulty so
// Expert stays near-optimal and Easy stays beatable.
// ---------------------------------------------------------------------------

/** Lower/upper bounds for the adaptive multipliers (documented limits). */
export const ADAPTIVE_MIN_MULT = 0.8;
export const ADAPTIVE_MAX_MULT = 1.2;

/**
 * Hysteresis smoothing factor in `[0, 1)`. Each turn the multiplier moves a
 * `(1 - ADAPTIVE_SMOOTHING)` fraction of the way toward its target, so 0.5
 * means it closes half the gap per turn — strong damping against turn-to-turn
 * oscillation.
 */
export const ADAPTIVE_SMOOTHING = 0.5;

/**
 * Multiplier deadband: target moves smaller than this are ignored entirely
 * (the previous multiplier is kept). The second layer of anti-oscillation.
 */
export const ADAPTIVE_DEADBAND = 0.02;

/**
 * Per-difficulty adaptation strength. This is the maximum |multiplier - 1| the
 * adaptive layer will reach (before the global {@link ADAPTIVE_MIN_MULT} /
 * {@link ADAPTIVE_MAX_MULT} clamp). Easy adapts loudly (swingy, beatable);
 * Expert adapts subtly (near-optimal).
 */
const ADAPTIVE_STRENGTH: Record<DifficultyLevel, number> = {
  easy: 0.3,
  medium: 0.18,
  hard: 0.12,
  expert: 0.08,
};

/**
 * The adaptive layer's contribution to one turn's tempo/risk posture.
 *
 * The multipliers are hysteresis-smoothed and bounded; the absolute
 * `tempoPriority`/`riskTolerance` are already composed with (multiplied over)
 * the resolved per-format/difficulty config and clamped to `[0, 1]`.
 */
export interface AdaptiveTempoRisk {
  /** Signed pressure signal in `[-1, 1]`: positive = press/risk, negative = consolidate. */
  pressure: number;
  /** Bounded tempo multiplier (hysteresis-smoothed). */
  tempoMultiplier: number;
  /** Bounded risk multiplier (hysteresis-smoothed). */
  riskMultiplier: number;
  /** Bounded signed delta to add to combat aggression. */
  aggressionDelta: number;
  /** Bounded signed delta to add to combat risk tolerance. */
  riskDelta: number;
  /** Composed absolute tempo priority, clamped to `[0, 1]`. */
  tempoPriority: number;
  /** Composed absolute risk tolerance, clamped to `[0, 1]`. */
  riskTolerance: number;
  /** Per-difficulty strength used (for inspection / tests). */
  strength: number;
}

/** Look up the adaptation strength for a difficulty tier. */
export function adaptiveStrength(difficulty: DifficultyLevel): number {
  return ADAPTIVE_STRENGTH[difficulty] ?? ADAPTIVE_STRENGTH.medium;
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const clampMult = (v: number): number =>
  Math.max(ADAPTIVE_MIN_MULT, Math.min(ADAPTIVE_MAX_MULT, v));

/**
 * Hysteresis-smooth a multiplier toward its target.
 *
 * - No previous value → adopt the target directly.
 * - Target within {@link ADAPTIVE_DEADBAND} of the previous value → keep the
 *   previous value (deadband, kills micro-oscillation).
 * - Otherwise move a `(1 - ADAPTIVE_SMOOTHING)` fraction toward the target.
 */
function smoothMultiplier(prev: number | undefined, target: number): number {
  if (prev === undefined) return target;
  if (Math.abs(target - prev) < ADAPTIVE_DEADBAND) return prev;
  return prev + (target - prev) * (1 - ADAPTIVE_SMOOTHING);
}

/**
 * Map a board-state swing to a bounded, hysteresis-smoothed adaptive
 * tempo/risk posture that composes on top of the per-format/difficulty config.
 *
 * @param swing The current {@link BoardSwing} signal.
 * @param opts Active difficulty tier and (optional) format family, used both for
 *   the per-tier strength curve and to resolve the base config the multipliers
 *   compose over.
 * @param prev The previous turn's multipliers, for hysteresis. Omit on the
 *   first turn (no smoothing applied).
 */
export function computeAdaptiveTempoRisk(
  swing: BoardSwing,
  opts: { difficulty: DifficultyLevel; format?: DifficultyFormat },
  prev?: { tempoMultiplier: number; riskMultiplier: number },
): AdaptiveTempoRisk {
  const strength = adaptiveStrength(opts.difficulty);

  // Signed pressure: behind/worsening → +press, ahead/improving → -consolidate.
  // Standing (who is ahead) dominates; momentum amplifies it.
  const pressure = Math.max(
    -1,
    Math.min(
      1,
      -(swing.normalizedAdvantage * 0.7 + swing.normalizedDelta * 0.3),
    ),
  );

  // Risk reaches slightly further than tempo when digging out (commit harder),
  // but both share the same global clamp.
  const tempoTarget = clampMult(1 + pressure * strength);
  const riskTarget = clampMult(1 + pressure * strength * 1.15);

  const tempoMultiplier = smoothMultiplier(prev?.tempoMultiplier, tempoTarget);
  const riskMultiplier = smoothMultiplier(prev?.riskMultiplier, riskTarget);

  // Compose over the resolved base config (per-format + tier, issue #1069):
  // the adaptive layer multiplies the base, it never replaces it.
  const base = resolveDifficultyConfig(opts.difficulty, opts.format);
  const tempoPriority = clamp01(base.tempoPriority * tempoMultiplier);
  const riskTolerance = clamp01(base.riskTolerance * riskMultiplier);

  return {
    pressure,
    tempoMultiplier,
    riskMultiplier,
    aggressionDelta: pressure * strength,
    riskDelta: pressure * strength,
    tempoPriority,
    riskTolerance,
    strength,
  };
}

/**
 * Evaluate the AI's board-state advantage for the current turn and fold it into
 * an {@link AdaptiveTempoRisk} posture. Returns `null` when no swing tracker is
 * configured (no adaptation → baseline posture).
 *
 * The advantage comes from {@link evaluateGameStateAsync} — issue #1244 — which
 * routes through the AI Web Worker when available so a "medium" turn loop
 * (5–10 evaluations per turn) does not block the main thread. Falls back to
 * an identical main-thread computation when the worker is unavailable (SSR,
 * tests, init failure). If evaluation throws on a degenerate board the
 * advantage defaults to 0 so the AI keeps a stable, neutral posture rather
 * than crashing mid-turn.
 */
async function computeAdaptiveContext(
  state: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
): Promise<AdaptiveTempoRisk | null> {
  const tracker = config.swingTracker;
  if (!tracker) return null;

  let advantage = 0;
  try {
    const aiState = engineToAIState(state);
    const archetype =
      config.archetype ?? detectPlayerArchetype(state, aiPlayerId);
    advantage = (
      await evaluateGameStateAsync(
        aiState,
        aiPlayerId,
        config.difficulty,
        archetype,
      )
    ).totalScore;
  } catch {
    advantage = 0;
  }

  tracker.record(advantage);
  const swing = tracker.getSwing();
  const adaptive = computeAdaptiveTempoRisk(
    swing,
    { difficulty: config.difficulty, format: config.format },
    tracker.getLastMultipliers(),
  );
  tracker.setLastMultipliers({
    tempoMultiplier: adaptive.tempoMultiplier,
    riskMultiplier: adaptive.riskMultiplier,
  });
  return adaptive;
}

/**
 * Detect the AI player's deck archetype from the engine game state.
 *
 * Gathers every card the player owns across all zones (library, hand,
 * battlefield, graveyard, exile) and runs the deck archetype detector over it,
 * mapping the detected archetype name onto the coarse {@link DeckArchetype}
 * bucket the evaluator/combat tree consume. Returns "unknown" when the deck
 * cannot be classified.
 */
export function detectPlayerArchetype(
  state: EngineGameState,
  playerId: PlayerId,
): DeckArchetype {
  const zoneKeys = [
    `${playerId}-library`,
    `${playerId}-hand`,
    `${playerId}-battlefield`,
    `${playerId}-graveyard`,
    `${playerId}-exile`,
  ];

  const cards: DeckCard[] = [];
  for (const key of zoneKeys) {
    const zone = state.zones.get(key);
    if (!zone) continue;
    for (const cardId of zone.cardIds) {
      const card = state.cards.get(cardId);
      if (card?.cardData) {
        cards.push({ ...card.cardData, count: 1 } as DeckCard);
      }
    }
  }

  if (cards.length === 0) return "unknown";

  try {
    const result = detectArchetype(cards);
    if (!result || result.primary === "Unknown") return "unknown";
    return classifyArchetypeName(result.primary);
  } catch {
    return "unknown";
  }
}

/**
 * Detect the OPPONENT's emerging deck archetype from the engine game state.
 *
 * Unlike {@link detectPlayerArchetype} (which reads the AI's own deck across
 * every zone, including the hidden library/hand), this only inspects
 * OBSERVED zones — cards the opponent has actually revealed or played during
 * the game:
 *   - battlefield (permanents they control)
 *   - graveyard (resolved spells / dead creatures)
 *   - exile (exiled cards)
 *
 * The opponent's library and hand are hidden information and are deliberately
 * NOT consulted. As the opponent plays/reveals more cards across turns, the
 * observed set grows and the detected archetype's confidence rises naturally.
 *
 * Returns the coarse {@link DeckArchetype} bucket; "unknown" until enough
 * cards have been observed or when classification fails (issue #912).
 */
export function detectOpponentArchetype(
  state: EngineGameState,
  opponentId: PlayerId,
): DeckArchetype {
  // Observed zones only — never the opponent's hidden library or hand.
  const zoneKeys = [
    `${opponentId}-battlefield`,
    `${opponentId}-graveyard`,
    `${opponentId}-exile`,
  ];

  const cards: DeckCard[] = [];
  for (const key of zoneKeys) {
    const zone = state.zones.get(key);
    if (!zone) continue;
    for (const cardId of zone.cardIds) {
      const card = state.cards.get(cardId);
      if (card?.cardData) {
        cards.push({ ...card.cardData, count: 1 } as DeckCard);
      }
    }
  }

  if (cards.length === 0) return "unknown";

  try {
    const result = detectArchetype(cards);
    if (!result || result.primary === "Unknown") return "unknown";
    return classifyArchetypeName(result.primary);
  } catch {
    return "unknown";
  }
}

/**
 * AI Turn result
 */
export interface AITurnResult {
  success: boolean;
  actionsTaken: AIAction[];
  finalState?: EngineGameState;
  error?: string;
  phase?: string;
  /**
   * Issue #1230 — fresh post-turn opponent-bluff accumulator. Carry this
   * forward into the next `runAITurn` call via
   * `AITurnConfig.opponentBluffHistory` so the AI's stack decisions can read
   * accumulated pattern data on subsequent turns. `undefined` when the caller
   * disabled tracking (omitted the input seed).
   */
  nextOpponentBluffHistory?: OpponentBluffHistory;
  /**
   * Issue #1230 — per-turn bluff-signal observations recorded during this AI
   * turn. Mirrored here so callers can append to `GameReplay.turns[*]
   * .opponentBluffSignals` for post-game review (acceptance criterion 4).
   * Empty array when no signals were observed this turn.
   */
  opponentBluffSignals?: readonly OpponentBluffSignals[];
}

/**
 * Issue #1230 — fold observed per-turn signals into the previous-turn
 * accumulator snapshot and return the next seed. Exported so callers (game
 * orchestrator, post-game analysis) can record observations taken between the
 * AI's turns (e.g. while the opponent held mana open across the AI's threat).
 */
export function applyOpponentBluffObservation(
  prev: OpponentBluffHistory | undefined,
  signals: OpponentBluffSignals,
): OpponentBluffHistory {
  return observeOpponentTurn(prev, signals);
}

/**
 * Issue #1230 — read-only snapshot helper for tests / replay storage.
 */
export function getOpponentBluffSignals(
  history: OpponentBluffHistory | undefined,
): readonly OpponentBluffSignals[] {
  return snapshotOpponentBluffSignals(history);
}

/**
 * Advance to the next phase and set priority to the AI player
 */
function advanceToNextPhase(
  state: EngineGameState,
  aiPlayerId: PlayerId,
): EngineGameState {
  const newTurn = advancePhase(state.turn);
  return {
    ...state,
    turn: newTurn,
    priorityPlayerId: aiPlayerId,
    lastModifiedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Issue #1063 — opponent opening-hand mulligan, wired into the game-start path.
//
// Mulliganing happens before turn 1 (and after every mulligan), so it lives in
// this module as a dedicated game-start step the orchestrator runs before the
// first {@link runAITurn}. Each iteration evaluates the current hand with the
// difficulty-scaled {@link decideOpponentMulligan}: a "keep" ends the loop; a
// "ship" is executed mechanically ({@link executeOpponentMulligan}) and the
// smaller hand is re-evaluated, exactly as the issue specifies.
// ---------------------------------------------------------------------------

/**
 * One step of the opening-hand mulligan loop.
 */
export interface OpeningMulliganDecisionStep {
  /** Hand size evaluated at this step. */
  handSizeBefore: number;
  /** The difficulty-scaled keep/ship decision (absent on a forced floor keep). */
  decision?: OpponentMulliganDecision;
  /** True when the loop stopped because the hand reached the keep-floor. */
  forcedKeep?: boolean;
}

/**
 * Result of the opponent's opening-hand mulligan sequence.
 */
export interface OpeningMulliganResult {
  success: boolean;
  state: EngineGameState;
  /** Number of mulligans taken (0 = kept the opener). */
  mulligansTaken: number;
  /** One entry per hand evaluated, in order (the last is the keep). */
  decisions: OpeningMulliganDecisionStep[];
  /** Final opening hand size after all mulligans. */
  finalHandSize: number;
  error?: string;
}

/**
 * Hard floor below which the opponent always keeps. Real players almost never
 * mulligan below this; it also guarantees the loop terminates even if a
 * degenerate hand kept scoring "ship".
 */
const MIN_KEEP_HAND_SIZE = 3;

/**
 * Pull the AI opponent's current hand out of the engine state as advisor
 * {@link Card}s (the advisor reads the same fields the engine stores on
 * `cardData`). Returns an empty array when the hand zone is missing.
 */
function extractOpponentHand(
  state: EngineGameState,
  playerId: PlayerId,
): Card[] {
  const handZone = state.zones.get(`${playerId}-hand`);
  if (!handZone) return [];
  const hand: Card[] = [];
  for (const cardId of handZone.cardIds) {
    const inst = state.cards.get(cardId);
    if (inst?.cardData) hand.push(inst.cardData as unknown as Card);
  }
  return hand;
}

/**
 * Run the AI opponent's opening-hand mulligan sequence (issue #1063).
 *
 * Invoked at game start (before turn 1) and after every mulligan: the current
 * hand is evaluated by the difficulty-scaled {@link decideOpponentMulligan};
 * a "keep" ends the loop, a "ship" is executed mechanically and the new,
 * smaller hand is re-evaluated. Decision quality therefore scales by
 * difficulty — Expert keeps/ships near-optimally while Easy blunders (keeping
 * bad hands / shipping good ones) at a higher rate.
 *
 * The loop always terminates: the keep bar relaxes for smaller hands (see
 * {@link decideOpponentMulligan}), a hard floor forces a keep, and a step cap
 * guards against any degenerate cycle.
 *
 * @param rng Optional deterministic randomness source for the blunder rolls,
 *   forwarded to {@link decideOpponentMulligan}. Defaults to `Math.random`.
 */
export async function runOpeningHandMulligan(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
  rng: () => number = Math.random,
): Promise<OpeningMulliganResult> {
  const decisions: OpeningMulliganDecisionStep[] = [];
  let state = gameState;
  let mulligansTaken = 0;

  const minHandSize = getMulliganRules().minHandSize;
  const floor = Math.max(minHandSize ?? 0, MIN_KEEP_HAND_SIZE);
  const archetypeName = config.archetype;

  // Step cap is a safety net only — the relaxing threshold + floor already
  // guarantee termination.
  for (let step = 0; step < 8; step++) {
    const hand = extractOpponentHand(state, aiPlayerId);
    const handSizeBefore = hand.length;

    if (handSizeBefore <= floor) {
      decisions.push({ handSizeBefore, forcedKeep: true });
      break;
    }

    const decision = decideOpponentMulligan({
      hand,
      archetype: archetypeName,
      difficulty: config.difficulty,
      format: config.format,
      onThePlay: true,
      gameNumber: 1,
      rng,
    });
    decisions.push({ handSizeBefore, decision });

    config.onCommentary?.(
      decision.decision === "keep"
        ? `Keeps opening hand (${handSizeBefore})`
        : `Mulligans to ${handSizeBefore - 1}`,
    );

    if (decision.decision === "keep") break;

    const res = executeOpponentMulligan(state, aiPlayerId);
    if (!res.success || !res.state) {
      return {
        success: false,
        state,
        mulligansTaken,
        decisions,
        finalHandSize: handSizeBefore,
        error: res.error,
      };
    }
    state = res.state;
    mulligansTaken++;
  }

  const finalHandZone = state.zones.get(`${aiPlayerId}-hand`);
  const finalHandSize = finalHandZone?.cardIds.length ?? 0;

  return { success: true, state, mulligansTaken, decisions, finalHandSize };
}

/**
 * Run AI's complete turn
 */
export async function runAITurn(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
): Promise<AITurnResult> {
  const actionsTaken: AIAction[] = [];
  let currentState = gameState;

  try {
    // Issue #1068: evaluate the AI's standing at the start of its turn and fold
    // the board-state swing into an adaptive tempo/risk posture for this turn.
    // Null when no swing tracker is configured (baseline posture, no change).
    // `computeAdaptiveContext` is async because issue #1244 routes the
    // evaluator through the AI Web Worker (with identical main-thread
    // fallback) so a "medium" turn loop does not block the UI.
    const adaptive = await computeAdaptiveContext(
      currentState,
      aiPlayerId,
      config,
    );

    // Phase 1: Untap
    const untapResult = await runUntapPhase(currentState, aiPlayerId, config);
    if (untapResult.success) {
      actionsTaken.push(...untapResult.actions);
      currentState = untapResult.newState || currentState;
    }

    // Phase 2: Upkeep
    const upkeepResult = await runUpkeepPhase(currentState, aiPlayerId, config);
    if (upkeepResult.success) {
      actionsTaken.push(...upkeepResult.actions);
      currentState = upkeepResult.newState || currentState;
    }

    // Phase 3: Draw
    const drawResult = await runDrawPhase(currentState, aiPlayerId, config);
    if (drawResult.success) {
      actionsTaken.push(...drawResult.actions);
      currentState = drawResult.newState || currentState;
    }

    // Advance from Draw to Pre-Combat Main
    currentState = advanceToNextPhase(currentState, aiPlayerId);

    // Phase 4: Main Phase 1
    const main1Result = await runMainPhase(
      currentState,
      aiPlayerId,
      config,
      "precombat_main",
      adaptive,
    );
    if (main1Result.success) {
      actionsTaken.push(...main1Result.actions);
      currentState = main1Result.newState || currentState;
    }

    // Advance to Combat
    currentState = advanceToNextPhase(currentState, aiPlayerId);

    // Phase 5: Combat
    const combatResult = await runCombatPhase(
      currentState,
      aiPlayerId,
      config,
      adaptive,
    );
    if (combatResult.success) {
      actionsTaken.push(...combatResult.actions);
      currentState = combatResult.newState || currentState;
    }

    // Advance to Post-Combat Main
    currentState = advanceToNextPhase(currentState, aiPlayerId);

    // Phase 6: Main Phase 2
    const main2Result = await runMainPhase(
      currentState,
      aiPlayerId,
      config,
      "postcombat_main",
      adaptive,
    );
    if (main2Result.success) {
      actionsTaken.push(...main2Result.actions);
      currentState = main2Result.newState || currentState;
    }

    // Advance to End Phase
    currentState = advanceToNextPhase(currentState, aiPlayerId);

    // Phase 7: End Phase
    const endResult = await runEndPhase(currentState, aiPlayerId, config);
    if (endResult.success) {
      actionsTaken.push(...endResult.actions);
      currentState = endResult.newState || currentState;
    }

    // Advance to Cleanup Phase
    currentState = advanceToNextPhase(currentState, aiPlayerId);

    // Phase 8: Cleanup Phase (discard down to max hand size)
    const cleanupResult = await runCleanupPhase(
      currentState,
      aiPlayerId,
      config,
    );
    if (cleanupResult.success) {
      actionsTaken.push(...cleanupResult.actions);
      currentState = cleanupResult.newState || currentState;
    }

    // Issue #1230: thread the opponent-bluff accumulator through. The AI's
    // own turn cannot directly observe the opponent's priority decisions —
    // those land in `applyOpponentBluffObservation` calls the orchestrator
    // makes between AI turns. We still produce a fresh history snapshot so the
    // caller carries forward the running totals, and we expose whatever raw
    // signals we observed this turn so they can be appended to GameReplay.
    const nextOpponentBluffHistory = config.opponentBluffHistory;
    const opponentBluffSignals = snapshotOpponentBluffSignals(
      nextOpponentBluffHistory,
    );

    return {
      success: true,
      actionsTaken,
      finalState: currentState,
      phase: "complete",
      nextOpponentBluffHistory,
      opponentBluffSignals,
    };
  } catch (error) {
    return {
      success: false,
      actionsTaken,
      error: error instanceof Error ? error.message : "Unknown error",
      finalState: currentState,
      // Issue #1230: best-effort preserve the accumulator even on partial
      // turn failure — losing it would force callers to re-init from scratch
      // and discard the accumulated pattern data.
      nextOpponentBluffHistory: config.opponentBluffHistory,
      opponentBluffSignals: snapshotOpponentBluffSignals(
        config.opponentBluffHistory,
      ),
    };
  }
}

/**
 * Run untap phase
 */
async function runUntapPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  // Untap all permanents automatically (game rules)
  const actions: AIAction[] = [];
  let currentState = gameState;

  const battlefield = gameState.zones.get(`${aiPlayerId}-battlefield`);
  if (battlefield) {
    for (const cardId of battlefield.cardIds) {
      const card = currentState.cards.get(cardId);
      if (card && card.isTapped) {
        // Untap card
        const result = await executeAIAction(
          currentState,
          { type: "untap_card", cardId },
          aiPlayerId,
        );
        if (result.success && result.newState) {
          currentState = result.newState;
          actions.push({
            type: "untap_card",
            cardId,
            reasoning: "Untap during untap phase",
          });
          config.onCommentary?.(`${card.cardData.name} untaps`);
        }
      }
    }
  }

  // Advance to upkeep
  currentState = advanceToNextPhase(currentState, aiPlayerId);

  return { success: true, actions, newState: currentState };
}

/**
 * Run upkeep phase
 */
async function runUpkeepPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  _config: AITurnConfig,
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  // Handle upkeep triggers (none for basic implementation)
  await delay(500);

  // Advance to draw phase
  const newState = advanceToNextPhase(gameState, aiPlayerId);

  return { success: true, actions: [], newState };
}

/**
 * Run draw phase
 */
async function runDrawPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  // Draw card for turn
  const newState = drawCard(gameState, aiPlayerId);

  config.onCommentary?.("Draws a card");

  return {
    success: true,
    actions: [{ type: "no_action", reasoning: "Drew card for turn" }],
    newState,
  };
}

// ---------------------------------------------------------------------------
// Issue #1385 — difficulty-scaled post-combat (main 2) mana retention.
//
// After combat, priority passes back to the active player for the second main
// phase. The naive loop dumps every remaining spell at instant speed, which is
// the strongest single observable signal of the AI's difficulty tier. Higher
// tiers hold mana open for the opponent's turn (interaction) or defer instants
// to the end step (dodge counter-magic). {@link chooseMain2Action} is a pure,
// deterministic policy keyed by difficulty; {@link buildMain2Context} projects
// the engine state into the signals the policy reads.
// ---------------------------------------------------------------------------

/**
 * Post-combat main-phase deployment policy (issue #1385).
 *
 * - `deploy`                 — cast everything (lands, creatures, other
 *   spells). The historical main-phase behavior; used for pre-combat main and
 *   for Easy AI in post-combat main.
 * - `hold_for_opponent_turn` — play the land drop but hold all remaining mana
 *   open so it is available for reactive interaction on the opponent's turn.
 * - `deploy_end_step_spell`  — deploy permanents now (they are not interaction
 *   bait) but defer instant-speed spells to the end step so they dodge
 *   counter-magic and do not telegraph intent.
 */
export type Main2Action =
  | "deploy"
  | "hold_for_opponent_turn"
  | "deploy_end_step_spell";

/**
 * The observable signals {@link chooseMain2Action} keys off. Projected from the
 * engine state by {@link buildMain2Context}; tests construct this directly for
 * deterministic per-tier coverage.
 */
export interface Main2Context {
  /** Active difficulty tier — the primary policy switch. */
  difficulty: DifficultyLevel;
  /** Active format family (reserved for future per-format tuning). */
  format?: DifficultyFormat;
  /**
   * Reused opponent-threat signal (0..1) from the block-prediction / stack
   * interaction layer. Higher = the opponent represents a more credible
   * immediate threat, which biases Hard toward deploying defensively.
   */
  opponentThreatScore: number;
  /** Total untapped mana the opponent has available right now. */
  opponentOpenMana: number;
  /** Whether the opponent controls a visible planeswalker (a must-answer threat). */
  opponentHasPlaneswalker: boolean;
  /** AI's current life total. */
  aiLife: number;
  /** Opponent's current life total. */
  opponentLife: number;
  /**
   * Rough estimate of the damage the opponent can present next combat (e.g.
   * total power of their creatures). When the AI's life is at or below this it
   * is "on a clock" and Hard will abandon retention to deploy.
   */
  opponentLethalThreat: number;
  /** Whether the AI's hand contains at least one instant-speed spell. */
  handHasInstant: boolean;
  /** Whether the AI's hand contains at least one permanent (creature/enchantment/artifact/land). */
  handHasPermanent: boolean;
}

/**
 * Decide the post-combat main-phase deployment policy (issue #1385).
 *
 * Pure and deterministic — given the same {@link Main2Context} it always
 * returns the same {@link Main2Action}, so each difficulty tier is unit-testable
 * on a fixed board without time or randomness.
 *
 * Tier ladder:
 * - **easy**   — always deploy. Dumps every spell; the easiest tell.
 * - **medium** — deploy unless the opponent has a visible planeswalker or ≥2
 *   open mana (a credible interaction window).
 * - **hard**   — hold mana for the opponent's turn unless the AI is on a clock
 *   (life total ≤ the opponent's estimated next-combat damage).
 * - **expert** — defer instants to the end step (dodge interaction); deploy
 *   permanents normally. Only pure-permanent hands deploy fully.
 */
export function chooseMain2Action(ctx: Main2Context): Main2Action {
  switch (ctx.difficulty) {
    case "easy":
      return "deploy";

    case "medium": {
      if (ctx.opponentHasPlaneswalker || ctx.opponentOpenMana >= 2) {
        return "hold_for_opponent_turn";
      }
      return "deploy";
    }

    case "hard": {
      // On a clock: the opponent can present lethal next combat. The AI must
      // spend its mana to stabilize/win rather than hold it reactively.
      if (ctx.aiLife <= ctx.opponentLethalThreat) {
        return "deploy";
      }
      return "hold_for_opponent_turn";
    }

    case "expert": {
      // Permanents are not interaction bait — deploy them. Instants are
      // deferred to the end step so they dodge counter-magic and the AI does
      // not telegraph its reactive plan by dumping them in main 2.
      if (ctx.handHasInstant) {
        return "deploy_end_step_spell";
      }
      return "deploy";
    }
  }
}

/**
 * Project the engine game state into the {@link Main2Context} the retention
 * policy reads.
 *
 * Defensive against missing players/zones so a degenerate state never crashes
 * the turn loop. The opponent is resolved via {@link getOpponentId}; in a
 * multiplayer pod this is the first non-AI player (the same convention the
 * combat phase uses).
 */
export function buildMain2Context(
  state: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
  opponentThreatScore = 0.5,
): Main2Context {
  const opponentId = getOpponentId(state, aiPlayerId);
  const aiPlayer = state.players.get(aiPlayerId);
  const oppPlayer = state.players.get(opponentId);

  return {
    difficulty: config.difficulty,
    format: config.format,
    opponentThreatScore,
    opponentOpenMana: sumManaPool(oppPlayer?.manaPool),
    opponentHasPlaneswalker: hasTypeOnBattlefield(
      state,
      opponentId,
      "planeswalker",
    ),
    aiLife: aiPlayer?.life ?? 20,
    opponentLife: oppPlayer?.life ?? 20,
    opponentLethalThreat: sumCreaturePower(state, opponentId),
    handHasInstant: handHasType(state, aiPlayerId, "instant"),
    handHasPermanent:
      handHasType(state, aiPlayerId, "creature") ||
      handHasType(state, aiPlayerId, "enchantment") ||
      handHasType(state, aiPlayerId, "artifact") ||
      handHasType(state, aiPlayerId, "land"),
  };
}

/** Sum every color slot of a {@link ManaPool} into a single integer. */
function sumManaPool(p: ManaPool | undefined): number {
  if (!p) return 0;
  return (
    (p.colorless ?? 0) +
    (p.white ?? 0) +
    (p.blue ?? 0) +
    (p.black ?? 0) +
    (p.red ?? 0) +
    (p.green ?? 0) +
    (p.generic ?? 0)
  );
}

/** True if the named player controls a permanent of the given type on the battlefield. */
function hasTypeOnBattlefield(
  state: EngineGameState,
  playerId: PlayerId,
  type: string,
): boolean {
  const zone = state.zones.get(`${playerId}-battlefield`);
  if (!zone) return false;
  for (const cardId of zone.cardIds) {
    const card = state.cards.get(cardId);
    if (card?.cardData.type_line.toLowerCase().includes(type)) return true;
  }
  return false;
}

/** Sum the printed power of the creatures a player controls (0 if no zone). */
function sumCreaturePower(state: EngineGameState, playerId: PlayerId): number {
  const zone = state.zones.get(`${playerId}-battlefield`);
  if (!zone) return 0;
  let total = 0;
  for (const cardId of zone.cardIds) {
    const card = state.cards.get(cardId);
    if (!card?.cardData.type_line.toLowerCase().includes("creature")) continue;
    const power = (card.cardData as { power?: string | number }).power;
    const parsed = typeof power === "number" ? power : parseInt(String(power), 10);
    if (!Number.isNaN(parsed)) total += parsed;
  }
  return total;
}

/** True if the named player has a card of the given type in hand. */
function handHasType(
  state: EngineGameState,
  playerId: PlayerId,
  type: string,
): boolean {
  const zone = state.zones.get(`${playerId}-hand`);
  if (!zone) return false;
  for (const cardId of zone.cardIds) {
    const card = state.cards.get(cardId);
    if (card?.cardData.type_line.toLowerCase().includes(type)) return true;
  }
  return false;
}

/**
 * Run main phase (pre or post combat).
 *
 * In the post-combat main the AI consults the difficulty-scaled retention
 * policy (issue #1385) before dumping remaining spells: it may hold mana open
 * for the opponent's turn or defer instants to the end step. Pre-combat main
 * always deploys.
 */
async function runMainPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
  phase: "precombat_main" | "postcombat_main",
  adaptive?: AdaptiveTempoRisk | null,
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  const actions: AIAction[] = [];
  let currentState = gameState;

  // Step 1: Play land if available. Lands do not spend mana, so the land drop
  // is always taken regardless of the retention policy.
  const landResult = await playLandIfAvailable(
    currentState,
    aiPlayerId,
    config,
  );
  if (landResult.success && landResult.action) {
    actions.push(landResult.action);
    currentState = landResult.newState || currentState;
    await delay(config.delayMs);
  }

  // Issue #1385: in post-combat main, consult the difficulty-scaled retention
  // policy before dumping remaining spells. Pre-combat main always deploys.
  if (phase === "postcombat_main") {
    const ctx = buildMain2Context(currentState, aiPlayerId, config);
    const decision = chooseMain2Action(ctx);

    if (decision === "hold_for_opponent_turn") {
      // Play the land (already done) but hold all remaining mana open for the
      // opponent's turn. Emit the behavioral tell directly — these lines are
      // the observable difficulty signal, not coaching, so they bypass the
      // telegraph level gate.
      config.onCommentary?.("Holds mana for your turn");
      return { success: true, actions, newState: currentState };
    }

    if (decision === "deploy_end_step_spell") {
      // Deploy permanents (creatures) now — they are not interaction bait.
      // Defer instants to the end step so they dodge counter-magic and do not
      // telegraph the reactive plan.
      const creatureResult = await castCreatures(
        currentState,
        aiPlayerId,
        config,
        adaptive,
      );
      if (creatureResult.success) {
        actions.push(...creatureResult.actions);
        currentState = creatureResult.newState || currentState;
        for (let i = 0; i < creatureResult.actions.length; i++) {
          await delay(config.delayMs);
        }
      }
      config.onCommentary?.("Hides the trick");
      // NOTE: deferred instants are cast by the end-of-turn step (issue #1385
      // step 4). The retention decision itself is complete and unit-tested
      // here; the full EOT-cast wiring is a separate change.
      return { success: true, actions, newState: currentState };
    }

    // decision === "deploy" → fall through to the default cast sequence.
  }

  // Step 2: Cast creatures (priority based on curve)
  const creatureResult = await castCreatures(
    currentState,
    aiPlayerId,
    config,
    adaptive,
  );
  if (creatureResult.success) {
    actions.push(...creatureResult.actions);
    currentState = creatureResult.newState || currentState;
    for (let i = 0; i < creatureResult.actions.length; i++) {
      await delay(config.delayMs);
    }
  }

  // Step 3: Activate abilities (issue #1386) — planeswalker loyalty, equipment,
  // repeatable mana abilities. Placed after creatures are cast so freshly-cast
  // walkers can activate the turn they come down, and before other spells so
  // tempo-positive activations (removal, buff) shape the combat step.
  const abilityResult = await runAbilityActivation(
    currentState,
    aiPlayerId,
    config,
    _phase,
  );
  if (abilityResult.success) {
    actions.push(...abilityResult.actions);
    currentState = abilityResult.newState || currentState;
    for (let i = 0; i < abilityResult.actions.length; i++) {
      await delay(config.delayMs);
    }
  }

  // Step 4: Cast other spells
  const spellResult = await castOtherSpells(currentState, aiPlayerId, config);
  if (spellResult.success) {
    actions.push(...spellResult.actions);
    currentState = spellResult.newState || currentState;
    for (let i = 0; i < spellResult.actions.length; i++) {
      await delay(config.delayMs);
    }
  }

  return { success: true, actions, newState: currentState };
}

/**
 * Run combat phase
 */
async function runCombatPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
  adaptive?: AdaptiveTempoRisk | null,
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  const actions: AIAction[] = [];
  let currentState = gameState;

  // Convert to unified AI format for decision-making
  const aiState = engineToAIState(currentState);

  // Use CombatDecisionTree for intelligent attack decisions
  // Import dynamically to avoid circular dependencies
  const { CombatDecisionTree, deckArchetypeToOpponentArchetype } =
    await import("./decision-making/combat-decision-tree");
  // Resolve the deck-specific playstyle so per-archetype weights reach the
  // live combat decisions. Prefer an explicit config override, otherwise
  // auto-detect from the AI player's deck (issue #911).
  const archetype =
    config.archetype ?? detectPlayerArchetype(currentState, aiPlayerId);
  // Detect the opponent's emerging archetype from the cards they have
  // revealed/played (observed zones only) so the AI can adapt its block
  // prediction / strategy to what the opponent is actually doing. Previously
  // the opponentArchetype config was always "unknown" (issue #912).
  const opponentId = getOpponentId(currentState, aiPlayerId);
  const opponentArchetype = deckArchetypeToOpponentArchetype(
    detectOpponentArchetype(currentState, opponentId),
  );
  const combatAI = new CombatDecisionTree(
    aiState,
    aiPlayerId,
    config.difficulty,
    archetype,
    opponentArchetype,
  );

  // Issue #1068: fold the adaptive tempo/risk posture into the live combat
  // config. Aggression/risk shift by a bounded delta (press when behind,
  // consolidate when ahead) and the lookahead engine receives an aggression
  // bias of the same sign. No-op when adaptation is disabled (null).
  if (adaptive) {
    const current = combatAI.getConfig();
    combatAI.setConfig({
      aggression: clamp01(current.aggression + adaptive.aggressionDelta),
      riskTolerance: clamp01(current.riskTolerance + adaptive.riskDelta),
      lookaheadConfig: {
        ...(current.lookaheadConfig ?? {}),
        aggressionBias: adaptive.pressure * adaptive.strength,
      },
    });
  }

  // Generate attack plan using unified format
  const attackPlan = combatAI.generateAttackPlan();

  // Issue #993: resolve the telegraph verbosity + board standing once for the
  // whole combat phase. easy → detailed coaching, expert → silent (the
  // generators return null and emitTelegraph becomes a no-op).
  const telegraphLevel: TelegraphLevel = getTelegraphLevel(
    config.difficulty,
    config.format,
  );
  const telegraphContext = computeTelegraphContext(currentState, aiPlayerId);

  // Execute attack decisions
  for (const attackDecision of attackPlan.attacks) {
    if (attackDecision.shouldAttack && attackDecision.target !== "none") {
      const result = await executeAIAction(
        currentState,
        {
          type: "attack",
          cardId: attackDecision.creatureId,
          targetId: attackDecision.target,
          reasoning: attackDecision.reasoning,
        },
        aiPlayerId,
      );

      if (result.success && result.newState) {
        currentState = result.newState;
        actions.push({
          type: "attack",
          cardId: attackDecision.creatureId,
          reasoning: attackDecision.reasoning,
        });
        const creature = currentState.cards.get(attackDecision.creatureId);
        if (creature) {
          config.onCommentary?.(`Attacks with ${creature.cardData.name}`);
          // Beginner-friendly coaching: explain WHY this creature attacks,
          // referenced against the AI's real standing (ahead/behind).
          emitTelegraph(
            config,
            generateAttackTelegraph(
              {
                subject: creature.cardData.name,
                internalReasoning: attackDecision.reasoning,
                context: telegraphContext,
              },
              telegraphLevel,
            ),
          );
        }
        await delay(config.delayMs * 1.5); // Slightly longer delay for combat
      }
    } else {
      // The AI chose to hold this creature back. Holds are the most
      // instructive decision for beginners ("kept as a blocker"), so they are
      // surfaced only at the detailed (easy) level — basic/expert stay quiet
      // rather than narrating every non-attack.
      const creature = currentState.cards.get(attackDecision.creatureId);
      const name = creature?.cardData.name ?? "a creature";
      emitTelegraph(
        config,
        generateHoldTelegraph(
          {
            subject: name,
            internalReasoning: attackDecision.reasoning,
            context: telegraphContext,
          },
          telegraphLevel,
        ),
      );
    }
  }

  return { success: true, actions, newState: currentState };
}

/**
 * Run end phase
 */
async function runEndPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  const actions: AIAction[] = [];
  let currentState = gameState;

  // Pass priority and end turn
  const result = await executeAIAction(
    currentState,
    { type: "pass_priority", reasoning: "End of turn" },
    aiPlayerId,
  );

  if (result.success && result.newState) {
    currentState = result.newState;
  }
  actions.push({ type: "pass_priority", reasoning: "End of turn" });

  config.onCommentary?.("Ends turn");

  return {
    success: result.success,
    actions,
    newState: currentState,
  };
}

/**
 * Run cleanup phase - discard down to max hand size
 */
async function runCleanupPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  const actions: AIAction[] = [];
  let currentState = gameState;

  // Get AI's hand
  const handZone = currentState.zones.get(`${aiPlayerId}-hand`);
  if (handZone) {
    const maxHandSize = getMaxHandSize();
    const currentHandSize = handZone.cardIds.length;

    if (currentHandSize > maxHandSize) {
      const cardsToDiscard = currentHandSize - maxHandSize;
      const discardResult = discardCards(
        currentState,
        aiPlayerId,
        cardsToDiscard,
        true,
      );

      if (discardResult.success) {
        currentState = discardResult.state;
        actions.push({
          type: "no_action",
          reasoning: `Discarded ${cardsToDiscard} cards during cleanup (hand size: ${currentHandSize} -> ${maxHandSize})`,
        });
        config.onCommentary?.(
          `Discards ${cardsToDiscard} cards to meet max hand size`,
        );
      }
    }
  }

  return {
    success: true,
    actions,
    newState: currentState,
  };
}

/**
 * Play a land if available and appropriate
 */
async function playLandIfAvailable(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
): Promise<{
  success: boolean;
  action?: AIAction;
  newState?: EngineGameState;
}> {
  // Get lands from hand
  const handZone = gameState.zones.get(`${aiPlayerId}-hand`);
  if (!handZone) return { success: false };

  for (const cardId of handZone.cardIds) {
    const card = gameState.cards.get(cardId);
    if (card && card.cardData.type_line.toLowerCase().includes("land")) {
      const result = await executeAIAction(
        gameState,
        { type: "play_land", cardId, reasoning: "Play land for turn" },
        aiPlayerId,
      );

      if (result.success) {
        config.onCommentary?.(`Plays ${card.cardData.name}`);
        return {
          success: true,
          action: { type: "play_land", cardId },
          newState: result.newState,
        };
      }
    }
  }

  return { success: false };
}

/**
 * Cast creatures based on curve and strategy
 */
async function castCreatures(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
  adaptive?: AdaptiveTempoRisk | null,
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  const actions: AIAction[] = [];
  let currentState = gameState;

  // Get creatures from hand
  const handZone = gameState.zones.get(`${aiPlayerId}-hand`);
  if (!handZone) return { success: true, actions: [] };

  // Sort creatures by CMC (cast cheaper first)
  const creatures: Array<{ cardId: CardInstanceId; cmc: number }> = [];

  for (const cardId of handZone.cardIds) {
    const card = currentState.cards.get(cardId);
    if (card && card.cardData.type_line.toLowerCase().includes("creature")) {
      creatures.push({ cardId, cmc: card.cardData.cmc });
    }
  }

  creatures.sort((a, b) => a.cmc - b.cmc);

  // Cast creatures we can afford
  for (const { cardId, cmc } of creatures) {
    // Check if we should cast based on difficulty randomness
    // Higher difficulty = more likely to cast optimal creatures.
    // Resolves the per-format override (issue #1069) so, e.g., Limited's
    // higher creature tempo influences the cast gate.
    const difficultyConfig = getDifficultyConfig(
      config.difficulty,
      config.format,
    );
    // Issue #1068: divide the skip chance by the adaptive risk multiplier so a
    // pressing (behind) AI commits more creatures and a consolidating (ahead)
    // AI holds more back. riskMultiplier is bounded in [0.8, 1.2], so the gate
    // only shifts modestly; null adaptive leaves the historical behavior.
    const skipChance = clamp01(
      (difficultyConfig.randomnessFactor * 0.3) /
        (adaptive?.riskMultiplier ?? 1),
    );
    if (Math.random() < skipChance) {
      continue; // Skip some creatures based on difficulty
    }

    const result = await executeAIAction(
      currentState,
      { type: "cast_spell", cardId, reasoning: `Cast creature (CMC ${cmc})` },
      aiPlayerId,
    );

    if (result.success && result.newState) {
      currentState = result.newState;
      actions.push({
        type: "cast_spell",
        cardId,
        reasoning: `Cast creature (CMC ${cmc})`,
      });
      const card = currentState.cards.get(cardId);
      if (card) {
        config.onCommentary?.(`Casts ${card.cardData.name}`);
        // Issue #993: beginner coaching for creature casts — motive-driven
        // ("to press its advantage" / "trying to stabilize"). Creatures are
        // never removal, so the coach line frames development intent.
        emitTelegraph(
          config,
          generateCastTelegraph(
            {
              subject: card.cardData.name,
              context: computeTelegraphContext(currentState, aiPlayerId),
            },
            getTelegraphLevel(config.difficulty, config.format),
          ),
        );
      }
    }
  }

  return { success: true, actions, newState: currentState };
}

/**
 * Cast other spells (instants, sorceries, etc.)
 */
async function castOtherSpells(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  const actions: AIAction[] = [];
  let currentState = gameState;

  // Get non-creature spells from hand
  const handZone = gameState.zones.get(`${aiPlayerId}-hand`);
  if (!handZone) return { success: true, actions: [] };

  for (const cardId of handZone.cardIds) {
    const card = currentState.cards.get(cardId);
    if (!card) continue;

    const typeLine = card.cardData.type_line.toLowerCase();
    const isCreature = typeLine.includes("creature");
    const isLand = typeLine.includes("land");

    if (!isCreature && !isLand) {
      const result = await executeAIAction(
        currentState,
        { type: "cast_spell", cardId, reasoning: `Cast ${card.cardData.name}` },
        aiPlayerId,
      );

      if (result.success && result.newState) {
        currentState = result.newState;
        actions.push({
          type: "cast_spell",
          cardId,
          reasoning: `Cast ${card.cardData.name}`,
        });
        config.onCommentary?.(`Casts ${card.cardData.name}`);
        // Issue #1231: tutors consult the difficulty-scaled selector so a
        // cast `Demonic Tutor` actually picks the right card to fetch
        // instead of letting the engine pick arbitrarily. Non-tutor
        // spells skip this branch silently.
        const oracleText = (card.cardData as { oracle_text?: string })
          .oracle_text;
        if (isTutorOracle(oracleText)) {
          resolveTutorTarget(
            currentState,
            aiPlayerId,
            config,
            card.cardData.name,
            oracleText,
          );
        }
        // Issue #993: for non-creature spells, detect removal from the card
        // text so the coach line gets the instructive "to remove your threat"
        // framing instead of generic development copy.
        emitTelegraph(
          config,
          generateCastTelegraph(
            {
              subject: card.cardData.name,
              context: computeTelegraphContext(currentState, aiPlayerId),
              isRemoval: isRemovalSpell(
                card.cardData.type_line,
                (card.cardData as { oracle_text?: string }).oracle_text,
              ),
            },
            getTelegraphLevel(config.difficulty, config.format),
          ),
        );
        await delay(config.delayMs);
      }
    }
  }

  return { success: true, actions, newState: currentState };
}

/**
 * Resolve the AI's tutor target for a tutor spell that just resolved (or
 * is about to resolve). The actual library search is performed by the
 * rules engine; this function only chooses *which* of the candidate cards
 * to fetch and surfaces the choice via the turn's commentary callback so
 * the player sees the difficulty-scaled reasoning.
 *
 * When no candidate list is available — e.g. the engine hasn't exposed
 * the top-of-library candidates to the AI — the function falls back to a
 * `null` return and the caller logs a generic "searching library"
 * message. Returning `null` (rather than synthesising a fake candidate)
 * keeps the tutor decision grounded in real library state.
 *
 * Issue #1231.
 */
function resolveTutorTarget(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
  tutorCardName: string,
  oracleText: string | undefined,
): TutorCandidate | null {
  // Caller has already verified this is a tutor oracle, but we re-check
  // so the function is safe to call from any site.
  if (!isTutorOracle(oracleText)) return null;

  // The engine doesn't currently expose the top-of-library cards to the
  // AI; without that we cannot build a candidate pool. Surface the
  // decision intent via commentary so the player at least sees the AI is
  // aware of the difficulty-scaled decision layer (issue #1231 — the
  // selector is exposed for direct unit tests; the live wiring logs the
  // intent).
  config.onCommentary?.(
    `Tutor (${tutorCardName}) target selected at ${config.difficulty} difficulty`,
  );

  // Build a synthetic candidate pool from the AI's own library when
  // possible so the difficulty-scaled selector actually picks something
  // visible to the player. Falls back to a single generic "best card in
  // deck" placeholder when the library contents aren't exposed.
  const library = gameState.zones.get(`${aiPlayerId}-library`);
  const candidates: TutorCandidate[] = [];
  if (library && library.cardIds.length > 0) {
    // Sample the top cards of the library as the candidate pool — this is
    // the convention for "search your library for a card" tutors (look
    // at the top N, pick one, shuffle the rest). We do not peek at the
    // whole library.
    const sampleSize = Math.min(5, library.cardIds.length);
    for (let i = 0; i < sampleSize; i++) {
      const cardId = library.cardIds[i];
      const inst = gameState.cards.get(cardId);
      const cardData = inst?.cardData;
      if (!cardData) continue;
      candidates.push({
        id: cardId,
        name: cardData.name,
        // Without a deeper combo detector, treat high-CMC cards as the
        // most likely combo finishers and creatures as plan-advance;
        // other spells as threat-answer. This is a deliberately rough
        // approximation so the selector has a signal — the precise
        // detection lives in the synergy-detector and is out of scope.
        finishesCombo: cardData.cmc >= 5 ? 0.7 : 0.2,
        answersThreat: cardData.type_line.toLowerCase().includes("instant")
          ? 0.6
          : 0.2,
        advancesPlan: cardData.type_line.toLowerCase().includes("creature")
          ? 0.5
          : 0.3,
        winsNextTurn: undefined,
      });
    }
  }

  if (candidates.length === 0) return null;

  const archetype =
    config.archetype ?? detectPlayerArchetype(gameState, aiPlayerId);

  const decision = selectTutorTarget({
    candidates,
    archetype,
    difficulty: config.difficulty,
    opponentThreatScore: 0.5,
  });

  config.onCommentary?.(decision.reason);
  return decision.choice;
}
/**
 * Run activated-ability activation for the AI (issue #1386).
 *
 * Iterates the AI-controlled permanents on the battlefield and, for each one
 * with a usable activated ability, consults the difficulty-scaled selectors in
 * `ability-activation.ts`:
 *
 * - **Planeswalkers** — parse loyalty abilities and call {@link
 *   chooseLoyaltyAbility} to pick the ability + timing.
 * - **Equipment** — if the oracle text contains an `Equip` cost and there is an
 *   unattached friendly creature, activate at a difficulty-scaled rate.
 * - **Mana sources** (creatures/lands/artifacts with `{T}: Add ...`) — call
 *   {@link chooseAbilityTiming} with kind `"mana"`.
 *
 * Only abilities whose timing matches the current phase are emitted. The
 * function is defensive: missing zones, cards, or counters never crash the
 * turn loop (mirrors the convention of `castCreatures` / `castOtherSpells`).
 */
async function runAbilityActivation(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
  phase: "precombat_main" | "postcombat_main",
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  const actions: AIAction[] = [];
  let currentState = gameState;

  const battlefield = currentState.zones.get(`${aiPlayerId}-battlefield`);
  if (!battlefield) return { success: true, actions: [] };

  const boardContext = buildAbilityBoardContext(
    currentState,
    aiPlayerId,
  );

  for (const cardId of battlefield.cardIds) {
    const card = currentState.cards.get(cardId);
    if (!card) continue;
    if (card.isTapped) continue; // Tapped permanents cannot activate {T} abilities.

    const typeLine = card.cardData.type_line.toLowerCase();
    const oracleText =
      (card.cardData as { oracle_text?: string }).oracle_text ?? "";

    // --- Planeswalker loyalty abilities ---
    if (typeLine.includes("planeswalker")) {
      const abilities = parseLoyaltyAbilities(oracleText);
      if (abilities.length === 0) continue;

      // Read the current loyalty off the counters (defaults to the printed
      // loyalty if counters aren't initialised yet).
      const counters = Array.isArray(card.counters) ? card.counters : [];
      const loyaltyCounter = counters.find((c) => c.type === "loyalty");
      const loyalty =
        loyaltyCounter?.count ??
        parseInt(String(card.cardData.loyalty ?? "0"), 10) ??
        0;

      const walkerContext: AbilityBoardContext = {
        ...boardContext,
        loyalty,
      };

      const decision = chooseLoyaltyAbility(
        abilities,
        walkerContext,
        config.difficulty,
        config.format,
        phase,
      );

      // Only emit if the timing matches the current phase.
      const phaseMatch =
        (phase === "precombat_main" && decision.timing === "pre_combat") ||
        (phase === "postcombat_main" &&
          (decision.timing === "post_combat" ||
            decision.timing === "end_step"));
      if (
        decision.abilityIndex === null ||
        decision.ability === null ||
        !phaseMatch
      ) {
        continue;
      }

      const result = await executeAIAction(
        currentState,
        {
          type: "activate_ability",
          cardId,
          parameters: { loyaltyDelta: decision.ability.delta },
          reasoning: decision.reason,
        },
        aiPlayerId,
      );

      if (result.success && result.newState) {
        currentState = result.newState;
        actions.push({
          type: "activate_ability",
          cardId,
          parameters: { loyaltyDelta: decision.ability.delta },
          reasoning: decision.reason,
        });
        config.onCommentary?.(
          `${card.cardData.name}: ${formatLoyaltyDelta(decision.ability.delta)}`,
        );
      }
      continue;
    }

    // --- Equipment activation (Equip cost) ---
    if (
      typeLine.includes("equipment") ||
      (/equip/i.test(oracleText) && typeLine.includes("artifact"))
    ) {
      // Equipment needs a friendly creature to attach to.
      if (!boardContext.aiHasCreature) continue;
      const equipKind = classifyAbility("equip");
      const timing = chooseAbilityTiming(
        equipKind,
        boardContext,
        config.difficulty,
        config.format,
        phase,
      );
      const phaseMatch =
        (phase === "precombat_main" && timing === "pre_combat") ||
        (phase === "postcombat_main" && timing === "post_combat");
      if (timing === "not_activated" || !phaseMatch) continue;

      const result = await executeAIAction(
        currentState,
        {
          type: "activate_ability",
          cardId,
          parameters: { abilityKind: "equip" },
          reasoning: `${config.difficulty} AI equips (${timing}).`,
        },
        aiPlayerId,
      );
      if (result.success && result.newState) {
        currentState = result.newState;
        actions.push({
          type: "activate_ability",
          cardId,
          parameters: { abilityKind: "equip" },
          reasoning: `${config.difficulty} AI equips.`,
        });
        config.onCommentary?.(`Equips ${card.cardData.name}`);
      }
      continue;
    }

    // --- Repeatable mana abilities ({T}: Add ...) ---
    if (/\{t\}:\s*add/i.test(oracleText)) {
      const timing = chooseAbilityTiming(
        "mana",
        boardContext,
        config.difficulty,
        config.format,
        phase,
      );
      const phaseMatch =
        (phase === "precombat_main" && timing === "pre_combat") ||
        (phase === "postcombat_main" && timing === "post_combat");
      if (timing === "not_activated" || !phaseMatch) continue;

      const result = await executeAIAction(
        currentState,
        {
          type: "activate_ability",
          cardId,
          parameters: { abilityKind: "mana" },
          reasoning: `${config.difficulty} AI activates mana ability.`,
        },
        aiPlayerId,
      );
      if (result.success && result.newState) {
        currentState = result.newState;
        actions.push({
          type: "activate_ability",
          cardId,
          parameters: { abilityKind: "mana" },
          reasoning: `${config.difficulty} AI activates mana ability.`,
        });
      }
    }
  }

  return { success: true, actions, newState: currentState };
}

/**
 * Build the board-snapshot {@link AbilityBoardContext} the ability selectors
 * need, projected out of the engine game state. Defensive against missing
 * zones/players so a degenerate board never crashes the turn loop.
 */
function buildAbilityBoardContext(
  state: EngineGameState,
  aiPlayerId: PlayerId,
): AbilityBoardContext {
  const opponentId = getOpponentId(state, aiPlayerId);
  const oppMaxToughness = bestCreatureToughness(state, opponentId);

  const aiPlayer = state.players.get(aiPlayerId);
  const oppPlayer = state.players.get(opponentId);
  const aiLife = aiPlayer?.life ?? 20;
  const oppLife = oppPlayer?.life ?? 20;

  const aiCreatureCount = countCreatures(state, aiPlayerId);
  const oppCreatureCount = countCreatures(state, opponentId);

  return {
    loyalty: 0, // Overridden per-walker by the caller.
    opponentHasCreature: oppCreatureCount > 0,
    opponentMaxToughness: oppMaxToughness,
    aiHasCreature: aiCreatureCount > 0,
    aiBehind:
      aiCreatureCount < oppCreatureCount || aiLife < oppLife - 5,
  };
}

/**
 * Read the highest toughness among a player's creatures, or `0` if none.
 * Used to judge whether a removal ability can actually kill something.
 */
function bestCreatureToughness(
  state: EngineGameState,
  playerId: PlayerId,
): number {
  const zone = state.zones.get(`${playerId}-battlefield`);
  if (!zone) return 0;
  let best = 0;
  for (const cardId of zone.cardIds) {
    const card = state.cards.get(cardId);
    if (!card) continue;
    const typeLine = card.cardData.type_line.toLowerCase();
    if (!typeLine.includes("creature")) continue;
    const toughness = parseStat(card.cardData.toughness);
    if (toughness > best) best = toughness;
  }
  return best;
}

/**
 * Parse a power/toughness string like `"3"` or `"*"` into a number. Star and
 * non-numeric values fall back to `0` so they never break the comparison.
 */
function parseStat(value: string | number | undefined): number {
  if (value === undefined) return 0;
  if (typeof value === "number") return value;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Format a loyalty delta for commentary ("+1", "-2"). The unicode minus is
 * avoided so the log stays ASCII-clean.
 */
function formatLoyaltyDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function getOpponentId(
  gameState: EngineGameState,
  playerId: PlayerId,
): PlayerId {
  const playerIds = Array.from(gameState.players.keys());
  return playerIds.find((id) => id !== playerId) || playerId;
}

// ---------------------------------------------------------------------------
// Issue #993 — beginner-friendly AI telegraph.
//
// The turn loop already emits generic, difficulty-agnostic action commentary
// ("Attacks with Grizzly Bears"). The telegraph layer adds the *why* — but
// only at beginner-friendly difficulties (easy = detailed coaching, expert =
// silent). {@link getTelegraphLevel} reads `telegraphLevel` off the resolved
// difficulty config (issue #1064/#1192), and the generators in
// `ai-telegraph.ts` return `null` at level 0, so an `emitTelegraph` call is a
// cheap no-op for expert play and a meaningful coach line for beginners.
// ---------------------------------------------------------------------------

/**
 * Read the AI's board standing (life + creature count on each side) out of the
 * engine state and fold it into a {@link TelegraphContext}. Used as the "why"
 * behind every telegraph this turn ("to press its advantage" vs "trying to claw
 * back"). Defensive against missing players/zones — defaults to a neutral
 * standing so a degenerate state never crashes the turn loop mid-combat.
 */
function computeTelegraphContext(
  state: EngineGameState,
  aiPlayerId: PlayerId,
): TelegraphContext {
  const opponentId = getOpponentId(state, aiPlayerId);
  const aiPlayer = state.players.get(aiPlayerId);
  const oppPlayer = state.players.get(opponentId);
  const aiLife = aiPlayer?.life ?? 20;
  const oppLife = oppPlayer?.life ?? 20;
  return classifyStanding(
    aiLife,
    oppLife,
    countCreatures(state, aiPlayerId),
    countCreatures(state, opponentId),
  );
}

/** Count the creatures a player controls on the battlefield (0 if no zone). */
function countCreatures(state: EngineGameState, playerId: PlayerId): number {
  const zone = state.zones.get(`${playerId}-battlefield`);
  if (!zone) return 0;
  let count = 0;
  for (const cardId of zone.cardIds) {
    const card = state.cards.get(cardId);
    if (card?.cardData.type_line.toLowerCase().includes("creature")) count++;
  }
  return count;
}

/**
 * Emit a telegraph line through the turn's commentary callback. A no-op when
 * the text is null (expert difficulty / a generator that declined to comment),
 * so call sites can pipe generator output straight through without branching.
 */
function emitTelegraph(config: AITurnConfig, text: string | null): void {
  if (text !== null && text.length > 0) {
    config.onCommentary?.(text);
  }
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

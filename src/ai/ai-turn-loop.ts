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
} from "@/lib/game-state/types";
import { Phase } from "@/lib/game-state/types";
import {
  executeAIAction,
  type AIAction,
  getAvailableAttackers,
  getAIGameState,
} from "./ai-action-executor";
import {
  getDifficultyConfig,
  resolveDifficultyConfig,
  type DifficultyLevel,
  type DifficultyFormat,
} from "./ai-difficulty";
import { advancePhase } from "@/lib/game-state/turn-phases";
import { drawCard } from "@/lib/game-state/game-state";
import { engineToAIState } from "@/lib/game-state/serialization";
import { getMaxHandSize } from "@/lib/game-rules";
import { discardCards } from "@/lib/game-state/keyword-actions";
import {
  classifyArchetypeName,
  GameStateEvaluator,
  BoardSwingTracker,
  type BoardSwing,
  type DeckArchetype,
} from "./game-state-evaluator";
import { detectArchetype } from "./archetype-detector";
import type { DeckCard } from "@/app/actions";

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
function smoothMultiplier(
  prev: number | undefined,
  target: number,
): number {
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
    Math.min(1, -(swing.normalizedAdvantage * 0.7 + swing.normalizedDelta * 0.3)),
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
 * The advantage comes from the real {@link GameStateEvaluator}; if evaluation
 * throws on a degenerate board the advantage defaults to 0 so the AI keeps a
 * stable, neutral posture rather than crashing mid-turn.
 */
function computeAdaptiveContext(
  state: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
): AdaptiveTempoRisk | null {
  const tracker = config.swingTracker;
  if (!tracker) return null;

  let advantage = 0;
  try {
    const aiState = engineToAIState(state);
    const archetype =
      config.archetype ?? detectPlayerArchetype(state, aiPlayerId);
    const evaluator = new GameStateEvaluator(
      aiState,
      aiPlayerId,
      config.difficulty,
      archetype,
    );
    advantage = evaluator.evaluate().totalScore;
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
    const adaptive = computeAdaptiveContext(currentState, aiPlayerId, config);

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

    return {
      success: true,
      actionsTaken,
      finalState: currentState,
      phase: "complete",
    };
  } catch (error) {
    return {
      success: false,
      actionsTaken,
      error: error instanceof Error ? error.message : "Unknown error",
      finalState: currentState,
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

/**
 * Run main phase (pre or post combat)
 */
async function runMainPhase(
  gameState: EngineGameState,
  aiPlayerId: PlayerId,
  config: AITurnConfig,
  _phase: "precombat_main" | "postcombat_main",
  adaptive?: AdaptiveTempoRisk | null,
): Promise<{
  success: boolean;
  actions: AIAction[];
  newState?: EngineGameState;
}> {
  const actions: AIAction[] = [];
  let currentState = gameState;

  // Step 1: Play land if available
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

  // Step 3: Cast other spells
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
        }
        await delay(config.delayMs * 1.5); // Slightly longer delay for combat
      }
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
        await delay(config.delayMs);
      }
    }
  }

  return { success: true, actions, newState: currentState };
}

/**
 * Get opponent player ID
 */
function getOpponentId(
  gameState: EngineGameState,
  playerId: PlayerId,
): PlayerId {
  const playerIds = Array.from(gameState.players.keys());
  return playerIds.find((id) => id !== playerId) || playerId;
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @fileoverview AI Action Executor
 *
 * This module translates AI decisions into actual game actions.
 * It bridges the gap between AI decision-making and the game engine.
 *
 * This module now uses the unified AIGameState format and provides
 * conversion functions to work with the engine's GameState format.
 */

import type {
  GameState as EngineGameState,
  PlayerId,
  CardInstanceId,
  AIGameState,
} from "@/lib/game-state";
import { engineToAIState } from "@/lib/game-state";
import type { AvailableResponse } from "@/ai/stack-interaction-ai";
import {
  playLand as enginePlayLand,
  canPlayLand as engineCanPlayLand,
} from "@/lib/game-state";
import {
  castSpell as engineCastSpell,
  canCastSpell as engineCanCastSpell,
} from "@/lib/game-state";
import { declareAttackers as engineDeclareAttackers } from "@/lib/game-state";
import { tapCardAction, untapCardAction } from "@/lib/game-state";
import { passPriority } from "@/lib/game-state";
import { moveCardBetweenZones, shuffleZone, drawCards } from "@/lib/game-state";
import { canAffordMana, getSpellManaCost, isConvergeX } from "@/lib/game-state";
import { parseImprovise, grantsNoncreatureImprovise } from "@/lib/game-state";
import { parseFlashback, getCardScript } from "@/lib/game-state";
import { quickScore } from "./game-state-evaluator";
import type { GameState } from "./game-state-evaluator";

/**
 * AI Action types
 */
export interface AIAction {
  type: AIActionType;
  cardId?: CardInstanceId;
  targetId?: string | PlayerId;
  targetPlayerId?: PlayerId;
  parameters?: Record<string, unknown>;
  reasoning?: string;
  // Multi-target support
  targetIds?: string[];
  // Variable cost support
  xValue?: number;
  kicked?: boolean;
  /** Cast from the graveyard for its flashback cost (CR 702.34). */
  flashback?: boolean;
  // Modal spell support
  mode?: string;
}

export type AIActionType =
  | "play_land"
  | "cast_spell"
  | "attack"
  | "block"
  | "tap_card"
  | "untap_card"
  | "activate_ability"
  | "pass_priority"
  | "respond_to_stack"
  | "no_action";

/**
 * Result of executing an AI action
 */
export interface AIActionResult {
  success: boolean;
  newState?: EngineGameState;
  error?: string;
  action?: AIAction;
}

/**
 * Execute an AI action on the game state
 */
export async function executeAIAction(
  gameState: EngineGameState,
  action: AIAction,
  aiPlayerId: PlayerId,
): Promise<AIActionResult> {
  try {
    switch (action.type) {
      case "play_land":
        return executePlayLand(gameState, aiPlayerId, action.cardId!);

      case "cast_spell":
        return executeCastSpell(
          gameState,
          aiPlayerId,
          action.cardId!,
          action.targetIds || action.targetId,
          action.mode ? [action.mode] : [],
          action.xValue || 0,
          action.flashback === true,
        );

      case "attack":
        return executeAttack(
          gameState,
          aiPlayerId,
          action.cardId!,
          action.targetId,
        );

      case "block":
        return executeBlock(
          gameState,
          aiPlayerId,
          action.cardId!,
          action.targetId!,
        );

      case "tap_card":
        return executeTapCard(gameState, action.cardId!);

      case "untap_card":
        return executeUntapCard(gameState, action.cardId!);

      case "pass_priority":
        return executePassPriority(gameState, aiPlayerId);

      // Issue #1386: activated-ability action (planeswalker loyalty, equipment,
      // mana-ability activation). The turn loop emits this after consulting the
      // difficulty-scaled selectors in `ability-activation.ts`. We model the
      // activation as a no-mutation success: the underlying rules engine
      // resolves the loyalty/equipment effect separately (the AI is recording
      // its *intent* here, mirroring how `cast_spell` delegates to the engine).
      case "activate_ability":
        return executeActivateAbility(gameState, action);

      case "no_action":
        return { success: true, newState: gameState, action };

      default:
        return {
          success: false,
          error: `Unknown action type: ${(action as any).type}`,
          action,
        };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      action,
    };
  }
}

/**
 * Execute play land action
 */
function executePlayLand(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): AIActionResult {
  if (!engineCanPlayLand(gameState, playerId)) {
    return {
      success: false,
      error: "Cannot play land (already played or no priority)",
      action: { type: "play_land", cardId },
    };
  }

  const result = enginePlayLand(gameState, playerId, cardId);

  if (result.success) {
    return {
      success: true,
      newState: result.state,
      action: { type: "play_land", cardId },
    };
  }

  return {
    success: false,
    error: result.error || "Failed to play land",
    action: { type: "play_land", cardId },
  };
}

/**
 * Execute cast spell action
 * Supports multi-target, X-cost, kicker, and modal spells
 */
function executeCastSpell(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  targetIdOrIds?: string | PlayerId | string[],
  chosenModes: string[] = [],
  xValue: number = 0,
  useFlashback: boolean = false,
): AIActionResult {
  // #2607: flashback casts from the graveyard. The engine's canCastSpell
  // only looks in hand, so this path checks the zone and cost itself and
  // leaves priority, timing and mana to castSpell's own validation.
  if (useFlashback) {
    return executeFlashbackCast(
      gameState,
      playerId,
      cardId,
      targetIdOrIds,
      chosenModes,
    );
  }
  // canCastSpell returns { canCast: boolean; reason?: string } — guard on the
  // boolean field, not the object (which is always truthy). Previously this
  // checked `!canCast`, a dead branch that never short-circuited, so the AI
  // always proceeded to castSpell even when it lacked mana/priority. (#1092)
  const canCast = engineCanCastSpell(gameState, playerId, cardId);

  if (!canCast.canCast) {
    return {
      success: false,
      error: "Cannot cast spell (no mana or no priority)",
      action: { type: "cast_spell", cardId, targetId: targetIdOrIds as string },
    };
  }

  // #2552: an X spell cast with no X chosen picks the largest X it can pay,
  // and is held when that is 0 (a 0/0 or "draw 0" wastes the card).
  if (xValue === 0) {
    xValue = chooseAIXValue(gameState, playerId, cardId);
    const cost = gameState.cards.get(cardId)?.cardData.mana_cost ?? "";
    const oracle = (
      gameState.cards.get(cardId)?.cardData as { oracle_text?: string }
    )?.oracle_text;
    if (xValue === 0 && /\{X\}/i.test(cost) && !isConvergeX(oracle)) {
      return {
        success: false,
        error: "Not casting an X spell for X = 0",
        action: {
          type: "cast_spell",
          cardId,
          targetId: targetIdOrIds as string,
        },
      };
    }
  }

  // Handle multi-target: array of targetIds
  let targets;
  if (Array.isArray(targetIdOrIds)) {
    targets = targetIdOrIds.map((tid) => ({
      type: "card" as const,
      targetId: tid,
      isValid: true,
    }));
  } else if (targetIdOrIds) {
    targets = [
      { type: "card" as const, targetId: targetIdOrIds, isValid: true },
    ];
  }

  // #2607: tap artifacts for improvise when the pool alone can't pay the
  // generic part of the cost.
  const improviseArtifacts = chooseAIImproviseArtifacts(
    gameState,
    playerId,
    cardId,
    xValue,
  );

  const result =
    improviseArtifacts.length > 0
      ? engineCastSpell(
          gameState,
          playerId,
          cardId,
          targets,
          chosenModes,
          xValue,
          false,
          { type: "improvise", improviseArtifacts },
        )
      : engineCastSpell(
          gameState,
          playerId,
          cardId,
          targets,
          chosenModes,
          xValue,
        );

  if (result.success) {
    return {
      success: true,
      newState: result.state,
      action: {
        type: "cast_spell",
        cardId,
        targetId: targetIdOrIds as string,
        mode: chosenModes[0],
        xValue,
      },
    };
  }

  return {
    success: false,
    error: result.error || "Failed to cast spell",
    action: { type: "cast_spell", cardId, targetId: targetIdOrIds as string },
  };
}

/**
 * The flashback cost the AI would pay for `cardId` (#2607, CR 702.34), as a
 * mana-cost string like `"{2}{R}"`. The card script's `flashback.cost` wins
 * over the oracle text, matching castSpell. Returns null when the card has
 * no flashback or its flashback cost has {X} (the AI doesn't pick X there).
 */
export function aiFlashbackCost(
  gameState: EngineGameState,
  cardId: CardInstanceId,
): string | null {
  const card = gameState.cards.get(cardId);
  if (!card) return null;
  const scripted = getCardScript(card.cardData.name)?.flashback?.cost;
  if (scripted) return scripted;
  const oracle = (card.cardData as { oracle_text?: string }).oracle_text ?? "";
  const parsed = parseFlashback(oracle);
  if (!parsed.hasFlashback) return null;
  const cost = parsed.description.replace(/^flashback\s*/i, "");
  if (!cost || /\{X\}/i.test(cost)) return null;
  return cost;
}

/**
 * Cast `cardId` from the AI's graveyard for its flashback cost (#2607),
 * tapping artifacts for improvise when the spell has it and the pool can't
 * cover the flashback cost's generic part (#2481).
 */
function executeFlashbackCast(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  targetIdOrIds: string | PlayerId | string[] | undefined,
  chosenModes: string[],
): AIActionResult {
  const fail = (error: string): AIActionResult => ({
    success: false,
    error,
    action: {
      type: "cast_spell",
      cardId,
      targetId: targetIdOrIds as string,
      flashback: true,
    },
  });
  const grave = gameState.zones.get(`${playerId}-graveyard`);
  if (!grave?.cardIds.includes(cardId)) {
    return fail("Flashback: card is not in your graveyard");
  }
  const cost = aiFlashbackCost(gameState, cardId);
  if (!cost) return fail("Flashback: card has no flashback cost");

  let targets;
  if (Array.isArray(targetIdOrIds)) {
    targets = targetIdOrIds.map((tid) => ({
      type: "card" as const,
      targetId: tid,
      isValid: true,
    }));
  } else if (targetIdOrIds) {
    targets = [
      { type: "card" as const, targetId: targetIdOrIds, isValid: true },
    ];
  }

  const improviseArtifacts = chooseAIImproviseArtifacts(
    gameState,
    playerId,
    cardId,
    0,
    cost,
  );
  const result = engineCastSpell(
    gameState,
    playerId,
    cardId,
    targets,
    chosenModes,
    0,
    false,
    improviseArtifacts.length > 0
      ? { type: "flashback", improviseArtifacts }
      : { type: "flashback" },
  );
  if (!result.success) {
    return fail(result.error || "Failed to cast spell with flashback");
  }
  return {
    success: true,
    newState: result.state,
    action: {
      type: "cast_spell",
      cardId,
      targetId: targetIdOrIds as string,
      mode: chosenModes[0],
      flashback: true,
    },
  };
}

/**
 * Whether `cardId` has improvise for `playerId`: printed (CR 702.126) or, for
 * a noncreature spell, granted by a permanent they control ("Noncreature
 * spells you cast have improvise", e.g. Ironheart, Clever Champion).
 */
export function aiSpellHasImprovise(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): boolean {
  const card = gameState.cards.get(cardId);
  if (!card) return false;
  const oracle = (card.cardData as { oracle_text?: string }).oracle_text ?? "";
  if (parseImprovise(oracle).hasImprovise) return true;
  if ((card.cardData.type_line || "").toLowerCase().includes("creature")) {
    return false;
  }
  const battlefield =
    gameState.zones.get(`${playerId}-battlefield`)?.cardIds ?? [];
  return battlefield.some((id) => {
    const p = gameState.cards.get(id);
    return (
      !!p &&
      p.controllerId === playerId &&
      grantsNoncreatureImprovise(
        (p.cardData as { oracle_text?: string }).oracle_text ?? "",
      )
    );
  });
}

/**
 * Artifacts the AI taps for improvise (#2607, CR 702.126a): only as many as
 * the generic mana its pool can't cover, so artifacts it doesn't need stay
 * untapped. Prefers artifacts that do nothing else when tapped, then mana
 * rocks, and taps artifact creatures last (they could attack or block).
 * Returns [] when the spell has no improvise, the pool already pays, the
 * colored part is unaffordable, or there aren't enough artifacts.
 * `manaCostOverride` is the cost actually being paid (a flashback cost).
 */
export function chooseAIImproviseArtifacts(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  xValue: number = 0,
  manaCostOverride?: string,
): CardInstanceId[] {
  if (!aiSpellHasImprovise(gameState, playerId, cardId)) return [];
  const printed = gameState.cards.get(cardId)?.cardData as
    { mana_cost?: string } | undefined;
  if (!printed) return [];
  // A flashback cast pays the flashback cost instead of the mana cost.
  const data =
    manaCostOverride !== undefined ? { mana_cost: manaCostOverride } : printed;
  const { white, blue, black, red, green, generic } = getSpellManaCost(data);
  const colored = { white, blue, black, red, green };
  const totalGeneric = generic + Math.max(0, xValue);
  if (!canAffordMana(gameState, playerId, { ...colored, generic: 0 })) {
    return [];
  }
  let shortfall = 0;
  while (
    shortfall < totalGeneric &&
    !canAffordMana(gameState, playerId, {
      ...colored,
      generic: totalGeneric - shortfall,
    })
  ) {
    shortfall++;
  }
  if (shortfall === 0) return [];

  const rank = (id: CardInstanceId): number => {
    const c = gameState.cards.get(id);
    const type = (c?.cardData.type_line || "").toLowerCase();
    if (type.includes("creature")) return 2;
    const oracle =
      (c?.cardData as { oracle_text?: string } | undefined)?.oracle_text ?? "";
    return /\{t\}[^:]*:\s*add/i.test(oracle) ? 1 : 0;
  };
  const candidates = (
    gameState.zones.get(`${playerId}-battlefield`)?.cardIds ?? []
  )
    .filter((id) => {
      const c = gameState.cards.get(id);
      return (
        !!c &&
        id !== cardId &&
        c.controllerId === playerId &&
        !c.isTapped &&
        (c.cardData.type_line || "").toLowerCase().includes("artifact")
      );
    })
    .map((id, i) => ({ id, i, r: rank(id) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((e) => e.id);
  if (candidates.length < shortfall) return [];
  return candidates.slice(0, shortfall);
}

/**
 * Generic mana improvise could pay for this spell (#2607): the AI's untapped
 * artifacts, capped at the generic part of the printed cost. 0 when the
 * spell has no improvise. X is not counted here; see {@link chooseAIXValue}.
 */
export function aiImproviseCapacity(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  includeX: boolean = false,
): number {
  if (!aiSpellHasImprovise(gameState, playerId, cardId)) return 0;
  const data = gameState.cards.get(cardId)?.cardData as
    { mana_cost?: string } | undefined;
  if (!data) return 0;
  const artifacts = (
    gameState.zones.get(`${playerId}-battlefield`)?.cardIds ?? []
  ).filter((id) => {
    const c = gameState.cards.get(id);
    return (
      !!c &&
      id !== cardId &&
      c.controllerId === playerId &&
      !c.isTapped &&
      (c.cardData.type_line || "").toLowerCase().includes("artifact")
    );
  }).length;
  if (includeX) return artifacts;
  return Math.min(artifacts, getSpellManaCost(data).generic);
}

/** Highest X the AI would ever pay; keeps the affordability loop bounded. */
const MAX_AI_X = 20;

/**
 * X the AI picks for a spell with {X} in its mana cost (#2552): everything
 * left in its pool after the rest of the cost (CR 107.3, 601.2b), plus
 * untapped artifacts when the spell has improvise (#2607). Returns 0
 * for spells without a chosen X, including converge X, which the engine
 * sets from the colors spent.
 */
export function chooseAIXValue(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): number {
  const data = gameState.cards.get(cardId)?.cardData as
    { mana_cost?: string; oracle_text?: string } | undefined;
  if (!data || !/\{X\}/i.test(data.mana_cost ?? "")) return 0;
  if (isConvergeX(data.oracle_text)) return 0;
  const { white, blue, black, red, green, generic } = getSpellManaCost(data);
  // #2607: with improvise, untapped artifacts pay generic mana, X included,
  // so they raise X too.
  const artifacts = aiImproviseCapacity(gameState, playerId, cardId, true);
  let x = 0;
  while (
    x < MAX_AI_X &&
    canAffordMana(gameState, playerId, {
      white,
      blue,
      black,
      red,
      green,
      generic: Math.max(0, generic + x + 1 - artifacts),
    })
  ) {
    x++;
  }
  return x;
}

/**
 * Execute attack action
 */
function executeAttack(
  gameState: EngineGameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  defenderId?: string | PlayerId,
): AIActionResult {
  // Get current attackers from combat state
  const currentAttackers = gameState.combat.attackers || [];

  // Find the creature
  const creature = gameState.cards.get(cardId);
  if (!creature) {
    return {
      success: false,
      error: "Creature not found",
      action: { type: "attack", cardId, targetId: defenderId },
    };
  }

  // Check if creature can attack
  if (creature.isTapped || creature.hasSummoningSickness) {
    return {
      success: false,
      error: "Creature cannot attack (tapped or summoning sickness)",
      action: { type: "attack", cardId, targetId: defenderId },
    };
  }

  // Add to existing attackers
  const newAttacker = {
    cardId,
    defenderId: defenderId || getOpponentPlayerId(gameState, playerId),
    isAttackingPlaneswalker: false,
    damageToDeal: creature.cardData.power
      ? parseInt(creature.cardData.power) || 0
      : 0,
    hasFirstStrike:
      creature.cardData.keywords?.includes("first_strike") || false,
    hasDoubleStrike:
      creature.cardData.keywords?.includes("double_strike") || false,
  };

  const updatedAttackers = [...currentAttackers, newAttacker];

  const result = engineDeclareAttackers(gameState, updatedAttackers);

  if (result.success) {
    return {
      success: true,
      newState: result.state,
      action: { type: "attack", cardId, targetId: defenderId },
    };
  }

  return {
    success: false,
    error: result.errors?.join(", ") || "Failed to declare attackers",
    action: { type: "attack", cardId, targetId: defenderId },
  };
}

/**
 * Execute block action
 */
function executeBlock(
  gameState: EngineGameState,
  playerId: PlayerId,
  blockerId: CardInstanceId,
  attackerId: string,
): AIActionResult {
  // Get current blockers
  const currentBlockers = gameState.combat.blockers || new Map();

  // Find the creature
  const creature = gameState.cards.get(blockerId);
  if (!creature) {
    return {
      success: false,
      error: "Creature not found",
      action: { type: "block", cardId: blockerId, targetId: attackerId },
    };
  }

  // Check if creature can block
  if (creature.isTapped) {
    return {
      success: false,
      error: "Creature cannot block (tapped)",
      action: { type: "block", cardId: blockerId, targetId: attackerId },
    };
  }

  // Add to blockers for this attacker
  const existingBlockers = currentBlockers.get(attackerId) || [];
  const newBlocker = {
    cardId: blockerId,
    attackerId,
    damageToDeal: creature.cardData.toughness
      ? parseInt(creature.cardData.toughness) || 0
      : 0,
    blockerOrder: existingBlockers.length,
    hasFirstStrike:
      creature.cardData.keywords?.includes("first_strike") || false,
    hasDoubleStrike:
      creature.cardData.keywords?.includes("double_strike") || false,
  };

  const updatedBlockers = new Map(currentBlockers);
  updatedBlockers.set(attackerId, [...existingBlockers, newBlocker]);

  // Note: The actual blocking would need to be implemented in the combat module
  // For now, return success with the current state
  return {
    success: true,
    newState: gameState,
    action: { type: "block", cardId: blockerId, targetId: attackerId },
  };
}

/**
 * Execute tap card action
 */
function executeTapCard(
  gameState: EngineGameState,
  cardId: CardInstanceId,
): AIActionResult {
  const result = tapCardAction(gameState, cardId);

  if (result.success) {
    return {
      success: true,
      newState: result.state,
      action: { type: "tap_card", cardId },
    };
  }

  return {
    success: false,
    error: result.error || "Failed to tap card",
    action: { type: "tap_card", cardId },
  };
}

/**
 * Execute untap card action
 */
function executeUntapCard(
  gameState: EngineGameState,
  cardId: CardInstanceId,
): AIActionResult {
  const result = untapCardAction(gameState, cardId);

  if (result.success) {
    return {
      success: true,
      newState: result.state,
      action: { type: "untap_card", cardId },
    };
  }

  return {
    success: false,
    error: result.error || "Failed to untap card",
    action: { type: "untap_card", cardId },
  };
}

/**
 * Execute pass priority action
 */
function executePassPriority(
  gameState: EngineGameState,
  playerId: PlayerId,
): AIActionResult {
  const newState = passPriority(gameState, playerId);

  return {
    success: true,
    newState,
    action: { type: "pass_priority" },
  };
}

/**
 * Execute an activated-ability action (issue #1386).
 *
 * Planeswalker loyalty abilities, equipment activation, and repeatable mana
 * abilities are activated abilities. The AI records its intent via this
 * action; the underlying rules engine resolves the effect (loyalty counter
 * adjustment, equip, mana production) separately.
 *
 * For planeswalker loyalty abilities, we adjust the loyalty counters here so
 * the AI's decision is reflected on the board (the walker gains/loses loyalty
 * per the chosen ability's delta, exposed via `parameters.loyaltyDelta`).
 * This keeps the replay self-consistent without requiring a full
 * activated-ability resolver in the engine.
 *
 * Defensive: returns a no-mutation success when the card or counters are
 * missing so the turn loop never crashes on a degenerate state.
 */
function executeActivateAbility(
  gameState: EngineGameState,
  action: AIAction,
): AIActionResult {
  const cardId = action.cardId;
  if (!cardId) {
    return {
      success: false,
      error: "activate_ability requires a cardId",
      action,
    };
  }

  const card = gameState.cards.get(cardId);
  if (!card) {
    return {
      success: false,
      error: `Card not found: ${cardId}`,
      action,
    };
  }

  let newState = gameState;

  // Planeswalker loyalty abilities: apply the loyalty delta so the walker's
  // counters reflect the activation. The delta is threaded through
  // `parameters.loyaltyDelta` by the turn loop.
  const loyaltyDelta = action.parameters?.loyaltyDelta;
  if (
    typeof loyaltyDelta === "number" &&
    card.cardData.type_line.toLowerCase().includes("planeswalker")
  ) {
    const counters = Array.isArray(card.counters) ? card.counters : [];
    const loyaltyCounter = counters.find((c) => c.type === "loyalty");
    const current = loyaltyCounter?.count ?? 0;
    const next = Math.max(0, current + loyaltyDelta);

    // Return a new state with the updated loyalty counters (immutable update).
    const updatedCard = {
      ...card,
      counters: [
        ...counters.filter((c) => c.type !== "loyalty"),
        { type: "loyalty", count: next },
      ],
    };
    const updatedCards = new Map(gameState.cards);
    updatedCards.set(cardId, updatedCard);
    newState = { ...gameState, cards: updatedCards };
  }

  return {
    success: true,
    newState,
    action: {
      ...action,
      type: "activate_ability",
      reasoning:
        action.reasoning ?? `Activated ability on ${card.cardData.name}`,
    },
  };
}

/**
 * Get opponent player ID (for 1v1)
 */
function getOpponentPlayerId(
  gameState: EngineGameState,
  playerId: PlayerId,
): PlayerId {
  const playerIds = Array.from(gameState.players.keys());
  return playerIds.find((id) => id !== playerId) || playerId;
}

/**
 * Get available lands from player's hand
 */
export function getAvailableLands(
  gameState: EngineGameState,
  playerId: PlayerId,
): CardInstanceId[] {
  const handZone = gameState.zones.get(`${playerId}-hand`);
  if (!handZone) return [];

  const lands: CardInstanceId[] = [];

  for (const cardId of handZone.cardIds) {
    const card = gameState.cards.get(cardId);
    if (card && card.cardData.type_line.toLowerCase().includes("land")) {
      lands.push(cardId);
    }
  }

  return lands;
}

/**
 * Get available creatures for attacking
 */
export function getAvailableAttackers(
  gameState: EngineGameState,
  playerId: PlayerId,
): CardInstanceId[] {
  const battlefield = gameState.zones.get(`${playerId}-battlefield`);
  if (!battlefield) return [];

  const attackers: CardInstanceId[] = [];

  for (const cardId of battlefield.cardIds) {
    const card = gameState.cards.get(cardId);
    if (
      card &&
      card.cardData.type_line.toLowerCase().includes("creature") &&
      !card.isTapped &&
      !card.hasSummoningSickness
    ) {
      attackers.push(cardId);
    }
  }

  return attackers;
}

/**
 * Get available creatures for blocking
 */
export function getAvailableBlockers(
  gameState: EngineGameState,
  playerId: PlayerId,
): CardInstanceId[] {
  const battlefield = gameState.zones.get(`${playerId}-battlefield`);
  if (!battlefield) return [];

  const blockers: CardInstanceId[] = [];

  for (const cardId of battlefield.cardIds) {
    const card = gameState.cards.get(cardId);
    if (
      card &&
      card.cardData.type_line.toLowerCase().includes("creature") &&
      !card.isTapped
    ) {
      blockers.push(cardId);
    }
  }

  return blockers;
}

/**
 * Get available responses from hand
 */
export function getAvailableResponses(
  gameState: EngineGameState,
  playerId: PlayerId,
): AvailableResponse[] {
  const handZone = gameState.zones.get(`${playerId}-hand`);
  if (!handZone) return [];

  const responses: AvailableResponse[] = [];

  for (const cardId of handZone.cardIds) {
    const card = gameState.cards.get(cardId);
    if (!card) continue;

    const isInstant = card.cardData.type_line.toLowerCase().includes("instant");
    const hasFlash = card.cardData.keywords?.includes("flash");

    if (isInstant || hasFlash) {
      responses.push({
        cardId,
        name: card.cardData.name,
        type: isInstant ? "instant" : "flash",
        manaValue: card.cardData.cmc,
        manaCost: parseManaCost(card.cardData.mana_cost || ""),
        canCounter:
          card.cardData.oracle_text?.toLowerCase().includes("counter") || false,
        canTarget: [],
        effect: {
          type: "other",
          value: 5,
          targets: [],
        },
      });
    }
  }

  return responses;
}

/**
 * Parse mana cost string to object
 */
function parseManaCost(manaCost: string): { [color: string]: number } {
  const result: { [color: string]: number } = {};

  // Simple parsing - count each color symbol
  const colorMatches = manaCost.matchAll(/[{]([WUBRG])(\d*)[}]/g);
  for (const match of colorMatches) {
    const color = match[1];
    const count = match[2] ? parseInt(match[2]) : 1;
    result[color] = (result[color] || 0) + count;
  }

  // Count generic mana
  const genericMatches = manaCost.matchAll(/[{](\d+)[}]/g);
  for (const match of genericMatches) {
    result["generic"] = (result["generic"] || 0) + parseInt(match[1]);
  }

  return result;
}

/**
 * Get AI view of the game state
 * Converts engine GameState to unified AIGameState format
 */
export function getAIGameState(engineState: EngineGameState): AIGameState {
  return engineToAIState(engineState);
}

/**
 * Get available lands from player's hand (using AI format)
 */
export function getAvailableLandsAI(
  aiState: AIGameState,
  playerId: PlayerId,
): string[] {
  const player = aiState.players[playerId];
  if (!player) return [];

  return player.hand
    .filter((card) => card.type.toLowerCase().includes("land"))
    .map((card) => card.cardInstanceId);
}

/**
 * Get available creatures for attacking (using AI format)
 */
export function getAvailableAttackersAI(
  aiState: AIGameState,
  playerId: PlayerId,
): string[] {
  const player = aiState.players[playerId];
  if (!player) return [];

  return player.battlefield
    .filter(
      (perm) =>
        perm.type === "creature" &&
        !perm.tapped &&
        !perm.summoningSickness &&
        (perm.power || 0) > 0,
    )
    .map((perm) => perm.cardInstanceId);
}

/**
 * Get available creatures for blocking (using AI format)
 */
export function getAvailableBlockersAI(
  aiState: AIGameState,
  playerId: PlayerId,
): string[] {
  const player = aiState.players[playerId];
  if (!player) return [];

  return player.battlefield
    .filter((perm) => perm.type === "creature" && !perm.tapped)
    .map((perm) => perm.cardInstanceId);
}

/**
 * Lookahead evaluation for complex interactions
 * Simulates future game states given current state + action
 * Returns expected value score based on depth
 */
export async function evaluateLookahead(
  gameState: EngineGameState,
  playerId: PlayerId,
  depth: number,
  action?: AIAction,
): Promise<number> {
  // Base case: max depth reached
  if (depth <= 0) {
    const aiState = getAIGameState(gameState);
    // Use quick score for terminal evaluation
    return quickScore(aiState as unknown as GameState, playerId, "medium");
  }

  // If no action provided, just evaluate current state
  if (!action) {
    const aiState = getAIGameState(gameState);
    return quickScore(aiState as unknown as GameState, playerId, "medium");
  }

  // Execute the action to get new state (async)
  const result = await executeAIAction(gameState, action, playerId);

  if (!result.success || !result.newState) {
    // Action failed, return negative value
    return -100;
  }

  // Get opponent ID (the one who would respond)
  const opponentId = getOpponentPlayerId(gameState, playerId);

  // For depth > 1, simulate opponent's best response and recurse
  if (depth > 1) {
    // Get opponent's available actions (simplified - just evaluate their perspective)
    const opponentState = result.newState;
    const opponentScore = quickScore(
      getAIGameState(opponentState) as unknown as GameState,
      opponentId,
      "medium",
    );

    // Our score after opponent's potential response
    const ourScore = quickScore(
      getAIGameState(result.newState) as unknown as GameState,
      playerId,
      "medium",
    );

    // Combine: our immediate gain minus opponent's potential gain
    // This is simplified - real implementation would explore opponent actions
    return ourScore - (opponentScore * 0.5) / depth;
  }

  // For depth === 1, just evaluate the resulting state
  const aiState = getAIGameState(result.newState);
  return quickScore(aiState as unknown as GameState, playerId, "medium");
}

// ---------------------------------------------------------------------------
// Issue #1063 — opponent opening-hand mulligan mechanics.
//
// The engine's `"mulligan"` ActionType is an event/log descriptor, not a full
// mechanic, so the opponent turn loop needs a dedicated executor that performs
// the actual card movement: ship the current hand back into the library,
// shuffle, and draw one fewer card. This keeps the mechanical action in the
// executor module alongside every other engine action the AI performs.
// ---------------------------------------------------------------------------

/**
 * Result of mechanically executing one opponent mulligan.
 */
export interface OpponentMulliganResult {
  success: boolean;
  state: EngineGameState;
  /** Hand size before the mulligan. */
  fromHandSize: number;
  /** Hand size after the mulligan (expected `fromHandSize - 1`). */
  toHandSize: number;
  error?: string;
}

/**
 * Mechanically execute a single mulligan for the AI opponent: return the
 * current hand to the library, shuffle, and draw one fewer card (issue #1063).
 *
 * This is the action half of the keep/ship decision made by
 * {@link decideOpponentMulligan}; the decision/wiring lives in the turn loop.
 * The function is a pure-ish state transform (it only shuffles, using
 * `Math.random`) and never throws — degenerate states produce a failed result
 * the caller can skip. It does not route through {@link executeAIAction}'s
 * switch because `"mulligan"` is an event/log type there, not an AI action.
 */
export function executeOpponentMulligan(
  state: EngineGameState,
  playerId: PlayerId,
): OpponentMulliganResult {
  const handKey = `${playerId}-hand`;
  const libraryKey = `${playerId}-library`;
  const zones = new Map(state.zones);
  const handZone = zones.get(handKey);
  const libraryZone = zones.get(libraryKey);

  if (!handZone || !libraryZone) {
    return {
      success: false,
      state,
      fromHandSize: handZone?.cardIds.length ?? 0,
      toHandSize: handZone?.cardIds.length ?? 0,
      error: `Missing ${playerId} hand or library zone`,
    };
  }

  const fromHandSize = handZone.cardIds.length;
  if (fromHandSize <= 0) {
    return { success: true, state, fromHandSize: 0, toHandSize: 0 };
  }

  // 1) Put every hand card back into the library.
  let hand = handZone;
  let library = libraryZone;
  for (const cardId of [...hand.cardIds]) {
    const moved = moveCardBetweenZones(hand, library, cardId);
    hand = moved.from;
    library = moved.to;
  }

  // 2) Shuffle the library so the redraw is randomized.
  library = shuffleZone(library);

  // 3) Draw one fewer card than we shipped.
  const toDraw = Math.max(0, fromHandSize - 1);
  const drawn = drawCards(library, hand, toDraw);
  library = drawn.library;
  hand = drawn.hand;

  zones.set(handKey, hand);
  zones.set(libraryKey, library);

  const newState: EngineGameState = {
    ...state,
    zones,
    lastModifiedAt: Date.now(),
  };

  return {
    success: true,
    state: newState,
    fromHandSize,
    toHandSize: hand.cardIds.length,
  };
}

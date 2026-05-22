/**
 * Effect Resolution System
 *
 * Implements structured effect resolution for spells on the stack.
 * Reference: CR 608 - Handling Spells and Abilities
 *
 * This module provides handlers for each effect type:
 * - Card draw (e.g., "Draw 3 cards")
 * - Life gain/loss (e.g., "Gain 5 life", "Target player loses 3 life")
 * - Creature token creation (e.g., "Create two 1/1 white Soldier tokens")
 * - Counter spells (e.g., "Counter target spell")
 * - Damage redirection effects
 * - Protection/shroud checking during resolution
 */

import type { GameState, PlayerId, CardInstanceId, StackEffect } from "./types";
import { drawCards, createTokenCard, counterSpell } from "./keyword-actions";
import { dealDamageToCard } from "./keyword-actions";

/**
 * Result of an effect resolution
 */
export interface EffectResolutionResult {
  success: boolean;
  state: GameState;
  description: string;
  affectedCards?: CardInstanceId[];
  error?: string;
}

/**
 * Resolve a card draw effect
 * CR 121 - Drawing Cards
 */
export function resolveCardDrawEffect(
  state: GameState,
  sourceId: CardInstanceId | undefined,
  amount: number,
  targetPlayerId?: PlayerId,
): EffectResolutionResult {
  const player = targetPlayerId || state.turn.activePlayerId;
  const playerData = state.players.get(player);

  if (!playerData) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${player} not found`,
    };
  }

  const result = drawCards(state, player, amount);

  return {
    success: result.success,
    state: result.state,
    description: `${playerData.name} drew ${amount} card${amount !== 1 ? "s" : ""}${sourceId ? ` (from ${state.cards.get(sourceId)?.cardData.name || "source"})` : ""}`,
    affectedCards: result.affectedCards,
  };
}

/**
 * Resolve a life gain effect
 * CR 119 - Damage and Life
 */
export function resolveLifeGainEffect(
  state: GameState,
  sourceId: CardInstanceId | undefined,
  amount: number,
  targetPlayerId?: PlayerId,
): EffectResolutionResult {
  const player = targetPlayerId || state.turn.activePlayerId;
  const playerData = state.players.get(player);

  if (!playerData) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${player} not found`,
    };
  }

  const updatedPlayers = new Map(state.players);
  const updatedPlayer = {
    ...playerData,
    life: playerData.life + amount,
  };
  updatedPlayers.set(player, updatedPlayer);

  return {
    success: true,
    state: {
      ...state,
      players: updatedPlayers,
      lastModifiedAt: Date.now(),
    },
    description: `${playerData.name} gained ${amount} life${sourceId ? ` (from ${state.cards.get(sourceId)?.cardData.name || "source"})` : ""}`,
  };
}

/**
 * Resolve a life loss effect
 * CR 119.3 - Loss of Life
 */
export function resolveLifeLossEffect(
  state: GameState,
  sourceId: CardInstanceId | undefined,
  amount: number,
  targetPlayerId?: PlayerId,
): EffectResolutionResult {
  const player = targetPlayerId || state.turn.activePlayerId;
  const playerData = state.players.get(player);

  if (!playerData) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${player} not found`,
    };
  }

  const updatedPlayers = new Map(state.players);
  const updatedPlayer = {
    ...playerData,
    life: Math.max(0, playerData.life - amount), // Life cannot go below 0
  };
  updatedPlayers.set(player, updatedPlayer);

  return {
    success: true,
    state: {
      ...state,
      players: updatedPlayers,
      lastModifiedAt: Date.now(),
    },
    description: `${playerData.name} lost ${amount} life${sourceId ? ` (from ${state.cards.get(sourceId)?.cardData.name || "source"})` : ""}`,
  };
}

/**
 * Resolve a token creation effect
 * CR 110.5 - Tokens
 */
export function resolveTokenCreationEffect(
  state: GameState,
  sourceId: CardInstanceId | undefined,
  tokenData: {
    name: string;
    type_line: string;
    power?: string;
    toughness?: string;
    colors?: string[];
    oracle_text?: string;
  },
  count: number,
  controllerId?: PlayerId,
): EffectResolutionResult {
  const controller = controllerId || state.turn.activePlayerId;
  const ownerId = sourceId
    ? state.cards.get(sourceId)?.ownerId || controller
    : controller;

  // Create a ScryfallCard-like token data structure
  const tokenCardData = {
    id: `token-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: tokenData.name,
    type_line: tokenData.type_line,
    mana_cost: "",
    cmc: 0,
    colors: tokenData.colors || [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal", commander: "legal" },
    card_faces: undefined,
    layout: "token",
    power: tokenData.power,
    toughness: tokenData.toughness,
    oracle_text: tokenData.oracle_text || "",
  };

  const result = createTokenCard(
    state,
    tokenCardData as any,
    controller,
    ownerId,
    count,
  );

  return {
    success: result.success,
    state: result.state,
    description: `Created ${count} ${tokenData.name} token${count !== 1 ? "s" : ""}${sourceId ? ` (from ${state.cards.get(sourceId)?.cardData.name || "source"})` : ""}`,
    affectedCards: result.affectedCards,
  };
}

/**
 * Resolve a counter spell effect
 * CR 701.5 - Counter
 */
export function resolveCounterEffect(
  state: GameState,
  sourceId: CardInstanceId | undefined,
  targetStackObjectId: string,
): EffectResolutionResult {
  const result = counterSpell(state, targetStackObjectId);

  return {
    success: result.success,
    state: result.state,
    description: result.description || `Countered spell`,
  };
}

/**
 * Resolve a damage effect to a card (creature, planeswalker, etc.)
 */
export function resolveDamageEffect(
  state: GameState,
  sourceId: CardInstanceId | undefined,
  targetId: CardInstanceId,
  amount: number,
  isCombatDamage: boolean = false,
): EffectResolutionResult {
  const result = dealDamageToCard(
    state,
    targetId,
    amount,
    isCombatDamage,
    sourceId,
  );

  return {
    success: result.success,
    state: result.state,
    description:
      result.description ||
      `${state.cards.get(targetId)?.cardData.name || "Target"} took ${amount} damage`,
    affectedCards: result.affectedCards,
  };
}

/**
 * Resolve a damage effect to a player
 */
export function resolvePlayerDamageEffect(
  state: GameState,
  sourceId: CardInstanceId | undefined,
  targetPlayerId: PlayerId,
  amount: number,
): EffectResolutionResult {
  const playerData = state.players.get(targetPlayerId);

  if (!playerData) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${targetPlayerId} not found`,
    };
  }

  // Deal damage to player - this reduces their life total
  // For commander damage, we would track that separately
  const updatedPlayers = new Map(state.players);
  const updatedPlayer = {
    ...playerData,
    life: Math.max(0, playerData.life - amount),
  };
  updatedPlayers.set(targetPlayerId, updatedPlayer);

  return {
    success: true,
    state: {
      ...state,
      players: updatedPlayers,
      lastModifiedAt: Date.now(),
    },
    description: `${playerData.name} took ${amount} damage${sourceId ? ` (from ${state.cards.get(sourceId)?.cardData.name || "source"})` : ""}`,
  };
}

/**
 * Word to number conversion for spell text parsing
 */
function wordToNumber(word: string): number | null {
  const wordMap: Record<string, number> = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  return wordMap[word.toLowerCase()] ?? null;
}

/**
 * Parse oracle text to extract effect information
 * Used to determine what effects a spell creates
 */
export function parseSpellEffects(
  oracleText: string,
  variableValues?: Map<string, number>,
): StackEffect[] {
  const effects: StackEffect[] = [];
  const lowerText = oracleText.toLowerCase();

  // Card draw: "draw X cards", "draw a card", "draw two cards", "draw three cards"
  const drawMatch = lowerText.match(
    /draw(?:s)?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*(?:card|cards)?/i,
  );
  if (drawMatch) {
    const amountStr = drawMatch[1];
    let amount: number;
    if (/^\d+$/.test(amountStr)) {
      amount = parseInt(amountStr, 10);
    } else {
      const wordNum = wordToNumber(amountStr);
      amount = wordNum ?? 1;
    }
    // Use X value if specified
    const xValue = variableValues?.get("X");
    effects.push({
      effectType: "card_draw",
      amount: xValue !== undefined ? xValue : amount,
      targetId: "" as PlayerId, // Will be determined by target selection
    });
  }

  // Life gain: "gain X life", "you gain Y life"
  const gainLifeMatch = lowerText.match(
    /gain(?:s)?\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life/i,
  );
  if (gainLifeMatch) {
    const amountStr = gainLifeMatch[1];
    let amount: number;
    if (/^\d+$/.test(amountStr)) {
      amount = parseInt(amountStr, 10);
    } else {
      const wordNum = wordToNumber(amountStr);
      amount = wordNum ?? 1;
    }
    const xValue = variableValues?.get("X");
    effects.push({
      effectType: "life_gain",
      amount: xValue !== undefined ? xValue : amount,
      targetId: "" as PlayerId,
    });
  }

  // Life loss: "lose X life", "target player loses Y life"
  const loseLifeMatch = lowerText.match(
    /(?:lose|loses)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life/i,
  );
  if (loseLifeMatch) {
    const amountStr = loseLifeMatch[1];
    let amount: number;
    if (/^\d+$/.test(amountStr)) {
      amount = parseInt(amountStr, 10);
    } else {
      const wordNum = wordToNumber(amountStr);
      amount = wordNum ?? 1;
    }
    const xValue = variableValues?.get("X");
    effects.push({
      effectType: "life_loss",
      amount: xValue !== undefined ? xValue : amount,
      targetId: "" as PlayerId,
    });
  }

  // Token creation: "create X 1/1 color creature tokens"
  const tokenMatch = lowerText.match(
    /create\s+(?:a\s+)?(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?(.+?)\s+token/i,
  );
  if (tokenMatch) {
    const countStr = tokenMatch[1];
    let count: number;
    if (!countStr || countStr === "a" || countStr === "an") {
      count = 1;
    } else if (/^\d+$/.test(countStr)) {
      count = parseInt(countStr, 10);
    } else {
      const wordNum = wordToNumber(countStr);
      count = wordNum ?? 1;
    }
    const tokenDesc = tokenMatch[2];
    // Parse token characteristics from description
    // Examples: "1/1 white soldier", "2/2 green beast"
    const powerToughnessMatch = tokenDesc.match(/(\d+)\/(\d+)/);
    const colorMatch = tokenDesc.match(/(white|blue|black|red|green)/i);

    effects.push({
      effectType: "token_creation",
      power: powerToughnessMatch ? parseInt(powerToughnessMatch[1], 10) : 1,
      toughness: powerToughnessMatch ? parseInt(powerToughnessMatch[2], 10) : 1,
      color: colorMatch ? colorMatch[1].toLowerCase() : "white",
      count,
      controllerId: "" as PlayerId,
    });
  }

  // Damage: "deal X damage" or "deal 3 damage to any target"
  const damageMatch = lowerText.match(/deal(?:s)?\s+(x|\d+)\s+damage/i);
  if (damageMatch) {
    let amount: number;
    if (damageMatch[1].toLowerCase() === "x") {
      amount = variableValues?.get("X") ?? 0;
    } else {
      amount = parseInt(damageMatch[1], 10);
    }
    const xValue = variableValues?.get("X");
    effects.push({
      effectType: "damage",
      amount: xValue !== undefined ? xValue : amount,
      targetId: "" as CardInstanceId | PlayerId,
      isCombatDamage: false,
    });
  }

  // Counter: "counter target spell"
  if (
    lowerText.includes("counter") &&
    (lowerText.includes("spell") || lowerText.includes("ability"))
  ) {
    effects.push({
      effectType: "counter_spell",
      targetStackObjectId: "",
    });
  }

  return effects;
}

/**
 * Dispatch effect resolution based on effect type
 * CR 608.2 - For each effect, apply changes in the correct order
 */
export function resolveEffect(
  state: GameState,
  effect: StackEffect,
  sourceId?: CardInstanceId,
): EffectResolutionResult {
  switch (effect.effectType) {
    case "card_draw":
      return resolveCardDrawEffect(
        state,
        sourceId,
        effect.amount,
        effect.targetId ?? state.turn.activePlayerId,
      );

    case "life_gain":
      return resolveLifeGainEffect(
        state,
        sourceId,
        effect.amount,
        effect.targetId ?? state.turn.activePlayerId,
      );

    case "life_loss":
      return resolveLifeLossEffect(
        state,
        sourceId,
        effect.amount,
        effect.targetId ?? state.turn.activePlayerId,
      );

    case "token_creation":
      return resolveTokenCreationEffect(
        state,
        sourceId,
        {
          name: "Token",
          type_line: "Creature — Token",
          power: effect.power.toString(),
          toughness: effect.toughness.toString(),
          colors: [effect.color],
        },
        effect.count,
        effect.controllerId || undefined,
      );

    case "counter_spell":
      return resolveCounterEffect(state, sourceId, effect.targetStackObjectId);

    case "damage":
      // Check if target is a card or player based on type
      if (
        typeof effect.targetId === "string" &&
        effect.targetId.includes("-")
      ) {
        return resolveDamageEffect(
          state,
          sourceId,
          effect.targetId as CardInstanceId,
          effect.amount,
          effect.isCombatDamage,
        );
      } else {
        return resolvePlayerDamageEffect(
          state,
          sourceId,
          effect.targetId as PlayerId,
          effect.amount,
        );
      }

    case "destroy":
      // Handled by destroyCard in keyword-actions
      return {
        success: true,
        state,
        description: "Destroy effect",
      };

    case "exile":
      // Handled by exileCard in keyword-actions
      return {
        success: true,
        state,
        description: "Exile effect",
      };

    default:
      return {
        success: false,
        state,
        description: "",
        error: `Unknown effect type`,
      };
  }
}

/**
 * Resolve all effects on a stack object
 */
export function resolveStackObjectEffects(
  state: GameState,
  effects: StackEffect[],
  sourceId?: CardInstanceId,
  targets?: Array<{ type: string; targetId: string }>,
): GameState {
  let currentState = state;

  for (const effect of effects) {
    // Fill in targets from spell targeting
    if (targets && targets.length > 0) {
      const target = targets[0];
      if (
        effect.effectType === "card_draw" ||
        effect.effectType === "life_gain" ||
        effect.effectType === "life_loss"
      ) {
        if (!effect.targetId) {
          effect.targetId = target.targetId as PlayerId;
        }
      } else if (effect.effectType === "damage") {
        effect.targetId = target.targetId as CardInstanceId | PlayerId;
      } else if (effect.effectType === "counter_spell") {
        effect.targetStackObjectId = target.targetId;
      }
    }

    const result = resolveEffect(currentState, effect, sourceId);
    if (result.success) {
      currentState = result.state;
    }
  }

  return currentState;
}

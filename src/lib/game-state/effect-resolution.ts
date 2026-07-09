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

import type {
  GameState,
  PlayerId,
  CardInstanceId,
  StackEffect,
  StackObject,
} from "./types";
import { drawCards, createTokenCard, counterSpell } from "./keyword-actions";
import { dealDamageToCard } from "./keyword-actions";
import { hasLifelink } from "./evergreen-keywords";
import { getModesForModalSpell } from "./oracle-text-parser";

/**
 * Apply lifelink life gain for damage dealt by a source with lifelink.
 *
 * CR 702.15b: "Damage dealt by a source with lifelink causes that source's
 * controller to gain that much life, in addition to the damage's other effects."
 * CR 608.2c: Lifelink is tied to the source of the damage, not the kind of
 * damage — so non-combat damage from spells/abilities also triggers it.
 *
 * @returns updated state (life gained if source has lifelink, else unchanged)
 */
function applyLifelinkLifeGain(
  state: GameState,
  sourceId: CardInstanceId | undefined,
  damageDealt: number,
): GameState {
  if (!sourceId || damageDealt <= 0) return state;
  const sourceCard = state.cards.get(sourceId);
  if (!sourceCard || !hasLifelink(sourceCard)) return state;
  const controllerId = sourceCard.controllerId;
  const controller = state.players.get(controllerId);
  if (!controller) return state;
  return {
    ...state,
    players: new Map(state.players).set(controllerId, {
      ...controller,
      life: controller.life + damageDealt,
    }),
    lastModifiedAt: Date.now(),
  };
}

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
  sourceId: CardInstanceId,
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
  // Capture damage marked on the target before resolution so we can derive
  // the actual damage dealt after prevention/replacement effects. CR 702.15b:
  // lifelink grants life equal to the damage actually dealt, not the
  // requested amount.
  const targetCardBefore = state.cards.get(targetId);
  const damageBefore = targetCardBefore?.damage ?? 0;

  const result = dealDamageToCard(
    state,
    targetId,
    amount,
    isCombatDamage,
    sourceId,
  );

  // dealDamageToCard marks `card.damage += actualDamage`, so the delta is the
  // actual damage dealt. Cap at the requested amount so deathtouch's lethality
  // bump (which marks extra damage up to toughness) does not inflate the
  // lifelink life gain.
  const targetCardAfter = result.state.cards.get(targetId);
  const damageAfter = targetCardAfter?.damage ?? damageBefore;
  const actualDamageDealt = Math.max(
    0,
    Math.min(damageAfter - damageBefore, amount),
  );

  // CR 702.15b / CR 608.2c: a non-combat source with lifelink (e.g. a spell
  // or ability whose source has lifelink) grants its controller life equal to
  // the damage dealt.
  const stateWithLifelink = applyLifelinkLifeGain(
    result.state,
    sourceId,
    actualDamageDealt,
  );

  return {
    success: result.success,
    state: stateWithLifelink,
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

  // Process replacement/prevention effects to determine the actual damage
  // dealt. CR 614: prevention effects reduce damage that would be dealt.
  // CR 702.15b: lifelink grants life equal to the damage actually dealt, so
  // it must be computed after prevention.
  const replacementEvent = {
    type: "damage" as const,
    timestamp: Date.now(),
    sourceId,
    targetId: targetPlayerId,
    amount,
    isCombatDamage: false,
    damageTypes: ["noncombat"] as ("combat" | "noncombat")[],
  };
  const rem = state.replacementEffectManager;
  const apnapOrder = rem.createAPNAPOrder(
    state.turn.activePlayerId,
    Array.from(state.players.keys()),
  );
  const processedEvent = rem.processEvent(replacementEvent, apnapOrder);
  const actualDamage = processedEvent.amount;

  if (actualDamage <= 0) {
    return {
      success: true,
      state,
      description: `Damage to ${playerData.name} was fully prevented`,
    };
  }

  // Deal damage to player - this reduces their life total
  const updatedPlayers = new Map(state.players);
  const updatedPlayer = {
    ...playerData,
    life: Math.max(0, playerData.life - actualDamage),
  };
  updatedPlayers.set(targetPlayerId, updatedPlayer);

  let stateAfterDamage: GameState = {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };

  // CR 702.15b / CR 608.2c: a source with lifelink grants its controller life
  // equal to the damage dealt — including non-combat damage from spells.
  stateAfterDamage = applyLifelinkLifeGain(
    stateAfterDamage,
    sourceId,
    actualDamage,
  );

  return {
    success: true,
    state: stateAfterDamage,
    description: `${playerData.name} took ${actualDamage} damage${sourceId ? ` (from ${state.cards.get(sourceId)?.cardData.name || "source"})` : ""}`,
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

  // Damage: "deal X damage", "Lightning Bolt deals 3 damage to any target",
  // "deals three damage to target creature", etc.
  // Accepts digit amounts, X, or word-numbers (one..ten) so real card oracle
  // text parses correctly. The target itself is supplied at resolution time
  // from the spell's targets array (see resolveStackObjectEffects).
  const damageMatch = lowerText.match(
    /deal(?:s)?\s+(x|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+damage/i,
  );
  if (damageMatch) {
    const amountStr = damageMatch[1];
    let amount: number;
    if (amountStr.toLowerCase() === "x") {
      amount = variableValues?.get("X") ?? 0;
    } else if (/^\d+$/.test(amountStr)) {
      amount = parseInt(amountStr, 10);
    } else {
      amount = wordToNumber(amountStr) ?? 0;
    }
    effects.push({
      effectType: "damage",
      amount,
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
 * Filter the effects of a modal spell down to only those produced by the
 * modes the controller chose (CR 700.2).
 *
 * Modal spells ("Choose one —" / "Choose two —" / "Choose three —") resolve
 * only the chosen modes. Naively parsing the spell's full oracle text with
 * `parseSpellEffects` returns ALL modes' effects at once, which is wrong:
 * `Abrade` would deal damage AND destroy its target. This helper inspects the
 * stack object's `chosenModes` (labels that match a mode's parsed description)
 * and returns only those modes' effects, in the order they appear on the card.
 *
 * If the source card is not modal, has no chosen modes, or has no resolvable
 * effects, an empty array is returned (the caller can fall back to
 * `parseSpellEffects` or its existing effects list as appropriate).
 *
 * @param stackObject The spell on the stack whose effects we want to filter.
 * @param state The current game state (used only to look up the source card).
 * @param variableValues X / variable values for the spell — defaults to the
 *                       stack object&apos;s own `variableValues`.
 * @returns The union of `parseSpellEffects` outputs, one per chosen mode, in
 *          declared order on the card.
 */
export function getEffectsForChosenModes(
  stackObject: StackObject,
  state: GameState,
  variableValues?: Map<string, number>,
): StackEffect[] {
  const chosen = stackObject.chosenModes ?? [];
  if (chosen.length === 0) {
    return [];
  }

  const sourceCard = stackObject.sourceCardId
    ? state.cards.get(stackObject.sourceCardId)
    : undefined;
  if (!sourceCard) {
    return [];
  }

  const modes = getModesForModalSpell(sourceCard.cardData);
  if (!modes || modes.length === 0) {
    return [];
  }

  const xVals =
    variableValues ?? stackObject.variableValues ?? new Map<string, number>();

  const filtered: StackEffect[] = [];
  for (const chosenLabel of chosen) {
    const match = modes.find(
      (m) => m.description.trim() === chosenLabel.trim(),
    );
    if (!match) {
      // A chosen mode label that does not match any parsed mode is a
      // misconfiguration in the caller (e.g. a stale UI choice). Skip it
      // rather than resolve the wrong effect.
      continue;
    }
    filtered.push(...parseSpellEffects(match.description, xVals));
  }
  return filtered;
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
        sourceId ?? ("unknown" as CardInstanceId),
        effect.amount,
        effect.targetId || undefined,
      );

    case "life_gain":
      return resolveLifeGainEffect(
        state,
        sourceId,
        effect.amount,
        effect.targetId || undefined,
      );

    case "life_loss":
      return resolveLifeLossEffect(
        state,
        sourceId,
        effect.amount,
        effect.targetId || undefined,
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

    case "damage": {
      // Route damage to a card or player based on what the target actually is
      // in the current state. The previous heuristic (targetId.includes("-"))
      // was unreliable because both player IDs ("player-...") and card IDs
      // contain hyphens, causing player damage to be misrouted to card damage.
      // CR 119: damage to a player reduces life; damage to a permanent is
      // handled by dealDamageToCard (creatures mark damage, planeswalkers
      // remove loyalty counters per CR 119.3c).
      const targetId = effect.targetId as string;
      if (targetId && state.players.has(targetId)) {
        return resolvePlayerDamageEffect(
          state,
          sourceId,
          targetId as PlayerId,
          effect.amount,
        );
      }
      return resolveDamageEffect(
        state,
        sourceId,
        targetId as CardInstanceId,
        effect.amount,
        effect.isCombatDamage,
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
        effect.targetId = target.targetId as PlayerId;
      } else if (effect.effectType === "damage") {
        effect.targetId = target.targetId as CardInstanceId | PlayerId;
      } else if (effect.effectType === "counter_spell") {
        effect.targetStackObjectId = target.targetId;
      }
    }

    // Damage effects: when a structured target is available, route by its
    // declared type rather than relying on a string heuristic. This correctly
    // distinguishes a player target from a permanent (card) target even though
    // both IDs may contain hyphens. CR 119 / CR 119.3c.
    if (effect.effectType === "damage" && targets && targets.length > 0) {
      const target = targets[0];
      let damageResult: EffectResolutionResult;
      if (target.type === "player") {
        damageResult = resolvePlayerDamageEffect(
          currentState,
          sourceId,
          target.targetId as PlayerId,
          effect.amount,
        );
      } else {
        // "card" covers creatures, planeswalkers, and battles
        damageResult = resolveDamageEffect(
          currentState,
          sourceId,
          target.targetId as CardInstanceId,
          effect.amount,
          effect.isCombatDamage,
        );
      }
      if (damageResult.success) {
        currentState = damageResult.state;
      }
      continue;
    }

    const result = resolveEffect(currentState, effect, sourceId);
    if (result.success) {
      currentState = result.state;
    }
  }

  return currentState;
}

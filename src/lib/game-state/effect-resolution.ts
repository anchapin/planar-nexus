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

import { revealUntilInstantOrSorcery } from "./keyword-actions/grandeur";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  StackEffect,
  StackObject,
} from "./types";
import {
  drawCards,
  discardCards,
  createTokenCard,
  counterSpell,
  ventureIntoDungeon,
  performSurveil,
  resolveEquip,
  resolveCrew,
  transformPermanent,
  getFightDamage,
  isFightText,
} from "./keyword-actions";
import { performScry } from "./keyword-actions/scry";
import { dealDamageToCard } from "./keyword-actions";
import { hasLifelink } from "./evergreen-keywords";
import { getModesForModalSpell } from "./oracle-text-parser";
import {
  parseTargetedPTUntilEndOfTurn,
  addUntilEndOfTurnPT,
} from "./pt-until-end-of-turn";
import { evaluateInterveningIfClause } from "./abilities/evaluate";
import {
  cardsDrawnThisTurn,
  parseCountersFromDraws,
} from "./keyword-actions/cards-drawn";
import { addCounters } from "./card-instance";

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
    keywords?: string[];
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
    keywords: tokenData.keywords ?? [],
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
 * Resolve a fight (CR 701.14): each creature deals damage equal to its power
 * to the other, through the normal damage path so deathtouch and lifelink
 * apply. Powers are read before either damage event. If either creature is
 * gone or no longer a creature, no damage is dealt (701.14b) and the effect
 * still resolves.
 */
export function resolveFight(
  state: GameState,
  fighterId: CardInstanceId,
  opponentId: CardInstanceId,
): EffectResolutionResult {
  const plan = getFightDamage(state, fighterId, opponentId);
  let currentState = state;
  const affected: CardInstanceId[] = [];
  for (const hit of plan) {
    const result = resolveDamageEffect(
      currentState,
      hit.sourceId,
      hit.targetId,
      hit.amount,
      false,
    );
    if (result.success) {
      currentState = result.state;
      affected.push(hit.targetId);
    }
  }
  const a = state.cards.get(fighterId)?.cardData.name ?? "Creature";
  const b = state.cards.get(opponentId)?.cardData.name ?? "creature";
  return {
    success: true,
    state: currentState,
    description:
      plan.length > 0 ? `${a} fought ${b}` : `${a} could not fight ${b}`,
    affectedCards: affected,
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
 * Creature subtypes from a token description such as "4/4 green beast
 * creature" or "1/1 red goblin" (the text before "token"), capitalized as
 * printed. Power/toughness, colors, "and", "colorless" and the card types
 * are dropped; whatever remains before "creature" is the subtype list.
 */
export function parseTokenSubtypes(tokenDesc: string): string[] {
  const NON_SUBTYPE = new Set([
    "white",
    "blue",
    "black",
    "red",
    "green",
    "colorless",
    "and",
    "legendary",
    "artifact",
    "enchantment",
    "snow",
    "tapped",
    "untapped",
  ]);
  const beforeCreature = tokenDesc.split(/\bcreature\b/i)[0];
  return beforeCreature
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z'-]/gi, ""))
    .filter((w) => w.length > 0 && !NON_SUBTYPE.has(w.toLowerCase()))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
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
    /draw(?:s)?\s+(x|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*(?:card|cards)?/i,
  );
  if (drawMatch) {
    const amountStr = drawMatch[1];
    let amount: number;
    if (amountStr.toLowerCase() === "x") {
      amount = variableValues?.get("X") ?? 0;
    } else if (/^\d+$/.test(amountStr)) {
      amount = parseInt(amountStr, 10);
    } else {
      const wordNum = wordToNumber(amountStr);
      amount = wordNum ?? 1;
    }
    // CR 702.85 / X-spell interaction: the variableValues map on the stack
    // object always has an "X" key (castSpell seeds it with xValue, which
    // defaults to 0 for non-X spells). Falling back to xValue unconditionally
    // makes every card-draw spell draw 0 cards when xValue=0 — the parsed
    // amount is silently overridden. Only use xValue when the parsed text
    // either matches "X" (left for future X-draw support) or when no amount
    // was parsed at all; otherwise trust the parsed number.
    const xValue = variableValues?.get("X");
    const finalAmount = amount > 0 ? amount : (xValue ?? 0);
    effects.push({
      effectType: "card_draw",
      amount: finalAmount,
      targetId: "" as PlayerId, // Will be determined by target selection
    });
  }

  // Life gain: "gain X life", "you gain Y life"
  const gainLifeMatch = lowerText.match(
    /gain(?:s)?\s+(x|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life/i,
  );
  if (gainLifeMatch) {
    const amountStr = gainLifeMatch[1];
    let amount: number;
    if (amountStr.toLowerCase() === "x") {
      amount = variableValues?.get("X") ?? 0;
    } else if (/^\d+$/.test(amountStr)) {
      amount = parseInt(amountStr, 10);
    } else {
      const wordNum = wordToNumber(amountStr);
      amount = wordNum ?? 1;
    }
    // See card_draw above: only fall back to xValue when the parsed amount
    // is 0, so default castSpell behaviour (xValue=0) doesn't zero out
    // explicitly-amounted life-gain / life-loss / draw effects.
    const xValue = variableValues?.get("X");
    const finalAmount = amount > 0 ? amount : (xValue ?? 0);
    effects.push({
      effectType: "life_gain",
      amount: finalAmount,
      targetId: "" as PlayerId,
    });
  }

  // Life loss: "lose X life", "target player loses Y life"
  const loseLifeMatch = lowerText.match(
    /(?:lose|loses)\s+(x|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+life/i,
  );
  if (loseLifeMatch) {
    const amountStr = loseLifeMatch[1];
    let amount: number;
    if (amountStr.toLowerCase() === "x") {
      amount = variableValues?.get("X") ?? 0;
    } else if (/^\d+$/.test(amountStr)) {
      amount = parseInt(amountStr, 10);
    } else {
      const wordNum = wordToNumber(amountStr);
      amount = wordNum ?? 1;
    }
    const xValue = variableValues?.get("X");
    const finalAmount = amount > 0 ? amount : (xValue ?? 0);
    effects.push({
      effectType: "life_loss",
      amount: finalAmount,
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
    const subtypes = parseTokenSubtypes(tokenDesc);

    effects.push({
      effectType: "token_creation",
      power: powerToughnessMatch ? parseInt(powerToughnessMatch[1], 10) : 1,
      toughness: powerToughnessMatch ? parseInt(powerToughnessMatch[2], 10) : 1,
      color: colorMatch ? colorMatch[1].toLowerCase() : "white",
      count,
      controllerId: "" as PlayerId,
      ...(subtypes.length > 0 ? { subtypes } : {}),
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
    // CR 702.33d: "If this spell was kicked, it deals N damage instead"
    // (also "if you paid the kicker cost") replaces the base amount when the
    // spell was kicked, rather than adding the default +1 per kick.
    const kickedInsteadMatch = lowerText.match(
      /if (?:this spell was kicked|you paid the kicker cost),[^.]*?deals?\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+damage[^.]*?\binstead\b/i,
    );
    const kickedAmount = kickedInsteadMatch
      ? /^\d+$/.test(kickedInsteadMatch[1])
        ? parseInt(kickedInsteadMatch[1], 10)
        : wordToNumber(kickedInsteadMatch[1])
      : undefined;
    effects.push({
      effectType: "damage",
      amount,
      targetId: "" as CardInstanceId | PlayerId,
      isCombatDamage: false,
      ...(kickedAmount !== undefined && kickedAmount !== null
        ? { kickedAmount }
        : {}),
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

  if (lowerText.includes("venture into the dungeon")) {
    effects.push({
      effectType: "venture_dungeon",
    });
  }

  // Surveil: "surveil 2", "surveil one" (issue #2300)
  const surveilMatch = lowerText.match(
    /\bsurveil\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i,
  );
  if (surveilMatch) {
    const amountStr = surveilMatch[1];
    const amount = /^\d+$/.test(amountStr)
      ? parseInt(amountStr, 10)
      : (wordToNumber(amountStr) ?? 1);
    effects.push({ effectType: "surveil", amount });
  }

  // "Target creature gets +N/+N until end of turn" on a spell (CR 611.2a),
  // including "+X/+X" (Primal Might, issue #2451). Pushed before any fight so
  // "gets +X/+X ... Then it fights" pumps first (CR 608.2c).
  const spellPT = parseTargetedPTUntilEndOfTurn(
    oracleText,
    variableValues?.get("X") ?? 0,
  );
  if (spellPT) {
    effects.push({ effectType: "pt_until_eot", ...spellPT });
  }

  // Fight (CR 701.14): "Target creature you control fights target creature
  // an opponent controls" / "Then it fights ..." / "those creatures fight
  // each other". The fighters come from the spell's targets at resolution.
  if (isFightText(oracleText)) {
    effects.push({ effectType: "fight" });
  }
  return effects;
}

/**
 * Effects of a triggered ability's text (CR 603.3), parsed the same way as a
 * spell's. Untargeted effects that name "you" (draw, gain life, lose life,
 * create tokens) belong to the ability's controller rather than the active
 * player, so a trigger that resolves on an opponent's turn still affects the
 * right player. Targeted effects take their targets from the stack object.
 */
export function parseTriggeredAbilityEffects(
  text: string,
  controllerId: PlayerId,
): StackEffect[] {
  const lower = text.toLowerCase();
  const untargeted = !/\btarget\b/.test(lower);
  const pt = parseTargetedPTUntilEndOfTurn(text);
  const ptEffects: StackEffect[] = pt
    ? [{ effectType: "pt_until_eot", ...pt }]
    : [];
  return (
    parseSpellEffects(text)
      // The trigger's own targeted P/T change is added below (ptEffects).
      .filter((effect): boolean => effect.effectType !== "pt_until_eot")
      .map((effect): StackEffect => {
        if (
          untargeted &&
          (effect.effectType === "card_draw" ||
            effect.effectType === "life_gain") &&
          !effect.targetId
        ) {
          return { ...effect, targetId: controllerId };
        }
        if (
          untargeted &&
          effect.effectType === "life_loss" &&
          !effect.targetId &&
          /\byou lose\b/.test(lower)
        ) {
          return { ...effect, targetId: controllerId };
        }
        if (effect.effectType === "token_creation" && !effect.controllerId) {
          return { ...effect, controllerId };
        }
        return effect;
      })
      .concat(ptEffects)
      .concat(parseDiscardUnlessGraveyard(lower, controllerId))
      .concat(countersFromDrawsEffects(lower, controllerId))
  );
}

function countersFromDrawsEffects(
  lower: string,
  controllerId: PlayerId,
): StackEffect[] {
  const parsed = parseCountersFromDraws(lower, controllerId);
  return parsed ? [{ effectType: "counters_from_draws", ...parsed }] : [];
}

const NUMBER_WORDS: Record<string, number> = {
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

/**
 * "Then discard a card unless there are seven or more cards in your
 * graveyard" (Shoreline Looter's threshold rider, issue #2428).
 */
function parseDiscardUnlessGraveyard(
  lower: string,
  controllerId: PlayerId,
): StackEffect[] {
  const m = lower.match(
    /then discard (a|an|one|two|three|\d+) cards? unless there are (\w+) or more cards in your graveyard/,
  );
  if (!m) return [];
  const amount = NUMBER_WORDS[m[1]] ?? parseInt(m[1], 10);
  const minGraveyard = NUMBER_WORDS[m[2]] ?? parseInt(m[2], 10);
  if (!Number.isFinite(amount) || !Number.isFinite(minGraveyard)) return [];
  return [
    {
      effectType: "discard_unless_graveyard",
      amount,
      minGraveyard,
      playerId: controllerId,
    },
  ];
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
    case "counters_from_draws": {
      const targetId = effect.targetId;
      const target = targetId ? state.cards.get(targetId) : undefined;
      const onField = targetId
        ? (
            state.zones.get(`${effect.playerId}-battlefield`)?.cardIds ?? []
          ).includes(targetId)
        : false;
      if (!target || !targetId || !onField) {
        // CR 608.2b: an illegal target means the ability does nothing.
        return { success: true, state, description: "No legal target" };
      }
      const x = Math.max(
        0,
        cardsDrawnThisTurn(state, effect.playerId) + effect.offset,
      );
      if (x === 0) {
        return { success: true, state, description: "X is 0" };
      }
      const cards = new Map(state.cards);
      cards.set(targetId, addCounters(target, "+1/+1", x));
      return {
        success: true,
        state: { ...state, cards, lastModifiedAt: Date.now() },
        description: `Put ${x} +1/+1 counter${x === 1 ? "" : "s"} on ${target.cardData.name}`,
      };
    }

    case "discard_unless_graveyard": {
      const playerId = effect.playerId;
      if (!playerId) {
        return { success: true, state, description: "No player to discard" };
      }
      // Checked on resolution, after the draw that precedes it (CR 608.2c).
      const graveyardSize =
        state.zones.get(`${playerId}-graveyard`)?.cardIds.length ?? 0;
      if (graveyardSize >= effect.minGraveyard) {
        return {
          success: true,
          state,
          description: `No discard (${graveyardSize} cards in graveyard)`,
        };
      }
      const result = discardCards(state, playerId, effect.amount);
      return {
        success: result.success,
        state: result.state,
        description: result.description ?? `Discarded ${effect.amount}`,
        ...(result.success ? {} : { error: result.error }),
      };
    }

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
          // CR 111.4: a token's name is its subtype(s); "Token" only when the
          // oracle text named none.
          name: effect.subtypes?.length ? effect.subtypes.join(" ") : "Token",
          type_line: effect.subtypes?.length
            ? `Token Creature — ${effect.subtypes.join(" ")}`
            : "Creature — Token",
          power: effect.power.toString(),
          toughness: effect.toughness.toString(),
          colors: [effect.color],
        },
        effect.count,
        effect.controllerId || undefined,
      );

    case "counter_spell":
      return resolveCounterEffect(state, sourceId, effect.targetStackObjectId);

    case "venture_dungeon": {
      const targetPlayerId =
        effect.targetId ??
        (sourceId ? state.cards.get(sourceId)?.controllerId : undefined) ??
        state.turn.activePlayerId;
      const result = ventureIntoDungeon(
        state,
        targetPlayerId,
        effect.dungeonId,
        effect.nextRoomId,
      );
      return {
        success: result.success,
        state: result.state,
        description: result.description,
        error: result.error,
      };
    }

    case "attach": {
      const result = resolveEquip(state, effect.attachmentId, effect.targetId);
      return {
        success: result.success,
        state: result.state,
        description: result.description,
        affectedCards: result.affectedCards,
        error: result.error,
      };
    }

    case "fight": {
      if (!effect.fighterId || !effect.opponentId) {
        return {
          success: false,
          state,
          description: "",
          error: "Fight needs two creatures",
        };
      }
      return resolveFight(state, effect.fighterId, effect.opponentId);
    }

    case "crew": {
      const result = resolveCrew(state, effect.vehicleId);
      return {
        success: result.success,
        state: result.state,
        description: result.description,
        affectedCards: result.affectedCards,
        error: result.error,
      };
    }

    case "reveal_until_instant_sorcery": {
      const revealPlayerId =
        effect.targetId ??
        (sourceId ? state.cards.get(sourceId)?.controllerId : undefined) ??
        state.turn.activePlayerId;
      const result = revealUntilInstantOrSorcery(state, revealPlayerId);
      const found = result.foundCardId
        ? state.cards.get(result.foundCardId)?.cardData.name
        : null;
      return {
        success: true,
        state: result.state,
        description: found
          ? `Revealed ${result.revealed} cards and put ${found} into hand`
          : `Revealed ${result.revealed} cards and found no instant or sorcery`,
        affectedCards: result.foundCardId ? [result.foundCardId] : [],
      };
    }

    case "transform": {
      const transformId = effect.targetId ?? sourceId;
      if (!transformId) {
        return {
          success: false,
          state,
          description: "",
          error: "Nothing to transform",
        };
      }
      const result = transformPermanent(state, transformId);
      return {
        success: result.success,
        state: result.state,
        description: result.description,
        affectedCards: result.affectedCards,
        error: result.error,
      };
    }

    case "surveil": {
      const surveilPlayerId =
        effect.targetId ??
        (sourceId ? state.cards.get(sourceId)?.controllerId : undefined) ??
        state.turn.activePlayerId;
      const result = performSurveil(state, surveilPlayerId, effect.amount);
      return {
        success: result.success,
        state: result.state,
        description: result.description,
        affectedCards: result.affectedCards,
        error: result.error,
      };
    }

    case "scry": {
      const scryPlayerId =
        effect.targetId ??
        (sourceId ? state.cards.get(sourceId)?.controllerId : undefined) ??
        state.turn.activePlayerId;
      const result = performScry(state, scryPlayerId, effect.amount);
      return {
        success: result.success,
        state: result.state,
        description: result.description,
        affectedCards: result.affectedCards,
        error: result.error,
      };
    }

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

    case "pt_until_eot": {
      // CR 611.2a. With no chosen target, a targeted effect does nothing.
      if (!effect.targetId || !state.cards.has(effect.targetId)) {
        return { success: false, state, description: "", error: "No target" };
      }
      // "If <condition>, ... instead" is checked on resolution (CR 608.2c).
      const controllerId = sourceId
        ? state.cards.get(sourceId)?.controllerId
        : undefined;
      const useInstead =
        effect.instead !== undefined &&
        controllerId !== undefined &&
        evaluateInterveningIfClause(
          effect.instead.condition,
          state,
          controllerId,
        );
      const { power, toughness } = useInstead ? effect.instead! : effect;
      return {
        success: true,
        state: addUntilEndOfTurnPT(state, effect.targetId, power, toughness),
        description: `Target gets ${power >= 0 ? "+" : ""}${power}/${toughness >= 0 ? "+" : ""}${toughness} until end of turn`,
        affectedCards: [effect.targetId],
      };
    }

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
 * Apply the kicker bonus (CR 702.85) to a single effect's amount.
 *
 * CR 702.85: "You may pay an additional cost as you cast [this spell]. If you
 * paid the additional cost, the spell's additional effect occurs." For most
 * kicker / multikicker cards the additional effect scales linearly with the
 * number of times the kicker cost was paid (`timesKicked`): the bonus added
 * per kick is the engine's default `1` (e.g. +1 damage, +1 card, +1 token).
 * A damage effect parsed from "if this spell was kicked, it deals N damage
 * instead" carries `kickedAmount`, which replaces the amount outright
 * (CR 702.33d) instead of adding the default bonus.
 *
 * Returns a new effect object with the scaled amount/count when the bonus
 * applies; returns the original effect when no kicker adjustment is made.
 */
function applyKickerBonus(
  effect: StackEffect,
  kickerBonus: number,
): StackEffect {
  if (kickerBonus <= 0) return effect;
  if (effect.effectType === "damage") {
    // CR 702.33d: an explicit "deals N damage instead" replaces the amount.
    if (effect.kickedAmount !== undefined) {
      return { ...effect, amount: effect.kickedAmount };
    }
    return { ...effect, amount: effect.amount + kickerBonus };
  }
  if (effect.effectType === "card_draw") {
    return { ...effect, amount: effect.amount + kickerBonus };
  }
  if (effect.effectType === "token_creation") {
    return { ...effect, count: effect.count + kickerBonus };
  }
  return effect;
}

/**
 * Resolve all effects on a stack object.
 *
 * @param kickerBonus CR 702.85 — number of additional effects to add on top
 *   of each scalable base effect (damage, card_draw, token_creation). When
 *   the spell was kicked once, this is `1`; for multikicker it equals
 *   `timesKicked`. Default `0` (no bonus), preserving backward compat with
 *   non-kicker callers.
 */
export function resolveStackObjectEffects(
  state: GameState,
  effects: StackEffect[],
  sourceId?: CardInstanceId,
  targets?: Array<{ type: string; targetId: string }>,
  kickerBonus: number = 0,
): GameState {
  let currentState = state;

  for (const effect of effects) {
    // CR 702.85 — apply the kicker bonus once per effect so each scalable
    // effect (damage / card_draw / token_creation) gets the +N bump. The
    // bonus is taken from the stack object's `timesKicked` by the caller and
    // is `0` for non-kicker spells, which leaves every effect untouched.
    const scaledEffect =
      kickerBonus > 0 ? applyKickerBonus(effect, kickerBonus) : effect;

    // Fill in targets from spell targeting
    if (targets && targets.length > 0) {
      const target = targets[0];
      if (
        scaledEffect.effectType === "card_draw" ||
        scaledEffect.effectType === "life_gain" ||
        scaledEffect.effectType === "life_loss"
      ) {
        scaledEffect.targetId = target.targetId as PlayerId;
      } else if (scaledEffect.effectType === "damage") {
        scaledEffect.targetId = target.targetId as CardInstanceId | PlayerId;
      } else if (scaledEffect.effectType === "counter_spell") {
        scaledEffect.targetStackObjectId = target.targetId;
      } else if (
        (scaledEffect.effectType === "pt_until_eot" ||
          scaledEffect.effectType === "counters_from_draws") &&
        target.type !== "player"
      ) {
        scaledEffect.targetId = target.targetId as CardInstanceId;
      }
    }

    // Fight (CR 701.14): with two creature targets the first fights the
    // second; with one, the source permanent (e.g. an ETB "it fights target
    // creature") fights it.
    if (scaledEffect.effectType === "fight" && targets && targets.length > 0) {
      const cardTargets = targets.filter((t) => t.type !== "player");
      if (cardTargets.length >= 2) {
        scaledEffect.fighterId = cardTargets[0].targetId as CardInstanceId;
        scaledEffect.opponentId = cardTargets[1].targetId as CardInstanceId;
      } else if (cardTargets.length === 1 && sourceId) {
        scaledEffect.fighterId = sourceId;
        scaledEffect.opponentId = cardTargets[0].targetId as CardInstanceId;
      }
    }

    // Damage effects: when a structured target is available, route by its
    // declared type rather than relying on a string heuristic. This correctly
    // distinguishes a player target from a permanent (card) target even though
    // both IDs may contain hyphens. CR 119 / CR 119.3c.
    if (scaledEffect.effectType === "damage" && targets && targets.length > 0) {
      const target = targets[0];
      let damageResult: EffectResolutionResult;
      if (target.type === "player") {
        damageResult = resolvePlayerDamageEffect(
          currentState,
          sourceId,
          target.targetId as PlayerId,
          scaledEffect.amount,
        );
      } else {
        // "card" covers creatures, planeswalkers, and battles
        damageResult = resolveDamageEffect(
          currentState,
          sourceId,
          target.targetId as CardInstanceId,
          scaledEffect.amount,
          scaledEffect.isCombatDamage,
        );
      }
      if (damageResult.success) {
        currentState = damageResult.state;
      }
      continue;
    }

    const result = resolveEffect(currentState, scaledEffect, sourceId);
    if (result.success) {
      currentState = result.state;
    }
  }

  return currentState;
}

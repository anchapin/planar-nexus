/**
 * Activated and Triggered Abilities System
 *
 * This module implements the ability system for Magic: The Gathering,
 * including activated abilities, triggered abilities, and loyalty abilities.
 *
 * Reference: CR 112 - Abilities, CR 113 - Abilities, CR 603 - Triggered Abilities
 *
 * Issue #10: Phase 1.2: Implement activated and triggered abilities
 */

import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
  StackObject,
} from "./types";
import { Phase, isOnBattlefield } from "./types";
import {
  parseOracleText,
  ParsedActivatedAbility,
  ParsedTriggeredAbility,
} from "./oracle-text-parser";
import { spendMana, addMana, isManaAbility } from "./mana";
import { destroyCard, discardCards } from "./keyword-actions";

/**
 * Event types that can trigger triggered abilities (CR 603.2)
 * Used by detectTriggeredAbilities and checkTriggeredAbilities
 */
export type TriggerEvent =
  | "entersBattlefield"
  | "leavesBattlefield"
  | "damageDealt"
  | "dies"
  | "creatureDies"
  | "attacked"
  | "blocked"
  | "phaseChange"
  | "drawCard"
  | "cast"
  | "lifeGain"
  | "lifeLost"
  | "beginningOfTurn"
  | "endOfTurn"
  | "spellCast"
  | "upkeep"
  | "phaseEnds"
  | "turnEnds"
  | "turnBegins"
  | "endOfTurn"
  | "cleanupStep"
  | "stateTrigger"
  | "abilityActivated";

/**
 * Trigger condition context passed when detecting triggers.
 * Provides additional information about the event that triggered.
 */
export interface TriggerContext {
  /** The source card ID that caused this trigger (for damage, dies, etc.) */
  sourceCardId?: CardInstanceId;
  /** The amount of damage dealt (for damageDealt triggers) */
  damageAmount?: number;
  /** The target of damage (player or card) */
  damageTarget?: PlayerId | CardInstanceId;
  /** The player who lost life (for lifeLost triggers) */
  lifeLostPlayer?: PlayerId;
  /** Amount of life lost */
  lifeLostAmount?: number;
  /** The spell that was cast (for spellCast triggers) */
  spellCardId?: CardInstanceId;
}

/**
 * Result of activating an ability
 */
export interface ActivateAbilityResult {
  success: boolean;
  state: GameState;
  description: string;
  error?: string;
}

/**
 * Result of a triggered ability check
 */
export interface TriggeredAbilityResult {
  abilities: TriggeredAbilityInstance[];
  state: GameState;
}

/**
 * An instance of a triggered ability on the stack
 */
export interface TriggeredAbilityInstance {
  id: string;
  sourceCardId: CardInstanceId;
  /**
   * The player who controls the card and whose trigger fired (CR 603.3)
   */
  triggeringPlayerId: PlayerId;
  triggerCondition: string;
  effect: string;
  timestamp: number;
  /**
   * Timestamp of the source card in its zone (CR 603.3b)
   * Used for ordering abilities with the same trigger timestamp
   */
  sourceCardTimestamp: number;
  /**
   * Context information about the trigger event (CR 603.2)
   */
  context?: TriggerContext;
}

/**
 * Generate a unique ability ID
 */
function generateAbilityId(): string {
  return `ability-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a unique triggered ability ID
 */
function generateTriggeredAbilityId(): string {
  return `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse mana produced from an ability effect text
 * Handles patterns like "Add {G}", "Add {W} or {U}", "Add {R}{R}"
 */
function parseManaFromEffect(
  effectText: string,
): Partial<import("./types").ManaPool> {
  const mana: Partial<import("./types").ManaPool> = {};
  const text = effectText.toLowerCase();

  // Find all mana symbols in braces: {W}, {U}, {B}, {R}, {G}, {C}, {X}, etc.
  const symbolRegex = /\{([^}]+)\}/g;
  let match;
  while ((match = symbolRegex.exec(text)) !== null) {
    const sym = match[1].toUpperCase();
    if (sym === "W") mana.white = (mana.white || 0) + 1;
    else if (sym === "U") mana.blue = (mana.blue || 0) + 1;
    else if (sym === "B") mana.black = (mana.black || 0) + 1;
    else if (sym === "R") mana.red = (mana.red || 0) + 1;
    else if (sym === "G") mana.green = (mana.green || 0) + 1;
    else if (sym === "C") mana.colorless = (mana.colorless || 0) + 1;
    else if (/^\d+$/.test(sym))
      mana.generic = (mana.generic || 0) + parseInt(sym, 10);
  }

  return mana;
}

/**
 * Check if a card has activated abilities
 */
export function hasActivatedAbilities(card: { oracle_text?: string }): boolean {
  if (!card.oracle_text) return false;
  return card.oracle_text.includes(":");
}

// Card data interface for parsing - extends ScryfallCard with optional fields
import type { ScryfallCard } from "@/app/actions";

// Use ScryfallCard directly for parsing since parseOracleText requires it
type CardDataForParsing = ScryfallCard;

/**
 * Parse a card's activated abilities
 */
export function getActivatedAbilities(
  card: CardDataForParsing,
): ParsedActivatedAbility[] {
  if (!card.oracle_text) return [];
  return parseOracleText(card).activatedAbilities;
}

/**
 * Check if a card has triggered abilities
 */
export function hasTriggeredAbilities(card: { oracle_text?: string }): boolean {
  if (!card.oracle_text) return false;
  const text = card.oracle_text.toLowerCase();
  return (
    text.includes("when ") || text.includes("whenever ") || text.includes("at ")
  );
}

/**
 * Parse a card's triggered abilities
 */
export function getTriggeredAbilities(
  card: CardDataForParsing,
): ParsedTriggeredAbility[] {
  if (!card.oracle_text) return [];
  return parseOracleText(card).triggeredAbilities;
}

/**
 * Check if an ability can be activated
 */
export function canActivateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
): { canActivate: boolean; reason?: string } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { canActivate: false, reason: "Card not found" };
  }

  // Check if player controls the card
  if (card.controllerId !== playerId) {
    return { canActivate: false, reason: "You do not control this card" };
  }

  // Check if player has priority
  if (state.priorityPlayerId !== playerId) {
    return { canActivate: false, reason: "You do not have priority" };
  }

  // Check if card is on the battlefield
  const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone || !battlefieldZone.cardIds.includes(cardId)) {
    return { canActivate: false, reason: "Card is not on the battlefield" };
  }

  // Check for summoning sickness (unless the ability has no tap cost)
  const abilities = getActivatedAbilities(card.cardData);
  const ability = abilities[abilityIndex];

  if (ability && !ability.costs.tap && card.hasSummoningSickness) {
    // Some abilities can be activated despite summoning sickness
    // This would need more sophisticated checking
  }

  // Check if ability is already being used this turn (for limits)
  // This would require tracking ability activations per card

  return { canActivate: true };
}

/**
 * Activate an ability of a card
 */
export function activateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
  targets: { type: string; targetId: string }[] = [],
): ActivateAbilityResult {
  const card = state.cards.get(cardId);
  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: "Card not found",
    };
  }

  // Check if can activate
  const canActivate = canActivateAbility(state, playerId, cardId, abilityIndex);
  if (!canActivate.canActivate) {
    return {
      success: false,
      state,
      description: "",
      error: canActivate.reason,
    };
  }

  // Get the ability from parsed Oracle text
  const abilities = getActivatedAbilities(card.cardData);
  const ability = abilities[abilityIndex];

  if (!ability) {
    return {
      success: false,
      state,
      description: "",
      error: "Ability not found",
    };
  }

  // Pay costs
  let currentState = state;

  // Tap the card if required
  if (ability.costs.tap) {
    const updatedCard = {
      ...card,
      isTapped: true,
    };
    const updatedCards = new Map(currentState.cards);
    updatedCards.set(cardId, updatedCard);
    currentState = {
      ...currentState,
      cards: updatedCards,
    };
  }

  // Pay mana cost
  if (ability.costs.mana) {
    const manaCost = ability.costs.mana;
    const manaPayment = {
      generic: manaCost.generic,
      white: manaCost.white,
      blue: manaCost.blue,
      black: manaCost.black,
      red: manaCost.red,
      green: manaCost.green,
    };
    const manaResult = spendMana(currentState, playerId, manaPayment);
    if (!manaResult.success) {
      return {
        success: false,
        state: currentState,
        description: "",
        error: "Not enough mana",
      };
    }
    currentState = manaResult.state;
  }

  // Pay life cost
  if (ability.costs.payLife > 0) {
    const player = currentState.players.get(playerId);
    if (!player || player.life < ability.costs.payLife) {
      return {
        success: false,
        state: currentState,
        description: "",
        error: "Not enough life",
      };
    }
    const updatedPlayer = {
      ...player,
      life: player.life - ability.costs.payLife,
    };
    const updatedPlayers = new Map(currentState.players);
    updatedPlayers.set(playerId, updatedPlayer);
    currentState = {
      ...currentState,
      players: updatedPlayers,
    };
  }

  // Handle sacrifice cost
  if (ability.costs.sacrifice) {
    // Move card to graveyard
    const result = destroyCard(currentState, cardId, true);
    if (result.success) {
      currentState = result.state;
    }
  }

  // Handle discard cost
  if (ability.costs.discard) {
    const result = discardCards(currentState, playerId, 1, false);
    if (result.success) {
      currentState = result.state;
    }
  }

  // CR 605: Mana abilities don't use the stack - resolve immediately
  if (isManaAbility(cardId, ability.effect)) {
    // Parse mana produced by this ability
    const parsedMana = parseManaFromEffect(ability.effect);
    if (Object.keys(parsedMana).length > 0) {
      currentState = addMana(currentState, playerId, parsedMana);
    }

    // Mark that this player has activated a mana ability this step (CR 605.3b)
    const updatedPlayers = new Map(currentState.players);
    const player = updatedPlayers.get(playerId);
    if (player) {
      updatedPlayers.set(playerId, {
        ...player,
        hasActivatedManaAbility: true,
      });
    }

    return {
      success: true,
      state: {
        ...currentState,
        players: updatedPlayers,
        lastModifiedAt: Date.now(),
      },
      description: `Activated ${card.cardData.name}'s mana ability`,
    };
  }

  // Create stack object for the ability
  const stackZone = currentState.zones.get("stack");
  if (!stackZone) {
    return {
      success: false,
      state: currentState,
      description: "",
      error: "Stack zone not found",
    };
  }

  // Move card to stack (for abilities that go on stack)
  const battlefieldZone = currentState.zones.get(`${playerId}-battlefield`);

  let cardMovedState = currentState;
  if (battlefieldZone && battlefieldZone.cardIds.includes(cardId)) {
    // Create stack object directly without moving the card
    const stackObject: StackObject = {
      id: generateAbilityId(),
      type: "ability",
      sourceCardId: cardId,
      controllerId: playerId,
      name: `${card.cardData.name} ability`,
      text: ability.effect,
      manaCost: card.cardData.mana_cost ?? null,
      targets: targets.map((t) => ({
        type: t.type as "card" | "player" | "zone",
        targetId: t.targetId,
        isValid: true,
      })),
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: Date.now(),
    };

    const updatedStack = [...cardMovedState.stack, stackObject];

    cardMovedState = {
      ...cardMovedState,
      stack: updatedStack,
      lastModifiedAt: Date.now(),
    };
  }

  // Find next player for priority (APNAP order)
  const playerIds = Array.from(cardMovedState.players.keys());
  const currentIndex = playerIds.indexOf(playerId);
  const nextIndex = (currentIndex + 1) % playerIds.length;
  const nextPlayerId = playerIds[nextIndex];

  // Reset player's priority pass flag
  const updatedPlayers = new Map(cardMovedState.players);
  const player = updatedPlayers.get(playerId);
  if (player) {
    updatedPlayers.set(playerId, {
      ...player,
      hasPassedPriority: false,
    });
  }

  return {
    success: true,
    state: {
      ...cardMovedState,
      players: updatedPlayers,
      priorityPlayerId: nextPlayerId,
      consecutivePasses: 0,
      lastModifiedAt: Date.now(),
    },
    description: `Activated ${card.cardData.name}'s ability`,
  };
}

/**
 * Loyalty abilities for planeswalkers
 */
export interface LoyaltyAbility {
  cost: number; // Positive for adding, negative for removing
  effect: string;
}

/**
 * Get loyalty abilities for a planeswalker card
 */
export function getLoyaltyAbilities(card: {
  oracle_text?: string;
}): LoyaltyAbility[] {
  if (!card.oracle_text) return [];

  const abilities: LoyaltyAbility[] = [];
  const lines = card.oracle_text.split("\n");

  for (const line of lines) {
    // Match patterns like "+1: Draw a card" or "-3: Destroy target creature"
    const match = line.match(/^([+-]\d+):\s*(.+)/);
    if (match) {
      abilities.push({
        cost: parseInt(match[1], 10),
        effect: match[2],
      });
    }
  }

  return abilities;
}

/**
 * Check if a planeswalker can activate a loyalty ability
 */
export function canActivateLoyaltyAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityCost: number,
): { canActivate: boolean; reason?: string } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { canActivate: false, reason: "Card not found" };
  }

  // Check if card is a planeswalker
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("planeswalker")) {
    return { canActivate: false, reason: "Card is not a planeswalker" };
  }

  // Check if player controls the planeswalker
  if (card.controllerId !== playerId) {
    return {
      canActivate: false,
      reason: "You do not control this planeswalker",
    };
  }

  // Check if player has priority
  if (state.priorityPlayerId !== playerId) {
    return { canActivate: false, reason: "You do not have priority" };
  }

  // Check if card is on the battlefield
  const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone || !battlefieldZone.cardIds.includes(cardId)) {
    return {
      canActivate: false,
      reason: "Planeswalker is not on the battlefield",
    };
  }

  // Check if ability is being activated at a valid time
  const currentPhase = state.turn.currentPhase;
  if (
    currentPhase !== Phase.PRECOMBAT_MAIN &&
    currentPhase !== Phase.POSTCOMBAT_MAIN
  ) {
    return {
      canActivate: false,
      reason: "Can only activate loyalty abilities during main phases",
    };
  }

  // Check if stack is empty
  if (state.stack.length > 0) {
    return {
      canActivate: false,
      reason: "Stack must be empty to activate loyalty abilities",
    };
  }

  // Get current loyalty counter
  const loyaltyCounter = card.counters?.find((c) => c.type === "loyalty");
  const currentLoyalty = loyaltyCounter?.count || 0;

  // Check if player has enough loyalty (for costs > 0, need at least that many counters)
  if (abilityCost > 0 && currentLoyalty < abilityCost) {
    return { canActivate: false, reason: "Not enough loyalty counters" };
  }

  // For negative costs (like -3), we need at least 3 loyalty to remove
  if (abilityCost < 0 && currentLoyalty < Math.abs(abilityCost)) {
    return { canActivate: false, reason: "Not enough loyalty counters" };
  }

  return { canActivate: true };
}

/**
 * Activate a planeswalker loyalty ability
 */
export function activateLoyaltyAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
): ActivateAbilityResult {
  const card = state.cards.get(cardId);
  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: "Card not found",
    };
  }

  const abilities = getLoyaltyAbilities(card.cardData);
  const ability = abilities[abilityIndex];

  if (!ability) {
    return {
      success: false,
      state,
      description: "",
      error: "Loyalty ability not found",
    };
  }

  // Check if can activate
  const canActivate = canActivateLoyaltyAbility(
    state,
    playerId,
    cardId,
    ability.cost,
  );
  if (!canActivate.canActivate) {
    return {
      success: false,
      state,
      description: "",
      error: canActivate.reason,
    };
  }

  let currentState = state;

  // Update loyalty counter
  const loyaltyCounter = card.counters?.find((c) => c.type === "loyalty");
  const currentLoyalty = loyaltyCounter?.count || 0;
  const newLoyalty = currentLoyalty + ability.cost;

  // Remove existing loyalty counter and add new one
  const updatedCounters =
    card.counters?.filter((c) => c.type !== "loyalty") || [];
  if (newLoyalty > 0) {
    updatedCounters.push({ type: "loyalty", count: newLoyalty });
  }

  const updatedCard = {
    ...card,
    counters: updatedCounters,
  };

  const updatedCards = new Map(currentState.cards);
  updatedCards.set(cardId, updatedCard);
  currentState = {
    ...currentState,
    cards: updatedCards,
    lastModifiedAt: Date.now(),
  };

  // Execute the effect based on ability.effect
  // This would parse the effect text and apply it
  const effectDescription = `Activated ${card.cardData.name} loyalty ability (${ability.cost >= 0 ? "+" : ""}${ability.cost}: ${ability.effect})`;

  // Pass priority after activating loyalty ability
  const playerIds = Array.from(currentState.players.keys());
  const currentIndex = playerIds.indexOf(playerId);
  const nextPlayerId = playerIds[(currentIndex + 1) % playerIds.length];

  return {
    success: true,
    state: {
      ...currentState,
      priorityPlayerId: nextPlayerId,
    },
    description: effectDescription,
  };
}

/**
 * Detect triggered abilities matching a game event (CR 603.2)
 *
 * This is the primary entry point for detecting triggered abilities.
 * It scans the battlefield for cards with "when"/"whenever"/"at" clauses
 * and returns abilities whose trigger conditions match the given event.
 *
 * @param state - Current game state
 * @param event - The game event to check triggers against
 * @param context - Optional context about the trigger event (source of damage, amounts, etc.)
 * @returns Array of TriggeredAbilityInstance that should fire
 */
export function detectTriggeredAbilities(
  state: GameState,
  event: TriggerEvent,
  context?: TriggerContext,
): TriggeredAbilityInstance[] {
  const triggeredAbilities: TriggeredAbilityInstance[] = [];

  // Check each card on the battlefield for triggered abilities
  for (const [cardId, card] of state.cards) {
    // Skip if card is not on battlefield
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilities(card.cardData);

    for (const ability of abilities) {
      let shouldTrigger = false;

      // Check if the trigger condition matches the event (CR 603.2)
      switch (event) {
        case "entersBattlefield":
          shouldTrigger = ability.trigger.event === "entersBattlefield";
          break;
        case "leavesBattlefield":
          shouldTrigger =
            ability.trigger.event === "leavesBattlefield" ||
            ability.trigger.event === "dies";
          break;
        case "damageDealt":
          shouldTrigger = ability.trigger.event === "damageDealt";
          break;
        case "dies":
        case "creatureDies":
          shouldTrigger = ability.trigger.event === "dies";
          break;
        case "attacked":
          shouldTrigger = ability.trigger.event === "attacked";
          break;
        case "phaseChange":
        case "beginningOfTurn":
          shouldTrigger =
            ability.trigger.event === "upkeep" ||
            ability.trigger.event === "phaseEnds" ||
            ability.trigger.event === "turnEnds" ||
            ability.trigger.event === "turnBegins" ||
            ability.trigger.event === "beginningOfTurn";
          break;
        case "endOfTurn":
          shouldTrigger =
            ability.trigger.event === "turnEnds" ||
            ability.trigger.event === "phaseEnds" ||
            ability.trigger.event === "endOfTurn" ||
            ability.trigger.event === "cleanupStep";
          break;
        case "drawCard":
          // TriggerCondition uses "drawStep" not "drawCard"
          shouldTrigger = ability.trigger.event === "drawStep";
          break;
        case "cast":
        case "spellCast":
          shouldTrigger =
            ability.trigger.event === "cast" ||
            ability.trigger.event === "spellCast" ||
            ability.trigger.event === "abilityActivated";
          break;
        case "lifeGain":
          shouldTrigger = ability.trigger.event === "lifeGain";
          break;
        case "lifeLost":
          shouldTrigger = ability.trigger.event === "lifeLost";
          break;
      }

      // Apply additional conditions based on trigger type (CR 603.2)
      if (shouldTrigger && ability.interveningIf) {
        // Handle "when X if Y" clauses - check condition
        shouldTrigger = evaluateInterveningIf(
          ability.interveningIf,
          state,
          card,
          context,
        );
      }

      if (shouldTrigger) {
        const sourceCardTimestamp = card.enteredBattlefieldTimestamp;
        triggeredAbilities.push({
          id: generateTriggeredAbilityId(),
          sourceCardId: cardId,
          triggeringPlayerId: card.controllerId,
          triggerCondition: ability.trigger.event,
          effect: ability.effect,
          timestamp: Date.now(),
          sourceCardTimestamp,
          context,
        });
      }
    }
  }

  // Sort triggered abilities according to CR 603.3:
  // 603.3a: Abilities that trigger at the same time are put on the stack in APNAP order
  //         Active player puts their abilities on stack first (in any order they choose)
  //         Non-active players follow in turn order
  // 603.3b: Abilities with the same timestamp are ordered by the cards timestamp in the zone
  triggeredAbilities.sort((a, b) => {
    const activePlayerId = state.turn.activePlayerId;
    const playerIds = Array.from(state.players.keys());

    // Check if a or b is the active player
    const aIsActive = a.triggeringPlayerId === activePlayerId;
    const bIsActive = b.triggeringPlayerId === activePlayerId;

    // Active player abilities go first (CR 603.3a)
    if (aIsActive && !bIsActive) return -1;
    if (!aIsActive && bIsActive) return 1;

    // Both are active player's abilities - use sourceCardTimestamp (CR 603.3b)
    if (aIsActive && bIsActive) {
      if (a.sourceCardTimestamp !== b.sourceCardTimestamp) {
        return a.sourceCardTimestamp - b.sourceCardTimestamp;
      }
      return 0;
    }

    // Both are non-active players - use turn order (CR 603.3a)
    // Get turn order position for non-active players
    const activeIndex = playerIds.indexOf(activePlayerId);
    const aPosition =
      (playerIds.indexOf(a.triggeringPlayerId) -
        activeIndex +
        playerIds.length) %
      playerIds.length;
    const bPosition =
      (playerIds.indexOf(b.triggeringPlayerId) -
        activeIndex +
        playerIds.length) %
      playerIds.length;

    if (aPosition !== bPosition) {
      return aPosition - bPosition;
    }

    // Same non-active player - use sourceCardTimestamp (CR 603.3b)
    if (a.sourceCardTimestamp !== b.sourceCardTimestamp) {
      return a.sourceCardTimestamp - b.sourceCardTimestamp;
    }

    return 0;
  });

  return triggeredAbilities;
}

/**
 * Evaluate an intervening "if" condition for a triggered ability (CR 603.2)
 * Intervening if clauses are conditions that must be true at the time of trigger
 * Example: "When X enters the battlefield, if Y, draw a card."
 */
function evaluateInterveningIf(
  condition: string,
  state: GameState,
  _card: CardInstance,
  context?: TriggerContext,
): boolean {
  const lowerCondition = condition.toLowerCase();

  // Check life total conditions
  // Example: "if you have 10 or less life"
  const lifeMatch = lowerCondition.match(/you have (\d+) or less life/);
  if (lifeMatch) {
    const threshold = parseInt(lifeMatch[1], 10);
    // The triggering player is the controller of the card with this trigger
    // We need to find the controller - for now, check the context player
    const playerId = context?.lifeLostPlayer || state.turn.activePlayerId;
    const player = state.players.get(playerId);
    if (player) {
      return player.life <= threshold;
    }
    return false;
  }

  // Check other conditions - for now, default to true
  // This is a simplified implementation; full implementation would need
  // to handle all possible intervening if conditions
  return true;
}

/**
 * Check for triggered abilities and put them on the stack
 * This should be called after any game event (e.g., card enters battlefield, damage is dealt)
 *
 * @deprecated Use detectTriggeredAbilities() for detection only, then put on stack manually.
 *             TODO(#763): Migrate all callers to use detectTriggeredAbilities() + stack management.
 *             Once all callers are migrated, remove this function.
 */
export function checkTriggeredAbilities(
  state: GameState,
  event: TriggerEvent,
  context?: TriggerContext,
): TriggeredAbilityResult {
  const triggeredAbilities = detectTriggeredAbilities(state, event, context);

  // Put triggered abilities on the stack
  let currentState = state;

  for (const trigger of triggeredAbilities) {
    const card = state.cards.get(trigger.sourceCardId);
    if (!card) continue;

    // Create stack object for the triggered ability
    const stackObject: StackObject = {
      id: trigger.id,
      type: "ability",
      sourceCardId: trigger.sourceCardId,
      controllerId: card.controllerId,
      name: `${card.cardData.name} triggered ability`,
      text: trigger.effect,
      manaCost: null,
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: trigger.timestamp,
    };

    const updatedStack = [...currentState.stack, stackObject];
    currentState = {
      ...currentState,
      stack: updatedStack,
    };
  }

  return {
    abilities: triggeredAbilities,
    state: currentState,
  };
}

/**
 * Check if a card can attack or block
 * Note: canAttack function is currently commented out pending implementation
 */
// export function canAttack(
//   state: GameState,
//   attackerId: CardInstanceId,
//   defenderId: PlayerId
// ): { canAttack: boolean; reason?: string } {
//   const card = state.cards.get(attackerId);
//   if (!card) {
//     return { canAttack: false, reason: 'Card not found' };
//   }
//   // ... (rest of implementation)
//   return { canAttack: true };
// }

/**
 * Check if a creature can block
 * Note: canBlock function is currently commented out pending implementation
 */
// export function canBlock(
//   state: GameState,
//   blockerId: CardInstanceId,
//   attackerId?: CardInstanceId
// ): { canBlock: boolean; reason?: string } {
//   const card = state.cards.get(blockerId);
//   if (!card) {
//     return { canBlock: false, reason: 'Card not found' };
//   }
//   // ... (rest of implementation)
//   return { canBlock: true };
// }

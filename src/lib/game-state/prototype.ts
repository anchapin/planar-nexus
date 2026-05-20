/**
 * Prototype Keyword System
 *
 * Implements the Prototype keyword ability per MTG Comprehensive Rules 702.152.
 *
 * CR 702.152 Prototype:
 * - Prototype is a static ability
 * - Format: "Prototype [cost] — [power]/[toughness]"
 * - Allows casting a copy of the card with different P/T and mana cost
 * - When the prototype permanent enters the battlefield, it enters with prototype values
 *
 * Reference: https://cards.highflip.dev/rule/702.152
 */

import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
} from "./types";
import type { ScryfallCard } from "@/app/actions";
import {
  parsePrototype,
  parseManaCost,
  type PrototypeInfo,
  type ParsedManaCost,
} from "./oracle-text-parser";
import { createCardInstance } from "./card-instance";
import { canAffordMana } from "./mana";

/**
 * Check if a card has the Prototype keyword
 * CR 702.152
 */
export function hasPrototype(card: CardInstance): boolean {
  const keywords = card.cardData.keywords || [];
  return keywords.includes("Prototype");
}

/**
 * Get prototype info for a card
 */
export function getPrototypeInfo(card: CardInstance): PrototypeInfo {
  return parsePrototype(card.cardData.oracle_text || "");
}

/**
 * Check if a card with prototype can be cast as a prototype
 */
export function canCastAsPrototype(
  state: GameState,
  playerId: PlayerId,
  cardInstanceId: CardInstanceId,
): { canCast: boolean; reason?: string } {
  const card = state.cards.get(cardInstanceId);

  if (!card) {
    return { canCast: false, reason: "Card not found" };
  }

  const prototypeInfo = getPrototypeInfo(card);

  if (!prototypeInfo.hasPrototype) {
    return { canCast: false, reason: "Card does not have prototype" };
  }

  // Check if player has priority
  if (state.priorityPlayerId !== playerId) {
    return { canCast: false, reason: "You do not have priority" };
  }

  // Check if card is in hand
  const handZone = state.zones.get(`${playerId}-hand`);
  if (!handZone || !handZone.cardIds.includes(cardInstanceId)) {
    return { canCast: false, reason: "Card is not in hand" };
  }

  // Check mana cost (prototype version) - pure check, no state mutation
  if (prototypeInfo.prototypeManaCostParsed) {
    const canAfford = canAffordMana(
      state,
      playerId,
      prototypeInfo.prototypeManaCostParsed,
    );
    if (!canAfford) {
      return { canCast: false, reason: "Not enough mana for prototype cost" };
    }
  }

  return { canCast: true };
}

/**
 * Create a prototype version of a card with alternative P/T and mana cost
 * This is used when casting a card as a prototype
 */
export function createPrototypeCard(
  cardData: ScryfallCard,
  ownerId: PlayerId,
  controllerId: PlayerId,
  prototypeInfo: PrototypeInfo,
): CardInstance {
  // Create a modified card data with prototype values
  // The prototype form has different P/T in the type line
  const prototypeCardData: ScryfallCard = {
    ...cardData,
    // Prototype enters with alternative power/toughness
    // We store the original on the card but use prototype values for the permanent
  };

  return createCardInstance(prototypeCardData, ownerId, controllerId, {
    isPrototype: true,
    prototypePower: prototypeInfo.prototypePower,
    prototypeToughness: prototypeInfo.prototypeToughness,
    prototypeManaCost: prototypeInfo.prototypeManaCost,
  });
}

/**
 * Get the effective power for a creature (considering prototype status)
 * CR 613 - Interaction of Continuous Effects
 */
export function getPrototypePower(card: CardInstance): number | null {
  // If prototype is active and has prototype power, use that
  if (card.isPrototype && card.prototypePower !== null) {
    return card.prototypePower;
  }

  // Otherwise use normal power from card data
  const powerStr = card.cardData.power;
  if (!powerStr) return null;

  // Handle variable power like "*"
  if (powerStr === "*") return 0;

  return parseInt(powerStr, 10);
}

/**
 * Get the effective toughness for a creature (considering prototype status)
 * CR 613 - Interaction of Continuous Effects
 */
export function getPrototypeToughness(card: CardInstance): number | null {
  // If prototype is active and has prototype toughness, use that
  if (card.isPrototype && card.prototypeToughness !== null) {
    return card.prototypeToughness;
  }

  // Otherwise use normal toughness from card data
  const toughnessStr = card.cardData.toughness;
  if (!toughnessStr) return null;

  // Handle variable toughness like "*"
  if (toughnessStr === "*") return 0;

  return parseInt(toughnessStr, 10);
}

/**
 * Get the effective mana cost for a card (considering prototype status)
 */
export function getPrototypeManaCost(card: CardInstance): string | null {
  if (card.isPrototype && card.prototypeManaCost) {
    return card.prototypeManaCost;
  }
  return card.cardData.mana_cost || null;
}

/**
 * Transform a prototype card back to its normal form
 * (For prototype permanents that should revert after some effect)
 * Note: Per CR 702.152, prototype changes are not switching back
 */
export function transformFromPrototype(card: CardInstance): CardInstance {
  if (!card.isPrototype) {
    return card;
  }

  return {
    ...card,
    isPrototype: false,
    prototypePower: null,
    prototypeToughness: null,
    prototypeManaCost: null,
  };
}

/**
 * Check if a card is currently a prototype permanent
 */
export function isPrototypePermanent(card: CardInstance): boolean {
  return card.isPrototype;
}

/**
 * Derive prototype metadata for a card and store it on the card instance.
 * Per CR 702.152, isPrototype should only be set when the card is actually
 * cast as a prototype - not during initialization.
 */
export function initializePrototype(card: CardInstance): CardInstance {
  const prototypeInfo = getPrototypeInfo(card);

  if (!prototypeInfo.hasPrototype) {
    return card;
  }

  return {
    ...card,
    // Note: isPrototype is NOT set here - it is set at cast time
    // when the card is actually played as a prototype
    prototypePower: prototypeInfo.prototypePower,
    prototypeToughness: prototypeInfo.prototypeToughness,
    prototypeManaCost: prototypeInfo.prototypeManaCost,
  };
}

/**
 * Get the mana cost object for a card, considering prototype status
 * Returns the prototype mana cost if the card is a prototype permanent,
 * otherwise returns the normal mana cost
 */
export function getPrototypeManaCostForSpell(
  card: CardInstance,
): ParsedManaCost | null {
  // If prototype is active and has prototype mana cost, use that
  if (card.isPrototype && card.prototypeManaCost) {
    return parseManaCost(card.prototypeManaCost);
  }
  // Otherwise use normal mana cost parsing
  return parseManaCost(card.cardData.mana_cost || "");
}

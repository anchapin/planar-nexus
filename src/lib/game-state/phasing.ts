/**
 * Phasing System
 * Implements CR 702.19 - Phasing
 *
 * Key behaviors:
 * 1. When a permanent phases out, it becomes invisible and can't be targeted
 * 2. Phased out permanents are ignored in combat
 * 3. Attachments to a phasing permanent also phase out with it
 * 4. When a permanent phases in, it retains "phased out" status tracking
 * 5. Effects that care about "phased out" permanents work correctly
 */

import type { CardInstance, CardInstanceId, GameState, PlayerId } from "./types";
import { ZoneType, isOnBattlefield } from "./types";
import { phaseOut as phaseOutCard, phaseIn as phaseInCard } from "./card-instance";

/**
 * Result of a phasing action
 */
export interface PhasingResult {
  success: boolean;
  state: GameState;
  description: string;
  phasedCardIds: CardInstanceId[];
}

/**
 * Check if a card has the phasing keyword ability
 * CR 702.19: "Phasing" means...
 */
export function hasPhasing(card: CardInstance): boolean {
  const keywords = card.cardData?.keywords || [];
  return keywords.some(
    (k) => k.toLowerCase() === "phasing"
  );
}

/**
 * Check if a card is currently phased out
 */
export function isPhasedOut(card: CardInstance): boolean {
  return card.isPhasedOut;
}

/**
 * Check if a card has ever been phased out (for effects that care)
 * CR 702.19: "Each of the [phased-out] permanents... retains this change"
 */
export function hasBeenPhasedOut(card: CardInstance): boolean {
  // Track this via a flag that persists even when phased in
  return card._hasBeenPhasedOut === true;
}

/**
 * Get all cards that would phase out with a given host card
 * (attachments, tokens created by it, etc.)
 */
export function getCardsThatPhaseWithHost(
  state: GameState,
  hostId: CardInstanceId
): CardInstanceId[] {
  const cardsToPhase: CardInstanceId[] = [];
  const hostCard = state.cards.get(hostId);

  if (!hostCard) {
    return cardsToPhase;
  }

  // Phase out all attachments to this card
  for (const attachedId of hostCard.attachedCardIds) {
    const attachedCard = state.cards.get(attachedId);
    if (attachedCard && isOnBattlefield(state, attachedId)) {
      cardsToPhase.push(attachedId);
      // Recursively phase out anything attached to the attachment
      cardsToPhase.push(...getCardsThatPhaseWithHost(state, attachedId));
    }
  }

  return cardsToPhase;
}

/**
 * Phase out a permanent and all its attachments
 * CR 702.19: "Phased-out permanents are treated as though they don't exist.
 * ...any permanents attached to [it] phase out at the same time."
 */
export function phaseOutWithAttachments(
  state: GameState,
  cardId: CardInstanceId
): PhasingResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "Card not found",
      phasedCardIds: [],
    };
  }

  if (card.isPhasedOut) {
    return {
      success: false,
      state,
      description: "Card is already phased out",
      phasedCardIds: [],
    };
  }

  // Get all cards that phase out with this host (attachments)
  const cardsToPhase = [cardId, ...getCardsThatPhaseWithHost(state, cardId)];

  const updatedCards = new Map(state.cards);
  const phasedCardIds: CardInstanceId[] = [];

  for (const id of cardsToPhase) {
    const c = updatedCards.get(id);
    if (c) {
      // Mark as phased out AND record that it has been phased out
      updatedCards.set(id, {
        ...phaseOutCard(c),
        _hasBeenPhasedOut: true,
      });
      phasedCardIds.push(id);
    }
  }

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
    },
    description: `${card.cardData.name} and ${phasedCardIds.length - 1} attached permanents phase out`,
    phasedCardIds,
  };
}

/**
 * Phase in a permanent
 * CR 702.19: "A permanent that phases back in..."
 * retains "phased out" status for effects that care
 */
export function phaseInPermanent(
  state: GameState,
  cardId: CardInstanceId
): PhasingResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "Card not found",
      phasedCardIds: [],
    };
  }

  if (!card.isPhasedOut) {
    return {
      success: false,
      state,
      description: "Card is not phased out",
      phasedCardIds: [],
    };
  }

  const updatedCard = {
    ...phaseInCard(card),
    // Preserve that this card HAS been phased out (for effects that track this)
    _hasBeenPhasedOut: true,
  };

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
    },
    description: `${card.cardData.name} phases in`,
    phasedCardIds: [cardId],
  };
}

/**
 * Phase in a permanent and all permanents attached to it that are also phased out
 * (CR 702.19 doesn't explicitly require this, but it's the logical consequence)
 */
export function phaseInWithAttachments(
  state: GameState,
  cardId: CardInstanceId
): PhasingResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "Card not found",
      phasedCardIds: [],
    };
  }

  if (!card.isPhasedOut) {
    return {
      success: false,
      state,
      description: "Card is not phased out",
      phasedCardIds: [],
    };
  }

  // Get all attachments that are also phased out
  const cardsToPhaseIn: CardInstanceId[] = [cardId];
  for (const attachedId of card.attachedCardIds) {
    const attachedCard = state.cards.get(attachedId);
    if (attachedCard && attachedCard.isPhasedOut) {
      cardsToPhaseIn.push(attachedId);
    }
  }

  const updatedCards = new Map(state.cards);
  const phasedCardIds: CardInstanceId[] = [];

  for (const id of cardsToPhaseIn) {
    const c = updatedCards.get(id);
    if (c) {
      updatedCards.set(id, {
        ...phaseInCard(c),
        _hasBeenPhasedOut: true, // Preserve history
      });
      phasedCardIds.push(id);
    }
  }

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
    },
    description: `${card.cardData.name} and ${phasedCardIds.length - 1} attached permanents phase in`,
    phasedCardIds,
  };
}

/**
 * Check if a card can be targeted (considers phasing)
 * CR 702.19: "A phased-out permanent can't be targeted"
 */
export function canBeTargeted(
  state: GameState,
  cardId: CardInstanceId
): { canTarget: boolean; reason?: string } {
  const card = state.cards.get(cardId);

  if (!card) {
    return { canTarget: false, reason: "Card not found" };
  }

  if (card.isPhasedOut) {
    return { canTarget: false, reason: "Card is phased out" };
  }

  return { canTarget: true };
}

/**
 * Check if a card can attack or block (considers phasing)
 * CR 702.19: "A phased-out permanent is ignored in combat"
 */
export function canParticipateInCombat(
  state: GameState,
  cardId: CardInstanceId
): { canParticipate: boolean; reason?: string } {
  const card = state.cards.get(cardId);

  if (!card) {
    return { canParticipate: false, reason: "Card not found" };
  }

  if (card.isPhasedOut) {
    return { canParticipate: false, reason: "Card is phased out" };
  }

  return { canParticipate: true };
}

/**
 * Get all non-phased permanents on the battlefield for a player
 * Used for targeting validation and combat
 */
export function getVisiblePermanents(
  state: GameState,
  playerId: PlayerId
): CardInstance[] {
  const battlefieldKey = `${playerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldKey);

  if (!battlefield) {
    return [];
  }

  return battlefield.cardIds
    .map((id) => state.cards.get(id))
    .filter((card): card is CardInstance => card !== undefined && !card.isPhasedOut);
}

/**
 * Get all non-phased creatures on the battlefield for a player
 * Used for combat declaration
 */
export function getVisibleCreatures(
  state: GameState,
  playerId: PlayerId
): CardInstance[] {
  return getVisiblePermanents(state, playerId).filter(
    (card) => card.cardData.type_line?.toLowerCase().includes("creature")
  );
}

/**
 * Check if an aura can legally enchant its target
 * CR 704.5m is handled in state-based-actions, but we also need to
 * prevent enchanting phased-out permanents
 */
export function canEnchant(
  state: GameState,
  auraId: CardInstanceId,
  targetId: CardInstanceId
): { canEnchant: boolean; reason?: string } {
  const target = state.cards.get(targetId);

  if (!target) {
    return { canEnchant: false, reason: "Target not found" };
  }

  if (target.isPhasedOut) {
    return { canEnchant: false, reason: "Cannot enchant a phased-out permanent" };
  }

  // Additional aura enchanting rules would go here
  return { canEnchant: true };
}

/**
 * Apply phasing during the untap step
 * CR 702.19: "At the beginning of your untap step..."
 * permanents with phasing phase out
 */
export function processPhasingAtUntapStep(
  state: GameState,
  activePlayerId: PlayerId
): { state: GameState; descriptions: string[] } {
  const descriptions: string[] = [];
  const battlefieldKey = `${activePlayerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldKey);

  if (!battlefield) {
    return { state, descriptions };
  }

  const updatedCards = new Map(state.cards);
  let updated = false;

  for (const cardId of battlefield.cardIds) {
    const card = state.cards.get(cardId);
    if (card && !card.isPhasedOut && hasPhasing(card)) {
      // Phase out this card and its attachments
      const result = phaseOutWithAttachments(
        { ...state, cards: updatedCards },
        cardId
      );
      updatedCards.set(cardId, result.state.cards.get(cardId)!);
      descriptions.push(`${card.cardData.name} phases out`);
      updated = true;
    }
  }

  if (!updated) {
    return { state, descriptions };
  }

  return {
    state: { ...state, cards: updatedCards },
    descriptions,
  };
}

/**
 * Apply phasing during the active player's untap step to phase things back in
 * This happens when a phased-out permanent's controller's turn begins
 * CR 702.19: "At the beginning of your untap step, you may phase in..."
 * Note: This is optional for tapped permanents but automatic for phased-out
 */
export function processPhasingInAtUntapStep(
  state: GameState,
  activePlayerId: PlayerId
): { state: GameState; descriptions: string[] } {
  const descriptions: string[] = [];
  const battlefieldKey = `${activePlayerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldKey);

  if (!battlefield) {
    return { state, descriptions };
  }

  const updatedCards = new Map(state.cards);
  let updated = false;

  for (const cardId of battlefield.cardIds) {
    const card = state.cards.get(cardId);
    if (card && card.isPhasedOut) {
      // Phase in this card and its attachments
      const result = phaseInWithAttachments(
        { ...state, cards: updatedCards },
        cardId
      );
      const updatedCard = result.state.cards.get(cardId);
      if (updatedCard) {
        updatedCards.set(cardId, updatedCard);
        descriptions.push(`${card.cardData.name} phases in`);
        updated = true;
      }
    }
  }

  if (!updated) {
    return { state, descriptions };
  }

  return {
    state: { ...state, cards: updatedCards },
    descriptions,
  };
}
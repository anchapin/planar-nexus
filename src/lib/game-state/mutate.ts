/**
 * Mutate Mechanic (CR 702.140)
 *
 * When a mutate card merges onto a creature:
 * - Result uses top card characteristics
 * - Merged creature text includes text from component with highest converted mana cost
 * - Color exceptions (except for color) should be handled
 * - If mutating onto non-creature, the result is the mutate card characteristics
 */

import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
} from "./types";
import { getManaValue } from "./card-instance";

/**
 * Check if a card has the mutate ability
 * CR 702.140: Mutate is a keyword ability
 */
export function hasMutate(card: {
  keywords?: string[];
  oracle_text?: string;
}): boolean {
  if (card.keywords?.includes("Mutate")) {
    return true;
  }
  // Fallback to oracle text check
  return card.oracle_text?.toLowerCase().includes("mutate") || false;
}

/**
 * Check if a card can be cast using mutate (on a creature you control)
 * CR 702.140: You may cast this card for its mutate cost to merge it with a creature you control
 */
export function canCastWithMutate(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  targetCreatureId: CardInstanceId,
): { canCast: boolean; reason?: string } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { canCast: false, reason: "Card not found" };
  }

  // Check if the card has mutate
  if (!hasMutate(card.cardData)) {
    return { canCast: false, reason: "Card does not have mutate ability" };
  }

  // Check if target is a creature
  const targetCard = state.cards.get(targetCreatureId);
  if (!targetCard) {
    return { canCast: false, reason: "Target creature not found" };
  }

  const typeLine = targetCard.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("creature")) {
    return { canCast: false, reason: "Target is not a creature" };
  }

  // CR 702.140b — Mutate cannot target a Human. "You can't mutate onto a
  // Human." The restriction is on the type line (a "Creature — Human" or
  // any creature with the Human subtype is an illegal mutate target).
  if (typeLine.includes("human")) {
    return { canCast: false, reason: "Cannot mutate onto a Human" };
  }

  // Check if player controls the target creature
  if (targetCard.controllerId !== playerId) {
    return { canCast: false, reason: "You do not control this creature" };
  }

  // Check if player has priority
  if (state.priorityPlayerId !== playerId) {
    return { canCast: false, reason: "Player does not have priority" };
  }

  return { canCast: true };
}

/**
 * Apply mutate merge to a creature
 * CR 702.140: The resulting permanent uses the top card's characteristics
 * but its text includes text from all components (from highest CMC component)
 *
 * @param state - Current game state
 * @param mutateCardId - The card being mutated onto the creature
 * @param targetCreatureId - The creature to mutate onto
 * @returns Updated game state with merged creature
 */
export function applyMutate(
  state: GameState,
  mutateCardId: CardInstanceId,
  targetCreatureId: CardInstanceId,
): { success: boolean; state: GameState; error?: string } {
  const mutateCard = state.cards.get(mutateCardId);
  const targetCreature = state.cards.get(targetCreatureId);

  if (!mutateCard || !targetCreature) {
    return { success: false, state, error: "Card not found" };
  }

  // Get CMC of both cards
  const mutateCMC = getManaValue(mutateCard);
  const targetCMC = getManaValue(targetCreature);

  // Determine the highest CMC component for text merging
  const highestCmcComponentId =
    mutateCMC >= targetCMC ? mutateCardId : targetCreatureId;

  // Create updated cards map
  const updatedCards = new Map(state.cards);

  // Update the target creature with merge info
  const updatedTarget: CardInstance = {
    ...targetCreature,
    mutatedCardIds: [...targetCreature.mutatedCardIds, mutateCardId],
    // If mutating onto a non-creature, the result would use mutate card characteristics
    // But since we're mutating onto a creature, we keep creature type
    isMutated: true,
    highestCmcComponentId,
  };

  // Update the mutate card
  const updatedMutate: CardInstance = {
    ...mutateCard,
    mutateBaseId: targetCreatureId,
    isMutated: true,
    highestCmcComponentId,
    controllerId: targetCreature.controllerId, // Merge transfers control
    ownerId: targetCreature.ownerId, // But ownership stays
  };

  updatedCards.set(targetCreatureId, updatedTarget);
  updatedCards.set(mutateCardId, updatedMutate);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
  };
}

/**
 * Get the display characteristics for a mutated creature
 * CR 702.140: Result uses top card characteristics
 *
 * For a mutated creature stack, the "top" card is the one that was
 * most recently mutated onto the stack (last in mutatedCardIds order)
 */
export function getMutatedCreatureTopCard(
  state: GameState,
  baseCreatureId: CardInstanceId,
): CardInstance | null {
  const baseCreature = state.cards.get(baseCreatureId);
  if (!baseCreature) return null;

  // If no mutated cards, return the base creature
  if (baseCreature.mutatedCardIds.length === 0) {
    return baseCreature;
  }

  // The top card is the last one in the mutatedCardIds array
  const topCardId =
    baseCreature.mutatedCardIds[baseCreature.mutatedCardIds.length - 1];
  return state.cards.get(topCardId) || null;
}

/**
 * Get the text for a mutated creature
 * CR 702.140: Text includes text from all components in the mutate stack.
 * The text of each component is combined, starting with the highest CMC component.
 */
export function getMutatedCreatureText(
  state: GameState,
  baseCreatureId: CardInstanceId,
): string {
  const baseCreature = state.cards.get(baseCreatureId);
  if (!baseCreature) return "";

  const stack = getMutatedStack(state, baseCreatureId);
  if (stack.length === 0) return "";

  // Sort by CMC descending to get text priority order
  const sortedStack = [...stack].sort((a, b) => {
    const cmcA = getManaValue(a);
    const cmcB = getManaValue(b);
    return cmcB - cmcA;
  });

  // Combine text from all components, highest CMC first
  const textParts: string[] = [];
  for (const card of sortedStack) {
    if (card.cardData.oracle_text) {
      textParts.push(card.cardData.oracle_text);
    }
  }

  return textParts.join("\n\n");
}

/**
 * Get all cards in a mutated stack
 */
export function getMutatedStack(
  state: GameState,
  baseCreatureId: CardInstanceId,
): CardInstance[] {
  const baseCreature = state.cards.get(baseCreatureId);
  if (!baseCreature) return [];

  const stack: CardInstance[] = [baseCreature];

  for (const mutatedId of baseCreature.mutatedCardIds) {
    const mutatedCard = state.cards.get(mutatedId);
    if (mutatedCard) {
      stack.push(mutatedCard);
    }
  }

  return stack;
}

/**
 * Check if a card is part of a mutate stack (either base or component)
 */
export function isPartOfMutateStack(
  state: GameState,
  cardId: CardInstanceId,
): boolean {
  const card = state.cards.get(cardId);
  if (!card) return false;

  // If this card has others mutated onto it
  if (card.mutatedCardIds.length > 0) return true;

  // If this card is mutated onto another
  if (card.mutateBaseId) return true;

  return false;
}

/**
 * Get the base creature ID for a mutated card
 */
export function getMutateBaseId(
  state: GameState,
  cardId: CardInstanceId,
): CardInstanceId | null {
  const card = state.cards.get(cardId);
  return card?.mutateBaseId || null;
}

/**
 * Split a mutate stack when one component leaves the battlefield
 * CR 702.140: If a merged creature would leave the battlefield, the whole merge leaves
 */
export function splitMutateStack(
  state: GameState,
  cardId: CardInstanceId,
): { success: boolean; state: GameState; error?: string } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state, error: "Card not found" };
  }

  const updatedCards = new Map(state.cards);

  // If this is the base creature, all merged cards become separate
  if (!card.mutateBaseId && card.mutatedCardIds.length > 0) {
    // Clear all merge relationships
    for (const mutatedId of card.mutatedCardIds) {
      const mutatedCard = state.cards.get(mutatedId);
      if (mutatedCard) {
        updatedCards.set(mutatedId, {
          ...mutatedCard,
          mutateBaseId: null,
          isMutated: false,
          highestCmcComponentId: null,
        });
      }
    }

    // Clear base creature's merge info
    updatedCards.set(cardId, {
      ...card,
      mutatedCardIds: [],
      isMutated: false,
      highestCmcComponentId: null,
    });
  } else if (card.mutateBaseId) {
    // This is a component card - remove it from the base's mutatedCardIds
    const baseCard = state.cards.get(card.mutateBaseId);
    if (baseCard) {
      updatedCards.set(card.mutateBaseId, {
        ...baseCard,
        mutatedCardIds: baseCard.mutatedCardIds.filter((id) => id !== cardId),
      });
    }

    // Clear this card's merge info
    updatedCards.set(cardId, {
      ...card,
      mutateBaseId: null,
      isMutated: false,
      highestCmcComponentId: null,
    });
  }

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
  };
}

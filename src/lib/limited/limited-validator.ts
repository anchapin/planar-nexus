/**
 * Limited Deck Validator
 *
 * Provides validation for limited format (Draft/Sealed) deck building.
 *
 * LBld-01: Pool-only deck building validation
 * LBld-02: Limited filter restricting to pool
 * LBld-03: 40-card minimum
 * LBld-04: 4-copy limit
 * LBld-05: No sideboard
 * LBld-06: Save/load deck for session
 *
 * Uses DEFAULT_RULES.limited from game-rules.ts as base configuration.
 */

import { DEFAULT_RULES } from '@/lib/game-rules';
import type { PoolCard, LimitedDeckCard, DeckValidationResult } from './types';

// ============================================================================
// Constants
// ============================================================================

/**
 * Limited format rules
 * LBld-03: 40-card minimum
 * LBld-04: 4-copy maximum
 * LBld-05: No sideboard
 */
export const LIMITED_RULES = {
  ...DEFAULT_RULES.limited,
  // LBld-05: No sideboard in limited formats
  usesSideboard: false,
  sideboardSize: 0,
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Count total cards in deck
 */
function countTotalCards(deck: LimitedDeckCard[]): number {
  return deck.reduce((sum, card) => sum + card.count, 0);
}

/**
 * Get card counts by card name (handles duplicate entries)
 */
function getCardCounts(
  deck: LimitedDeckCard[]
): Map<string, { count: number; card: LimitedDeckCard['card'] }> {
  const counts = new Map<string, { count: number; card: LimitedDeckCard['card'] }>();

  for (const deckCard of deck) {
    const existing = counts.get(deckCard.card.id) || {
      count: 0,
      card: deckCard.card,
    };
    counts.set(deckCard.card.id, {
      count: existing.count + deckCard.count,
      card: deckCard.card,
    });
  }

  return counts;
}

/**
 * Count cards by type
 */
function countByType(
  deck: LimitedDeckCard[]
): DeckValidationResult['typeBreakdown'] {
  const breakdown = {
    creatures: 0,
    instants: 0,
    sorceries: 0,
    enchantments: 0,
    artifacts: 0,
    planeswalkers: 0,
    lands: 0,
  };

  for (const deckCard of deck) {
    const typeLine = deckCard.card.type_line?.toLowerCase() || '';
    const count = deckCard.count;

    if (typeLine.includes('creature')) {
      breakdown.creatures += count;
    } else if (typeLine.includes('instant')) {
      breakdown.instants += count;
    } else if (typeLine.includes('sorcery')) {
      breakdown.sorceries += count;
    } else if (typeLine.includes('enchantment')) {
      breakdown.enchantments += count;
    } else if (typeLine.includes('artifact')) {
      breakdown.artifacts += count;
    } else if (typeLine.includes('planeswalker')) {
      breakdown.planeswalkers += count;
    } else if (typeLine.includes('land')) {
      breakdown.lands += count;
    }
  }

  return breakdown;
}

/**
 * Validate a limited deck
 *
 * LBld-03: Checks minimum 40 cards
 * LBld-04: Checks maximum 4 copies per card
 * LBld-05: No sideboard validation (usesSideboard = false)
 *
 * @param deck - Array of deck cards with counts
 * @returns Validation result with errors and warnings
 */
export function validateLimitedDeck(
  deck: LimitedDeckCard[]
): DeckValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const totalCards = countTotalCards(deck);
  const uniqueCards = deck.length;
  const cardCounts = getCardCounts(deck);

  // LBld-03: 40-card minimum
  if (totalCards < LIMITED_RULES.minCards) {
    errors.push(
      `Deck must have at least ${LIMITED_RULES.minCards} cards (has ${totalCards})`
    );
  }

  // LBld-04: 4-copy limit per card
  for (const [cardId, { count, card }] of cardCounts) {
    if (count > LIMITED_RULES.maxCopies) {
      errors.push(
        `"${card.name}" has ${count} copies, maximum is ${LIMITED_RULES.maxCopies}`
      );
    }
  }

  // LBld-03: Warn if significantly over minimum
  if (totalCards > LIMITED_RULES.minCards + 10) {
    warnings.push(
      `Deck has ${totalCards} cards. Consider trimming to ${LIMITED_RULES.minCards + 10} or fewer.`
    );
  }

  // Suggest lands if few are present
  const typeBreakdown = countByType(deck);
  const nonLands = totalCards - typeBreakdown.lands;
  if (nonLands >= 20 && typeBreakdown.lands < 15) {
    warnings.push('Consider adding more lands for better mana curve.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    totalCards,
    uniqueCards,
    typeBreakdown,
  };
}

/**
 * Check if a card can be added to the deck
 *
 * LBld-04: Prevents adding cards that would exceed 4-copy limit
 *
 * @param card - The card to add (from pool or deck) - needs id property
 * @param currentDeck - Current deck state
 * @returns true if the card can be added
 */
export function canAddCardToDeck(
  card: { id: string },
  currentDeck: LimitedDeckCard[]
): boolean {
  // Find existing count of this card
  const existingEntry = currentDeck.find(
    (d) => d.card.id === card.id
  );

  if (existingEntry) {
    // Would exceed 4-copy limit
    return existingEntry.count < LIMITED_RULES.maxCopies;
  }

  // New card, always allowed
  return true;
}

/**
 * Check if a card is in the pool
 *
 * LBld-01: Ensures only pool cards can be added
 * LBld-02: Pool isolation enforcement
 *
 * @param cardId - The card ID to check
 * @param pool - The pool of available cards
 * @returns true if the card exists in the pool
 */
export function isPoolCard(cardId: string, pool: PoolCard[]): boolean {
  return pool.some((card) => card.id === cardId);
}

/**
 * Get the current copy count of a card in the deck
 *
 * @param cardId - The card ID to look up
 * @param deck - The current deck
 * @returns Current count (0 if not in deck)
 */
export function getCardCountInDeck(
  cardId: string,
  deck: LimitedDeckCard[]
): number {
  const entry = deck.find((d) => d.card.id === cardId);
  return entry?.count || 0;
}

/**
 * Calculate remaining copies available for a card
 *
 * @param poolCard - The card to check
 * @param currentDeck - Current deck state
 * @returns Number of copies that can still be added
 */
export function getRemainingCopies(
  poolCard: PoolCard,
  currentDeck: LimitedDeckCard[]
): number {
  const currentCount = getCardCountInDeck(poolCard.id, currentDeck);
  return Math.max(0, LIMITED_RULES.maxCopies - currentCount);
}



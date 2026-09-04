/**
 * Limited Deck Validator
 *
 * Provides validation for limited format (Draft/Sealed) deck building.
 *
 * LBld-01: Pool-only deck building validation
 * LBld-02: Limited filter restricting to pool
 * LBld-03: 40-card minimum
 * LBld-04: 4-copy limit
 * LBld-05: Pool is the sideboard (CR 100.5 / CR 904.3) — see CHANGELOG below
 * LBld-06: Save/load deck for session
 *
 * CHANGELOG (issue #1561)
 * ----------------------
 * Prior to #1561, `LIMITED_RULES.usesSideboard` was `false` and
 * `sideboardSize` was `0`, with the comment "LBld-05: No sideboard in
 * limited formats". This contradicted MTG Comprehensive Rules CR 100.5
 * (and CR 904.3 for Sealed Deck): in Limited formats involving individual
 * players, every card in a player's pool that is not in the main deck IS
 * the sideboard — there is no separate registered sideboard list, and
 * players may freely swap main-deck and pool cards between games.
 *
 * The fix flips `usesSideboard` to `true` and treats `sideboardSize` as
 * unbounded (`Number.POSITIVE_INFINITY`) so the sideboard automatically
 * holds every pool card the player has not placed in their main deck.
 * `validateLimitedDeck(deck, pool)` now exposes the resulting sideboard
 * as `result.sideboardCards` when a `pool` is supplied; the second
 * argument is optional so existing call sites that only validate the deck
 * shape (size, copy limits, type breakdown) keep working unchanged.
 *
 * Uses DEFAULT_RULES.limited from game-rules.ts as base configuration.
 */

import { DEFAULT_RULES } from "@/lib/game-rules";
import type {
  PoolCard,
  LimitedDeckCard,
  DeckValidationResult,
  LimitedSession,
} from "./types";

// ============================================================================
// Constants
// ============================================================================

/**
 * Limited format rules
 * LBld-03: 40-card minimum
 * LBld-04: 4-copy maximum
 * LBld-05: pool-derived sideboard (CR 100.5 / CR 904.3) — see file header.
 *
 * `sideboardSize` is set to `Number.POSITIVE_INFINITY` to signal "the
 * sideboard is the entire pool minus main deck" — every pool card that
 * has not been placed in the main deck is implicitly sideboard material,
 * and CR 100.5 puts no upper bound on it. Callers that previously
 * compared against `sideboardSize <= 0` to detect "no sideboard" must
 * now check `usesSideboard === true` instead.
 */
export const LIMITED_RULES = {
  ...DEFAULT_RULES.limited,
  // LBld-05: pool cards not in main deck ARE the sideboard per CR 100.5.
  usesSideboard: true,
  // LBld-05: CR 100.5 places no upper bound on the Limited sideboard — it
  // is simply pool minus main deck. Use Number.POSITIVE_INFINITY so
  // constructed-style "sideboard must have at most N cards" comparisons
  // (`opponent-deck-generator.ts`) never trip on a Limited pool.
  sideboardSize: Number.POSITIVE_INFINITY,
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
  deck: LimitedDeckCard[],
): Map<string, { count: number; card: LimitedDeckCard["card"] }> {
  const counts = new Map<
    string,
    { count: number; card: LimitedDeckCard["card"] }
  >();

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
  deck: LimitedDeckCard[],
): DeckValidationResult["typeBreakdown"] {
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
    const typeLine = deckCard.card.type_line?.toLowerCase() || "";
    const count = deckCard.count;

    if (typeLine.includes("creature")) {
      breakdown.creatures += count;
    } else if (typeLine.includes("instant")) {
      breakdown.instants += count;
    } else if (typeLine.includes("sorcery")) {
      breakdown.sorceries += count;
    } else if (typeLine.includes("enchantment")) {
      breakdown.enchantments += count;
    } else if (typeLine.includes("artifact")) {
      breakdown.artifacts += count;
    } else if (typeLine.includes("planeswalker")) {
      breakdown.planeswalkers += count;
    } else if (typeLine.includes("land")) {
      breakdown.lands += count;
    }
  }

  return breakdown;
}

/**
 * Validate a limited deck
 *
 * LBld-03: Checks minimum 40 cards (even when a sideboard is present — the
 *   main deck must still satisfy the size floor).
 * LBld-04: Checks maximum 4 copies per card.
 * LBld-05: When a `pool` is supplied, the unused pool cards are reported
 *   as the sideboard (CR 100.5 / CR 904.3); every main-deck card must
 *   belong to the pool (LBld-01 regression guard).
 *
 * @param deck - Array of deck cards with counts
 * @param pool - Optional pool of available cards. When supplied, the
 *   validator (a) enforces LBld-01 (deck must be a subset of the pool)
 *   and (b) populates `result.sideboardCards` with the pool cards that
 *   are not used by the main deck. Existing call sites that omit `pool`
 *   keep their pre-#1561 semantics: size + copy limit + type breakdown
 *   only, no sideboard exposure.
 * @returns Validation result with errors, warnings, and (when `pool` is
 *   supplied) the pool-derived sideboard.
 */
export function validateLimitedDeck(
  deck: LimitedDeckCard[],
  pool?: PoolCard[],
): DeckValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const totalCards = countTotalCards(deck);
  const uniqueCards = deck.length;
  const cardCounts = getCardCounts(deck);

  // LBld-03: 40-card minimum — applied unconditionally. A populated
  // sideboard does not relax this floor (CR 100.5 lets players swap pool
  // ↔ main deck freely, but the deck a player registers to start the
  // match still must be ≥ 40 cards).
  if (totalCards < LIMITED_RULES.minCards) {
    errors.push(
      `Deck must have at least ${LIMITED_RULES.minCards} cards (has ${totalCards})`,
    );
  }

  // LBld-04: 4-copy limit per card
  for (const [cardId, { count, card }] of cardCounts) {
    if (count > LIMITED_RULES.maxCopies) {
      errors.push(
        `"${card.name}" has ${count} copies, maximum is ${LIMITED_RULES.maxCopies}`,
      );
    }
  }

  // LBld-01: when a pool is supplied, every main-deck card must belong to
  // the pool. This is a regression guard — pre-#1561 the validator only
  // ran on the deck shape, and the pool-only rule lived in `isPoolCard`.
  // Surfacing it here means the Draft Complete page no longer has to do
  // the check manually before saving.
  if (pool !== undefined) {
    for (const [cardId, { count, card }] of cardCounts) {
      const poolEntry = pool.find((p) => p.id === cardId);
      const poolCopies = pool.filter((p) => p.id === cardId).length;
      if (!poolEntry) {
        errors.push(
          `"${card.name}" is not in your sealed pool — Limited decks can only contain cards from the registered pool (CR 100.5 / LBld-01).`,
        );
        continue;
      }
      if (count > poolCopies) {
        errors.push(
          `"${card.name}" has ${count} copies in the deck but only ${poolCopies} in the pool — Limited decks cannot include more copies of a card than the pool supplies.`,
        );
      }
    }
  }

  // LBld-03: Warn if significantly over minimum
  if (totalCards > LIMITED_RULES.minCards + 10) {
    warnings.push(
      `Deck has ${totalCards} cards. Consider trimming to ${LIMITED_RULES.minCards + 10} or fewer.`,
    );
  }

  // Suggest lands if few are present
  const typeBreakdown = countByType(deck);
  const nonLands = totalCards - typeBreakdown.lands;
  if (nonLands >= 20 && typeBreakdown.lands < 15) {
    warnings.push("Consider adding more lands for better mana curve.");
  }

  const result: DeckValidationResult = {
    isValid: errors.length === 0,
    errors,
    warnings,
    totalCards,
    uniqueCards,
    typeBreakdown,
  };

  // LBld-05 / CR 100.5: when a pool is supplied, the unused pool cards
  // are the sideboard. Each individual pool entry (Scryfall id) is its
  // own physical card — multiple copies of the same printing in the pool
  // each get their own `PoolCard` row, so we walk the pool and subtract
  // the deck entries that match by id until the deck's claimed copy
  // count for that id is exhausted.
  if (pool !== undefined) {
    const claimedById = new Map<string, number>();
    for (const deckCard of deck) {
      claimedById.set(
        deckCard.card.id,
        (claimedById.get(deckCard.card.id) ?? 0) + deckCard.count,
      );
    }
    const sideboard: PoolCard[] = [];
    for (const poolCard of pool) {
      const claimed = claimedById.get(poolCard.id) ?? 0;
      if (claimed <= 0) {
        sideboard.push(poolCard);
      } else {
        claimedById.set(poolCard.id, claimed - 1);
      }
    }
    result.sideboardCards = sideboard;
  }

  return result;
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
  currentDeck: LimitedDeckCard[],
): boolean {
  // Find existing count of this card
  const existingEntry = currentDeck.find((d) => d.card.id === card.id);

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
  deck: LimitedDeckCard[],
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
  currentDeck: LimitedDeckCard[],
): number {
  const currentCount = getCardCountInDeck(poolCard.id, currentDeck);
  return Math.max(0, LIMITED_RULES.maxCopies - currentCount);
}

/**
 * Compute the Limited sideboard for a persisted session (CR 100.5 /
 * CR 904.3).
 *
 * In Limited formats every card in the player's pool that is not in the
 * main deck IS the sideboard — there is no separate registered sideboard
 * list. This helper exists so the deck-builder / Draft Complete UIs can
 * expose `session.pool \ session.deck` as a sideboard pane without each
 * caller re-implementing the same pool-minus-maindeck arithmetic.
 *
 * Round-trip guarantee: because the source data (`session.pool` and
 * `session.deck`) is what `pool-storage` / `draft-storage` already
 * persist to IndexedDB, this derivation is stable across reloads. No
 * additional persistence is required.
 *
 * @param session - The persisted Limited / Draft / Sealed / Rochester /
 *   Winston session.
 * @returns The pool entries that the main deck has not claimed. Returns
 *   `[]` when the deck is empty (the entire pool is then the sideboard).
 */
export function getSessionSideboard(session: LimitedSession): PoolCard[] {
  const claimedById = new Map<string, number>();
  for (const deckCard of session.deck) {
    claimedById.set(
      deckCard.card.id,
      (claimedById.get(deckCard.card.id) ?? 0) + deckCard.count,
    );
  }
  const sideboard: PoolCard[] = [];
  for (const poolCard of session.pool) {
    const claimed = claimedById.get(poolCard.id) ?? 0;
    if (claimed <= 0) {
      sideboard.push(poolCard);
    } else {
      claimedById.set(poolCard.id, claimed - 1);
    }
  }
  return sideboard;
}

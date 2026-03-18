/**
 * AI Neighbor Logic
 *
 * Provides heuristic-based card selection for AI draft opponents.
 * NEIB-02: AI picks cards using heuristic logic
 * NEIB-03: Easy = random, Medium = color-focused
 */

import type { DraftPack, DraftCard, PoolCard, AiNeighbor, AiDifficulty } from './limited/types';
import type { ScryfallCard } from '@/app/actions';

/**
 * Card color score for evaluation
 */
export type CardColorScore = {
  white: number;
  blue: number;
  black: number;
  red: number;
  green: number;
  colorless: number;
};

/**
 * Extract color information from a Scryfall card
 */
export function getCardColors(card: ScryfallCard | DraftCard): string[] {
  // Use colors array if available, otherwise check color_identity
  return card.colors || card.color_identity || [];
}

/**
 * Evaluate colors from a pool of cards and return dominant colors
 */
export function evaluateCardColors(pool: PoolCard[]): CardColorScore {
  const score: CardColorScore = {
    white: 0,
    blue: 0,
    black: 0,
    red: 0,
    green: 0,
    colorless: 0,
  };

  if (pool.length === 0) {
    // Default to colorless (no preference) for empty pool
    return score;
  }

  // Count colors in pool
  for (const card of pool) {
    const colors = getCardColors(card);
    if (colors.length === 0) {
      score.colorless += 1;
    } else {
      for (const color of colors) {
        const key = color.toLowerCase() as keyof CardColorScore;
        if (key in score) {
          score[key] += 1;
        }
      }
    }
  }

  return score;
}

/**
 * Get the dominant color from a pool (most frequent)
 */
export function getDominantColor(pool: PoolCard[]): string | null {
  const score = evaluateCardColors(pool);

  let maxColor: string | null = null;
  let maxCount = 0;

  for (const [color, count] of Object.entries(score)) {
    if (count > maxCount) {
      maxCount = count;
      maxColor = color;
    }
  }

  // Only return a color if we have meaningful counts
  return maxCount > 0 ? maxColor : null;
}

/**
 * Pick a random available card from the pack (Easy difficulty)
 */
export function pickRandomCard(pack: DraftPack): DraftCard | null {
  // Get unpicked cards
  const availableCards = pack.cards.filter(
    card => !pack.pickedCardIds.includes(card.id)
  );

  if (availableCards.length === 0) {
    return null;
  }

  // Pick random card
  const randomIndex = Math.floor(Math.random() * availableCards.length);
  return availableCards[randomIndex];
}

/**
 * Pick a card based on color preference (Medium difficulty)
 * Prioritizes cards matching the dominant color in AI's pool
 */
export function pickColorFocusedCard(
  pack: DraftPack,
  aiPool: PoolCard[]
): DraftCard | null {
  // Get unpicked cards
  const availableCards = pack.cards.filter(
    card => !pack.pickedCardIds.includes(card.id)
  );

  if (availableCards.length === 0) {
    return null;
  }

  // Get dominant color from pool
  const dominantColor = getDominantColor(aiPool);

  if (!dominantColor) {
    // No color preference, fall back to random
    return pickRandomCard(pack);
  }

  // Score each card by how well it matches dominant color
  const scoredCards = availableCards.map(card => {
    const cardColors = getCardColors(card);
    let score = 0;

    if (cardColors.includes(dominantColor.toUpperCase())) {
      // Perfect match - primary color
      score += 10;
    } else if (cardColors.length === 0) {
      // Colorless card - neutral, low score
      score += 1;
    } else {
      // Multi-color or off-color - small penalty
      score -= cardColors.length;
    }

    return { card, score };
  });

  // Sort by score descending
  scoredCards.sort((a, b) => b.score - a.score);

  // Pick from top candidates with some randomness
  const topCandidates = scoredCards.filter(c => c.score === scoredCards[0].score);
  const randomTopIndex = Math.floor(Math.random() * topCandidates.length);

  return topCandidates[randomTopIndex].card;
}

/**
 * Select a card for the AI neighbor to pick
 * Dispatches to appropriate difficulty-based logic
 */
export function selectAiPick(
  pack: DraftPack,
  aiNeighbor: AiNeighbor
): DraftCard | null {
  const { difficulty, state } = aiNeighbor;

  switch (difficulty) {
    case 'easy':
      return pickRandomCard(pack);

    case 'medium':
      return pickColorFocusedCard(pack, state.pool);

    default:
      // Unknown difficulty, fall back to random
      console.warn(`Unknown AI difficulty: ${difficulty}, using random`);
      return pickRandomCard(pack);
  }
}

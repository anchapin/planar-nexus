/**
 * @fileOverview A heuristic deck coach for Magic: The Gathering.
 *
 * This module provides deck coaching using rule-based heuristics instead of AI API calls.
 * Works entirely client-side for offline support. (Issue #440)
 *
 * - reviewDeck - A function that reviews a Magic: The Gathering decklist for a given format.
 * - DeckReviewInput - The input type for reviewDeck function.
 * - DeckReviewOutput - The return type for reviewDeck function.
 */

import { reviewDeckHeuristic } from '@/lib/heuristic-deck-coach';
import { validateCardLegality } from '@/lib/server-card-operations';
import { type Format } from '@/lib/game-rules';

// Input types for deck review function
export interface DeckReviewInput {
  decklist: string;
  format: string;
}

// Extended interface for heuristic analysis
interface HeuristicCard {
  name: string;
  count: number;
  id: string;
  cmc: number;
  colors: string[];
  legalities: Record<string, string>;
  type_line: string;
  mana_cost: string;
  color_identity: string[];
}

// Output types for deck review function
export interface DeckReviewOutput {
  reviewSummary: string;
  deckOptions: Array<{
    title: string;
    description: string;
    cardsToAdd?: Array<{ name: string; quantity: number }>;
    cardsToRemove?: Array<{ name: string; quantity: number }>;
  }>;
}

export async function reviewDeck(
  input: DeckReviewInput
): Promise<DeckReviewOutput> {
  // Parse the decklist to get card data
  const lines = input.decklist.split('\n').filter(line => line.trim() !== '');
  const cards: HeuristicCard[] = [];

  // Simple parser - in production, you'd use proper card database lookup
  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (match) {
      const [, quantity, name] = match;
      cards.push({
        name: name.trim(),
        count: parseInt(quantity, 10),
        // Add placeholder properties to satisfy DeckCard type
        id: crypto.randomUUID(),
        cmc: 0,
        colors: [],
        legalities: {},
        type_line: 'Unknown',
        mana_cost: '{0}',
        color_identity: [],
      });
    }
  }

  // Use heuristic analysis instead of AI
  const result = reviewDeckHeuristic(input.decklist, input.format, cards);

  // Validate card suggestions for legality
  const validatedOptions = await Promise.all(
    result.deckOptions.map(async (option) => {
      const cardsToAdd = option.cardsToAdd || [];
      const cardsToRemove = option.cardsToRemove || [];

      // Validate cards to add
      let validatedCardsToAdd = cardsToAdd;
      if (cardsToAdd.length > 0) {
        const validation = await validateCardLegality(
          cardsToAdd.map(c => ({ name: c.name, quantity: c.quantity })),
          input.format
        );

        if (validation.notFound.length > 0 || validation.illegal.length > 0) {
          // Remove illegal or not found cards
          validatedCardsToAdd = cardsToAdd.filter(
            c => !validation.notFound.includes(c.name) && !validation.illegal.includes(c.name)
          );
        }
      }

      // Ensure equal counts
      const addCount = validatedCardsToAdd.reduce((sum, c) => sum + c.quantity, 0);
      const removeCount = cardsToRemove.reduce((sum, c) => sum + c.quantity, 0);

      if (addCount !== removeCount) {
        // Adjust removals to match additions
        const adjustedRemoves = [...cardsToRemove];
        while (adjustedRemoves.reduce((sum, c) => sum + c.quantity, 0) > addCount) {
          const last = adjustedRemoves.pop();
          if (last) {
            adjustedRemoves.push({ ...last, quantity: Math.max(0, last.quantity - 1) });
          }
        }
        return {
          ...option,
          cardsToAdd: validatedCardsToAdd,
          cardsToRemove: adjustedRemoves.filter(c => c.quantity > 0),
        };
      }

      return {
        ...option,
        cardsToAdd: validatedCardsToAdd,
        cardsToRemove,
      };
    })
  );

  return {
    reviewSummary: result.reviewSummary,
    deckOptions: validatedOptions.filter(option =>
      (option.cardsToAdd && option.cardsToAdd.length > 0) ||
      (option.cardsToRemove && option.cardsToRemove.length > 0)
    ),
  };
}

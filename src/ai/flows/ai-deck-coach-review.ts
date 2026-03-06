'use server';
/**
 * @fileOverview A heuristic deck coach for Magic: The Gathering.
 *
 * Issue #440: Unit 6 - Server Action Elimination - AI Deck Coach
 *
 * This module has been updated to use heuristic analysis instead of AI provider calls.
 * The deck coach now works entirely client-side with rule-based heuristics,
 * eliminating external AI dependencies for offline support.
 *
 * - reviewDeck - A function that reviews a Magic: The Gathering decklist for a given format.
 * - DeckReviewInput - The input type for the reviewDeck function.
 * - DeckReviewOutput - The return type for the reviewDeck function.
 */

import { z } from 'genkit';
import { validateCardLegality } from '@/app/actions';
import { heuristicDeckReview, type DeckReviewOutput as HeuristicDeckReviewOutput } from '@/lib/heuristic-deck-coach';

const DeckReviewInputSchema = z.object({
  decklist: z
    .string()
    .describe(
      'The full Magic: The Gathering decklist as a string, typically one card per line with quantity.'
    ),
  format: z.string().describe('The Magic: The Gathering format for this deck (e.g., "Commander", "Standard", "Modern").'),
});

export type DeckReviewInput = z.infer<typeof DeckReviewInputSchema>;

const DeckReviewOutputSchema = z.object({
  reviewSummary: z.string().describe("A comprehensive analysis of the deck's strategy, strengths, weaknesses, and position in the current metagame."),
  deckOptions: z.array(z.object({
    title: z.string().describe("A short, descriptive title for this deck version (e.g., 'Anti-Aggro Package', 'Control Counter')."),
    description: z.string().describe("A detailed explanation of this strategic option, including the core idea behind the changes."),
    cardsToAdd: z.array(z.object({ name: z.string(), quantity: z.number() })).optional().describe("A list of cards to add, with name and quantity."),
    cardsToRemove: z.array(z.object({ name: z.string(), quantity: z.number() })).optional().describe("A list of cards to remove, with name and quantity.")
  })).describe("At least two alternative versions of the deck, each with a specific strategic focus.")
});
export type DeckReviewOutput = z.infer<typeof DeckReviewOutputSchema>;

export async function reviewDeck(
  input: DeckReviewInput
): Promise<DeckReviewOutput> {
  // Use heuristic deck review instead of AI
  const result = await deckReviewFlow(input);
  return result;
}

const deckReviewFlow = async (
  input: DeckReviewInput
): Promise<DeckReviewOutput> => {
  // Get heuristic review
  const heuristicResult = await heuristicDeckReview(input.decklist, input.format);

  // Validate card suggestions
  const allValidationErrors: string[] = [];
  const allValidOptions: DeckReviewOutput['deckOptions'] = [];

  for (const option of heuristicResult.deckOptions) {
    if (!option || typeof option !== 'object' || !option.title) {
      allValidationErrors.push('An entire deck option was malformed or missing a title.');
      continue;
    }

    const cardsToAddRaw = option.cardsToAdd || [];
    const cardsToRemoveRaw = option.cardsToRemove || [];

    if (!Array.isArray(cardsToAddRaw) || !Array.isArray(cardsToRemoveRaw)) {
      allValidationErrors.push(`For option "${option.title}", the 'cardsToAdd' or 'cardsToRemove' field was not a list.`);
      continue;
    }

    const cardIsValid = (c: unknown): c is { name: string; quantity: number } =>
      c !== null && typeof c === 'object' && c !== undefined && 'name' in c && 'quantity' in c && typeof (c as { name: string }).name === 'string' && (c as { name: string }).name.trim() !== '' && typeof (c as { quantity: number }).quantity === 'number' && (c as { quantity: number }).quantity > 0;

    const sanitizedCardsToAdd = cardsToAddRaw.filter(cardIsValid);
    const sanitizedCardsToRemove = cardsToRemoveRaw.filter(cardIsValid);

    if (sanitizedCardsToAdd.length !== cardsToAddRaw.length || sanitizedCardsToRemove.length !== cardsToRemoveRaw.length) {
      allValidationErrors.push(`For option "${option.title}", one of your card lists contained malformed entries. Each card must be an object with a non-empty 'name' and a 'quantity' greater than 0.`);
      continue;
    }

    const addCount = sanitizedCardsToAdd.reduce((sum, c) => sum + c.quantity, 0);
    const removeCount = sanitizedCardsToRemove.reduce((sum, c) => sum + c.quantity, 0);

    if (addCount !== removeCount) {
      allValidationErrors.push(`For option "${option.title}", you suggested adding ${addCount} cards but removing ${removeCount}. These counts must be equal.`);
      continue;
    }

    if (sanitizedCardsToAdd.length === 0 && sanitizedCardsToRemove.length === 0) {
      allValidationErrors.push(`For option "${option.title}", you provided no cards to add or remove. Every option must include at least one change.`);
      continue;
    }

    if (sanitizedCardsToAdd.length > 0) {
      const importResult = await validateCardLegality(sanitizedCardsToAdd, input.format);

      const legalityErrors = [];
      if (importResult.notFound.length > 0) {
        legalityErrors.push(`these cards could not be found: ${importResult.notFound.join(', ')}.`);
      }
      if (importResult.illegal.length > 0) {
        legalityErrors.push(`these cards are not legal in ${input.format}: ${importResult.illegal.join(', ')}.`);
      }

      if (legalityErrors.length > 0) {
        allValidationErrors.push(`For option "${option.title}", your card suggestions had errors: ${legalityErrors.join(' ')}`);
        continue;
      }
    }

    allValidOptions.push({
      ...option,
      cardsToAdd: sanitizedCardsToAdd,
      cardsToRemove: sanitizedCardsToRemove,
    });
  }

  if (allValidOptions.length === 0) {
    throw new Error(`The heuristic deck coach failed to generate valid deck suggestions. Errors: ${allValidationErrors.join('\n')}`);
  }

  return {
    reviewSummary: heuristicResult.reviewSummary,
    deckOptions: allValidOptions,
  };
};

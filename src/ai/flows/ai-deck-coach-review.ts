'use server';
/**
 * @fileOverview An AI deck coach for Magic: The Gathering.
 *
 * - reviewDeck - A function that reviews a Magic: The Gathering decklist for a given format.
 * - DeckReviewInput - The input type for the reviewDeck function.
 * - DeckReviewOutput - The return type for the reviewDeck function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const DeckReviewInputSchema = z.object({
  decklist: z
    .string()
    .describe(
      'The full Magic: The Gathering decklist as a string, typically one card per line with quantity.'
    ),
  format: z.string().describe('The Magic: The Gathering format for this deck (e.g., "Commander", "Standard", "Modern").')
});
export type DeckReviewInput = z.infer<typeof DeckReviewInputSchema>;

const DeckReviewOutputSchema = z.object({
  reviewSummary: z.string().describe("A comprehensive analysis of the deck's strategy, strengths, weaknesses, and position in the current metagame."),
  deckOptions: z.array(z.object({
    title: z.string().describe("A short, descriptive title for this deck version (e.g., 'Anti-Aggro Package', 'Control Counter')."),
    description: z.string().describe("A detailed explanation of this strategic option, including the core idea behind the changes."),
    cardsToAdd: z.array(z.object({ name: z.string(), quantity: z.number() })).describe("A list of cards to add, with name and quantity."),
    cardsToRemove: z.array(z.object({ name: z.string(), quantity: z.number() })).describe("A list of cards to remove, with name and quantity.")
  })).describe("At least two alternative versions of the deck, each with a specific strategic focus.")
});
export type DeckReviewOutput = z.infer<typeof DeckReviewOutputSchema>;

export async function reviewDeck(
  input: DeckReviewInput
): Promise<DeckReviewOutput> {
  const result = await deckReviewFlow(input);
  if (!result.deckOptions) {
    result.deckOptions = [];
  }
  return result;
}

const deckReviewPrompt = ai.definePrompt({
  name: 'deckReviewPrompt',
  input: { schema: DeckReviewInputSchema },
  output: { schema: DeckReviewOutputSchema },
  prompt: `You are an expert Magic: The Gathering deck builder and coach. Your task is to provide a strategic analysis of the provided decklist and then propose at least two distinct, improved versions.

**Format:** {{{format}}}

**Decklist to review:**
{{{decklist}}}

**Your tasks:**
1.  **Provide a \`reviewSummary\`**: Write a comprehensive analysis covering the deck's core strategy, its strengths and weaknesses, and how it fits into the current metagame for the specified format. Assume the provided decklist is legal for the format. Focus on strategic improvements, not rule violations.

2.  **Propose \`deckOptions\`**: Create at least two distinct options for improving the deck. Each option should have a clear strategic focus (e.g., making it better against aggro, or giving it more tools against control). For each option:
    *   Provide a short, descriptive \`title\`.
    *   Provide a detailed \`description\` that explains the strategy behind the changes. DO NOT list the card changes in the description itself.
    *   Provide a \`cardsToAdd\` array with the exact card names and quantities to add. **All cards added MUST be legal in the '{{{format}}}' format.**
    *   Provide a \`cardsToRemove\` array with the exact card names and quantities to remove from the original list.
    *   Ensure all card names are spelled correctly.
    *   **CRITICAL RULE: The total quantity of cards in \`cardsToAdd\` MUST EXACTLY equal the total quantity of cards in \`cardsToRemove\` to maintain the deck's total card count.** For example, if you remove 3 cards (e.g. one card with a quantity of 1, and another with a quantity of 2), you must add exactly 3 cards.`,
});

const deckReviewFlow = ai.defineFlow(
  {
    name: 'deckReviewFlow',
    inputSchema: DeckReviewInputSchema,
    outputSchema: DeckReviewOutputSchema,
  },
  async (input) => {
    const { output } = await deckReviewPrompt(input);
    if (!output) {
      throw new Error("AI failed to generate a valid deck review.");
    }
    return output;
  }
);

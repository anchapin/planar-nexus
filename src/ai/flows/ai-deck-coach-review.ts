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
    description: z.string().describe("A detailed explanation of this strategic option, including the core idea and a list of specific card changes (additions and removals) to achieve it.")
  })).describe("At least two alternative versions of the deck, each with a specific strategic focus.").default([])
});
export type DeckReviewOutput = z.infer<typeof DeckReviewOutputSchema>;

export async function reviewDeck(
  input: DeckReviewInput
): Promise<DeckReviewOutput> {
  return deckReviewFlow(input);
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
1.  **Provide a \`reviewSummary\`**: Write a comprehensive analysis covering the deck's core strategy, its strengths and weaknesses, and how it fits into the current metagame for the specified format.

2.  **Propose \`deckOptions\`**: Create at least two distinct options for improving the deck. Each option should have a clear strategic focus (e.g., making it better against aggro, or giving it more tools against control). For each option:
    *   Provide a short, descriptive \`title\`.
    *   Provide a detailed \`description\` that explains the strategy and lists the specific cards to add and remove. For example: "This option focuses on beating control decks. To do this, we'll add 2x Demolition Field to handle problematic lands and 2x Cavern of Souls to make our creatures uncounterable. We'll remove 4x...".`,
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

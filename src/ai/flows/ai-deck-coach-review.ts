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
    description: z.string().describe("A brief explanation of the strategic goal of this deck version."),
    changes: z.array(z.object({
        action: z.enum(['add', 'remove', 'replace']).describe("The action to perform."),
        cardToChange: z.string().optional().describe("The card to be removed or replaced."),
        suggestedCard: z.string().optional().describe("The card to be added or used as a replacement."),
        reason: z.string().describe("The justification for this specific card change within the context of the option's strategy."),
    })).describe("A list of specific card changes for this deck option.")
  })).describe("Alternative versions of the deck, each with a specific strategic focus and a list of card changes.").default([])
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
  prompt: `You are an expert Magic: The Gathering deck builder and coach. Your task is to provide a strategic analysis of the provided decklist and then propose distinct, improved versions.

**Analysis & Deck Improvements**

**Format:** {{{format}}}

**Decklist to review:**
{{{decklist}}}

**Instructions:**
First, provide a comprehensive \`reviewSummary\`. This summary should cover the deck's core strategy, its strengths and weaknesses, and how it fits into the current metagame for the specified format.

Second, based on your analysis, propose at least two distinct \`deckOptions\`. Each option should represent a rebuilt version of the deck designed to address weaknesses or pivot to a different strategy (e.g., an anti-aggro version, a counter-control version).

For each \`deckOption\`, you must provide:
1.  A short, descriptive \`title\`.
2.  A brief \`description\` explaining the strategic goal.
3.  A list of specific card \`changes\` with a clear \`reason\` for each. When suggesting changes, balance additions and removals to maintain deck size. Your entire output must be a valid JSON object.`,
});

const deckReviewFlow = ai.defineFlow(
  {
    name: 'deckReviewFlow',
    inputSchema: DeckReviewInputSchema,
    outputSchema: DeckReviewOutputSchema,
  },
  async (input) => {
    const { output } = await deckReviewPrompt(input);
    return output!;
  }
);

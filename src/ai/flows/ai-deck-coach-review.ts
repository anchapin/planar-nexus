'use server';
/**
 * @fileOverview An AI deck coach for Magic: The Gathering, specifically for Commander format.
 *
 * - reviewDeck - A function that reviews a Magic: The Gathering decklist.
 * - DeckReviewInput - The input type for the reviewDeck function.
 * - DeckReviewOutput - The return type for the reviewDeck function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const DeckReviewInputSchema = z.object({
  decklist: z
    .string()
    .describe(
      'The full Magic: The Gathering decklist as a string, typically one card per line with quantity, and including the commander.'
    ),
});
export type DeckReviewInput = z.infer<typeof DeckReviewInputSchema>;

const DeckReviewOutputSchema = z.object({
  overallRating: z
    .string()
    .describe(
      'A qualitative assessment of the deck (e.g., "Strong", "Moderate", "Needs Improvement").'
    ),
  strategySummary: z
    .string()
    .describe(
      "A short paragraph summarizing the deck's primary strategy and how it aims to win."
    ),
  synergies: z
    .array(z.string())
    .describe(
      'A list of potential card interactions and strong combinations identified in the deck.'
    ),
  weaknesses: z
    .array(z.string())
    .describe(
      'A list of vulnerabilities, inconsistencies, or areas for improvement in the deck (e.g., lack of ramp, card draw, removal, or specific answers).'
    ),
  suggestions: z
    .array(
      z.object({
        action: z
          .enum(['add', 'remove', 'replace'])
          .describe(
            'The action to perform: "add" a card, "remove" a card, or "replace" an existing card.'
          ),
        cardToChange: z
          .string()
          .optional()
          .describe(
            'The name of the card to be removed or replaced, if applicable. Required for "remove" and "replace" actions.'
          ),
        suggestedCard: z
          .string()
          .optional()
          .describe(
            'The name of the card to be added or used as a replacement, if applicable. Required for "add" and "replace" actions.'
          ),
        reason: z.string().describe('The justification for the suggestion.'),
      })
    )
    .describe('A list of specific card substitutions or strategy adjustments.'),
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
  prompt: `You are an expert Magic: The Gathering deck builder and coach, specializing in the Commander format.
Your task is to analyze the provided decklist, identify its strengths, weaknesses, and potential synergies, and then offer constructive suggestions for improvement.

Consider the following aspects:
-   **Mana Curve and Base:** Is the mana curve appropriate for the deck's strategy? Is there enough mana generation (ramp)?
-   **Win Conditions:** Are there clear ways for the deck to win? How resilient are they?
-   **Card Quality & Synergies:** Do the cards work well together? Are there powerful interactions or combo potential?
-   **Weaknesses & Vulnerabilities:** What are the deck's choke points? Is it vulnerable to certain types of interaction (e.g., aggro, control, combo)? Does it lack essential elements like removal, card draw, or protection?
-   **Commander Identity:** Does the deck effectively utilize its commander's abilities and color identity?
-   **Card Count:** Ensure the deck has exactly 100 cards, including the commander (which counts as one of the 100).

Provide your analysis in a structured JSON format according to the output schema. Be concise and precise in your suggestions.

Decklist to review:
{{{decklist}}}`,
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

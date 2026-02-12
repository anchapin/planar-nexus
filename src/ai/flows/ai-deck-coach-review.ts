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
  })).describe("At least two alternative versions of the deck, each with a specific strategic focus and a list of card changes.")
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
  prompt: `You are an expert Magic: The Gathering deck builder and coach. Your task is to provide a deep strategic analysis of the provided decklist and then propose at least two distinct, improved versions of the deck, each tailored to a specific strategic pivot.

Format: {{{format}}}

**Important: Assume the provided decklist is legal for the specified format and adheres to all card count and quantity rules.** Your role is not to be a rules lawyer, but a strategic coach.

**Part 1: Comprehensive Review**
First, provide a \`reviewSummary\`. This should be a detailed paragraph covering:
-   **Core Strategy:** What is the deck's primary game plan and win condition?
-   **Strengths & Synergies:** What are the most powerful interactions and what does the deck do well?
-   **Weaknesses & Vulnerabilities:** What are its choke points? What strategies is it weak against (e.g., aggro, control, combo)?
-   **Metagame Positioning:** How does this deck fare against the current top-tier decks in the '{{{format}}}' metagame?

**Part 2: Proposed Deck Options**
Next, create at least two \`deckOptions\`. Each option should represent a rebuilt version of the deck designed to address weaknesses or lean into a different strategy. For example, one option might add more board wipes to handle aggressive "go-wide" decks, while another might add land destruction and resilient threats to fight "control" decks.

For each \`deckOption\`, you must provide:
1.  A \`title\`: A short, descriptive name for the strategic pivot (e.g., "Version 1: The Anti-Aggro Build", "Option 2: Counter-Control Suite").
2.  A \`description\`: A brief explanation of what this version aims to accomplish.
3.  A list of \`changes\`: Specific card swaps (\`add\`, \`remove\`, \`replace\`) to achieve this new strategy. For each change, provide a clear \`reason\`. Ensure that for every card added, a card is removed to maintain deck size (unless the format rules are flexible).

Your entire output must be in a structured JSON format according to the output schema.

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

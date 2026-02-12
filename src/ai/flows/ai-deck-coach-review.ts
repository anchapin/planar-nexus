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
import { importDecklist } from '@/app/actions';

const DeckReviewInputSchema = z.object({
  decklist: z
    .string()
    .describe(
      'The full Magic: The Gathering decklist as a string, typically one card per line with quantity.'
    ),
  format: z.string().describe('The Magic: The Gathering format for this deck (e.g., "Commander", "Standard", "Modern").'),
  retryContext: z.string().optional().describe("Context from a previous failed attempt, explaining the error to the AI so it can correct it.")
});

// This is the schema for what the flow accepts externally. It doesn't include the internal retryContext.
const ExternalDeckReviewInputSchema = DeckReviewInputSchema.omit({ retryContext: true });
// External input type does not include retryContext
export type DeckReviewInput = z.infer<typeof ExternalDeckReviewInputSchema>;


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

{{#if retryContext}}
**IMPORTANT - PLEASE CORRECT YOUR PREVIOUS MISTAKE:**
You previously generated a response that had an error. Please pay close attention to the following feedback and generate a new, valid response.
*Error Feedback:* {{{retryContext}}}
{{/if}}

**Your tasks:**
1.  **Provide a \`reviewSummary\`**: Write a comprehensive analysis covering the deck's core strategy, its strengths and weaknesses, and how it fits into the current metagame for the specified format. Assume the provided decklist is legal for the format. Focus on strategic improvements, not rule violations.

2.  **Propose \`deckOptions\`**: Create at least two distinct options for improving the deck. Each option should have a clear strategic focus (e.g., making it better against aggro, or giving it more tools against control). For each option:
    *   Provide a short, descriptive \`title\`.
    *   Provide a detailed \`description\` that explains the strategy behind the changes. DO NOT list the card changes in the description itself.
    *   Provide a \`cardsToAdd\` array with the exact card names and quantities to add.
    *   Provide a \`cardsToRemove\` array with the exact card names and quantities to remove from the original list.
    *   Ensure all card names are spelled correctly.
    *   **CRITICAL RULE 1: All cards in \`cardsToAdd\` MUST be legal in the '{{{format}}}' format. This is non-negotiable. Double-check legality. For example, 'Thalia, Guardian of Thraben' is NOT Standard legal.**
    *   **CRITICAL RULE 2: The total quantity of cards in \`cardsToAdd\` MUST EXACTLY equal the total quantity of cards in \`cardsToRemove\` to maintain the deck's total card count.** For example, if you remove 3 cards, you must add exactly 3 cards. This is essential for the deck to remain valid.`,
});

const deckReviewFlow = ai.defineFlow(
  {
    name: 'deckReviewFlow',
    inputSchema: ExternalDeckReviewInputSchema,
    outputSchema: DeckReviewOutputSchema,
  },
  async (input) => {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError = '';

    while (attempts < maxAttempts) {
      attempts++;
      
      const { output } = await deckReviewPrompt({
        ...input,
        retryContext: lastError || undefined,
      });

      if (!output || !output.deckOptions || output.deckOptions.length < 2) {
        lastError = 'You did not provide at least two valid deck options. Please generate two complete options.';
        continue; // Retry
      }

      let allOptionsValid = true;
      for (const option of output.deckOptions) {
        const cardsToAddFromAI = option.cardsToAdd || [];
        const cardsToRemoveFromAI = option.cardsToRemove || [];

        if (cardsToAddFromAI.length === 0 && cardsToRemoveFromAI.length === 0) {
            allOptionsValid = false;
            lastError = `For option "${option.title}", you provided no cards to add or remove. Please provide changes.`;
            break;
        }

        const intendedAddCount = cardsToAddFromAI.reduce((sum, c) => sum + c.quantity, 0);
        const intendedRemoveCount = cardsToRemoveFromAI.reduce((sum, c) => sum + c.quantity, 0);
        if (intendedAddCount !== intendedRemoveCount) {
          allOptionsValid = false;
          lastError = `For option "${option.title}", you suggested adding ${intendedAddCount} cards but removing ${intendedRemoveCount}. The counts must be equal to maintain deck size.`;
          break;
        }

        if (cardsToAddFromAI.length > 0) {
            const decklistForImport = cardsToAddFromAI.map(c => `${c.quantity} ${c.name}`).join('\n');
            const importResult = await importDecklist(decklistForImport, input.format);
            
            const errors = [];
            if (importResult.notFound.length > 0) {
                errors.push(`I could not find these cards: ${importResult.notFound.join(', ')}.`);
            }
            if (importResult.illegal.length > 0) {
                errors.push(`These cards are not legal in the ${input.format} format: ${importResult.illegal.join(', ')}.`);
            }

            if (errors.length > 0) {
                allOptionsValid = false;
                lastError = `For option "${option.title}", your card suggestions have errors: ${errors.join(' ')} Please suggest only valid, legal cards for the ${input.format} format.`;
                break;
            }
        }
      }

      if (allOptionsValid) {
        return output; // Success!
      }
      // If not valid, the loop will continue with the new `lastError`.
    }

    // If we exit the loop, it means we failed after maxAttempts.
    throw new Error(`AI failed to generate valid deck suggestions after ${maxAttempts} attempts. Last error: ${lastError}`);
  }
);

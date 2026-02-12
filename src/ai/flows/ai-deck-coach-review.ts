
'use server';
/**
 * @fileOverview An AI deck coach for Magic: The Gathering.
 *
 * - reviewDeck - A function that reviews a Magic: The Gathering decklist for a given format.
 * - DeckReviewInput - The input type for the reviewDeck function.
 * - DeckReviewOutput - The return type for the reviewDeck function.
 */

import { ai, googleAiPlugin } from '@/ai/genkit';
import { z } from 'genkit';
import { validateCardLegality } from '@/app/actions';

const DeckReviewInputSchema = z.object({
  decklist: z
    .string()
    .describe(
      'The full Magic: The Gathering decklist as a string, typically one card per line with quantity.'
    ),
  format: z.string().describe('The Magic: The Gathering format for this deck (e.g., "Commander", "Standard", "Modern").'),
  retryContext: z.string().optional().describe("Context from a previous failed attempt, explaining the error to the AI so it can correct it.")
});

const ExternalDeckReviewInputSchema = DeckReviewInputSchema.omit({ retryContext: true });
export type DeckReviewInput = z.infer<typeof ExternalDeckReviewInputSchema>;


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
  const result = await deckReviewFlow(input);
  return result;
}

const deckReviewPrompt = ai.definePrompt({
  name: 'deckReviewPrompt',
  model: 'gemini-1.5-flash-latest',
  input: { schema: DeckReviewInputSchema },
  output: { schema: DeckReviewOutputSchema },
  prompt: `You are an expert Magic: The Gathering deck builder and coach. Your response will be validated for correctness by an automated tool. If your response fails validation, you will be asked to try again with specific feedback on your errors.

{{#if retryContext}}
**CRITICAL: YOUR PREVIOUS ATTEMPT FAILED VALIDATION. YOU MUST CORRECT THE FOLLOWING ERRORS AND TRY AGAIN:**
- {{{retryContext}}}
---
Do not repeat these mistakes. For example, if the feedback indicates a card is not legal, you MUST replace it with a different card that IS legal in the '{{{format}}}' format and serves a similar strategic purpose. If the feedback indicates the number of cards to add and remove do not match, you MUST correct the quantities to be equal.
{{/if}}

**FORMAT: {{{format}}}**

**DECKLIST TO REVIEW:**
{{{decklist}}}

**YOUR TASKS:**
1.  **Provide a \`reviewSummary\`**: Write a comprehensive analysis covering the deck's core strategy, its strengths and weaknesses, and how it fits into the current metagame for the specified format. Assume the provided decklist is legal for the format. Focus on strategic improvements, not rule violations.

2.  **Propose \`deckOptions\`**: Create at least two distinct options for improving the deck. Each option should have a clear strategic focus (e.g., making it better against aggro, or giving it more tools against control). For each option:
    *   Provide a short, descriptive \`title\`.
    *   Provide a detailed \`description\` that explains the strategy behind the changes. DO NOT list the card changes in the description itself.
    *   Provide a \`cardsToAdd\` array with the exact card names and quantities to add.
    *   Provide a \`cardsToRemove\` array with the exact card names and quantities to remove from the original list.
    *   Ensure all card names are spelled correctly.

**VALIDATION RULES (NON-NEGOTIABLE):**
*   **RULE 1: LEGALITY:** All cards in \`cardsToAdd\` MUST be legal in the '{{{format}}}' format. For example, 'Thalia, Guardian of Thraben' is NOT Standard legal. Your suggestions will be checked.
*   **RULE 2: EQUAL COUNT:** The total quantity of cards in \`cardsToAdd\` MUST EXACTLY equal the total quantity of cards in \`cardsToRemove\` to maintain the deck's total card count.
*   **RULE 3: PROVIDE CHANGES:** Each \`deckOption\` MUST suggest at least one card to add or one card to remove. Do not provide options with no changes.`,
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

      if (!output || !Array.isArray(output.deckOptions) || output.deckOptions.length < 1) {
        lastError = 'Your response was invalid. Please adhere to the output schema and provide at least one valid deckOption.';
        continue;
      }
      
      const allValidationErrors: string[] = [];
      const allValidOptions: DeckReviewOutput['deckOptions'] = [];

      for (const option of output.deckOptions) {
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
        
        const cardIsValid = (c: any): c is { name: string; quantity: number } => 
          c && typeof c === 'object' && typeof c.name === 'string' && c.name.trim() !== '' && typeof c.quantity === 'number' && c.quantity > 0;

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

      if (allValidOptions.length > 0) {
        return {
          ...output,
          deckOptions: allValidOptions,
        };
      }

      if (allValidationErrors.length > 0) {
        lastError = `Your suggestions had the following errors:\n- ${allValidationErrors.join('\n- ')}`;
      } else {
        lastError = 'You provided deck options, but none of them were valid for an unknown reason. Please try again, paying close attention to all validation rules.'
      }
    }

    throw new Error(`The AI coach failed to generate valid deck suggestions after ${maxAttempts} attempts. The last error was: ${lastError}`);
  }
);

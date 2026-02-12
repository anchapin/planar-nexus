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
  model: googleAiPlugin.model('gemini-1.5-flash-latest'),
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
        lastError = 'Your response was invalid. Please adhere to the output schema and provide at least two deckOptions.';
        continue;
      }
      
      const validOptions = [];
      const validationErrors = [];

      const filteredDeckOptions = output.deckOptions.filter(opt => opt && typeof opt === 'object');

      for (const option of filteredDeckOptions) {
        let currentOptionIsValid = true;
        let currentOptionError = '';

        const cardIsValid = (c: any): c is { name: string; quantity: number } => {
          if (!c || typeof c !== 'object') return false;
          if (typeof c.name !== 'string' || c.name.trim() === '') return false;
          if (typeof c.quantity !== 'number') return false;
          return true;
        };
        
        const cardsToAddRaw = Array.isArray(option.cardsToAdd) ? option.cardsToAdd : [];
        const cardsToRemoveRaw = Array.isArray(option.cardsToRemove) ? option.cardsToRemove : [];

        const sanitizedCardsToAdd = cardsToAddRaw.filter(cardIsValid);
        const sanitizedCardsToRemove = cardsToRemoveRaw.filter(cardIsValid);
        
        if (sanitizedCardsToAdd.length !== cardsToAddRaw.length) {
          currentOptionIsValid = false;
          currentOptionError = `For option "${option.title || 'Untitled'}", your 'cardsToAdd' list contained invalid entries. Each card must be an object with a non-empty 'name' (string) and a 'quantity' (number). Please correct the list.`;
        }
        
        if (sanitizedCardsToRemove.length !== cardsToRemoveRaw.length) {
          currentOptionIsValid = false;
          currentOptionError += (currentOptionError ? ' ' : '') + `For option "${option.title || 'Untitled'}", your 'cardsToRemove' list contained invalid entries. Each card must be an object with a non-empty 'name' (string) and a 'quantity' (number). Please correct the list.`;
        }

        if (currentOptionIsValid && sanitizedCardsToAdd.length === 0 && sanitizedCardsToRemove.length === 0) {
            currentOptionIsValid = false;
            currentOptionError = `For option "${option.title || 'Untitled'}", you provided no cards to add or remove. Every option must include at least one change.`;
        }

        if (currentOptionIsValid) {
            const intendedAddCount = sanitizedCardsToAdd.reduce((sum, c) => sum + c.quantity, 0);
            const intendedRemoveCount = sanitizedCardsToRemove.reduce((sum, c) => sum + c.quantity, 0);
            if (intendedAddCount !== intendedRemoveCount) {
              currentOptionIsValid = false;
              currentOptionError = `For option "${option.title || 'Untitled'}", you suggested adding ${intendedAddCount} cards but removing ${intendedRemoveCount}. These counts must be exactly equal.`;
            }
        }

        if (currentOptionIsValid && sanitizedCardsToAdd.length > 0) {
            const decklistForImport = sanitizedCardsToAdd.map(c => `${c.quantity} ${c.name}`).join('\n');
            const importResult = await importDecklist(decklistForImport, input.format);
            
            const errors = [];
            if (importResult.notFound.length > 0) {
                errors.push(`I could not find these cards: ${importResult.notFound.join(', ')}.`);
            }
            if (importResult.illegal.length > 0) {
                errors.push(`These cards are not legal in ${input.format}: ${importResult.illegal.join(', ')}.`);
            }

            if (errors.length > 0) {
                currentOptionIsValid = false;
                currentOptionError = `For option "${option.title || 'Untitled'}", your card suggestions had errors: ${errors.join(' ')} Please suggest only valid, legal cards for the ${input.format} format.`;
            }
        }

        if (currentOptionIsValid) {
          validOptions.push({
            ...option,
            cardsToAdd: sanitizedCardsToAdd,
            cardsToRemove: sanitizedCardsToRemove,
          });
        } else {
          validationErrors.push(currentOptionError);
        }
      }

      if (validOptions.length > 0) {
        return {
          ...output,
          deckOptions: validOptions,
        };
      }

      if (validationErrors.length > 0) {
        lastError = `Your suggestions had the following errors:\n- ${validationErrors.join('\n- ')}`;
      } else {
        lastError = 'You provided deck options, but none of them were valid for an unknown reason. Please try again, paying close attention to all validation rules.'
      }
      
    }

    throw new Error(`The AI coach failed to generate valid deck suggestions after ${maxAttempts} attempts. The last error was: ${lastError}`);
  }
);

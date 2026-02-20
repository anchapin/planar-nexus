'use server';
/**
 * @fileOverview AI-powered meta analysis for deck optimization.
 * 
 * Issue #53: Add AI deck building suggestions based on meta analysis
 * 
 * This module provides AI-powered deck optimization based on current
 * Magic: The Gathering metagame analysis.
 * 
 * - analyzeMetaAndSuggest - Analyzes the metagame and provides deck improvement suggestions.
 * - MetaAnalysisInput - The input type for the analyzeMetaAndSuggest function.
 * - MetaAnalysisOutput - The return type for the analyzeMetaAndSuggest function.
 */

import { ai } from '@/ai/genkit';
import { getModelString } from '@/ai/providers';
import { z } from 'genkit';
import { importDecklist } from '@/app/actions';

const MetaAnalysisInputSchema = z.object({
  decklist: z
    .string()
    .describe(
      'The full Magic: The Gathering decklist as a string, typically one card per line with quantity.'
    ),
  format: z.string().describe('The Magic: The Gathering format (e.g., "Commander", "Standard", "Modern").'),
  focusArchetype: z.string().optional().describe('Optional specific archetype to focus on (e.g., "control", "aggro", "midrange", "combo").'),
  retryContext: z.string().optional().describe("Context from a previous failed attempt, explaining the error to the AI so it can correct it.")
});

const ExternalMetaAnalysisInputSchema = MetaAnalysisInputSchema.omit({ retryContext: true });
export type MetaAnalysisInput = z.infer<typeof ExternalMetaAnalysisInputSchema>;

/**
 * Represents a card suggestion with name and quantity
 */
const CardSuggestionSchema = z.object({
  name: z.string().describe('The exact name of the card.'),
  quantity: z.number().describe('How many copies to add/remove.'),
  reason: z.string().describe('Why this card is suggested - its role in the meta.'),
});

/**
 * Represents a matchup recommendation
 */
const MatchupRecommendationSchema = z.object({
  archetype: z.string().describe('The opposing deck archetype.'),
  recommendation: z.string().describe('How to adjust the deck against this matchup.'),
  sideboardNotes: z.string().optional().describe('Sideboard suggestions for this matchup.'),
});

/**
 * Meta analysis output
 */
const MetaAnalysisOutputSchema = z.object({
  metaOverview: z.string().describe("An overview of the current metagame for the specified format, including tier decks and trends."),
  deckStrengths: z.array(z.string()).describe("The deck's strengths in the current meta."),
  deckWeaknesses: z.array(z.string()).describe("The deck's weaknesses in the current meta."),
  matchupAnalysis: z.array(MatchupRecommendationSchema).describe("Analysis of key matchups in the meta and how to improve them."),
  cardSuggestions: z.object({
    cardsToAdd: z.array(CardSuggestionSchema).describe("Cards to add to improve the deck against the meta."),
    cardsToRemove: z.array(CardSuggestionSchema).describe("Cards to remove that are underperforming in the current meta."),
  }).describe("Specific card suggestions with reasoning based on meta analysis."),
  sideboardSuggestions: z.array(CardSuggestionSchema).optional().describe("Suggested sideboard cards for the current meta."),
  strategicAdvice: z.string().describe("Strategic advice for playing the deck in the current meta."),
});
export type MetaAnalysisOutput = z.infer<typeof MetaAnalysisOutputSchema>;

export async function analyzeMetaAndSuggest(
  input: MetaAnalysisInput
): Promise<MetaAnalysisOutput> {
  const result = await metaAnalysisFlow(input);
  return result;
}

// Use provider-agnostic model string
const currentModel = getModelString();

const metaAnalysisPrompt = ai.definePrompt({
  name: 'metaAnalysisPrompt',
  model: currentModel,
  input: { schema: MetaAnalysisInputSchema },
  output: { schema: MetaAnalysisOutputSchema },
  prompt: `You are an expert Magic: The Gathering metagame analyst. Your task is to analyze the current metagame and provide strategic deck improvement suggestions.

{{#if retryContext}}
**CRITICAL: YOUR PREVIOUS ATTEMPT FAILED VALIDATION. YOU MUST CORRECT THE FOLLOWING ERRORS:**
- {{{retryContext}}}
---
Please correct these errors and try again.
{{/if}}

**FORMAT: {{{format}}}**
{{#if focusArchetype}}
**FOCUS ARCHETYPE: {{{focusArchetype}}}**
{{/if}}

**DECKLIST TO ANALYZE:**
{{{decklist}}}

**YOUR TASK:**

1.  **Provide a \`metaOverview\`**: Describe the current state of the {{{format}}} metagame. Include information about:
    - Top tier decks/archetypes
    - Current dominant strategies
    - Notable meta trends

2.  **Analyze \`deckStrengths\`**: Identify what the deck does well in the current meta.

3.  **Analyze \`deckWeaknesses\`**: Identify vulnerabilities in this deck against the current meta.

4.  **Provide \`matchupAnalysis\`**: Analyze key matchups against common meta decks and provide recommendations.

5.  **Provide \`cardSuggestions\`**:
    - \`cardsToAdd\`: Suggest cards that would improve the deck against the current meta. Include a \`reason\` for each card explaining its role.
    - \`cardsToRemove\`: Suggest cards that are underperforming in the current meta. Include a \`reason\` for each.
    - The total quantity of cards to add must equal the total quantity of cards to remove.

6.  **Provide \`sideboardSuggestions\`** (optional): Suggest cards for a sideboard that would help in the current meta.

7.  **Provide \`strategicAdvice\`: Strategic advice for playing this deck in the current meta, including play patterns and key decisions.

**VALIDATION RULES:**
*   All suggested cards must be legal in {{{format}}}.
*   Card names must be spelled correctly (use official Magic: The Gathering card names).
*   The total quantity of cards to add must equal the total quantity of cards to remove.
*   Each suggested card must include a clear reason for its inclusion.`,
});

const metaAnalysisFlow = ai.defineFlow(
  {
    name: 'metaAnalysisFlow',
    inputSchema: ExternalMetaAnalysisInputSchema,
    outputSchema: MetaAnalysisOutputSchema,
  },
  async (input) => {
    let attempts = 0;
    const maxAttempts = 3;
    let lastError = '';

    while (attempts < maxAttempts) {
      attempts++;
      
      // Get fresh model string for each attempt (allows runtime switching)
      // Note: model string is configured at prompt definition time
      const { output } = await metaAnalysisPrompt({
        ...input,
        retryContext: lastError || undefined,
      });

      if (!output) {
        lastError = 'Your response was empty. Please provide a complete meta analysis.';
        continue;
      }
      
      const validationErrors: string[] = [];

      // Validate deckStrengths and deckWeaknesses
      if (!Array.isArray(output.deckStrengths)) {
        validationErrors.push('deckStrengths must be an array.');
      }
      if (!Array.isArray(output.deckWeaknesses)) {
        validationErrors.push('deckWeaknesses must be an array.');
      }

      // Validate matchupAnalysis
      if (!Array.isArray(output.matchupAnalysis)) {
        validationErrors.push('matchupAnalysis must be an array.');
      }

      // Validate card suggestions
      if (!output.cardSuggestions || typeof output.cardSuggestions !== 'object') {
        validationErrors.push('cardSuggestions must be an object.');
      } else {
        const cardsToAdd = output.cardSuggestions.cardsToAdd || [];
        const cardsToRemove = output.cardSuggestions.cardsToRemove || [];

        // Validate card suggestion structure
        const validCardSuggestion = (c: { name?: string; quantity?: number; reason?: string }): boolean => 
          c && typeof c === 'object' && 
          typeof c.name === 'string' && c.name.trim() !== '' && 
          typeof c.quantity === 'number' && c.quantity > 0 &&
          typeof c.reason === 'string' && c.reason.trim() !== '';

        const validCardsToAdd = cardsToAdd.filter(validCardSuggestion);
        const validCardsToRemove = cardsToRemove.filter(validCardSuggestion);

        if (validCardsToAdd.length !== cardsToAdd.length) {
          validationErrors.push('Some cardsToAdd entries were malformed. Each must have name, quantity (>0), and reason.');
        }
        if (validCardsToRemove.length !== cardsToRemove.length) {
          validationErrors.push('Some cardsToRemove entries were malformed. Each must have name, quantity (>0), and reason.');
        }

        const addCount = validCardsToAdd.reduce((sum, c) => sum + c.quantity, 0);
        const removeCount = validCardsToRemove.reduce((sum, c) => sum + c.quantity, 0);

        if (addCount !== removeCount) {
          validationErrors.push(`You suggested adding ${addCount} cards but removing ${removeCount}. These counts must be equal.`);
        }

        // Validate card legality if there are cards to add
        if (validCardsToAdd.length > 0) {
          const cardNamesToValidate = validCardsToAdd.map(c => `${c.quantity} ${c.name}`).join('\n');
          const importResult = await importDecklist(cardNamesToValidate, input.format);
          
          if (importResult.notFound.length > 0) {
            validationErrors.push(`These cards could not be found: ${importResult.notFound.join(', ')}.`);
          }
          if (importResult.illegal.length > 0) {
            validationErrors.push(`These cards are not legal in ${input.format}: ${importResult.illegal.join(', ')}.`);
          }
        }
      }

      // Validate sideboardSuggestions if present
      if (output.sideboardSuggestions) {
        if (!Array.isArray(output.sideboardSuggestions)) {
          validationErrors.push('sideboardSuggestions must be an array.');
        } else {
          const validSideboard = output.sideboardSuggestions.filter((c: { name?: string; quantity?: number; reason?: string }) => 
            c && typeof c === 'object' && 
            typeof c.name === 'string' && c.name.trim() !== '' && 
            typeof c.quantity === 'number' && c.quantity > 0 &&
            typeof c.reason === 'string' && c.reason.trim() !== ''
          );
          if (validSideboard.length !== output.sideboardSuggestions.length) {
            validationErrors.push('Some sideboardSuggestions entries were malformed.');
          }
        }
      }

      // Validate strategicAdvice
      if (!output.strategicAdvice || typeof output.strategicAdvice !== 'string') {
        validationErrors.push('strategicAdvice must be a non-empty string.');
      }

      if (validationErrors.length === 0) {
        return output;
      }

      lastError = validationErrors.join('\n');
    }

    throw new Error(`The AI meta analysis failed to generate valid suggestions after ${maxAttempts} attempts. The last error was: ${lastError}`);
  }
);

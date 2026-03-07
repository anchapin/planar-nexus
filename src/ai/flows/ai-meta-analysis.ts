'use server';
/**
 * @fileOverview Heuristic meta analysis for deck optimization.
 *
 * Issue #440: Unit 6 - Server Action Elimination - AI Deck Coach
 *
 * This module provides offline metagame analysis using rule-based heuristics
 * instead of AI provider calls. Works entirely client-side for offline support.
 *
 * - analyzeMetaAndSuggest - Analyzes the metagame and provides deck improvement suggestions.
 * - MetaAnalysisInput - The input type for the analyzeMetaAndSuggest function.
 * - MetaAnalysisOutput - The return type for the analyzeMetaAndSuggest function.
 */

import { z } from 'genkit';
import { importDecklist } from '@/app/actions';
import { heuristicMetaAnalysis, type MetaAnalysisOutput as HeuristicMetaAnalysisOutput } from '@/lib/heuristic-meta-analysis';

const MetaAnalysisInputSchema = z.object({
  decklist: z
    .string()
    .describe(
      'The full Magic: The Gathering decklist as a string, typically one card per line with quantity.'
    ),
  format: z.string().describe('The Magic: The Gathering format (e.g., "Commander", "Standard", "Modern").'),
  focusArchetype: z.string().optional().describe('Optional specific archetype to focus on (e.g., "control", "aggro", "midrange", "combo").'),
});

export type MetaAnalysisInput = z.infer<typeof MetaAnalysisInputSchema>;

const CardSuggestionSchema = z.object({
  name: z.string().describe('The exact name of card.'),
  quantity: z.number().describe('How many copies to add/remove.'),
  reason: z.string().describe('Why this card is suggested - its role in the meta.'),
});

const MatchupRecommendationSchema = z.object({
  archetype: z.string().describe('The opposing deck archetype.'),
  recommendation: z.string().describe('How to adjust the deck against this matchup.'),
  sideboardNotes: z.string().optional().describe('Sideboard suggestions for this matchup.'),
});

const MetaAnalysisOutputSchema = z.object({
  metaOverview: z.string().describe("An overview of current metagame for specified format, including tier decks and trends."),
  deckStrengths: z.array(z.string()).describe("The deck's strengths in current meta."),
  deckWeaknesses: z.array(z.string()).describe("The deck's weaknesses in current meta."),
  matchupAnalysis: z.array(MatchupRecommendationSchema).describe("Analysis of key matchups in meta and how to improve them."),
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

const metaAnalysisFlow = async (
  input: MetaAnalysisInput
): Promise<MetaAnalysisOutput> => {
  // Get heuristic meta analysis
  const heuristicResult = await heuristicMetaAnalysis(
    input.decklist,
    input.format,
    input.focusArchetype
  );

  // Validate card suggestions
  const validationErrors: string[] = [];

  // Validate cardsToAdd
  if (heuristicResult.cardSuggestions.cardsToAdd.length > 0) {
    const decklistForImport = heuristicResult.cardSuggestions.cardsToAdd
      .map(c => `${c.quantity} ${c.name}`)
      .join('\n');
    const importResult = await importDecklist(decklistForImport, input.format);

    if (importResult.notFound.length > 0) {
      validationErrors.push(`These cards could not be found: ${importResult.notFound.join(', ')}.`);
    }
    if (importResult.illegal.length > 0) {
      validationErrors.push(`These cards are not legal in ${input.format}: ${importResult.illegal.join(', ')}.`);
    }
  }

  // Validate cardsToRemove
  if (heuristicResult.cardSuggestions.cardsToRemove.length > 0) {
    const decklistForImport = heuristicResult.cardSuggestions.cardsToRemove
      .map(c => `${c.quantity} ${c.name}`)
      .join('\n');
    const importResult = await importDecklist(decklistForImport, input.format);

    if (importResult.notFound.length > 0) {
      validationErrors.push(`These cards could not be found: ${importResult.notFound.join(', ')}.`);
    }
  }

  if (validationErrors.length > 0) {
    throw new Error(`The heuristic meta analysis failed validation. Errors: ${validationErrors.join('\n')}`);
  }

  return {
    metaOverview: heuristicResult.metaOverview,
    deckStrengths: heuristicResult.deckStrengths,
    deckWeaknesses: heuristicResult.deckWeaknesses,
    matchupAnalysis: heuristicResult.matchupAnalysis,
    cardSuggestions: heuristicResult.cardSuggestions,
    sideboardSuggestions: heuristicResult.sideboardSuggestions,
    strategicAdvice: heuristicResult.strategicAdvice,
  };
};

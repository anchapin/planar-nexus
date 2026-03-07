'use server';
/**
 * @fileOverview Heuristic-powered meta analysis for deck optimization.
 *
 * Issue #440: Replace AI provider calls with heuristic metagame analysis.
 *
 * This module provides heuristic-based deck optimization based on current
 * Magic: The Gathering metagame analysis using format-specific data.
 *
 * - analyzeMetaAndSuggest - Analyzes the metagame and provides deck improvement suggestions.
 * - MetaAnalysisInput - The input type for analyzeMetaAndSuggest function.
 * - MetaAnalysisOutput - The return type for analyzeMetaAndSuggest function.
 */

import { analyzeMetaHeuristic } from '@/lib/heuristic-meta-analysis';
import { importDecklist } from '@/lib/server-card-operations';
import { type Format } from '@/lib/game-rules';

export interface MetaAnalysisInput {
  decklist: string;
  format: string;
  focusArchetype?: string;
}

// Extended interface for heuristic analysis
interface HeuristicCard {
  name: string;
  count: number;
  id: string;
  cmc: number;
  colors: string[];
  legalities: Record<string, string>;
  type_line: string;
  mana_cost: string;
  color_identity: string[];
}

/**
 * Represents a card suggestion with name and quantity
 */
export interface CardSuggestion {
  name: string;
  quantity: number;
  reason: string;
}

/**
 * Represents a matchup recommendation
 */
export interface MatchupRecommendation {
  archetype: string;
  recommendation: string;
  sideboardNotes?: string;
}

/**
 * Meta analysis output
 */
export interface MetaAnalysisOutput {
  metaOverview: string;
  deckStrengths: string[];
  deckWeaknesses: string[];
  matchupAnalysis: MatchupRecommendation[];
  cardSuggestions: {
    cardsToAdd: CardSuggestion[];
    cardsToRemove: CardSuggestion[];
  };
  sideboardSuggestions?: CardSuggestion[];
  strategicAdvice: string;
}

/**
 * Convert heuristic meta analysis output to the expected format
 */
function convertHeuristicOutput(
  heuristicResult: ReturnType<typeof analyzeMetaHeuristic>,
  format: string
): MetaAnalysisOutput {
  // Extract deck strengths and weaknesses from the analysis
  const deckStrengths: string[] = [];
  const deckWeaknesses: string[] = [];

  // Analyze the heuristic recommendations to infer strengths/weaknesses
  heuristicResult.recommendations.forEach(rec => {
    if (rec.description.includes("naturally strong")) {
      deckStrengths.push(`Strong against ${rec.matchup.against}`);
    } else if (rec.description.includes("struggles against")) {
      deckWeaknesses.push(`Weak against ${rec.matchup.against}`);
    }
  });

  // Add format-specific strengths/weaknesses
  if (format === 'commander') {
    deckStrengths.push("Access to powerful Commanders and effects");
    deckWeaknesses.push("Slower game pace may struggle against fast combo");
  } else if (format === 'modern') {
    deckStrengths.push("Access to powerful modern cards");
    deckWeaknesses.push("Must prepare for diverse meta");
  }

  // Convert heuristic recommendations to matchup analysis
  const matchupAnalysis: MatchupRecommendation[] = heuristicResult.recommendations.map(rec => ({
    archetype: rec.matchup.against,
    recommendation: rec.description,
    sideboardNotes: rec.matchup.strategy,
  }));

  // Convert card suggestions with reasons
  const allCardsToAdd = heuristicResult.recommendations.flatMap(rec => rec.cardsToAdd || []);
  const allCardsToRemove = heuristicResult.recommendations.flatMap(rec => rec.cardsToRemove || []);

  const cardSuggestions: {
    cardsToAdd: CardSuggestion[];
    cardsToRemove: CardSuggestion[];
  } = {
    cardsToAdd: allCardsToAdd.map(card => ({
      name: card.name,
      quantity: card.quantity,
      reason: `Improves performance against metagame archetypes based on heuristic analysis`,
    })),
    cardsToRemove: allCardsToRemove.map(card => ({
      name: card.name,
      quantity: card.quantity,
      reason: `Underperforming in current metagame according to heuristic analysis`,
    })),
  };

  // Generate strategic advice
  const strategicAdvice = `Based on the ${format} metagame, focus on ${heuristicResult.currentMeta} ` +
    `${heuristicResult.archetypes.slice(0, 3).map(a => a.name).join(', ')} are the dominant archetypes. ` +
    `Prepare your deck with appropriate answers and strategies for these common matchups. ` +
    `The heuristic analysis suggests optimizing for ${heuristicResult.recommendations.map(r => r.title).join(' and ')}.`;

  return {
    metaOverview: heuristicResult.currentMeta,
    deckStrengths,
    deckWeaknesses,
    matchupAnalysis,
    cardSuggestions,
    sideboardSuggestions: cardSuggestions.cardsToAdd.slice(0, 5), // Limit sideboard suggestions
    strategicAdvice,
  };
}

export async function analyzeMetaAndSuggest(
  input: MetaAnalysisInput
): Promise<MetaAnalysisOutput> {
  // Parse the decklist to get card data
  const lines = input.decklist.split('\n').filter(line => line.trim() !== '');
  const cards: HeuristicCard[] = [];

  // Simple parser
  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (match) {
      const [, quantity, name] = match;
      cards.push({
        name: name.trim(),
        count: parseInt(quantity, 10),
        // Add placeholder properties to satisfy DeckCard type
        id: crypto.randomUUID(),
        cmc: 0,
        colors: [],
        legalities: {},
        type_line: 'Unknown',
        mana_cost: '{0}',
        color_identity: [],
      });
    }
  }

  // Use heuristic analysis instead of AI
  const heuristicResult = analyzeMetaHeuristic(
    input.decklist,
    input.format,
    cards,
    input.focusArchetype
  );

  // Validate card suggestions for legality
  const validatedOutput = convertHeuristicOutput(heuristicResult, input.format);

  // Validate cards to add for legality
  if (validatedOutput.cardSuggestions.cardsToAdd.length > 0) {
    const cardNamesToValidate = validatedOutput.cardSuggestions.cardsToAdd
      .map(c => `${c.quantity} ${c.name}`)
      .join('\n');

    const importResult = await importDecklist(cardNamesToValidate, input.format);

    if (importResult.notFound.length > 0 || importResult.illegal.length > 0) {
      // Remove illegal or not found cards
      validatedOutput.cardSuggestions.cardsToAdd = validatedOutput.cardSuggestions.cardsToAdd.filter(
        c => !importResult.notFound.includes(c.name) && !importResult.illegal.includes(c.name)
      );
    }
  }

  // Ensure equal counts in card suggestions
  const addCount = validatedOutput.cardSuggestions.cardsToAdd.reduce((sum, c) => sum + c.quantity, 0);
  const removeCount = validatedOutput.cardSuggestions.cardsToRemove.reduce((sum, c) => sum + c.quantity, 0);

  if (addCount !== removeCount) {
    // Adjust removals to match additions
    while (validatedOutput.cardSuggestions.cardsToRemove.reduce((sum, c) => sum + c.quantity, 0) > addCount) {
      const last = validatedOutput.cardSuggestions.cardsToRemove.pop();
      if (last) {
        last.quantity = Math.max(0, last.quantity - 1);
        if (last.quantity > 0) {
          validatedOutput.cardSuggestions.cardsToRemove.push(last);
        }
      }
    }
  }

  return validatedOutput;
}

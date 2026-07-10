/**
 * @fileOverview Opponent deck generation using enhanced heuristic algorithms
 *
 * This module has been updated to use client-side heuristic algorithms instead of AI providers.
 * Issue #441: Eliminate AI provider dependencies for opponent generation
 *
 * - generateAIOpponentDeck - A function that generates opponent decks using heuristic algorithms
 * - AIOpponentDeckGenerationInput - The input type for the generateAIOpponentDeck function
 * - AIOpponentDeckGenerationOutput - The return type for the generateAIOpponentDeck function
 */

import {
  generateOpponentDeck,
  generateRandomDeck,
  generateThemedDeck,
  type CounterTargetArchetype,
} from "@/lib/opponent-deck-generator";
import type { Format } from "@/lib/game-rules";
import type {
  StrategicTheme,
  DifficultyLevel,
} from "@/lib/opponent-deck-generator";
import {
  classifyDifficultyFormat,
  getDifficultyConfig,
  type DifficultyFormat,
} from "@/ai/ai-difficulty";

// Input Schema - simplified for heuristic generation
interface AIOpponentDeckGenerationInput {
  theme?: StrategicTheme;
  difficulty?: DifficultyLevel;
  format?: Format;
  colorIdentity?: string[];
  /**
   * Detected archetype of the human player (issue #1229). When supplied the
   * generator injects a tuned hate package targeting that archetype — e.g.
   * Grafdigger's Cage, Deafening Silence, Pithing Needle for combo; lifegain
   * + sweepers for aggro. Omit it (or pass nothing) to keep the pre-#1229
   * behavior. Plumbed through from the single-player game-setup path after
   * `archetype-detector.detectArchetype()` produces a result.
   */
  targetArchetype?: CounterTargetArchetype;
}

interface AIOpponentDeckGenerationOutput {
  deckList: string[];
  strategicApproach: string;
}

/**
 * Resolve the per-format AI difficulty config for a deck-generation request
 * (issue #1069). The supplied `format` (detailed game-mode ID or legacy alias)
 * is classified into a format family, then the format override is merged over
 * the base difficulty config (format wins). Exposed so callers/tests can verify
 * the resolved config without running the full heuristic generator.
 */
export function resolveAIOpponentDifficultyConfig(
  difficulty: DifficultyLevel,
  format?: Format,
) {
  return getDifficultyConfig(difficulty, classifyDifficultyFormat(format));
}

/**
 * Build a short, format-aware strategy note derived from the *resolved*
 * per-format difficulty config (so deck generation demonstrably respects the
 * per-format tuning, issue #1069). Returns an empty string for unknown formats
 * (base behavior).
 */
function formatStrategyNote(
  difficulty: DifficultyLevel,
  format?: Format,
): string {
  const family: DifficultyFormat | undefined = classifyDifficultyFormat(format);
  if (!family) return "";
  const weights = resolveAIOpponentDifficultyConfig(
    difficulty,
    format,
  ).evaluationWeights;
  switch (family) {
    case "commander":
      return ` Per-format tuning (Commander): orients around 21 commander damage (weight ${weights.commanderDamageWeight}) and long-game synergy.`;
    case "limited":
      return ` Per-format tuning (Limited): low-curve creature tempo (creature-power weight ${weights.creaturePower}).`;
    case "constructed":
      return ` Per-format tuning (Constructed): tight competitive tempo and card advantage (tempo weight ${weights.tempoAdvantage}).`;
    default:
      return "";
  }
}

// Wrapper function - now uses heuristic generation instead of AI
export async function generateAIOpponentDeck(
  input: AIOpponentDeckGenerationInput,
): Promise<AIOpponentDeckGenerationOutput> {
  try {
    const {
      theme,
      difficulty = "medium",
      format = "commander",
      colorIdentity,
      targetArchetype,
    } = input;

    // Generate deck using heuristic algorithms. Issue #1229: forward the
    // detected player archetype so the generator injects a tuned hate
    // package (combo -> cage/effect hate, aggro -> lifegain/sweepers, etc.).
    const generatedDeck = theme
      ? generateThemedDeck(theme, format, difficulty)
      : generateOpponentDeck({
          format,
          difficulty,
          colorIdentity: colorIdentity,
          targetArchetype,
        });

    // Convert card objects to string format for backward compatibility
    const deckList = generatedDeck.cards.map((card) => {
      return card.quantity > 1 ? `${card.name} x${card.quantity}` : card.name;
    });

    return {
      deckList,
      strategicApproach: `${generatedDeck.strategicApproach}${formatStrategyNote(difficulty, format)}`,
    };
  } catch (error) {
    console.error("Error generating opponent deck:", error);
    throw new Error("Failed to generate opponent deck.");
  }
}

/**
 * Generate random opponent deck
 */
export async function generateRandomOpponent(
  format: Format = "commander",
): Promise<AIOpponentDeckGenerationOutput> {
  try {
    const generatedDeck = generateRandomDeck(format);

    const deckList = generatedDeck.cards.map((card) => {
      return card.quantity > 1 ? `${card.name} x${card.quantity}` : card.name;
    });

    return {
      deckList,
      strategicApproach: generatedDeck.strategicApproach,
    };
  } catch (error) {
    console.error("Error generating random opponent deck:", error);
    throw new Error("Failed to generate random opponent deck.");
  }
}

// Export types for backward compatibility
export type { AIOpponentDeckGenerationInput, AIOpponentDeckGenerationOutput };

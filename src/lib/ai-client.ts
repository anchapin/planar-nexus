import { reviewDeck, DeckReviewInput } from "@/ai/flows/ai-deck-coach-review";
import {
  generateAIOpponentDeck,
  AIOpponentDeckGenerationInput,
} from "@/ai/flows/ai-opponent-deck-generation";
import { isProviderConfigured } from "@/ai/providers/factory";
import {
  generateOpponentDeck,
  generateThemedDeck,
  type GeneratedDeck,
  type StrategicTheme,
  type DifficultyLevel,
} from "@/ai/opponent-deck-generator";
import type { Format } from "@/lib/game-rules";

/**
 * @fileOverview Client-side wrappers around the AI flows.
 *
 * Formerly `src/app/actions.ts`, which was misnamed — it never was a
 * Next.js Server Actions file (no `"use server"` directive) and sat under
 * `src/app/` only to confuse readers. Renamed and relocated in issue
 * #1592. The canonical card-shape types (`ScryfallCard`, `DeckCard`,
 * `SavedDeck`) live in `@/lib/card-database` — do not re-colocate them
 * here.
 */

/**
 * Issue #1994 — detect whether any AI provider is configured so we can
 * prefer AI over the heuristic when a key is available (per AGENTS.md intent).
 * Heuristic remains the fallback for offline / unconfigured environments.
 */
function isAnyProviderConfigured(): boolean {
  return (
    isProviderConfigured("openai") ||
    isProviderConfigured("anthropic") ||
    isProviderConfigured("google") ||
    isProviderConfigured("zaic")
  );
}

/**
 * Client-side function for AI deck review
 */
export async function getDeckReview(input: DeckReviewInput) {
  try {
    // Issue #1994: use AI when any provider is configured, heuristic otherwise
    const useAI = isAnyProviderConfigured();
    const review = await reviewDeck(input, useAI);
    return review;
  } catch (error) {
    console.error("Error getting deck review:", error);
    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw new Error("Failed to get deck review from AI.");
  }
}

/**
 * Heuristic fallback for opponent deck generation.
 * Issue #2085: provides a direct heuristic path when generateAIOpponentDeck fails.
 */
export async function generateOpponentDeckFromHeuristics(
  input: AIOpponentDeckGenerationInput,
): Promise<GeneratedDeck> {
  const {
    theme,
    difficulty = "medium",
    format = "commander",
    colorIdentity,
    targetArchetype,
  } = input;

  return theme
    ? generateThemedDeck(theme, format as Format, difficulty as DifficultyLevel)
    : generateOpponentDeck({
        format: format as Format,
        difficulty: difficulty as DifficultyLevel,
        colorIdentity,
        targetArchetype,
      });
}

/**
 * Result type for opponent deck generation.
 * Issue #2085: enables UI to label the opponent as AI-generated or heuristic.
 */
export interface GenerateOpponentResult {
  source: "ai" | "heuristic";
  deck: GeneratedDeck;
}

/**
 * Client-side function for AI opponent generation.
 * Issue #2085: falls back to heuristic if AI generation fails.
 */
export async function generateOpponent(
  input: AIOpponentDeckGenerationInput,
): Promise<GenerateOpponentResult> {
  // Try AI generation first
  try {
    const opponent = await generateAIOpponentDeck(input);
    // Convert AIOpponentDeckGenerationOutput to GeneratedDeck
    // Issue #2085: derive deck properties from the generation input and output
    const deck: GeneratedDeck = {
      name: "AI Opponent",
      archetype: "control", // default archetype for AI-generated decks
      theme: input.theme ?? "control",
      description: opponent.strategicApproach,
      strategicApproach: opponent.strategicApproach,
      cards: opponent.deckList.map((line) => {
        const match = line.match(/^(\d+)\s+(.+)$/);
        return match
          ? { name: match[2]!.trim(), quantity: parseInt(match[1]!, 10) }
          : { name: line.trim(), quantity: 1 };
      }),
      colorIdentity: input.colorIdentity ?? [],
      difficulty: input.difficulty ?? "medium",
      format: input.format ?? "commander",
    };
    return { source: "ai", deck };
  } catch (error) {
    console.error(
      "Error generating AI opponent, falling back to heuristic:",
      error,
    );
  }

  // Fall back to heuristic generation
  try {
    const deck = await generateOpponentDeckFromHeuristics(input);
    return { source: "heuristic", deck };
  } catch (fallbackError) {
    console.error("Error generating heuristic opponent:", fallbackError);
    throw new Error("Failed to generate opponent deck.");
  }
}

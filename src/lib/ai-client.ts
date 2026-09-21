import { reviewDeck, DeckReviewInput } from "@/ai/flows/ai-deck-coach-review";
import {
  generateAIOpponentDeck,
  AIOpponentDeckGenerationInput,
} from "@/ai/flows/ai-opponent-deck-generation";
import { isProviderConfigured } from "@/ai/providers/factory";

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
  return isProviderConfigured("openai") ||
    isProviderConfigured("anthropic") ||
    isProviderConfigured("google") ||
    isProviderConfigured("zaic");
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
 * Client-side function for AI opponent generation
 */
export async function generateOpponent(input: AIOpponentDeckGenerationInput) {
  try {
    const opponent = await generateAIOpponentDeck(input);
    return opponent;
  } catch (error) {
    console.error("Error generating AI opponent:", error);
    throw new Error("Failed to generate AI opponent.");
  }
}

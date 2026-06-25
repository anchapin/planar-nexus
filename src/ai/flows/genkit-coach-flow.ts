/**
 * @fileOverview Stub for Genkit conversational AI coach flow.
 *
 * The Genkit dependency was removed in Issue #446. This file is retained
 * as a non-functional stub so the /api/chat/coach route can handle the
 * unavailability gracefully instead of crashing the build.
 *
 * Issue #923: the flow now carries a STRUCTURED deck analysis
 * (`structuredAnalysis`) on its input and builds the system prompt from it
 * (via `buildCoachSystemPrompt`) rather than a raw card list. The prompt is
 * constructed so that, when Genkit is re-added, this flow will immediately
 * produce archetype/synergy-aware coaching with no further changes.
 *
 * The heuristic deck coach (src/lib/heuristic-deck-coach.ts) and the
 * AI deck review flow (src/ai/flows/ai-deck-coach-review.ts) are unaffected.
 */

import type { z } from "zod";
import type { CoachFlowInputSchema } from "../types";
import { buildCoachSystemPrompt } from "./context-builder";

type CoachFlowInput = z.infer<typeof CoachFlowInputSchema>;

/**
 * Build the coach system prompt from the flow input. Prefers the structured
 * deck analysis (issue #923) and falls back to a plain decklist only when no
 * analysis is available.
 */
export function buildCoachPromptFromInput(input: CoachFlowInput): string {
  return buildCoachSystemPrompt(
    input.format,
    "",
    input.archetype,
    input.strategy,
    input.digestedContext ? JSON.stringify(input.digestedContext) : undefined,
    input.structuredAnalysis,
  );
}

/**
 * Async generator that yields a single friendly "coming soon" message instead
 * of an error. Issue #1009: end users must never see a raw "unavailable"
 * string; the wording here steers them toward working coaching surfaces while
 * the Genkit-backed conversational flow is rebuilt.
 *
 * NOTE: `buildCoachPromptFromInput` is still invoked so the structured-analysis
 * path stays wired and covered by tests; its result is not streamed because the
 * Genkit dependency is absent (see issue #446).
 */
async function* generateComingSoonResponse(
  input: CoachFlowInput,
): AsyncGenerator<{
  content: Array<{ text: string }>;
}> {
  // Exercise the structured-analysis → prompt path (forward-compat + tests).
  void buildCoachPromptFromInput(input);

  yield {
    content: [
      {
        text: "The conversational AI coach is still being set up and will be ready soon. In the meantime, you can get instant deck analysis and recommendations from the Heuristic Deck Coach.",
      },
    ],
  };
}

/**
 * Stub coach flow that mimics the Genkit flow interface (`.stream()`).
 * Returns an async iterable yielding a friendly "coming soon" message.
 */
export const coachFlow = {
  stream(input: CoachFlowInput) {
    return generateComingSoonResponse(input);
  },
};

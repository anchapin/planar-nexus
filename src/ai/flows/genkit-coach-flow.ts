/**
 * @fileOverview Stub for Genkit conversational AI coach flow.
 *
 * The Genkit dependency was removed in Issue #446. This file is retained
 * as a non-functional stub so the /api/chat/coach route can handle the
 * unavailability gracefully instead of crashing the build.
 *
 * The heuristic deck coach (src/lib/heuristic-deck-coach.ts) and the
 * AI deck review flow (src/ai/flows/ai-deck-coach-review.ts) are unaffected.
 */

import type { z } from 'zod';
import type { CoachFlowInputSchema } from '../types';

type CoachFlowInput = z.infer<typeof CoachFlowInputSchema>;

/**
 * Async generator that yields a single error message indicating the
 * Genkit-based coach is unavailable.
 */
async function* generateUnavailableResponse(): AsyncGenerator<{ content: Array<{ text: string }> }> {
  yield {
    content: [
      {
        text: 'The AI conversational coach is currently unavailable. The Genkit dependency has been removed from this project. Please use the heuristic deck coach for deck analysis instead.',
      },
    ],
  };
}

/**
 * Stub coach flow that mimics the Genkit flow interface (`.stream()`).
 * Returns an async iterable yielding an unavailability message.
 */
export const coachFlow = {
  stream(_input: CoachFlowInput) {
    return generateUnavailableResponse();
  },
};

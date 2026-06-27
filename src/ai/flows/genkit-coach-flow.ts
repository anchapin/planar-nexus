/**
 * @fileOverview Conversational AI coach flow — multi-provider LLM backed.
 *
 * The Genkit dependency was removed in issue #446 (dead deps purged in
 * #1139/#1142). This flow NO LONGER stubs the model: it delegates to the
 * multi-provider LLM factory via {@link streamCoachResponse} (issue #1077),
 * so it streams REAL conversational responses with transparent provider
 * failover, cooperative cancellation, and prompt-injection guardrails.
 *
 * Issue #1071: previously `stream()` only yielded a canned "unavailable"
 * notice regardless of input. It now actually invokes the configured LLM
 * through the factory failover chain. The canned notice survives ONLY as the
 * local-first fallback emitted when NO provider is configured, so the coach
 * always answers instead of crashing.
 *
 * The `.stream()` interface is preserved (issue #1071 requirement): callers
 * still consume an async iterable of `{ content: [{ text }] }` chunks, so the
 * factory `CoachStreamEvent`s are projected back into that shape. The SSE route
 * (`src/app/api/chat/coach/route.ts`) consumes {@link streamCoachResponse}
 * directly; this flow is the reusable, interface-stable entry point that other
 * surfaces (and tests) can drive.
 *
 * Guardrails (#1107) are applied end-to-end:
 *   - The system prompt is built with {@link buildCoachSystemPrompt}, which
 *     prepends `SECURITY_PREAMBLE` and fences the structured analysis.
 *   - Each user/assistant turn is sanitized here (defense-in-depth) before it
 *     reaches the model; client-supplied `system` roles are dropped.
 *
 * The heuristic deck coach (`src/lib/heuristic-deck-coach.ts`) and the AI deck
 * review flow (`src/ai/flows/ai-deck-coach-review.ts`) are unaffected.
 */

import type { z } from "zod";
import type { CoachFlowInputSchema } from "../types";
import { buildCoachSystemPrompt } from "./context-builder";
import { sanitizeUserInput } from "@/ai/prompt-security";
import {
  getAIModel,
  getProviderFailoverChain,
  isProviderConfigured,
} from "@/ai/providers/factory";
import { streamCoachResponse, type CoachStreamMessage } from "./coach-stream";

type CoachFlowInput = z.infer<typeof CoachFlowInputSchema>;

/** Chunk shape yielded by {@link coachFlow}.`stream()` — preserved for back-compat. */
export interface CoachFlowChunk {
  content: Array<{ text: string }>;
}

/**
 * Options forwarded to the streaming orchestrator / factory. Most callers omit
 * these entirely; they exist so {@link coachFlow} stays unit-testable without
 * network access and so an explicit provider/model/signal can be injected.
 */
export interface CoachFlowStreamOptions {
  /** Override the failover chain (defaults to the factory chain from `input.provider`). */
  providers?: ReadonlyArray<string>;
  /** Override the model id (defaults to `input.modelId`). */
  modelId?: string;
  /** Abort signal forwarded to the provider stream for cooperative cancellation. */
  signal?: AbortSignal;
  /** Text streamed when no provider is configured (local-first fallback). */
  fallbackText?: string;
  /** Test seam: override provider resolution (defaults to the real factory). */
  getModel?: typeof getAIModel;
  /** Test seam: override credential detection. */
  isConfigured?: typeof isProviderConfigured;
}

/**
 * Build the guardrailed coach system prompt from the flow input. Prefers the
 * structured deck analysis (issue #923) and falls back to a plain decklist only
 * when no analysis is available.
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
 * Canned notice streamed ONLY when no provider is configured (local-first).
 * Distinct from the SSE route's notice so this flow stays self-contained.
 */
export const COACH_FLOW_FALLBACK_TEXT =
  "The conversational AI coach is currently unavailable because no LLM provider is configured. " +
  "You can still get instant deck analysis and recommendations from the Heuristic Deck Coach.";

/** Resolve the failover chain, honoring an explicit provider override. */
function resolveProviders(
  input: CoachFlowInput,
  override?: ReadonlyArray<string>,
): string[] {
  if (override && override.length > 0) return [...override];
  return getProviderFailoverChain(input.provider);
}

/**
 * Async generator that streams a real, factory-backed coach response.
 *
 * Reuses {@link streamCoachResponse} (issue #1077) for provider failover,
 * cooperative cancellation and the no-provider fallback — no duplicated
 * streaming machinery. The factory `CoachStreamEvent`s are projected back into
 * the flow's `{ content: [{ text }] }` chunk shape so the `.stream()`
 * interface is unchanged (issue #1071).
 *
 * - `text` events cover normal tokens AND the no-provider fallback.
 * - `error` events surface a graceful mid-stream failure notice as content.
 * - Control events (`provider`/`usage`/`failover`/`done`) are consumed by the
 *   SSE route directly and are not part of this flow's interface.
 */
async function* generateCoachResponse(
  input: CoachFlowInput,
  options: CoachFlowStreamOptions = {},
): AsyncGenerator<CoachFlowChunk> {
  const systemPrompt = buildCoachPromptFromInput(input);

  // Defense-in-depth (#1107): sanitize every user/assistant turn and drop any
  // client-supplied `system` role — the only system instructions come from the
  // server-built `systemPrompt` above.
  const messages: CoachStreamMessage[] = input.messages
    .map((m): CoachStreamMessage | null => {
      if (m.role !== "user" && m.role !== "assistant") return null;
      return {
        role: m.role,
        content: sanitizeUserInput(m.content, { maxLength: 20_000 }),
      };
    })
    .filter((m): m is CoachStreamMessage => m !== null);

  const eventStream = streamCoachResponse({
    systemPrompt,
    messages,
    providers: resolveProviders(input, options.providers),
    modelId: options.modelId ?? input.modelId,
    signal: options.signal,
    fallbackText: options.fallbackText ?? COACH_FLOW_FALLBACK_TEXT,
    getModel: options.getModel,
    isConfigured: options.isConfigured,
  });

  for await (const event of eventStream) {
    if (event.type === "text" || event.type === "error") {
      yield { content: [{ text: event.value }] };
    }
  }
}

/**
 * Conversational coach flow. Mimics the historical Genkit flow interface
 * (`.stream()`) but is now backed by the multi-provider LLM factory, so it
 * produces real streamed responses instead of a canned "unavailable" message
 * (issue #1071).
 */
export const coachFlow = {
  stream(input: CoachFlowInput, options?: CoachFlowStreamOptions) {
    return generateCoachResponse(input, options ?? {});
  },
};

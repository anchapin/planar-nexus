/**
 * @fileOverview Streaming orchestration for the conversational AI coach
 * (issue #1077).
 *
 * Wraps the Vercel AI SDK `streamText` call in an async generator that adds
 * three things the raw SDK call does not provide out of the box:
 *
 *   1. **Provider failover** — if the primary provider errors *before* any
 *      token is streamed, the next provider from the failover chain is tried
 *      transparently. Mid-stream failures (after tokens were already
 *      delivered) cannot be seamlessly resumed, so the stream is ended
 *      gracefully instead. This trade-off is documented in the issue.
 *   2. **Cooperative cancellation** — an `AbortSignal` is threaded through to
 *      `streamText`; when the signal aborts the generator stops cleanly
 *      without attempting further providers.
 *   3. **Structured stream events** — instead of raw text, the generator
 *      yields a discriminated union (`CoachStreamEvent`) so the route can emit
 *      SSE and the client can render progressively, surface token usage, and
 *      show failover telemetry.
 *
 * When no provider is configured (the default deployment state — see issue
 * #446) every provider is skipped and a graceful fallback message is yielded
 * so the coach remains usable instead of erroring.
 */

import { streamText } from "ai";
import {
  getAIModel,
  getProviderFailoverChain,
  isProviderConfigured,
} from "@/ai/providers/factory";

/** A single message in the coach conversation. */
export interface CoachStreamMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Normalized token-usage payload surfaced per coach message. */
export interface CoachTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * A durable coach-memory summary carried across turns (issue #1417). The
 * route emits the up-to-date summary as a `summary` event immediately after
 * pruning so the client can persist it with the conversation record. The
 * shape mirrors {@link CoachMemorySummary} from `coach-memory-summary.ts`,
 * kept opaque here (typed as `Record<string, unknown>`) so this module does
 * not need to import zod or the schema — the route owns the schema and
 * validates payloads before emitting.
 */
export type CoachMemorySummaryPayload = Record<string, unknown>;

/**
 * Discriminated union of events emitted while streaming a coach response.
 * The route serializes each event as one SSE `data:` line; the client parser
 * switches on `type`.
 *
 * Issue #1419 adds the `grounding` event: emitted ONCE, after the final text
 * delta and before `done`, when the post-generation guard flags the
 * completed message. The client appends the caveat to the assistant message
 * and sets `lowConfidence` / `needsReview` on the persisted record.
 */
export type CoachStreamEvent =
  | { type: "provider"; value: string }
  | { type: "failover"; from: string; to: string; reason: string }
  | { type: "text"; value: string }
  | { type: "usage"; provider: string; usage: CoachTokenUsage }
  | {
      type: "grounding";
      lowConfidence: boolean;
      needsReview: boolean;
      caveat: string;
      failures: string[];
    }
  | {
      type: "summary";
      /**
       * Updated coach-memory summary (issue #1417). Emitted once per request,
       * before the first `text` event, so the client can persist it
       * alongside the in-flight assistant message.
       */
      summary: CoachMemorySummaryPayload;
    }
  | { type: "error"; value: string }
  | { type: "done" };

/** Options for {@link streamCoachResponse}. */
export interface StreamCoachResponseOptions {
  /** Guardrailed system prompt (built by `buildCoachSystemPrompt`). */
  systemPrompt: string;
  /** Conversation messages (user content already sanitized by the caller). */
  messages: ReadonlyArray<CoachStreamMessage>;
  /** Ordered provider names to try; defaults to the factory failover chain. */
  providers?: ReadonlyArray<string>;
  /** Optional model id forwarded to every provider. */
  modelId?: string;
  /** Abort signal; aborting cancels generation and stops failover. */
  signal?: AbortSignal;
  /**
   * Text streamed to the user when every provider is exhausted (e.g. none
   * configured). Keeps the coach usable. Defaults to the standard
   * "unavailable" notice.
   */
  fallbackText?: string;
  /**
   * Test seam: override provider resolution. Defaults to the real factory.
   * Injecting it keeps {@link streamCoachResponse} unit-testable without
   * network access or `jest.mock`.
   */
  getModel?: typeof getAIModel;
  /** Test seam: override credential detection. */
  isConfigured?: typeof isProviderConfigured;
}

/** Default fallback streamed when no provider can answer. */
export const DEFAULT_FALLBACK_TEXT =
  "The AI conversational coach is currently unavailable. No LLM provider is configured. " +
  "Please use the heuristic deck coach for deck analysis instead.";

/**
 * Reduce a Vercel AI SDK usage object (whose field names changed across SDK
 * majors — `promptTokens`/`completionTokens` vs `inputTokens`/`outputTokens`)
 * into the normalized {@link CoachTokenUsage} shape. Best-effort: any
 * non-numeric value is treated as 0.
 */
function normalizeUsage(raw: unknown): CoachTokenUsage {
  const n = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(0, Math.floor(v))
      : 0;
  if (typeof raw !== "object" || raw === null) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  }
  const r = raw as Record<string, unknown>;
  const promptTokens = n(r.inputTokens ?? r.promptTokens);
  const completionTokens = n(r.outputTokens ?? r.completionTokens);
  const totalTokens = n(r.totalTokens) || promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

/** Human-readable, non-leaky message for an upstream provider error. */
function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/rate.?limit|429|too many requests/i.test(message)) {
    return "The coach provider is rate-limiting requests right now. Please try again shortly.";
  }
  if (/timeout|timed?\s*out|aborted/i.test(message)) {
    return "The coach provider took too long to respond. Please try again.";
  }
  return "The coach provider returned an error while generating a response.";
}

/**
 * Stream a coach response with transparent provider failover and cancellation.
 *
 * Failure policy (issue #1077):
 *   - Provider fails BEFORE any token is delivered → fail over to the next
 *     provider in the chain (a `failover` event is emitted first).
 *   - Provider fails AFTER tokens were delivered → end the stream gracefully
 *     (`error` + `done`); we do not attempt to resume a partial response.
 *   - Abort signal fires → stop immediately, no further providers are tried.
 *   - All providers exhausted → stream `fallbackText` so the user always gets
 *     a response.
 */
export async function* streamCoachResponse(
  options: StreamCoachResponseOptions,
): AsyncGenerator<CoachStreamEvent> {
  const {
    systemPrompt,
    messages,
    modelId,
    signal,
    fallbackText = DEFAULT_FALLBACK_TEXT,
    getModel = getAIModel,
    isConfigured = isProviderConfigured,
  } = options;

  const chain =
    options.providers && options.providers.length > 0
      ? [...options.providers]
      : getProviderFailoverChain();

  let lastReason = "not-attempted";

  for (let index = 0; index < chain.length; index++) {
    const provider = chain[index];

    if (signal?.aborted) return;

    // Skip providers with no detectable credentials so unconfigured deployments
    // do not fan out doomed network calls. The failover event lets observers
    // (and tests) see why a provider was bypassed.
    if (!isConfigured(provider)) {
      lastReason = "not-configured";
      const next = chain[index + 1];
      if (next) {
        yield {
          type: "failover",
          from: provider,
          to: next,
          reason: lastReason,
        };
      }
      continue;
    }

    yield { type: "provider", value: provider };

    let model: Awaited<ReturnType<typeof getAIModel>>;
    try {
      model = await getModel(provider, modelId);
    } catch (error) {
      if (signal?.aborted) return;
      lastReason = "model-setup-failed";
      const next = chain[index + 1];
      if (next) {
        yield {
          type: "failover",
          from: provider,
          to: next,
          reason: lastReason,
        };
      }
      continue;
    }

    if (signal?.aborted) return;

    const result = streamText({
      model,
      system: systemPrompt,
      messages: messages as Array<{
        role: "system" | "user" | "assistant";
        content: string;
      }>,
      abortSignal: signal,
    });

    let streamedAny = false;
    try {
      for await (const delta of result.textStream) {
        if (signal?.aborted) {
          // User cancelled mid-generation — stop without failing over.
          return;
        }
        if (delta) {
          streamedAny = true;
          yield { type: "text", value: delta };
        }
      }
    } catch (error) {
      if (signal?.aborted) return;
      if (streamedAny) {
        // Mid-stream failure: cannot seamlessly resume a half-delivered
        // response. End gracefully (documented policy).
        yield { type: "error", value: friendlyError(error) };
        yield { type: "done" };
        return;
      }
      // Failed before any token was delivered → try the next provider.
      lastReason = /rate.?limit|429/i.test(
        error instanceof Error ? error.message : String(error),
      )
        ? "rate-limited"
        : "stream-error";
      const next = chain[index + 1];
      if (next) {
        yield {
          type: "failover",
          from: provider,
          to: next,
          reason: lastReason,
        };
      }
      continue;
    }

    if (signal?.aborted) return;

    // Stream completed normally — surface usage (best-effort) and finish.
    try {
      const usage = normalizeUsage(await Promise.resolve(result.totalUsage));
      if (usage.totalTokens > 0) {
        yield { type: "usage", provider, usage };
      }
    } catch {
      // Usage is optional telemetry; never fail a successful stream on it.
    }

    yield { type: "done" };
    return;
  }

  // Every provider was skipped or failed and the user did not cancel.
  // Stream a graceful fallback so the coach always answers.
  yield { type: "text", value: fallbackText };
  yield { type: "done" };
}

/**
 * Serialize a {@link CoachStreamEvent} as a single Server-Sent-Events data
 * line (`data: <json>\n\n`). Centralized so the route and its tests share the
 * exact wire format.
 */
export function eventToSse(event: CoachStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

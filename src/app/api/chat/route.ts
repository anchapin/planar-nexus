import { NextRequest, NextResponse } from "next/server";
import {
  streamCoachResponse,
  eventToSse,
  type CoachStreamEvent,
  type CoachStreamMessage,
} from "@/ai/flows/coach-stream";
import { getProviderFailoverChain } from "@/ai/providers/factory";
import type { AIProvider } from "@/ai/providers/types";
import { SECURITY_PREAMBLE, sanitizeUserInput } from "@/ai/prompt-security";
import {
  enforceRateLimit,
  RateLimitError,
  type RateLimitConfig,
} from "@/lib/server-rate-limiter";
import { getClientIdentifier } from "@/lib/server-request-identity";
import { UsageLogger } from "@/lib/server-usage-logger";

// Use force-dynamic to prevent response buffering
export const dynamic = "force-dynamic";

/**
 * Unified Chat API Route — HARDENED (issue #1534).
 *
 * Decision: **HARDEN** (not remove). The route retains real in-tree callers
 * (`useGameChat` → game-board page + AI-coach chat panel), and migrating game
 * chat onto `/api/chat/coach` is not possible because the coach contract
 * requires `deckCards`/`digestedContext` and `format`, which game chat does
 * not have. Per the issue directive, the route therefore delegates to the
 * SAME shared pipeline as `/api/chat/coach` (`streamCoachResponse`) so the
 * two paths cannot diverge in safety posture. It no longer invokes
 * `streamText` directly and never forwards arbitrary client messages to the
 * model.
 *
 * Guardrails (mirroring the conversational coach route):
 *   - Client-supplied `system` messages are DROPPED; the system prompt is
 *     always rebuilt server-side from the shared `SECURITY_PREAMBLE` plus a
 *     fixed in-game assistant role block. Client content can never become
 *     system content.
 *   - Every user/assistant message is sanitized with the shared
 *     `sanitizeUserInput` (control-character stripping + injection-phrase
 *     redaction + length clamp) — identical policy to the coach route.
 *   - Provider selection goes through `getProviderFailoverChain` (the factory
 *     allowlist), never an arbitrary client string; unconfigured providers
 *     are skipped by the shared pipeline.
 *   - Output is capped server-side via `maxOutputTokens` — the client cannot
 *     request unbounded generation.
 *   - The client's abort signal is threaded through to the provider so
 *     cancelled requests stop generation server-side.
 *   - Rate limiting uses `getClientIdentifier` (issue #1393 policy, shared
 *     with `/api/ai-proxy`): the bucket key is derived solely from
 *     server-verified request metadata and NEVER from the request body.
 *   - Token usage is logged via the shared `UsageLogger` (matching
 *     `/api/ai-proxy`) and emitted to the client as a structured SSE
 *     `usage` event.
 *
 * Wire format: Server-Sent Events, one JSON `CoachStreamEvent` per `data:`
 * line (`provider` | `failover` | `text` | `usage` | `error` | `done`), the
 * exact same stream the coach route emits.
 *
 * POST /api/chat
 * Body: { messages: Array<{ role: "user" | "assistant", content: string }>,
 *         provider?: string, modelId?: string }
 */

/** Per-message input clamp — same value the coach route enforces. */
const MAX_INPUT_LENGTH = 20_000;

/**
 * Server-authoritative generation cap. The pre-#1534 route accepted
 * unbounded output; a fixed cap bounds credit burn per request.
 */
const MAX_OUTPUT_TOKENS = 2048;

/** Per-client rate limit for the chat endpoint. Exported for test parity checks. */
export const CHAT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 30,
  message: "Chat rate limit exceeded. Please try again shortly.",
};

/**
 * Server-side system prompt. Built exclusively from trusted constants: the
 * shared `SECURITY_PREAMBLE` (the same guardrail the coach prompt prepends)
 * plus a fixed role block. No client input reaches this string.
 */
function buildChatSystemPrompt(): string {
  return [
    SECURITY_PREAMBLE,
    "",
    "You are the in-game AI assistant for a digital Magic: The Gathering",
    "tabletop app. Answer briefly and helpfully about the game in progress,",
    "rules questions, and card interactions. Stay strictly in role; never",
    "output code, credentials, or content unrelated to Magic: The Gathering.",
  ].join("\n");
}

/**
 * Drop every message the client cannot be trusted to author. Only
 * `user`/`assistant` roles survive (client `system` messages are discarded),
 * and surviving content passes through the shared sanitizer. Returns `null`
 * for messages that must be dropped entirely.
 */
function sanitizeChatMessages(raw: unknown[]): CoachStreamMessage[] {
  return raw
    .map((item): CoachStreamMessage | null => {
      if (typeof item !== "object" || item === null) return null;
      const m = item as { role?: unknown; content?: unknown };
      if (m.role !== "user" && m.role !== "assistant") return null;
      const content = sanitizeUserInput(m.content, {
        maxLength: MAX_INPUT_LENGTH,
      });
      return { role: m.role, content };
    })
    .filter((m): m is CoachStreamMessage => m !== null);
}

const KNOWN_PROVIDERS: ReadonlySet<string> = new Set([
  "google",
  "openai",
  "anthropic",
  "zaic",
  "custom",
]);

/** Narrow a failover-chain provider name to the {@link AIProvider} union. */
function asAIProvider(provider: string): AIProvider {
  return KNOWN_PROVIDERS.has(provider) ? (provider as AIProvider) : "custom";
}

/**
 * Wrap the shared coach stream so completed usage is logged through the
 * shared `UsageLogger` (parity with `/api/ai-proxy`). Events are re-emitted
 * verbatim — logging is observability only and must never alter the wire
 * contract.
 */
async function* withUsageLogging(
  upstream: AsyncIterable<CoachStreamEvent>,
  clientIdentifier: string,
): AsyncGenerator<CoachStreamEvent> {
  for await (const event of upstream) {
    if (event.type === "usage" && event.usage.totalTokens > 0) {
      try {
        const usageLogger = new UsageLogger(
          clientIdentifier,
          asAIProvider(event.provider),
          "/api/chat",
        );
        usageLogger.setTokenUsage(
          event.usage.promptTokens,
          event.usage.completionTokens,
        );
        await usageLogger.markSuccess().save();
      } catch (error) {
        // Usage logging is best-effort telemetry; never fail the stream.
        console.error("Chat usage logging failed:", error);
      }
    }
    yield event;
  }
}

export async function POST(req: NextRequest) {
  try {
    // 1. Parse request body
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { messages, provider, modelId } = (body ?? {}) as {
      messages?: unknown;
      provider?: unknown;
      modelId?: unknown;
    };

    // 2. Validate required fields
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Missing or invalid messages" },
        { status: 400 },
      );
    }

    // 3. Sanitize: drop client `system` messages and sanitize surviving
    //    content (see module docstring). A request whose every message was
    //    dropped has nothing to send to the model.
    const sanitizedMessages = sanitizeChatMessages(messages);
    if (sanitizedMessages.length === 0) {
      return NextResponse.json(
        {
          error:
            "No valid messages: only user/assistant roles are accepted and content must be non-empty",
        },
        { status: 400 },
      );
    }

    // 4. Rate limit on the SERVER-VERIFIED client identity (issue #1393
    //    policy, shared with /api/ai-proxy). The bucket key never reads the
    //    body, so a client cannot rotate or influence its own bucket.
    const clientIdentifier = getClientIdentifier(req);
    let rateLimitResult;
    try {
      rateLimitResult = enforceRateLimit(clientIdentifier, CHAT_RATE_LIMIT);
    } catch (error) {
      if (error instanceof RateLimitError) {
        return NextResponse.json(
          {
            error: error.message,
            errorCode: "RATE_LIMIT_EXCEEDED",
            retryAfter: error.retryAfter,
          },
          {
            status: 429,
            headers: { "Retry-After": String(error.retryAfter) },
          },
        );
      }
      throw error;
    }

    // 5. Delegate to the SHARED coach streaming pipeline (issue #1534):
    //    provider allowlist + failover, server-side system prompt,
    //    cancellation, provider-health backoff, and the structured SSE event
    //    stream — the exact same model-invocation path /api/chat/coach uses.
    const eventStream = streamCoachResponse({
      systemPrompt: buildChatSystemPrompt(),
      messages: sanitizedMessages,
      providers: getProviderFailoverChain(
        typeof provider === "string" ? provider : undefined,
      ),
      modelId: typeof modelId === "string" ? modelId : undefined,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      signal: req.signal,
    });

    void rateLimitResult;

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of withUsageLogging(
            eventStream,
            clientIdentifier,
          )) {
            controller.enqueue(encoder.encode(eventToSse(event)));
          }
          controller.close();
        } catch (error) {
          console.error("Chat streaming error:", error);
          try {
            controller.enqueue(
              encoder.encode(
                eventToSse({
                  type: "error",
                  value:
                    error instanceof Error
                      ? error.message
                      : "Internal streaming error",
                }),
              ),
            );
          } catch {
            // controller may already be errored/closed; nothing more to do.
          }
          controller.close();
        }
      },
      cancel() {
        // Client disconnected; req.signal has already aborted the shared
        // pipeline. Informational only.
      },
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: unknown) {
    console.error("Chat API Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "An internal error occurred",
      },
      { status: 500 },
    );
  }
}

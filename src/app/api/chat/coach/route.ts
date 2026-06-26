import { NextRequest, NextResponse } from "next/server";
import type { DeckCard } from "@/app/actions";
import { prefetchCoachContext } from "@/ai/flows/coach-context-prefetch";
import { buildCoachSystemPrompt } from "@/ai/flows/context-builder";
import {
  streamCoachResponse,
  eventToSse,
  type CoachStreamMessage,
} from "@/ai/flows/coach-stream";
import { getProviderFailoverChain } from "@/ai/providers/factory";
import { sanitizeUserInput } from "@/ai/prompt-security";

/**
 * API Route for the Conversational AI Coach.
 *
 * Streams responses token-by-token as Server-Sent Events so the UI can render
 * progressively, cancel an in-flight generation, and surface per-message token
 * usage (issue #1077). The route also performs transparent provider failover:
 * if the primary LLM provider errors before any token is delivered, the next
 * provider from the factory failover chain is tried automatically.
 *
 * Prompt-injection guardrails (#1107) are preserved end-to-end:
 *   - The system prompt is built with `buildCoachSystemPrompt`, which prepends
 *     `SECURITY_PREAMBLE` and sanitizes/wraps every deck field.
 *   - Each user/assistant message's content is additionally sanitized here
 *     (defense-in-depth) before it is forwarded to the model.
 *   - Client-supplied `system` messages are dropped; the system prompt is
 *     always assembled server-side.
 *
 * Cancellation: the client aborts its `fetch` via an `AbortController`; that
 * propagates to `request.signal`, which is threaded through to the provider
 * call so generation stops server-side within one chunk.
 *
 * Issue #928: context is PRE-FETCHED (in parallel, with caching) before the
 * model is invoked, so request→model latency meets the WORKER-03 target.
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // 1. Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const { messages, deckCards, digestedContext, format } = body;

    // 2. Validate required fields
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { success: false, error: "Messages are required and must be an array" },
        { status: 400 },
      );
    }

    if (!deckCards && !digestedContext) {
      return NextResponse.json(
        {
          success: false,
          error: "Either deckCards or digestedContext is required",
        },
        { status: 400 },
      );
    }

    if (!format) {
      return NextResponse.json(
        { success: false, error: "Format is required" },
        { status: 400 },
      );
    }

    // 3. PRE-FETCH all coach context up-front and in parallel (issue #928).
    //    Resolves the structured deck analysis (archetype, synergy clusters,
    //    curve, roles, gaps) before the model is invoked, with caching so a
    //    coaching session asking many questions about the same deck skips
    //    re-computation. When the client already supplied a digested context we
    //    keep it; raw cards are enriched with the structured analysis.
    let structuredAnalysis: string | undefined;
    if (deckCards && Array.isArray(deckCards) && deckCards.length > 0) {
      try {
        const prefetched = await prefetchCoachContext({
          deckCards: deckCards as DeckCard[],
          format,
        });
        if (prefetched) {
          structuredAnalysis = prefetched.structuredAnalysisText;
        }
      } catch (error) {
        console.error("Coach context pre-fetch failed:", error);
      }
    }

    // 4. Build a GUARDRAILED system prompt (issue #1107). `buildCoachSystemPrompt`
    //    prepends SECURITY_PREAMBLE and sanitizes/wraps every deck-controlled
    //    field. We pass the empty decklist (the structured analysis carries the
    //    deck context per issue #923), matching the prior stub behaviour.
    const systemPrompt = buildCoachSystemPrompt(
      format,
      "",
      body.archetype,
      body.strategy,
      digestedContext ? JSON.stringify(digestedContext) : undefined,
      structuredAnalysis,
    );

    // 5. Defense-in-depth: sanitize each message's content and drop any
    //    client-supplied `system` role. Only the server-built `systemPrompt`
    //    above is allowed to set system instructions.
    const sanitizedMessages: CoachStreamMessage[] = (messages as unknown[])
      .map((raw): CoachStreamMessage | null => {
        if (typeof raw !== "object" || raw === null) return null;
        const m = raw as { role?: unknown; content?: unknown };
        if (m.role !== "user" && m.role !== "assistant") return null;
        const content = sanitizeUserInput(m.content, { maxLength: 20_000 });
        return { role: m.role, content };
      })
      .filter((m): m is CoachStreamMessage => m !== null);

    // 6. Resolve the ordered provider failover chain (issue #1077).
    const providers = getProviderFailoverChain(body.provider);

    // 7. Stream the response as SSE. `request.signal` aborts when the client
    //    cancels its fetch (AbortController) — threading it through stops
    //    server-side generation and prevents further provider attempts.
    const eventStream = streamCoachResponse({
      systemPrompt,
      messages: sanitizedMessages,
      providers,
      modelId: body.modelId,
      signal: request.signal,
    });

    const encoder = new TextEncoder();
    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of eventStream) {
            controller.enqueue(encoder.encode(eventToSse(event)));
          }
          controller.close();
        } catch (error) {
          console.error("Coach streaming error:", error);
          // Best-effort: emit a terminal error event before closing so the
          // client can surface a message instead of seeing a truncated stream.
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
        // Client disconnected (Cancel button). The request.signal has already
        // been aborted, which stops the generator; this hook is informational.
      },
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Hint surface for simple clients/observability; the authoritative
        // provider/usage/failover data travels inside the SSE events.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Conversational Coach API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

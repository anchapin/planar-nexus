import { NextRequest, NextResponse } from "next/server";
import type { DeckCard } from "@/app/actions";
import { prefetchCoachContext } from "@/ai/flows/coach-context-prefetch";
import {
  buildCoachSystemPrompt,
  prepareConversationHistoryWithSummary,
  validateCoachMemorySummary,
} from "@/ai/flows/context-builder";
import {
  emptyCoachMemorySummary,
  isSummaryEmpty,
} from "@/ai/flows/coach-memory-summary";
import {
  streamCoachResponse,
  eventToSse,
  type CoachStreamEvent,
  type CoachStreamMessage,
} from "@/ai/flows/coach-stream";
import {
  buildEvidenceLedger,
  type EvidenceLedger,
} from "@/ai/flows/coach-evidence-ledger";
import { runGroundingGuard } from "@/ai/flows/coach-grounding-guard";
import { normalizeDifficultyLevel } from "@/ai/ai-difficulty";
import { getProviderFailoverChain } from "@/ai/providers/factory";
import { sanitizeUserInput } from "@/ai/prompt-security";
import { classifyCoachIntent } from "@/ai/coach-intent";

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
 *
 * Issue #1238: the sanitized history is pruned against a token budget before
 * being forwarded to the stream layer (`prepareConversationHistory`), so long
 * coaching sessions cannot exceed the model's context window. The system
 * prompt (which carries the structured deck analysis) is reserved against the
 * budget and the latest user turn is always retained intact.
 *
 * Issue #1417: when pruning drops turns, a durable **coach-memory summary**
 * captures goals, constraints, accepted/rejected swaps, matchup targets, and
 * unresolved questions. The summary is computed deterministically from the
 * pruned slice (no LLM call on the request path), validated against a zod
 * schema, injected into the guarded system prompt as trusted
 * system-maintained context, and emitted back to the client as a `summary`
 * SSE event so it can be persisted with the conversation and resent on the
 * next turn. Older conversations (no summary) load and behave as before.
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
    //    re-computation.
    //
    //    Issue #1236: the hook drops the raw deck payload from the wire for
    //    decks > 20 cards (Commander default) and instead ships a digested
    //    context. The worker that produced that digest now pre-computes the
    //    same structured analysis the route would otherwise build, and
    //    surfaces it as `digestedContext.structuredAnalysisText`. Prefer it
    //    when present so large/Commander decks keep full grounding (archetype,
    //    synergy clusters, role mix, gaps) without re-sending 100 cards.
    //    Fall back to the local pre-fetcher only when raw cards are
    //    available — e.g. for the < 20 card small-deck path.
    //
    //    Issue #1419: keep a handle on the structured ANALYSIS OBJECT
    //    (not just the rendered text) when pre-fetching locally — the
    //    evidence ledger is built from the object so it has stable ids and
    //    numeric facts to validate the completed message against.
    let structuredAnalysis: string | undefined =
      typeof digestedContext?.structuredAnalysisText === "string"
        ? digestedContext.structuredAnalysisText
        : undefined;
    let structuredAnalysisObject:
      | NonNullable<
          Awaited<ReturnType<typeof prefetchCoachContext>>
        >["structuredAnalysis"]
      | undefined;

    if (
      !structuredAnalysis &&
      deckCards &&
      Array.isArray(deckCards) &&
      deckCards.length > 0
    ) {
      try {
        const prefetched = await prefetchCoachContext({
          deckCards: deckCards as DeckCard[],
          format,
        });
        if (prefetched) {
          structuredAnalysis = prefetched.structuredAnalysisText;
          structuredAnalysisObject = prefetched.structuredAnalysis;
        }
      } catch (error) {
        console.error("Coach context pre-fetch failed:", error);
      }
    }

    // Issue #1417: the client sends the persisted coach-memory summary for
    // the active conversation (if any) so pruning can merge into it
    // monotonically across the session. Validate defensively — a foreign
    // payload is dropped (treated as absent) rather than crashing the request.
    const inboundSummary = validateCoachMemorySummary(body.memorySummary);

    // 4. Build a GUARDRAILED system prompt (issue #1107). `buildCoachSystemPrompt`
    //    prepends SECURITY_PREAMBLE and sanitizes/wraps every deck-controlled
    //    field. We pass the empty decklist (the structured analysis carries the
    //    deck context per issue #923), matching the prior stub behaviour.
    //
    //    Issue #1387: classify the latest user turn AFTER sanitization and
    //    thread the result into the prompt. Classification is
    //    server-authoritative — any client-supplied `intent` field is ignored
    //    (it never reaches the classifier or the prompt). The intent block and
    //    tier-specific guidance are injected by `buildCoachSystemPrompt`.
    //
    //    Issue #1417: the validated inbound summary is injected as trusted
    //    system-maintained context. If the inbound payload failed validation,
    //    fall back to "no summary" — the next pruning pass will repopulate.
    const sanitizedMessages: CoachStreamMessage[] = (messages as unknown[])
      .map((raw): CoachStreamMessage | null => {
        if (typeof raw !== "object" || raw === null) return null;
        const m = raw as { role?: unknown; content?: unknown };
        if (m.role !== "user" && m.role !== "assistant") return null;
        const content = sanitizeUserInput(m.content, { maxLength: 20_000 });
        return { role: m.role, content };
      })
      .filter((m): m is CoachStreamMessage => m !== null);

    // Classify the most recent *user* message (after sanitization, per the
    // acceptance criteria — injection phrases are already redacted). Falls
    // back to `unknown` when there is no user turn or confidence is low.
    const latestUserMessage = [...sanitizedMessages]
      .reverse()
      .find((m) => m.role === "user");
    const deckCardNames = Array.isArray(deckCards)
      ? (deckCards as Array<{ name?: unknown }>)
          .map((c) => (c && typeof c.name === "string" ? c.name : null))
          .filter((n): n is string => Boolean(n))
      : [];
    const intent =
      latestUserMessage != null
        ? classifyCoachIntent(latestUserMessage.content, {
            format,
            archetype:
              typeof body.archetype === "string" ? body.archetype : undefined,
            deckCardNames,
          })
        : undefined;

    // Issue #1419: build the evidence ledger BEFORE the prompt so it can be
    // injected as grounding context, and re-used by the post-generation
    // guard. The ledger is deterministic and cheap (no LLM call). Source
    // priority: full structured analysis object > digested context > empty.
    const tier = normalizeDifficultyLevel(
      typeof body.difficulty === "string" ? body.difficulty : undefined,
    );
    const evidenceLedger: EvidenceLedger = buildEvidenceLedger({
      analysis: structuredAnalysisObject ?? null,
      digestedContext: digestedContext ?? null,
      userTurn: latestUserMessage?.content,
    });

    // 6. Prune the conversation history against the token budget (issue
    //    #1238). `systemContent` is reserved against the budget so the
    //    structured-analysis / SECURITY_PREAMBLE block is always preserved.
    //    The latest turn is always retained intact; oldest turns are dropped
    //    first until the combined size fits within the configured budget.
    //
    //    Issue #1417: when pruning drops turns, build (or update) the durable
    //    coach-memory summary from the pruned slice. The summary merges with
    //    any inbound prior summary so memory grows monotonically across the
    //    session. The summary is then injected into the system prompt as
    //    trusted system-maintained context. To inject the *current* summary,
    //    we first build the prompt without it, reserve that prompt's size in
    //    the pruning budget, and then re-emit the prompt with the updated
    //    summary inline.
    //
    //    Failure isolation: the wrapper swallows summary-builder errors and
    //    falls back to the prior summary (or empty), so summary generation
    //    failure never blocks the request (issue #1417 acceptance criterion).
    const baseSystemPrompt = buildCoachSystemPrompt(
      format,
      "",
      body.archetype,
      body.strategy,
      digestedContext ? JSON.stringify(digestedContext) : undefined,
      structuredAnalysis,
      intent,
      typeof body.difficulty === "string" ? body.difficulty : undefined,
      evidenceLedger,
      inboundSummary,
    );

    const prepared = prepareConversationHistoryWithSummary(
      sanitizedMessages.map((m) => ({
        id: `${m.role}-${m.content.length}`,
        role: m.role,
        content: m.content,
        timestamp: new Date(),
      })),
      {
        maxMessages: body.maxHistoryMessages,
        maxTokens: body.maxHistoryTokens,
        systemContent: baseSystemPrompt,
        priorSummary: inboundSummary,
      },
    );
    const prunedMessages = prepared.messages;
    const updatedSummary = prepared.summary;

    // Re-emit the system prompt with the (possibly updated) summary inline.
    // If the summary changed, the prompt must reflect the latest view; if
    // nothing changed, this is a cheap no-op rebuild that yields the same
    // text as `baseSystemPrompt`.
    const systemPrompt = isSummaryEmpty(updatedSummary)
      ? baseSystemPrompt
      : buildCoachSystemPrompt(
          format,
          "",
          body.archetype,
          body.strategy,
          digestedContext ? JSON.stringify(digestedContext) : undefined,
          structuredAnalysis,
          intent,
          typeof body.difficulty === "string" ? body.difficulty : undefined,
          evidenceLedger,
          updatedSummary,
        );

    // 7. Resolve the ordered provider failover chain (issue #1077).
    const providers = getProviderFailoverChain(body.provider);

    // 8. Stream the response as SSE. `request.signal` aborts when the client
    //    cancels its fetch (AbortController) — threading it through stops
    //    server-side generation and prevents further provider attempts.
    //
    //    Issue #1417: emit the updated summary as the FIRST stream event so
    //    the client can persist it before the assistant text begins to land.
    //    Always emit it — even when pruning didn't change anything — so the
    //    client's persisted shape is authoritative; an empty summary is
    //    rendered to `{ ...empties, tokenEstimate: 0 }` and the client can
    //    short-circuit persistence when nothing meaningful arrived.
    const eventStream = streamCoachResponse({
      systemPrompt,
      messages: prunedMessages,
      providers,
      modelId: body.modelId,
      signal: request.signal,
    });

    // Pre-flight summary event. Falls back to an empty summary if the pruner
    // somehow returned `null`/`undefined` (defensive — it never does, but the
    // route is responsible for the wire contract).
    const summaryEvent = {
      type: "summary" as const,
      summary: updatedSummary ?? emptyCoachMemorySummary(),
    };

    const encoder = new TextEncoder();

    /**
     * Issue #1419: post-generation grounding guard.
     *
     * The coach streams text token-by-token for progressive rendering. After
     * the final text delta and BEFORE the `done` event, this generator
     * re-emits every event from the underlying stream verbatim, but buffers
     * the text deltas so the completed message can be validated against the
     * evidence ledger. When the guard flags any failure it emits one extra
     * `grounding` event so the client can append the caveat and mark the
     * persisted message `lowConfidence` / `needsReview`.
     *
     * Progressive rendering is preserved end-to-end: the client still sees
     * every `text` event as soon as it arrives. The guard runs ONCE, on the
     * completed message, and its output is a single deterministic event.
     */
    async function* withGroundingGuard(
      upstream: AsyncIterable<CoachStreamEvent>,
    ): AsyncGenerator<CoachStreamEvent> {
      let buffered = "";
      let sawDone = false;
      for await (const event of upstream) {
        if (event.type === "text") {
          buffered += event.value;
        }
        if (event.type === "done") {
          sawDone = true;
          // Run the deterministic guard on the completed message. Cheap, no
          // LLM call. Only emit a `grounding` event when the guard flags
          // failures — fully-grounded messages get no extra event so the
          // happy path stays unchanged.
          try {
            const verdict = runGroundingGuard({
              message: buffered,
              ledger: evidenceLedger,
              difficulty: tier,
            });
            if (verdict.lowConfidence) {
              yield {
                type: "grounding",
                lowConfidence: true,
                needsReview: true,
                caveat: verdict.caveat,
                failures: verdict.failures.map(
                  (f) => `[${f.kind}/${f.ref}] ${f.detail}`,
                ),
              };
            }
          } catch (error) {
            // The guard must never break a successful stream. Log and skip
            // emitting the grounding event — the message goes through as
            // unannotated assistant text, which is the safe fallback.
            console.error("Grounding guard failed:", error);
          }
        }
        yield event;
      }
      // If the upstream ended without `done` (mid-stream failure path) we
      // still want the buffered text guarded — but the failure event was
      // already emitted by the stream, so there's no clean place to inject
      // a caveat. Skip in that case to keep the wire format simple.
      void sawDone;
    }

    const responseStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(eventToSse(summaryEvent)));
          for await (const event of withGroundingGuard(eventStream)) {
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

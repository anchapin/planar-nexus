import { NextRequest, NextResponse } from "next/server";
import type { DeckCard } from "@/lib/card-database";
import { prefetchCoachContext } from "@/ai/flows/coach-context-prefetch";
import {
  buildCoachSystemPrompt,
  prepareConversationHistoryWithSummary,
  validateCoachMemorySummary,
  DEFAULT_CONVERSATION_MAX_MESSAGES,
  DEFAULT_CONVERSATION_TOKEN_BUDGET,
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
import {
  createLocalCardLookup,
  extractCitedCards,
  summarizeVerifications,
  verifyCitations,
} from "@/ai/flows/verify-citations";
import { normalizeDifficultyLevel } from "@/ai/ai-difficulty";
import { getProviderFailoverChain } from "@/ai/providers/factory";
import { sanitizeUserInput } from "@/ai/prompt-security";
import { classifyCoachIntent } from "@/ai/coach-intent";
import {
  enforceRateLimit,
  RateLimitError,
  type RateLimitConfig,
} from "@/lib/server-rate-limiter";
import { getClientIdentifier } from "@/lib/server-request-identity";
import {
  HTTP_STATUS_BY_CLASS,
  newCorrelationId,
  redactErrorMessage,
  toSafeClientError,
} from "@/lib/security/redact-error";

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
 *
 * Issue #1781: request-level hardening, in parity with /api/chat (#1534):
 *   - Every request is rate-limited on the shared server-verified identity
 *     (`getClientIdentifier` + `enforceRateLimit` with `COACH_RATE_LIMIT`);
 *     a limited client receives 429 with `Retry-After` BEFORE any provider
 *     call or context pre-fetch, so the operator's provider budget cannot
 *     be burned by unlimited turns.
 *   - The inbound `messages` array is capped at MAX_INBOUND_MESSAGES;
 *     larger histories are rejected up-front with a 400.
 *   - The client-tunable pruning knobs (`maxHistoryMessages` /
 *     `maxHistoryTokens`) are clamped to server-side maxima, so a single
 *     request cannot disable pruning and make its per-request token cost
 *     attacker-controlled.
 */

export const dynamic = "force-dynamic";

/**
 * Per-client rate limit for the coach chat endpoint (issue #1781 — parity
 * with `/api/chat`'s `CHAT_RATE_LIMIT` from issue #1534). Exported for test
 * parity checks.
 */
export const COACH_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 30,
  message: "Coach chat rate limit exceeded. Please try again shortly.",
};

/**
 * Hard cap on the inbound `messages` array (issue #1781). Each message's
 * content is clamped to 20k chars, but the COUNT was previously unbounded —
 * reject oversized histories before any sanitization or provider work.
 */
const MAX_INBOUND_MESSAGES = 200;

/**
 * Server-side maxima for the client-tunable history pruning knobs
 * (issue #1781). Values above these are clamped down; the pipeline defaults
 * (from the shared context builder) are the ceiling, not a suggestion.
 */
const MAX_HISTORY_MESSAGES = DEFAULT_CONVERSATION_MAX_MESSAGES;
const MAX_HISTORY_TOKENS = DEFAULT_CONVERSATION_TOKEN_BUDGET;

/**
 * Clamp a client-supplied history knob to a positive integer bounded by the
 * server-side maximum. Non-numeric, non-finite, or non-positive values fall
 * back to `undefined` so the pipeline default applies (pre-existing
 * behaviour for absent/invalid fields is preserved).
 */
function clampHistoryKnob(value: unknown, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.min(Math.floor(value), max);
}

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

    // Issue #1781: reject oversized histories up-front. Each message's
    // content is later clamped to 20k chars, but the COUNT must also be
    // bounded — a single request can no longer carry an arbitrarily large
    // array into sanitization and the pruning pipeline.
    if (messages.length > MAX_INBOUND_MESSAGES) {
      return NextResponse.json(
        {
          success: false,
          error: `Too many messages: ${messages.length} exceeds the maximum of ${MAX_INBOUND_MESSAGES}`,
        },
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

    // 2.5 Rate limit on the SERVER-VERIFIED client identity (issue #1781,
    //     parity with /api/chat issue #1534). The bucket key is derived
    //     solely from request metadata and never from the body, so a client
    //     cannot rotate or influence its own bucket. The 429 is returned
    //     BEFORE any provider call — and before the context pre-fetch — so
    //     a limited client cannot burn compute or the operator's provider
    //     budget.
    const clientIdentifier = getClientIdentifier(request);
    try {
      // Issue #1782: `enforceRateLimit` is async (shared KV backend possible);
      // awaiting here ensures the 429 path runs BEFORE any provider work
      // (#1781 contract).
      await enforceRateLimit(clientIdentifier, COACH_RATE_LIMIT);
    } catch (error) {
      if (error instanceof RateLimitError) {
        return NextResponse.json(
          {
            success: false,
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

    // Issue #1781: the pruning knobs are server-clamped. A huge
    // `maxHistoryTokens` can no longer disable pruning, and `maxHistoryMessages`
    // cannot exceed the pipeline's own default ceiling; legit smaller values
    // pass through unchanged and absent/invalid values keep the defaults.
    const maxHistoryMessages = clampHistoryKnob(
      body.maxHistoryMessages,
      MAX_HISTORY_MESSAGES,
    );
    const maxHistoryTokens = clampHistoryKnob(
      body.maxHistoryTokens,
      MAX_HISTORY_TOKENS,
    );

    const prepared = prepareConversationHistoryWithSummary(
      sanitizedMessages.map((m) => ({
        id: `${m.role}-${m.content.length}`,
        role: m.role,
        content: m.content,
        timestamp: new Date(),
      })),
      {
        maxMessages: maxHistoryMessages,
        maxTokens: maxHistoryTokens,
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
     *
     * Issue #1535: local card-citation verifier (`verify-citations.ts`).
     *
     * Runs in PARALLEL with the grounding guard via `Promise.all` so the
     * completed-message verification wall-clock time stays at one
     * `max(guard, verifier)` rather than `guard + verifier`. The verifier
     * resolves every cited card name against the user's local card database
     * (no network) and produces one optional `citations` event carrying a
     * per-message summary (`total` / `verified` / `mismatched` / `notFound`
     * / `unverifiable`) AND the full per-citation entries so the client can
     * render the same `"7/8 cited cards verified"` indicator the heuristic
     * deck-review flow already exposes. Like `grounding`, the `citations`
     * event only fires when there is at least one citation to report — a
     * coach turn that never names a card carries no extra event on the wire.
     */
    async function* withGroundingGuard(
      upstream: AsyncIterable<CoachStreamEvent>,
    ): AsyncGenerator<CoachStreamEvent> {
      let buffered = "";
      let sawDone = false;
      // Issue #1535: a single resolver instance per request so the cached
      // database-population probe runs once even if the verifier is
      // invoked again (e.g. because grounding triggered a re-run after a
      // recovery). The lookup is defensive: any IndexedDB failure collapses
      // to `{ found: false, dbHasCards: false }`, degrading all
      // citations to `unverifiable` — the message still goes through.
      const citationLookup = createLocalCardLookup();
      for await (const event of upstream) {
        if (event.type === "text") {
          buffered += event.value;
        }
        if (event.type === "done") {
          sawDone = true;
          // Run BOTH checks in parallel on the completed message. The
          // grounding guard is synchronous so we wrap it in a resolved
          // promise; the verifier is a Promise.all of an extraction pass
          // and a per-card lookup. Both pass through the same error fence
          // — a failure in either MUST NOT break the stream.
          try {
            const [verdict, citations] = await Promise.all([
              Promise.resolve(
                runGroundingGuard({
                  message: buffered,
                  ledger: evidenceLedger,
                  difficulty: tier,
                }),
              ),
              (async () => {
                const cited = extractCitedCards(buffered);
                if (cited.length === 0) return null;
                const verifications = await verifyCitations(
                  cited,
                  citationLookup,
                );
                return {
                  summary: summarizeVerifications(verifications),
                  entries: verifications,
                };
              })(),
            ]);

            // Grounding event: only emitted when the guard flagged failures,
            // preserving the happy path (a fully-grounded message carries no
            // extra event).
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

            // Citations event (#1535): only emitted when the verifier saw at
            // least one cited card in the buffered message. Carries both the
            // headline summary (used by the client's "N/M verified"
            // indicator) and the per-citation entries (used for per-card
            // drill-downs). Even when the local DB is empty every entry is
            // reported as `unverifiable` and the event still fires so the
            // UI can distinguish "no citations" from "unverifiable".
            if (citations) {
              yield {
                type: "citations",
                summary: citations.summary,
                entries: citations.entries,
              };
            }
          } catch (error) {
            // The verifier + grounding run must never break a successful
            // stream. Log and emit neither extra event — the message goes
            // through as unannotated assistant text, which is the safe
            // fallback.
            //
            // Issue #1794: provider SDK errors can embed key material /
            // request URLs / prompt fragments. Redact before logging so the
            // verification-failure path doesn't become a leak.
            console.error(
              "Post-generation verification failed:",
              redactErrorMessage(error),
            );
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
          // Issue #1794: provider SDK errors can embed key material / full
          // request URLs / request-body fragments. Match the /api/ai-proxy
          // (#1585) pattern: log a redacted summary tied to a correlation id
          // and emit only the redacted summary + correlation id on the SSE
          // channel. The raw `error.message` never reaches the client.
          const correlationId = newCorrelationId();
          const safe = toSafeClientError(error);
          console.error(
            `Coach streaming error [${safe.errorClass}] [corr ${correlationId}]:`,
            redactErrorMessage(error),
          );
          // Best-effort: emit a terminal error event before closing so the
          // client can surface a message instead of seeing a truncated stream.
          try {
            controller.enqueue(
              encoder.encode(
                eventToSse({
                  type: "error",
                  value: safe.error,
                  // Carry the correlation id so operators can match a
                  // client-reported error to the redacted server log line.
                  correlationId,
                  errorCode: safe.errorCode,
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
    // Issue #1794: provider SDK errors can embed key material / full
    // request URLs / request-body fragments. Match the /api/ai-proxy (#1585)
    // pattern: log a redacted summary tied to a correlation id and respond
    // with a generic message + stable errorCode + correlation id. The raw
    // `error.message` never reaches the client.
    const correlationId = newCorrelationId();
    const safe = toSafeClientError(error);
    console.error(
      `Conversational Coach API error [${safe.errorClass}] [corr ${correlationId}]:`,
      redactErrorMessage(error),
    );
    return NextResponse.json(
      {
        success: false,
        error: safe.error,
        errorCode: safe.errorCode,
        correlationId,
      },
      { status: HTTP_STATUS_BY_CLASS[safe.errorClass] },
    );
  }
}

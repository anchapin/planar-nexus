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
import {
  providerHealth,
  type ProviderFailureReason,
  type ProviderHealthTracker,
} from "@/ai/providers/provider-health";
import type {
  CitationSummary,
  CitationVerification,
} from "@/ai/flows/verify-citations";

/** A single message in the coach conversation. */
export interface CoachStreamMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Normalized token-usage payload surfaced per coach message.
 *
 * `maxOutputTokens` carries the server-applied output-token cap that was
 * forwarded to the provider for this turn (issue #1536). A value of `0` means
 * "no server-applied cap" (the provider/model default was used). When the cap
 * was applied AND the model hit the bound mid-generation, `completionTokens`
 * will be ≤ `maxOutputTokens` and the provider's `finishReason` will be
 * `"length"` (per provider docs).
 */
export interface CoachTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * The output-token cap forwarded to the provider for this turn.
   * `0` means the provider default was used (no server cap applied).
   */
  maxOutputTokens: number;
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
 * Issue #1418: the `failover` variant gains an optional `cooldownReason`
 * field, populated only when `reason === "cooldown"`. It carries the bounded
 * underlying failure class (`rate-limit | timeout | model-setup |
 * stream-before-first-token`) so observers can see *why* a provider was
 * skipped without leaking the raw upstream error.
 *
 * Issue #1419 adds the `grounding` event: emitted ONCE, after the final text
 * delta and before `done`, when the post-generation guard flags the
 * completed message. The client appends the caveat to the assistant message
 * and sets `lowConfidence` / `needsReview` on the persisted record.
 *
 * Issue #1535 adds the `citations` event: emitted at most ONCE, after the
 * grounding event (and before `done`), when the local card-citation verifier
 * ran on the completed message. Carries a per-message summary
 * (`total` / `verified` / `mismatched` / `notFound` / `unverifiable`) AND the
 * full per-citation entries so the client can render both the headline
 * `"7/8 cited cards verified"` indicator and per-card detail for any
 * flagged / corrected entries.
 *
 * Like `grounding`, `citations` is OPTIONAL — the route only emits it when
 * the verifier saw at least one cited card in the buffered message (so a
 * coach turn that never mentions a card carries no extra event on the wire).
 */
export type CoachStreamEvent =
  | { type: "provider"; value: string }
  | {
      type: "failover";
      from: string;
      to: string;
      reason: string;
      cooldownReason?: ProviderFailureReason;
    }
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
      /**
       * Issue #1535: local card-citation verifier summary. Carries the
       * aggregate counts (`summary`) the client uses for the headline
       * indicator AND the per-citation entries so a UI can drill into the
       * specific card(s) that failed verification. Emitted at most once per
       * coach turn, after `grounding` (when grounded fires) and before
       * `done`.
       */
      type: "citations";
      summary: CitationSummary;
      entries: CitationVerification[];
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
  /**
   * Server-authoritative output-token cap forwarded to `streamText` (issue
   * #1534 + #1536). When omitted, the orchestrator resolves a fallback from
   * the `COACH_MAX_OUTPUT_TOKENS` env var (or the project default of 1024
   * when the env var is unset / invalid), so a runaway provider cannot
   * consume unbounded tokens against the user's API key. The resolved value
   * is surfaced on the `usage` SSE event so the client can render the bound.
   */
  maxOutputTokens?: number;
  /** Abort signal; aborting cancels generation and stops failover. */
  signal?: AbortSignal;
  /**
   * Text streamed to the user when every provider is exhausted (e.g. none
   * configured). Keeps the coach usable. Defaults to the standard
   * "unavailable" notice.
   */
  fallbackText?: string;
  /** Test seam: override provider resolution. Defaults to the real factory.
   * Injecting it keeps {@link streamCoachResponse} unit-testable without
   * network access or `jest.mock`.
   */
  getModel?: typeof getAIModel;
  /** Test seam: override credential detection. */
  isConfigured?: typeof isProviderConfigured;
  /**
   * Test seam: provider health tracker used for cooldown backoff (issue
   * #1418). Defaults to the process-wide singleton. Injecting a fresh
   * instance keeps cooldown state hermetic per test file.
   */
  healthTracker?: ProviderHealthTracker;
}

/** Default fallback streamed when no provider can answer. */
export const DEFAULT_FALLBACK_TEXT =
  "The AI conversational coach is currently unavailable. No LLM provider is configured. " +
  "Please use the heuristic deck coach for deck analysis instead.";

/**
 * Default output-token cap for coach turns when no override is supplied and
 * `COACH_MAX_OUTPUT_TOKENS` is unset / invalid (issue #1536). Chosen to bound
 * runaway responses against the user's API key without truncating typical
 * conversational coach replies; the value can be tightened or loosened via
 * the env var, or per-call via {@link StreamCoachResponseOptions.maxOutputTokens}.
 */
export const DEFAULT_COACH_MAX_OUTPUT_TOKENS = 1024;

/**
 * Env var controlling the per-turn output-token cap forwarded to the coach
 * provider (issue #1536). May be overridden per-call via the
 * {@link StreamCoachResponseOptions.maxOutputTokens} option.
 */
export const COACH_MAX_OUTPUT_TOKENS_ENV = "COACH_MAX_OUTPUT_TOKENS";

/**
 * Parse a positive integer from an env-style string. Returns `undefined` for
 * empty / non-numeric / non-positive input so the caller can fall back
 * cleanly to its next priority level.
 */
function parsePositiveInt(raw: unknown): number | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Resolve the effective output-token cap for a coach turn.
 *
 * Priority order (issue #1536 acceptance criteria):
 *   1. Explicit positive-integer `override` (e.g. injected by a test or by
 *      another caller's `StreamCoachResponseOptions.maxOutputTokens`).
 *   2. `process.env.COACH_MAX_OUTPUT_TOKENS` (must be a positive integer).
 *   3. {@link DEFAULT_COACH_MAX_OUTPUT_TOKENS} (1024).
 *
 * Non-positive, non-finite, or non-integer overrides fall through (a `0.5`
 * override truncates to 0, which is below the `> 0` floor and is treated as
 * "no override"). Read at call time so tests can mutate `process.env`
 * between runs without needing to reload the module.
 *
 * Exported (named) so tests can assert resolution independently of the
 * provider call.
 */
export function resolveCoachMaxOutputTokens(override?: number): number {
  if (
    typeof override === "number" &&
    Number.isFinite(override) &&
    override > 0 &&
    Number.isInteger(override)
  ) {
    return override;
  }
  const fromEnv = parsePositiveInt(process.env[COACH_MAX_OUTPUT_TOKENS_ENV]);
  if (fromEnv !== undefined) return fromEnv;
  return DEFAULT_COACH_MAX_OUTPUT_TOKENS;
}

/**
 * Reduce a Vercel AI SDK usage object (whose field names changed across SDK
 * majors — `promptTokens`/`completionTokens` vs `inputTokens`/`outputTokens`)
 * into the normalized {@link CoachTokenUsage} shape. Best-effort: any
 * non-numeric value is treated as 0.
 *
 * `appliedMaxOutputTokens` is the cap forwarded to the provider for this
 * turn (issue #1536). It is forwarded into the `usage` payload so the client
 * can render the bound. A value of `0` means no server-applied cap.
 */
function normalizeUsage(
  raw: unknown,
  appliedMaxOutputTokens: number,
): CoachTokenUsage {
  const n = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v)
      ? Math.max(0, Math.floor(v))
      : 0;
  if (typeof raw !== "object" || raw === null) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      maxOutputTokens: appliedMaxOutputTokens,
    };
  }
  const r = raw as Record<string, unknown>;
  const promptTokens = n(r.inputTokens ?? r.promptTokens);
  const completionTokens = n(r.outputTokens ?? r.completionTokens);
  const totalTokens = n(r.totalTokens) || promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    maxOutputTokens: appliedMaxOutputTokens,
  };
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
 * Map an upstream error thrown before any token was streamed to a bounded
 * {@link ProviderFailureReason} for the health tracker (issue #1418). The
 * classification is intentionally coarse and regex-based — we only need it
 * to pick a cooldown schedule, not to surface the error to the user. Abort
 * errors never reach here: the caller checks `signal?.aborted` first.
 */
function classifyStreamFailure(error: unknown): ProviderFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/rate.?limit|429|too many requests/i.test(message)) {
    return "rate-limit";
  }
  if (/timeout|timed?\s*out/i.test(message)) {
    return "timeout";
  }
  return "stream-before-first-token";
}

/**
 * Stream a coach response with transparent provider failover and cancellation.
 *
 * Failure policy (issue #1077 + #1418):
 *   - Provider is currently in cooldown (recent transient failure recorded by
 *     the health tracker) → skipped, a `failover` event with `reason:
 *     "cooldown"` is emitted, the next healthy provider is tried (#1418).
 *   - Provider fails BEFORE any token is delivered → record the bounded
 *     failure reason, fail over to the next provider (a `failover` event is
 *     emitted first).
 *   - Provider fails AFTER tokens were delivered → end the stream gracefully
 *     (`error` + `done`); we do not attempt to resume a partial response and
 *     we do NOT record a health failure (the provider started fine).
 *   - Abort signal fires → stop immediately, no further providers are tried,
 *     and no health failure is recorded (the abort is not the provider's
 *     fault).
 *   - All providers exhausted → stream `fallbackText` so the user always gets
 *     a response.
 *
 * Health state lives in the {@link ProviderHealthTracker} singleton and is
 * shared across coach turns so a transiently failing provider is not retried
 * on every new request (#1418).
 */
export async function* streamCoachResponse(
  options: StreamCoachResponseOptions,
): AsyncGenerator<CoachStreamEvent> {
  const {
    systemPrompt,
    messages,
    modelId,
    maxOutputTokens,
    signal,
    fallbackText = DEFAULT_FALLBACK_TEXT,
    getModel = getAIModel,
    isConfigured = isProviderConfigured,
    healthTracker = providerHealth,
  } = options;

  const chain =
    options.providers && options.providers.length > 0
      ? [...options.providers]
      : getProviderFailoverChain();

  // Issue #1536: resolve the effective output-token cap once per request. The
  // resolved value is forwarded to `streamText` so the provider truncates
  // mid-generation on bound (rather than emitting unbounded tokens), and is
  // surfaced on the `usage` SSE event so the client can render the bound.
  const effectiveMaxOutputTokens = resolveCoachMaxOutputTokens(maxOutputTokens);

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

    // Issue #1418: skip providers currently in cooldown. The health tracker
    // records transient failures (rate-limit / timeout / model-setup /
    // stream-before-first-token) with short exponential backoffs so a
    // provider that just failed is not retried on every new coach turn. The
    // structured `cooldown` failover event exposes the bounded underlying
    // reason via `cooldownReason` without leaking the raw upstream error.
    if (!healthTracker.isHealthy(provider)) {
      const snapshot = healthTracker.snapshot(provider);
      lastReason = "cooldown";
      const next = chain[index + 1];
      if (next) {
        yield {
          type: "failover",
          from: provider,
          to: next,
          reason: "cooldown",
          cooldownReason: snapshot?.lastFailureReason,
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
      // Model setup failed — record it so the next coach turn skips this
      // provider until the cooldown elapses (#1418).
      healthTracker.recordFailure(provider, "model-setup");
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
      maxOutputTokens: effectiveMaxOutputTokens,
      abortSignal: signal,
    });

    let streamedAny = false;
    try {
      for await (const delta of result.textStream) {
        if (signal?.aborted) {
          // User cancelled mid-generation — stop without failing over and
          // without recording a health failure (cancellation is not the
          // provider's fault).
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
        // response. End gracefully (documented policy). Do NOT record a
        // health failure — the provider did start streaming, so the next
        // coach turn should still try it (#1418 only tracks pre-token
        // transient failures).
        yield { type: "error", value: friendlyError(error) };
        yield { type: "done" };
        return;
      }
      // Failed before any token was delivered → classify the bounded reason
      // and record it for cooldown backoff, then try the next provider.
      const failureReason = classifyStreamFailure(error);
      healthTracker.recordFailure(provider, failureReason);
      lastReason =
        failureReason === "rate-limit"
          ? "rate-limited"
          : failureReason === "timeout"
            ? "timeout"
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

    // Stream completed normally → clear any prior cooldown for this provider
    // (#1418: "Successful completion clears the provider/model cooldown
    // entry"). Best-effort: never let usage surfacing fail the turn.
    healthTracker.recordSuccess(provider);

    try {
      // Issue #1536: include the applied cap in the `usage` payload so the
      // client can render the bound. A zero completion count still includes
      // the cap, preserving the "the truncation is normal, not a failure"
      // contract from the acceptance criteria.
      const usage = normalizeUsage(
        await Promise.resolve(result.totalUsage),
        effectiveMaxOutputTokens,
      );
      // Emit when the provider tracked any tokens. The `usage: null` branch
      // (no provider-side counters) still suppresses the event — preserves
      // the pre-#1536 "silent usage" semantics for stub / pre-counter
      // providers.
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

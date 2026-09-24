import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/security/same-origin";
import { requireApiSession } from "@/lib/api-session";
import { streamText, generateText, type ModelMessage } from "ai";
import { getAIModel, isModelAllowed } from "@/ai/providers/factory";
import { AIProvider, AI_PROVIDER_IDS } from "@/ai/providers/types";
import { searchCardsTool } from "@/ai/tools/card-search";
import {
  getProviderConfig,
  getConfiguredProviders,
} from "@/lib/server-api-key-storage";
// Issue #2084: proactive provider health check with fast-fail
import { pingProvider } from "@/ai/providers/provider-health";
import {
  enforceRateLimit,
  RateLimitError,
  getRateLimitHeaders,
} from "@/lib/server-rate-limiter";
import { UsageLogger } from "@/lib/server-usage-logger";
import { getClientIdentifier } from "@/lib/server-request-identity";
import {
  HTTP_STATUS_BY_CLASS,
  newCorrelationId,
  redactErrorMessage,
  toSafeClientError,
} from "@/lib/security/redact-error";
import { z } from "zod";
import { containsInjectionAttempt } from "@/ai/prompt-security";

/**
 * AI Proxy API Route
 * Refactored in Phase 6 to use Vercel AI SDK for unified streaming.
 */

// Use force-dynamic to prevent response buffering
export const dynamic = "force-dynamic";

/**
 * Request body for AI proxy
 */

// Issue #2108: Zod schema replaces manual type casts on providerBody fields
const AIProxyRequestBodySchema = z.object({
  messages: z.array(z.unknown()).default([]),
  stream: z.boolean().default(false),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
});

const AIProxyRequestSchema = z.object({
  provider: z.string().optional(),
  endpoint: z.string(),
  model: z.string().optional(),
  body: AIProxyRequestBodySchema,
  userId: z.string().optional(),
});

const AIMessageContentSchema = z.object({
  role: z.enum(["user", "assistant", "system", "tool"]),
  content: z.string(),
});

/**
 * Response from AI proxy
 */
interface AIProxyResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  rateLimit?: {
    remaining: number;
    resetAt: number;
  };
}

/**
 * GET /api/ai-proxy - Get proxy status and configuration
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    // Get configured providers
    const configuredProviders = getConfiguredProviders();

    if (action === "status") {
      return NextResponse.json({
        success: true,
        serverProxyEnabled: true,
        configuredProviders,
        availableProviders: [...AI_PROVIDER_IDS],
      });
    }

    // Default: return basic status
    return NextResponse.json({
      success: true,
      message: "AI Proxy is running (Vercel AI SDK enabled)",
      configuredProviders,
    });
  } catch (error) {
    // Issue #1585: never echo raw error details (key material, URLs,
    // request bodies) into logs or the client response.
    const correlationId = newCorrelationId();
    const safe = toSafeClientError(error);
    console.error(
      `AI Proxy GET error [${safe.errorClass}] [corr ${correlationId}]:`,
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

/**
 * POST /api/ai-proxy - Proxy AI provider requests using Vercel AI SDK
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse | Response> {
  const authResult = await requireApiSession(request);
  if (authResult instanceof NextResponse) return authResult;

  // Issue #1585: the validated provider name (allowlist-checked) is kept
  // for the safe error summary in the catch block below.
  let validatedProvider: AIProvider | undefined;
  try {
    assertSameOrigin(request);
    // Parse request body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON body",
          errorCode: "INVALID_JSON",
        },
        { status: 400 },
      );
    }

    const parseResult = AIProxyRequestSchema.safeParse(rawBody);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid request body: ${parseResult.error.issues.map((i) => i.message).join("; ")}`,
          errorCode: "INVALID_JSON",
        },
        { status: 400 },
      );
    }
    const body = parseResult.data;

    // Issue #1393: derive identity server-side ONLY. A client-supplied userId
    // must never seed the rate-limit key (rotating it bypasses the limit) nor
    // usage attribution. This app has no auth layer yet, so the honest value
    // is 'anonymous'; the rate-limit key uses a verified IP / UA fingerprint
    // computed by getClientIdentifier() from request metadata, never the body.
    const { provider, model: modelId, body: providerBody } = body;
    const currentUserId = "anonymous";

    // Validate provider
    if (
      !provider ||
      !(AI_PROVIDER_IDS as readonly string[]).includes(provider)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid or missing provider",
          errorCode: "INVALID_PROVIDER",
        },
        { status: 400 },
      );
    }
    validatedProvider = provider as AIProvider;

    // Issue #1985 — reject unknown model IDs server-side
    if (modelId && !isModelAllowed(provider, modelId)) {
      return NextResponse.json(
        {
          success: false,
          error: `Model "${modelId}" is not allowed for provider "${provider}"`,
          errorCode: "INVALID_MODEL",
        },
        { status: 400 },
      );
    }

    // Initialize logger with correct provider
    const usageLogger = new UsageLogger(
      currentUserId,
      provider as AIProvider,
      body.endpoint,
    );
    usageLogger.setModel(modelId || "unknown");

    // Check if provider is configured on server
    let providerConfig;
    try {
      providerConfig = getProviderConfig(provider as AIProvider);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: `Provider ${provider} is not configured`,
          errorCode: "PROVIDER_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }
    if (!providerConfig || !providerConfig.enabled) {
      await usageLogger
        .markFailure(
          "Provider not configured on server",
          "PROVIDER_NOT_CONFIGURED",
        )
        .save();
      return NextResponse.json(
        {
          success: false,
          error: `Provider ${provider} is not configured`,
          errorCode: "PROVIDER_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }

    // Get client identifier for rate limiting — derived solely from
    // server-verified request metadata (Issue #1393).
    const clientId = getClientIdentifier(request);

    // Check rate limit (issue #1782: `enforceRateLimit` is async because the
    // backing store may be a shared KV — `await` so the throw surfaces inside
    // the try/catch as a `RateLimitError` rejection, not an unhandled one).
    let rateLimitResult;
    try {
      rateLimitResult = await enforceRateLimit(
        clientId,
        providerConfig.rateLimit,
      );
    } catch (error) {
      if (error instanceof RateLimitError) {
        await usageLogger
          .markFailure("Rate limit exceeded", "RATE_LIMIT_EXCEEDED")
          .save();
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            errorCode: "RATE_LIMIT_EXCEEDED",
            retryAfter: error.retryAfter,
          },
          {
            status: 429,
            headers: getRateLimitHeaders(
              {
                success: false,
                remaining: 0,
                resetAt: Date.now() + error.retryAfter * 1000,
                retryAfter: error.retryAfter,
              },
              providerConfig.rateLimit,
            ),
          },
        );
      }
      throw error;
    }

    // Issue #2084: proactive health check with 5-second timeout.
    // If the provider is unhealthy (network error, 401/403/429, etc.),
    // fail fast instead of waiting for the full AI call timeout.
    const pingResult = await pingProvider(provider);
    if (!pingResult.healthy) {
      await usageLogger
        .markFailure(
          `Provider unhealthy: ${pingResult.error}`,
          "PROVIDER_UNHEALTHY",
        )
        .save();
      return NextResponse.json(
        {
          success: false,
          error: `Provider ${provider} is currently unavailable: ${pingResult.error}`,
          errorCode: "PROVIDER_UNHEALTHY",
        },
        { status: 503 },
      );
    }

    // Check for streaming request
    const isStreaming = providerBody?.stream === true;

    // Get the model instance from our factory (async — dynamic SDK imports, Issue #1022)
    const model = await getAIModel(provider, modelId);

    // Extract messages (standard for most chat completions)
    // Zod validates structure at parse time; the cast through `unknown` tells
    // TypeScript that the validated array conforms to the AI SDK's ModelMessage shape.
    const messages = providerBody.messages as unknown as ModelMessage[];

    // Validate message structure and check for prompt injection in user/assistant messages
    for (const msg of messages) {
      const parsed = AIMessageContentSchema.safeParse(msg);
      if (!parsed.success) {
        return new Response(
          JSON.stringify({ error: "Invalid message structure" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      if (
        (parsed.data.role === "user" || parsed.data.role === "assistant") &&
        containsInjectionAttempt(parsed.data.content)
      ) {
        return new Response(
          JSON.stringify({ error: "Message content rejected due to injection pattern" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    if (isStreaming) {
      const result = streamText({
        model,
        messages,
        tools: {
          searchCards: searchCardsTool,
        },
        temperature: providerBody.temperature ?? 0.7,
        maxOutputTokens: providerBody.max_tokens ?? providerBody.maxTokens,
        onFinish: async (finishResult) => {
          // Log usage on completion - usage is now a Promise in AI SDK v6
          const usage = await finishResult.usage;
          usageLogger.setTokenUsage(
            usage.inputTokens ?? 0,
            usage.outputTokens ?? 0,
          );
          await usageLogger.markSuccess().save();
        },
      });

      // AI SDK v6: Use toTextStreamResponse instead of toDataStreamResponse
      return result.toTextStreamResponse();
    } else {
      // Non-streaming request
      const result = await generateText({
        model,
        messages,
        tools: {
          searchCards: searchCardsTool,
        },
        temperature: providerBody.temperature ?? 0.7,
        maxOutputTokens: providerBody.max_tokens ?? providerBody.maxTokens,
      });

      // AI SDK v6: usage is now a Promise with inputTokens/outputTokens
      const usage = await result.usage;
      const totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      usageLogger.setTokenUsage(
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
      );
      await usageLogger.markSuccess().save();

      // Return in a format compatible with what extractContentFromResponse expects
      // We wrap it to look like an OpenAI-style response for legacy compatibility
      const legacyData = {
        choices: [
          {
            message: {
              role: "assistant",
              content: result.text,
            },
            finish_reason: result.finishReason,
          },
        ],
        usage: {
          prompt_tokens: usage.inputTokens,
          completion_tokens: usage.outputTokens,
          total_tokens: totalTokens,
        },
      };

      return NextResponse.json(
        {
          success: true,
          data: legacyData,
          usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            totalTokens: totalTokens,
          },
          rateLimit: {
            remaining: rateLimitResult.remaining,
            resetAt: rateLimitResult.resetAt,
          },
        },
        {
          headers: getRateLimitHeaders(
            rateLimitResult,
            providerConfig.rateLimit,
          ),
        },
      );
    }
  } catch (error) {
    // Issue #1585: provider SDK errors routinely embed key material, full
    // request URLs, and request-body/prompt fragments. Never log or return
    // them raw — log a redacted summary (tied to a correlation id the
    // client also receives) and respond with a generic message plus a
    // stable errorCode from the enumerated set (AUTH / PROVIDER /
    // NETWORK / INTERNAL).
    const correlationId = newCorrelationId();
    const safe = toSafeClientError(error);
    console.error(
      `AI Proxy POST error [${safe.errorClass}] [corr ${correlationId}]:`,
      redactErrorMessage(error),
    );
    return NextResponse.json(
      {
        success: false,
        error: safe.error,
        errorCode: safe.errorCode,
        ...(validatedProvider ? { provider: validatedProvider } : {}),
        correlationId,
      },
      { status: HTTP_STATUS_BY_CLASS[safe.errorClass] },
    );
  }
}

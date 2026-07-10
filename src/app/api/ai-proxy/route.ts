import { NextRequest, NextResponse } from "next/server";
import { streamText, generateText } from "ai";
import { getAIModel } from "@/ai/providers/factory";
import { AIProvider } from "@/ai/providers/types";
import { searchCardsTool } from "@/ai/tools/card-search";
import {
  getProviderConfig,
  getConfiguredProviders,
} from "@/lib/server-api-key-storage";
import {
  enforceRateLimit,
  RateLimitError,
  getRateLimitHeaders,
} from "@/lib/server-rate-limiter";
import { UsageLogger } from "@/lib/server-usage-logger";

/**
 * AI Proxy API Route
 * Refactored in Phase 6 to use Vercel AI SDK for unified streaming.
 */

// Use force-dynamic to prevent response buffering
export const dynamic = "force-dynamic";

/**
 * Request body for AI proxy
 */
interface AIProxyRequest {
  provider: AIProvider;
  endpoint: string;
  model?: string;
  body: Record<string, unknown>;
  userId?: string;
}

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
        availableProviders: ["google", "openai", "anthropic", "zaic", "custom"],
      });
    }

    // Default: return basic status
    return NextResponse.json({
      success: true,
      message: "AI Proxy is running (Vercel AI SDK enabled)",
      configuredProviders,
    });
  } catch (error) {
    console.error("AI Proxy GET error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

/**
 * POST /api/ai-proxy - Proxy AI provider requests using Vercel AI SDK
 */
export async function POST(
  request: NextRequest,
): Promise<NextResponse | Response> {
  try {
    // Parse request body
    let body: AIProxyRequest;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid JSON body",
          errorCode: "INVALID_JSON",
        },
        { status: 400 },
      );
    }

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
      !["google", "openai", "anthropic", "zaic", "custom"].includes(provider)
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

    // Initialize logger with correct provider
    const usageLogger = new UsageLogger(
      currentUserId,
      provider as AIProvider,
      body.endpoint,
    );
    usageLogger.setModel(modelId || "unknown");

    // Check if provider is configured on server
    const providerConfig = getProviderConfig(provider as AIProvider);
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

    // Check rate limit
    let rateLimitResult;
    try {
      rateLimitResult = enforceRateLimit(clientId, providerConfig.rateLimit);
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

    // Check for streaming request
    const isStreaming = providerBody?.stream === true;

    // Get the model instance from our factory (async — dynamic SDK imports, Issue #1022)
    const model = await getAIModel(provider, modelId);

    // Extract messages (standard for most chat completions)
    const messages = (providerBody.messages as any[]) || [];

    if (isStreaming) {
      const result = streamText({
        model,
        messages,
        tools: {
          searchCards: searchCardsTool,
        },
        temperature: (providerBody.temperature as number) ?? 0.7,
        maxOutputTokens:
          (providerBody.max_tokens as number) ||
          (providerBody.maxTokens as number),
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
        temperature: (providerBody.temperature as number) ?? 0.7,
        maxOutputTokens:
          (providerBody.max_tokens as number) ||
          (providerBody.maxTokens as number),
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
    console.error("AI Proxy POST error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
        errorCode: "INTERNAL_ERROR",
      },
      { status: 500 },
    );
  }
}

/**
 * Derive a stable, *server-verified* rate-limit key for the request.
 *
 * Issue #1393: the previous implementation trusted a client-supplied `userId`
 * and the raw `x-forwarded-for` header, both of which an attacker can rotate
 * per request to dodge the per-user / per-IP rate limit. This version only
 * honours identifiers the server can verify:
 *
 *   1. `request.ip` — set by the Next.js runtime / Vercel from the actual TCP
 *      peer; not client-spoofable.
 *   2. Forwarded headers, *only* when the operator has set `TRUSTED_PROXY=true`
 *      to assert the deployment sits behind a reverse proxy that overwrites
 *      those headers.
 *   3. A coarse user-agent fingerprint as a last resort.
 *
 * The function never reads the request body, so a client cannot influence its
 * own rate-limit bucket.
 */
function getClientIdentifier(request: NextRequest): string {
  // 1. Next.js' verified peer IP (set by Vercel / configured runtime).
  const directIp = (request as unknown as { ip?: string }).ip;
  if (directIp) return `ip:${directIp}`;

  // 2. Forwarded headers are only meaningful behind a trusted proxy the
  //    operator has explicitly opted in to. Without this flag the headers are
  //    fully client-controlled and must not seed a bucket.
  if (process.env.TRUSTED_PROXY === "true") {
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) return `ip:${forwardedFor.split(",")[0].trim()}`;
    const realIp = request.headers.get("x-real-ip");
    if (realIp) return `ip:${realIp}`;
  }

  // 3. Last-resort fallback: a coarse user-agent fingerprint. Stable per
  //    client, coarse across clients sharing a UA — acceptable when no IP is
  //    available (e.g. local dev).
  const userAgent = request.headers.get("user-agent") || "unknown";
  return `session:${userAgent.substring(0, 32)}`;
}

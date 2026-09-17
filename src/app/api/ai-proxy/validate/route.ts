/**
 * AI Proxy Validation Endpoint
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 * Issue #1795: Gate the endpoint behind the shared `getClientIdentifier` /
 *              `enforceRateLimit` policy (mirrors `POST /api/ai-proxy`,
 *              #1782/#1868), and stop embedding the Google API key in the
 *              probe URL.
 *
 * The endpoint reads `searchParams` so the route MUST be `force-dynamic` —
 * `force-static` would let Next.js attempt build-time prerendering of a
 * path whose runtime behaviour depends on the incoming request, which was
 * incoherent and risks build-time surprises. Rate-limited to 5 requests /
 * hour per server-verified client identifier.
 */

// Required because the route reads `searchParams` and rate-limits per
// request. #1795 supersedes the prior `force-static` declaration.
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { AIProvider } from "@/ai/providers/types";
import {
  getProviderConfig,
  isProviderConfigured,
  validateApiKeyFormat,
} from "@/lib/server-api-key-storage";
import { API_ENDPOINTS } from "@/lib/env";
import {
  newCorrelationId,
  redactErrorMessage,
  redactText,
} from "@/lib/security/redact-error";
import {
  enforceRateLimit,
  getRateLimitHeaders,
  RateLimitError,
  type RateLimitConfig,
} from "@/lib/server-rate-limiter";
import { getClientIdentifier } from "@/lib/server-request-identity";

/**
 * Provider endpoint mappings
 */
const PROVIDER_ENDPOINTS: Record<AIProvider, string> = {
  google: API_ENDPOINTS.GOOGLE,
  openai: API_ENDPOINTS.OPENAI,
  anthropic: API_ENDPOINTS.ANTHROPIC || "",
  zaic: API_ENDPOINTS.ZAI,
  custom: process.env.CUSTOM_AI_BASE_URL || "",
};

/**
 * Rate-limit policy for the validate endpoint.
 *
 * The endpoint makes a real upstream probe per hit and exposes operator-side
 * provider-configuration signal (whether a given provider is configured,
 * whether the key is still valid). #1795 caps it at 5 requests / hour per
 * server-verified client identifier (issue #1393 / #1534 — see
 * `getClientIdentifier`); the sibling `POST /api/ai-proxy` uses a per-provider
 * limit from env, which is too loose for this surface.
 */
const VALIDATE_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 5,
  windowMs: 60 * 60 * 1000,
  message: "API key validation rate limit exceeded. Please try again later.",
};

/**
 * GET /api/ai-proxy/validate - Validate API key for a provider
 *
 * Issue #1795: the route is gated by the shared `getClientIdentifier` /
 * `enforceRateLimit` policy (5/hour per verified client). The 429 path is
 * handled before any provider lookup so an anonymous attacker cannot
 * use the endpoint as a key-probe oracle.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") as AIProvider | null;

    // #1795 — gate the endpoint BEFORE any provider lookup. Server-verified
    // client identifier only; never read from the request body (a client-
    // supplied key would let callers rotate their own bucket).
    const clientId = getClientIdentifier(request);

    let rateLimitResult;
    try {
      rateLimitResult = await enforceRateLimit(clientId, VALIDATE_RATE_LIMIT);
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
            headers: getRateLimitHeaders(
              {
                success: false,
                remaining: 0,
                resetAt: Date.now() + error.retryAfter * 1000,
                retryAfter: error.retryAfter,
              },
              VALIDATE_RATE_LIMIT,
            ),
          },
        );
      }
      throw error;
    }

    if (!provider) {
      return NextResponse.json(
        {
          success: false,
          error: "Provider parameter is required",
          errorCode: "MISSING_PROVIDER",
        },
        { status: 400 },
      );
    }

    // Validate provider value
    if (!["google", "openai", "zaic", "custom"].includes(provider)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid provider: ${provider}`,
          errorCode: "INVALID_PROVIDER",
        },
        { status: 400 },
      );
    }

    // Check if provider is configured
    const providerConfig = getProviderConfig(provider);
    if (!providerConfig || !providerConfig.enabled) {
      return NextResponse.json(
        {
          success: false,
          error: `Provider ${provider} is not configured on the server`,
          errorCode: "PROVIDER_NOT_CONFIGURED",
        },
        { status: 404 },
      );
    }

    // Validate API key format
    const formatValidation = validateApiKeyFormat(
      provider,
      providerConfig.apiKey,
    );
    if (!formatValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: formatValidation.error,
          errorCode: "INVALID_KEY_FORMAT",
        },
        { status: 400 },
      );
    }

    // Test the API key with a minimal request
    const testUrl = buildTestUrl(provider);
    const headers = buildRequestHeaders(provider, providerConfig.apiKey);

    // Touch the rate-limit result so it is included in the response headers
    // on success — symmetrical with `POST /api/ai-proxy` (#1782/#1868).
    void rateLimitResult;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(testUrl, {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } finally {
      // Always clear the abort timer — including on fetch failure, so no
      // dangling 10s handle outlives the request (Jest open-handle leak).
      clearTimeout(timeoutId);
    }

    if (response.ok) {
      return NextResponse.json(
        {
          success: true,
          provider,
          valid: true,
          message: "API key is valid and working",
        },
        { headers: getRateLimitHeaders(rateLimitResult, VALIDATE_RATE_LIMIT) },
      );
    } else {
      // Issue #1585: the upstream error body can echo auth headers / key
      // material back — scrub and truncate before returning anything.
      const errorText = redactText(await response.text());
      return NextResponse.json(
        {
          success: false,
          provider,
          valid: false,
          error: `API validation failed: ${response.status} - ${errorText}`,
          errorCode: `VALIDATION_FAILED_${response.status}`,
        },
        {
          status: 401,
          headers: getRateLimitHeaders(rateLimitResult, VALIDATE_RATE_LIMIT),
        },
      );
    }
  } catch (error) {
    // Issue #1585: fetch failures embed the probe URL — which for Google
    // contains the API key as a query param. Log a redacted summary and
    // return a generic message; never the raw error.
    const correlationId = newCorrelationId();
    console.error(
      `AI Proxy validation error [corr ${correlationId}]:`,
      redactErrorMessage(error),
    );
    return NextResponse.json(
      {
        success: false,
        error: "API key validation failed",
        errorCode: "VALIDATION_ERROR",
        correlationId,
      },
      { status: 500 },
    );
  }
}

/**
 * Build test URL for API key validation
 *
 * Issue #1795: the Google probe previously embedded the API key as a
 * `?key=<apiKey>` query parameter — which lands in the server's egress
 * logs and any intermediate proxy. The Generative Language API also
 * accepts the key via the `x-goog-api-key` request header, which keeps
 * it off the URL line. The URL builder no longer needs to look up the
 * provider config to thread the key.
 */
function buildTestUrl(provider: AIProvider): string {
  const baseUrl = PROVIDER_ENDPOINTS[provider];

  if (!baseUrl) {
    throw new Error(`Base URL not configured for provider: ${provider}`);
  }

  switch (provider) {
    case "openai":
    case "zaic":
    case "google":
      return `${baseUrl}/models`;
    case "custom":
      return `${baseUrl}/health`;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Build request headers for provider
 *
 * Issue #1795: Google uses the `x-goog-api-key` header instead of the
 * `?key=` query parameter, so the key never appears in the egress URL.
 * OpenAI / Z.ai / Anthropic / custom all use `Authorization: Bearer …`.
 */
function buildRequestHeaders(
  provider: AIProvider,
  apiKey: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (provider === "google") {
    headers["x-goog-api-key"] = apiKey;
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * AI Proxy Validation Endpoint
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 *
 * This endpoint validates server-side API keys for AI providers.
 */

// Required for static export
export const dynamic = "force-static";

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
 * GET /api/ai-proxy/validate - Validate API key for a provider
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") as AIProvider | null;

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
      return NextResponse.json({
        success: true,
        provider,
        valid: true,
        message: "API key is valid and working",
      });
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
        { status: 401 },
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
 */
function buildTestUrl(provider: AIProvider): string {
  const baseUrl = PROVIDER_ENDPOINTS[provider];

  if (!baseUrl) {
    throw new Error(`Base URL not configured for provider: ${provider}`);
  }

  switch (provider) {
    case "openai":
    case "zaic":
      return `${baseUrl}/models`;
    case "google": {
      const config = getProviderConfig(provider);
      return `${baseUrl}/models?key=${config?.apiKey}`;
    }
    case "custom":
      return `${baseUrl}/health`;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Build request headers for provider
 */
function buildRequestHeaders(
  provider: AIProvider,
  apiKey: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Google uses query parameter, others use Bearer token
  if (provider !== "google") {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  return headers;
}

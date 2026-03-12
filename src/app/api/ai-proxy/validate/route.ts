/**
 * AI Proxy Validation Endpoint
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 *
 * This endpoint validates server-side API keys for AI providers.
 */

// Required for static export
export const dynamic = 'force-static';

import { NextRequest, NextResponse } from 'next/server';
import { AIProvider } from '@/ai/providers/types';
import {
  getProviderConfig,
  isProviderConfigured,
  validateApiKeyFormat,
} from '@/lib/server-api-key-storage';
import { API_ENDPOINTS } from '@/lib/env';

/**
 * Provider endpoint mappings
 */
const PROVIDER_ENDPOINTS: Record<AIProvider, string> = {
  google: API_ENDPOINTS.GOOGLE,
  openai: API_ENDPOINTS.OPENAI,
  zaic: API_ENDPOINTS.ZAI,
  custom: process.env.CUSTOM_AI_BASE_URL || '',
};

/**
 * GET /api/ai-proxy/validate - Validate API key for a provider
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider') as AIProvider | null;

    if (!provider) {
      return NextResponse.json(
        {
          success: false,
          error: 'Provider parameter is required',
          errorCode: 'MISSING_PROVIDER',
        },
        { status: 400 }
      );
    }

    // Validate provider value
    if (!['google', 'openai', 'zaic', 'custom'].includes(provider)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid provider: ${provider}`,
          errorCode: 'INVALID_PROVIDER',
        },
        { status: 400 }
      );
    }

    // Check if provider is configured
    const providerConfig = getProviderConfig(provider);
    if (!providerConfig || !providerConfig.enabled) {
      return NextResponse.json(
        {
          success: false,
          error: `Provider ${provider} is not configured on the server`,
          errorCode: 'PROVIDER_NOT_CONFIGURED',
        },
        { status: 404 }
      );
    }

    // Validate API key format
    const formatValidation = validateApiKeyFormat(provider, providerConfig.apiKey);
    if (!formatValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: formatValidation.error,
          errorCode: 'INVALID_KEY_FORMAT',
        },
        { status: 400 }
      );
    }

    // Test the API key with a minimal request
    const testUrl = buildTestUrl(provider);
    const headers = buildRequestHeaders(provider, providerConfig.apiKey);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(testUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return NextResponse.json({
        success: true,
        provider,
        valid: true,
        message: 'API key is valid and working',
      });
    } else {
      const errorText = await response.text();
      return NextResponse.json(
        {
          success: false,
          provider,
          valid: false,
          error: `API validation failed: ${response.status} - ${errorText}`,
          errorCode: `VALIDATION_FAILED_${response.status}`,
        },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('AI Proxy validation error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed',
        errorCode: 'VALIDATION_ERROR',
      },
      { status: 500 }
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
    case 'openai':
    case 'zaic':
      return `${baseUrl}/models`;
    case 'google': {
      const config = getProviderConfig(provider);
      return `${baseUrl}/models?key=${config?.apiKey}`;
    }
    case 'custom':
      return `${baseUrl}/health`;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Build request headers for provider
 */
function buildRequestHeaders(provider: AIProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Google uses query parameter, others use Bearer token
  if (provider !== 'google') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

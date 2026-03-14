/**
 * AI Proxy API Route
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 * Issue #591: Implement server-side streaming proxy for Zaic AI provider
 *
 * This API route proxies AI provider requests server-side, providing:
 * - Secure API key storage (server environment variables)
 * - Server-side rate limiting
 * - Usage tracking and logging
 * - User authentication integration
 * - Streaming support for real-time AI responses
 */

// Required for static export
export const dynamic = 'force-static';

import { NextRequest, NextResponse } from 'next/server';
import { AIProvider } from '@/ai/providers/types';
import {
  getProviderConfig,
  isProviderConfigured,
  getConfiguredProviders,
  validateApiKeyFormat,
} from '@/lib/server-api-key-storage';
import {
  checkRateLimit,
  enforceRateLimit,
  RateLimitError,
  getRateLimitHeaders,
} from '@/lib/server-rate-limiter';
import {
  UsageLogger,
  logUsage,
} from '@/lib/server-usage-logger';
import { API_ENDPOINTS } from '@/lib/env';

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
 * Provider endpoint mappings
 */
const PROVIDER_ENDPOINTS: Record<AIProvider, string> = {
  google: API_ENDPOINTS.GOOGLE,
  openai: API_ENDPOINTS.OPENAI,
  zaic: API_ENDPOINTS.ZAI,
  custom: process.env.CUSTOM_AI_BASE_URL || '',
};

/**
 * GET /api/ai-proxy - Get proxy status and configuration
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // Get configured providers
    const configuredProviders = getConfiguredProviders();

    if (action === 'status') {
      return NextResponse.json({
        success: true,
        serverProxyEnabled: true,
        configuredProviders,
        availableProviders: ['google', 'openai', 'zaic', 'custom'],
      });
    }

    // Default: return basic status
    return NextResponse.json({
      success: true,
      message: 'AI Proxy is running',
      configuredProviders,
    });
  } catch (error) {
    console.error('AI Proxy GET error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ai-proxy - Proxy AI provider requests
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const logger = new UsageLogger('unknown', 'custom', '/api/ai-proxy');
  
  try {
    // Parse request body
    let body: AIProxyRequest;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid JSON body',
          errorCode: 'INVALID_JSON',
        },
        { status: 400 }
      );
    }

    const { provider, endpoint, model, userId = 'anonymous' } = body;

    // Check for streaming request
    const isStreaming = body.body?.stream === true;
    
    // Validate provider
    if (!provider || !['google', 'openai', 'zaic', 'custom'].includes(provider)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid or missing provider',
          errorCode: 'INVALID_PROVIDER',
        },
        { status: 400 }
      );
    }

    // Initialize logger with correct provider
    const usageLogger = new UsageLogger(userId, provider as AIProvider, endpoint);
    usageLogger.setModel(model || 'unknown');

    // Check if provider is configured on server
    const providerConfig = getProviderConfig(provider as AIProvider);
    if (!providerConfig || !providerConfig.enabled) {
      await usageLogger.markFailure('Provider not configured on server', 'PROVIDER_NOT_CONFIGURED').save();
      return NextResponse.json(
        {
          success: false,
          error: `Provider ${provider} is not configured on the server`,
          errorCode: 'PROVIDER_NOT_CONFIGURED',
        },
        { status: 503 }
      );
    }

    // Handle streaming requests separately (pass rateLimit as-is now)
    if (isStreaming) {
      return handleStreamingRequest(request, body, providerConfig);
    }

    // Get client identifier for rate limiting
    const clientId = getClientIdentifier(request, userId);

    // Check rate limit (transform maxRequests to limit for enforceRateLimit)
    let rateLimitResult;
    const rateLimitConfig = providerConfig.rateLimit
      ? { maxRequests: providerConfig.rateLimit.maxRequests, windowMs: providerConfig.rateLimit.windowMs }
      : undefined;
    try {
      rateLimitResult = enforceRateLimit(clientId, rateLimitConfig);
    } catch (error) {
      if (error instanceof RateLimitError) {
        await usageLogger.markFailure('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED').save();
        return NextResponse.json(
          {
            success: false,
            error: error.message,
            errorCode: 'RATE_LIMIT_EXCEEDED',
            retryAfter: error.retryAfter,
          },
          { 
            status: 429,
            headers: getRateLimitHeaders({ 
              success: false, 
              remaining: 0, 
              resetAt: Date.now() + (error.retryAfter * 1000),
              retryAfter: error.retryAfter 
            }, providerConfig.rateLimit)
          }
        );
      }
      throw error;
    }

    // Build the proxied request
    const targetUrl = buildTargetUrl(provider as AIProvider, endpoint, providerConfig.apiKey);
    const requestBody = buildRequestBody(provider as AIProvider, body, model);
    const headers = buildRequestHeaders(provider as AIProvider, providerConfig.apiKey);

    // Make the proxied request
    const startTime = Date.now();
    let response: Response;

    try {
      response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Network error';
      await usageLogger.markFailure(`Failed to call provider API: ${errorMessage}`, 'NETWORK_ERROR').save();
      
      return NextResponse.json(
        {
          success: false,
          error: `Failed to call ${provider} API: ${errorMessage}`,
          errorCode: 'NETWORK_ERROR',
        },
        { status: 502 }
      );
    }

    const duration = Date.now() - startTime;

    // Parse response
    let responseData;
    const responseText = await response.text();
    
    try {
      responseData = JSON.parse(responseText);
    } catch {
      await usageLogger.markFailure('Invalid response from provider', 'INVALID_RESPONSE').save();
      
      return NextResponse.json(
        {
          success: false,
          error: `Invalid response from ${provider} API`,
          errorCode: 'INVALID_RESPONSE',
        },
        { status: 502 }
      );
    }

    // Handle error responses from provider
    if (!response.ok) {
      await usageLogger
        .markFailure(
          responseData.error?.message || `HTTP ${response.status}`,
          `PROVIDER_ERROR_${response.status}`
        )
        .save();

      return NextResponse.json(
        {
          success: false,
          error: responseData.error?.message || `Provider returned error: ${response.status}`,
          errorCode: `PROVIDER_ERROR_${response.status}`,
        },
        { status: response.status }
      );
    }

    // Extract token usage if available
    let tokenUsage;
    if (responseData.usage) {
      tokenUsage = {
        inputTokens: responseData.usage.prompt_tokens || 0,
        outputTokens: responseData.usage.completion_tokens || 0,
        totalTokens: responseData.usage.total_tokens || 0,
      };
      
      usageLogger.setTokenUsage(tokenUsage.inputTokens, tokenUsage.outputTokens);
    }

    // Log successful usage
    await usageLogger.markSuccess().save();

    // Build successful response
    const proxyResponse: AIProxyResponse = {
      success: true,
      data: responseData,
      ...(tokenUsage && { usage: tokenUsage }),
      rateLimit: {
        remaining: rateLimitResult.remaining,
        resetAt: rateLimitResult.resetAt,
      },
    };

    return NextResponse.json(proxyResponse, {
      headers: getRateLimitHeaders(rateLimitResult, providerConfig.rateLimit),
    });
  } catch (error) {
    console.error('AI Proxy POST error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        errorCode: 'INTERNAL_ERROR',
      },
      { status: 500 }
    );
  }
}

/**
 * Handle streaming AI requests
 * POST /api/ai-proxy with stream: true in body
 * 
 * This enables real-time streaming responses from AI providers while keeping
 * API keys secure on the server side.
 */
async function handleStreamingRequest(
  request: NextRequest,
  body: AIProxyRequest,
  providerConfig: { apiKey: string; rateLimit?: { maxRequests: number; windowMs: number } }
): Promise<NextResponse> {
  const { provider, endpoint, model, userId = 'anonymous' } = body;
  
  // Build the proxied request
  const targetUrl = buildTargetUrl(provider as AIProvider, endpoint, providerConfig.apiKey);
  const requestBody = buildRequestBody(provider as AIProvider, body, model);
  const headers = buildRequestHeaders(provider as AIProvider, providerConfig.apiKey);
  
  // Enable streaming
  requestBody.stream = true;

  // Create a readable stream for the response
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        });

        if (!response.ok || !response.body) {
          const errorText = await response.text();
          controller.enqueue(encoder.encode(`data: {"error": "${errorText}"}\n\n`));
          controller.close();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          
          if (done) {
            // Send any remaining data in buffer
            if (buffer.trim()) {
              controller.enqueue(encoder.encode(buffer));
            }
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          
          // Process complete SSE events
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              controller.enqueue(encoder.encode(line + '\n'));
            } else if (line.trim()) {
              // Pass through other lines
              controller.enqueue(encoder.encode(line + '\n'));
            }
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Stream error';
        controller.enqueue(encoder.encode(`data: {"error": "${errorMessage}"}\n\n`));
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

/**
 * Get client identifier for rate limiting
 * Uses user ID if available, otherwise falls back to IP address
 */
function getClientIdentifier(request: NextRequest, userId?: string): string {
  if (userId && userId !== 'anonymous') {
    return `user:${userId}`;
  }

  // Fall back to IP address
  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  
  if (forwardedFor) {
    return `ip:${forwardedFor.split(',')[0].trim()}`;
  }
  
  if (realIp) {
    return `ip:${realIp}`;
  }

  // Last resort: use a hash of some request characteristics
  const userAgent = request.headers.get('user-agent') || 'unknown';
  return `session:${userAgent.substring(0, 20)}`;
}

/**
 * Build target URL for provider request
 */
function buildTargetUrl(provider: AIProvider, endpoint: string, apiKey: string): string {
  const baseUrl = PROVIDER_ENDPOINTS[provider];
  
  if (!baseUrl) {
    throw new Error(`Base URL not configured for provider: ${provider}`);
  }

  // Ensure base URL doesn't end with slash and endpoint starts with slash
  const cleanBase = baseUrl.replace(/\/$/, '');
  const cleanEndpoint = endpoint.replace(/^\//, '');
  
  let url = `${cleanBase}/${cleanEndpoint}`;
  
  // Google uses query parameter for API key
  if (provider === 'google') {
    const separator = url.includes('?') ? '&' : '?';
    url = `${url}${separator}key=${apiKey}`;
  }
  
  return url;
}

/**
 * Build request body for provider
 */
function buildRequestBody(
  provider: AIProvider,
  body: AIProxyRequest,
  model?: string
): Record<string, unknown> {
  const requestBody = { ...body.body };

  // Add model if not already present
  if (model && !requestBody.model) {
    requestBody.model = model;
  }

  return requestBody;
}

/**
 * Build request headers for provider
 */
function buildRequestHeaders(provider: AIProvider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Add authorization header
  if (provider === 'google') {
    // Google uses query parameter for API key
    // (handled in URL building)
  } else {
    // OpenAI-compatible providers use Bearer token
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * Build test URL for API key validation
 */
function buildTestUrl(provider: AIProvider): string {
  const baseUrl = PROVIDER_ENDPOINTS[provider];

  switch (provider) {
    case 'openai':
    case 'zaic':
      return `${baseUrl}/models`;
    case 'google':
      return `${baseUrl}/models?key=${getProviderConfig(provider)?.apiKey}`;
    case 'custom':
      return `${baseUrl}/health`;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

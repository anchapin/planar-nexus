import { NextRequest, NextResponse } from 'next/server';
import { streamText, generateText } from 'ai';
import { getAIModel } from '@/ai/providers/factory';
import { AIProvider } from '@/ai/providers/types';
import { searchCardsTool } from '@/ai/tools/card-search';
import {
  getProviderConfig,
  getConfiguredProviders,
} from '@/lib/server-api-key-storage';
import {
  enforceRateLimit,
  RateLimitError,
  getRateLimitHeaders,
} from '@/lib/server-rate-limiter';
import {
  UsageLogger,
} from '@/lib/server-usage-logger';

/**
 * AI Proxy API Route
 * Refactored in Phase 6 to use Vercel AI SDK for unified streaming.
 */

// Use force-dynamic to prevent response buffering
export const dynamic = 'force-dynamic';

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
    const action = searchParams.get('action');

    // Get configured providers
    const configuredProviders = getConfiguredProviders();

    if (action === 'status') {
      return NextResponse.json({
        success: true,
        serverProxyEnabled: true,
        configuredProviders,
        availableProviders: ['google', 'openai', 'anthropic', 'zaic', 'custom'],
      });
    }

    // Default: return basic status
    return NextResponse.json({
      success: true,
      message: 'AI Proxy is running (Vercel AI SDK enabled)',
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
 * POST /api/ai-proxy - Proxy AI provider requests using Vercel AI SDK
 */
export async function POST(request: NextRequest): Promise<NextResponse | Response> {
  const userId = 'anonymous'; // Fallback
  
  try {
    // Parse request body
    let body: AIProxyRequest;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON body', errorCode: 'INVALID_JSON' },
        { status: 400 }
      );
    }

    const { provider, model: modelId, body: providerBody, userId: reqUserId } = body;
    const currentUserId = reqUserId || userId;

    // Validate provider
    if (!provider || !['google', 'openai', 'anthropic', 'zaic', 'custom'].includes(provider)) {
      return NextResponse.json(
        { success: false, error: 'Invalid or missing provider', errorCode: 'INVALID_PROVIDER' },
        { status: 400 }
      );
    }

    // Initialize logger with correct provider
    const usageLogger = new UsageLogger(currentUserId, provider as AIProvider, body.endpoint);
    usageLogger.setModel(modelId || 'unknown');

    // Check if provider is configured on server
    const providerConfig = getProviderConfig(provider as AIProvider);
    if (!providerConfig || !providerConfig.enabled) {
      await usageLogger.markFailure('Provider not configured on server', 'PROVIDER_NOT_CONFIGURED').save();
      return NextResponse.json(
        { success: false, error: `Provider ${provider} is not configured`, errorCode: 'PROVIDER_NOT_CONFIGURED' },
        { status: 503 }
      );
    }

    // Get client identifier for rate limiting
    const clientId = getClientIdentifier(request, currentUserId);

    // Check rate limit
    let rateLimitResult;
    try {
      rateLimitResult = enforceRateLimit(clientId, providerConfig.rateLimit);
    } catch (error) {
      if (error instanceof RateLimitError) {
        await usageLogger.markFailure('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED').save();
        return NextResponse.json(
          { success: false, error: error.message, errorCode: 'RATE_LIMIT_EXCEEDED', retryAfter: error.retryAfter },
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

    // Check for streaming request
    const isStreaming = providerBody?.stream === true;
    
    // Get the model instance from our factory
    const model = getAIModel(provider, modelId);

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
        maxOutputTokens: (providerBody.max_tokens as number) || (providerBody.maxTokens as number),
        onFinish: async (finishResult) => {
          // Log usage on completion - usage is now a Promise in AI SDK v6
          const usage = await finishResult.usage;
          usageLogger.setTokenUsage(
            usage.inputTokens ?? 0,
            usage.outputTokens ?? 0
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
        maxOutputTokens: (providerBody.max_tokens as number) || (providerBody.maxTokens as number),
      });

      // AI SDK v6: usage is now a Promise with inputTokens/outputTokens
      const usage = await result.usage;
      const totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
      usageLogger.setTokenUsage(usage.inputTokens ?? 0, usage.outputTokens ?? 0);
      await usageLogger.markSuccess().save();

      // Return in a format compatible with what extractContentFromResponse expects
      // We wrap it to look like an OpenAI-style response for legacy compatibility
      const legacyData = {
        choices: [
          {
            message: {
              role: 'assistant',
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

      return NextResponse.json({
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
      }, {
        headers: getRateLimitHeaders(rateLimitResult, providerConfig.rateLimit),
      });
    }
  } catch (error) {
    console.error('AI Proxy POST error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error', errorCode: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

/**
 * Get client identifier for rate limiting
 */
function getClientIdentifier(request: NextRequest, userId?: string): string {
  if (userId && userId !== 'anonymous') {
    return `user:${userId}`;
  }

  const forwardedFor = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');
  
  if (forwardedFor) return `ip:${forwardedFor.split(',')[0].trim()}`;
  if (realIp) return `ip:${realIp}`;

  const userAgent = request.headers.get('user-agent') || 'unknown';
  return `session:${userAgent.substring(0, 20)}`;
}

/**
 * AI Proxy Client
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 *
 * This module provides a client for making AI API calls through the server-side proxy.
 * It ensures API keys are never exposed to the browser and provides:
 * - Server-side API key management
 * - Rate limiting enforcement
 * - Usage tracking
 * - Consistent error handling
 */

import { AIProvider } from '@/ai/providers/types';
import { safeFetch, ApiError } from './fetch-utils';

/**
 * AI Proxy request body
 */
export interface AIProxyRequest {
  provider: AIProvider;
  endpoint: string;
  model?: string;
  body: Record<string, unknown>;
  userId?: string;
}

/**
 * AI Proxy response
 */
export interface AIProxyResponse<T = unknown> {
  success: boolean;
  data?: T;
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
 * Proxy status response
 */
export interface ProxyStatusResponse {
  success: boolean;
  serverProxyEnabled: boolean;
  configuredProviders: AIProvider[];
  availableProviders: AIProvider[];
}

/**
 * Validation response
 */
export interface ValidationResponse {
  success: boolean;
  provider: AIProvider;
  valid: boolean;
  message?: string;
  error?: string;
  errorCode?: string;
}

/**
 * Get the proxy API endpoint
 */
function getProxyEndpoint(): string {
  return '/api/ai-proxy';
}

/**
 * Get the validation endpoint
 */
function getValidationEndpoint(): string {
  return '/api/ai-proxy/validate';
}

/**
 * Make a proxied AI API call
 *
 * @param request - The proxy request with provider, endpoint, and body
 * @returns The proxy response with data from the AI provider
 */
export async function callAIProxy<T = unknown>(
  request: AIProxyRequest
): Promise<AIProxyResponse<T>> {
  try {
    const response = await safeFetch<AIProxyResponse<T>>(
      getProxyEndpoint(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        timeoutMs: 60000, // 60 second timeout for AI calls
        errorMessage: 'AI Proxy request failed',
      }
    );

    return response as AIProxyResponse<T>;
  } catch (error) {
    if (error instanceof ApiError) {
      // Parse error response if available
      return {
        success: false,
        error: error.message,
        errorCode: error.status?.toString(),
      };
    }

    throw error;
  }
}

/**
 * Get proxy status and configuration
 */
export async function getProxyStatus(): Promise<ProxyStatusResponse> {
  try {
    const response = await safeFetch<ProxyStatusResponse>(
      `${getProxyEndpoint()}?action=status`,
      {
        method: 'GET',
        timeoutMs: 10000,
        errorMessage: 'Failed to get proxy status',
      }
    );

    return response as ProxyStatusResponse;
  } catch (error) {
    console.error('Failed to get proxy status:', error);
    throw error;
  }
}

/**
 * Validate server-side API key for a provider
 */
export async function validateProviderKey(
  provider: AIProvider
): Promise<ValidationResponse> {
  try {
    const response = await safeFetch<ValidationResponse>(
      `${getValidationEndpoint()}?provider=${provider}`,
      {
        method: 'GET',
        timeoutMs: 15000,
        errorMessage: 'API key validation failed',
      }
    );

    return response as ValidationResponse;
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        success: false,
        provider,
        valid: false,
        error: error.message,
        errorCode: error.status?.toString(),
      };
    }

    throw error;
  }
}

/**
 * Check if proxy is enabled and a provider is configured
 */
export async function isProviderAvailable(
  provider: AIProvider
): Promise<boolean> {
  try {
    const status = await getProxyStatus();
    return status.configuredProviders.includes(provider);
  } catch {
    return false;
  }
}

/**
 * Get all available providers
 */
export async function getAvailableProviders(): Promise<AIProvider[]> {
  try {
    const status = await getProxyStatus();
    return status.configuredProviders;
  } catch {
    return [];
  }
}

/**
 * Extract content from a proxy response
 * Handles different response formats from different providers
 */
export function extractContentFromResponse<T extends Record<string, unknown>>(
  response: AIProxyResponse<T>,
  provider: AIProvider
): string {
  if (!response.success || !response.data) {
    return '';
  }

  const data = response.data as Record<string, unknown>;

  // OpenAI/Z.ai format
  if ('choices' in data && Array.isArray(data.choices)) {
    const choice = data.choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown>;
    return (message?.content as string) || '';
  }

  // Google AI format
  if ('candidates' in data && Array.isArray(data.candidates)) {
    const candidate = data.candidates[0] as Record<string, unknown>;
    const content = candidate.content as Record<string, unknown>;
    const parts = content.parts as Array<{ text?: string }>;
    return parts?.[0]?.text || '';
  }

  // Direct content
  if ('content' in data) {
    return data.content as string;
  }

  return '';
}

/**
 * Extract token usage from a proxy response
 */
export function extractUsageFromResponse<T extends Record<string, unknown>>(
  response: AIProxyResponse<T>
): { inputTokens: number; outputTokens: number; totalTokens: number } | null {
  // Check response-level usage
  if (response.usage) {
    return response.usage;
  }

  // Check data-level usage
  if (response.data) {
    const data = response.data as Record<string, unknown>;
    if ('usage' in data) {
      const usage = data.usage as Record<string, unknown>;
      return {
        inputTokens: (usage?.prompt_tokens as number) || 0,
        outputTokens: (usage?.completion_tokens as number) || 0,
        totalTokens: (usage?.total_tokens as number) || 0,
      };
    }
  }

  return null;
}

/**
 * Handle proxy response errors
 * Returns a user-friendly error message
 */
export function getProxyErrorMessage(
  response: AIProxyResponse,
  provider: AIProvider
): string {
  if (!response.error) {
    return 'Unknown error occurred';
  }

  const errorCode = response.errorCode;

  // Provider-specific error messages
  switch (errorCode) {
    case 'PROVIDER_NOT_CONFIGURED':
      return `${provider} is not configured on the server. Please contact the administrator.`;
    case 'RATE_LIMIT_EXCEEDED':
      return 'Rate limit exceeded. Please wait a moment and try again.';
    case 'INVALID_API_KEY':
    case 'PROVIDER_ERROR_401':
      return `Invalid ${provider} API key. Please check the server configuration.`;
    case 'PROVIDER_ERROR_429':
      return `${provider} rate limit exceeded. Please try again later.`;
    case 'PROVIDER_ERROR_500':
    case 'PROVIDER_ERROR_503':
      return `${provider} service temporarily unavailable. Please try again later.`;
    case 'NETWORK_ERROR':
      return 'Network error. Please check your connection and try again.';
    case 'INVALID_JSON':
      return 'Invalid request format.';
    case 'INVALID_PROVIDER':
      return 'Invalid AI provider specified.';
    default:
      return response.error;
  }
}

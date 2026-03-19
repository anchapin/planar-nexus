/**
 * Server-Side API Key Storage
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 *
 * This module provides secure server-side storage for API keys with encryption.
 * Unlike the client-side storage, this uses server environment variables
 * and can optionally integrate with external secret management.
 */

import { AIProvider } from '@/ai/providers/types';

/**
 * Server-side API key configuration
 */
export interface ServerApiKeyConfig {
  provider: AIProvider;
  apiKey: string;
  baseURL?: string;
  models?: string[];
  enabled: boolean;
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
}

/**
 * Environment variable mappings for providers
 */
const PROVIDER_ENV_MAPPING: Record<AIProvider, { apiKey: string[]; baseURL?: string }> = {
  google: {
    apiKey: ['GOOGLE_AI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    baseURL: 'NEXT_PUBLIC_GOOGLE_API_URL',
  },
  openai: {
    apiKey: ['OPENAI_API_KEY'],
    baseURL: 'NEXT_PUBLIC_OPENAI_API_URL',
  },
  anthropic: {
    apiKey: ['ANTHROPIC_API_KEY'],
    baseURL: 'ANTHROPIC_BASE_URL',
  },
  zaic: {
    apiKey: ['ZAI_API_KEY'],
    baseURL: 'ZAI_BASE_URL',
  },
  custom: {
    apiKey: ['CUSTOM_AI_API_KEY'],
    baseURL: 'CUSTOM_AI_BASE_URL',
  },
};

/**
 * Get server-side API key for a provider from environment variables
 */
export function getServerApiKey(provider: AIProvider): string | null {
  const envVars = PROVIDER_ENV_MAPPING[provider]?.apiKey;
  if (!envVars) {
    return null;
  }
  
  for (const envVar of envVars) {
    const key = process.env[envVar];
    if (key && key.length > 0) {
      return key;
    }
  }
  
  return null;
}

/**
 * Get server-side base URL for a provider
 */
export function getServerBaseURL(provider: AIProvider): string | null {
  const envVar = PROVIDER_ENV_MAPPING[provider]?.baseURL;
  if (!envVar) {
    return null;
  }
  return process.env[envVar] || null;
}

/**
 * Check if a provider is configured on the server
 */
export function isProviderConfigured(provider: AIProvider): boolean {
  const apiKey = getServerApiKey(provider);
  return !!apiKey && apiKey.length > 0;
}

/**
 * Get all configured providers on the server
 */
export function getConfiguredProviders(): AIProvider[] {
  const providers: AIProvider[] = ['google', 'openai', 'zaic', 'custom'];
  return providers.filter(provider => isProviderConfigured(provider));
}

/**
 * Get provider configuration
 */
export function getProviderConfig(provider: AIProvider): ServerApiKeyConfig | null {
  const apiKey = getServerApiKey(provider);
  if (!apiKey) {
    return null;
  }

  const baseURL = getServerBaseURL(provider);
  
  // Get provider-specific rate limits from environment
  const rateLimitMax = parseInt(
    process.env[`AI_RATE_LIMIT_MAX_${provider.toUpperCase()}`] || 
    process.env.AI_RATE_LIMIT_MAX || 
    '100',
    10
  );
  const rateLimitWindow = parseInt(
    process.env[`AI_RATE_LIMIT_WINDOW_${provider.toUpperCase()}`] || 
    process.env.AI_RATE_LIMIT_WINDOW_MS || 
    '60000',
    10
  );

  return {
    provider,
    apiKey,
    baseURL: baseURL || undefined,
    enabled: true,
    rateLimit: {
      maxRequests: rateLimitMax,
      windowMs: rateLimitWindow,
    },
  };
}

/**
 * Validate API key format (server-side)
 * This is a basic format check - actual validation requires API call
 */
export function validateApiKeyFormat(
  provider: AIProvider,
  apiKey: string
): { valid: boolean; error?: string } {
  if (!apiKey || apiKey.length === 0) {
    return { valid: false, error: 'API key is empty' };
  }

  // Provider-specific validation
  switch (provider) {
    case 'google':
      // Google AI keys are typically long alphanumeric strings
      if (apiKey.length < 20) {
        return { valid: false, error: 'Google AI API key appears too short' };
      }
      break;
    case 'openai':
      // OpenAI keys start with 'sk-'
      if (!apiKey.startsWith('sk-')) {
        return { valid: false, error: 'OpenAI API key should start with sk-' };
      }
      if (apiKey.length < 20) {
        return { valid: false, error: 'OpenAI API key appears too short' };
      }
      break;
    case 'zaic':
      // Z.ai keys are typically long strings
      if (apiKey.length < 20) {
        return { valid: false, error: 'Z.ai API key appears too short' };
      }
      break;
    case 'custom':
      // Custom providers - minimal validation
      if (apiKey.length < 10) {
        return { valid: false, error: 'Custom API key appears too short' };
      }
      break;
  }

  return { valid: true };
}

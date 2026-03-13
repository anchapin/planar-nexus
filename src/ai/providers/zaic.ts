/**
 * Z.ai Provider
 * Issue #45: Integrate Z.ai provider
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 *
 * This module provides Z.ai integration for the Planar Nexus application.
 * Z.ai is an AI provider that offers various language models.
 *
 * Updated to use server-side proxy for all API calls (Issue #522).
 */

import { AIProviderConfig } from './types';
import { API_ENDPOINTS } from '@/lib/env';
import { callAIProxy, getProxyErrorMessage, callAIProxyStream, streamToAsyncGenerator } from '@/lib/ai-proxy-client';
import { aiLogger } from '@/lib/logger';

/**
 * Z.ai provider configuration
 */
export interface ZAIProviderConfig extends AIProviderConfig {
  provider: 'zaic';
  model?: string;
  apiKey?: string;
  baseURL?: string;
  maxTokens?: number;
  temperature?: number;
  /** Use server-side proxy (default: true for security) */
  useProxy?: boolean;
}

/**
 * Default configuration for Z.ai provider
 * Z.ai uses OpenAI-compatible API
 */
export const DEFAULT_ZAI_CONFIG: Partial<ZAIProviderConfig> = {
  model: 'default',
  maxTokens: 8192,
  temperature: 0.7,
  baseURL: API_ENDPOINTS.ZAI,
  useProxy: true, // Default to proxy for security
};

/**
 * Z.ai chat message format
 */
export interface ZAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
}

/**
 * Z.ai chat completion request
 */
export interface ZAIChatRequest {
  model: string;
  messages: ZAIMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string | string[];
}

/**
 * Z.ai chat completion response
 */
export interface ZAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Create a Z.ai client configuration
 * @param config - Configuration for the Z.ai provider
 * @returns Configuration object for making API requests
 * @deprecated Use server-side proxy instead.
 */
export function createZAIClient(config: ZAIProviderConfig): ZAIProviderConfig {
  return {
    ...config,
    baseURL: config.baseURL || DEFAULT_ZAI_CONFIG.baseURL,
    model: config.model || DEFAULT_ZAI_CONFIG.model,
    maxTokens: config.maxTokens || DEFAULT_ZAI_CONFIG.maxTokens,
    temperature: config.temperature || DEFAULT_ZAI_CONFIG.temperature,
  };
}

/**
 * Send a chat completion request to Z.ai via server-side proxy
 * @param config - Provider configuration
 * @param request - Chat request
 * @returns Z.ai chat completion response
 */
export function sendZAIChat(
  config: ZAIProviderConfig,
  request: Omit<ZAIChatRequest, 'model'>
): Promise<ZAIChatResponse> {
  // Use server-side proxy (security best practice)
  return sendZAIChatViaProxy(config, request);
}

/**
 * Send a chat completion request to Z.ai via server-side proxy
 */
async function sendZAIChatViaProxy(
  config: ZAIProviderConfig,
  request: Omit<ZAIChatRequest, 'model'>
): Promise<ZAIChatResponse> {
  try {
    const proxyResponse = await callAIProxy<ZAIChatResponse>({
      provider: 'zaic',
      endpoint: 'chat/completions',
      model: config.model || DEFAULT_ZAI_CONFIG.model,
      body: {
        messages: request.messages,
        max_tokens: config.maxTokens || request.max_tokens,
        temperature: config.temperature || request.temperature,
        top_p: request.top_p,
        stop: request.stop,
      },
    });

    if (!proxyResponse.success) {
      const errorMessage = getProxyErrorMessage(proxyResponse, 'zaic');
      throw new Error(`Z.ai Proxy error: ${errorMessage}`);
    }

    if (!proxyResponse.data) {
      throw new Error('Z.ai Proxy returned no data');
    }

    return proxyResponse.data;
  } catch (error) {
    aiLogger.error('Z.ai proxy request failed:', error);
    throw error;
  }
}


/**
 * Send a streaming chat completion request to Z.ai via server-side proxy
 * 
 * @param config - Provider configuration
 * @param request - Chat request
 * @returns Async iterable for streaming response
 * 
 * This function routes streaming AI calls through the server-side proxy,
 * keeping API keys secure while providing real-time streaming responses.
 */
export async function sendZAIChatStream(
  config: ZAIProviderConfig,
  request: Omit<ZAIChatRequest, 'model'>
): Promise<AsyncGenerator<string>> {
  try {
    // Get streaming response from proxy
    const stream = await callAIProxyStream({
      provider: 'zaic',
      endpoint: 'chat/completions',
      model: config.model || DEFAULT_ZAI_CONFIG.model,
      body: {
        messages: request.messages,
        max_tokens: config.maxTokens || request.max_tokens,
        temperature: config.temperature || request.temperature,
        top_p: request.top_p,
        stop: request.stop,
        stream: true, // Request streaming from the provider
      },
    });

    // Convert to async generator for easier consumption
    return streamToAsyncGenerator(stream);
  } catch (error) {
    aiLogger.error('Z.ai streaming proxy request failed:', error);
    throw error;
  }
}

/**
 * Convert Z.ai response to text
 * @param response - Z.ai chat completion response
 * @returns Text content from the response
 */
export function zAIResponseToText(response: ZAIChatResponse): string {
  const message = response.choices[0]?.message;
  
  if (message?.content) {
    return message.content;
  }
  
  return '';
}

/**
 * Z.ai model options
 */
export const ZAI_MODELS = [
  'default',
  'zaiclient-7b',
  'zaiclient-14b',
  'zaiclient-72b',
];

/**
 * Get all available Z.ai models
 */
export function getZAIModelOptions(): string[] {
  return [...ZAI_MODELS];
}

/**
 * Check if a model is a Z.ai model
 */
export function isZAIModel(model: string): boolean {
  return ZAI_MODELS.includes(model);
}

/**
 * Validate Z.ai API key format
 * @param apiKey - The API key to validate
 * @returns Whether the API key appears valid
 */
export function validateZAIApiKey(apiKey: string): boolean {
  // Z.ai API keys are typically longer strings
  return apiKey.length >= 20;
}

/**
 * Convert messages to Z.ai format
 * @param messages - Messages in standard format
 * @returns Messages formatted for Z.ai
 */
export function formatZAIMessages(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; name?: string }>
): ZAIMessage[] {
  return messages as ZAIMessage[];
}

/**
 * Check if Z.ai is available (via proxy)
 */
export function isZAIAvailable(): boolean {
  // Availability is determined server-side
  return true;
}

/**
 * Get Z.ai provider status
 */
export function getZAIProviderStatus(): { available: boolean; configured: boolean } {
  return {
    available: true,
    configured: true,
  };
}

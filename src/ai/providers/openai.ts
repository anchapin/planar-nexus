/**
 * OpenAI Provider
 * Issue #44: Integrate OpenAI/Copilot
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 *
 * This module provides OpenAI integration for the Planar Nexus application.
 * It supports GPT models including GPT-4o, GPT-4 Turbo, and more.
 *
 * Updated to use server-side proxy for all API calls (Issue #522).
 */

import type { AIProviderConfig, AIResponse } from '@/ai/types';
import { DEFAULT_MODELS } from './types';
import { callAIProxy, getProxyErrorMessage } from '@/lib/ai-proxy-client';

/**
 * OpenAI provider configuration
 */
export interface OpenAIProviderConfig extends AIProviderConfig {
  provider: 'openai';
  model?: string;
  apiKey?: string;
  organization?: string;
  maxTokens?: number;
  temperature?: number;
  /** Use server-side proxy (default: true for security) */
  useProxy?: boolean;
}

/**
 * Default configuration for OpenAI provider
 */
export const DEFAULT_OPENAI_CONFIG: Partial<OpenAIProviderConfig> = {
  model: DEFAULT_MODELS.openai,
  maxTokens: 8192,
  temperature: 0.7,
  useProxy: true, // Default to proxy for security
};

/**
 * Create an OpenAI client instance
 * @param config - Configuration for the OpenAI provider
 * @returns OpenAI client instance
 * @deprecated Server-side proxy is now the default. Direct API calls are discouraged.
 */
export function createOpenAIClient(config: OpenAIProviderConfig): Record<string, unknown> {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it in config.'
    );
  }

  // OpenAI client creation stub - package not installed
  return { apiKey, organization: config.organization };
}

/**
 * OpenAI chat completion request
 */
export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAITool {
  type: string;
  function?: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIMessage[];
  maxTokens?: number;
  temperature?: number;
  tools?: OpenAITool[];
  toolChoice?: string | Record<string, unknown>;
  responseFormat?: { type: 'json_object' } | { type: 'text' };
}

/**
 * OpenAI chat completion response
 */
export interface OpenAIChatResponse {
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
 * Send a chat completion request to OpenAI via server-side proxy
 * @param config - Provider configuration
 * @param request - Chat request
 * @returns OpenAI's chat completion response
 */
export async function sendOpenAIChat(
  config: OpenAIProviderConfig,
  request: Omit<OpenAIChatRequest, 'model'>
): Promise<OpenAIChatResponse> {
  // Use server-side proxy by default (security best practice)
  if (config.useProxy !== false) {
    return sendOpenAIChatViaProxy(config, request);
  }

  // Fallback to direct API call (deprecated, for backward compatibility)
  return sendOpenAIChatDirect(config, request);
}

/**
 * Send a chat completion request to OpenAI via server-side proxy
 */
async function sendOpenAIChatViaProxy(
  config: OpenAIProviderConfig,
  request: Omit<OpenAIChatRequest, 'model'>
): Promise<OpenAIChatResponse> {
  try {
    const proxyResponse = await callAIProxy<OpenAIChatResponse>({
      provider: 'openai',
      endpoint: 'chat/completions',
      model: config.model || DEFAULT_MODELS.openai,
      body: {
        messages: request.messages,
        max_tokens: config.maxTokens || request.maxTokens || 8192,
        temperature: config.temperature || request.temperature || 0.7,
        tools: request.tools,
        tool_choice: request.toolChoice,
        response_format: request.responseFormat,
      },
    });

    if (!proxyResponse.success) {
      const errorMessage = getProxyErrorMessage(proxyResponse, 'openai');
      throw new Error(`OpenAI Proxy error: ${errorMessage}`);
    }

    if (!proxyResponse.data) {
      throw new Error('OpenAI Proxy returned no data');
    }

    return proxyResponse.data;
  } catch (error) {
    console.error('OpenAI proxy request failed:', error);
    throw error;
  }
}

/**
 * Send a chat completion request to OpenAI directly (deprecated)
 * @param config - Provider configuration
 * @param request - Chat request
 * @returns OpenAI's chat completion response
 * @deprecated Use server-side proxy instead
 */
async function sendOpenAIChatDirect(
  config: OpenAIProviderConfig,
  request: Omit<OpenAIChatRequest, 'model'>
): Promise<OpenAIChatResponse> {
  console.warn(
    'Direct OpenAI API calls are deprecated. Please use server-side proxy (useProxy: true).'
  );

  const client = createOpenAIClient(config) as {
    chat: {
      completions: {
        create: (params: Record<string, unknown>) => Promise<OpenAIChatResponse>;
      };
    };
  };

  const response = await client.chat.completions.create({
    model: config.model || DEFAULT_MODELS.openai,
    max_tokens: config.maxTokens || request.maxTokens || 8192,
    temperature: config.temperature || request.temperature || 0.7,
    messages: request.messages,
    tools: request.tools,
    tool_choice: request.toolChoice,
    response_format: request.responseFormat,
  });

  return response as OpenAIChatResponse;
}

/**
 * Convert OpenAI response to text
 * @param response - OpenAI's chat completion response
 * @returns Text content from the response
 */
export function openAIResponseToText(response: AIResponse): string {
  const message = response.choices?.[0]?.message;

  if (message?.content) {
    return message.content;
  }

  return '';
}

/**
 * OpenAI model options
 */
export const OPENAI_MODELS = {
  'gpt-4o': [
    'gpt-4o',
    'gpt-4o-2024-05-13',
    'gpt-4o-2024-08-06',
    'gpt-4o-mini',
    'gpt-4o-mini-2024-07-18',
  ],
  'gpt-4-turbo': [
    'gpt-4-turbo',
    'gpt-4-turbo-2024-04-09',
  ],
  'gpt-4': [
    'gpt-4',
    'gpt-4-0613',
    'gpt-4-32k',
    'gpt-4-32k-0613',
  ],
  'gpt-3.5-turbo': [
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-0125',
    'gpt-3.5-turbo-1106',
  ],
};

/**
 * Get all available OpenAI models
 */
export function getOpenAIModelOptions(): string[] {
  return [
    ...OPENAI_MODELS['gpt-4o'],
    ...OPENAI_MODELS['gpt-4-turbo'],
    ...OPENAI_MODELS['gpt-4'],
    ...OPENAI_MODELS['gpt-3.5-turbo'],
  ];
}

/**
 * Get model tier for a given model
 */
export function getOpenAIModelTier(model: string): 'gpt-4o' | 'gpt-4-turbo' | 'gpt-4' | 'gpt-3.5-turbo' | null {
  if (OPENAI_MODELS['gpt-4o'].includes(model)) return 'gpt-4o';
  if (OPENAI_MODELS['gpt-4-turbo'].includes(model)) return 'gpt-4-turbo';
  if (OPENAI_MODELS['gpt-4'].includes(model)) return 'gpt-4';
  if (OPENAI_MODELS['gpt-3.5-turbo'].includes(model)) return 'gpt-3.5-turbo';
  return null;
}

/**
 * Check if a model is an OpenAI model
 */
export function isOpenAIModel(model: string): boolean {
  return getOpenAIModelOptions().includes(model);
}

/**
 * Validate OpenAI API key format
 * @param apiKey - The API key to validate
 * @returns Whether the API key appears valid
 */
export function validateOpenAIApiKey(apiKey: string): boolean {
  // OpenAI API keys typically start with 'sk-'
  return apiKey.startsWith('sk-') && apiKey.length > 40;
}

/**
 * Convert OpenAI message format to use in prompts
 * @param messages - OpenAI messages
 * @returns Formatted messages for prompts
 */
export function formatOpenAIMessages(
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; name?: string }>
): OpenAIMessage[] {
  return messages.map(msg => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
  }));
}

/**
 * Check if using Azure OpenAI
 */
export function isAzureOpenAI(): boolean {
  return !!process.env.AZURE_OPENAI_API_KEY || !!process.env.AZURE_OPENAI_ENDPOINT;
}

/**
 * Create Azure OpenAI client configuration
 */
export function getAzureOpenAIConfig(): { apiKey: string; endpoint: string; apiVersion: string } | null {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-02-15-preview';

  if (!apiKey || !endpoint) {
    return null;
  }

  return { apiKey, endpoint, apiVersion };
}

/**
 * Z.ai Provider
 * Issue #45: Integrate Z.ai provider
 * 
 * This module provides Z.ai integration for the Planar Nexus application.
 * Z.ai is an AI provider that offers various language models.
 */

import { AIProviderConfig } from './types';

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
}

/**
 * Default configuration for Z.ai provider
 * Z.ai uses OpenAI-compatible API
 */
export const DEFAULT_ZAI_CONFIG: Partial<ZAIProviderConfig> = {
  model: 'default',
  maxTokens: 8192,
  temperature: 0.7,
  baseURL: 'https://api.z-ai.com/v1',
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
 */
export function createZAIClient(config: ZAIProviderConfig): ZAIProviderConfig {
  const apiKey = config.apiKey || process.env.ZAI_API_KEY;
  
  if (!apiKey) {
    throw new Error(
      'Z.ai API key is required. Set ZAI_API_KEY environment variable or pass it in config.'
    );
  }

  return {
    ...config,
    apiKey,
    baseURL: config.baseURL || process.env.ZAI_BASE_URL || DEFAULT_ZAI_CONFIG.baseURL,
    model: config.model || DEFAULT_ZAI_CONFIG.model,
    maxTokens: config.maxTokens || DEFAULT_ZAI_CONFIG.maxTokens,
    temperature: config.temperature || DEFAULT_ZAI_CONFIG.temperature,
  };
}

/**
 * Send a chat completion request to Z.ai
 * @param config - Provider configuration
 * @param request - Chat request
 * @returns Z.ai chat completion response
 */
export async function sendZAIChat(
  config: ZAIProviderConfig,
  request: Omit<ZAIChatRequest, 'model'>
): Promise<ZAIChatResponse> {
  const client = createZAIClient(config);
  
  const response = await fetch(`${client.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${client.apiKey}`,
    },
    body: JSON.stringify({
      model: client.model,
      max_tokens: client.maxTokens || request.max_tokens,
      temperature: client.temperature || request.temperature,
      messages: request.messages,
      top_p: request.top_p,
      stream: false,
      stop: request.stop,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Z.ai API error: ${response.status} - ${error}`);
  }

  return response.json();
}

/**
 * Send a streaming chat completion request to Z.ai
 * @param config - Provider configuration
 * @param request - Chat request
 * @returns Async iterable for streaming response
 */
export async function* sendZAIChatStream(
  config: ZAIProviderConfig,
  request: Omit<ZAIChatRequest, 'model'>
): AsyncGenerator<string> {
  const client = createZAIClient(config);
  
  const response = await fetch(`${client.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${client.apiKey}`,
    },
    body: JSON.stringify({
      model: client.model,
      max_tokens: client.maxTokens || request.max_tokens,
      temperature: client.temperature || request.temperature,
      messages: request.messages,
      top_p: request.top_p,
      stream: true,
      stop: request.stop,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Z.ai API error: ${response.status} - ${error}`);
  }

  if (!response.body) {
    throw new Error('Z.ai API response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      
      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        return;
      }
      
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          yield content;
        }
      } catch {
        // Skip invalid JSON
      }
    }
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
 * Check if Z.ai is configured and available
 */
export function isZAIAvailable(): boolean {
  return !!process.env.ZAI_API_KEY;
}

/**
 * Get Z.ai provider status
 */
export function getZAIProviderStatus(): { available: boolean; configured: boolean } {
  const hasApiKey = !!process.env.ZAI_API_KEY;
  return {
    available: hasApiKey,
    configured: hasApiKey,
  };
}

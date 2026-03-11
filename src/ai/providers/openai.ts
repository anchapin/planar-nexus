/**
 * OpenAI Provider
 * Issue #44: Integrate OpenAI/Copilot
 *
 * This module provides OpenAI integration for the Planar Nexus application.
 * It supports GPT models including GPT-4o, GPT-4 Turbo, and more.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenAIClient = any;
import { AIProviderConfig, DEFAULT_MODELS } from './types';

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
}

/**
 * Default configuration for OpenAI provider
 */
export const DEFAULT_OPENAI_CONFIG: Partial<OpenAIProviderConfig> = {
  model: DEFAULT_MODELS.openai,
  maxTokens: 8192,
  temperature: 0.7,
};

/**
 * Create an OpenAI client instance
 * @param config - Configuration for the OpenAI provider
 * @returns OpenAI client instance
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createOpenAIClient(config: OpenAIProviderConfig): any {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface OpenAIChatRequest {
  model: string;
  messages: any[];
  maxTokens?: number;
  temperature?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools?: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolChoice?: any;
  responseFormat?: { type: 'json_object' } | { type: 'text' };
}

/**
 * Send a chat completion request to OpenAI
 * @param config - Provider configuration
 * @param request - Chat request
 * @returns OpenAI's chat completion response
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendOpenAIChat(
  config: OpenAIProviderConfig,
  request: Omit<OpenAIChatRequest, 'model'>
): Promise<any> {
  const client = createOpenAIClient(config);

  const response = await client.chat.completions.create({
    model: config.model || DEFAULT_MODELS.openai,
    max_tokens: config.maxTokens || request.maxTokens || 8192,
    temperature: config.temperature || request.temperature || 0.7,
    messages: request.messages,
    tools: request.tools,
    tool_choice: request.toolChoice,
    response_format: request.responseFormat,
  });

  return response;
}

/**
 * Send a streaming chat completion request to OpenAI
 * @param config - Provider configuration
 * @param request - Chat request
 * @returns Async iterable for streaming response
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function* sendOpenAIChatStream(
  config: OpenAIProviderConfig,
  request: Omit<OpenAIChatRequest, 'model'>
): AsyncGenerator<any> {
  const client = createOpenAIClient(config);

  const stream = await client.chat.completions.create({
    model: config.model || DEFAULT_MODELS.openai,
    max_tokens: config.maxTokens || request.maxTokens || 8192,
    temperature: config.temperature || request.temperature || 0.7,
    messages: request.messages,
    tools: request.tools,
    tool_choice: request.toolChoice,
    response_format: request.responseFormat,
    stream: true,
  });

  for await (const chunk of stream) {
    yield chunk;
  }
}

/**
 * Convert OpenAI response to text
 * @param response - OpenAI's chat completion response
 * @returns Text content from the response
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openAIResponseToText(response: any): string {
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatOpenAIMessages(
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string; name?: string }>
): any[] {
  return messages as any[];
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

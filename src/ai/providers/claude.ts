/**
 * Claude AI Provider
 * Issue #43: Integrate Claude API via Anthropic SDK
 * 
 * This module provides Claude (Anthropic) AI integration for the Planar Nexus application.
 * It supports Haiku, Sonnet, and Opus models.
 */

import Anthropic from '@anthropic-ai/sdk';
import { AIProviderConfig, DEFAULT_MODELS } from './types';

/**
 * Claude provider configuration
 */
export interface ClaudeProviderConfig extends AIProviderConfig {
  provider: 'anthropic';
  model?: string;
  apiKey?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Default configuration for Claude provider
 */
export const DEFAULT_CLAUDE_CONFIG: Partial<ClaudeProviderConfig> = {
  model: DEFAULT_MODELS.anthropic,
  maxTokens: 8192,
  temperature: 0.7,
};

/**
 * Create a Claude client instance
 * @param config - Configuration for the Claude provider
 * @returns Anthropic client instance
 */
export function createClaudeClient(config: ClaudeProviderConfig): Anthropic {
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  
  if (!apiKey) {
    throw new Error(
      'Anthropic API key is required. Set ANTHROPIC_API_KEY environment variable or pass it in config.'
    );
  }

  return new Anthropic({
    apiKey,
    maxRetries: 3,
  });
}

/**
 * Claude message request
 */
export interface ClaudeMessageRequest {
  model: string;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  temperature?: number;
  system?: string;
  tools?: Anthropic.Tool[];
}

/**
 * Send a message to Claude
 * @param config - Provider configuration
 * @param request - Message request
 * @returns Claude's response
 */
export async function sendClaudeMessage(
  config: ClaudeProviderConfig,
  request: Omit<ClaudeMessageRequest, 'model'>
): Promise<Anthropic.Message> {
  const client = createClaudeClient(config);
  
  const response = await client.messages.create({
    model: config.model || DEFAULT_MODELS.anthropic,
    max_tokens: config.maxTokens || request.maxTokens || 8192,
    temperature: config.temperature || request.temperature || 0.7,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
  });

  return response;
}

/**
 * Convert Claude response to text
 * @param response - Claude's message response
 * @returns Text content from the response
 */
export function claudeResponseToText(response: Anthropic.Message): string {
  const textContent = response.content.find(
    (block) => block.type === 'text'
  );
  
  if (textContent && textContent.type === 'text') {
    return textContent.text;
  }
  
  return '';
}

/**
 * Claude model options
 */
export const CLAUDE_MODELS = {
  haiku: [
    'claude-3-haiku-20240307',
    'claude-3-5-haiku-20241022',
  ],
  sonnet: [
    'claude-3-sonnet-20240229',
    'claude-3-5-sonnet-20241022',
  ],
  opus: [
    'claude-3-opus-20240229',
    'claude-3-5-opus-20241022',
  ],
};

/**
 * Get all available Claude models
 */
export function getClaudeModelOptions(): string[] {
  return [
    ...CLAUDE_MODELS.haiku,
    ...CLAUDE_MODELS.sonnet,
    ...CLAUDE_MODELS.opus,
  ];
}

/**
 * Check if a model is a Claude model
 */
export function isClaudeModel(model: string): boolean {
  return getClaudeModelOptions().includes(model);
}

/**
 * Get model tier (haiku, sonnet, opus)
 */
export function getClaudeModelTier(model: string): 'haiku' | 'sonnet' | 'opus' | null {
  if (CLAUDE_MODELS.haiku.includes(model)) return 'haiku';
  if (CLAUDE_MODELS.sonnet.includes(model)) return 'sonnet';
  if (CLAUDE_MODELS.opus.includes(model)) return 'opus';
  return null;
}

/**
 * Validate Claude API key format
 * @param apiKey - The API key to validate
 * @returns Whether the API key appears valid
 */
export function validateClaudeApiKey(apiKey: string): boolean {
  // Claude API keys typically start with 'sk-ant-'
  return apiKey.startsWith('sk-ant-');
}

/**
 * Create a streaming message request to Claude
 * @param config - Provider configuration
 * @param request - Message request
 * @returns Async iterable for streaming response
 */
export async function* sendClaudeMessageStream(
  config: ClaudeProviderConfig,
  request: Omit<ClaudeMessageRequest, 'model'>
): AsyncGenerator<Anthropic.MessageStreamEvent> {
  const client = createClaudeClient(config);
  
  const stream = await client.messages.stream({
    model: config.model || DEFAULT_MODELS.anthropic,
    max_tokens: config.maxTokens || request.maxTokens || 8192,
    temperature: config.temperature || request.temperature || 0.7,
    system: request.system,
    messages: request.messages,
    tools: request.tools,
  });

  for await (const event of stream) {
    yield event;
  }
}

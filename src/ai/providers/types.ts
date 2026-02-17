/**
 * AI Provider Types
 * 
 * This file contains shared types for AI providers.
 * Extracted to a separate file to avoid circular dependencies.
 */

/**
 * Supported AI providers
 */
export type AIProvider = 'google' | 'openai' | 'anthropic' | 'zaic' | 'custom';

/**
 * Configuration options for AI providers
 */
export interface AIProviderConfig {
  provider: AIProvider;
  model?: string;
  apiKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Default model configurations
 */
export const DEFAULT_MODELS: Record<string, string> = {
  google: 'gemini-1.5-flash-latest',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-haiku-20240307',
  zaic: 'default',
};

/**
 * Default configurations for each provider
 */
export const DEFAULT_CONFIGS: Record<AIProvider, Partial<AIProviderConfig>> = {
  google: {
    model: DEFAULT_MODELS.google,
    temperature: 0.7,
    maxOutputTokens: 8192,
  },
  openai: {
    model: DEFAULT_MODELS.openai,
    temperature: 0.7,
    maxOutputTokens: 8192,
  },
  anthropic: {
    model: DEFAULT_MODELS.anthropic,
    temperature: 0.7,
    maxOutputTokens: 8192,
  },
  zaic: {
    model: DEFAULT_MODELS.zaic,
    temperature: 0.7,
    maxOutputTokens: 8192,
  },
  custom: {
    model: DEFAULT_MODELS.google,
    temperature: 0.7,
    maxOutputTokens: 8192,
  },
};

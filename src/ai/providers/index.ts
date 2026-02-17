/**
 * AI Provider Abstraction Layer
 * Issue #97: Migrate from hardcoded Gemini-only AI to provider-agnostic architecture
 * 
 * This module provides a unified interface for AI providers,
 * allowing easy switching between different AI backends.
 * 
 * Note: This module intentionally avoids importing genkit to support browser builds.
 * The AI functionality should only be used server-side or with proper fallback handling.
 */

// Re-export Claude, OpenAI and Z.ai providers
export * from './claude';
export * from './openai';
export * from './zaic';

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

/**
 * Current active provider configuration
 */
let currentConfig: AIProviderConfig = {
  provider: 'google',
  ...DEFAULT_CONFIGS.google,
};

/**
 * Get the current provider configuration
 */
export function getProviderConfig(): AIProviderConfig {
  return currentConfig;
}

/**
 * Set the current provider
 */
export function setProvider(provider: AIProvider, model?: string): void {
  currentConfig = {
    provider,
    model: model || DEFAULT_CONFIGS[provider]?.model,
    ...DEFAULT_CONFIGS[provider],
  };
}

/**
 * Get available providers
 */
export function getAvailableProviders(): AIProvider[] {
  return ['google', 'openai', 'anthropic', 'zaic'];
}

/**
 * Google model options (static list)
 */
const GOOGLE_MODELS = [
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro-latest',
  'gemini-2.0-flash-exp',
];

/**
 * Get model options for a specific provider
 */
export function getModelOptions(provider: AIProvider): string[] {
  switch (provider) {
    case 'google':
      return GOOGLE_MODELS;
    case 'openai':
      // Lazy import to avoid bundling issues in browser
      return getOpenAIModelOptionsStatic();
    case 'anthropic':
      // Lazy import to avoid bundling issues in browser
      return getClaudeModelOptionsStatic();
    case 'zaic':
      // Lazy import to avoid bundling issues in browser
      return getZAIModelOptionsStatic();
    case 'custom':
      return [DEFAULT_MODELS.google];
    default:
      return [];
  }
}

/**
 * Get OpenAI model options (statically defined to avoid require)
 */
function getOpenAIModelOptionsStatic(): string[] {
  return [
    'gpt-4o',
    'gpt-4o-2024-05-13',
    'gpt-4o-2024-08-06',
    'gpt-4o-mini',
    'gpt-4o-mini-2024-07-18',
    'gpt-4-turbo',
    'gpt-4-turbo-2024-04-09',
    'gpt-4',
    'gpt-4-0613',
    'gpt-4-32k',
    'gpt-4-32k-0613',
    'gpt-3.5-turbo',
    'gpt-3.5-turbo-0125',
    'gpt-3.5-turbo-1106',
  ];
}

/**
 * Get Claude model options (statically defined to avoid require)
 */
function getClaudeModelOptionsStatic(): string[] {
  return [
    'claude-3-haiku-20240307',
    'claude-3-5-haiku-20241022',
    'claude-3-sonnet-20240229',
    'claude-3-5-sonnet-20241022',
    'claude-3-opus-20240229',
    'claude-3-5-opus-20241022',
  ];
}

/**
 * Get Z.ai model options (statically defined to avoid require)
 */
function getZAIModelOptionsStatic(): string[] {
  return [
    'default',
    'zaiclient-7b',
    'zaiclient-14b',
    'zaiclient-72b',
  ];
}

/**
 * Create a standardized model string for prompts
 * This can be used in prompt templates to make them provider-agnostic
 */
export function getModelString(): string {
  return currentConfig.model || DEFAULT_MODELS[currentConfig.provider] || DEFAULT_MODELS.google;
}

/**
 * Validate provider configuration
 */
export function isValidProvider(provider: string): provider is AIProvider {
  return ['google', 'openai', 'anthropic', 'zaic', 'custom'].includes(provider);
}

/**
 * Get the AI instance - this should only be used in Server Components or with proper environment checks
 * Throws an error if called in browser environment
 */
export function getAI(): never {
  throw new Error(
    'AI functionality is not available in the browser. ' +
    'Use AI features only in Server Actions or API routes.'
  );
}

/**
 * Initialize the AI provider - for server-side use only
 */
export function initializeAIProvider(_config?: Partial<AIProviderConfig>): never {
  throw new Error(
    'AI provider initialization is not available in the browser. ' +
    'Use AI features only in Server Actions or API routes.'
  );
}

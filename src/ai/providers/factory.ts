import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { AIProvider } from './types';

/**
 * Default models for each provider
 */
export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-sonnet-20241022',
  google: 'gemini-1.5-flash-latest',
  zaic: 'gpt-4o-mini',
  custom: 'gpt-4o-mini',
};

/**
 * Factory function to get an AI model instance from Vercel AI SDK
 * 
 * @param provider The AI provider name (openai, anthropic, google, zaic, custom)
 * @param modelId Optional model ID, uses default if not provided
 * @returns A language model instance
 */
export function getAIModel(provider: string, modelId?: string) {
  const normalizedProvider = provider.toLowerCase();
  
  // Handle legacy names or variations
  let mappedProvider = normalizedProvider;
  if (normalizedProvider === 'zaic' || normalizedProvider === 'z-ai') {
    mappedProvider = 'zaic';
  }

  const id = modelId || PROVIDER_DEFAULT_MODELS[mappedProvider];

  if (!id) {
    throw new Error(`Unsupported provider or no default model for: ${provider}`);
  }

  switch (mappedProvider) {
    case 'openai': {
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      return openai(id);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      return anthropic(id);
    }
    case 'google': {
      const google = createGoogleGenerativeAI({
        apiKey: process.env.GOOGLE_AI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });
      return google(id);
    }
    case 'zaic': {
      const zaic = createOpenAI({
        apiKey: process.env.ZAI_API_KEY,
        baseURL: process.env.ZAI_BASE_URL || 'https://api.z-ai.com/v1',
      });
      return zaic(id === 'default' ? PROVIDER_DEFAULT_MODELS.zaic : id);
    }
    case 'custom': {
      const custom = createOpenAI({
        apiKey: process.env.CUSTOM_AI_API_KEY,
        baseURL: process.env.CUSTOM_AI_BASE_URL,
      });
      return custom(id);
    }
    default:
      throw new Error(`AI provider "${provider}" is not yet implemented in the factory.`);
  }
}

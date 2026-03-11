/**
 * AI Provider Types
 *
 * This file contains shared types for AI providers.
 * Extracted to a separate file to avoid circular dependencies.
 *
 * Issue #52: Implement subscription plan linking
 * Issue #565: Enforce strict typing in AI flows and state transitions
 */

/**
 * Supported AI providers
 */
export type AIProvider = 'google' | 'openai' | 'zaic' | 'custom';

/**
 * Subscription tier levels
 */
export type SubscriptionTier = 'free' | 'pro' | 'team' | 'enterprise';

/**
 * Detected subscription plan information
 */
export interface SubscriptionPlan {
  provider: AIProvider;
  tier: SubscriptionTier;
  planName: string;
  detectedAt: number;
  benefits: string[];
  rateLimitMultiplier: number;
  maxTokensMultiplier: number;
}

/**
 * Subscription detection result
 */
export interface SubscriptionDetection {
  detected: boolean;
  plans: SubscriptionPlan[];
  primaryPlan?: SubscriptionPlan;
}

/**
 * AI message role types
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * AI message structure
 */
export interface AIMessage {
  role: MessageRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

/**
 * AI choice structure
 */
export interface AIChoice {
  index: number;
  message: AIMessage;
  finishReason: string | null;
}

/**
 * AI token usage structure
 */
export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * AI response structure
 */
export interface AIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: AIChoice[];
  usage?: AIUsage;
}

/**
 * Configuration options for AI providers
 */
export interface AIProviderConfig {
  provider: AIProvider;
  model?: string;
  apiKey?: string;
  temperature?: number;
  maxOutputTokens?: number;
  subscription?: SubscriptionPlan;
}

/**
 * Tool function parameter schema
 */
export interface ToolFunctionParameters {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Tool function definition
 */
export interface ToolFunction {
  name: string;
  description?: string;
  parameters: ToolFunctionParameters;
}

/**
 * Tool definition for AI calls
 */
export interface AITool {
  type: 'function';
  function: ToolFunction;
}

/**
 * Common request parameters for AI calls
 */
export interface AIRequestOptions {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: { type: 'json_object' } | { type: 'text' };
  tools?: AITool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
}

/**
 * Result of an AI evaluation
 */
export interface AIEvaluationResult {
  score: number;
  reasoning: string;
  recommendations: string[];
}

/**
 * AI prompt template structure
 */
export interface AIPromptTemplate {
  systemPrompt: string;
  userPrompt: string;
  variables?: Record<string, string>;
}

/**
 * AI prompt response structure for game analysis
 */
export interface AIGameAnalysisResponse {
  summary: string;
  keyMoments: string[];
  mistakes: string[];
  strengths: string[];
  improvementAreas: string[];
  recommendations: string[];
}

/**
 * AI prompt response structure for deck analysis
 */
export interface AIDeckAnalysisResponse {
  deckStrengths: string[];
  deckWeaknesses: string[];
  cardSuggestions: Array<{
    cardName: string;
    action: 'add' | 'remove';
    quantity: number;
    reason: string;
  }>;
  matchupAnalysis: Array<{
    archetype: string;
    winRate: number;
    strategy: string;
  }>;
}

/**
 * AI prompt response structure for draft analysis
 */
export interface AIDraftAnalysisResponse {
  recommendedPick: number;
  reasoning: string;
  colorAlignment: {
    primary: string;
    secondary?: string;
  };
  synergies: string[];
  alternativePicks: Array<{
    index: number;
    reason: string;
  }>;
}

/**
 * Type guard to check if a value is a valid AIResponse
 */
export function isAIResponse(value: unknown): value is AIResponse {
  if (typeof value !== 'object' || value === null) return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.id === 'string' &&
    typeof response.object === 'string' &&
    typeof response.created === 'number' &&
    typeof response.model === 'string' &&
    Array.isArray(response.choices)
  );
}

/**
 * Type guard to check if a value is a valid AIMessage
 */
export function isAIMessage(value: unknown): value is AIMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  return (
    (message.role === 'system' ||
      message.role === 'user' ||
      message.role === 'assistant' ||
      message.role === 'tool') &&
    typeof message.content === 'string'
  );
}

/**
 * Type guard to check if a value is a valid AIEvaluationResult
 */
export function isAIEvaluationResult(value: unknown): value is AIEvaluationResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.score === 'number' &&
    typeof result.reasoning === 'string' &&
    Array.isArray(result.recommendations)
  );
}

/**
 * Default model configurations
 */
export const DEFAULT_MODELS: Record<string, string> = {
  google: 'gemini-1.5-flash-latest',
  openai: 'gpt-4o-mini',
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

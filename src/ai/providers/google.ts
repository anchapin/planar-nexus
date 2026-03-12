/**
 * Google AI (Gemini) Provider
 * Issue #522: Implement server-side API key validation and proxy for AI calls
 *
 * This module provides Google AI (Gemini) integration for the Planar Nexus application.
 * It uses the server-side proxy for all API calls to ensure API keys are never exposed.
 */

import { AIProviderConfig } from './types';
import { API_ENDPOINTS } from '@/lib/env';
import { callAIProxy, getProxyErrorMessage } from '@/lib/ai-proxy-client';
import { aiLogger } from '@/lib/logger';

/**
 * Google AI provider configuration
 */
export interface GoogleAIProviderConfig extends AIProviderConfig {
  provider: 'google';
  model?: string;
  apiKey?: string;
  baseURL?: string;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  /** Use server-side proxy (default: true for security) */
  useProxy?: boolean;
}

/**
 * Default configuration for Google AI provider
 */
export const DEFAULT_GOOGLE_AI_CONFIG: Partial<GoogleAIProviderConfig> = {
  model: 'gemini-1.5-flash-latest',
  maxOutputTokens: 8192,
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  baseURL: API_ENDPOINTS.GOOGLE,
  useProxy: true, // Default to proxy for security
};

/**
 * Google AI content part
 */
export interface GoogleAIPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

/**
 * Google AI content
 */
export interface GoogleAIContent {
  parts: GoogleAIPart[];
  role?: 'user' | 'model';
}

/**
 * Google AI message format
 */
export interface GoogleAIMessage {
  role: 'user' | 'model';
  parts: GoogleAIPart[];
}

/**
 * Google AI safety setting
 */
export interface GoogleAISafetySetting {
  category: 'HARM_CATEGORY_HARASSMENT' | 'HARM_CATEGORY_HATE_SPEECH' | 'HARM_CATEGORY_SEXUALLY_EXPLICIT' | 'HARM_CATEGORY_DANGEROUS_CONTENT';
  threshold: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
}

/**
 * Google AI generation config
 */
export interface GoogleAIGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
}

/**
 * Google AI chat completion request
 */
export interface GoogleAIChatRequest {
  contents: GoogleAIContent[];
  generationConfig?: GoogleAIGenerationConfig;
  safetySettings?: GoogleAISafetySetting[];
  systemInstruction?: {
    parts: GoogleAIPart[];
  };
}

/**
 * Google AI chat completion response
 */
export interface GoogleAIChatResponse {
  candidates: {
    content: GoogleAIContent;
    finishReason: 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | 'OTHER';
    index: number;
    safetyRatings?: Array<{
      category: string;
      probability: 'NEGLIGIBLE' | 'LOW' | 'MEDIUM' | 'HIGH';
    }>;
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Create a Google AI client configuration
 * @param config - Configuration for the Google AI provider
 * @returns Configuration object for making API requests
 * @deprecated Use server-side proxy instead.
 */
export function createGoogleAIClient(config: GoogleAIProviderConfig): GoogleAIProviderConfig {
  return {
    ...config,
    baseURL: config.baseURL || DEFAULT_GOOGLE_AI_CONFIG.baseURL,
    model: config.model || DEFAULT_GOOGLE_AI_CONFIG.model,
    maxOutputTokens: config.maxOutputTokens || DEFAULT_GOOGLE_AI_CONFIG.maxOutputTokens,
    temperature: config.temperature || DEFAULT_GOOGLE_AI_CONFIG.temperature,
  };
}

/**
 * Send a chat completion request to Google AI via server-side proxy
 * @param config - Provider configuration
 * @param request - Chat request
 * @returns Google AI chat completion response
 */
export function sendGoogleAIChat(
  config: GoogleAIProviderConfig,
  request: Omit<GoogleAIChatRequest, 'model'>
): Promise<GoogleAIChatResponse> {
  // Use server-side proxy (security best practice)
  return sendGoogleAIChatViaProxy(config, request);
}

/**
 * Send a chat completion request to Google AI via server-side proxy
 */
async function sendGoogleAIChatViaProxy(
  config: GoogleAIProviderConfig,
  request: Omit<GoogleAIChatRequest, 'model'>
): Promise<GoogleAIChatResponse> {
  try {
    const proxyResponse = await callAIProxy<GoogleAIChatResponse>({
      provider: 'google',
      endpoint: `models/${config.model || DEFAULT_GOOGLE_AI_CONFIG.model}:generateContent`,
      model: config.model || DEFAULT_GOOGLE_AI_CONFIG.model,
      body: {
        contents: request.contents,
        generationConfig: {
          maxOutputTokens: config.maxOutputTokens || request.generationConfig?.maxOutputTokens,
          temperature: config.temperature || request.generationConfig?.temperature,
          topP: config.topP || request.generationConfig?.topP,
          topK: config.topK || request.generationConfig?.topK,
          stopSequences: request.generationConfig?.stopSequences,
        },
        safetySettings: request.safetySettings,
        systemInstruction: request.systemInstruction,
      },
    });

    if (!proxyResponse.success) {
      const errorMessage = getProxyErrorMessage(proxyResponse, 'google');
      throw new Error(`Google AI Proxy error: ${errorMessage}`);
    }

    if (!proxyResponse.data) {
      throw new Error('Google AI Proxy returned no data');
    }

    return proxyResponse.data;
  } catch (error) {
    aiLogger.error('Google AI proxy request failed:', error);
    throw error;
  }
}


/**
 * Convert standard messages to Google AI format
 */
export function convertMessagesToGoogleAI(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
): GoogleAIContent[] {
  const contents: GoogleAIContent[] = [];
  let systemInstruction: GoogleAIPart[] | undefined;

  for (const message of messages) {
    if (message.role === 'system') {
      // Google AI uses systemInstruction separately
      systemInstruction = [{ text: message.content }];
    } else if (message.role === 'user') {
      contents.push({
        role: 'user',
        parts: [{ text: message.content }],
      });
    } else if (message.role === 'assistant') {
      contents.push({
        role: 'model',
        parts: [{ text: message.content }],
      });
    }
  }

  return contents;
}

/**
 * Extract text from Google AI response
 */
export function googleAIResponseToText(response: GoogleAIChatResponse): string {
  if (!response.candidates || response.candidates.length === 0) {
    return '';
  }

  const candidate = response.candidates[0];
  const content = candidate.content;

  if (!content.parts || content.parts.length === 0) {
    return '';
  }

  return content.parts.map(part => part.text || '').join('');
}

/**
 * Extract token usage from Google AI response
 */
export function extractGoogleAIUsage(response: GoogleAIChatResponse): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
} | null {
  if (!response.usageMetadata) {
    return null;
  }

  return {
    inputTokens: response.usageMetadata.promptTokenCount || 0,
    outputTokens: response.usageMetadata.candidatesTokenCount || 0,
    totalTokens: response.usageMetadata.totalTokenCount || 0,
  };
}

/**
 * Google AI model options
 */
export const GOOGLE_AI_MODELS = [
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash-002',
  'gemini-1.5-pro-latest',
  'gemini-1.5-pro-001',
  'gemini-1.5-pro-002',
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash',
];

/**
 * Get all available Google AI models
 */
export function getGoogleAIModelOptions(): string[] {
  return [...GOOGLE_AI_MODELS];
}

/**
 * Check if a model is a Google AI model
 */
export function isGoogleAIModel(model: string): boolean {
  return GOOGLE_AI_MODELS.includes(model);
}

/**
 * Validate Google AI API key format
 * @param apiKey - The API key to validate
 * @returns Whether the API key appears valid
 */
export function validateGoogleAIApiKey(apiKey: string): boolean {
  // Google AI keys are typically long alphanumeric strings
  return apiKey.length >= 20 && /^[A-Za-z0-9_-]+$/.test(apiKey);
}

/**
 * Check if Google AI is available (via proxy)
 */
export function isGoogleAIAvailable(): boolean {
  // Availability is determined server-side
  return true;
}

/**
 * Get Google AI provider status
 */
export function getGoogleAIProviderStatus(): { available: boolean; configured: boolean } {
  return {
    available: true,
    configured: true,
  };
}

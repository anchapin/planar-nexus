/**
 * Environment Configuration
 * 
 * Centralized environment variable configuration for API endpoints
 * and other configurable settings.
 */

/**
 * API endpoint URLs with production defaults
 */
export const API_ENDPOINTS = {
  /** Z.ai API base URL */
  ZAI: process.env.NEXT_PUBLIC_ZAI_API_URL || 'https://api.z-ai.com/v1',

  /** OpenAI API base URL */
  OPENAI: process.env.NEXT_PUBLIC_OPENAI_API_URL || 'https://api.openai.com/v1',

  /** Google AI API base URL */
  GOOGLE: process.env.NEXT_PUBLIC_GOOGLE_API_URL || 'https://generativelanguage.googleapis.com/v1',
} as const;

/**
 * Type for API endpoint keys
 */
export type ApiEndpointKey = keyof typeof API_ENDPOINTS;

/**
 * Get an API endpoint URL by key
 * @param key - The API endpoint key
 * @returns The configured URL
 */
export function getApiEndpoint(key: ApiEndpointKey): string {
  return API_ENDPOINTS[key];
}

/**
 * Build a full URL for a specific API
 * @param key - The API endpoint key
 * @param path - The path to append
 * @returns The full URL
 */
export function buildApiUrl(key: ApiEndpointKey, path: string): string {
  const baseUrl = API_ENDPOINTS[key].replace(/\/$/, '');
  const cleanPath = path.replace(/^\//, '');
  return `${baseUrl}/${cleanPath}`;
}

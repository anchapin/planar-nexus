/**
 * Subscription Plan Detection Module
 * Issue #52: Implement subscription plan linking
 *
 * This module provides functionality to detect and manage
 * AI subscription plans from various providers.
 *
 * Supported subscriptions:
 * - Copilot Pro (GitHub/Microsoft)
 * - Gemini Advanced (Google)
 * - Z.ai subscription (Z.ai)
 */

import type {
  AIProvider,
  SubscriptionPlan,
  SubscriptionDetection,
  SubscriptionTier
} from './types';
import { safeFetch, FullResponse, ApiError } from '@/lib/fetch-utils';
import { API_ENDPOINTS } from '@/lib/env';
import { aiLogger } from '@/lib/logger';

// Re-export SubscriptionDetection type for consumers
export type { SubscriptionDetection } from './types';

/**
 * Subscription plan definitions for each provider
 */
const SUBSCRIPTION_PLANS: Record<AIProvider, SubscriptionPlan[]> = {
  openai: [
    {
      provider: 'openai',
      tier: 'pro',
      planName: 'ChatGPT Pro',
      detectedAt: 0,
      benefits: [
        'Unlimited GPT-4 access',
        'Priority access',
        'Advanced voice mode',
        'DALL-E access',
      ],
      rateLimitMultiplier: 10,
      maxTokensMultiplier: 2,
    },
    {
      provider: 'openai',
      tier: 'team',
      planName: 'ChatGPT Team',
      detectedAt: 0,
      benefits: [
        'All Pro benefits',
        'Team workspace',
        'Admin controls',
        'Usage per seat',
      ],
      rateLimitMultiplier: 10,
      maxTokensMultiplier: 4,
    },
    {
      provider: 'openai',
      tier: 'enterprise',
      planName: 'ChatGPT Enterprise',
      detectedAt: 0,
      benefits: [
        'Unlimited access',
        'Custom models',
        'Advanced security',
        'Dedicated support',
        'SLA guarantees',
      ],
      rateLimitMultiplier: 100,
      maxTokensMultiplier: 10,
    },
  ],
  google: [
    {
      provider: 'google',
      tier: 'pro',
      planName: 'Gemini Advanced',
      detectedAt: 0,
      benefits: [
        'Access to Gemini Ultra',
        'Priority access',
        'Extended context',
        'Advanced features',
      ],
      rateLimitMultiplier: 5,
      maxTokensMultiplier: 2,
    },
    {
      provider: 'google',
      tier: 'team',
      planName: 'Google AI Studio Team',
      detectedAt: 0,
      benefits: [
        'All Advanced benefits',
        'Team management',
        'Higher limits',
        'API access',
      ],
      rateLimitMultiplier: 10,
      maxTokensMultiplier: 4,
    },
    {
      provider: 'google',
      tier: 'enterprise',
      planName: 'Google AI Enterprise',
      detectedAt: 0,
      benefits: [
        'Unlimited access',
        'Custom fine-tuning',
        'Dedicated support',
        'SLA guarantees',
      ],
      rateLimitMultiplier: 100,
      maxTokensMultiplier: 10,
    },
  ],
  zaic: [
    {
      provider: 'zaic',
      tier: 'pro',
      planName: 'Z.ai Pro',
      detectedAt: 0,
      benefits: [
        'Higher rate limits',
        'Priority processing',
        'Extended context',
      ],
      rateLimitMultiplier: 5,
      maxTokensMultiplier: 2,
    },
    {
      provider: 'zaic',
      tier: 'team',
      planName: 'Z.ai Team',
      detectedAt: 0,
      benefits: [
        'All Pro benefits',
        'Team workspace',
        'Admin controls',
      ],
      rateLimitMultiplier: 10,
      maxTokensMultiplier: 4,
    },
    {
      provider: 'zaic',
      tier: 'enterprise',
      planName: 'Z.ai Enterprise',
      detectedAt: 0,
      benefits: [
        'Unlimited access',
        'Custom deployments',
        'Dedicated support',
      ],
      rateLimitMultiplier: 100,
      maxTokensMultiplier: 10,
    },
  ],
  anthropic: [
    {
      provider: 'anthropic',
      tier: 'pro',
      planName: 'Claude Pro',
      detectedAt: 0,
      benefits: [
        'Priority access to Claude',
        'Extended context',
        'Higher rate limits',
      ],
      rateLimitMultiplier: 5,
      maxTokensMultiplier: 2,
    },
    {
      provider: 'anthropic',
      tier: 'team',
      planName: 'Claude Team',
      detectedAt: 0,
      benefits: [
        'All Pro benefits',
        'Team workspace',
        'Admin controls',
        'Higher limits',
      ],
      rateLimitMultiplier: 10,
      maxTokensMultiplier: 4,
    },
    {
      provider: 'anthropic',
      tier: 'enterprise',
      planName: 'Claude Enterprise',
      detectedAt: 0,
      benefits: [
        'Unlimited access',
        'Custom fine-tuning',
        'Dedicated support',
        'SLA guarantees',
      ],
      rateLimitMultiplier: 100,
      maxTokensMultiplier: 10,
    },
  ],
  custom: [],
};

/**
 * Storage key for subscription detection results
 */
const STORAGE_KEY = 'planar_nexus_subscription_detection';

/**
 * Detect OpenAI subscription via API key patterns
 */
function detectOpenAISubscription(apiKey: string): SubscriptionPlan | null {
  // OpenAI API keys starting with 'sk-' indicate valid keys
  // Actual subscription detection would require API calls
  if (apiKey.startsWith('sk-')) {
    const plans = SUBSCRIPTION_PLANS.openai;
    // Default to Pro if key is valid (actual detection would be via API)
    const proPlan = plans.find(p => p.tier === 'pro');
    if (proPlan) {
      return {
        ...proPlan,
        detectedAt: Date.now(),
      };
    }
  }
  return null;
}

/**
 * Detect Google AI subscription via API key
 */
function detectGoogleSubscription(apiKey: string): SubscriptionPlan | null {
  // Google AI keys are typically valid if they start with 'AIza'
  if (apiKey.startsWith('AIza')) {
    const plans = SUBSCRIPTION_PLANS.google;
    // Default to Advanced for valid keys
    const proPlan = plans.find(p => p.tier === 'pro');
    if (proPlan) {
      return {
        ...proPlan,
        detectedAt: Date.now(),
      };
    }
  }
  return null;
}

/**
 * Detect Z.ai subscription
 */
function detectZAISubscription(apiKey: string): SubscriptionPlan | null {
  // Z.ai API keys
  if (apiKey.length > 10) {
    const plans = SUBSCRIPTION_PLANS.zaic;
    const proPlan = plans.find(p => p.tier === 'pro');
    if (proPlan) {
      return {
        ...proPlan,
        detectedAt: Date.now(),
      };
    }
  }
  return null;
}

/**
 * Detect subscription for a specific provider based on API key
 */
export function detectSubscription(provider: AIProvider, apiKey: string): SubscriptionPlan | null {
  switch (provider) {
    case 'openai':
      return detectOpenAISubscription(apiKey);
    case 'google':
      return detectGoogleSubscription(apiKey);
    case 'zaic':
      return detectZAISubscription(apiKey);
    default:
      return null;
  }
}

/**
 * Get subscription plans for a provider
 */
export function getSubscriptionPlans(provider: AIProvider): SubscriptionPlan[] {
  return SUBSCRIPTION_PLANS[provider] || [];
}

/**
 * Get all available subscription tiers
 */
export function getSubscriptionTiers(): SubscriptionTier[] {
  return ['free', 'pro', 'team', 'enterprise'];
}

/**
 * Get tier display name
 */
export function getTierDisplayName(tier: SubscriptionTier): string {
  const names: Record<SubscriptionTier, string> = {
    free: 'Free',
    pro: 'Pro',
    team: 'Team',
    enterprise: 'Enterprise',
  };
  return names[tier];
}

/**
 * Get benefits for a subscription tier
 */
export function getTierBenefits(provider: AIProvider, tier: SubscriptionTier): string[] {
  const plans = SUBSCRIPTION_PLANS[provider];
  const plan = plans?.find(p => p.tier === tier);
  return plan?.benefits || [];
}

/**
 * Calculate effective rate limit based on subscription
 */
export function getEffectiveRateLimit(baseLimit: number, subscription?: SubscriptionPlan): number {
  if (!subscription) {
    return baseLimit;
  }
  return Math.floor(baseLimit * subscription.rateLimitMultiplier);
}

/**
 * Calculate effective max tokens based on subscription
 */
export function getEffectiveMaxTokens(baseLimit: number, subscription?: SubscriptionPlan): number {
  if (!subscription) {
    return baseLimit;
  }
  return Math.floor(baseLimit * subscription.maxTokensMultiplier);
}

/**
 * Save subscription detection to storage
 */
export function saveSubscriptionDetection(detection: SubscriptionDetection): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...detection,
      savedAt: Date.now(),
    }));
  } catch (error) {
    aiLogger.error('Failed to save subscription detection:', error);
  }
}

/**
 * Load subscription detection from storage
 */
export function loadSubscriptionDetection(): SubscriptionDetection | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    aiLogger.error('Failed to load subscription detection:', error);
  }
  return null;
}

/**
 * Clear subscription detection from storage
 */
export function clearSubscriptionDetection(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    aiLogger.error('Failed to clear subscription detection:', error);
  }
}

/**
 * Detect all subscriptions based on stored API keys
 * This function checks stored API keys and attempts to detect subscription levels
 */
export async function detectAllSubscriptions(): Promise<SubscriptionDetection> {
  const plans: SubscriptionPlan[] = [];

  // Import dynamically to avoid circular dependencies
  const { getApiKey } = await import('@/lib/api-key-storage');

  const providers: AIProvider[] = ['openai', 'google', 'zaic'];

  for (const provider of providers) {
    try {
      const apiKey = await getApiKey(provider);
      if (apiKey) {
        const subscription = detectSubscription(provider, apiKey);
        if (subscription) {
          plans.push(subscription);
        }
      }
    } catch {
      // Provider may not have a key stored, skip
      aiLogger.debug(`No API key found for ${provider}`);
    }
  }
  
  const detection: SubscriptionDetection = {
    detected: plans.length > 0,
    plans,
    primaryPlan: plans[0],
  };
  
  // Save detection result
  saveSubscriptionDetection(detection);
  
  return detection;
}

/**
 * Validate subscription status by making a test API call
 * This provides more accurate subscription detection
 */
export async function validateSubscription(
  provider: AIProvider,
  apiKey: string
): Promise<{ valid: boolean; subscription?: SubscriptionPlan; error?: string }> {
  try {
    switch (provider) {
      case 'openai': {
        const response = await safeFetch<{ data?: Array<{ owned_by?: string }> }>(
          `${API_ENDPOINTS.OPENAI}/models`,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
            timeoutMs: 10000,
            errorMessage: 'OpenAI subscription validation failed',
          }
        );

        // Check subscription status from response
        // Note: response.data is an array, access first element safely
        const modelsData = response.data;
        const subscription = Array.isArray(modelsData) && modelsData.length > 0
          ? modelsData[0]?.owned_by
          : undefined;

        // Pro/Team detection based on organization
        if (subscription?.includes('org-')) {
          const team = SUBSCRIPTION_PLANS.openai.find(p => p.tier === 'team');
          if (team) {
            return { valid: true, subscription: { ...team, detectedAt: Date.now() } };
          }
        }

        const pro = SUBSCRIPTION_PLANS.openai.find(p => p.tier === 'pro');
        if (pro) {
          return { valid: true, subscription: { ...pro, detectedAt: Date.now() } };
        }
        return { valid: true };
      }

      case 'google': {
        await safeFetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`,
          {
            timeoutMs: 10000,
            errorMessage: 'Google AI subscription validation failed',
          }
        );

        const pro = SUBSCRIPTION_PLANS.google.find(p => p.tier === 'pro');
        if (pro) {
          return { valid: true, subscription: { ...pro, detectedAt: Date.now() } };
        }
        return { valid: true };
      }

      case 'zaic': {
        await safeFetch(
          `${API_ENDPOINTS.ZAI}/models`,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
            },
            timeoutMs: 10000,
            errorMessage: 'Z.ai subscription validation failed',
          }
        );

        const pro = SUBSCRIPTION_PLANS.zaic.find(p => p.tier === 'pro');
        if (pro) {
          return { valid: true, subscription: { ...pro, detectedAt: Date.now() } };
        }
        return { valid: true };
      }

      default:
        return { valid: false, error: 'Unknown provider' };
    }
  } catch (error) {
    const errorMessage = error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'Network error';
    return {
      valid: false,
      error: errorMessage,
    };
  }
}

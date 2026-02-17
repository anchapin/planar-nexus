/**
 * Subscription Plan Detection Module
 * Issue #52: Implement subscription plan linking
 * 
 * This module provides functionality to detect and manage
 * AI subscription plans from various providers.
 * 
 * Supported subscriptions:
 * - Claude Pro/Claude Team (Anthropic)
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

/**
 * Subscription plan definitions for each provider
 */
const SUBSCRIPTION_PLANS: Record<AIProvider, SubscriptionPlan[]> = {
  anthropic: [
    {
      provider: 'anthropic',
      tier: 'pro',
      planName: 'Claude Pro',
      detectedAt: 0,
      benefits: [
        'Higher rate limits',
        'Priority access to new models',
        'Extended context windows',
        'Early access to beta features',
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
        'Higher usage limits',
        'Admin controls',
        'Usage analytics',
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
        'All Team benefits',
        'Unlimited requests',
        'Custom integrations',
        'Dedicated support',
        'SLA guarantees',
      ],
      rateLimitMultiplier: 100,
      maxTokensMultiplier: 10,
    },
  ],
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
  custom: [],
};

/**
 * Storage key for subscription detection results
 */
const STORAGE_KEY = 'planar_nexus_subscription_detection';

/**
 * Detect Claude subscription via API key metadata
 * This is a best-effort detection based on API key patterns
 */
function detectAnthropicSubscription(apiKey: string): SubscriptionPlan | null {
  // Anthropic API keys starting with 'sk-ant-' followed by specific patterns
  // may indicate subscription level. This is heuristic-based.
  if (apiKey.startsWith('sk-ant-')) {
    // Return Pro tier as default for valid keys
    const plans = SUBSCRIPTION_PLANS.anthropic;
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
    case 'anthropic':
      return detectAnthropicSubscription(apiKey);
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
    console.error('Failed to save subscription detection:', error);
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
    console.error('Failed to load subscription detection:', error);
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
    console.error('Failed to clear subscription detection:', error);
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
  
  const providers: AIProvider[] = ['anthropic', 'openai', 'google', 'zaic'];
  
  for (const provider of providers) {
    try {
      const apiKey = await getApiKey(provider);
      if (apiKey) {
        const subscription = detectSubscription(provider, apiKey);
        if (subscription) {
          plans.push(subscription);
        }
      }
    } catch (error) {
      // Provider may not have a key stored, skip
      console.debug(`No API key found for ${provider}`);
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
      case 'anthropic': {
        // Make a minimal API call to validate key and check subscription
        const response = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        });
        
        if (!response.ok) {
          return { valid: false, error: 'Invalid API key' };
        }
        
        // Check rate limit headers for subscription tier indication
        const rateLimit = response.headers.get('x-ratelimit-limit');
        if (rateLimit) {
          const limit = parseInt(rateLimit, 10);
          if (limit >= 100) {
            const enterprise = SUBSCRIPTION_PLANS.anthropic.find(p => p.tier === 'enterprise');
            if (enterprise) {
              return { valid: true, subscription: { ...enterprise, detectedAt: Date.now() } };
            }
          } else if (limit >= 50) {
            const team = SUBSCRIPTION_PLANS.anthropic.find(p => p.tier === 'team');
            if (team) {
              return { valid: true, subscription: { ...team, detectedAt: Date.now() } };
            }
          }
        }
        
        // Default to Pro for valid keys
        const pro = SUBSCRIPTION_PLANS.anthropic.find(p => p.tier === 'pro');
        if (pro) {
          return { valid: true, subscription: { ...pro, detectedAt: Date.now() } };
        }
        return { valid: true };
      }
      
      case 'openai': {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });
        
        if (!response.ok) {
          return { valid: false, error: 'Invalid API key' };
        }
        
        // Check subscription status from response
        const data = await response.json();
        const subscription = data.data?.[0]?.owned_by;
        
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
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
        );
        
        if (!response.ok) {
          return { valid: false, error: 'Invalid API key' };
        }
        
        const pro = SUBSCRIPTION_PLANS.google.find(p => p.tier === 'pro');
        if (pro) {
          return { valid: true, subscription: { ...pro, detectedAt: Date.now() } };
        }
        return { valid: true };
      }
      
      case 'zaic': {
        const response = await fetch('https://api.z-ai.com/v1/models', {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });
        
        if (!response.ok) {
          return { valid: false, error: 'Invalid API key' };
        }
        
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
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

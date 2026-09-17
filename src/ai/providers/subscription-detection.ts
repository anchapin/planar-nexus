/**
 * Subscription Plan Definitions (issue #52)
 *
 * #1799 — the client-side subscription detection surface (the
 * `detectSubscription` / `validateSubscription` / `detectAllSubscriptions`
 * family) used the user's API key to call provider APIs directly. That
 * approach is gone: provider keys now live server-side at /api/ai-proxy
 * (issue #522) and the client never sees the plaintext key.
 *
 * This module retains the static plan catalog and the pure helpers that
 * compute effective rate-limit / max-token multipliers from a
 * `SubscriptionPlan`. Live subscription-tier detection requires
 * server-side API calls and is filed as a follow-up — tracked under
 * the persistence of issue #1799 (server-side subscription tier
 * detection, future scope).
 */

import type { AIProvider, SubscriptionPlan, SubscriptionTier } from "./types";

// Re-export SubscriptionDetection type for consumers
export type { SubscriptionDetection } from "./types";

/**
 * Subscription plan definitions for each provider
 */
const SUBSCRIPTION_PLANS: Record<AIProvider, SubscriptionPlan[]> = {
  openai: [
    {
      provider: "openai",
      tier: "free",
      planName: "OpenAI Free",
      detectedAt: 0,
      benefits: ["Basic GPT access", "Standard rate limits"],
      rateLimitMultiplier: 1,
      maxTokensMultiplier: 1,
    },
    {
      provider: "openai",
      tier: "pro",
      planName: "OpenAI Pro",
      detectedAt: 0,
      benefits: [
        "Priority access to GPT-4",
        "Higher rate limits",
        "Extended context",
      ],
      rateLimitMultiplier: 5,
      maxTokensMultiplier: 2,
    },
    {
      provider: "openai",
      tier: "team",
      planName: "OpenAI Team",
      detectedAt: 0,
      benefits: [
        "All Pro benefits",
        "Team workspace",
        "Admin controls",
        "Shared billing",
      ],
      rateLimitMultiplier: 10,
      maxTokensMultiplier: 4,
    },
    {
      provider: "openai",
      tier: "enterprise",
      planName: "OpenAI Enterprise",
      detectedAt: 0,
      benefits: [
        "Unlimited GPT-4 access",
        "Custom rate limits",
        "Dedicated support",
        "SLA guarantees",
      ],
      rateLimitMultiplier: 100,
      maxTokensMultiplier: 10,
    },
  ],
  google: [
    {
      provider: "google",
      tier: "free",
      planName: "Gemini Free",
      detectedAt: 0,
      benefits: ["Basic Gemini access", "Standard rate limits"],
      rateLimitMultiplier: 1,
      maxTokensMultiplier: 1,
    },
    {
      provider: "google",
      tier: "pro",
      planName: "Gemini Advanced",
      detectedAt: 0,
      benefits: [
        "Access to Gemini Ultra",
        "Higher rate limits",
        "Extended context window",
      ],
      rateLimitMultiplier: 5,
      maxTokensMultiplier: 2,
    },
    {
      provider: "google",
      tier: "team",
      planName: "Gemini Team",
      detectedAt: 0,
      benefits: ["All Advanced benefits", "Team workspace", "Admin controls"],
      rateLimitMultiplier: 10,
      maxTokensMultiplier: 4,
    },
    {
      provider: "google",
      tier: "enterprise",
      planName: "Gemini Enterprise",
      detectedAt: 0,
      benefits: ["Custom rate limits", "Dedicated support", "SLA guarantees"],
      rateLimitMultiplier: 100,
      maxTokensMultiplier: 10,
    },
  ],
  zaic: [
    {
      provider: "zaic",
      tier: "free",
      planName: "Z.ai Free",
      detectedAt: 0,
      benefits: ["Basic Z.ai access", "Standard rate limits"],
      rateLimitMultiplier: 1,
      maxTokensMultiplier: 1,
    },
    {
      provider: "zaic",
      tier: "pro",
      planName: "Z.ai Pro",
      detectedAt: 0,
      benefits: ["Priority access", "Higher rate limits", "Extended features"],
      rateLimitMultiplier: 5,
      maxTokensMultiplier: 2,
    },
    {
      provider: "zaic",
      tier: "team",
      planName: "Z.ai Team",
      detectedAt: 0,
      benefits: ["All Pro benefits", "Team workspace", "Admin controls"],
      rateLimitMultiplier: 10,
      maxTokensMultiplier: 4,
    },
  ],
  anthropic: [
    {
      provider: "anthropic",
      tier: "pro",
      planName: "Claude Pro",
      detectedAt: 0,
      benefits: [
        "Priority access to Claude",
        "Extended context",
        "Higher rate limits",
      ],
      rateLimitMultiplier: 5,
      maxTokensMultiplier: 2,
    },
    {
      provider: "anthropic",
      tier: "team",
      planName: "Claude Team",
      detectedAt: 0,
      benefits: [
        "All Pro benefits",
        "Team workspace",
        "Admin controls",
        "Higher limits",
      ],
      rateLimitMultiplier: 10,
      maxTokensMultiplier: 4,
    },
    {
      provider: "anthropic",
      tier: "enterprise",
      planName: "Claude Enterprise",
      detectedAt: 0,
      benefits: [
        "Unlimited access",
        "Custom fine-tuning",
        "Dedicated support",
        "SLA guarantees",
      ],
      rateLimitMultiplier: 100,
      maxTokensMultiplier: 10,
    },
  ],
  custom: [],
};

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
  return ["free", "pro", "team", "enterprise"];
}

/**
 * Get tier display name
 */
export function getTierDisplayName(tier: SubscriptionTier): string {
  const names: Record<SubscriptionTier, string> = {
    free: "Free",
    pro: "Pro",
    team: "Team",
    enterprise: "Enterprise",
  };
  return names[tier];
}

/**
 * Get benefits for a subscription tier
 */
export function getTierBenefits(
  provider: AIProvider,
  tier: SubscriptionTier,
): string[] {
  const plans = SUBSCRIPTION_PLANS[provider];
  const plan = plans?.find((p) => p.tier === tier);
  return plan?.benefits || [];
}

/**
 * Calculate effective rate limit based on subscription
 */
export function getEffectiveRateLimit(
  baseLimit: number,
  subscription?: SubscriptionPlan,
): number {
  if (!subscription) {
    return baseLimit;
  }
  return Math.floor(baseLimit * subscription.rateLimitMultiplier);
}

/**
 * Calculate effective max tokens based on subscription
 */
export function getEffectiveMaxTokens(
  baseLimit: number,
  subscription?: SubscriptionPlan,
): number {
  if (!subscription) {
    return baseLimit;
  }
  return Math.floor(baseLimit * subscription.maxTokensMultiplier);
}

/**
 * Subscription Plan Display Component
 * Issue #293: Add subscription plan linking for AI providers
 * 
 * This component displays subscription plan information for AI providers,
 * including plan limits, features, and usage tracking integration.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, X, Loader2, Crown, Users, Building, Sparkles, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type { AIProvider, SubscriptionPlan, SubscriptionTier } from "@/ai/providers/types";
import {
  detectSubscription,
  getSubscriptionPlans,
  getTierDisplayName,
  getEffectiveRateLimit,
  getEffectiveMaxTokens,
  validateSubscription,
  detectAllSubscriptions,
  type SubscriptionDetection,
} from "@/ai/providers/subscription-detection";
import { getApiKey, hasApiKey } from "@/lib/api-key-storage";
import { getProviderUsageStats, formatTokens, formatCost } from "@/lib/usage-tracking";

/**
 * Provider display names
 */
const PROVIDER_NAMES: Record<AIProvider, string> = {
  google: "Google AI (Gemini)",
  openai: "OpenAI",
  anthropic: "Anthropic (Claude)",
  zaic: "Z.ai",
  custom: "Custom Provider",
};

/**
 * Tier icons
 */
const TIER_ICONS: Record<SubscriptionTier, React.ReactNode> = {
  free: <Sparkles className="h-4 w-4" />,
  pro: <Crown className="h-4 w-4" />,
  team: <Users className="h-4 w-4" />,
  enterprise: <Building className="h-4 w-4" />,
};

/**
 * Tier colors
 */
const TIER_COLORS: Record<SubscriptionTier, string> = {
  free: "bg-gray-500",
  pro: "bg-blue-500",
  team: "bg-purple-500",
  enterprise: "bg-amber-500",
};

/**
 * Base rate limits per provider (requests per minute for free tier)
 */
const BASE_RATE_LIMITS: Record<AIProvider, number> = {
  google: 15,
  openai: 3,
  anthropic: 5,
  zaic: 10,
  custom: 10,
};

/**
 * Base max tokens per provider (for free tier)
 */
const BASE_MAX_TOKENS: Record<AIProvider, number> = {
  google: 8192,
  openai: 4096,
  anthropic: 4096,
  zaic: 8192,
  custom: 8192,
};

/**
 * Props for SubscriptionPlanCard
 */
interface SubscriptionPlanCardProps {
  provider: AIProvider;
  onSubscriptionDetected?: (plan: SubscriptionPlan | null) => void;
}

/**
 * Individual subscription plan card for a provider
 */
function SubscriptionPlanCard({ provider, onSubscriptionDetected }: SubscriptionPlanCardProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionPlan | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageStats, setUsageStats] = useState<{
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
  } | null>(null);

  const checkKeyAndSubscription = useCallback(async () => {
    const keyExists = await hasApiKey(provider);
    setHasKey(keyExists);
    
    if (keyExists) {
      // Load usage stats
      const stats = getProviderUsageStats(provider);
      setUsageStats({
        totalRequests: stats.totalRequests,
        totalTokens: stats.totalTokens,
        totalCost: stats.totalCost,
      });
    }
  }, [provider]);

  useEffect(() => {
    checkKeyAndSubscription();
  }, [checkKeyAndSubscription]);

  async function handleDetectSubscription() {
    setIsLoading(true);
    setError(null);

    try {
      const apiKey = await getApiKey(provider);
      if (!apiKey) {
        setError("No API key configured for this provider");
        return;
      }

      const result = await validateSubscription(provider, apiKey);
      
      if (result.valid && result.subscription) {
        setSubscription(result.subscription);
        onSubscriptionDetected?.(result.subscription);
      } else if (result.valid) {
        // Key is valid but no specific subscription detected
        const detected = detectSubscription(provider, apiKey);
        setSubscription(detected);
        onSubscriptionDetected?.(detected);
      } else {
        setError(result.error || "Failed to validate subscription");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  const availablePlans = getSubscriptionPlans(provider);
  const effectiveRateLimit = subscription 
    ? getEffectiveRateLimit(BASE_RATE_LIMITS[provider], subscription)
    : BASE_RATE_LIMITS[provider];
  const effectiveMaxTokens = subscription
    ? getEffectiveMaxTokens(BASE_MAX_TOKENS[provider], subscription)
    : BASE_MAX_TOKENS[provider];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-lg">{PROVIDER_NAMES[provider]}</CardTitle>
          <CardDescription>
            {subscription ? (
              <span className="flex items-center gap-1">
                {TIER_ICONS[subscription.tier]}
                {subscription.planName}
              </span>
            ) : hasKey ? (
              "API key configured"
            ) : (
              "No API key configured"
            )}
          </CardDescription>
        </div>
        {subscription && (
          <Badge className={`${TIER_COLORS[subscription.tier]} text-white`}>
            {getTierDisplayName(subscription.tier)}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Error display */}
        {error && (
          <Alert variant="destructive">
            <X className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Subscription detection button */}
        {hasKey && !subscription && (
          <Button
            onClick={handleDetectSubscription}
            disabled={isLoading}
            variant="outline"
            className="w-full"
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Detect Subscription
          </Button>
        )}

        {/* Current plan info */}
        {subscription && (
          <div className="space-y-3">
            <div className="text-sm font-medium">Current Plan Benefits</div>
            <ul className="space-y-1">
              {subscription.benefits.map((benefit, index) => (
                <li key={index} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-3 w-3 text-green-500" />
                  {benefit}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Rate limits display */}
        <Separator />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-muted-foreground">Rate Limit</div>
            <div className="text-lg font-semibold">
              {effectiveRateLimit} req/min
            </div>
            {subscription && (
              <div className="text-xs text-muted-foreground">
                {subscription.rateLimitMultiplier}x multiplier
              </div>
            )}
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Max Tokens</div>
            <div className="text-lg font-semibold">
              {formatTokens(effectiveMaxTokens)}
            </div>
            {subscription && (
              <div className="text-xs text-muted-foreground">
                {subscription.maxTokensMultiplier}x multiplier
              </div>
            )}
          </div>
        </div>

        {/* Usage stats */}
        {usageStats && usageStats.totalRequests > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="text-sm font-medium">Your Usage</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-semibold">{usageStats.totalRequests}</div>
                  <div className="text-xs text-muted-foreground">Requests</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{formatTokens(usageStats.totalTokens)}</div>
                  <div className="text-xs text-muted-foreground">Tokens</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{formatCost(usageStats.totalCost)}</div>
                  <div className="text-xs text-muted-foreground">Est. Cost</div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Available plans */}
        {!subscription && availablePlans.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="text-sm font-medium">Available Plans</div>
              <div className="space-y-2">
                {availablePlans.map((plan) => (
                  <div
                    key={plan.tier}
                    className="flex items-center justify-between p-2 rounded-lg border"
                  >
                    <div className="flex items-center gap-2">
                      {TIER_ICONS[plan.tier]}
                      <span className="font-medium">{plan.planName}</span>
                    </div>
                    <Badge variant="outline" className={TIER_COLORS[plan.tier]}>
                      {plan.rateLimitMultiplier}x limits
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* No key message */}
        {!hasKey && (
          <Alert>
            <AlertDescription>
              Add an API key in the API Keys tab to detect your subscription plan.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Props for SubscriptionPlanDisplay
 */
interface SubscriptionPlanDisplayProps {
  onAllDetected?: (detection: SubscriptionDetection) => void;
}

/**
 * Main component for displaying subscription plans for all providers
 */
export function SubscriptionPlanDisplay({ onAllDetected }: SubscriptionPlanDisplayProps) {
  const [isDetectingAll, setIsDetectingAll] = useState(false);
  const [detection, setDetection] = useState<SubscriptionDetection | null>(null);

  const providers: AIProvider[] = ["google", "openai", "anthropic", "zaic"];

  async function handleDetectAll() {
    setIsDetectingAll(true);
    try {
      const result = await detectAllSubscriptions();
      setDetection(result);
      onAllDetected?.(result);
    } finally {
      setIsDetectingAll(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header with detect all button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Subscription Plans</h2>
          <p className="text-muted-foreground">
            Link your AI provider subscriptions for enhanced features
          </p>
        </div>
        <Button onClick={handleDetectAll} disabled={isDetectingAll}>
          {isDetectingAll ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Detect All Subscriptions
        </Button>
      </div>

      {/* Summary */}
      {detection && (
        <Alert>
          <Check className="h-4 w-4" />
          <AlertTitle>Detection Complete</AlertTitle>
          <AlertDescription>
            Detected {detection.plans.length} subscription(s) across your configured providers.
            {detection.primaryPlan && (
              <span className="block mt-1">
                Primary: {detection.primaryPlan.planName} ({PROVIDER_NAMES[detection.primaryPlan.provider as AIProvider]})
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Provider cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map((provider) => (
          <SubscriptionPlanCard
            key={provider}
            provider={provider}
          />
        ))}
      </div>

      {/* Info about subscription linking */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">About Subscription Linking</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Subscription linking allows Planar Nexus to optimize your AI experience by:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Adjusting rate limits based on your plan</li>
            <li>Enabling higher token limits for better responses</li>
            <li>Providing accurate usage tracking and cost estimates</li>
            <li>Unlocking provider-specific features</li>
          </ul>
          <p className="mt-2">
            Your subscription information is stored locally and never sent to our servers.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default SubscriptionPlanDisplay;
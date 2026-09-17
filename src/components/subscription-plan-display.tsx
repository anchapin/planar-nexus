/**
 * Subscription Plan Display Component
 * Issue #293: Add subscription plan linking for AI providers
 *
 * #1799 — this component no longer reads the user's API key (that local
 * vault was deprecated as of #1799 because its AES key derivation used
 * a recoverable constant + window.location.origin). "Configured on
 * server" is now queried via the AI proxy client (`getProxyStatus()`)
 * — the proxy enumerates which providers the operator has configured
 * server-side, which is the operational equivalent of "has key" in the
 * user's mental model.
 *
 * The "Detect subscription" surface (which used the user's key to call
 * provider APIs directly) is removed; live tier detection requires a
 * server-side endpoint tracked as a follow-up to #1799.
 *
 * @see https://github.com/anchapin/planar-nexus/issues/1799
 */

"use client";

import { useState, useEffect } from "react";
import { Check, Crown, Users, Building, Sparkles, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import type {
  AIProvider,
  SubscriptionPlan,
  SubscriptionTier,
} from "@/ai/providers/types";
import {
  getSubscriptionPlans,
  getEffectiveRateLimit,
  getEffectiveMaxTokens,
} from "@/ai/providers/subscription-detection";
import {
  getProviderUsageStats,
  formatTokens,
  formatCost,
} from "@/lib/usage-tracking";
import {
  getProxyStatus,
  type ProxyStatusResponse,
} from "@/lib/ai-proxy-client";

/**
 * Provider display names
 */
const PROVIDER_NAMES: Record<AIProvider, string> = {
  google: "Google AI",
  openai: "OpenAI",
  zaic: "Z.ai",
  anthropic: "Anthropic",
  custom: "Custom Provider",
};

/**
 * Icon mapping for tiers
 */
const TIER_ICONS: Record<SubscriptionTier, React.ReactNode> = {
  free: <Sparkles className="h-4 w-4" />,
  pro: <Crown className="h-4 w-4" />,
  team: <Users className="h-4 w-4" />,
  enterprise: <Building className="h-4 w-4" />,
};

/**
 * Base rate limits per provider (requests per minute for free tier)
 */
const BASE_RATE_LIMITS: Record<AIProvider, number> = {
  google: 60,
  openai: 60,
  zaic: 60,
  anthropic: 60,
  custom: 60,
};

/**
 * Base max tokens per provider (for free tier)
 */
const BASE_MAX_TOKENS: Record<AIProvider, number> = {
  google: 8192,
  openai: 8192,
  zaic: 8192,
  anthropic: 8192,
  custom: 8192,
};

interface SubscriptionPlanCardProps {
  provider: AIProvider;
  /** Whether the operator has configured this provider server-side. */
  configured: boolean | null;
  onSubscriptionDetected?: (plan: SubscriptionPlan | null) => void;
}

/**
 * Individual subscription plan card for a provider.
 *
 * #1799 — the "configured" prop is now sourced from
 * `getProxyStatus()` (server-side enumeration of operators with
 * configured keys), not from the local-storage vault. The card
 * renders the static plan catalog when the operator has not yet
 * configured the provider, so users know what options will become
 * active once they do.
 */
function SubscriptionPlanCard({
  provider,
  configured,
  onSubscriptionDetected,
}: SubscriptionPlanCardProps) {
  const [usageStats, setUsageStats] = useState<{
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
  } | null>(null);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void (async () => {
      try {
        const stats = await getProviderUsageStats(provider);
        if (!cancelled) {
          setUsageStats({
            totalRequests: stats.totalRequests,
            totalTokens: stats.totalTokens,
            totalCost: stats.totalCost,
          });
        }
      } catch (error) {
        console.error("Failed to load provider usage stats:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configured, provider]);

  const availablePlans = getSubscriptionPlans(provider);
  const effectiveRateLimit = getEffectiveRateLimit(
    BASE_RATE_LIMITS[provider],
    undefined,
  );
  const effectiveMaxTokens = getEffectiveMaxTokens(
    BASE_MAX_TOKENS[provider],
    undefined,
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-lg">{PROVIDER_NAMES[provider]}</CardTitle>
          <CardDescription>
            <span className="text-muted-foreground">
              No active subscription detected
            </span>
          </CardDescription>
        </div>
        <Badge variant={configured ? "default" : "secondary"}>
          {configured === null
            ? "Checking..."
            : configured
              ? "Server Configured"
              : "Not Configured"}
        </Badge>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* #1799 — live tier detection previously called provider APIs
            directly with the user's key. That surface is removed; live
            tier detection requires a server-side endpoint and is
            tracked as a follow-up. Until then, the static plan catalog
            below shows what options the operator can configure. */}
        {availablePlans.length > 0 && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Tier detection moved server-side</AlertTitle>
            <AlertDescription>
              Live subscription-tier detection requires server-side API access
              (issue #1799 follow-up). Until then, the static plan catalog below
              is shown so users know what options the operator can configure.
            </AlertDescription>
          </Alert>
        )}

        {/* Available plans (static catalog) */}
        {availablePlans.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-medium text-sm">Available Plans</h4>
            <div className="grid gap-2">
              {availablePlans.map((plan) => (
                <div
                  key={`${plan.provider}-${plan.tier}`}
                  className="flex items-start justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      {TIER_ICONS[plan.tier]}
                      <span className="font-medium">{plan.planName}</span>
                      <Badge variant="outline" className="text-xs">
                        {plan.tier}
                      </Badge>
                    </div>
                    <ul className="mt-1 text-sm text-muted-foreground space-y-0.5">
                      {plan.benefits.slice(0, 3).map((benefit, idx) => (
                        <li key={idx}>• {benefit}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Usage stats (only when configured) */}
        {usageStats && configured && (
          <div className="grid grid-cols-3 gap-2 text-sm">
            <div>
              <div className="text-muted-foreground">Requests</div>
              <div className="font-medium">{usageStats.totalRequests}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Tokens</div>
              <div className="font-medium">
                {formatTokens(usageStats.totalTokens)}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Est. cost</div>
              <div className="font-medium">
                {formatCost(usageStats.totalCost)}
              </div>
            </div>
          </div>
        )}

        <Separator />

        {/* Effective limits summary */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-muted-foreground">Effective rate limit</div>
            <div className="font-medium">{effectiveRateLimit} req/min</div>
          </div>
          <div>
            <div className="text-muted-foreground">Effective max tokens</div>
            <div className="font-medium">
              {effectiveMaxTokens.toLocaleString()}
            </div>
          </div>
        </div>

        <Button
          variant="default"
          size="sm"
          className="w-full"
          onClick={() => onSubscriptionDetected?.(null)}
        >
          <Check className="mr-2 h-4 w-4" />
          Apply Plan Configuration
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Subscription Plan Display
 */
export function SubscriptionPlanDisplay() {
  const providers: AIProvider[] = ["google", "openai", "zaic"];
  const [proxyStatus, setProxyStatus] = useState<ProxyStatusResponse | null>(
    null,
  );

  // #1799 — fetch the proxy status ONCE on mount, derive the
  // configured-state boolean for every provider from the result. Using
  // the proxy client (rather than per-provider raw fetch calls) avoids
  // N round-trips for the summary view and satisfies the project's
  // no-restricted-syntax lint guard.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const status = await getProxyStatus();
        if (!cancelled) setProxyStatus(status);
      } catch (error) {
        console.error("Failed to load proxy status:", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const configuredProviders = proxyStatus?.configuredProviders ?? null;
  const isConfigured = (provider: AIProvider): boolean | null => {
    if (configuredProviders === null) return null;
    return configuredProviders.includes(provider);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Subscription Plans</h2>
          <p className="text-muted-foreground">
            Link your AI provider subscriptions for enhanced features
          </p>
        </div>
      </div>

      {/* #1799 — server-side configured-state summary. Replaces the old
          "Detect All Subscriptions" button (which used to iterate over
          locally-stored keys and call provider APIs directly). The
          proxy status response enumerates operator-configured providers
          in a single round-trip. */}
      <ConfiguredProvidersSummary configuredProviders={configuredProviders} />

      {/* Provider cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map((provider) => (
          <SubscriptionPlanCard
            key={provider}
            provider={provider}
            configured={isConfigured(provider)}
          />
        ))}
      </div>

      {/* Info about subscription linking */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            About Subscription Linking
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Provider API keys live on the server (configured by the operator via
            environment variables). Tier detection and rate-limit negotiation
            are increasingly performed server-side; client-side direct API
            access is no longer required.
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Server reports which providers are configured</li>
            <li>
              The static plan catalog here shows what options the operator can
              enable
            </li>
            <li>
              Effective rate limits and max tokens apply once the operator
              configures a key
            </li>
            <li>
              Live subscription-tier detection is a tracked follow-up to issue
              #1799
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Inline helper: render the summary of configured providers based on the
 * already-fetched proxy status. Kept as a stateless component so the
 * parent owns the data fetch (single round-trip).
 */
function ConfiguredProvidersSummary({
  configuredProviders,
}: {
  configuredProviders: AIProvider[] | null;
}) {
  if (configuredProviders === null) {
    return null;
  }
  if (configuredProviders.length === 0) {
    return (
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>No providers configured server-side</AlertTitle>
        <AlertDescription>
          The operator has not yet configured any AI provider API keys. Once a
          provider is configured, its plan catalog below becomes active.
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <Alert>
      <Check className="h-4 w-4" />
      <AlertTitle>Active providers</AlertTitle>
      <AlertDescription>
        {configuredProviders.length} provider
        {configuredProviders.length === 1 ? "" : "s"} configured server-side:{" "}
        {configuredProviders.map((p) => PROVIDER_NAMES[p]).join(", ")}.
      </AlertDescription>
    </Alert>
  );
}

export default SubscriptionPlanDisplay;

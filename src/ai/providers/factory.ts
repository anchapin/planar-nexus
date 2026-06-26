import type { AIProvider } from "./types";

/**
 * Default models for each provider
 */
export const PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  google: "gemini-1.5-flash-latest",
  zaic: "gpt-4o-mini",
  custom: "gpt-4o-mini",
};

/**
 * Factory function to get an AI model instance from Vercel AI SDK.
 *
 * Uses dynamic `import()` for each provider SDK so the heavy `@ai-sdk/*`
 * packages are never bundled until a provider is actually requested.
 * This keeps AI dependencies out of the initial bundle (Issue #1022).
 *
 * @param provider The AI provider name (openai, anthropic, google, zaic, custom)
 * @param modelId Optional model ID, uses default if not provided
 * @returns A language model instance
 */
export async function getAIModel(provider: string, modelId?: string) {
  const normalizedProvider = provider.toLowerCase();

  // Handle legacy names or variations
  let mappedProvider = normalizedProvider;
  if (normalizedProvider === "zaic" || normalizedProvider === "z-ai") {
    mappedProvider = "zaic";
  }

  const id = modelId || PROVIDER_DEFAULT_MODELS[mappedProvider];

  if (!id) {
    throw new Error(
      `Unsupported provider or no default model for: ${provider}`,
    );
  }

  switch (mappedProvider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const openai = createOpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      return openai(id);
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      const anthropic = createAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      return anthropic(id);
    }
    case "google": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      const google = createGoogleGenerativeAI({
        apiKey:
          process.env.GOOGLE_AI_API_KEY ||
          process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      });
      return google(id);
    }
    case "zaic": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const zaic = createOpenAI({
        apiKey: process.env.ZAI_API_KEY,
        baseURL: process.env.ZAI_BASE_URL || "https://api.z-ai.com/v1",
      });
      return zaic(id === "default" ? PROVIDER_DEFAULT_MODELS.zaic : id);
    }
    case "custom": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      const custom = createOpenAI({
        apiKey: process.env.CUSTOM_AI_API_KEY,
        baseURL: process.env.CUSTOM_AI_BASE_URL,
      });
      return custom(id);
    }
    default:
      throw new Error(
        `AI provider "${provider}" is not yet implemented in the factory.`,
      );
  }
}

/**
 * Whether a provider string is recognized by the factory.
 * Kept synchronous so callers can validate before awaiting `getAIModel`.
 */
export function isSupportedProvider(provider: string): provider is AIProvider {
  const normalized = provider.toLowerCase();
  return ["openai", "anthropic", "google", "zaic", "z-ai", "custom"].includes(
    normalized,
  );
}

/**
 * Environment variable that carries the API key for each provider.
 * Used by {@link isProviderConfigured} so the streaming failover layer can
 * skip providers that have no credentials configured without making a doomed
 * network request first (issue #1077).
 */
export const PROVIDER_ENV_VARS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_AI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  zaic: ["ZAI_API_KEY"],
  custom: ["CUSTOM_AI_API_KEY"],
};

/**
 * Whether a provider has at least one API-key environment variable set.
 * Synchronous and side-effect free so it is safe to call while building a
 * provider failover chain.
 */
export function isProviderConfigured(provider: string): boolean {
  const normalized =
    provider.toLowerCase() === "z-ai" ? "zaic" : provider.toLowerCase();
  const envVars = PROVIDER_ENV_VARS[normalized];
  if (!envVars) return false;
  return envVars.some((name) => {
    const value = process.env[name];
    return typeof value === "string" && value.trim().length > 0;
  });
}

/**
 * Default order in which providers are attempted for the conversational coach
 * (issue #1077). The first provider whose credentials are configured leads;
 * unconfigured providers are still kept at the tail so an explicit user choice
 * is always honored even when we cannot detect a key at request time.
 */
export const DEFAULT_PROVIDER_ORDER: AIProvider[] = [
  "openai",
  "anthropic",
  "google",
  "zaic",
];

function normalizeProviderName(provider: string): string {
  return provider.toLowerCase() === "z-ai" ? "zaic" : provider.toLowerCase();
}

/**
 * Build an ordered provider failover chain (issue #1077).
 *
 * - If `primary` is given, it leads, followed by the remaining default-order
 *   providers (deduped). This guarantees the user's explicit choice is tried
 *   first while still failing over transparently on error.
 * - Otherwise the {@link DEFAULT_PROVIDER_ORDER} is returned.
 *
 * The chain is provider *names* (strings), not model instances, so it stays
 * cheap to compute and easy to unit-test. Consumers resolve each entry via
 * {@link getAIModel} lazily.
 */
export function getProviderFailoverChain(primary?: string | null): string[] {
  if (!primary) {
    return [...DEFAULT_PROVIDER_ORDER];
  }

  const head = normalizeProviderName(primary);
  const tail = DEFAULT_PROVIDER_ORDER.filter((p) => p !== head);
  // 'custom' is not in DEFAULT_PROVIDER_ORDER; still lead with it when asked.
  return [head, ...tail];
}

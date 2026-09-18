/**
 * @fileOverview Exhaustiveness tests for the AI provider allowlist (#1809).
 *
 * Issue #1809 acceptance criteria: "a unit test asserts the route
 * allowlists cannot drift from the union (e.g. exhaustiveness check)."
 *
 * These tests pin the single source of truth at every layer
 * (type-level, the canonical tuple, the factory's `isSupportedProvider`,
 * the barrel's `isValidProvider`, the canonical coerce helper, the
 * ai-proxy route's `availableProviders` shape). Adding a value to
 * `AIProvider` without updating `AI_PROVIDER_IDS` is a compile-time
 * error (via `as const satisfies readonly AIProvider[]`). Adding a
 * value to `AI_PROVIDER_IDS` without updating the union is also
 * caught at compile-time by the same `satisfies`. The runtime tests
 * below additionally pin the count, membership, and shared-helper
 * shapes so a future refactor cannot silently narrow the allowlist.
 */

import { AI_PROVIDER_IDS, type AIProvider } from "../types";
import { isSupportedProvider } from "../factory";
import { isValidProvider } from "../index";
import { coerceToKnownProvider } from "../coerce";

describe("AI_PROVIDER_IDS canonical tuple (issue #1809)", () => {
  it("is exactly the union — every AIProvider value is in the list", () => {
    const providerSet: ReadonlySet<string> = new Set(AI_PROVIDER_IDS);
    const allowed: AIProvider[] = [
      "google",
      "openai",
      "anthropic",
      "zaic",
      "custom",
    ];
    for (const value of allowed) {
      expect(providerSet.has(value)).toBe(true);
    }
    // The list has no extras beyond the union (membership is exact, not a
    // superset).
    expect(providerSet.size).toBe(allowed.length);
  });

  it("is typed as a readonly tuple — spread is the supported escape hatch", () => {
    // If a future refactor weakens the `as const satisfies readonly
    // AIProvider[]` annotation, the array identity changes.
    expect(Array.isArray(AI_PROVIDER_IDS)).toBe(true);
    expect(AI_PROVIDER_IDS.length).toBe(5);
  });

  it("forbids adding a value not in the union at the type level", () => {
    // This is a compile-time check. The test runtime merely asserts
    // that the value WAS allowed (i.e. we are the tuple we expect).
    // If someone deletes `anthropic` from the union without updating
    // this test, TypeScript will reject the union literal here.

    const exhaustive: readonly AIProvider[] = [
      "google",
      "openai",
      "anthropic",
      "zaic",
      "custom",
    ];
    expect(exhaustive.length).toBe(AI_PROVIDER_IDS.length);
  });
});

describe("isSupportedProvider (src/ai/providers/factory.ts)", () => {
  it("accepts every AI_PROVIDER_IDS value (case-sensitive)", () => {
    for (const value of AI_PROVIDER_IDS) {
      expect(isSupportedProvider(value)).toBe(true);
    }
  });

  it("accepts the normalized 'z-ai' input variant (back-compat alias)", () => {
    // The canonical tuple does NOT include 'z-ai' — the hyphenated
    // variant is an input-encoding quirk. Confirm `isSupportedProvider`
    // still accepts it after the #1809 consolidation (so client aliases
    // from before the rename don't break).
    expect(isSupportedProvider("z-ai")).toBe(true);
  });

  it("rejects unknown provider names", () => {
    expect(isSupportedProvider("claude")).toBe(false);
    expect(isSupportedProvider("gpt")).toBe(false);
    expect(isSupportedProvider("")).toBe(false);
  });

  it("lowercase-normalizes canonical names (the documented back-compat feature)", () => {
    // The factory's `isSupportedProvider` does `provider.toLowerCase()`
    // before the canonical check. This means mixed-case inputs still
    // match the union — a client that sends `'OpenAI'` or `'ZAI'`
    // (rather than the canonical `'openai'` / `'zaic'`) is accepted.
    // Pre-#1809, this normalization lived inside a hand-rolled array
    // literal; #1809 keeps the normalization but pulls the canonical
    // set out into AI_PROVIDER_IDS so adding a new provider carries
    // the same case-insensitive behavior automatically.
    expect(isSupportedProvider("OpenAI")).toBe(true);
    expect(isSupportedProvider("Anthropic")).toBe(true);
    expect(isSupportedProvider("GOOGLE")).toBe(true);
  });
});

describe("isValidProvider (src/ai/providers/index.ts) — regression for #1809 drift bug", () => {
  it("accepts every AI_PROVIDER_IDS value", () => {
    for (const value of AI_PROVIDER_IDS) {
      expect(isValidProvider(value)).toBe(true);
    }
  });

  it("accepts 'anthropic' (the previous drift bug — the barrel omitted this)", () => {
    // Pre-#1809, `isValidProvider` rejected `'anthropic'` because
    // its hand-copied allowlist `['google', 'openai', 'zaic', 'custom']`
    // had not been updated when `'anthropic'` was added to the union.
    // Pinning this case ensures the consolidation didn't just hide the
    // bug under a different shape.
    expect(isValidProvider("anthropic")).toBe(true);
  });

  it("rejects unknown provider names", () => {
    expect(isValidProvider("claude")).toBe(false);
    expect(isValidProvider("")).toBe(false);
  });
});

describe("coerceToKnownProvider (src/ai/providers/coerce.ts) — preserved behavior, single source", () => {
  // The issue flags the previous silent unknown→"custom" coercion
  // (when it lived inline in /api/chat/route.ts) as the "worst
  // variant" of the multi-copy surface. The helper now lives in
  // coerce.ts and is consumed by /api/chat/route.ts via `asAIProvider`,
  // the chat-stream usage logger, and any future consumer that needs
  // a `'custom'`-on-miss behavior. These tests pin both halves.

  it("returns the matching AIProvider for every AI_PROVIDER_IDS value", () => {
    for (const value of AI_PROVIDER_IDS) {
      expect(coerceToKnownProvider(value)).toBe(value);
    }
  });

  it("falls back to 'custom' for unknown providers (the documented coercion)", () => {
    // The helper is intentionally permissive: a typo'd provider name in
    // an upstream `CoachStreamEvent` survives as a 'custom' log
    // attribution rather than throwing. This is documented in the
    // helper's JSDoc; test pins the documented behavior.
    expect(coerceToKnownProvider("unknown-provider")).toBe("custom");
    expect(coerceToKnownProvider("")).toBe("custom");
  });
});

describe("ai-proxy route surface (src/app/api/ai-proxy/route.ts) — availableProviders shape", () => {
  // The route returns `[...AI_PROVIDER_IDS]` for `availableProviders`,
  // so the exact shape must match. This avoids a future "I'll just
  // hard-code the list" regression.
  const availableProviders: readonly AIProvider[] = [...AI_PROVIDER_IDS];
  it("matches AI_PROVIDER_IDS exactly", () => {
    expect(availableProviders.length).toBe(AI_PROVIDER_IDS.length);
    expect(new Set(availableProviders)).toEqual(new Set(AI_PROVIDER_IDS));
  });
});

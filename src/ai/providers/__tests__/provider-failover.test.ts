/**
 * @fileoverview Tests for the provider failover chain + config detection
 * added to the AI provider factory (issue #1077).
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  getProviderFailoverChain,
  isProviderConfigured,
  DEFAULT_PROVIDER_ORDER,
  PROVIDER_ENV_VARS,
} from "../factory";

describe("getProviderFailoverChain", () => {
  it("returns the default order when no primary is given", () => {
    expect(getProviderFailoverChain()).toEqual([
      "openai",
      "anthropic",
      "google",
      "zaic",
    ]);
    expect(getProviderFailoverChain(undefined)).toEqual(DEFAULT_PROVIDER_ORDER);
    expect(getProviderFailoverChain(null)).toEqual(DEFAULT_PROVIDER_ORDER);
    expect(getProviderFailoverChain("")).toEqual(DEFAULT_PROVIDER_ORDER);
  });

  it("places an explicit primary first, keeping the rest of the order", () => {
    expect(getProviderFailoverChain("anthropic")).toEqual([
      "anthropic",
      "openai",
      "google",
      "zaic",
    ]);
  });

  it("does not duplicate the primary in the tail", () => {
    const chain = getProviderFailoverChain("openai");
    expect(chain[0]).toBe("openai");
    expect(chain.filter((p) => p === "openai")).toHaveLength(1);
    expect(chain).toHaveLength(DEFAULT_PROVIDER_ORDER.length);
  });

  it("normalizes legacy 'z-ai' to 'zaic'", () => {
    const chain = getProviderFailoverChain("z-ai");
    expect(chain[0]).toBe("zaic");
    expect(chain).toContain("openai");
  });

  it("leads with a custom/unknown primary and still appends the defaults", () => {
    const chain = getProviderFailoverChain("custom");
    expect(chain[0]).toBe("custom");
    expect(chain.slice(1)).toEqual([...DEFAULT_PROVIDER_ORDER]);
  });
});

describe("isProviderConfigured", () => {
  const envKeys = [
    ...PROVIDER_ENV_VARS.openai,
    ...PROVIDER_ENV_VARS.anthropic,
    ...PROVIDER_ENV_VARS.google,
    ...PROVIDER_ENV_VARS.zaic,
    ...PROVIDER_ENV_VARS.custom,
  ];

  const original: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of envKeys) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("returns false when no key env var is set", () => {
    expect(isProviderConfigured("openai")).toBe(false);
    expect(isProviderConfigured("anthropic")).toBe(false);
  });

  it("returns true when the provider key env var is set", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(isProviderConfigured("openai")).toBe(true);
  });

  it("treats whitespace-only keys as unconfigured", () => {
    process.env.OPENAI_API_KEY = "   ";
    expect(isProviderConfigured("openai")).toBe(false);
  });

  it("accepts either google key alias", () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "g-test";
    expect(isProviderConfigured("google")).toBe(true);
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    process.env.GOOGLE_AI_API_KEY = "g-test-2";
    expect(isProviderConfigured("google")).toBe(true);
  });

  it("normalizes 'z-ai'", () => {
    process.env.ZAI_API_KEY = "z-test";
    expect(isProviderConfigured("z-ai")).toBe(true);
    expect(isProviderConfigured("zaic")).toBe(true);
  });

  it("returns false for an unknown provider", () => {
    expect(isProviderConfigured("does-not-exist")).toBe(false);
  });
});

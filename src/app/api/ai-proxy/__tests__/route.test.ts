/**
 * @fileoverview Tests for the AI proxy route handler (issue #1260).
 *
 * Covers the canonical matrix for `POST /api/ai-proxy`:
 *   - 200 (happy path, both streaming and non-streaming)
 *   - 400 (invalid JSON body, invalid/missing provider)
 *   - 429 (rate limit exceeded)
 *   - 500 (internal / upstream failure)
 *   - 503 (provider not configured on server)
 *
 * The `GET` surface is tested separately to cover the status/info endpoint.
 *
 * All heavy external dependencies are mocked so no real provider key is
 * required and tests run without network access.
 *
 * @jest-environment node
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

import type { NextRequest } from "next/server";

// ---- Mocks (must be declared before importing the route) ---------------------

const streamText = jest.fn() as unknown as jest.Mock<any>;
const generateText = jest.fn() as unknown as jest.Mock<any>;
jest.mock("ai", () => ({
  streamText: (...args: unknown[]) => streamText(...args),
  generateText: (...args: unknown[]) => generateText(...args),
}));

const getAIModel = jest.fn() as unknown as jest.Mock<any>;
jest.mock("@/ai/providers/factory", () => ({
  getAIModel: (...args: unknown[]) => getAIModel(...args),
}));

const searchCardsTool = { description: "mocked search tool" };
jest.mock("@/ai/tools/card-search", () => ({
  searchCardsTool,
}));

const getProviderConfig = jest.fn() as unknown as jest.Mock<any>;
const getConfiguredProviders = jest.fn() as unknown as jest.Mock<any>;
jest.mock("@/lib/server-api-key-storage", () => ({
  getProviderConfig: (...args: unknown[]) => getProviderConfig(...args),
  getConfiguredProviders: (...args: unknown[]) =>
    getConfiguredProviders(...args),
}));

const enforceRateLimit = jest.fn() as unknown as jest.Mock<any>;
class RateLimitError extends Error {
  public readonly retryAfter: number;
  public readonly remaining: number;
  public readonly code = "RATE_LIMIT_EXCEEDED";
  constructor(
    message: string,
    retryAfterMs: number,
    remainingRequests: number,
  ) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfterMs;
    this.remaining = remainingRequests;
  }
}
const getRateLimitHeaders: jest.Mock = jest.fn(
  (result: any) =>
    ({
      "X-RateLimit-Limit": "100",
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(result.resetAt),
    }) as Record<string, string>,
);
jest.mock("@/lib/server-rate-limiter", () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimit(...args),
  RateLimitError,
  getRateLimitHeaders: (...args: unknown[]) => getRateLimitHeaders(...args),
}));

const saveMock = jest.fn() as unknown as jest.Mock<any>;
class MockUsageLogger {
  entry: Record<string, unknown> = {};
  constructor(
    public userId: string,
    public provider: string,
    public endpoint: string,
  ) {
    this.entry = { userId, provider, endpoint, success: false };
  }
  setModel(model: string) {
    this.entry.model = model;
    return this;
  }
  setTokenUsage(input: number, output: number) {
    this.entry.tokensUsed = { input, output, total: input + output };
    return this;
  }
  setMetadata(metadata: Record<string, unknown>) {
    this.entry.metadata = metadata;
    return this;
  }
  setClientInfo(ipAddress?: string, userAgent?: string) {
    if (ipAddress) this.entry.ipAddress = ipAddress;
    if (userAgent) this.entry.userAgent = userAgent;
    return this;
  }
  markSuccess() {
    this.entry.success = true;
    return this;
  }
  markFailure(error: string, errorCode?: string) {
    this.entry.success = false;
    this.entry.error = error;
    this.entry.errorCode = errorCode;
    return this;
  }
  async save() {
    await saveMock();
  }
}
jest.mock("@/lib/server-usage-logger", () => ({
  UsageLogger: MockUsageLogger,
}));

// ---- Functional fetch stand-ins --------------------------------------------
// jest.setup.js installs minimal jsdom-flavoured Request/Response stand-ins
// that don't expose the .json() body parser or Response.json() factory. We
// swap in functional versions for this suite (the coach route does the same).
// NextResponse.json() resolves `Response.json()` at call time, so a module-
// level assignment is sufficient.

class TestRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: BodyInit | null;
  constructor(url: string, init: RequestInit = {}) {
    this.url = url;
    this.method = init.method || "GET";
    this.headers = init.headers
      ? new Headers(init.headers as HeadersInit)
      : new Headers();
    this.body = init.body ?? null;
  }
  async json(): Promise<unknown> {
    return JSON.parse(typeof this.body === "string" ? this.body : "");
  }
  async text(): Promise<string> {
    return typeof this.body === "string" ? this.body : "";
  }
}

// A Response polyfill with both static .json() (so NextResponse.json works) and
// instance .text() / .json() (so tests can read the body back).
class TestResponse {
  readonly body: unknown;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  constructor(body?: unknown, init: ResponseInit = {}) {
    this.body = body ?? null;
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? "OK";
    this.headers = init.headers
      ? new Headers(init.headers as HeadersInit)
      : new Headers();
  }
  static json(data: unknown, init: ResponseInit = {}): TestResponse {
    return new TestResponse(JSON.stringify(data), {
      status: init.status,
      statusText: init.statusText,
      headers: {
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });
  }
  async text(): Promise<string> {
    if (typeof this.body === "string") return this.body;
    if (this.body == null) return "";
    return String(this.body);
  }
  async json(): Promise<unknown> {
    const text = await this.text();
    if (!text) return null;
    return JSON.parse(text);
  }
}

(globalThis as unknown as { Response: unknown }).Response = TestResponse;
(globalThis as unknown as { Request: unknown }).Request = TestRequest;

// Imported AFTER mocks so the route handler picks them up.
import { GET, POST } from "../route";

type RouteRequest = Parameters<typeof POST>[0];

function makeRequest(
  body: unknown | string,
  url = "http://localhost/api/ai-proxy",
  extraHeaders: Record<string, string> = {},
): RouteRequest {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...extraHeaders,
    },
  };
  if (typeof body === "string") {
    init.body = body;
  } else {
    init.body = JSON.stringify(body);
  }
  return new TestRequest(url, init) as unknown as RouteRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  // Re-prime mocks after clearAllMocks (jest.fn() implementations are reset).
  getAIModel.mockResolvedValue({ modelId: "mocked-model" });
  getRateLimitHeaders.mockImplementation(
    (result: any) =>
      ({
        "X-RateLimit-Limit": "100",
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.resetAt),
      }) as Record<string, string>,
  );
  getConfiguredProviders.mockReturnValue(["openai"]);
  saveMock.mockResolvedValue(undefined);
});

// ----------------------------------------------------------------------------
// GET /api/ai-proxy
// ----------------------------------------------------------------------------

describe("GET /api/ai-proxy", () => {
  it("returns the default running banner with configured providers", async () => {
    getConfiguredProviders.mockReturnValue(["openai", "google"]);
    const req = {
      url: "http://localhost/api/ai-proxy",
    } as unknown as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.success).toBe(true);
    expect(data.configuredProviders).toEqual(["openai", "google"]);
    expect(data.message).toContain("Vercel AI SDK");
  });

  it("returns the explicit status payload when ?action=status", async () => {
    getConfiguredProviders.mockReturnValue(["openai"]);
    const req = {
      url: "http://localhost/api/ai-proxy?action=status",
    } as unknown as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.success).toBe(true);
    expect(data.serverProxyEnabled).toBe(true);
    expect(data.availableProviders).toEqual(
      expect.arrayContaining([
        "google",
        "openai",
        "anthropic",
        "zaic",
        "custom",
      ]),
    );
  });

  it("wraps unexpected errors in a 500 response", async () => {
    getConfiguredProviders.mockImplementation(() => {
      throw new Error("boom");
    });
    const req = {
      url: "http://localhost/api/ai-proxy",
    } as unknown as NextRequest;
    const res = await GET(req);
    expect(res.status).toBe(500);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.success).toBe(false);
    expect(data.error).toBe("boom");
  });
});

// ----------------------------------------------------------------------------
// POST /api/ai-proxy — request validation
// ----------------------------------------------------------------------------

describe("POST /api/ai-proxy — request validation", () => {
  it("rejects invalid JSON with 400", async () => {
    const res = await POST(makeRequest("{ not json"));
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("INVALID_JSON");
  });

  it("rejects a missing provider with 400", async () => {
    const res = await POST(makeRequest({ endpoint: "x", body: {} }));
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("INVALID_PROVIDER");
  });

  it("rejects an unknown provider with 400", async () => {
    const res = await POST(
      makeRequest({ provider: "not-real", endpoint: "x", body: {} }),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("INVALID_PROVIDER");
  });
});

// ----------------------------------------------------------------------------
// POST /api/ai-proxy — provider not configured
// ----------------------------------------------------------------------------

describe("POST /api/ai-proxy — provider not configured", () => {
  it("returns 503 when the provider is not configured on the server", async () => {
    getProviderConfig.mockReturnValue(null);

    const res = await POST(
      makeRequest({
        provider: "openai",
        endpoint: "/chat",
        model: "gpt-4o-mini",
        body: { messages: [{ role: "user", content: "hi" }] },
        userId: "alice",
      }),
    );

    expect(res.status).toBe(503);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("PROVIDER_NOT_CONFIGURED");
    expect(saveMock).toHaveBeenCalled(); // failure logged
  });

  it("returns 503 when the provider config is disabled", async () => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-test",
      enabled: false,
      rateLimit: { maxRequests: 100, windowMs: 60_000 },
    });

    const res = await POST(
      makeRequest({
        provider: "openai",
        endpoint: "/chat",
        body: { messages: [] },
      }),
    );

    expect(res.status).toBe(503);
  });
});

// ----------------------------------------------------------------------------
// POST /api/ai-proxy — rate limiting
// ----------------------------------------------------------------------------

describe("POST /api/ai-proxy — rate limiting", () => {
  it("returns 429 with rate-limit headers when the limiter throws", async () => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-test",
      enabled: true,
      rateLimit: { maxRequests: 100, windowMs: 60_000 },
    });
    enforceRateLimit.mockImplementation(() => {
      throw new RateLimitError("Too many requests", 30, 0);
    });

    const res = await POST(
      makeRequest({
        provider: "openai",
        endpoint: "/chat",
        body: { messages: [{ role: "user", content: "hi" }] },
      }),
    );

    expect(res.status).toBe(429);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.retryAfter).toBe(30);
    // Verify the route forwarded a rate-limit result to the header helper
    // (the body itself is the authoritative contract surfaced to clients).
    expect(getRateLimitHeaders).toHaveBeenCalled();
  });

  it("uses x-forwarded-for as the client identifier only behind a trusted proxy", async () => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-test",
      enabled: true,
      rateLimit: { maxRequests: 100, windowMs: 60_000 },
    });
    enforceRateLimit.mockReturnValue({
      success: true,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    generateText.mockResolvedValue({
      text: "hello",
      finishReason: "stop",
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });

    const prev = process.env.TRUSTED_PROXY;
    process.env.TRUSTED_PROXY = "true";
    try {
      await POST(
        makeRequest(
          {
            provider: "openai",
            endpoint: "/chat",
            body: { messages: [{ role: "user", content: "hi" }] },
          },
          "http://localhost/api/ai-proxy",
          { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
        ),
      );
      expect(enforceRateLimit).toHaveBeenCalledWith(
        "ip:203.0.113.5",
        expect.any(Object),
      );
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_PROXY;
      else process.env.TRUSTED_PROXY = prev;
    }
  });
});

// ----------------------------------------------------------------------------
// POST /api/ai-proxy — happy paths
// ----------------------------------------------------------------------------

describe("POST /api/ai-proxy — happy path (non-streaming)", () => {
  beforeEach(() => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-test",
      enabled: true,
      rateLimit: { maxRequests: 100, windowMs: 60_000 },
    });
    enforceRateLimit.mockReturnValue({
      success: true,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    generateText.mockResolvedValue({
      text: "Hello there",
      finishReason: "stop",
      usage: Promise.resolve({ inputTokens: 12, outputTokens: 7 }),
    });
  });

  it("returns the legacy OpenAI-shaped success payload", async () => {
    const res = await POST(
      makeRequest({
        provider: "openai",
        endpoint: "/chat",
        model: "gpt-4o-mini",
        body: { messages: [{ role: "user", content: "hi" }] },
        userId: "alice",
      }),
    );

    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.success).toBe(true);
    expect(data.data.choices[0].message.role).toBe("assistant");
    expect(data.data.choices[0].message.content).toBe("Hello there");
    expect(data.data.usage.total_tokens).toBe(19);
    expect(data.usage.totalTokens).toBe(19);
    expect(data.rateLimit.remaining).toBe(99);
    expect(saveMock).toHaveBeenCalled();
  });

  it("falls back to 'session:<ua>' client identifier when no IP is present", async () => {
    await POST(
      makeRequest(
        {
          provider: "openai",
          endpoint: "/chat",
          body: { messages: [] },
        },
        "http://localhost/api/ai-proxy",
        { "user-agent": "Mozilla/5.0" },
      ),
    );
    expect(enforceRateLimit).toHaveBeenCalledWith(
      expect.stringMatching(/^session:Mozilla\/5\.0/),
      expect.any(Object),
    );
  });
});

describe("POST /api/ai-proxy — happy path (streaming)", () => {
  beforeEach(() => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-test",
      enabled: true,
      rateLimit: { maxRequests: 100, windowMs: 60_000 },
    });
    enforceRateLimit.mockReturnValue({
      success: true,
      remaining: 50,
      resetAt: Date.now() + 60_000,
    });
    // streamText returns an object with toTextStreamResponse
    streamText.mockReturnValue({
      toTextStreamResponse: () => new TestResponse("ok", { status: 200 }),
    });
  });

  it("returns a text stream response when stream=true", async () => {
    const res = (await POST(
      makeRequest({
        provider: "openai",
        endpoint: "/chat",
        body: {
          messages: [{ role: "user", content: "hi" }],
          stream: true,
        },
      }),
    )) as unknown as TestResponse;

    expect(res.status).toBe(200);
    expect(streamText).toHaveBeenCalled();
    const text = await res.text();
    expect(text).toBe("ok");
  });
});

// ----------------------------------------------------------------------------
// POST /api/ai-proxy — 500 fallthrough
// ----------------------------------------------------------------------------

describe("POST /api/ai-proxy — internal errors", () => {
  it("returns 500 when an unexpected exception escapes the handler", async () => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-test",
      enabled: true,
      rateLimit: { maxRequests: 100, windowMs: 60_000 },
    });
    enforceRateLimit.mockReturnValue({
      success: true,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    getAIModel.mockRejectedValue(new Error("sdk exploded"));

    const res = await POST(
      makeRequest({
        provider: "openai",
        endpoint: "/chat",
        body: { messages: [] },
      }),
    );

    expect(res.status).toBe(500);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("INTERNAL_ERROR");
    expect(data.error).toBe("sdk exploded");
  });
});

// ----------------------------------------------------------------------------
// POST /api/ai-proxy — Issue #1393: do not trust client-supplied userId
// ----------------------------------------------------------------------------

describe("POST /api/ai-proxy — userId trust (Issue #1393)", () => {
  beforeEach(() => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-test",
      enabled: true,
      rateLimit: { maxRequests: 100, windowMs: 60_000 },
    });
    enforceRateLimit.mockReturnValue({
      success: true,
      remaining: 99,
      resetAt: Date.now() + 60_000,
    });
    generateText.mockResolvedValue({
      text: "ok",
      finishReason: "stop",
      usage: Promise.resolve({ inputTokens: 1, outputTokens: 1 }),
    });
  });

  it("ignores a rotating body userId — all requests map to ONE rate-limit key", async () => {
    // An attacker sending userId: "bot-1", "bot-2", … from the same source
    // must NOT get a fresh bucket per request.
    for (let i = 1; i <= 50; i++) {
      await POST(
        makeRequest(
          {
            provider: "openai",
            endpoint: "/chat",
            body: { messages: [{ role: "user", content: "hi" }] },
            userId: `bot-${i}`,
          },
          "http://localhost/api/ai-proxy",
          { "user-agent": "attacker/1.0" },
        ),
      );
    }

    // Every call used the same UA-derived key (no request.ip in the test
    // harness, no TRUSTED_PROXY), so there must be exactly one distinct key.
    const keys = new Set(enforceRateLimit.mock.calls.map((c: any[]) => c[0]));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toMatch(/^session:/);
    // None of the keys are the attacker-controlled "user:bot-N".
    expect([...keys][0]).not.toContain("bot");
  });

  it("does not propagate body userId into the rate-limit key", async () => {
    await POST(
      makeRequest({
        provider: "openai",
        endpoint: "/chat",
        body: { messages: [] },
        userId: "attacker-123",
      }),
    );
    const key = enforceRateLimit.mock.calls[0][0] as string;
    expect(key).not.toContain("attacker-123");
    expect(key.startsWith("user:")).toBe(false);
  });

  it("ignores x-forwarded-for when TRUSTED_PROXY is not set", async () => {
    const prev = process.env.TRUSTED_PROXY;
    delete process.env.TRUSTED_PROXY;
    try {
      await POST(
        makeRequest(
          {
            provider: "openai",
            endpoint: "/chat",
            body: { messages: [] },
          },
          "http://localhost/api/ai-proxy",
          {
            "x-forwarded-for": "198.51.100.7",
            "user-agent": "curl/8.0",
          },
        ),
      );
      const key = enforceRateLimit.mock.calls[0][0] as string;
      // The spoofable XFF value must not appear in the bucket key.
      expect(key).not.toContain("198.51.100.7");
      expect(key.startsWith("ip:")).toBe(false);
      expect(key.startsWith("session:")).toBe(true);
    } finally {
      if (prev !== undefined) process.env.TRUSTED_PROXY = prev;
    }
  });

  it("honors x-forwarded-for when TRUSTED_PROXY=true is set", async () => {
    const prev = process.env.TRUSTED_PROXY;
    process.env.TRUSTED_PROXY = "true";
    try {
      await POST(
        makeRequest(
          {
            provider: "openai",
            endpoint: "/chat",
            body: { messages: [] },
          },
          "http://localhost/api/ai-proxy",
          { "x-forwarded-for": "203.0.113.9" },
        ),
      );
      expect(enforceRateLimit).toHaveBeenCalledWith(
        "ip:203.0.113.9",
        expect.any(Object),
      );
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_PROXY;
      else process.env.TRUSTED_PROXY = prev;
    }
  });

  it("prefers request.ip over forwarded headers when present", async () => {
    const prev = process.env.TRUSTED_PROXY;
    process.env.TRUSTED_PROXY = "true";
    try {
      const req = makeRequest(
        {
          provider: "openai",
          endpoint: "/chat",
          body: { messages: [] },
        },
        "http://localhost/api/ai-proxy",
        { "x-forwarded-for": "203.0.113.9" },
      );
      // Simulate Next.js runtime setting the verified peer IP.
      (req as unknown as { ip: string }).ip = "100.64.0.1";
      await POST(req);
      expect(enforceRateLimit).toHaveBeenCalledWith(
        "ip:100.64.0.1",
        expect.any(Object),
      );
    } finally {
      if (prev === undefined) delete process.env.TRUSTED_PROXY;
      else process.env.TRUSTED_PROXY = prev;
    }
  });
});

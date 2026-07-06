/**
 * @fileoverview Tests for the AI proxy validation route handler (issue #1260).
 *
 * Covers the canonical matrix for `GET /api/ai-proxy/validate`:
 *   - 200 (upstream OK)
 *   - 400 (missing provider, invalid provider, invalid key format)
 *   - 401 (upstream rejected the key)
 *   - 404 (provider not configured on server)
 *   - 500 (internal failure, e.g. fetch threw)
 *
 * The real `fetch` is replaced with a controllable mock so no provider call
 * is made. The route uses `next/server`'s `NextResponse.json` (which itself
 * delegates to the global `Response.json`); we install a `Response` polyfill
 * with the static factory and instance body readers, mirroring the strategy
 * used in the sibling `route.test.ts`.
 *
 * @jest-environment node
 */

// PROVIDER_ENDPOINTS is computed at module load. Pin the custom base URL
// before the route is imported so buildTestUrl() can resolve it.
process.env.CUSTOM_AI_BASE_URL ??= "https://custom.example.com/v1";

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

import type { NextRequest } from "next/server";

// ---- Mocks (must be declared before importing the route) ---------------------

const getProviderConfig: jest.Mock = jest.fn();
const isProviderConfigured: jest.Mock = jest.fn();
const validateApiKeyFormat: jest.Mock = jest.fn();
jest.mock("@/lib/server-api-key-storage", () => ({
  getProviderConfig: (...args: unknown[]) => getProviderConfig(...args),
  isProviderConfigured: (...args: unknown[]) => isProviderConfigured(...args),
  validateApiKeyFormat: (...args: unknown[]) => validateApiKeyFormat(...args),
}));

// Mock the global fetch used by the route to ping the upstream provider.
const fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
(globalThis as unknown as { fetch: typeof fetch }).fetch =
  fetchMock as unknown as typeof fetch;

// ---- Functional Response polyfill ------------------------------------------

class TestResponse {
  readonly body: unknown;
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly ok: boolean;
  constructor(body?: unknown, init: ResponseInit = {}) {
    this.body = body ?? null;
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? "OK";
    this.headers = init.headers
      ? new Headers(init.headers as HeadersInit)
      : new Headers();
    this.ok = this.status >= 200 && this.status < 300;
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

// Imported AFTER the polyfill + mocks so the route picks them up.
import { GET } from "../route";

function makeRequest(url: string): NextRequest {
  return { url } as unknown as NextRequest;
}

function mockFetchResponse(status: number, text = ""): Response {
  return new TestResponse(text, {
    status,
    statusText: status === 200 ? "OK" : "Err",
  }) as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  validateApiKeyFormat.mockReturnValue({ valid: true });
  // The custom provider reads its base URL from the environment; pin it so
  // buildTestUrl() can construct the /health probe.
  process.env.CUSTOM_AI_BASE_URL = "https://custom.example.com/v1";
});

describe("GET /api/ai-proxy/validate — request validation", () => {
  it("rejects a missing provider with 400", async () => {
    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate"),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("MISSING_PROVIDER");
  });

  it("rejects an invalid provider value with 400", async () => {
    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=anthropic"),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("INVALID_PROVIDER");
  });
});

describe("GET /api/ai-proxy/validate — provider not configured", () => {
  it("returns 404 when the provider is missing config", async () => {
    getProviderConfig.mockReturnValue(null);
    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=openai"),
    );
    expect(res.status).toBe(404);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("returns 404 when the provider config is disabled", async () => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-test",
      enabled: false,
    });
    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=openai"),
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/ai-proxy/validate — key format", () => {
  it("returns 400 when the API key fails the format check", async () => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "bad-key",
      enabled: true,
    });
    validateApiKeyFormat.mockReturnValue({
      valid: false,
      error: "OpenAI API key should start with sk-",
    });
    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=openai"),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("INVALID_KEY_FORMAT");
    expect(data.error).toContain("sk-");
  });
});

describe("GET /api/ai-proxy/validate — happy paths", () => {
  it("returns 200 when the upstream accepts the OpenAI key", async () => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-fake",
      enabled: true,
    });
    fetchMock.mockResolvedValue(mockFetchResponse(200, ""));

    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=openai"),
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.success).toBe(true);
    expect(data.valid).toBe(true);
    expect(data.provider).toBe("openai");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/models$/),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-fake",
        }),
      }),
    );
  });

  it("uses the apiKey as a query parameter for Google", async () => {
    getProviderConfig.mockReturnValue({
      provider: "google",
      apiKey: "google-key-1234567890",
      enabled: true,
    });
    fetchMock.mockResolvedValue(mockFetchResponse(200, ""));

    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=google"),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/[?&]key=google-key-1234567890/),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.anything(),
        }),
      }),
    );
  });

  it("builds a /health probe for the custom provider", async () => {
    getProviderConfig.mockReturnValue({
      provider: "custom",
      apiKey: "custom-key-123",
      enabled: true,
    });
    fetchMock.mockResolvedValue(mockFetchResponse(200, ""));

    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=custom"),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/health$/),
      expect.any(Object),
    );
  });

  it("uses the Z.ai /models endpoint", async () => {
    getProviderConfig.mockReturnValue({
      provider: "zaic",
      apiKey: "zaic-key-123",
      enabled: true,
    });
    fetchMock.mockResolvedValue(mockFetchResponse(200, ""));

    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=zaic"),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/models$/),
      expect.any(Object),
    );
  });
});

describe("GET /api/ai-proxy/validate — upstream rejection", () => {
  it("returns 401 when the upstream rejects the key", async () => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-fake",
      enabled: true,
    });
    fetchMock.mockResolvedValue(mockFetchResponse(401, "unauthorized"));

    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=openai"),
    );
    expect(res.status).toBe(401);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.success).toBe(false);
    expect(data.valid).toBe(false);
    expect(data.errorCode).toBe("VALIDATION_FAILED_401");
    expect(data.error).toContain("401");
    expect(data.error).toContain("unauthorized");
  });

  it("returns 401 when the upstream returns 500", async () => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-fake",
      enabled: true,
    });
    fetchMock.mockResolvedValue(mockFetchResponse(500, "boom"));

    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=openai"),
    );
    expect(res.status).toBe(401);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("VALIDATION_FAILED_500");
  });
});

describe("GET /api/ai-proxy/validate — internal failure", () => {
  it("returns 500 when the fetch throws", async () => {
    getProviderConfig.mockReturnValue({
      provider: "openai",
      apiKey: "sk-fake",
      enabled: true,
    });
    fetchMock.mockRejectedValue(new Error("network down"));

    const res = await GET(
      makeRequest("http://localhost/api/ai-proxy/validate?provider=openai"),
    );
    expect(res.status).toBe(500);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.errorCode).toBe("VALIDATION_ERROR");
    expect(data.error).toBe("network down");
  });
});

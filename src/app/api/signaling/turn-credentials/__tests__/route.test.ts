/**
 * @fileOverview Tests for `/api/signaling/turn-credentials` — issue #1583.
 *
 * Pins the server-side contract from the issue acceptance criteria:
 *   - 503 when `TURN_HMAC_SECRET` is unset (operator hasn't migrated)
 *   - 400 when `clientId` is missing, oversized, or reduces to empty
 *     after character-class sanitisation
 *   - 200 with the minted credential pair when the env is set +
 *     `clientId` is present; the response includes the
 *     `<expiry>:<clientId>` username + base64 HMAC-SHA1 credential
 *   - The raw `TURN_HMAC_SECRET` value NEVER appears anywhere in the
 *     response body (issue acceptance criterion d)
 *   - Two requests with the same inputs but different `now` produce
 *     different credentials (acceptance criterion a)
 *   - The expiry embedded in the username is bounded above by 24h
 *     (acceptance criterion b) regardless of `TURN_HMAC_TTL_SECONDS`
 *   - The HMAC verifies against the secret (acceptance criterion c)
 *
 * #1798 — per-identity rate limit (mirrors `/api/ai-proxy/validate`):
 *   - 429 with `Retry-After` + `X-RateLimit-*` headers when the shared
 *     limiter rejects the request
 *   - Rate-limit check runs BEFORE any `TURN_HMAC_SECRET` read so the
 *     endpoint cannot be used as an oracle for operator deployment state
 *   - Server-verified client identifier (IP / forwarded header / UA
 *     fingerprint) — never the query-supplied `clientId` parameter —
 *     buckets the limiter so a single identity cannot drain the mint
 *     by churning `clientId` values
 *   - `X-RateLimit-*` headers are stamped on the 200 success path so
 *     legitimate clients can self-throttle
 *
 * The route reads `process.env.TURN_HMAC_SECRET` directly, so each
 * test sets + restores the relevant env keys to keep state isolated.
 *
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { createHmac } from "node:crypto";

// ---- Mocks (must be declared before importing the route) ---------------------

// #1798 — the route is gated by the shared rate-limit policy. Mock the
// limiter + identity helpers so the test can exercise the 429 path
// deterministically and so other tests don't share the singleton's bucket.
// Same shape as the sibling `/api/ai-proxy/validate` test (issue #1795),
// adapted for the TURN route's surface.
const enforceRateLimitMock = jest.fn() as unknown as jest.Mock<
  (...args: any[]) => any
>;
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
const getRateLimitHeadersMock: jest.Mock = jest.fn(
  (result: any) =>
    ({
      "X-RateLimit-Limit": "5",
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(result.resetAt),
      ...(result.retryAfter
        ? { "Retry-After": String(result.retryAfter) }
        : {}),
    }) as Record<string, string>,
);
jest.mock("@/lib/server-rate-limiter", () => ({
  enforceRateLimit: (...args: unknown[]) => enforceRateLimitMock(...args),
  RateLimitError,
  getRateLimitHeaders: (...args: unknown[]) => getRateLimitHeadersMock(...args),
}));

const getClientIdentifierMock: jest.Mock = jest.fn();
jest.mock("@/lib/server-request-identity", () => ({
  getClientIdentifier: (...args: unknown[]) => getClientIdentifierMock(...args),
}));

// ---- Minimal NextResponse / Request polyfill (parity with the
// ---- existing `/api/signaling/__tests__/route.test.ts` harness so
// ---- dynamic-import semantics stay consistent across the suite).

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

type RouteRequest = {
  url: string;
  method: string;
};

function makeGet(url: string): RouteRequest {
  return { url, method: "GET" };
}

interface RouteModule {
  GET: (req: RouteRequest) => Promise<TestResponse>;
}

const ENV_KEYS = [
  "TURN_HMAC_SECRET",
  "TURN_URL",
  "NEXT_PUBLIC_TURN_URL",
  "TURN_HMAC_REALM",
  "TURN_HMAC_TTL_SECONDS",
];

function snapshotEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) out[k] = process.env[k];
  return out;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
}

const envSnapshot = snapshotEnv();

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
  // #1798 — re-establish mock defaults after clearAllMocks. Individual
  // tests override these to exercise the 429 path.
  enforceRateLimitMock.mockResolvedValue({
    success: true,
    remaining: 4,
    resetAt: Date.now() + 60 * 60 * 1000,
  });
  // Deterministic client identifier for tests that need to assert on it.
  getClientIdentifierMock.mockReturnValue("ip:127.0.0.1");
});

afterEach(() => {
  restoreEnv(envSnapshot);
});

async function loadRoute(): Promise<RouteModule> {
  return (await import("../route")) as unknown as RouteModule;
}

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

describe("GET /api/signaling/turn-credentials — failure modes", () => {
  it("returns 503 when TURN_HMAC_SECRET is unset", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    expect(res.status).toBe(503);
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.code).toBe("TURN_HMAC_SECRET_NOT_CONFIGURED");
    expect(typeof data.error).toBe("string");
    expect(data.error as string).toContain("TURN_HMAC_SECRET");
  });

  it("returns 400 when clientId query parameter is missing", async () => {
    process.env.TURN_HMAC_SECRET = "test-secret-1234567890";
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet("http://localhost/api/signaling/turn-credentials"),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.code).toBe("CLIENT_ID_REQUIRED");
  });

  it("returns 400 when clientId is empty string", async () => {
    process.env.TURN_HMAC_SECRET = "test-secret-1234567890";
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet("http://localhost/api/signaling/turn-credentials?clientId="),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.code).toBe("CLIENT_ID_REQUIRED");
  });

  it("returns 400 when clientId has no characters in the safe alphabet", async () => {
    process.env.TURN_HMAC_SECRET = "test-secret-1234567890";
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=%21%21%21",
      ),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.code).toBe("CLIENT_ID_UNSAFE");
  });

  it("returns 400 when clientId exceeds the maximum length", async () => {
    process.env.TURN_HMAC_SECRET = "test-secret-1234567890";
    const { GET } = await loadRoute();
    const long = "a".repeat(300);
    const res = await GET(
      makeGet(
        `http://localhost/api/signaling/turn-credentials?clientId=${long}`,
      ),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.code).toBe("CLIENT_ID_TOO_LONG");
  });
});

// ---------------------------------------------------------------------------
// Rate limiting (issue #1798)
// ---------------------------------------------------------------------------

describe("GET /api/signaling/turn-credentials — rate limiting (issue #1798)", () => {
  it("returns 429 with RATE_LIMIT_EXCEEDED and retryAfter when the limiter rejects", async () => {
    enforceRateLimitMock.mockRejectedValue(
      new RateLimitError(
        "TURN credential mint rate limit exceeded. Please try again later.",
        3600,
        0,
      ),
    );

    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    expect(res.status).toBe(429);
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.error).toContain("TURN credential mint rate limit exceeded");
    expect(data.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.retryAfter).toBe(3600);

    // Rate-limit headers are computed for the 429 response so clients can
    // back off correctly. The header values ride through NextResponse's
    // production path; here we assert the route calls getRateLimitHeaders
    // with the right shape (the production Response.json() in Next.js does
    // not go through the test polyfill's `Response` global, so we test
    // the contract at the mock boundary — Findings #10 from issue #1795).
    expect(getRateLimitHeadersMock).toHaveBeenCalledTimes(1);
    expect(getRateLimitHeadersMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        remaining: 0,
        retryAfter: 3600,
      }),
      expect.objectContaining({ maxRequests: 5, windowMs: 60 * 60 * 1000 }),
    );
  });

  it("checks the rate limit BEFORE consulting TURN_HMAC_SECRET (oracle-leak guard)", async () => {
    // #1798 — the rate-limit gate must run before the secret read so a
    // rate-limited caller cannot distinguish 'secret configured' from
    // 'rate limited'. If the gate were last, the 503 path's response
    // shape would leak operator deployment state. TURN_HMAC_SECRET is
    // intentionally unset; if the rate-limit check ran first, we get a
    // 429 (not a 503).
    delete process.env.TURN_HMAC_SECRET;
    enforceRateLimitMock.mockRejectedValue(
      new RateLimitError("rate limited", 60, 0),
    );

    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    expect(res.status).toBe(429);
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(data.code).not.toBe("TURN_HMAC_SECRET_NOT_CONFIGURED");
  });

  it("uses the server-verified client identifier (never the query's clientId)", async () => {
    process.env.TURN_HMAC_SECRET =
      "test-secret-do-not-use-in-prod-1234567890abcdef";
    getClientIdentifierMock.mockReturnValue("ip:10.0.0.42");

    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    expect(res.status).toBe(200);

    // The bucket key is the SERVER-VERIFIED identifier, not the
    // query-supplied clientId — otherwise an attacker could rotate
    // clientId to dodge the per-identity limit.
    expect(getClientIdentifierMock).toHaveBeenCalledTimes(1);
    expect(enforceRateLimitMock).toHaveBeenCalledWith(
      "ip:10.0.0.42",
      expect.objectContaining({
        maxRequests: 5,
        windowMs: 60 * 60 * 1000,
      }),
    );
    // The query's clientId is NOT the bucket key.
    const enforceCallArgs = enforceRateLimitMock.mock.calls[0] as unknown[];
    expect(enforceCallArgs[0]).not.toBe("peer-1");
    expect(enforceCallArgs[0]).not.toContain("peer-1");
  });

  it("clientId churn under one identity is rate-limited (acceptance criterion)", async () => {
    // #1798 — "clientId churn under one identity" test. An attacker
    // submitting different clientId values per request from a single
    // server-verified identity (IP) must not be able to dodge the
    // bucket — the bucket key is the identity, NOT the clientId.
    process.env.TURN_HMAC_SECRET =
      "test-secret-do-not-use-in-prod-1234567890abcdef";
    getClientIdentifierMock.mockReturnValue("ip:10.0.0.42");
    // First request succeeds, second request (same identity, different
    // clientId) is rate-limited.
    enforceRateLimitMock.mockResolvedValueOnce({
      success: true,
      remaining: 4,
      resetAt: Date.now() + 60 * 60 * 1000,
    });
    enforceRateLimitMock.mockRejectedValueOnce(
      new RateLimitError("rate limited", 3600, 0),
    );

    const { GET } = await loadRoute();
    const resA = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    expect(resA.status).toBe(200);

    const resB = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-2",
      ),
    );
    expect(resB.status).toBe(429);
    const dataB = (await (resB as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(dataB.code).toBe("RATE_LIMIT_EXCEEDED");

    // Both requests hit the SAME bucket key (the server-verified
    // identity), even though the query's clientId differs.
    expect(getClientIdentifierMock).toHaveBeenCalledTimes(2);
    const calls = enforceRateLimitMock.mock.calls as Array<[string, unknown]>;
    expect(calls[0][0]).toBe("ip:10.0.0.42");
    expect(calls[1][0]).toBe("ip:10.0.0.42");
  });

  it("emits rate-limit headers on the success response", async () => {
    process.env.TURN_HMAC_SECRET =
      "test-secret-do-not-use-in-prod-1234567890abcdef";

    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    expect(res.status).toBe(200);

    // The success path stamps X-RateLimit-* via getRateLimitHeaders,
    // mirroring POST /api/ai-proxy (#1782/#1868) and the 429 path
    // above. Assert at the mock boundary (Findings #10).
    expect(getRateLimitHeadersMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, remaining: 4 }),
      expect.objectContaining({ maxRequests: 5, windowMs: 60 * 60 * 1000 }),
    );
  });

  it("the 429 response never contains the TURN_HMAC_SECRET even when configured", async () => {
    process.env.TURN_HMAC_SECRET =
      "test-secret-do-not-use-in-prod-1234567890abcdef";
    enforceRateLimitMock.mockRejectedValue(
      new RateLimitError("rate limited", 60, 0),
    );

    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    expect(res.status).toBe(429);
    const text = await (res as unknown as TestResponse).text();
    expect(text).not.toContain("test-secret-do-not-use-in-prod");
  });
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe("GET /api/signaling/turn-credentials — happy path", () => {
  const SECRET = "test-secret-do-not-use-in-prod-1234567890abcdef";

  beforeEach(() => {
    process.env.TURN_HMAC_SECRET = SECRET;
  });

  it("returns 200 with username, credential, expiresAtEpochSeconds, clientId", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(typeof data.username).toBe("string");
    expect(typeof data.credential).toBe("string");
    expect(typeof data.expiresAtEpochSeconds).toBe("number");
    expect(data.clientId).toBe("peer-1");
  });

  it("username is `<expiry>:<clientId>` per RFC 7635", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.username).toMatch(/^\d+:peer-1$/);
    const [expiryStr, clientId] = (data.username as string).split(":");
    expect(clientId).toBe("peer-1");
    const expiry = Number.parseInt(expiryStr, 10);
    expect(Number.isFinite(expiry)).toBe(true);
    expect(expiry).toBe(data.expiresAtEpochSeconds);
  });

  it("credential is base64 HMAC-SHA1(secret, username)", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    // Verify the HMAC by re-minting locally against the same secret.
    const expectedCredential = computeBase64HmacSha1(
      SECRET,
      data.username as string,
    );
    expect(data.credential).toBe(expectedCredential);
  });

  it("default expiry is within 1h of now (plus 5s jitter)", async () => {
    const { GET } = await loadRoute();
    const beforeMs = Date.now();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const afterMs = Date.now();
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    const expiryMs = (data.expiresAtEpochSeconds as number) * 1000;
    expect(expiryMs).toBeGreaterThanOrEqual(beforeMs + 60 * 60 * 1000 - 5000);
    expect(expiryMs).toBeLessThanOrEqual(afterMs + 60 * 60 * 1000 + 5000);
  });

  it("expiry is clamped to <= 24h even when TURN_HMAC_TTL_SECONDS is set to a week", async () => {
    process.env.TURN_HMAC_TTL_SECONDS = String(7 * 24 * 60 * 60);
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    const expiryMs = (data.expiresAtEpochSeconds as number) * 1000;
    const now = Date.now();
    expect(expiryMs - now).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
    expect(expiryMs - now).toBeGreaterThan(0);
  });

  it("raw TURN_HMAC_SECRET never appears in the response", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const text = await (res as unknown as TestResponse).text();
    expect(text).not.toContain(SECRET);
  });

  it("two consecutive requests yield different credentials (acceptance criterion a)", async () => {
    const { GET } = await loadRoute();
    const resA = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    // Sleep 1100ms to guarantee a different `now` floor.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const resB = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const a = (await (resA as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    const b = (await (resB as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(a.username).not.toBe(b.username);
    expect(a.credential).not.toBe(b.credential);
  });

  it("different clientIds yield different credentials", async () => {
    const { GET } = await loadRoute();
    const resA = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const resB = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-2",
      ),
    );
    const a = (await (resA as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    const b = (await (resB as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(a.username).not.toBe(b.username);
    expect(a.credential).not.toBe(b.credential);
  });

  it("different secrets yield different credentials", async () => {
    const { GET: GET_A } = await loadRoute();
    const resA = await GET_A(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    process.env.TURN_HMAC_SECRET = "completely-different-secret";
    const { GET: GET_B } = await loadRoute();
    const resB = await GET_B(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const a = (await (resA as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    const b = (await (resB as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(a.username).toBe(b.username); // Same `now`-floor within ms
    expect(a.credential).not.toBe(b.credential);
  });

  it("returns iceServers array when TURN_URL is set", async () => {
    process.env.TURN_URL =
      "turn:turn.example.com:3478,turns:turn.example.com:5349";
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    const iceServers = data.iceServers as Array<Record<string, unknown>>;
    expect(Array.isArray(iceServers)).toBe(true);
    expect(iceServers.length).toBe(2);
    expect(iceServers[0].urls).toBe("turn:turn.example.com:3478");
    expect(iceServers[0].username).toBe(data.username);
    expect(iceServers[0].credential).toBe(data.credential);
    expect(iceServers[0].credentialType).toBe("password");
  });

  it("returns empty iceServers array when no TURN_URL is set (legacy migration gap)", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.iceServers).toEqual([]);
  });

  it("honours NEXT_PUBLIC_TURN_URL as a fallback TURN list", async () => {
    process.env.NEXT_PUBLIC_TURN_URL = "turn:legacy.example.com:3478";
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    const iceServers = data.iceServers as Array<Record<string, unknown>>;
    expect(iceServers.length).toBe(1);
    expect(iceServers[0].urls).toBe("turn:legacy.example.com:3478");
  });

  it("surfaces realm when TURN_HMAC_REALM is set", async () => {
    process.env.TURN_HMAC_REALM = "turn.example.com";
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.realm).toBe("turn.example.com");
  });

  it("omits realm when TURN_HMAC_REALM is unset", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    expect(data.realm).toBeUndefined();
  });

  it("honours TURN_HMAC_TTL_SECONDS within the 24h cap", async () => {
    process.env.TURN_HMAC_TTL_SECONDS = "120";
    const { GET } = await loadRoute();
    const beforeMs = Date.now();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    const expiryMs = (data.expiresAtEpochSeconds as number) * 1000;
    expect(expiryMs - beforeMs).toBeGreaterThanOrEqual(120 * 1000 - 5000);
    expect(expiryMs - beforeMs).toBeLessThanOrEqual(120 * 1000 + 5000);
  });

  it("falls back to default TTL when TURN_HMAC_TTL_SECONDS is invalid", async () => {
    process.env.TURN_HMAC_TTL_SECONDS = "not-a-number";
    const { GET } = await loadRoute();
    const beforeMs = Date.now();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    const expiryMs = (data.expiresAtEpochSeconds as number) * 1000;
    expect(expiryMs - beforeMs).toBeGreaterThanOrEqual(60 * 60 * 1000 - 5000);
    expect(expiryMs - beforeMs).toBeLessThanOrEqual(60 * 60 * 1000 + 5000);
  });
});

// ---------------------------------------------------------------------------
// Verification parity: re-mint the credential from the response and
// confirm it matches the same secret (acceptance criterion c). This
// is the test the issue brief calls out explicitly — "HMAC verifies
// against the secret".
// ---------------------------------------------------------------------------

describe("GET /api/signaling/turn-credentials — HMAC verification", () => {
  it("the response credential verifies against the configured secret", async () => {
    process.env.TURN_HMAC_SECRET = "verify-secret-1234567890abcdef";
    const { GET } = await loadRoute();
    const res = await GET(
      makeGet(
        "http://localhost/api/signaling/turn-credentials?clientId=peer-1",
      ),
    );
    const data = (await (res as unknown as TestResponse).json()) as Record<
      string,
      unknown
    >;
    const expected = computeBase64HmacSha1(
      "verify-secret-1234567890abcdef",
      data.username as string,
    );
    expect(data.credential).toBe(expected);
  });
});

// ---- Local HMAC helper used by the verification tests above. ----
// Re-uses the Node built-in so the assertion does not silently fall
// through on a buggy `turn-hmac.ts` mint path. (`createHmac` is the
// canonical reference for HMAC-SHA1.)
function computeBase64HmacSha1(secret: string, message: string): string {
  return createHmac("sha1", secret).update(message).digest("base64");
}

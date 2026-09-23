/**
 * @fileoverview Tests for the deck-import route handler (issue #1260).
 *
 * Covers the canonical matrix for `POST /api/deck-import`:
 *   - 200 (decklist successfully fetched and parsed, body-size cap respected)
 *   - 400 (invalid JSON, missing URL, invalid URL, unsupported site)
 *   - 413 (request body exceeds the 512 KB cap — issue #1277; upstream
 *     response exceeds the 512 KB outbound cap — issue #1783)
 *   - 422 (the URL was reached but no decklist could be parsed)
 *   - 500 (upstream fetch failure / internal error)
 *
 * The real `fetch` is replaced with a controllable mock so no outbound HTTP
 * is performed; the entire pipeline runs in-memory. Issue #1783 tests assert
 * that every outbound request targets an allowlisted deck-site host (no
 * third-party proxy relay, no redirect escapes).
 *
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// ---- Mocks (must be declared before importing the route) ---------------------

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

jest.mock("@/lib/api-session", () => ({
  getApiSession: jest.fn<
    () => Promise<{ userId: string }>
  >().mockResolvedValue({ userId: "test-user-1" }),
  requireApiSession: jest
    .fn<() => Promise<{ userId: string }>>()
    .mockResolvedValue({ userId: "test-user-1" }),
}));

// Imported AFTER the polyfill so the route picks it up.
import { POST } from "../route";

type RouteRequest = Parameters<typeof POST>[0];

function makeRequest(
  body: unknown,
  extraHeaders: Record<string, string> = {},
): RouteRequest {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return {
    url: "http://localhost/api/deck-import",
    method: "POST",
    headers: new Headers({
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(raw, "utf8")),
      ...extraHeaders,
    }),
    async json() {
      return JSON.parse(raw);
    },
    async text() {
      return raw;
    },
  } as unknown as RouteRequest;
}

const MTGGOLDFISH_DECK_HTML = `
<html><body>
<textarea id="decklist">4 Llanowar Elves
3 Forest
1 Sol Ring</textarea>
</body></html>
`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe("POST /api/deck-import — body validation", () => {
  it("rejects invalid JSON with 400", async () => {
    const req = {
      url: "http://localhost/api/deck-import",
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      async json() {
        throw new SyntaxError("bad json");
      },
      async text() {
        return "{ not json";
      },
    } as unknown as RouteRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("Invalid JSON body");
  });

  it("rejects a non-object body with 400", async () => {
    const req = {
      url: "http://localhost/api/deck-import",
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      async json() {
        return "not-an-object";
      },
      async text() {
        return JSON.stringify("not-an-object");
      },
    } as unknown as RouteRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("Body must be a JSON object");
  });

  it("rejects a missing URL with 400", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("URL is required");
  });

  it("rejects a non-string URL with 400", async () => {
    const res = await POST(makeRequest({ url: 123 }));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed URL with 400", async () => {
    const res = await POST(makeRequest({ url: "not a url" }));
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("Invalid URL format");
  });

  it("rejects an unsupported site with 400 and a helpful suggestion", async () => {
    const res = await POST(
      makeRequest({ url: "https://example.com/deck/123" }),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("Unsupported website");
    expect(Array.isArray(data.supportedSites)).toBe(true);
    expect(data.suggestion).toBeTruthy();
  });
});

describe("POST /api/deck-import — body-size cap (issue #1277)", () => {
  it("rejects 413 when the content-length header exceeds the cap", async () => {
    const res = await POST(
      makeRequest(
        { url: "https://mtggoldfish.com/deck/123" },
        { "content-length": String(600 * 1024) },
      ),
    );
    expect(res.status).toBe(413);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toMatch(/too large/);
  });

  it("rejects 413 when the actual body length exceeds the cap", async () => {
    const huge = "x".repeat(600 * 1024);
    const req = {
      url: "http://localhost/api/deck-import",
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      async json() {
        return JSON.parse(`{"url":"https://example.com","_pad":"${huge}"}`);
      },
      async text() {
        return `{"url":"https://example.com","_pad":"${huge}"}`;
      },
    } as unknown as RouteRequest;
    const res = await POST(req);
    expect(res.status).toBe(413);
  });
});

describe("POST /api/deck-import — happy path (HTML scraping)", () => {
  it("parses a decklist from MTGGoldfish HTML and returns 200", async () => {
    fetchMock.mockResolvedValue(
      new TestResponse(MTGGOLDFISH_DECK_HTML, {
        status: 200,
        statusText: "OK",
      }) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://www.mtggoldfish.com/deck/123" }),
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.success).toBe(true);
    expect(data.siteName).toBe("MTGGoldfish");
    expect(data.decklist).toContain("4 Llanowar Elves");
    expect(data.cardCount).toBe(3);
  });

  it("parses a Moxfield deck from the public API via direct fetch (issue #1783)", async () => {
    const apiPayload = JSON.stringify({
      mainboard: {
        "card-id-1": { quantity: 4, card: { name: "Llanowar Elves" } },
      },
      sideboard: {
        "card-id-2": { quantity: 20, card: { name: "Forest" } },
      },
    });
    fetchMock.mockResolvedValue(
      new TestResponse(apiPayload, {
        status: 200,
        statusText: "OK",
      }) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://www.moxfield.com/decks/abc123" }),
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.siteName).toBe("Moxfield");
    expect(data.decklist).toContain("4 Llanowar Elves");
    expect(data.decklist).toContain("20 Forest");

    // The API endpoint is fetched directly — no allorigins relay.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The route fetches a URL object (guard shape for the SSRF barrier);
    // String() normalizes it for the assertion.
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api2.moxfield.com/v2/decks/all/abc123",
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("allorigins");
  });

  it("parses a TappedOut deck from mtg-parser-info HTML", async () => {
    const html = `
<html><body>
<div class="mtg-parser-info">
4 Llanowar Elves
3 Forest
</div>
</body></html>`;
    fetchMock.mockResolvedValue(
      new TestResponse(html, {
        status: 200,
        statusText: "OK",
      }) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://tappedout.net/mtg-decks/some-deck/" }),
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.siteName).toBe("TappedOut");
    expect(data.decklist).toContain("4 Llanowar Elves");
  });

  it("parses an Archidekt deck from __NEXT_DATA__ HTML", async () => {
    const nextData = {
      props: {
        pageProps: {
          deck: {
            cards: [
              { quantity: 1, name: "Sol Ring" },
              { quantity: 4, name: "Llanowar Elves" },
            ],
          },
        },
      },
    };
    const html = `<html><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(nextData)}</script>
</body></html>`;
    fetchMock.mockResolvedValue(
      new TestResponse(html, {
        status: 200,
        statusText: "OK",
      }) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://archidekt.com/decks/42" }),
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.siteName).toBe("Archidekt");
    expect(data.decklist).toContain("1 Sol Ring");
  });

  it("caps the returned decklist at MAX_CARDS rows (issue #1277)", async () => {
    // 300 decklist lines from a synthetic textarea parse
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) lines.push(`1 Card ${i}`);
    const html = `<textarea id="decklist">${lines.join("\n")}</textarea>`;
    fetchMock.mockResolvedValue(
      new TestResponse(html, {
        status: 200,
        statusText: "OK",
      }) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://www.mtggoldfish.com/deck/999" }),
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.cardCount).toBe(250);
    expect(data.decklist.split("\n").length).toBe(250);
  });
});

describe("POST /api/deck-import — failure paths", () => {
  it("returns the upstream status when the deck site cannot fetch the page", async () => {
    fetchMock.mockResolvedValue(
      new TestResponse("not found", {
        status: 404,
        statusText: "Not Found",
      }) as unknown as Response,
    );
    const res = await POST(
      makeRequest({ url: "https://www.mtggoldfish.com/deck/missing" }),
    );
    expect(res.status).toBe(404);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toMatch(/Failed to fetch deck URL/);
  });

  it("returns 422 when the page is fetched but no decklist is parseable", async () => {
    fetchMock.mockResolvedValue(
      new TestResponse("<html><body>no deck here</body></html>", {
        status: 200,
        statusText: "OK",
      }) as unknown as Response,
    );
    const res = await POST(
      makeRequest({ url: "https://www.mtggoldfish.com/deck/no-deck" }),
    );
    expect(res.status).toBe(422);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.siteName).toBe("MTGGoldfish");
  });

  it("returns 500 when the upstream fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const res = await POST(
      makeRequest({ url: "https://www.mtggoldfish.com/deck/x" }),
    );
    expect(res.status).toBe(500);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("Internal server error");
  });

  it("falls back to HTML scraping when Moxfield's API fetch fails", async () => {
    // The Moxfield API endpoint is api2.moxfield.com, distinct from the
    // user-facing moxfield.com URL. We fail the direct API attempt, then
    // succeed on the direct HTML-scrape fallback of the page URL itself.
    const moxState = {
      publicDecklist: {
        boards: {
          mainboard: {
            entries: {
              "card-1": { quantity: 4, card: { name: "Llanowar Elves" } },
            },
          },
        },
      },
    };
    const moxHtml = `<html><body>
<script>window["__INITIAL_STATE__"]=${JSON.stringify(moxState)};</script>
</body></html>`;

    fetchMock.mockImplementation(async (input: any) => {
      const url = typeof input === "string" ? input : String(input);
      if (url.includes("api2.moxfield.com")) {
        return new TestResponse("", {
          status: 500,
          statusText: "Error",
        }) as unknown as Response;
      }
      // Fallback HTML scrape (direct fetch of the page URL)
      return new TestResponse(moxHtml, {
        status: 200,
        statusText: "OK",
      }) as unknown as Response;
    });

    const res = await POST(
      makeRequest({ url: "https://www.moxfield.com/decks/abc" }),
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.siteName).toBe("Moxfield");
    expect(data.decklist).toContain("4 Llanowar Elves");
  });
});

describe("POST /api/deck-import — SSRF / origin-spoofing (issue #1392)", () => {
  // These cases must be rejected BEFORE any outbound fetch occurs, so no
  // fetch mock is configured — a fetch call would fail the test.
  it.each([
    "https://moxfield.com.attacker.com/x",
    "https://attacker-moxfield.com/x",
    "https://moxfieldcom.attacker.com/x",
    "https://moxfield.com.evil.tld/decks/abc",
    "https://mtggoldfish.com.attacker.io/deck/1",
    "https://archidekt.attacker.com/decks/42",
    "https://tappedout.net.evil.net/mtg-decks/x/",
  ])(
    "rejects the spoofed hostname %s with 400 'Unsupported website'",
    async (url) => {
      const res = await POST(makeRequest({ url }));
      expect(res.status).toBe(400);
      const data = (await (res as unknown as TestResponse).json()) as any;
      expect(data.error).toBe("Unsupported website");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    "https://moxfield.com/decks/abc123",
    "https://www.moxfield.com/decks/abc123",
    "https://MTGGOLDFISH.COM/deck/123",
    "https://www.tappedout.net/mtg-decks/some-deck/",
    "https://archidekt.com/decks/42",
  ])(
    "accepts the valid origin %s (no fetch rejection on hostname)",
    async (url) => {
      // A valid hostname must clear the origin check and proceed to fetch.
      // Provide a generic 200 so the pipeline does not 500; we only assert
      // here that the request was NOT rejected as "Unsupported website".
      fetchMock.mockResolvedValue(
        new TestResponse("<html><body>no deck here</body></html>", {
          status: 200,
          statusText: "OK",
        }) as unknown as Response,
      );

      const res = await POST(makeRequest({ url }));
      const data = (await (res as unknown as TestResponse).json()) as any;
      expect(data.error).not.toBe("Unsupported website");
      expect(data.error).not.toBe("Unsupported URL scheme");
      expect(fetchMock).toHaveBeenCalled();
    },
  );

  it("rejects a URL whose origin/hostname is missing entirely (no url field)", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("URL is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "file:///etc/passwd",
    "data:text/html,<script>evil</script>",
    "gopher://internal-host:6379/_FLUSHALL",
    "ftp://moxfield.com/decks/abc",
  ])("rejects the unsafe URL scheme %s with 400", async (url) => {
    const res = await POST(makeRequest({ url }));
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("Unsupported URL scheme");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects embedded credentials in the URL with 400", async () => {
    const res = await POST(
      makeRequest({ url: "https://user:pass@moxfield.com/decks/abc" }),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("URL must not contain credentials");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an IDN homoglyph subdomain of a supported domain with 400", async () => {
    // xn--c1yn36f.moxfield.com is a valid punycode hostname that ends with
    // ".moxfield.com", so the suffix test alone would ACCEPT it. The xn--
    // homoglyph guard in isSupportedHostname must reject it. This is the
    // exact spoofing vector the guard exists to defeat.
    const res = await POST(
      makeRequest({ url: "https://xn--c1yn36f.moxfield.com/decks/abc" }),
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("Unsupported website");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/deck-import — direct fetch & outbound allowlist (issue #1783)", () => {
  const ALLOWED_OUTBOUND_DOMAINS = [
    "mtggoldfish.com",
    "tappedout.net",
    "moxfield.com",
    "archidekt.com",
  ];

  function fetchCallUrls(): string[] {
    return fetchMock.mock.calls.map((call) => {
      const input = call[0];
      if (typeof input === "string") return input;
      if (input instanceof URL) return input.toString();
      return input.url;
    });
  }

  function isAllowlistedOutboundUrl(url: string): boolean {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    return ALLOWED_OUTBOUND_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith("." + d),
    );
  }

  function assertAllOutboundCallsAllowlisted() {
    const urls = fetchCallUrls();
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toContain("allorigins");
      expect(isAllowlistedOutboundUrl(url)).toBe(true);
    }
  }

  it("issues no outbound request to a non-allowlisted host (Moxfield API path)", async () => {
    fetchMock.mockResolvedValue(
      new TestResponse(
        JSON.stringify({
          mainboard: {
            c1: { quantity: 4, card: { name: "Llanowar Elves" } },
          },
        }),
        { status: 200, statusText: "OK" },
      ) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://moxfield.com/decks/abc" }),
    );
    expect(res.status).toBe(200);
    assertAllOutboundCallsAllowlisted();
  });

  it("issues no outbound request to a non-allowlisted host (Archidekt API path)", async () => {
    fetchMock.mockResolvedValue(
      new TestResponse(
        JSON.stringify({
          cards: [{ quantity: 2, name: "Sol Ring" }],
        }),
        { status: 200, statusText: "OK" },
      ) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://archidekt.com/decks/42" }),
    );
    expect(res.status).toBe(200);
    assertAllOutboundCallsAllowlisted();
    expect(fetchCallUrls()[0]).toBe(
      "https://archidekt.com/api/v2/decks/42/deckjson/",
    );
  });

  it("issues no outbound request to a non-allowlisted host (generic scrape path)", async () => {
    fetchMock.mockResolvedValue(
      new TestResponse(MTGGOLDFISH_DECK_HTML, {
        status: 200,
        statusText: "OK",
      }) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://mtggoldfish.com/deck/7" }),
    );
    expect(res.status).toBe(200);
    assertAllOutboundCallsAllowlisted();

    // Every outbound fetch carries an abort timeout signal so a slow deck
    // site cannot pin the route.
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit | undefined)?.signal).toBeDefined();
    }
  });

  it("rejects an oversized upstream response (content-length) with 413", async () => {
    fetchMock.mockResolvedValue(
      new TestResponse("<html></html>", {
        status: 200,
        statusText: "OK",
        headers: { "content-length": String(600 * 1024) },
      }) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://mtggoldfish.com/deck/big" }),
    );
    expect(res.status).toBe(413);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toMatch(/too large/i);
  });

  it("rejects an oversized upstream response body (no content-length) with 413", async () => {
    fetchMock.mockResolvedValue(
      new TestResponse("x".repeat(600 * 1024), {
        status: 200,
        statusText: "OK",
      }) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://mtggoldfish.com/deck/big" }),
    );
    expect(res.status).toBe(413);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toMatch(/too large/i);
  });

  it("rejects an oversized Moxfield API response with 413 and does not retry via scraping", async () => {
    fetchMock.mockResolvedValue(
      new TestResponse("x".repeat(600 * 1024), {
        status: 200,
        statusText: "OK",
      }) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://moxfield.com/decks/huge" }),
    );
    expect(res.status).toBe(413);
    // Hard stop: no fallback fetch of the page URL after the oversized API
    // response.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect that stays on an allowlisted host", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new TestResponse("", {
          status: 302,
          statusText: "Found",
          headers: { location: "https://www.mtggoldfish.com/deck/123" },
        }) as unknown as Response,
      )
      .mockResolvedValueOnce(
        new TestResponse(MTGGOLDFISH_DECK_HTML, {
          status: 200,
          statusText: "OK",
        }) as unknown as Response,
      );

    const res = await POST(
      makeRequest({ url: "https://mtggoldfish.com/deck/123" }),
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.decklist).toContain("4 Llanowar Elves");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    assertAllOutboundCallsAllowlisted();
  });

  it.each([
    "https://evil.com/decks/abc",
    "https://moxfield.com.attacker.com/decks/abc",
    "file:///etc/passwd",
    "https://user:pass@moxfield.com/decks/abc",
  ])(
    "refuses to follow a redirect to the non-allowlisted target %s",
    async (location) => {
      fetchMock.mockResolvedValueOnce(
        new TestResponse("", {
          status: 302,
          statusText: "Found",
          headers: { location },
        }) as unknown as Response,
      );

      const res = await POST(
        makeRequest({ url: "https://moxfield.com/decks/abc" }),
      );
      expect(res.status).toBe(400);
      const data = (await (res as unknown as TestResponse).json()) as any;
      expect(data.error).toMatch(/allowlist/i);

      // Exactly one outbound call — to the allowlisted origin — and none to
      // the redirect target.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      assertAllOutboundCallsAllowlisted();
    },
  );

  it("stops an allowlisted redirect loop after the hop cap instead of looping forever", async () => {
    fetchMock.mockImplementation(
      async () =>
        new TestResponse("", {
          status: 302,
          statusText: "Found",
          headers: { location: "https://mtggoldfish.com/deck/123" },
        }) as unknown as Response,
    );

    const res = await POST(
      makeRequest({ url: "https://mtggoldfish.com/deck/123" }),
    );
    expect(res.status).toBe(502);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toMatch(/Failed to fetch deck URL/);
    // Initial fetch + MAX_REDIRECT_HOPS redirect fetches, then refusal.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    assertAllOutboundCallsAllowlisted();
  });
});

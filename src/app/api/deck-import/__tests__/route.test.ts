/**
 * @fileoverview Tests for the deck-import route handler (issue #1260).
 *
 * Covers the canonical matrix for `POST /api/deck-import`:
 *   - 200 (decklist successfully fetched and parsed, body-size cap respected)
 *   - 400 (invalid JSON, missing URL, invalid URL, unsupported site)
 *   - 413 (request body exceeds the 512 KB cap — issue #1277)
 *   - 422 (the URL was reached but no decklist could be parsed)
 *   - 500 (upstream fetch failure / internal error)
 *
 * The real `fetch` is replaced with a controllable mock so no outbound HTTP
 * is performed; the entire pipeline runs in-memory.
 *
 * @jest-environment node
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

  it("parses a Moxfield deck from the public API via the configured proxy", async () => {
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
  it("returns the upstream status when the proxy cannot fetch the page", async () => {
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
    // user-facing moxfield.com URL. We fail those two proxy attempts, then
    // succeed on the allorigins HTML-scrape fallback.
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
      // Fallback HTML scrape via allorigins
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

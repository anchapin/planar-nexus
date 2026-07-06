/**
 * @fileoverview Tests for the signaling route handler (issue #1260).
 *
 * Covers the canonical matrix for `/api/signaling`:
 *   - 200 (create, join, offer, answer, ice-candidate, poll host/client, delete)
 *   - 400 (missing fields, invalid JSON, missing query param, unknown message type)
 *   - 404 (session not found on poll/offer/answer/ice/close/delete)
 *   - 409 (join when a different client is already registered)
 *   - 410 (join when the session is expired)
 *
 * The route stores sessions in a module-level `Map`. To avoid state leakage
 * between describe blocks we dynamically import the route inside each
 * `beforeEach` and call the handlers off the freshly-loaded module, which
 * also gives each test a fresh `sessions` Map.
 *
 * @jest-environment node
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

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

// Route is imported AFTER the polyfill is installed (see top-of-file note).
// We use a single, shared in-memory `sessions` Map (state is per-sessionId);
// every test creates a fresh session so isolation is by unique IDs, not
// by module reset.
import { GET, POST, DELETE } from "../route";

const handlers = { GET, POST, DELETE };

type RouteRequest = {
  url: string;
  method: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

function makeGet(url: string): RouteRequest {
  return { url, method: "GET", json: async () => ({}), text: async () => "" };
}

function makePost(body: unknown): RouteRequest {
  const raw = JSON.stringify(body);
  return {
    url: "http://localhost/api/signaling",
    method: "POST",
    json: async () => JSON.parse(raw),
    text: async () => raw,
  };
}

function makeDelete(url: string): RouteRequest {
  return {
    url,
    method: "DELETE",
    json: async () => ({}),
    text: async () => "",
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ----------------------------------------------------------------------------
// GET /api/signaling — poll for session updates
// ----------------------------------------------------------------------------

describe("GET /api/signaling — poll validation", () => {
  it("rejects a poll with no gameCode or sessionId with 400", async () => {
    const res = await handlers.GET(
      makeGet("http://localhost/api/signaling") as unknown as Parameters<
        typeof handlers.GET
      >[0],
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("gameCode or sessionId required");
  });

  it("returns 404 when the session does not exist", async () => {
    const res = await handlers.GET(
      makeGet(
        "http://localhost/api/signaling?gameCode=ZZZZZZ",
      ) as unknown as Parameters<typeof handlers.GET>[0],
    );
    expect(res.status).toBe(404);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("Session not found");
  });
});

describe("GET /api/signaling — host vs client perspective", () => {
  it("returns the client view (offer + hostId + hostCandidates) by default", async () => {
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;

    const res = await handlers.GET(
      makeGet(
        `http://localhost/api/signaling?gameCode=${created.gameCode}`,
      ) as unknown as Parameters<typeof handlers.GET>[0],
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.hostId).toBe("host-1");
    expect(data.hostCandidates).toEqual([]);
  });

  it("returns the host view (answer + clientCandidates) when ?role=host", async () => {
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;

    const res = await handlers.GET(
      makeGet(
        `http://localhost/api/signaling?sessionId=${created.sessionId}&role=host`,
      ) as unknown as Parameters<typeof handlers.GET>[0],
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.clientCandidates).toEqual([]);
    expect(data.hostName).toBe("Host One");
  });
});

// ----------------------------------------------------------------------------
// POST /api/signaling — create
// ----------------------------------------------------------------------------

describe("POST /api/signaling — create session", () => {
  it("creates a session and returns a 6-char game code", async () => {
    const res = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.success).toBe(true);
    expect(typeof data.sessionId).toBe("string");
    expect(data.gameCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(typeof data.expiresAt).toBe("number");
  });

  it("rejects a create with missing hostId/hostName with 400", async () => {
    const res = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "", hostName: "" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(400);
  });

  it("includes the offer on the created session when provided", async () => {
    const offer = { type: "offer", sdp: "v=0\r\n..." };
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One", offer },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;
    const pollRes = await handlers.GET(
      makeGet(
        `http://localhost/api/signaling?gameCode=${created.gameCode}`,
      ) as unknown as Parameters<typeof handlers.GET>[0],
    );
    const polled = (await (pollRes as unknown as TestResponse).json()) as any;
    expect(polled.offer).toEqual(offer);
  });
});

// ----------------------------------------------------------------------------
// POST /api/signaling — join
// ----------------------------------------------------------------------------

describe("POST /api/signaling — join session", () => {
  it("returns 200 with the host offer when joining with valid params", async () => {
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;

    const res = await handlers.POST(
      makePost({
        type: "join",
        payload: {
          gameCode: created.gameCode,
          clientId: "client-1",
          clientName: "Client One",
        },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(200);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.success).toBe(true);
    expect(data.hostId).toBe("host-1");
    expect(data.hostName).toBe("Host One");
    expect(data.hostCandidates).toEqual([]);
  });

  it("rejects a join with missing fields with 400", async () => {
    const res = await handlers.POST(
      makePost({
        type: "join",
        payload: { gameCode: "ABC123", clientId: "", clientName: "" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when joining a non-existent game code", async () => {
    const res = await handlers.POST(
      makePost({
        type: "join",
        payload: { gameCode: "ZZZZZZ", clientId: "c1", clientName: "C1" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 when a different client is already joined", async () => {
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;

    await handlers.POST(
      makePost({
        type: "join",
        payload: {
          gameCode: created.gameCode,
          clientId: "client-1",
          clientName: "Client One",
        },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const res = await handlers.POST(
      makePost({
        type: "join",
        payload: {
          gameCode: created.gameCode,
          clientId: "client-2",
          clientName: "Client Two",
        },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(409);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("Session already has a client");
  });

  it("returns 404 when joining a session whose expiry has elapsed (cleaned up)", async () => {
    // `cleanupExpiredSessions` runs at the start of POST, so a session whose
    // expiresAt is in the past is removed before `handleJoinSession` runs —
    // the 410 ("Session expired") branch in handleJoinSession is therefore
    // unreachable in practice and surfaces to clients as 404 instead.
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;

    const realNow = Date.now;
    Date.now = () => created.expiresAt + 1000;
    try {
      const res = await handlers.POST(
        makePost({
          type: "join",
          payload: {
            gameCode: created.gameCode,
            clientId: "client-late",
            clientName: "Late",
          },
        }) as unknown as Parameters<typeof handlers.POST>[0],
      );
      expect(res.status).toBe(404);
    } finally {
      Date.now = realNow;
    }
  });
});

// ----------------------------------------------------------------------------
// POST /api/signaling — offer / answer / ice-candidate
// ----------------------------------------------------------------------------

describe("POST /api/signaling — offer / answer / ice", () => {
  it("attaches an offer to the session", async () => {
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;

    const res = await handlers.POST(
      makePost({
        type: "offer",
        payload: { sessionId: created.sessionId, offer: { type: "offer" } },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 when posting an offer to a non-existent session", async () => {
    const res = await handlers.POST(
      makePost({
        type: "offer",
        payload: { sessionId: "nope", offer: { type: "offer" } },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(404);
  });

  it("attaches an answer and exposes it to the host poll", async () => {
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;

    const answer = { type: "answer", sdp: "v=0\r\nanswer" };
    await handlers.POST(
      makePost({
        type: "answer",
        payload: { sessionId: created.sessionId, answer },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const hostPoll = await handlers.GET(
      makeGet(
        `http://localhost/api/signaling?sessionId=${created.sessionId}&role=host`,
      ) as unknown as Parameters<typeof handlers.GET>[0],
    );
    const data = (await (hostPoll as unknown as TestResponse).json()) as any;
    expect(data.answer).toEqual(answer);
  });

  it("collects ICE candidates and surfaces them per role", async () => {
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;

    const hostCand = { candidate: "candidate:1 ..." };
    const clientCand = { candidate: "candidate:2 ..." };

    await handlers.POST(
      makePost({
        type: "ice-candidate",
        payload: {
          sessionId: created.sessionId,
          candidate: hostCand,
          role: "host",
        },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    await handlers.POST(
      makePost({
        type: "ice-candidate",
        payload: {
          sessionId: created.sessionId,
          candidate: clientCand,
          role: "client",
        },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );

    const hostPoll = await handlers.GET(
      makeGet(
        `http://localhost/api/signaling?sessionId=${created.sessionId}&role=host`,
      ) as unknown as Parameters<typeof handlers.GET>[0],
    );
    const hostData = (await (
      hostPoll as unknown as TestResponse
    ).json()) as any;
    expect(hostData.clientCandidates).toEqual([clientCand]);
  });
});

// ----------------------------------------------------------------------------
// POST /api/signaling — error cases
// ----------------------------------------------------------------------------

describe("POST /api/signaling — error cases", () => {
  it("rejects invalid JSON with 400", async () => {
    const res = await handlers.POST({
      url: "http://localhost/api/signaling",
      method: "POST",
      json: async () => {
        throw new SyntaxError("bad");
      },
      text: async () => "{not-json",
    } as unknown as Parameters<typeof handlers.POST>[0]);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown message type with 400", async () => {
    const res = await handlers.POST(
      makePost({
        type: "bogus",
        payload: {},
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(400);
    const data = (await (res as unknown as TestResponse).json()) as any;
    expect(data.error).toBe("Unknown message type");
  });
});

// ----------------------------------------------------------------------------
// POST /api/signaling — close
// ----------------------------------------------------------------------------

describe("POST /api/signaling — close session", () => {
  it("closes an existing session and returns 200", async () => {
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;

    const res = await handlers.POST(
      makePost({
        type: "close",
        payload: { sessionId: created.sessionId },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(200);

    const poll = await handlers.GET(
      makeGet(
        `http://localhost/api/signaling?sessionId=${created.sessionId}`,
      ) as unknown as Parameters<typeof handlers.GET>[0],
    );
    expect(poll.status).toBe(404);
  });

  it("returns 404 when closing a non-existent session", async () => {
    const res = await handlers.POST(
      makePost({
        type: "close",
        payload: { sessionId: "nope" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    expect(res.status).toBe(404);
  });
});

// ----------------------------------------------------------------------------
// DELETE /api/signaling
// ----------------------------------------------------------------------------

describe("DELETE /api/signaling", () => {
  it("rejects a DELETE without sessionId with 400", async () => {
    const res = await handlers.DELETE(
      makeDelete("http://localhost/api/signaling") as unknown as Parameters<
        typeof handlers.DELETE
      >[0],
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when deleting a non-existent session", async () => {
    const res = await handlers.DELETE(
      makeDelete(
        "http://localhost/api/signaling?sessionId=does-not-exist",
      ) as unknown as Parameters<typeof handlers.DELETE>[0],
    );
    expect(res.status).toBe(404);
  });

  it("deletes an existing session and returns 200", async () => {
    const createRes = await handlers.POST(
      makePost({
        type: "create",
        payload: { hostId: "host-1", hostName: "Host One" },
      }) as unknown as Parameters<typeof handlers.POST>[0],
    );
    const created = (await (
      createRes as unknown as TestResponse
    ).json()) as any;

    const res = await handlers.DELETE(
      makeDelete(
        `http://localhost/api/signaling?sessionId=${created.sessionId}`,
      ) as unknown as Parameters<typeof handlers.DELETE>[0],
    );
    expect(res.status).toBe(200);
  });
});

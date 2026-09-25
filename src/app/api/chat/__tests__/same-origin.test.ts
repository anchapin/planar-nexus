import { assertSameOrigin } from "@/lib/security/same-origin";
import { NextRequest } from "next/server";

function makeMockNextRequest(
  init: RequestInit & { origin?: string; referer?: string; url?: string },
): NextRequest {
  const url = init.url ?? "http://localhost:9002/api/chat";
  const headers = new Headers(init.headers ?? {});
  if (init.origin) headers.set("origin", init.origin);
  if (init.referer) headers.set("referer", init.referer);

  const baseUrl = new URL(url).origin;
  const mockReq = {
    method: init.method ?? "POST",
    headers,
    url,
    nextUrl: { origin: baseUrl } as NextRequest["nextUrl"],
  } as unknown as NextRequest;

  return mockReq;
}

function getThrownResponseBody(thrown: unknown): string {
  return (thrown as { body: string }).body;
}

describe("assertSameOrigin", () => {
  it("allows same-origin POST with matching Origin header", () => {
    const req = makeMockNextRequest({
      method: "POST",
      origin: "http://localhost:9002",
      url: "http://localhost:9002/api/chat",
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("allows same-origin POST with matching Referer header", () => {
    const req = makeMockNextRequest({
      method: "POST",
      referer: "http://localhost:9002/dashboard",
      url: "http://localhost:9002/api/chat",
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("rejects same-origin POST with no Origin or Referer header", () => {
    const req = makeMockNextRequest({
      method: "POST",
      url: "http://localhost:9002/api/chat",
    });
    let thrown: unknown;
    try {
      assertSameOrigin(req);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as { status: number }).status).toBe(403);
    const body = JSON.parse(getThrownResponseBody(thrown));
    expect(body).toEqual({ error: "CROSS_ORIGIN_FORBIDDEN" });
  });

  it("rejects cross-origin POST with mismatched Origin header", () => {
    const req = makeMockNextRequest({
      method: "POST",
      origin: "https://evil.example",
      url: "http://localhost:9002/api/chat",
    });
    let thrown: unknown;
    try {
      assertSameOrigin(req);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as { status: number }).status).toBe(403);
    expect(
      (thrown as { headers: Record<string, string> }).headers["Content-Type"],
    ).toBe("application/json");
  });

  it("cross-origin POST with mismatched Origin returns CROSS_ORIGIN_FORBIDDEN error body", () => {
    const req = makeMockNextRequest({
      method: "POST",
      origin: "https://evil.example",
      url: "http://localhost:9002/api/chat",
    });

    let thrown: unknown;
    try {
      assertSameOrigin(req);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    const body = JSON.parse(getThrownResponseBody(thrown));
    expect(body).toEqual({ error: "CROSS_ORIGIN_FORBIDDEN" });
  });
});

import { NextRequest } from "next/server";

export function assertSameOrigin(request: NextRequest | Request): void {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const expected =
    "nextUrl" in request && request.nextUrl
      ? request.nextUrl.origin
      : undefined;

  if (!expected) return;

  if (!origin && !referer) return;
  if (origin && new URL(origin).origin === expected) return;
  if (referer && new URL(referer).origin === expected) return;

  throw new Response(JSON.stringify({ error: "CROSS_ORIGIN_FORBIDDEN" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

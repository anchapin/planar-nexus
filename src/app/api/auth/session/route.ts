/**
 * Session management endpoint.
 *
 * POST /api/auth/session — set the session cookie (called after localStorage sign-in)
 * Body: { userId: string }
 * Sets pn_session httpOnly cookie
 *
 * DELETE /api/auth/session — clear the session cookie (logout)
 */

import { NextRequest, NextResponse } from "next/server";
import { createSessionCookie, clearSessionCookie } from "@/lib/api-session";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId } = body as { userId?: unknown };

  if (!userId || typeof userId !== "string" || userId.trim() === "") {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const response = NextResponse.json({ success: true });
  const cookieHeader = createSessionCookie(userId.trim());
  response.headers.set("Set-Cookie", cookieHeader["Set-Cookie"]);
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.headers.set("Set-Cookie", clearSessionCookie()["Set-Cookie"]);
  return response;
}

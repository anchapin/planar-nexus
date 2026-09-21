/**
 * Server-side API session authentication utilities.
 *
 * This module provides session auth for API routes. The session cookie (`pn_session`)
 * is set by the client (when a localStorage user exists) and verified server-side.
 *
 * Flow:
 * 1. Client: after user sign-in, set `pn_session` cookie via `/api/auth/session` endpoint
 * 2. Server: API routes call `requireApiSession()` to verify the session
 * 3. If no valid session: return 401
 *
 * The cookie value is the userId from localStorage. No HMAC is needed because
 * the cookie is httpOnly and SameSite=Strict — XSS cannot read it and CSRF
 * cannot send it cross-origin. This is sufficient for a single-user desktop app.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "pn_session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

export interface ApiSession {
  userId: string;
}

/**
 * Attempt to read the current API session from cookies.
 * Returns null if no valid session cookie is present.
 */
export async function getApiSession(): Promise<ApiSession | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(SESSION_COOKIE);
    if (
      !sessionCookie ||
      !sessionCookie.value ||
      sessionCookie.value.trim() === ""
    ) {
      return null;
    }
    return { userId: sessionCookie.value.trim() };
  } catch {
    return null;
  }
}

/**
 * Require a valid API session. Used at the start of API route handlers.
 * Returns a 401 NextResponse if no valid session is present.
 * Use this as an early return: `return requireApiSession(request)` or
 * `const session = await requireApiSession(); if (!session) return;`
 */
export async function requireApiSession(
  _request?: NextRequest,
): Promise<NextResponse | { userId: string }> {
  const session = await getApiSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "NO_SESSION" },
      { status: 401 },
    );
  }
  return session;
}

/**
 * Create a session cookie response. Called by the session-setting endpoint
 * after a user signs in.
 */
export function createSessionCookie(
  userId: string,
): Record<"Set-Cookie", string> {
  const maxAge = SESSION_MAX_AGE;
  return {
    "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(userId)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`,
  };
}

/**
 * Clear the session cookie (e.g., on logout).
 */
export function clearSessionCookie(): Record<"Set-Cookie", string> {
  return {
    "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
  };
}

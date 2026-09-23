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
 * Cookie format: `${userId}:${hmac_hex}` — HMAC-SHA256 of userId signed with SESSION_SECRET.
 * This prevents cookie forgery: even if an attacker can set the cookie (XSS with document.cookie
 * write, or MITM), they cannot produce a valid HMAC without the secret.
 */

import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "pn_session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds
const SEPARATOR = ":";

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is not set");
  }
  return secret;
}

function signUserId(userId: string): string {
  return createHmac("sha256", getSecret()).update(userId).digest("hex");
}

function timingSafeVerify(userId: string, expectedHmac: string): boolean {
  try {
    const hmac = signUserId(userId);
    const a = Buffer.from(hmac, "hex");
    const b = Buffer.from(expectedHmac, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface ApiSession {
  userId: string;
}

/**
 * Attempt to read the current API session from cookies.
 * Returns null if no valid session cookie is present or HMAC verification fails.
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
    const value = sessionCookie.value.trim();
    const lastColon = value.lastIndexOf(SEPARATOR);
    if (lastColon === -1) return null;
    const userId = value.slice(0, lastColon);
    const hmacHex = value.slice(lastColon + 1);
    if (!userId || !hmacHex) return null;
    if (!timingSafeVerify(userId, hmacHex)) return null;
    return { userId };
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
  if (userId.includes(SEPARATOR)) {
    throw new Error("userId must not contain ':'");
  }
  const hmacHex = signUserId(userId);
  const cookieValue = `${userId}${SEPARATOR}${hmacHex}`;
  const maxAge = SESSION_MAX_AGE;
  return {
    "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`,
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

import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Derive a stable, *server-verified* rate-limit key for an inbound API
 * request.
 *
 * Issue #1393 introduced this policy for `/api/ai-proxy`; issue #1534 extracts
 * it into a shared module so `/api/chat` (and any future streaming route)
 * cannot drift from it. Issue #2017 adds HMAC binding to the last-resort
 * fallback so a client cannot spoof their bucket by truncating the UA.
 *
 * Only identifiers the server can verify are honoured:
 *
 *   1. `request.ip` — set by the Next.js runtime / Vercel from the actual TCP
 *      peer; not client-spoofable.
 *   2. Forwarded headers, *only* when the operator has set `TRUSTED_PROXY=true`
 *      to assert the deployment sits behind a reverse proxy that overwrites
 *      those headers.
 *   3. A server-HMACed user-agent fingerprint as a last resort (#2017).
 *
 * The function never reads the request body, so a client cannot influence its
 * own rate-limit bucket.
 */

const RATE_LIMIT_HMAC_SECRET = process.env.RATE_LIMIT_HMAC_SECRET;
let hmacDeprecationWarned = false;

export function getClientIdentifier(request: NextRequest): string {
  // 1. Next.js' verified peer IP (set by Vercel / configured runtime).
  const directIp = (request as unknown as { ip?: string }).ip;
  if (directIp) return `ip:${directIp}`;

  // 2. Forwarded headers are only meaningful behind a trusted proxy the
  //    operator has explicitly opted in to. Without this flag the headers are
  //    fully client-controlled and must not seed a bucket.
  if (process.env.TRUSTED_PROXY === "true") {
    const forwardedFor = request.headers.get("x-forwarded-for");
    if (forwardedFor) return `ip:${forwardedFor.split(",")[0].trim()}`;
    const realIp = request.headers.get("x-real-ip");
    if (realIp) return `ip:${realIp}`;
  }

  // 3. Last-resort fallback: full user-agent HMAC with server secret (#2017).
  //    Without a secret the fallback is the legacy truncated fingerprint
  //    (deprecation path — log once).
  const userAgent = request.headers.get("user-agent") || "unknown";

  if (RATE_LIMIT_HMAC_SECRET) {
    const hmac = createHmac("sha256", RATE_LIMIT_HMAC_SECRET)
      .update(userAgent)
      .digest("hex");
    return `hmac:${hmac}`;
  }

  if (!hmacDeprecationWarned) {
    console.warn(
      "[server-request-identity] RATE_LIMIT_HMAC_SECRET is not set. " +
        "The user-agent fallback path is using a spoofable truncated fingerprint. " +
        "Set RATE_LIMIT_HMAC_SECRET to a random value to bind rate-limit buckets to a server secret " +
        "(prevents client spoofing, issue #2017).",
    );
    hmacDeprecationWarned = true;
  }

  return `session:${userAgent.substring(0, 32)}`;
}

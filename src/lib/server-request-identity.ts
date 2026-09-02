import type { NextRequest } from "next/server";

/**
 * Derive a stable, *server-verified* rate-limit key for an inbound API
 * request.
 *
 * Issue #1393 introduced this policy for `/api/ai-proxy`; issue #1534 extracts
 * it into a shared module so `/api/chat` (and any future streaming route)
 * cannot drift from it. The single implementation is the point: every chat
 * surface must bucket requests by exactly the same server-verified identity.
 *
 * Only identifiers the server can verify are honoured:
 *
 *   1. `request.ip` — set by the Next.js runtime / Vercel from the actual TCP
 *      peer; not client-spoofable.
 *   2. Forwarded headers, *only* when the operator has set `TRUSTED_PROXY=true`
 *      to assert the deployment sits behind a reverse proxy that overwrites
 *      those headers.
 *   3. A coarse user-agent fingerprint as a last resort.
 *
 * The function never reads the request body, so a client cannot influence its
 * own rate-limit bucket.
 */
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

  // 3. Last-resort fallback: a coarse user-agent fingerprint. Stable per
  //    client, coarse across clients sharing a UA — acceptable when no IP is
  //    available (e.g. local dev).
  const userAgent = request.headers.get("user-agent") || "unknown";
  return `session:${userAgent.substring(0, 32)}`;
}

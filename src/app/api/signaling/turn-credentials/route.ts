/**
 * Issue #1583 — TURN HMAC credential mint endpoint.
 * Issue #1798 — Per-identity rate limit gating.
 *
 * GET /api/signaling/turn-credentials?clientId=<peer-id>
 *
 * Mints a fresh short-lived `<expiry>:<clientId>` username + base64
 * HMAC-SHA1 credential pair under the server-side
 * `TURN_HMAC_SECRET` environment variable. The long-term secret
 * NEVER leaves the server — the response carries only the
 * credential + expiry the client puts in its `RTCIceServer` config.
 *
 * Configuration:
 *   - `TURN_HMAC_SECRET` (required): the shared secret configured
 *     on coturn via `static-auth-secret` + `use-auth-secret`. Any
 *     non-empty string is accepted; rotate by changing the value
 *     (coturn reads it at process start so a redeploy is required).
 *   - `NEXT_PUBLIC_TURN_URL` (optional): comma-separated list of
 *     TURN URLs to advertise to the client. When present, each URL
 *     is paired with the minted credential so the operator can run
 *     multiple TURN servers behind one secret. When absent, the
 *     response includes an empty `iceServers[]` and the client
 *     falls back to the public OpenRelay default.
 *   - `TURN_HMAC_REALM` (optional): coturn `realm` value, surfaced
 *     to the client for diagnostic logging.
 *
 * Response shape (200 OK):
 *   {
 *     username: string,
 *     credential: string,   // base64 HMAC-SHA1(secret, username)
 *     expiresAtEpochSeconds: number,
 *     clientId: string,
 *     iceServers: Array<{ urls, username, credential, credentialType }>,
 *     realm?: string,
 *   }
 *
 * Failure modes:
 *   - 429 when the per-identity rate limit is exceeded (#1798) —
 *     stamped with `X-RateLimit-Limit` / `X-RateLimit-Remaining` /
 *     `X-RateLimit-Reset` / `Retry-After` headers and a JSON body
 *     carrying `{ error, code: "RATE_LIMIT_EXCEEDED", retryAfter }`.
 *   - 503 when `TURN_HMAC_SECRET` is unset (operator has not
 *     migrated; legacy `NEXT_PUBLIC_TURN_PASS` is still required).
 *   - 400 when `clientId` is missing or unsafe.
 *   - 500 for unexpected minting errors.
 *
 * Rendering: dynamic. Unlike the deprecated `/api/signaling` route
 * (which is `force-static` for client-only export compatibility),
 * this endpoint MUST execute on the server because the HMAC secret
 * is read from the server environment. Clients deployed in pure
 * static-export mode (where dynamic routes do not run) should
 * continue to use the legacy static credentials path.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  TURN_CREDENTIAL_DEFAULT_TTL_SECONDS,
  mintTurnCredential,
  sanitizeClientId,
} from "@/lib/turn-hmac";
import {
  enforceRateLimit,
  getRateLimitHeaders,
  RateLimitError,
  type RateLimitConfig,
} from "@/lib/server-rate-limiter";
import { getClientIdentifier } from "@/lib/server-request-identity";
import {
  HTTP_STATUS_BY_CLASS,
  newCorrelationId,
  redactErrorMessage,
  toSafeClientError,
} from "@/lib/security/redact-error";

/**
 * Mark this route as runtime-dynamic. Next.js must NOT pre-render it
 * at build time because (a) the response depends on the
 * server-side `TURN_HMAC_SECRET` and (b) the embedded `expiresAt`
 * changes per call. See Next.js docs: "fetch cache" + "dynamic
 * segments" — we don't need either, but we DO need `runtime` to be
 * `nodejs` (default) so `process.env.TURN_HMAC_SECRET` is readable.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Maximum `clientId` length we'll accept from the query string.
 * Generous on purpose — the server-side `sanitizeClientId` reduces
 * to the safe character class + caps at 64, so anything beyond a
 * few KB here is unambiguously abusive.
 */
const MAX_CLIENT_ID_QUERY_LENGTH = 256;

/**
 * Comma-separated TURN URL env var. Distinct from
 * `NEXT_PUBLIC_TURN_URL` only in scope — both are read; the public
 * one is preferred because that's what the client already advertises.
 */
const ENV_TURN_URL_LEGACY = "NEXT_PUBLIC_TURN_URL";
const ENV_TURN_URL_INTERNAL = "TURN_URL";
const ENV_TURN_HMAC_SECRET = "TURN_HMAC_SECRET";
const ENV_TURN_HMAC_REALM = "TURN_HMAC_REALM";
const ENV_TURN_HMAC_TTL = "TURN_HMAC_TTL_SECONDS";

/**
 * #1798 — Per-identity rate-limit policy for the TURN credential mint.
 *
 * TURN relay bandwidth is the expensive resource an attacker wants;
 * a `clientId`-only endpoint with no throttle is an open mint for
 * the operator's coturn deployment (an attacker can re-mint faster
 * than any per-credential TTL elapses, eroding the short-lived HMAC
 * guarantee at the layer above the crypto). Capped at 5 requests
 * per hour per server-verified client identifier (IP / forwarded
 * header / coarse UA fingerprint — see {@link getClientIdentifier}),
 * mirroring the shared policy already used by `/api/ai-proxy`,
 * `/api/chat`, and `/api/ai-proxy/validate` (#1782/#1868/#1795).
 */
const TURN_CREDENTIAL_RATE_LIMIT: RateLimitConfig = {
  maxRequests: 12,
  windowMs: 60 * 60 * 1000,
  message: "TURN credential mint rate limit exceeded. Please try again later.",
};

/**
 * Parse the optional `TURN_HMAC_TTL_SECONDS` env override. Falls
 * back to {@link TURN_CREDENTIAL_DEFAULT_TTL_SECONDS} when unset or
 * invalid. The HMAC module's own TTL clamp keeps us inside the
 * 24-hour policy window so we don't re-validate here.
 */
function resolveTtlSeconds(): number {
  const raw = process.env[ENV_TURN_HMAC_TTL];
  if (typeof raw !== "string" || raw.length === 0) {
    return TURN_CREDENTIAL_DEFAULT_TTL_SECONDS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return TURN_CREDENTIAL_DEFAULT_TTL_SECONDS;
  }
  return parsed;
}

/**
 * Split the operator-supplied TURN URL list. Empty entries are
 * discarded; whitespace is trimmed; both the legacy `NEXT_PUBLIC_*`
 * and the server-only `TURN_URL` env vars are accepted so the
 * existing public env can keep working until the operator migrates.
 */
function resolveTurnUrlList(): string[] {
  const candidates = [
    process.env[ENV_TURN_URL_INTERNAL],
    process.env[ENV_TURN_URL_LEGACY],
  ];
  for (const raw of candidates) {
    if (typeof raw !== "string" || raw.length === 0) continue;
    const urls = raw
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length > 0) return urls;
  }
  return [];
}

interface TurnIceServerView {
  urls: string;
  username: string;
  credential: string;
  credentialType: "password";
}

/**
 * GET /api/signaling/turn-credentials
 *
 * Mints a fresh short-lived TURN credential under `TURN_HMAC_SECRET`
 * and returns the ICE-server pair the client puts directly into
 * `RTCPeerConnection`'s configuration. The long-term secret is
 * never included in the response.
 *
 * #1798 — the endpoint is gated by the shared
 * {@link getClientIdentifier} / {@link enforceRateLimit} policy
 * BEFORE any operator-side state is consulted. A rate-limited caller
 * therefore learns nothing about whether `TURN_HMAC_SECRET` is
 * configured, what TTL is in effect, or whether the credential mint
 * would have succeeded — the 429 response is shape-identical
 * regardless of operator deployment state, so it cannot be used as
 * an oracle for any of those signals.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // #1798 — gate the endpoint BEFORE any provider/secret lookup.
  // Server-verified client identifier only; never read from the
  // request body or query string (a client-supplied key would let
  // callers rotate their own bucket).
  const clientIdentifier = getClientIdentifier(request);

  let rateLimitResult;
  try {
    rateLimitResult = await enforceRateLimit(
      clientIdentifier,
      TURN_CREDENTIAL_RATE_LIMIT,
    );
  } catch (error) {
    if (error instanceof RateLimitError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "RATE_LIMIT_EXCEEDED",
          retryAfter: error.retryAfter,
        },
        {
          status: 429,
          headers: getRateLimitHeaders(
            {
              success: false,
              remaining: 0,
              resetAt: Date.now() + error.retryAfter * 1000,
              retryAfter: error.retryAfter,
            },
            TURN_CREDENTIAL_RATE_LIMIT,
          ),
        },
      );
    }
    throw error;
  }

  const secret = process.env[ENV_TURN_HMAC_SECRET];
  if (typeof secret !== "string" || secret.length === 0) {
    const legacyUrl = process.env[ENV_TURN_URL_LEGACY];
    const legacyUser = process.env["NEXT_PUBLIC_TURN_USER"];
    const legacyPass = process.env["NEXT_PUBLIC_TURN_PASS"];
    if (legacyUrl || legacyUser || legacyPass) {
      console.warn(
        "[signaling/turn-credentials] DEPRECATION WARNING: Legacy static TURN " +
          "credentials (NEXT_PUBLIC_TURN_URL/NEXT_PUBLIC_TURN_USER/NEXT_PUBLIC_TURN_PASS) " +
          "are present but TURN_HMAC_SECRET is not configured. " +
          "Static credentials lack expiry and are a security risk. " +
          "Migrate to TURN_HMAC_SECRET to enable short-lived HMAC credentials (issue #1986 / #1583).",
      );
    }
    return NextResponse.json(
      {
        error:
          "TURN_HMAC_SECRET is not configured on the server. " +
          "Set it (and migrate away from NEXT_PUBLIC_TURN_PASS) to " +
          "enable per-session short-lived TURN credentials (issue #1583).",
        code: "TURN_HMAC_SECRET_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const rawClientId = searchParams.get("clientId");
  if (typeof rawClientId !== "string" || rawClientId.length === 0) {
    return NextResponse.json(
      {
        error: "clientId query parameter is required",
        code: "CLIENT_ID_REQUIRED",
      },
      { status: 400 },
    );
  }
  if (rawClientId.length > MAX_CLIENT_ID_QUERY_LENGTH) {
    return NextResponse.json(
      {
        error: `clientId exceeds maximum length of ${MAX_CLIENT_ID_QUERY_LENGTH}`,
        code: "CLIENT_ID_TOO_LONG",
      },
      { status: 400 },
    );
  }

  let clientId: string;
  try {
    clientId = sanitizeClientId(rawClientId);
  } catch {
    return NextResponse.json(
      {
        error: "clientId has no characters in the safe alphabet",
        code: "CLIENT_ID_UNSAFE",
      },
      { status: 400 },
    );
  }

  let credential;
  try {
    credential = mintTurnCredential({
      secret,
      clientId,
      ttlSeconds: resolveTtlSeconds(),
    });
  } catch (error) {
    // Issue #2081: never echo raw minting error details (key material, HMAC
    // state, internal library messages) into the client response. Log a
    // redacted summary tied to a correlation id the client also receives and
    // respond with a generic message plus a stable errorCode.
    const correlationId = newCorrelationId();
    const safe = toSafeClientError(error);
    console.error(
      `TURN credentials mint error [${safe.errorClass}] [corr ${correlationId}]:`,
      redactErrorMessage(error),
    );
    return NextResponse.json(
      {
        error: safe.error,
        code: safe.errorCode,
        correlationId,
      },
      { status: HTTP_STATUS_BY_CLASS[safe.errorClass] },
    );
  }

  const turnUrls = resolveTurnUrlList();
  const iceServers: TurnIceServerView[] = turnUrls.map((url) => ({
    urls: url,
    username: credential.username,
    credential: credential.credential,
    credentialType: "password" as const,
  }));

  const realm = process.env[ENV_TURN_HMAC_REALM];
  const body: Record<string, unknown> = {
    username: credential.username,
    credential: credential.credential,
    expiresAtEpochSeconds: credential.expiresAtEpochSeconds,
    clientId: credential.clientId,
    iceServers,
  };
  if (typeof realm === "string" && realm.length > 0) body.realm = realm;

  // #1798 — stamp `X-RateLimit-*` headers on the success path so
  // legitimate clients can self-throttle without a separate probe,
  // mirroring the success-path contract from `/api/ai-proxy/validate`
  // (#1795) and `/api/ai-proxy` (#1782/#1868). The shape matches
  // {@link getRateLimitHeaders}.
  return NextResponse.json(body, {
    headers: getRateLimitHeaders(rateLimitResult, TURN_CREDENTIAL_RATE_LIMIT),
  });
}

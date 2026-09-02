/**
 * Error Redaction Utilities
 * Issue #1585: Redact provider API keys and request details from
 * /api/ai-proxy error responses and server logs.
 *
 * Provider SDKs (@ai-sdk/openai, @anthropic-ai/sdk, @google/generative-ai)
 * routinely embed partial key material, the full request URL, and
 * request-body fragments in thrown Errors — particularly on 401/403
 * (key visible in an Authorization-header echo) and 400 (full prompt
 * echoed back). Everything that crosses the trust boundary (HTTP error
 * responses, console logs, usage-log entries) must pass through these
 * helpers first.
 *
 * This module is intentionally isomorphic (safe to import from client
 * and server code): the only ambient access is a guarded `process.env`
 * lookup for literal secret scrubbing.
 */

/** Replacement token for anything that looks like a secret. */
export const REDACTED = "[REDACTED]";

/**
 * Maximum characters retained from an upstream/provider message before it
 * is handed to a log line or usage entry. Issue #1585: any embedded
 * request body (or prompt echo) beyond 200 chars must be truncated.
 */
export const MAX_REDACTED_MESSAGE_LENGTH = 200;

/**
 * Minimum length for a literal environment secret to be scrubbed — avoids
 * false positives on trivially short configured values.
 */
const MIN_ENV_SECRET_LENGTH = 8;

/**
 * Environment variables holding provider API keys (mirrors
 * PROVIDER_ENV_MAPPING in src/lib/server-api-key-storage.ts). Their
 * literal values are scrubbed verbatim from any redacted text.
 */
const SECRET_ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_AI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ZAI_API_KEY",
  "CUSTOM_AI_API_KEY",
] as const;

/**
 * Secret-shaped patterns scrubbed from every redacted string. Order is
 * significant: literal env values first (highest fidelity), then
 * structural patterns.
 *
 * The core pattern set is mandated by issue #1585:
 * /(Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{35}|Authorization:[^;\n]+)/gi
 * extended with Anthropic sk-ant- keys, x-api-key headers, and key
 * query parameters (Google embeds ?key=... in request URLs).
 */
const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer tokens (base64url charset, padded)
  {
    pattern: /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: `$1${REDACTED}`,
  },
  // Anthropic keys: sk-ant-api03-... (hyphenated, before generic sk-)
  { pattern: /sk-ant-[A-Za-z0-9-]{16,}/g, replacement: REDACTED },
  // OpenAI-style keys: sk-proj-... / sk-... (20+ alphanumerics)
  { pattern: /sk-[A-Za-z0-9]{20,}/g, replacement: REDACTED },
  // Google AI keys (exactly AIza + 35 url-safe chars)
  { pattern: /AIza[A-Za-z0-9_-]{35}/g, replacement: REDACTED },
  // Auth header echoes: `Authorization: <creds>`, `x-api-key: <key>`,
  // including JSON-serialized forms like {"Authorization":"Bearer x"}
  {
    pattern:
      /((?:authorization|x-api-key|api-key|proxy-authorization)["']?\s*:\s*["']?)[^"'\n;]+/gi,
    replacement: `$1${REDACTED}`,
  },
  // Key-bearing query params: ?key=..., &api_key=..., ?access_token=...
  {
    pattern:
      /([?&](?:key|api_key|apiKey|apikey|access_token|client_secret)=)[^&\s"'<>]*/gi,
    replacement: `$1${REDACTED}`,
  },
];

/**
 * Read the currently configured provider secret values (best effort,
 * isomorphic-safe). Returns only values long enough to be plausible keys.
 */
function getEnvSecretValues(): string[] {
  const values: string[] = [];
  if (typeof process === "undefined") {
    return values;
  }
  for (const name of SECRET_ENV_VARS) {
    const value = process.env[name];
    if (typeof value === "string" && value.length >= MIN_ENV_SECRET_LENGTH) {
      values.push(value);
    }
  }
  return values;
}

/**
 * Scrub secret-shaped substrings (bearer tokens, sk-/sk-ant-/AIza keys,
 * auth headers, key query params, and the literal configured provider
 * key values) from a string.
 *
 * Non-string / nullish input is returned as an empty string.
 */
export function redactSecrets(text: string | null | undefined): string {
  let out = typeof text === "string" ? text : "";
  if (!out) {
    return out;
  }

  // Literal configured secrets first — highest fidelity, catches keys the
  // structural patterns cannot (e.g. unusual custom-provider formats).
  for (const secret of getEnvSecretValues()) {
    if (out.includes(secret)) {
      out = out.split(secret).join(REDACTED);
    }
  }

  for (const { pattern, replacement } of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }

  return out;
}

/**
 * Truncate a string to `maxLength`, appending a truncation marker.
 * Issue #1585: embedded request bodies / prompt echoes beyond 200 chars
 * must not survive redaction.
 */
export function truncateForSafety(
  text: string,
  maxLength: number = MAX_REDACTED_MESSAGE_LENGTH,
): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...[truncated]`;
}

/**
 * Full redaction pipeline for free-form text headed to a log line or a
 * usage-log entry: scrub secrets, then hard-cap the length.
 */
export function redactText(
  text: string | null | undefined,
  maxLength: number = MAX_REDACTED_MESSAGE_LENGTH,
): string {
  return truncateForSafety(redactSecrets(text), maxLength);
}

/**
 * Serialize an unknown thrown value into a single redacted, length-capped
 * string suitable for `console.error` / structured logging. Never throws.
 */
export function redactErrorMessage(
  error: unknown,
  maxLength: number = MAX_REDACTED_MESSAGE_LENGTH,
): string {
  let raw: string;
  if (error instanceof Error) {
    raw = `${error.name}: ${error.message}`;
  } else if (typeof error === "string") {
    raw = error;
  } else {
    try {
      raw = JSON.stringify(error) ?? String(error);
    } catch {
      raw = String(error);
    }
  }
  return redactText(raw, maxLength);
}

// ----------------------------------------------------------------------------
// Stable client-facing error classification (issue #1585)
// ----------------------------------------------------------------------------

/**
 * Enumerated error classes for the proxy catch-all. Provider SDK errors
 * map onto one of these; the client never receives the raw provider
 * message, only a generic summary per class.
 */
export type ProxyErrorClass = "AUTH" | "PROVIDER" | "NETWORK" | "INTERNAL";

/**
 * Safe, generic client-facing error payload per class. `errorCode` values
 * are stable and align with the vocabulary the client
 * (src/lib/ai-proxy-client.ts getProxyErrorMessage) already understands.
 */
export const SAFE_CLIENT_ERRORS: Record<
  ProxyErrorClass,
  { error: string; errorCode: string }
> = {
  AUTH: {
    error: "Provider authentication failed",
    errorCode: "INVALID_API_KEY",
  },
  PROVIDER: {
    error: "Provider request failed",
    errorCode: "PROVIDER_REQUEST_FAILED",
  },
  NETWORK: { error: "Provider network error", errorCode: "NETWORK_ERROR" },
  INTERNAL: { error: "Internal server error", errorCode: "INTERNAL_ERROR" },
};

/** HTTP status used per error class (upstream failures surface as 502). */
export const HTTP_STATUS_BY_CLASS: Record<ProxyErrorClass, number> = {
  AUTH: 502,
  PROVIDER: 502,
  NETWORK: 502,
  INTERNAL: 500,
};

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const NETWORK_MESSAGE_PATTERN =
  /\b(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH)\b|fetch failed|network error|getaddrinfo|connect timeout/i;

const AUTH_MESSAGE_PATTERN =
  /\b(?:unauthorized|forbidden)\b|invalid[ _-]?api[ _-]?key|incorrect api key|authentication (?:error|failed)/i;

/**
 * Provider-ish message shapes when no status property is available: a
 * leading or embedded 4xx/5xx status ("400 - messages[0].content ..."),
 * or a provider SDK error class name. Checked last — AUTH and NETWORK
 * win when their signatures are present.
 */
const PROVIDER_MESSAGE_PATTERN = /\b(?:4\d\d|5\d\d)\b/i;
const PROVIDER_ERROR_NAME_PATTERN = /APICallError|APIHttpError|ProviderError/i;

/**
 * Extract an upstream HTTP status from a thrown error. Provider SDKs
 * expose it under different names (`statusCode` for Vercel AI SDK's
 * APICallError, `status` for fetch Responses and several SDKs,
 * `httpStatus` for others).
 */
function extractUpstreamStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const candidate = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "httpStatus"]) {
    const value = candidate[key];
    if (typeof value === "number" && value >= 400 && value <= 599) {
      return value;
    }
  }
  return undefined;
}

/**
 * Classify an unknown thrown error into the enumerated proxy error
 * classes (AUTH / PROVIDER / NETWORK / INTERNAL).
 */
export function classifyProxyError(error: unknown): ProxyErrorClass {
  if (error && typeof error === "object") {
    const cause = (error as { cause?: { code?: unknown } }).cause;
    if (
      cause &&
      typeof cause === "object" &&
      typeof cause.code === "string" &&
      NETWORK_ERROR_CODES.has(cause.code)
    ) {
      return "NETWORK";
    }
  }

  const status = extractUpstreamStatus(error);
  if (status === 401 || status === 403) {
    return "AUTH";
  }
  if (status !== undefined) {
    return "PROVIDER";
  }

  const name = error instanceof Error ? error.name : "";
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";

  if (NETWORK_MESSAGE_PATTERN.test(message)) {
    return "NETWORK";
  }
  if (AUTH_MESSAGE_PATTERN.test(message)) {
    return "AUTH";
  }
  if (
    PROVIDER_MESSAGE_PATTERN.test(message) ||
    PROVIDER_ERROR_NAME_PATTERN.test(name)
  ) {
    return "PROVIDER";
  }
  return "INTERNAL";
}

/**
 * Map a thrown error to its safe client-facing payload (generic message
 * plus a stable errorCode from the enumerated set).
 */
export function toSafeClientError(error: unknown): {
  error: string;
  errorCode: string;
  errorClass: ProxyErrorClass;
} {
  const errorClass = classifyProxyError(error);
  return { ...SAFE_CLIENT_ERRORS[errorClass], errorClass };
}

/**
 * Generate a correlation id that ties a client-visible error response to
 * the corresponding (redacted) server log line. Isomorphic-safe.
 */
export function newCorrelationId(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } })
    .crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return `err_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

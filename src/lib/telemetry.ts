/**
 * @fileoverview Opt-in crash & error telemetry for Planar Nexus.
 *
 * Issue #1112: The shipped Tauri desktop (and web) builds had ZERO
 * observability. This module adds a strictly opt-in telemetry layer so that
 * crashes, uncaught renderer exceptions, and failed SW/AI/P2P flows can be
 * reported back — but ONLY after explicit user consent.
 *
 * Privacy contract (authoritative source: docs/PRIVACY.md)
 * ---------------------------------------------------------
 * - OFF by default. Nothing leaves the device until the user explicitly
 *   enables it via Settings → Privacy & Telemetry.
 * - Only ever transmits: error type, message, stack, a coarse surface tag
 *   (SW | AI | P2P | renderer), the app version, and a timestamp.
 * - NEVER transmits card data, deck contents, peer identities, IP addresses,
 *   tokens, or any other PII. Free-text fields are sanitized defensively.
 * - Consent is re-read at dispatch time, so flipping the toggle off stops
 *   transmission immediately.
 *
 * Transport
 * ---------
 * This is a local-first app with no built-in backend collector. The transport
 * is pluggable: by default it POSTs to the endpoint configured via
 * `NEXT_PUBLIC_TELEMETRY_ENDPOINT` (an operator-supplied ingestion URL). When
 * no endpoint is configured the default transport is a safe no-op, so the
 * module is wire-ready without inventing a collector. Operators/self-hosters
 * point the env var at their own Sentry-compatible/GlitchTip/custom endpoint.
 */

/**
 * Coarse surface tag identifying where an error originated. Deliberately
 * coarse-grained so it cannot leak specifics (e.g. we send "P2P", never a
 * peer id or room code).
 */
export type TelemetrySurface = "SW" | "AI" | "P2P" | "renderer";

/**
 * The exact, closed set of fields transmitted in a telemetry event.
 * `readonly` + a fixed key set makes it structurally impossible to accidentally
 * attach card/deck/peer data — see the allowlist test in __tests__.
 */
export interface TelemetryPayload {
  readonly type: string;
  readonly message: string;
  readonly stack?: string;
  readonly surface: TelemetrySurface;
  readonly appVersion: string;
  readonly timestamp: string;
}

/** A function that delivers a payload off-device. Replaceable for tests/ops. */
export type TelemetryTransport = (payload: TelemetryPayload) => void;

const CONSENT_KEY = "planar-nexus:telemetry-consent";
const ENDPOINT_ENV = "NEXT_PUBLIC_TELEMETRY_ENDPOINT";
const VERSION_ENV = "NEXT_PUBLIC_APP_VERSION";
const FALLBACK_VERSION = "0.0.0-unknown";

/** Maximum length of any free-text field before truncation. */
const MAX_FIELD_LENGTH = 4096;

/**
 * Substrings that could carry PII or identifying data. Matched against the
 * message/stack and redacted before transport. Defense-in-depth: the payload
 * schema never includes business data, but an Error's message/stack could
 * incidentally echo it, so we scrub aggressively.
 *
 * Captures:
 *  - `peerId=...`, `peer_id:...`, `deckId="..."`, `cardName=...` style tokens
 *  - bare UUID v4 strings (peer/connection ids are UUIDs)
 *  - email addresses
 *  - URL query strings / fragments (may carry room codes or tokens)
 */
const SENSITIVE_PATTERNS: ReadonlyArray<RegExp> = [
  // key=value / key:value / key="value" for known-sensitive keys
  /\b(peer_?id|peer|deck_?id|deck_?name|deck_?list|deck_?contents?|card_?name|card_?id|room_?code|token|password|secret|email)\b\s*[:=]\s*("?)[^\s,;}"']+\2/gi,
  // UUID v4 — peer/connection identifiers in this app are UUIDs
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  // email addresses
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
  // URL query/fragment — may carry room codes or access tokens
  /\?(?:[^#\s]*#.*)?$/gi,
];

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * Whether the user has explicitly opted in to telemetry. Default: false.
 * Reads live from localStorage so toggling is effective immediately.
 */
export function isTelemetryEnabled(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return false;
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "true";
  } catch {
    // localStorage may be unavailable (private mode, sandbox). Fail closed.
    return false;
  }
}

/**
 * Persist the user's telemetry consent decision. Pass `false` to opt out.
 * This writes only the consent flag — it never transmits anything itself.
 */
export function setTelemetryConsent(enabled: boolean): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(CONSENT_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore persistence failures — consent just won't survive restart.
  }
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Redact PII / identifying substrings from a free-text field and truncate.
 * Pure & side-effect free so it is trivially unit-testable.
 */
export function sanitizeText(input: unknown): string {
  if (input == null) return "";
  const text = typeof input === "string" ? input : String(input);

  let scrubbed = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    // Reset lastIndex for any accidentally-stateful regex (the `g` flag).
    pattern.lastIndex = 0;
    scrubbed = scrubbed.replace(pattern, "[REDACTED]");
  }

  if (scrubbed.length > MAX_FIELD_LENGTH) {
    scrubbed = `${scrubbed.slice(0, MAX_FIELD_LENGTH)}…[truncated]`;
  }
  return scrubbed;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

let activeTransport: TelemetryTransport = defaultTransport;

/**
 * The default transport. If `NEXT_PUBLIC_TELEMETRY_ENDPOINT` is configured it
 * ships the payload there (preferring `navigator.sendBeacon` to avoid blocking
 * unloading). With no endpoint it is a safe no-op, so the module is inert
 * until an operator opts in to a collector.
 *
 * Network failures here are swallowed on purpose: telemetry must never break
 * the app or throw into a global handler that itself reports telemetry.
 */
function defaultTransport(payload: TelemetryPayload): void {
  const endpoint = getTelemetryEndpoint();
  if (!endpoint) return;

  try {
    const body = JSON.stringify(payload);
    const g: typeof globalThis = globalThis;

    // Prefer sendBeacon (fire-and-forget, survives page unload) when usable.
    if (
      typeof g.navigator !== "undefined" &&
      typeof g.navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: "application/json" });
      if (g.navigator.sendBeacon(endpoint, blob)) return;
    }

    // Fall back to fetch with keepalive for environments without sendBeacon.
    if (typeof g.fetch === "function") {
      void g
        .fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
          // Telemetry must not carry credentials — least-privilege.
          credentials: "omit",
          mode: "cors",
        })
        .catch(() => {
          /* swallow — see jsdoc */
        });
    }
  } catch {
    /* swallow — never let reporting crash the app */
  }
}

/** The configured ingestion endpoint, or undefined when none is set. */
export function getTelemetryEndpoint(): string | undefined {
  const raw = process.env[ENDPOINT_ENV];
  return raw && raw.trim().length > 0 ? raw.trim() : undefined;
}

/**
 * Replace the active transport. Intended for tests and operator overrides.
 * Pass nothing (or the default) to reset.
 */
export function setTelemetryTransport(
  transport: TelemetryTransport | undefined,
): void {
  activeTransport = transport ?? defaultTransport;
}

/** @internal Reset to the default transport (test helper). */
export function resetTelemetryTransport(): void {
  activeTransport = defaultTransport;
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------

function appVersion(): string {
  const fromEnv = process.env[VERSION_ENV];
  return fromEnv && fromEnv.trim().length > 0
    ? fromEnv.trim()
    : FALLBACK_VERSION;
}

/**
 * Build a sanitized, PII-free payload from an arbitrary thrown value.
 * Exposed for testing and for callers that want to inspect what WOULD be sent.
 */
export function buildPayload(
  error: unknown,
  surface: TelemetrySurface,
  messageOverride?: string,
): TelemetryPayload {
  const err = error as {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
  } | null;
  const type =
    err &&
    typeof err === "object" &&
    typeof err.name === "string" &&
    err.name.length > 0
      ? err.name
      : error instanceof Error
        ? error.name
        : typeof error === "string"
          ? "Error"
          : "UnknownError";

  const rawMessage =
    messageOverride ??
    (err && typeof err === "object" && typeof err.message === "string"
      ? err.message
      : typeof error === "string"
        ? error
        : "");

  return {
    type: sanitizeText(type),
    message: sanitizeText(rawMessage),
    stack:
      err && typeof err === "object" && typeof err.stack === "string"
        ? sanitizeText(err.stack)
        : undefined,
    surface,
    appVersion: appVersion(),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Capture an error and transmit it — but ONLY if the user has opted in.
 * Safe to call anywhere, any environment: when consent is off (the default)
 * it is a pure no-op that touches neither the network nor localStorage.
 *
 * @param error   The thrown value / Error / string describing the failure.
 * @param surface Coarse origin tag. Defaults to "renderer".
 * @param context Optional human-readable context message (sanitized).
 */
export function captureError(
  error: unknown,
  surface: TelemetrySurface = "renderer",
  context?: string,
): void {
  // Re-check consent at dispatch time so toggling off halts reporting instantly.
  if (!isTelemetryEnabled()) return;

  const payload = buildPayload(error, surface, context);
  try {
    activeTransport(payload);
  } catch {
    /* never let transport throw into the caller */
  }
}

/**
 * Capture a non-exception signal (e.g. a failed AI/P2P flow that did not
 * throw). Still consent-gated and sanitized.
 */
export function captureMessage(
  message: string,
  surface: TelemetrySurface = "renderer",
): void {
  captureError(message, surface);
}

// ---------------------------------------------------------------------------
// Global handlers
// ---------------------------------------------------------------------------

let installed = false;
let uninstallFn: (() => void) | null = null;

/** A reusable no-op cleanup, returned during SSR where there is nothing to uninstall. */
const noopCleanup = (): void => {
  /* no listeners installed outside a browser window */
};

function makeHandler(surface: TelemetrySurface) {
  return (event: unknown): void => {
    // unhandledrejection gives a PromiseRejectionEvent (reason);
    // error gives an ErrorEvent (error) or the event itself.
    const target = event as {
      error?: unknown;
      reason?: unknown;
      message?: unknown;
    } | null;
    const value =
      (target && target.error) || (target && target.reason) || event;
    captureError(value, surface);
  };
}

/**
 * Install global `error` and `unhandledrejection` listeners that report
 * uncaught renderer exceptions — but only when consent is on (checked per
 * event). Idempotent: calling repeatedly is safe and will not double-install.
 *
 * Safe during SSR: it is a no-op outside a browser window.
 *
 * @returns a cleanup function that removes the listeners.
 */
export function initTelemetry(): () => void {
  if (typeof window === "undefined") return noopCleanup;

  if (installed && uninstallFn) return uninstallFn;

  const onError = makeHandler("renderer");
  const onRejection = makeHandler("renderer");

  window.addEventListener("error", onError as EventListener);
  window.addEventListener("unhandledrejection", onRejection as EventListener);

  uninstallFn = () => {
    window.removeEventListener("error", onError as EventListener);
    window.removeEventListener(
      "unhandledrejection",
      onRejection as EventListener,
    );
    installed = false;
    uninstallFn = null;
  };
  installed = true;
  return uninstallFn;
}

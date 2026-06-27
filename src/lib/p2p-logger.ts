/**
 * @fileOverview P2P logging utility (Issue #987)
 *
 * Level-aware logger for the P2P infrastructure (WebRTC, signaling, ICE).
 * Provides `debug` / `info` / `warn` / `error` levels with two guarantees:
 *
 *  1. PRODUCTION STRIPPING — `debug()` and `info()` bodies are wrapped in a
 *     build-time `process.env.NODE_ENV !== 'production'` guard. Next.js
 *     (and therefore the Tauri build) inlines `NODE_ENV` as a string literal
 *     and the minimizer dead-code-eliminates the entire body, so verbose P2P
 *     diagnostics never ship to end users. This reduces DevTools noise and
 *     avoids minor information leakage for a local-first app.
 *
 *  2. RUNTIME LEVEL CONTROL — in development, verbosity is configurable via
 *     the `NEXT_PUBLIC_P2P_LOG_LEVEL` env var (`debug` | `info` | `warn` |
 *     `error`), defaulting to `debug`. `warn` and `error` ALWAYS emit, in
 *     every environment, so real issues keep surfacing in production.
 *
 * The logger is intentionally lightweight: it does NOT reformat messages or
 * inject timestamps/prefixes. Existing log lines already carry their own
 * `[WebRTC]` / `[Signaling]` / `[ICE]` component tags, and keeping the
 * message as the first forwarded argument means the #982 redaction layer
 * (`redactSensitive`) and existing test spies on `console.*` keep working
 * unchanged.
 *
 * @example
 * ```ts
 * import { p2pLogger } from "@/lib/p2p-logger";
 *
 * p2pLogger.debug("[WebRTC] negotiating", detail); // stripped in prod
 * p2pLogger.info("[ICE] Connection state:", state); // stripped in prod
 * p2pLogger.warn("[WebRTC] Rate limit exceeded");    // always emits
 * p2pLogger.error("[WebRTC] init failed:", err);      // always emits
 * ```
 */

export type P2PLogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<P2PLogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const VALID_LEVELS: readonly P2PLogLevel[] = [
  "debug",
  "info",
  "warn",
  "error",
];

/**
 * Resolve a level string from an env var, falling back to a default when the
 * value is missing or unrecognized. Pure + exported for unit testing.
 */
export function resolveP2PLevel(
  envValue: string | undefined,
  fallback: P2PLogLevel,
): P2PLogLevel {
  const v = (envValue ?? "").toLowerCase();
  return (VALID_LEVELS as readonly string[]).includes(v)
    ? (v as P2PLogLevel)
    : fallback;
}

/**
 * Minimum level for `debug`/`info` in development. Configurable via
 * `NEXT_PUBLIC_P2P_LOG_LEVEL`. Has NO effect on `warn`/`error`, which always
 * emit (and which are dead-code-eliminated independently of this value).
 */
const DEV_MIN_LEVEL: P2PLogLevel = resolveP2PLevel(
  process.env.NEXT_PUBLIC_P2P_LOG_LEVEL,
  "debug",
);

export interface P2PLoggerOptions {
  /**
   * Minimum level to emit in development (applies to `debug`/`info` only).
   * Defaults to the `NEXT_PUBLIC_P2P_LOG_LEVEL` env var, or `debug`.
   */
  minLevel?: P2PLogLevel;
  /** Optional component tag for scoping a child logger. */
  component?: string;
}

export class P2PLogger {
  private readonly minLevel: P2PLogLevel;
  private readonly component: string | undefined;

  constructor(options: P2PLoggerOptions = {}) {
    this.minLevel = options.minLevel ?? DEV_MIN_LEVEL;
    this.component = options.component;
  }

  /** @internal Whether `level` meets the configured dev minimum. */
  private levelEnabled(level: P2PLogLevel): boolean {
    return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[this.minLevel];
  }

  /**
   * Debug logging — detailed diagnostics. Stripped from production builds:
   * the body is dead-code-eliminated when `NODE_ENV === 'production'`. In
   * development it is gated by the configured minimum level.
   */
  debug(message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV !== "production") {
      if (this.levelEnabled("debug")) {
        console.debug(message, ...args);
      }
    }
  }

  /**
   * Info logging — lifecycle / state transitions. Stripped from production
   * builds (dead-code-eliminated when `NODE_ENV === 'production'`). In
   * development it is gated by the configured minimum level.
   */
  info(message: string, ...args: unknown[]): void {
    if (process.env.NODE_ENV !== "production") {
      if (this.levelEnabled("info")) {
        console.info(message, ...args);
      }
    }
  }

  /**
   * Warning logging — recoverable issues. ALWAYS emitted, in both development
   * and production. Never stripped, never gated by the configured level.
   */
  warn(message: string, ...args: unknown[]): void {
    console.warn(message, ...args);
  }

  /**
   * Error logging — failures and exceptions. ALWAYS emitted, in both
   * development and production. Arguments are forwarded verbatim so the #982
   * `redactSensitive` layer continues to mask session IDs / SDP / credentials.
   */
  error(message: string, ...args: unknown[]): void {
    console.error(message, ...args);
  }

  /**
   * Create a child logger scoped to a component. Shares the level config of
   * the parent. The component tag is currently informational (messages keep
   * their own inline tags) but is retained for future structured logging.
   */
  child(component: string): P2PLogger {
    return new P2PLogger({
      minLevel: this.minLevel,
      component: this.component ? `${this.component}:${component}` : component,
    });
  }
}

/** Shared P2P logger instance used across the P2P infrastructure. */
export const p2pLogger = new P2PLogger();

/**
 * Factory for component-scoped P2P loggers.
 *
 * @example
 *   const log = createP2PLogger("WebRTC");
 *   log.error("[WebRTC] init failed:", err);
 */
export function createP2PLogger(
  component: string,
  options?: Omit<P2PLoggerOptions, "component">,
): P2PLogger {
  return new P2PLogger({ ...options, component });
}

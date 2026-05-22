/**
 * Environment variable configuration for timeout values
 * Issue #847: Expose timeouts to environment variables
 *
 * Provides typed access to timeout configuration via environment variables.
 * Falls back to sensible defaults when env vars are not set.
 */

/**
 * Get environment variable as number with optional default
 * Uses process.env which works for both server and client (NEXT_PUBLIC_* vars)
 */
function getTimeoutEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Timeout configuration
 * All values are in milliseconds
 */
export const TIMEOUTS = {
  /** WebSocket reconnect interval in milliseconds */
  WEBSOCKET_RECONNECT_MS: getTimeoutEnv("WEBSOCKET_RECONNECT_MS", 3000),

  /** WebSocket connection timeout in milliseconds */
  WEBSOCKET_TIMEOUT_MS: getTimeoutEnv("WEBSOCKET_TIMEOUT_MS", 10000),

  /** P2P fallback timeout in milliseconds */
  P2P_FALLBACK_TIMEOUT_MS: getTimeoutEnv("P2P_FALLBACK_TIMEOUT_MS", 15000),

  /** P2P handshake timeout in milliseconds */
  P2P_HANDSHAKE_TIMEOUT_MS: getTimeoutEnv("P2P_HANDSHAKE_TIMEOUT_MS", 10000),

  /** Lobby refresh interval in milliseconds */
  LOBBY_REFRESH_MS: getTimeoutEnv("LOBBY_REFRESH_MS", 10000),
} as const;

export type TimeoutConfig = typeof TIMEOUTS;

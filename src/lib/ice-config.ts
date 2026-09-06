/**
 * ICE Configuration for NAT Traversal
 * Issue #286: Add NAT traversal and STUN/TURN server support
 * Issue #1583: Replace shared static TURN credentials with short-lived
 *   per-session HMAC credentials. The HMAC minting helper lives in
 *   `./turn-hmac`; this module owns the env-var resolution,
 *   deprecation warnings, and the `applyHmacCredentials` method on
 *   `ICEConfigurationManager` that propagates the minted
 *   username/credential to every configured TURN server atomically.
 *
 * Provides configurable STUN/TURN server settings for WebRTC connections,
 * enabling P2P connectivity across various network configurations.
 */

import { p2pLogger } from "./p2p-logger";
import {
  mintTurnCredential,
  TURN_CREDENTIAL_DEFAULT_TTL_SECONDS,
  type TurnCredential,
} from "./turn-hmac";

/**
 * ICE Server configuration
 */
export interface ICEServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: "password" | "oauth";
}

/**
 * ICE Transport Policy
 */
export type ICETransportPolicy = "all" | "relay";

/**
 * ICE Connection Mode
 */
export type ICEConnectionMode =
  | "auto" // Automatically select best servers
  | "stun-only" // Only use STUN servers
  | "turn-relay" // Force TURN relay
  | "custom"; // Use custom server configuration

/**
 * ICE Configuration Options
 */
export interface ICEConfigOptions {
  /** Connection mode */
  mode?: ICEConnectionMode;
  /** Custom STUN servers */
  customStunServers?: ICEServerConfig[];
  /** Custom TURN servers */
  customTurnServers?: ICEServerConfig[];
  /** Enable IPv6 candidates */
  enableIPv6?: boolean;
  /** ICE candidate pool size */
  candidatePoolSize?: number;
  /** Bundle policy */
  bundlePolicy?: RTCBundlePolicy;
  /** RTCP mux policy */
  rtcpMuxPolicy?: RTCRtcpMuxPolicy;
}

/**
 * Default public STUN servers
 * These are free public STUN servers for NAT traversal
 */
export const DEFAULT_STUN_SERVERS: ICEServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
  { urls: "stun:stun3.l.google.com:19302" },
  { urls: "stun:stun4.l.google.com:19302" },
  { urls: "stun:stun.stunprotocol.org:3478" },
  { urls: "stun:stun.voip.eutelia.it:3478" },
];

/**
 * Public free TURN servers used as a last-resort fallback.
 *
 * These are the OpenRelay public relay servers operated by Metered
 * (https://github.com/ metered-test-hosting / openrelay) explicitly published
 * with shared community credentials (`openrelayproject` / `openrelayproject`)
 * for development, testing, and small-scale production use. They are NOT
 * secrets — the credentials are intentionally public so clients can embed
 * them. They provide a relay fallback so users behind symmetric NATs are not
 * left with zero connectivity when no private TURN infrastructure is
 * configured via environment variables.
 *
 * For production deployments, set NEXT_PUBLIC_TURN_URL / USER / PASS to your
 * own TURN infrastructure for reliable, rate-limit-free NAT traversal.
 */
export const PUBLIC_FALLBACK_TURN_SERVERS: ICEServerConfig[] = [
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
    credentialType: "password",
  },
  {
    urls: "turn:openrelay.metered.ca:443",
    username: "openrelayproject",
    credential: "openrelayproject",
    credentialType: "password",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
    credentialType: "password",
  },
];

/**
 * Environment variable record shape used for TURN resolution.
 */
type TurnEnvRecord = Record<string, string | undefined>;

/**
 * Result of resolving TURN servers from the environment.
 */
export interface ResolveTurnServersResult {
  /** Resolved TURN server configurations (never empty). */
  servers: ICEServerConfig[];
  /**
   * `true` when servers came from the public fallback rather than env vars.
   * Consumers use this to decide whether to emit a configuration warning.
   */
  usedFallback: boolean;
  /**
   * Issue #1583 — when env-configured servers are in use, this records
   * which credential scheme produced them. Callers use this to decide
   * whether to apply HMAC credentials on top of the env-resolved set
   * (HMAC mode) or leave the static credentials as-is (legacy mode).
   */
  credentialScheme: "hmac" | "legacy-static" | "public-fallback";
}

/**
 * Resolve TURN servers from environment variables, falling back to public
 * relay servers so NAT traversal always has a relay option.
 *
 * Reads:
 *  - NEXT_PUBLIC_TURN_URL  (comma-separated list of turn:/turns: URLs)
 *  - NEXT_PUBLIC_TURN_USER (username shared across all URLs)
 *  - NEXT_PUBLIC_TURN_PASS (credential shared across all URLs)
 *
 * All three must be present to use env-configured servers; otherwise the
 * public fallback is used. Partial credentials are ignored to avoid
 * half-configured, broken relay attempts.
 *
 * Issue #1583 — legacy `NEXT_PUBLIC_TURN_*` credentials are deprecated.
 * The replacement is server-side HMAC minting under `TURN_HMAC_SECRET`
 * (see `./turn-hmac` and the `/api/signaling/turn-credentials` route).
 * `resolveTurnServers` continues to honour the legacy path for backward
 * compatibility but records `credentialScheme: 'legacy-static'` so the
 * warning layer (`warnIfLegacyStaticTurnCredentials`) can prompt the
 * operator to migrate. New deployments should NOT set
 * `NEXT_PUBLIC_TURN_PASS` — it is inlined into the client bundle by
 * Next.js (#1571) and exposes the long-term credential to anyone who
 * inspects the bundle.
 *
 * @param env Environment record (defaults to `process.env`).
 */
export function resolveTurnServers(
  env: TurnEnvRecord = process.env,
): ResolveTurnServersResult {
  const turnUrl = env.NEXT_PUBLIC_TURN_URL;
  const turnUser = env.NEXT_PUBLIC_TURN_USER;
  const turnPass = env.NEXT_PUBLIC_TURN_PASS;

  if (turnUrl && turnUser && turnPass) {
    const urls = turnUrl
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);

    if (urls.length > 0) {
      const servers: ICEServerConfig[] = urls.map((url) => ({
        urls: url,
        username: turnUser,
        credential: turnPass,
        credentialType: "password",
      }));
      return {
        servers,
        usedFallback: false,
        credentialScheme: "legacy-static",
      };
    }
  }

  return {
    servers: PUBLIC_FALLBACK_TURN_SERVERS.map((s) => ({ ...s })),
    usedFallback: true,
    credentialScheme: "public-fallback",
  };
}

/**
 * `true` when any of the legacy `NEXT_PUBLIC_TURN_*` credential
 * variables are set in the environment, even if incomplete.
 *
 * Used by issue #1583 to drive a startup warning that prompts the
 * operator to migrate to `TURN_HMAC_SECRET` (server-side) instead of
 * the deprecated client-inlined `NEXT_PUBLIC_TURN_PASS`.
 *
 * @param env Environment record (defaults to `process.env`).
 */
export function hasLegacyStaticTurnCredentials(
  env: TurnEnvRecord = process.env,
): boolean {
  return Boolean(
    env.NEXT_PUBLIC_TURN_USER ||
    env.NEXT_PUBLIC_TURN_PASS ||
    env.NEXT_PUBLIC_TURN_USERNAME ||
    env.NEXT_PUBLIC_TURN_CREDENTIAL,
  );
}

let legacyTurnWarningEmitted = false;

/**
 * Reset the one-time "legacy static TURN creds" warning guard.
 * Intended for tests.
 * @internal
 */
export function __resetLegacyTurnWarningGuard(): void {
  legacyTurnWarningEmitted = false;
}

/**
 * Issue #1583 — emit a one-time warning when any of the deprecated
 * `NEXT_PUBLIC_TURN_*` credential variables are present. The long-
 * term credential is inlined into the client bundle by Next.js
 * (#1571) and the issue calls for replacing it with server-side
 * `TURN_HMAC_SECRET` + per-session HMAC minting.
 */
export function warnIfLegacyStaticTurnCredentials(
  env: TurnEnvRecord = process.env,
  force = false,
): boolean {
  if (!hasLegacyStaticTurnCredentials(env)) return false;
  if (legacyTurnWarningEmitted && !force) return false;
  legacyTurnWarningEmitted = true;
  p2pLogger.warn(
    "[ICE] DEPRECATED: NEXT_PUBLIC_TURN_USER / NEXT_PUBLIC_TURN_PASS " +
      "(and *_USERNAME / *_CREDENTIAL) are set. These credentials are " +
      "inlined into the client bundle by Next.js (#1571) and ship the " +
      "long-term TURN password to every browser/Tauri shell. Migrate to " +
      "server-side TURN_HMAC_SECRET + per-session HMAC minting " +
      "(issue #1583, see src/lib/turn-hmac.ts and " +
      "/api/signaling/turn-credentials) so the secret never leaves the " +
      "server and every credential carries an embedded expiry (≤24h).",
  );
  return true;
}

let turnConfigWarningEmitted = false;

/**
 * Reset the one-time "no TURN env" warning guard. Intended for tests.
 * @internal
 */
export function __resetTurnWarningGuard(): void {
  turnConfigWarningEmitted = false;
}

/**
 * Emit a one-time warning when TURN servers are coming from the public
 * fallback rather than environment-configured infrastructure. This surfaces
 * the configuration gap called out by issue #983 so operators notice that
 * they should set their own TURN credentials for production reliability.
 *
 * @param result Resolution result from {@link resolveTurnServers}.
 * @param force Emit even if already emitted (use sparingly).
 */
export function warnIfNoEnvTurnConfigured(
  result: ResolveTurnServersResult,
  force = false,
): void {
  if (!result.usedFallback) return;
  if (turnConfigWarningEmitted && !force) return;
  turnConfigWarningEmitted = true;
  p2pLogger.warn(
    "[ICE] No TURN servers configured via NEXT_PUBLIC_TURN_URL / " +
      "NEXT_PUBLIC_TURN_USER / NEXT_PUBLIC_TURN_PASS. Falling back to public " +
      "OpenRelay TURN servers, which are rate-limited and not suitable for " +
      "production scale. Set these environment variables to your own TURN " +
      "infrastructure for reliable NAT traversal behind symmetric NATs.",
  );
}

/**
 * Default TURN servers - resolved from environment variables with a public
 * relay fallback so the array is never empty.
 *
 * Users behind symmetric NATs require TURN servers for connectivity; an empty
 * default (the previous behavior) caused 100% connection failure for them.
 * Set NEXT_PUBLIC_TURN_URL, NEXT_PUBLIC_TURN_USER, NEXT_PUBLIC_TURN_PASS to
 * override the public fallback with your own TURN infrastructure.
 */
export const DEFAULT_TURN_SERVERS: ICEServerConfig[] = (() => {
  const result = resolveTurnServers();
  warnIfNoEnvTurnConfigured(result);
  return result.servers;
})();

/**
 * ICE Configuration Manager
 * Manages ICE server configuration for WebRTC connections
 */
export class ICEConfigurationManager {
  private stunServers: ICEServerConfig[];
  private turnServers: ICEServerConfig[];
  private mode: ICEConnectionMode;
  private enableIPv6: boolean;
  private candidatePoolSize: number;
  private bundlePolicy: RTCBundlePolicy;
  private rtcpMuxPolicy: RTCRtcpMuxPolicy;

  constructor(options: ICEConfigOptions = {}) {
    this.mode = options.mode || "auto";
    this.stunServers = options.customStunServers || DEFAULT_STUN_SERVERS;
    this.turnServers = options.customTurnServers || DEFAULT_TURN_SERVERS;
    this.enableIPv6 = options.enableIPv6 ?? true;
    this.candidatePoolSize = options.candidatePoolSize ?? 10;
    this.bundlePolicy = options.bundlePolicy || "balanced";
    this.rtcpMuxPolicy = options.rtcpMuxPolicy || "require";
  }

  /**
   * Get RTCConfiguration for WebRTC
   */
  getRTCConfiguration(): RTCConfiguration {
    const iceServers = this.getICEServers();

    const config: RTCConfiguration = {
      iceServers,
      iceCandidatePoolSize: this.candidatePoolSize,
      bundlePolicy: this.bundlePolicy,
      rtcpMuxPolicy: this.rtcpMuxPolicy,
    };

    // Force relay mode if specified
    if (this.mode === "turn-relay") {
      config.iceTransportPolicy = "relay";
    }

    return config;
  }

  /**
   * Get ICE servers based on mode
   */
  private getICEServers(): RTCIceServer[] {
    const servers: RTCIceServer[] = [];

    switch (this.mode) {
      case "stun-only":
        servers.push(...this.stunServers);
        break;

      case "turn-relay":
        // Only TURN servers in relay mode
        servers.push(...this.turnServers);
        break;

      case "custom":
        // Use only custom servers
        servers.push(...this.stunServers, ...this.turnServers);
        break;

      case "auto":
      default:
        // Use both STUN and TURN
        servers.push(...this.stunServers);
        if (this.turnServers.length > 0) {
          servers.push(...this.turnServers);
        }
        break;
    }

    return servers;
  }

  /**
   * Add a STUN server
   */
  addStunServer(server: ICEServerConfig): void {
    this.stunServers.push(server);
  }

  /**
   * Add a TURN server
   */
  addTurnServer(server: ICEServerConfig): void {
    this.turnServers.push(server);
  }

  /**
   * Set connection mode
   */
  setMode(mode: ICEConnectionMode): void {
    this.mode = mode;
  }

  /**
   * Get current mode
   */
  getMode(): ICEConnectionMode {
    return this.mode;
  }

  /**
   * Set TURN credentials
   */
  setTurnCredentials(username: string, credential: string): void {
    this.turnServers = this.turnServers.map((server) => ({
      ...server,
      username,
      credential,
    }));
  }

  /**
   * Issue #1583 — apply a freshly minted short-lived HMAC credential
   * to every configured TURN server atomically. The credential was
   * minted server-side under `TURN_HMAC_SECRET` (see
   * `src/app/api/signaling/turn-credentials/` and `src/lib/turn-hmac.ts`).
   *
   * Pass the {@link TurnCredential} returned by either the server
   * route or `mintTurnCredential` directly:
   *
   * ```ts
   * const fresh = await fetchTurnCredentials();
   * manager.applyHmacCredentials(fresh);
   * // any subsequent getRTCConfiguration() / getICEServers() call
   * // surfaces the new username + credential on every TURN entry.
   * ```
   *
   * `urls` is an optional allow-list: when supplied, only TURN servers
   * whose `urls` field matches one of the entries receive the new
   * credentials. Used by the server route to mint per-URL credentials
   * so that an operator running multiple TURN clusters behind the
   * same secret still gets distinct credentials per cluster.
   *
   * Returns the number of TURN servers that received the rotation.
   */
  applyHmacCredentials(
    credential: TurnCredential,
    options: { urls?: ReadonlyArray<string | string[]> } = {},
  ): number {
    if (
      !credential ||
      typeof credential.username !== "string" ||
      typeof credential.credential !== "string"
    ) {
      throw new Error(
        "applyHmacCredentials requires a TurnCredential with username + credential",
      );
    }
    const matchesUrl = (serverUrl: string | string[]): boolean => {
      if (!options.urls || options.urls.length === 0) return true;
      const candidates = Array.isArray(serverUrl) ? serverUrl : [serverUrl];
      return options.urls.some((allowed) => {
        const allowedList = Array.isArray(allowed) ? allowed : [allowed];
        return allowedList.some((a) => candidates.includes(a));
      });
    };
    let rotated = 0;
    this.turnServers = this.turnServers.map((server) => {
      if (!matchesUrl(server.urls)) return server;
      rotated += 1;
      return {
        ...server,
        username: credential.username,
        credential: credential.credential,
        credentialType: "password",
      };
    });
    return rotated;
  }

  /**
   * Check if TURN is configured
   */
  hasTurnServers(): boolean {
    return this.turnServers.length > 0;
  }

  /**
   * Get STUN servers
   */
  getStunServers(): ICEServerConfig[] {
    return [...this.stunServers];
  }

  /**
   * Get TURN servers
   */
  getTurnServers(): ICEServerConfig[] {
    return [...this.turnServers];
  }

  /**
   * Create a configuration for testing connectivity
   */
  static createTestConfiguration(): RTCConfiguration {
    return {
      iceServers: DEFAULT_STUN_SERVERS,
      iceCandidatePoolSize: 10,
    };
  }
}

/**
 * ICE Connection State Monitor
 * Monitors ICE connection states and provides fallback handling
 */
export class ICEConnectionMonitor {
  private connection: RTCPeerConnection | null = null;
  private onStateChange?: (state: RTCIceConnectionState) => void;
  private onFailed?: () => void;
  private onConnected?: () => void;
  private onDisconnected?: () => void;
  private failureTimeout: ReturnType<typeof setTimeout> | null = null;
  private failureTimeoutMs: number;

  constructor(
    options: {
      onStateChange?: (state: RTCIceConnectionState) => void;
      onFailed?: () => void;
      onConnected?: () => void;
      onDisconnected?: () => void;
      failureTimeoutMs?: number;
    } = {},
  ) {
    this.onStateChange = options.onStateChange;
    this.onFailed = options.onFailed;
    this.onConnected = options.onConnected;
    this.onDisconnected = options.onDisconnected;
    this.failureTimeoutMs = options.failureTimeoutMs || 30000; // 30 seconds default
  }

  /**
   * Attach to a peer connection
   */
  attach(connection: RTCPeerConnection): void {
    this.detach();
    this.connection = connection;

    connection.oniceconnectionstatechange = () => {
      this.handleStateChange();
    };
  }

  /**
   * Detach from current connection
   */
  detach(): void {
    if (this.connection) {
      this.connection.oniceconnectionstatechange = null;
      this.connection = null;
    }
    this.clearFailureTimeout();
  }

  /**
   * Handle ICE state changes
   */
  private handleStateChange(): void {
    if (!this.connection) return;

    const state = this.connection.iceConnectionState;
    p2pLogger.info("[ICE] Connection state:", state);

    this.onStateChange?.(state);

    switch (state) {
      case "connected":
      case "completed":
        this.clearFailureTimeout();
        this.onConnected?.();
        break;

      case "disconnected":
        this.startFailureTimeout();
        this.onDisconnected?.();
        break;

      case "failed":
        this.clearFailureTimeout();
        this.onFailed?.();
        break;

      case "closed":
        this.clearFailureTimeout();
        break;
    }
  }

  /**
   * Start failure timeout
   */
  private startFailureTimeout(): void {
    this.clearFailureTimeout();
    this.failureTimeout = setTimeout(() => {
      p2pLogger.info("[ICE] Connection timeout - considering failed");
      this.onFailed?.();
    }, this.failureTimeoutMs);
  }

  /**
   * Clear failure timeout
   */
  private clearFailureTimeout(): void {
    if (this.failureTimeout) {
      clearTimeout(this.failureTimeout);
      this.failureTimeout = null;
    }
  }

  /**
   * Get current state
   */
  getState(): RTCIceConnectionState | null {
    return this.connection?.iceConnectionState || null;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    const state = this.getState();
    return state === "connected" || state === "completed";
  }
}

/**
 * ICE Candidate Filter
 * Filters ICE candidates based on configuration
 */
export class ICECandidateFilter {
  private allowIPv6: boolean;
  private allowLoopback: boolean;
  private allowLinkLocal: boolean;

  constructor(
    options: {
      allowIPv6?: boolean;
      allowLoopback?: boolean;
      allowLinkLocal?: boolean;
    } = {},
  ) {
    this.allowIPv6 = options.allowIPv6 ?? true;
    this.allowLoopback = options.allowLoopback ?? false;
    this.allowLinkLocal = options.allowLinkLocal ?? false;
  }

  /**
   * Filter an ICE candidate
   */
  filter(candidate: RTCIceCandidate): RTCIceCandidate | null {
    // Check IPv6
    if (
      !this.allowIPv6 &&
      this.isIPv6(candidate.address || candidate.candidate)
    ) {
      return null;
    }

    // Check loopback
    if (
      !this.allowLoopback &&
      this.isLoopback(candidate.address || candidate.candidate)
    ) {
      return null;
    }

    // Check link-local
    if (
      !this.allowLinkLocal &&
      this.isLinkLocal(candidate.address || candidate.candidate)
    ) {
      return null;
    }

    return candidate;
  }

  /**
   * Check if address is IPv6
   */
  private isIPv6(address: string | null): boolean {
    if (!address) return false;
    return address.includes(":");
  }

  /**
   * Check if address is loopback
   */
  private isLoopback(address: string | null): boolean {
    if (!address) return false;
    return (
      address === "127.0.0.1" || address === "::1" || address === "localhost"
    );
  }

  /**
   * Check if address is link-local
   */
  private isLinkLocal(address: string | null): boolean {
    if (!address) return false;
    return (
      address.startsWith("169.254.") ||
      address.startsWith("fe80:") ||
      address.startsWith("fe80::")
    );
  }
}

/**
 * Create default ICE configuration
 */
export function createDefaultICEConfiguration(): RTCConfiguration {
  const manager = new ICEConfigurationManager();
  return manager.getRTCConfiguration();
}

/**
 * Create ICE configuration with TURN servers
 */
export function createICEConfigurationWithTurn(
  turnServers: ICEServerConfig[],
  stunServers?: ICEServerConfig[],
): RTCConfiguration {
  const manager = new ICEConfigurationManager({
    customStunServers: stunServers,
    customTurnServers: turnServers,
    mode: "auto",
  });
  return manager.getRTCConfiguration();
}

/**
 * Create relay-only ICE configuration
 */
export function createRelayOnlyConfiguration(
  turnServers: ICEServerConfig[],
): RTCConfiguration {
  const manager = new ICEConfigurationManager({
    customTurnServers: turnServers,
    mode: "turn-relay",
  });
  return manager.getRTCConfiguration();
}

// Singleton instance for app-wide configuration
let globalICEManager: ICEConfigurationManager | null = null;

/**
 * Get global ICE configuration manager
 */
export function getGlobalICEManager(): ICEConfigurationManager {
  if (!globalICEManager) {
    globalICEManager = new ICEConfigurationManager();
  }
  return globalICEManager;
}

/**
 * Set global ICE configuration
 */
export function setGlobalICEConfiguration(options: ICEConfigOptions): void {
  globalICEManager = new ICEConfigurationManager(options);
}

// ────────────────────────────────────────────────────────────────────────
// Issue #1583 — client-side fetch of short-lived TURN HMAC credentials.
//
// The server-side `/api/signaling/turn-credentials/` route mints the
// `{username, credential}` pair under `TURN_HMAC_SECRET`. The secret
// never leaves the server. The client calls this helper once per
// session (or after a session restart) and feeds the result to
// `ICEConfigurationManager.applyHmacCredentials` so the next
// `getRTCConfiguration()` call surfaces the time-boxed credential on
// every configured TURN entry.
// ────────────────────────────────────────────────────────────────────────

/**
 * Default path of the HMAC mint endpoint. Overridable per-call so
 * tests can target a synthetic URL.
 */
export const DEFAULT_TURN_HMAC_ENDPOINT = "/api/signaling/turn-credentials";

/**
 * Issue #1583 — fetch a fresh short-lived HMAC TURN credential from
 * the server. Returns the {@link TurnCredential} ready to hand to
 * `ICEConfigurationManager.applyHmacCredentials`.
 *
 * Failure modes (issue #1583 acceptance criterion: the raw secret
 * must never leak to the client):
 *   - Non-2xx response: throws with the status code in the message.
 *     The 503 in particular means the server is not configured with
 *     `TURN_HMAC_SECRET` and the operator needs to migrate. The
 *     caller should treat this as "fall back to public OpenRelay"
 *     (the legacy default) rather than retrying.
 *   - Malformed JSON: throws.
 *   - Missing fields: throws.
 *
 * `clientId` defaults to a fresh random hex string so each call gets
 * a distinct credential. Pass an explicit one when the peer-id is
 * already known so the credential can be linked to the lobby/peer.
 */
export async function fetchTurnHmacCredential(
  options: {
    /** Per-session client identifier (peer-id / session-id). */
    clientId?: string;
    /** Override the endpoint URL (default: `/api/signaling/turn-credentials`). */
    endpoint?: string;
    /** Custom fetch implementation (tests). Defaults to `globalThis.fetch`. */
    fetchImpl?: typeof fetch;
  } = {},
): Promise<TurnCredential> {
  const endpoint = options.endpoint ?? DEFAULT_TURN_HMAC_ENDPOINT;
  const clientId =
    options.clientId ??
    (typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
      ? (() => {
          const bytes = new Uint8Array(16);
          crypto.getRandomValues(bytes);
          let s = "";
          for (let i = 0; i < bytes.length; i++) {
            s += bytes[i].toString(16).padStart(2, "0");
          }
          return s;
        })()
      : `peer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  const fetchImpl: typeof fetch =
    options.fetchImpl ??
    (typeof fetch === "function"
      ? (fetch as typeof fetch)
      : (() => {
          throw new Error("fetch is not available in this environment");
        })());

  const url = `${endpoint}?clientId=${encodeURIComponent(clientId)}`;
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `fetchTurnHmacCredential: server returned HTTP ${response.status}` +
        (response.status === 503
          ? " (server is not configured with TURN_HMAC_SECRET — see issue #1583)"
          : ""),
    );
  }
  const raw = (await response.json()) as Record<string, unknown>;
  if (
    typeof raw.username !== "string" ||
    typeof raw.credential !== "string" ||
    typeof raw.expiresAtEpochSeconds !== "number" ||
    typeof raw.clientId !== "string"
  ) {
    throw new Error(
      "fetchTurnHmacCredential: malformed response — missing username/credential/expiresAtEpochSeconds/clientId",
    );
  }
  return {
    username: raw.username,
    credential: raw.credential,
    expiresAtEpochSeconds: raw.expiresAtEpochSeconds,
    clientId: raw.clientId,
  };
}

// Silence the "unused" warning when the build only imports types.
export type { TurnCredential } from "./turn-hmac";
export { TURN_CREDENTIAL_DEFAULT_TTL_SECONDS } from "./turn-hmac";

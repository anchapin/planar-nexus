/**
 * Per-peer P2P reconnect-token store (issue #1254).
 *
 * The WebRTC layer (host migration #946, ICE restart #915) handles IN-SESSION
 * disconnects — lost network, tab-backgrounded, brief OS sleep. It does NOT
 * survive a full browser refresh or a Tauri window restart: the per-peer
 * `peerId`, the session key, the host's `peerId`, the game code, and the
 * `lastDeliveredSeq` (#1091) are all held in JS memory only.
 *
 * This module persists the minimum data needed to silently rejoin the same
 * game/seat after a refresh. The token is keyed by `${gameCode}::${peerId}`
 * so it is scoped to a single (game, peer) pair — a peer cannot reuse a
 * token for a different game, and the host-side seat reservation
 * (issue #1255 / `LobbyManager.holdSeatForRejoin`) can match on `peerId`.
 *
 * Tokens auto-expire 30 minutes after game end. The store is the source of
 * truth for expiry — the store API hides expired entries so the rest of the
 * system never has to think about TTLs.
 */

import { logger } from "./logger";

const p2pLogger = logger.child("P2PReconnectStore");

/**
 * Maximum lifetime of a reconnect token AFTER it has been issued. We use a
 * single TTL regardless of game-end timing because we have no reliable
 * "game-ended" signal on the client (a host disconnect can mean a crash,
 * not a graceful end). 30 minutes is long enough for a quick browser
 * refresh / Tauri window restart but short enough that an abandoned
 * token does not hold a seat hostage indefinitely.
 *
 * The host-side `LobbyManager` seat hold (`LOBBY_SEAT_HOLD_DURATION_MS`,
 * issue #1255) is the same 30 s window used during the actual rejoin
 * attempt; the 30-minute token TTL is a separate "is this peer allowed
 * to claim this seat at all" gate.
 */
export const RECONNECT_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Reconnect token persisted across a browser refresh / Tauri restart so a
 * peer can silently rejoin the same game + seat (issue #1254).
 *
 * Fields are deliberately minimal — anything that can be reconstructed
 * from the live session (game-state snapshots, deck lists) is NOT
 * persisted here. The token only carries the identifiers + sequence
 * high-water mark needed to reattach to the existing P2P session.
 */
export interface ReconnectToken {
  /**
   * Composite primary key: `${gameCode}::${peerId}`. Stored on the
   * `id` field so the object store can keyPath it directly.
   */
  id: string;
  /** The local peer's stable id. Re-issued tokens keep the same id. */
  peerId: string;
  /** Per-session shared secret. Required for the silent-rejoin handshake. */
  sessionKey: string;
  /** The current authoritative host's `peerId`. May be a successor if the
   * original host migrated (#946). */
  hostPeerId: string;
  /** Game code the token is scoped to. Tokens are NOT transferable across
   * games (issue #1254 acceptance criteria). */
  gameCode: string;
  /**
   * Highest sequence number the local peer had applied (#1091) at the
   * time the token was issued. The reconnect handshake replays any
   * messages with `seq > lastDeliveredSeq` so the reattaching peer
   * catches up without double-applying anything below the high-water
   * mark.
   */
  lastDeliveredSeq: number;
  /** Wall-clock ms when the token was first issued (ISO ms epoch). */
  issuedAt: number;
  /** Wall-clock ms when the token expires and is auto-purged. */
  expiresAt: number;
  /** Optional human-readable player name for UI surfaces (the lobby
   * page uses it to show "Reconnecting as {playerName}…"). */
  playerName?: string;
}

/**
 * Stable key derived from the game code + peer id. Exposed so tests
 * and consumers can compute the same id without duplicating the
 * separator choice.
 */
export function getReconnectTokenKey(
  gameCode: string,
  peerId: string,
): string {
  return `${gameCode}::${peerId}`;
}

/**
 * True when `now` is past the token's `expiresAt`. The store API hides
 * expired tokens from `get()` so callers never have to invoke this
 * directly — it is exported for tests and for code that wants to surface
 * "your reconnect window expired" messaging to the UI.
 */
export function isReconnectTokenExpired(
  token: ReconnectToken,
  now: number = Date.now(),
): boolean {
  return token.expiresAt <= now;
}

/**
 * IndexedDB-backed reconnect-token store (issue #1254).
 *
 * Uses a DEDICATED database (`PlanarNexusReconnectTokens`) rather than the
 * main `PlanarNexusStorage` database so:
 *   - the schema migration in `indexeddb-storage.ts` is not coupled to
 *     this feature
 *   - the token store can be wiped independently (e.g. "sign out" can
 *     flush reconnect state without touching decks / saved games)
 *   - tests can run against the real fake-indexeddb without colliding
 *     with the main DB
 *
 * All methods are idempotent and never throw to the caller — connectivity
 * errors (private-mode browsers, quota exhaustion, browser without IDB) are
 * logged and surfaced as `null` / `false` so the calling code can fall
 * through to the lobby UI without erroring.
 */
export class ReconnectTokenStore {
  private readonly dbName: string;
  private readonly version: number;
  private readonly storeName: string;
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase | null> | null = null;

  constructor(options?: {
    dbName?: string;
    version?: number;
    storeName?: string;
  }) {
    this.dbName = options?.dbName ?? "PlanarNexusReconnectTokens";
    this.version = options?.version ?? 1;
    this.storeName = options?.storeName ?? "tokens";
  }

  /**
   * Open the database. Safe to call multiple times — concurrent callers
   * share a single in-flight open promise.
   */
  private async openDb(): Promise<IDBDatabase | null> {
    if (this.db) return this.db;
    if (this.openPromise) return this.openPromise;

    if (typeof indexedDB === "undefined") {
      p2pLogger.warn("IndexedDB unavailable; reconnect-token store disabled");
      return null;
    }

    this.openPromise = new Promise<IDBDatabase | null>((resolve) => {
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(this.dbName, this.version);
      } catch (err) {
        p2pLogger.warn("Failed to open reconnect-token DB", String(err));
        this.openPromise = null;
        resolve(null);
        return;
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.openPromise = null;
        resolve(request.result);
      };

      request.onerror = () => {
        p2pLogger.warn(
          "Reconnect-token DB open error",
          String(request.error),
        );
        this.openPromise = null;
        resolve(null);
      };

      request.onblocked = () => {
        p2pLogger.warn("Reconnect-token DB open blocked by another tab");
      };
    });

    return this.openPromise;
  }

  /**
   * Persist (or replace) a reconnect token. Sets `issuedAt` (defaults
   * to `Date.now()`) and `expiresAt` (defaults to
   * `issuedAt + RECONNECT_TOKEN_TTL_MS`) when the caller does not
   * supply them.
   *
   * No-op (returns false) when IDB is unavailable; the caller's fall
   * through to the lobby UI is then the correct UX.
   */
  async save(
    input: Omit<ReconnectToken, "id" | "issuedAt" | "expiresAt"> &
      Partial<Pick<ReconnectToken, "issuedAt" | "expiresAt">>,
  ): Promise<boolean> {
    const db = await this.openDb();
    if (!db) return false;

    const issuedAt = input.issuedAt ?? Date.now();
    const expiresAt =
      input.expiresAt ?? issuedAt + RECONNECT_TOKEN_TTL_MS;
    const id = getReconnectTokenKey(input.gameCode, input.peerId);
    const token: ReconnectToken = {
      id,
      peerId: input.peerId,
      sessionKey: input.sessionKey,
      hostPeerId: input.hostPeerId,
      gameCode: input.gameCode,
      lastDeliveredSeq: input.lastDeliveredSeq,
      issuedAt,
      expiresAt,
      playerName: input.playerName,
    };

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        const request = store.put(token);
        request.onsuccess = () => resolve(true);
        request.onerror = () => {
          p2pLogger.warn(
            "Failed to persist reconnect token",
            String(request.error),
          );
          resolve(false);
        };
      } catch (err) {
        p2pLogger.warn("Failed to persist reconnect token", String(err));
        resolve(false);
      }
    });
  }

  /**
   * Look up a token by game code + peer id. Returns `null` when:
   *   - no token exists
   *   - the stored token has expired (and is purged as a side effect)
   *   - IndexedDB is unavailable
   *
   * Tokens are scoped to the (gameCode, peerId) pair so a token cannot be
   * reused for a different game (issue #1254 acceptance criteria).
   */
  async get(
    gameCode: string,
    peerId: string,
  ): Promise<ReconnectToken | null> {
    const db = await this.openDb();
    if (!db) return null;

    const id = getReconnectTokenKey(gameCode, peerId);

    return new Promise<ReconnectToken | null>((resolve) => {
      try {
        const tx = db.transaction(this.storeName, "readonly");
        const store = tx.objectStore(this.storeName);
        const request = store.get(id);
        request.onsuccess = () => {
          const token = request.result as ReconnectToken | undefined;
          if (!token) {
            resolve(null);
            return;
          }
          if (isReconnectTokenExpired(token)) {
            // Lazy purge so a stale token does not linger in storage.
            this.delete(gameCode, peerId).catch(() => {
              /* best-effort */
            });
            resolve(null);
            return;
          }
          // Defensive check: the key encodes both gameCode and peerId so
          // they should match, but refuse the token if they diverge —
          // otherwise a corrupted entry could let a peer reuse a token
          // across games (issue #1254 AC).
          if (token.gameCode !== gameCode || token.peerId !== peerId) {
            p2pLogger.warn(
              "Discarding reconnect token with mismatched key fields",
              { tokenGame: token.gameCode, tokenPeer: token.peerId },
            );
            this.delete(gameCode, peerId).catch(() => {
              /* best-effort */
            });
            resolve(null);
            return;
          }
          resolve(token);
        };
        request.onerror = () => {
          p2pLogger.warn(
            "Failed to read reconnect token",
            String(request.error),
          );
          resolve(null);
        };
      } catch (err) {
        p2pLogger.warn("Failed to read reconnect token", String(err));
        resolve(null);
      }
    });
  }

  /**
   * Delete a token by game code + peer id. No-op when the token does
   * not exist. Returns `true` when the delete succeeded or there was
   * nothing to delete.
   */
  async delete(gameCode: string, peerId: string): Promise<boolean> {
    const db = await this.openDb();
    if (!db) return false;

    const id = getReconnectTokenKey(gameCode, peerId);

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        const request = store.delete(id);
        request.onsuccess = () => resolve(true);
        request.onerror = () => {
          p2pLogger.warn(
            "Failed to delete reconnect token",
            String(request.error),
          );
          resolve(false);
        };
      } catch (err) {
        p2pLogger.warn("Failed to delete reconnect token", String(err));
        resolve(false);
      }
    });
  }

  /**
   * Sweep all expired tokens. Returns the number of tokens purged.
   * Useful to wire to a low-frequency timer (e.g. lobby mount) so the
   * store does not accumulate stale entries.
   */
  async purgeExpired(now: number = Date.now()): Promise<number> {
    const db = await this.openDb();
    if (!db) return 0;

    return new Promise<number>((resolve) => {
      try {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        const request = store.openCursor();
        let removed = 0;
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(removed);
            return;
          }
          const token = cursor.value as ReconnectToken;
          if (isReconnectTokenExpired(token, now)) {
            cursor.delete();
            removed += 1;
          }
          cursor.continue();
        };
        request.onerror = () => {
          p2pLogger.warn(
            "Failed to purge expired reconnect tokens",
            String(request.error),
          );
          resolve(removed);
        };
      } catch (err) {
        p2pLogger.warn("Failed to purge expired reconnect tokens", String(err));
        resolve(0);
      }
    });
  }

  /**
   * Drop every token for a game (e.g. on game end). Returns the number
   * of tokens purged. Host-side callers should invoke this when the
   * lobby transitions to ENDED (issue #1254 AC: "Tokens auto-expire 30
   * minutes after game end" — dropping on ENDED short-circuits the
   * 30-minute TTL for clean shutdowns).
   */
  async clearForGame(gameCode: string): Promise<number> {
    const db = await this.openDb();
    if (!db) return 0;

    return new Promise<number>((resolve) => {
      try {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        const request = store.openCursor();
        let removed = 0;
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(removed);
            return;
          }
          const token = cursor.value as ReconnectToken;
          if (token.gameCode === gameCode) {
            cursor.delete();
            removed += 1;
          }
          cursor.continue();
        };
        request.onerror = () => {
          p2pLogger.warn(
            "Failed to clear reconnect tokens for game",
            String(request.error),
          );
          resolve(removed);
        };
      } catch (err) {
        p2pLogger.warn(
          "Failed to clear reconnect tokens for game",
          String(err),
        );
        resolve(0);
      }
    });
  }

  /**
   * Wipe the entire store. Used by "sign out" / "reset multiplayer
   * state" affordances that should not affect decks or saved games.
   */
  async clearAll(): Promise<boolean> {
    const db = await this.openDb();
    if (!db) return false;

    return new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        const request = store.clear();
        request.onsuccess = () => resolve(true);
        request.onerror = () => {
          p2pLogger.warn(
            "Failed to clear reconnect-token store",
            String(request.error),
          );
          resolve(false);
        };
      } catch (err) {
        p2pLogger.warn("Failed to clear reconnect-token store", String(err));
        resolve(false);
      }
    });
  }

  /**
   * Close the database connection. Safe to call when not open.
   */
  close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch (err) {
        p2pLogger.warn("Failed to close reconnect-token DB", String(err));
      }
      this.db = null;
    }
    this.openPromise = null;
  }
}

/**
 * Default shared instance. Tests that need an isolated store should
 * instantiate their own with a unique `dbName`.
 */
export const reconnectTokenStore = new ReconnectTokenStore();

/**
 * Issue #1254 — convenience helper that pulls a token from the default
 * store. Returns `null` when the token is missing, expired, or stored
 * for a different (gameCode, peerId) pair. Used by
 * `useP2PConnection` on mount to attempt a silent rejoin before
 * falling through to the lobby UI.
 */
export async function lookupReconnectToken(
  gameCode: string,
  peerId: string,
): Promise<ReconnectToken | null> {
  return reconnectTokenStore.get(gameCode, peerId);
}
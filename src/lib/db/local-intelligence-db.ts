import Dexie, { type EntityTable } from "dexie";

export interface Embedding {
  id?: number;
  cardId: string;
  model: string;
  vector: number[] | Float32Array;
}

export interface OramaSnapshot {
  id: string;
  data: any;
  timestamp: number;
}

export interface GameHistory {
  id?: number;
  timestamp: number;
  type: string;
  data: any;
}

export interface PlayerDecision {
  id?: number;
  gameId: string;
  timestamp: number;
  decision: any;
  context: any;
}

export interface GameEmbedding {
  id?: number;
  gameId: string;
  model: string;
  vector: number[] | Float32Array;
  createdAt: number;
}

/**
 * One row per (gameId, playerId) — the local player's perspective on a
 * completed P2P match (issue #1570). Persisted from the `game-ended`
 * `GameMessage` so completed games show up in match history without
 * requiring a server-side BaaS.
 *
 * Key shape is `${gameId}@${playerId}` (see {@link getMatchRecordKey})
 * so:
 *   - the same game is keyed identically across re-broadcasts (host
 *     migration / ICE-restart reconnect, both of which are gated by the
 *     `#1091` anti-replay `seq` check at the transport layer). A duplicate
 *     `game-ended` delivery results in a single Dexie row.
 *   - every peer writes exactly one row per game, indexed by their OWN
 *     `playerId`, so two peers in the same game have separate rows even
 *     though they share the `gameId`.
 */
export interface MatchRecord {
  /**
   * Composite primary key `${gameId}@${playerId}` (issue #1570). Indexed
   * automatically by Dexie's `keyPath` directive on the store.
   */
  id: string;
  /** Opaque match identifier, stable across host migration. */
  gameId: string;
  /** The local player's peerId. */
  playerId: string;
  /** The local player's display name (snapshot at game-end). */
  playerName: string;
  /** Wall-clock ms when the match opened. */
  startedAt: number;
  /** Wall-clock ms when the host declared the game over. */
  endedAt: number;
  /** Derived `endedAt - startedAt`, persisted for cheap read paths. */
  durationMs: number;
  /** Game-format string (`"commander"`, `"standard"`, …). */
  format: string;
  /** Short machine-readable cause (`"concede"`, `"life-zero"`, …). */
  endReason: string;
  /**
   * Final rank for the LOCAL player — `1` is the winner, larger numbers
   * are losing finishes. Stored as `number` so the existing
   * `use-social.ts` `getWinRateFromHistory` aggregation can compute
   * win/loss/draw buckets without re-parsing the payload.
   */
  position: number;
  /** True iff `winnerId === playerId`. */
  isWinner: boolean;
  /** Final life total (or `null` when life is not the relevant axis). */
  finalLife: number | null;
  /**
   * The full `standings` array from the `game-ended` payload, snapshot
   * at receive time. Persisted for inspection / future cohort analytics
   * — the per-peer derivation only reads `position` / `isWinner`.
   */
  standings: ReadonlyArray<{
    playerId: string;
    playerName: string;
    position: number;
    life: number | null;
  }>;
}

/**
 * Stable key derived from the game id + player id (issue #1570). Exposed
 * so tests and consumers can compute the same id without duplicating the
 * separator choice. The `@` separator was chosen because neither `gameId`
 * nor `playerId` is allowed to contain it (UUIDs / hex ids / Scryfall
 * slugs are alphanumeric / `-` / `_`), so collisions are structurally
 * impossible.
 */
export function getMatchRecordKey(gameId: string, playerId: string): string {
  return `${gameId}@${playerId}`;
}

/**
 * Local database for storing embeddings, search index snapshots,
 * game history, and player decisions.
 */
export class LocalIntelligenceDB extends Dexie {
  // Define tables with EntityTable for better type safety in Dexie 4+
  embeddings!: EntityTable<Embedding, "id">;
  orama_snapshots!: EntityTable<OramaSnapshot, "id">;
  game_history!: EntityTable<GameHistory, "id">;
  player_decisions!: EntityTable<PlayerDecision, "id">;
  game_embeddings!: EntityTable<GameEmbedding, "id">;
  /**
   * Issue #1570 — local per-player match-history rows keyed by
   * `${gameId}@${playerId}` (see {@link getMatchRecordKey}). Written from
   * the `game-ended` GameMessage handler in `use-p2p-connection.ts`.
   */
  match_records!: EntityTable<MatchRecord, "id">;

  constructor() {
    super("LocalIntelligenceDB");

    // Define the schema using the plan's exact definitions
    this.version(1).stores({
      embeddings: "++id, cardId, [cardId+model], vector",
      orama_snapshots: "id, data, timestamp",
      game_history: "++id, timestamp, type, data",
      player_decisions: "++id, gameId, timestamp, decision, context",
    });

    // Version 2: Add game_embeddings table for semantic game search
    this.version(2).stores({
      game_embeddings: "++id, gameId, [gameId+model], createdAt",
    });

    // Version 3 (issue #1570): Add match_records table for local
    // match-history persistence. The previous `version(1)` and
    // `version(2)` migrations above MUST stay intact — Dexie replays
    // them in order when opening an older database at v3, and removing
    // a historical version is a silent data-loss bug.
    //
    // Indexes:
    //   - `gameId`           — "show me every local row for this game"
    //                          (paranoia / future cross-player analytics).
    //   - `playerId`         — "show me every match for this player"
    //                          (the common match-history read path).
    //   - `[playerId+endedAt]` — sorted scan for the per-player timeline
    //                          (e.g. "last 10 matches for player X").
    //   - `endedAt`          — global chronological scan.
    //   - `position`         — quick "how often did I win?" aggregation
    //                          without reading `standings`.
    //   - `format`           — per-format win-rate derivation (the
    //                          existing `use-social.ts` `formatWinRates`
    //                          use case).
    this.version(3).stores({
      match_records:
        "id, gameId, playerId, [playerId+endedAt], endedAt, position, format",
    });
  }
}

// Export a singleton instance
export const db = new LocalIntelligenceDB();

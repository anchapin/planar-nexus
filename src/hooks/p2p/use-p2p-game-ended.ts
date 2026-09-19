/**
 * Issue #1570 — game-ended persistence + state for the P2P hook.
 *
 * Owns the `gameEnded` React state and the Dexie `match_records` write
 * performed when the host broadcasts a `game-ended` payload. Extracted from
 * `src/hooks/use-p2p-connection.ts` (issue #1927).
 *
 * Wired into both `initializeAsHost` and `initializeAsJoiner` via the
 * transport's `onGameEnded` event. The transport's anti-replay check
 * (issue #1091) deduplicates a re-delivered `game-ended` BEFORE this
 * runs, so the same `gameId` is written at most once per local peer.
 * This Dexie `match_records` write is the ONLY writer of P2P match
 * history (issue #1863); consumers must read from `match_records`
 * rather than any `useLocalStorage` mirror.
 *
 * A peer that is NOT listed in the payload's `standings` (e.g. a
 * spectator who watched but did not play) still receives the event for
 * UI banners but does NOT persist a `MatchRecord` — match history is a
 * player-facing concept. The latest payload is surfaced via state so
 * downstream consumers can pick it up.
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import {
  db as localIntelligenceDb,
  getMatchRecordKey,
  type MatchRecord,
} from "@/lib/db/local-intelligence-db";
import type { GameEndedPayload } from "@/lib/p2p-game-connection";

const p2pLogger = logger.child("P2PConnection");

export interface UseP2PGameEndedResult {
  /** Latest `game-ended` payload, or `null` until the first terminal event. */
  gameEnded: GameEndedPayload | null;
  /** Stable connection-event handler (`useCallback([])` — refs only). */
  handleGameEnded: (payload: GameEndedPayload) => Promise<void>;
  /** Reset the surfaced payload (used by `closeConnection`). */
  resetGameEnded: () => void;
}

export function useP2PGameEnded(options: {
  playerId: string;
  playerName: string;
}): UseP2PGameEndedResult {
  const { playerId, playerName } = options;

  const [gameEnded, setGameEnded] = useState<GameEndedPayload | null>(null);
  // Mirrors `playerId` / `playerName` into refs so the once-created
  // `onGameEnded` connection handler reads the latest identity without
  // re-binding the connection on every identity change.
  const playerIdRef = useRef(playerId);
  const playerNameRef = useRef(playerName);
  playerIdRef.current = playerId;
  playerNameRef.current = playerName;

  const handleGameEnded = useCallback(async (payload: GameEndedPayload) => {
    // 1. Update React state regardless of whether the local player was
    //    in the standings (spectators need the "Game Over" banner).
    setGameEnded(payload);

    // 2. Find the local player's standing. If they were not a participant
    //    (spectator / observer), skip persistence.
    const localPlayerId = playerIdRef.current;
    const localStanding = payload.standings.find(
      (s) => s.playerId === localPlayerId,
    );
    if (!localStanding) {
      p2pLogger.debug(
        "[use-p2p-Connection] game-ended received but local player is not in standings; skipping MatchRecord write",
        { gameId: payload.gameId, localPlayerId },
      );
      return;
    }

    // 3. Build + persist the local-perspective MatchRecord. The Dexie
    //    `put` is upsert-on-key so a re-delivery that somehow slipped
    //    past anti-replay (e.g. across an ICE-restart that reset the
    //    high-water mark before the original `game-ended` was applied)
    //    STILL results in exactly one row per (gameId, playerId). The
    //    primary path is still the seq check (#1091) — this is defense
    //    in depth, not the primary dedup mechanism.
    const record: MatchRecord = {
      id: getMatchRecordKey(payload.gameId, localPlayerId),
      gameId: payload.gameId,
      playerId: localPlayerId,
      playerName: localStanding.playerName || playerNameRef.current,
      startedAt: payload.startedAt,
      endedAt: payload.endedAt,
      durationMs: payload.endedAt - payload.startedAt,
      format: payload.format,
      endReason: payload.endReason,
      position: localStanding.position,
      isWinner: payload.winnerId === localPlayerId,
      finalLife: localStanding.life,
      standings: payload.standings,
    };
    try {
      await localIntelligenceDb.match_records.put(record);
      p2pLogger.info(
        "[use-p2p-Connection] Persisted MatchRecord from game-ended",
        {
          gameId: payload.gameId,
          playerId: localPlayerId,
          position: localStanding.position,
          isWinner: record.isWinner,
        },
      );
    } catch (err) {
      // Persistence is best-effort: the live session keeps working even
      // when IDB is unavailable / quota-exhausted. Match history will
      // miss this entry, which is preferable to crashing the multiplayer
      // UI.
      p2pLogger.warn(
        "[use-p2p-Connection] Failed to persist MatchRecord; live session unaffected",
        String(err),
      );
    }
  }, []);

  const resetGameEnded = useCallback(() => {
    setGameEnded(null);
  }, []);

  return { gameEnded, handleGameEnded, resetGameEnded };
}

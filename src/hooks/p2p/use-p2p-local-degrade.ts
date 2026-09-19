/**
 * Issue #1090 — graceful degradation to local hot-seat.
 *
 * Owns the degrade-to-local bookkeeping for the P2P hook: the cached latest
 * game state (sent or received), the terminal-failure prompt lifecycle, and
 * the migration to local hot-seat storage. Extracted from
 * `src/hooks/use-p2p-connection.ts` (issue #1927); composed by
 * `useP2PConnection`.
 */

"use client";

import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import type { GameState } from "@/lib/game-state";
import type { P2PConnectionState } from "@/lib/p2p-game-connection";
import { saveGameForLocalHotSeat } from "@/lib/local-game-storage";
import { logger } from "@/lib/logger";
import type {
  LocalDegradeInfo,
  LocalHotSeatMigrationResult,
  LocalHotSeatSaveResult,
} from "./p2p-connection-types";

const p2pLogger = logger.child("P2PConnection");

export interface UseP2PLocalDegradeResult {
  degradedToLocal: boolean;
  /** True when the P2P connection failed terminally and the user has not yet acted. */
  terminalFailure: boolean;
  /** The most recent game state observed (sent or received). */
  lastGameState: GameState | null;
  /** Ref mirror of `lastGameState` for stable late-binding reads. */
  lastGameStateRef: RefObject<GameState | null>;
  /** Cache the latest observed game state (sent or received). */
  cacheLatestGameState: (gameState: GameState) => void;
  /** Migrate the in-progress game to local hot-seat storage and switch modes. Idempotent. */
  continueAsLocalHotSeat: () => Promise<LocalHotSeatMigrationResult>;
  /** Persist the in-progress game to IndexedDB for later resume (without switching modes). */
  saveForLocalResume: () => Promise<LocalHotSeatSaveResult>;
  /** Acknowledge the terminal failure (abandon) and dismiss the degrade prompt. */
  dismissTerminalFailure: () => void;
  /** Reset all degrade bookkeeping so a fresh session starts clean. */
  resetDegradeState: () => void;
}

export function useP2PLocalDegrade(options: {
  connectionState: P2PConnectionState;
  playerName: string;
  onDegradedToLocal?: (result: LocalDegradeInfo) => void;
  setError: (error: string | null) => void;
  connectionRef: RefObject<P2PGameConnectionLike | null>;
}): UseP2PLocalDegradeResult {
  const {
    connectionState,
    playerName,
    onDegradedToLocal,
    setError,
    connectionRef,
  } = options;

  const [degradedToLocal, setDegradedToLocal] = useState(false);
  const [terminalFailureDismissed, setTerminalFailureDismissed] =
    useState(false);
  const [lastGameState, setLastGameState] = useState<GameState | null>(null);
  const lastGameStateRef = useRef<GameState | null>(null);
  const degradedRef = useRef(false);
  // Keep the latest callback in a ref so the degrade path (fired from a
  // stable callback) always sees the current prop without re-binding.
  const onDegradedToLocalRef = useRef(onDegradedToLocal);
  onDegradedToLocalRef.current = onDegradedToLocal;

  // Cache the latest observed game state (sent or received) so it can be
  // migrated to local hot-seat storage on a terminal P2P failure (#1090).
  const cacheLatestGameState = useCallback((gameState: GameState) => {
    lastGameStateRef.current = gameState;
    setLastGameState(gameState);
  }, []);

  // Tear down the dead P2P connection without ever throwing into the caller.
  const safeCloseConnection = useCallback(() => {
    try {
      connectionRef.current?.close();
    } catch (err) {
      p2pLogger.warn("Error closing failed P2P connection", String(err));
    }
    connectionRef.current = null;
  }, [connectionRef]);

  // Migrate the in-progress game to local hot-seat storage and switch modes.
  // Idempotent: a second call is a no-op once degradedToLocal is true.
  const continueAsLocalHotSeat =
    useCallback(async (): Promise<LocalHotSeatMigrationResult> => {
      if (degradedRef.current) {
        return { ok: true };
      }

      const gameState = lastGameStateRef.current;

      // No game state to preserve: still leave multiplayer cleanly and notify.
      if (!gameState) {
        degradedRef.current = true;
        setDegradedToLocal(true);
        setError(null);
        safeCloseConnection();
        onDegradedToLocalRef.current?.({
          resumeKey: null,
          gameId: null,
          hadGameState: false,
        });
        return { ok: true, hadGameState: false };
      }

      try {
        const resumeKey = `p2p_${gameState.gameId || Date.now().toString(36)}`;
        const session = await saveGameForLocalHotSeat(gameState, {
          resumeKey,
          playerName,
        });
        degradedRef.current = true;
        setDegradedToLocal(true);
        setError(null);
        safeCloseConnection();
        p2pLogger.info(
          "Degraded to local hot-seat after terminal P2P failure",
          session.gameId,
        );
        onDegradedToLocalRef.current?.({
          resumeKey: session.resumeKey ?? resumeKey,
          gameId: session.gameId,
          hadGameState: true,
        });
        return {
          ok: true,
          resumeKey: session.resumeKey ?? resumeKey,
          gameId: session.gameId,
          hadGameState: true,
        };
      } catch (err) {
        // Never let the degrade path crash the UI — surface as a normal error.
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to migrate game to local hot-seat";
        p2pLogger.error("Local hot-seat migration failed", msg);
        setError(msg);
        return { ok: false, error: msg };
      }
    }, [playerName, safeCloseConnection, setError]);

  // Persist the in-progress game to IndexedDB for later resume WITHOUT
  // switching modes (the user chose "save for later" rather than continue).
  const saveForLocalResume =
    useCallback(async (): Promise<LocalHotSeatSaveResult> => {
      const gameState = lastGameStateRef.current;
      if (!gameState) {
        return { ok: false, error: "No in-progress game state to save" };
      }
      try {
        const resumeKey = `resume_${gameState.gameId || Date.now().toString(36)}`;
        const session = await saveGameForLocalHotSeat(gameState, {
          resumeKey,
          playerName,
        });
        return { ok: true, resumeKey: session.resumeKey ?? resumeKey };
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to save game for local resume";
        setError(msg);
        return { ok: false, error: msg };
      }
    }, [playerName, setError]);

  // The user chose to abandon: tear down and dismiss the degrade prompt.
  const dismissTerminalFailure = useCallback(() => {
    safeCloseConnection();
    setTerminalFailureDismissed(true);
  }, [safeCloseConnection]);

  // Terminal failure is a distinct, actionable state: the P2P connection has
  // failed AND fallback/reconnection is exhausted, the user has not yet
  // migrated or abandoned, and we are not already in local mode.
  const terminalFailure =
    connectionState === "failed" &&
    !degradedToLocal &&
    !terminalFailureDismissed;

  const resetDegradeState = useCallback(() => {
    degradedRef.current = false;
    setDegradedToLocal(false);
    setTerminalFailureDismissed(false);
    lastGameStateRef.current = null;
    setLastGameState(null);
  }, []);

  return {
    degradedToLocal,
    terminalFailure,
    lastGameState,
    lastGameStateRef,
    cacheLatestGameState,
    continueAsLocalHotSeat,
    saveForLocalResume,
    dismissTerminalFailure,
    resetDegradeState,
  };
}

/**
 * Structural stand-in for the connection ref so this module does not need
 * the full `P2PGameConnection` import surface — only `close()` is used here.
 */
interface P2PGameConnectionLike {
  close: () => void;
}

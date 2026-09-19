/**
 * Transport send/process surface for the P2P hook.
 *
 * The delegating wrappers (`processAnswer`, `processIceCandidates`,
 * `sendGameState`, `sendChat`, `requestStateSync`) and the orchestrated
 * `sendGameAction` (role-refusal + pending-action + conflict-resolution
 * verdicts). Extracted from `src/hooks/use-p2p-connection.ts` (issue
 * #1927); composed by `useP2PConnection`.
 *
 * `sendGameAction` is pure orchestration (issue #1716): the role-refusal
 * policy is owned by @/lib/peer-role (rejectionReasonForSend) and the
 * queue/process/send conflict policy by @/lib/p2p-conflict-resolution
 * (decideOutboundAction) — this module only maps verdicts to transport
 * calls.
 */

"use client";

import { useCallback } from "react";
import type { RefObject } from "react";
import type { GameState } from "@/lib/game-state";
import type { P2PGameConnection } from "@/lib/p2p-game-connection";
import type {
  RTCSessionDescriptionInit,
  RTCIceCandidateInit,
} from "@/lib/webrtc-types";
import {
  decideOutboundAction,
  type ConflictResolutionManager,
  type TimestampedAction,
} from "@/lib/p2p-conflict-resolution";
import type { PeerRole } from "@/lib/peer-role";
import { rejectionReasonForSend } from "@/lib/peer-role";
import { logger } from "@/lib/logger";

const p2pLogger = logger.child("P2PConnection");

export interface UseP2PTransportActionsResult {
  processAnswer: (answer: RTCSessionDescriptionInit) => Promise<void>;
  processIceCandidates: (candidates: RTCIceCandidateInit[]) => Promise<void>;
  sendGameState: (gameState: GameState, isFullSync?: boolean) => boolean;
  sendGameAction: (
    action: string,
    data: unknown,
  ) => {
    success: boolean;
    action?: TimestampedAction;
    queued?: boolean;
    /** Issue #1253 — `spectator` when the local role is read-only and the
     * action was refused; otherwise undefined. */
    reason?: string;
  };
  requestStateSync: () => boolean;
  sendChat: (text: string) => boolean;
}

export function useP2PTransportActions(options: {
  playerId: string;
  playerName: string;
  connectionState:
    | "disconnected"
    | "signaling"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "failed";
  enableConflictResolution: boolean;
  setError: (error: string | null) => void;
  connectionRef: RefObject<P2PGameConnection | null>;
  conflictManagerRef: RefObject<ConflictResolutionManager | null>;
  /** Ref mirror of the local peer's role (issue #1253). */
  localRoleRef: RefObject<PeerRole>;
  /** Record a local action made while disconnected (issue #1086). */
  recordPendingAction: (action: string, data: unknown) => void;
  /** Cache the outgoing state for local migration (issue #1090). */
  cacheLatestGameState: (gameState: GameState) => void;
}): UseP2PTransportActionsResult {
  const {
    playerId,
    playerName,
    connectionState,
    enableConflictResolution,
    setError,
    connectionRef,
    conflictManagerRef,
    localRoleRef,
    recordPendingAction,
    cacheLatestGameState,
  } = options;

  // Process answer (host only)
  const processAnswer = useCallback(
    async (answer: RTCSessionDescriptionInit): Promise<void> => {
      if (!connectionRef.current) {
        throw new Error("No active connection");
      }

      try {
        setError(null);
        await connectionRef.current.processAnswer(answer);
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to process answer";
        setError(errorMessage);
        throw err;
      }
    },
    [connectionRef, setError],
  );

  // Process ICE candidates
  const processIceCandidates = useCallback(
    async (candidates: RTCIceCandidateInit[]): Promise<void> => {
      if (!connectionRef.current) {
        throw new Error("No active connection");
      }

      try {
        setError(null);
        await connectionRef.current.processIceCandidates(candidates);
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : "Failed to process ICE candidates";
        setError(errorMessage);
        throw err;
      }
    },
    [connectionRef, setError],
  );

  // Send game state
  const sendGameState = useCallback(
    (gameState: GameState, isFullSync: boolean = false): boolean => {
      // Cache the outgoing state so it is available for local migration on
      // a later terminal failure (#1090).
      cacheLatestGameState(gameState);
      if (!connectionRef.current) {
        return false;
      }

      return connectionRef.current.sendGameState(gameState, isFullSync);
    },
    [cacheLatestGameState, connectionRef],
  );

  // Send game action. Pure orchestration (issue #1716): the role-refusal
  // policy is owned by @/lib/peer-role (rejectionReasonForSend) and the
  // queue/process/send conflict policy by @/lib/p2p-conflict-resolution
  // (decideOutboundAction) — this hook only maps verdicts to transport calls.
  const sendGameAction = useCallback(
    (
      action: string,
      data: unknown,
    ): {
      success: boolean;
      action?: TimestampedAction;
      queued?: boolean;
      /** Issue #1253 — `spectator` when the local role is read-only and the
       * action was refused; otherwise undefined. */
      reason?: string;
    } => {
      if (!connectionRef.current) {
        return { success: false };
      }

      // Issue #1253 — refuse `game-action` from a read-only role. The
      // transport ALSO refuses (defence in depth) but gating here lets
      // the hook return a typed `reason` so the UI can surface a
      // "Spectators cannot play — watch only" hint without a
      // round-trip through the transport's `onError` event.
      const roleRefusal = rejectionReasonForSend(
        localRoleRef.current,
        "game-action",
      );
      if (roleRefusal) {
        p2pLogger.warn("Refusing game-action: local role is read-only", {
          localRole: localRoleRef.current,
          action,
        });
        return { success: false, reason: roleRefusal };
      }

      // Issue #1086: while the transport is down, record the action as
      // pending so it can be reconciled (re-submitted if the local node is
      // the host, or dropped with notice if the host's authoritative state is
      // adopted on reconnect). Best-effort — never blocks the send path.
      if (connectionState !== "connected") {
        recordPendingAction(action, data);
      }

      // Conflict resolution owns the queue/process/send verdict.
      const decision = decideOutboundAction(
        enableConflictResolution && conflictManagerRef.current
          ? conflictManagerRef.current.processAction(
              action,
              data,
              playerId,
              playerName,
            )
          : null,
      );

      switch (decision.kind) {
        case "queue":
          return { success: false, action: decision.action, queued: true };
        case "send":
          return {
            success: connectionRef.current.sendGameAction(action, data),
            action: decision.action,
            queued: false,
          };
        default:
          return {
            success: connectionRef.current.sendGameAction(action, data),
          };
      }
    },
    [
      playerId,
      playerName,
      enableConflictResolution,
      connectionState,
      connectionRef,
      conflictManagerRef,
      localRoleRef,
      recordPendingAction,
    ],
  );

  // Request a fresh authoritative state sync from the host (issue #1086).
  const requestStateSync = useCallback((): boolean => {
    return connectionRef.current?.requestStateSync() ?? false;
  }, [connectionRef]);

  // Send chat
  const sendChat = useCallback(
    (text: string): boolean => {
      if (!connectionRef.current) {
        return false;
      }

      return connectionRef.current.sendChat(text);
    },
    [connectionRef],
  );

  return {
    processAnswer,
    processIceCandidates,
    sendGameState,
    sendGameAction,
    requestStateSync,
    sendChat,
  };
}

/**
 * Issue #988 / #1086 — reconnection UI state and post-reconnect
 * reconciliation for the P2P hook.
 *
 * The hook does not own the actual reconnection loop — that lives in the
 * transport / the browser RTCPeerConnection — but it DOES own the
 * user-facing count of observed drops and the reconcile decision made when
 * the transport recovers. Extracted from `src/hooks/use-p2p-connection.ts`
 * (issue #1927); composed by `useP2PConnection`.
 */

"use client";

import { useCallback, useRef, useState } from "react";
import type { RefObject } from "react";
import type { GameState } from "@/lib/game-state";
import type {
  P2PConnectionState,
  P2PGameConnection,
} from "@/lib/p2p-game-connection";
import { ReconciliationCoordinator } from "@/lib/p2p-reconciliation";
import type { PendingAction } from "@/lib/p2p-reconciliation";
import { logger } from "@/lib/logger";
import {
  MAX_RECONNECT_ATTEMPTS_DISPLAY,
  type ReconnectionPhase,
} from "./p2p-connection-types";

const p2pLogger = logger.child("P2PConnection");

export interface UseP2PReconnectResult {
  /** Number of reconnection attempts since the last successful connect. */
  reconnectAttempts: number;
  /** Transient "Reconnected" flag; cleared via `acknowledgeReconnect`. */
  reconnectedRecently: boolean;
  /** Dismiss the transient "Reconnected" message once shown to the user. */
  acknowledgeReconnect: () => void;
  /**
   * #988 attempt bookkeeping driven by transport state changes (called from
   * the shared `onConnectionStateChange` handler).
   */
  noteTransportStateChange: (state: P2PConnectionState) => void;
  /** Drive the reconcile decision when the transport recovers. */
  handleReconnect: () => void;
  /** On a received game-state sync, adopt the host state when awaiting. */
  adoptHostStateIfAwaiting: () => void;
  /** Record a local action made while disconnected (issue #1086). */
  recordPendingAction: (action: string, data: unknown) => void;
  /** Local actions DROPPED when the host's authoritative state was adopted. */
  droppedPendingActions: PendingAction[];
  /** Derived user-facing reconnection phase (issue #988). */
  reconnectionPhase: ReconnectionPhase;
  /**
   * Stable ref-reading accessor for `useConnectionHealth` (issue #1927 —
   * the transport owns no reconnect loop, so the hook's own tracked count
   * is the honest source).
   */
  getReconnectAttempts: () => number;
  /** Reset all reconnect + reconciliation bookkeeping for a fresh session. */
  resetReconnectState: () => void;
}

export function useP2PReconnect(options: {
  playerId: string;
  connectionState: P2PConnectionState;
  degradedToLocal: boolean;
  terminalFailure: boolean;
  connectionRef: RefObject<P2PGameConnection | null>;
  /** Ref mirror of the current authoritative host id (migration hook). */
  currentHostIdRef: RefObject<string>;
  /** Ref mirror of the latest observed game state (degrade hook). */
  lastGameStateRef: RefObject<GameState | null>;
}): UseP2PReconnectResult {
  const { playerId, connectionState, degradedToLocal, terminalFailure } =
    options;
  const { connectionRef, currentHostIdRef, lastGameStateRef } = options;

  // --- Issue #988: reconnection UI state ---
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [reconnectedRecently, setReconnectedRecently] = useState(false);
  const reconnectAttemptsRef = useRef(0);
  const hadConnectedRef = useRef(false);
  // --- Issue #1086: authoritative-state reconciliation after ICE-restart ---
  // Pure coordinator tracking pending actions during disconnect and producing
  // the reconcile decision on reconnect. See src/lib/p2p-reconciliation.ts.
  const reconcileRef = useRef<ReconciliationCoordinator>(
    new ReconciliationCoordinator(),
  );
  // True on a non-host peer between its reconnect and the arrival of the
  // host's authoritative full sync (the snapshot it must adopt).
  const awaitingReconciliationRef = useRef(false);
  const [droppedPendingActions, setDroppedPendingActions] = useState<
    PendingAction[]
  >([]);

  // Issue #988: track reconnection attempts. The hook does not own the
  // underlying reconnect loop — that lives in WebRTCConnection / the browser
  // RTCPeerConnection — but it owns the user-facing count of how many times
  // we have observed a drop after having been connected. Each observed drop
  // increments; a successful reconnect resets to 0 via `handleReconnect`
  // below. Capped at `maxReconnectAttempts + 1` so the UI can label the
  // terminal attempt explicitly.
  const noteTransportStateChange = useCallback((state: P2PConnectionState) => {
    if (state === "disconnected" || state === "reconnecting") {
      if (hadConnectedRef.current) {
        const next = Math.min(
          reconnectAttemptsRef.current + 1,
          MAX_RECONNECT_ATTEMPTS_DISPLAY + 1,
        );
        reconnectAttemptsRef.current = next;
        setReconnectAttempts(next);
      }
    } else if (state === "connected") {
      // Successful recovery (or initial connect): clear the transient
      // "Reconnected" message flag only if we are NOT in a recovery edge —
      // the actual flag flip happens in handleReconnect so it survives
      // handler re-binding.
      hadConnectedRef.current = true;
    }
  }, []);

  // Drive the reconcile decision when the transport recovers. The host pushes
  // its authoritative full state; a non-host peer arms adoption and pulls a
  // fresh snapshot (belt-and-suspenders alongside the host's reconnect push).
  // `droppedPendingActions` surfaced for the adopt path come from the
  // onGameStateSync adoption below. See src/lib/p2p-reconciliation.ts.
  const handleReconnect = useCallback(() => {
    // Issue #988: a successful reconnect deserves a transient "Reconnected"
    // user-facing message. Reset attempt counters and arm the flag the UI
    // consumes (cleared via `acknowledgeReconnect`).
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setReconnectedRecently(true);

    const coordinator = reconcileRef.current;
    const isHost = currentHostIdRef.current === playerId;
    const decision = coordinator.onReconnect({
      isHost,
      hasAuthoritativeState: lastGameStateRef.current !== null,
    });
    if (
      decision.action === "send-authoritative-state" &&
      lastGameStateRef.current
    ) {
      p2pLogger.info(
        "Reconnected as host; pushing authoritative full state to peer",
      );
      connectionRef.current?.sendGameState(lastGameStateRef.current, true);
    } else if (decision.action === "adopt-host-state") {
      // Arm adoption: the NEXT authoritative full sync received is adopted and
      // pending actions are dropped. Also explicitly request a snapshot so a
      // host push that raced ahead of this reconnect still produces an adopt.
      awaitingReconciliationRef.current = true;
      p2pLogger.info(
        "Reconnected as peer; awaiting host authoritative state for reconciliation",
      );
      connectionRef.current?.requestStateSync();
    }
  }, [playerId, connectionRef, currentHostIdRef, lastGameStateRef]);

  // Acknowledge the transient "Reconnected" message — caller fires once the
  // banner has been shown so the hook does not flip the flag back on. Issue
  // #988.
  const acknowledgeReconnect = useCallback(() => {
    setReconnectedRecently(false);
  }, []);

  // On a received game-state sync, if we are awaiting reconciliation, adopt
  // the host's authoritative state (source of truth) and drop the pending
  // actions that never reached the host. Idempotent: a duplicate full sync
  // with no pending queued between syncs drops nothing.
  const adoptHostStateIfAwaiting = useCallback(() => {
    if (!awaitingReconciliationRef.current) return;
    awaitingReconciliationRef.current = false;
    const dropped = reconcileRef.current.adoptAuthoritativeState();
    if (dropped.length > 0) {
      p2pLogger.warn(
        `Reconciled to host authoritative state; dropped ${dropped.length} pending action(s): ${dropped
          .map((a) => `"${a.action}"`)
          .join(", ")}`,
      );
      setDroppedPendingActions(dropped);
    }
  }, []);

  // Issue #1086: while the transport is down, record the action as pending
  // so it can be reconciled (re-submitted if the local node is the host, or
  // dropped with notice if the host's authoritative state is adopted on
  // reconnect). Best-effort — never blocks the send path.
  const recordPendingAction = useCallback((action: string, data: unknown) => {
    reconcileRef.current.recordPendingAction(action, data);
  }, []);

  // --- Issue #988: derive the user-facing reconnection phase ---
  // Order of precedence (highest first):
  //   1. Transient "Reconnected" message immediately after a recovery edge.
  //   2. Terminal "failed" (after reconnection exhausted) and the user has
  //      not yet migrated/abandoned — surface the recovery prompt.
  //   3. Mid-flight "reconnecting" (the transport reports it actively).
  //   4. Lost after having been connected (silent pre-#988 bug).
  //   5. Stable — nothing to show.
  const reconnectionPhase: ReconnectionPhase = (() => {
    if (reconnectedRecently) return "recovered";
    if (terminalFailure) return "failed";
    if (connectionState === "reconnecting") return "reconnecting";
    if (
      connectionState === "disconnected" &&
      hadConnectedRef.current &&
      !degradedToLocal
    ) {
      return "lost";
    }
    return "stable";
  })();

  const resetReconnectState = useCallback(() => {
    // Reset reconciliation bookkeeping so a fresh session starts clean.
    reconcileRef.current.clear();
    awaitingReconciliationRef.current = false;
    setDroppedPendingActions([]);
    // Issue #988: reset reconnection UI state for a fresh session.
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    setReconnectedRecently(false);
    hadConnectedRef.current = false;
  }, []);

  // Stable, ref-reading accessor for `useConnectionHealth`. Issue #1927 —
  // the old code cast the connection to `any` and bracket-read
  // `WebRTCConnection` fields that do not exist on the `P2PGameConnection`
  // transport (always coercing to 0); the hook's own tracked counter is the
  // honest source. The display bound mirrors the transport default (3).
  const getReconnectAttempts = useCallback(() => {
    return reconnectAttemptsRef.current || 0;
  }, []);

  return {
    reconnectAttempts,
    reconnectedRecently,
    acknowledgeReconnect,
    noteTransportStateChange,
    handleReconnect,
    adoptHostStateIfAwaiting,
    recordPendingAction,
    droppedPendingActions,
    reconnectionPhase,
    getReconnectAttempts,
    resetReconnectState,
  };
}

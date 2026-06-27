/**
 * P2PReconnectionStatusSection
 *
 * Hook-consumer wrapper around {@link P2PReconnectionStatus} (issue #988).
 *
 * Owns the call into {@link useP2PConnection} so the presentational
 * `P2PReconnectionStatus` stays trivially testable. Also manages the
 * side-effects (continue-locally / save-for-resume / abandon) by routing
 * through the hook's existing degrade pipeline.
 *
 * Mount this in any multiplayer surface where the player is currently in an
 * active P2P session (the game board, the lobby once connected, etc.). It
 * renders nothing during the `stable` phase so the section is safe to drop
 * in unconditionally.
 *
 * The wrapper takes the player's identity as props (since the hook requires
 * `playerId` / `playerName` / `role`) and surfaces the degrade-flow
 * callbacks via optional `onDegraded` / `onAbandoned` props so callers can
 * react when the player chooses one of the recovery paths.
 */

"use client";

import { useCallback, useState } from "react";

import { P2PReconnectionStatus } from "@/components/p2p-reconnection-status";
import {
  useP2PConnection,
  type LocalDegradeInfo,
} from "@/hooks/use-p2p-connection";

export interface P2PReconnectionStatusSectionProps {
  /** Local player's stable id. Required by the underlying P2P hook. */
  playerId: string;
  /** Local player's display name. Required by the underlying P2P hook. */
  playerName: string;
  /** Whether the local client is the host or joiner for this session. */
  role: "host" | "joiner";
  /** Optional P2P game code for logging / diagnostics. */
  gameCode?: string;
  /**
   * Fired once the player has chosen "Continue in local hot-seat" and the
   * hook has finished migrating the in-progress game. Use it to navigate
   * the player into the local hot-seat surface.
   */
  onDegraded?: (info: LocalDegradeInfo) => void;
  /**
   * Fired once the player has chosen "Abandon match". Use it to navigate
   * back to the lobby.
   */
  onAbandoned?: () => void;
  /** Optional className applied to the outer wrapper. */
  className?: string;
}

export function P2PReconnectionStatusSection({
  playerId,
  playerName,
  role,
  gameCode,
  onDegraded,
  onAbandoned,
  className,
}: P2PReconnectionStatusSectionProps) {
  // Only render a saving spinner while the user's chosen degrade path is in
  // flight. The hook exposes a `continueAsLocalHotSeat` async, so track its
  // in-flight state here.
  const [isSaving, setIsSaving] = useState(false);

  const p2p = useP2PConnection({
    playerId,
    playerName,
    role,
    gameCode,
    enableHandshake: false,
    enableConflictResolution: false,
    enableHostMigration: false,
    onDegradedToLocal: (info) => {
      onDegraded?.(info);
    },
  });

  const handleContinueLocally = useCallback(async () => {
    setIsSaving(true);
    try {
      const result = await p2p.continueAsLocalHotSeat();
      if (result.ok) {
        // Hook already fired onDegradedToLocal via its wiring; no-op.
      }
    } finally {
      setIsSaving(false);
    }
  }, [p2p]);

  const handleSaveForResume = useCallback(async () => {
    setIsSaving(true);
    try {
      await p2p.saveForLocalResume();
    } finally {
      setIsSaving(false);
    }
  }, [p2p]);

  const handleAbandon = useCallback(() => {
    p2p.dismissTerminalFailure();
    onAbandoned?.();
  }, [p2p, onAbandoned]);

  return (
    <P2PReconnectionStatus
      reconnectionPhase={p2p.reconnectionPhase}
      connectionState={p2p.connectionState}
      reconnectAttempts={p2p.reconnectAttempts}
      maxReconnectAttempts={p2p.maxReconnectAttempts}
      connectionFailureReason={p2p.connectionFailureReason}
      isSaving={isSaving}
      onContinueLocally={() => void handleContinueLocally()}
      onSaveForResume={() => void handleSaveForResume()}
      onAbandon={handleAbandon}
      onAcknowledgeReconnect={p2p.acknowledgeReconnect}
      className={className}
    />
  );
}

export default P2PReconnectionStatusSection;

/**
 * P2PConnectionIndicatorSection
 *
 * Hook-consumer wrapper around {@link P2PConnectionIndicator} (issue #986).
 *
 * Owns the call into {@link useP2PConnection} so the presentational
 * `P2PConnectionIndicator` stays trivially testable. Renders a small,
 * always-visible chip that reflects the LIVE P2P connection state.
 *
 * Mount in any multiplayer surface where the player wants to see the live
 * P2P status at a glance — typically the game board chrome, the multiplayer
 * lobby header, or a multiplayer sidebar. The chip stays small and
 * non-intrusive so it can sit alongside other UI without competing for
 * attention.
 *
 * Mount placement notes (issue #1209 lesson):
 *   - Mount in a STABLE parent (one that does not recreate its children on
 *     every render via inline callbacks or refs). The lobby-preview mount
 *     triggered an unstable-callback re-render bug and was dropped from
 *     #988's banner — this indicator follows the same lesson and should
 *     avoid unstable parents. The default role/id defaults are safe to use
 *     wherever `useP2PConnection` is otherwise valid.
 *   - Do NOT mount in the same spot as {@link P2PReconnectionStatusSection}.
 *     The two are complementary: this chip is the always-on cue; the
 *     reconnection banner is the transient messaging that surfaces only
 *     during disconnect/recover cycles. They share state but render at
 *     different DOM nodes by design so they don't overlap or fight for
 *     attention.
 *
 * The wrapper takes the player's identity as props (the underlying hook
 * requires `playerId` / `playerName` / `role`) and disables the heavy
 * subsystems (handshake / conflict-resolution / host-migration) since this
 * section only needs to surface transport state.
 */

"use client";

import { useMemo } from "react";

import { P2PConnectionIndicator } from "@/components/p2p-connection-indicator";
import { useP2PConnection } from "@/hooks/use-p2p-connection";

export interface P2PConnectionIndicatorSectionProps {
  /** Local player's stable id. Required by the underlying P2P hook. */
  playerId: string;
  /** Local player's display name. Required by the underlying P2P hook. */
  playerName: string;
  /** Whether the local client is the host or joiner for this session. */
  role: "host" | "joiner";
  /** Optional P2P game code for logging / diagnostics. */
  gameCode?: string;
  /** Render the icon-only variant (no text label). Defaults to false. */
  compact?: boolean;
  /** Optional className applied to the chip. */
  className?: string;
}

export function P2PConnectionIndicatorSection({
  playerId,
  playerName,
  role,
  gameCode,
  compact = false,
  className,
}: P2PConnectionIndicatorSectionProps) {
  const p2p = useP2PConnection({
    playerId,
    playerName,
    role,
    gameCode,
    // This section only surfaces the live transport state. It does not need
    // to drive the handshake protocol, conflict-resolution, or host-migration
    // subsystems — disable them so we are not paying for unused work.
    enableHandshake: false,
    enableConflictResolution: false,
    enableHostMigration: false,
  });

  // Pull only the primitive state we need so the chip renders without
  // triggering unnecessary re-renders from the larger hook surface.
  const connectionState = useMemo(
    () => p2p.connectionState,
    [p2p.connectionState],
  );

  return (
    <P2PConnectionIndicator
      connectionState={connectionState}
      compact={compact}
      className={className}
    />
  );
}

export default P2PConnectionIndicatorSection;

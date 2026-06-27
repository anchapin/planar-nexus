/**
 * P2PConnectionIndicator
 *
 * Persistent, always-visible connection-state indicator for the WebRTC P2P
 * multiplayer transport (issue #986).
 *
 * A small chip/dot showing the LIVE {@link P2PConnectionState} so the player
 * can tell at a glance whether they're connected, reconnecting, or offline.
 * Distinct from {@link P2PReconnectionStatus} (issue #988) which is a transient
 * banner that appears only when something goes wrong — this component is the
 * always-on chip that the banner complements, not replaces.
 *
 * Visual language:
 *   - `disconnected`  → gray dot, label "Offline"
 *   - `signaling`     → gray dot + spinner, label "Signaling…"
 *   - `connecting`    → blue dot + spinner, label "Connecting…"
 *   - `connected`     → green dot, label "Connected"
 *   - `reconnecting`  → amber dot + spinner, label "Reconnecting…"
 *   - `failed`        → red dot, label "Connection failed"
 *
 * Each state has a colored dot AND a text label (or icon-only in `compact`
 * mode) so the cue is clear in both light and dark themes — color alone is
 * never the sole carrier of state.
 *
 * Accessibility:
 *   - The chip carries `aria-label` with the full status text so screen
 *     readers announce the live state on focus.
 *   - A Tooltip surfaces the raw state name plus a one-line description for
 *     sighted users who want more detail (e.g. "WebRTC transport: connected").
 *   - Color is reinforced by icon + label so users with color-vision
 *     deficiencies are not excluded.
 *
 * The component is purely presentational — it takes the state as a prop and
 * renders nothing async. Wire it via {@link P2PConnectionIndicatorSection}
 * which calls {@link useP2PConnection} to drive the state in multiplayer
 * surfaces (game board chrome, multiplayer header, etc.).
 */

"use client";

import {
  CircleDot,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { P2PConnectionState } from "@/lib/p2p-game-connection";

export interface P2PConnectionIndicatorProps {
  /**
   * Live P2P connection state from {@link useP2PConnection.connectionState}.
   * Drives the dot color, icon, and label.
   */
  connectionState: P2PConnectionState;
  /**
   * Render an icon-only dot (no text label). Defaults to false.
   * Useful when space is tight and the surrounding chrome already has a
   * "Multiplayer" word; the tooltip still surfaces the full label.
   */
  compact?: boolean;
  /**
   * Optional className applied to the outer wrapper.
   */
  className?: string;
  /**
   * Optional `aria-label` override. Defaults to the per-state label so screen
   * readers announce the same word the sighted user sees. Set explicitly when
   * integrating in a non-English UI.
   */
  ariaLabel?: string;
}

interface StateMeta {
  /** Short label rendered next to (or instead of) the icon. */
  label: string;
  /** Long-form description surfaced in the tooltip. */
  description: string;
  /** Badge variant — chosen so contrast works in both light and dark themes. */
  variant: "default" | "secondary" | "destructive" | "outline";
  /** Tailwind class for the dot color (kept in sync with the Badge variant). */
  dotClass: string;
}

const STATE_META: Record<P2PConnectionState, StateMeta> = {
  disconnected: {
    label: "Offline",
    description: "Not connected to a peer. No P2P session is active.",
    variant: "outline",
    dotClass: "bg-muted-foreground",
  },
  signaling: {
    label: "Signaling…",
    description: "Exchanging WebRTC signaling messages to discover the peer.",
    variant: "secondary",
    dotClass: "bg-muted-foreground",
  },
  connecting: {
    label: "Connecting…",
    description: "Establishing the peer-to-peer connection.",
    variant: "secondary",
    dotClass: "bg-blue-500 dark:bg-blue-400",
  },
  connected: {
    label: "Connected",
    description: "Peer-to-peer connection is live and game state is in sync.",
    variant: "default",
    dotClass: "bg-green-500 dark:bg-green-400",
  },
  reconnecting: {
    label: "Reconnecting…",
    description:
      "Connection dropped — the transport is attempting an ICE-restart recovery.",
    variant: "secondary",
    dotClass: "bg-amber-500 dark:bg-amber-400",
  },
  failed: {
    label: "Connection failed",
    description:
      "The peer-to-peer connection could not be established or recovered.",
    variant: "destructive",
    dotClass: "bg-destructive",
  },
};

export function P2PConnectionIndicator({
  connectionState,
  compact = false,
  className,
  ariaLabel,
}: P2PConnectionIndicatorProps) {
  const meta = STATE_META[connectionState];
  const isSpinning =
    connectionState === "signaling" ||
    connectionState === "connecting" ||
    connectionState === "reconnecting";

  const Icon = (() => {
    switch (connectionState) {
      case "connected":
        return Wifi;
      case "disconnected":
        return WifiOff;
      case "reconnecting":
        return RefreshCw;
      case "failed":
        return AlertTriangle;
      case "signaling":
      case "connecting":
      default:
        return CircleDot;
    }
  })();

  const accessibleLabel = ariaLabel ?? `P2P connection: ${meta.label}`;
  const tooltipText = `${meta.description} (state: ${connectionState})`;

  const chip = (
    <Badge
      variant={meta.variant}
      className={cn(
        "gap-1.5 border-transparent",
        // Keep the chip itself compact so it stays a "status cue", not a panel.
        compact ? "h-5 px-1.5" : "h-6 px-2",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label={accessibleLabel}
      data-testid="p2p-connection-indicator"
      data-connection-state={connectionState}
    >
      <span
        aria-hidden="true"
        data-testid="p2p-connection-indicator-dot"
        className={cn(
          "inline-block h-2 w-2 shrink-0 rounded-full",
          meta.dotClass,
        )}
      />
      <Icon
        className={cn("h-3 w-3 shrink-0", isSpinning && "animate-spin")}
        aria-hidden="true"
      />
      {!compact ? (
        <span
          className="text-xs font-medium"
          data-testid="p2p-connection-indicator-label"
        >
          {meta.label}
        </span>
      ) : null}
    </Badge>
  );

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          <p className="font-medium">{meta.label}</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {tooltipText}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default P2PConnectionIndicator;

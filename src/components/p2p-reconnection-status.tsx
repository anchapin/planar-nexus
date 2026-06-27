/**
 * P2PReconnectionStatus
 *
 * User-facing reconnection UI for the WebRTC P2P transport (issue #988).
 *
 * Surfaces clear messaging during the disconnect → reconnect → success/failure
 * lifecycle so the player is never left wondering whether the game is hung.
 * Renders nothing during the `stable` phase to keep the game board uncluttered.
 *
 * Phases (driven by {@link useP2PConnection}'s `reconnectionPhase`):
 *
 *   - `lost`         — Connection dropped after having been connected. Shows
 *                      a "Connection lost — reconnecting…" banner with the
 *                      current attempt counter.
 *   - `reconnecting` — The transport reports an active reconnect cycle.
 *                      Same banner, but the body copy is explicit.
 *   - `recovered`    — Transient success message after a successful reconnect.
 *                      Auto-clears via `onAcknowledgeReconnect` after a short
 *                      timeout so the player sees confirmation, not noise.
 *   - `failed`       — Reconnection retries were exhausted. Hands off to the
 *                      existing {@link P2PDegradeDialog} recovery flow (continue
 *                      locally / save / abandon) — we render an Alert here
 *                      with the same actions so the failure is visible
 *                      alongside the game, not buried in a modal.
 *
 * Accessibility:
 *   - Each phase uses an `aria-live` region so screen readers announce the
 *     transition (polite, never assertive — the player is still in a game).
 *   - Buttons are keyboard-reachable via the existing `Button` primitive.
 *   - No native `alert`/`confirm` — driven entirely through React + radix
 *     primitives (the #1100/#1150 regression guard).
 *
 * The component is presentational and trivially testable: pass the state as
 * props (no internal hook calls). Wire it via {@link P2PReconnectionStatusSection}
 * which provides the hook consumer.
 */

"use client";

import { useEffect, useRef } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  WifiOff,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { ReconnectionPhase } from "@/hooks/use-p2p-connection";
import type { P2PConnectionState } from "@/lib/p2p-game-connection";
import type { ConnectionFailureDiagnostic } from "@/lib/p2p-failure-diagnostics";

export interface P2PReconnectionStatusProps {
  /**
   * High-level lifecycle phase from {@link useP2PConnection.reconnectionPhase}.
   * Drives which banner is rendered. `stable` renders nothing.
   */
  reconnectionPhase: ReconnectionPhase;
  /**
   * Underlying transport state. Surfaced as a small badge so the player can
   * see the raw state without parsing the phase name. Useful for debugging
   * in development builds; harmless in production.
   */
  connectionState: P2PConnectionState;
  /** Number of reconnection attempts observed since the last successful connect. */
  reconnectAttempts: number;
  /**
   * Maximum attempts before the transport transitions to the terminal
   * `failed` phase. Used to render "Attempt 2 of 3" labels.
   */
  maxReconnectAttempts: number;
  /**
   * Actionable failure diagnostic from the last terminal failure. Surfaced
   * on the `failed` phase so the player sees a meaningful reason + remediation
   * (e.g. "TURN server required") instead of a generic error.
   */
  connectionFailureReason: ConnectionFailureDiagnostic | null;
  /** True while a save/continue operation is in flight (disables actions). */
  isSaving?: boolean;
  /**
   * Trigger the existing graceful-degradation path that migrates the
   * in-progress game to local hot-seat storage and hands control to the
   * single-device flow. Plumbed from {@link useP2PConnection.continueAsLocalHotSeat}.
   */
  onContinueLocally: () => void;
  /** Persist the in-progress game to IndexedDB without switching modes. */
  onSaveForResume: () => void;
  /** Abandon the match — closes the connection and dismisses the prompt. */
  onAbandon: () => void;
  /**
   * Optional. Clears the transient `recovered` message after the banner has
   * been on screen for the auto-dismiss timeout (default 5s). If omitted the
   * banner stays until the next state change.
   */
  onAcknowledgeReconnect?: () => void;
  /**
   * How long the `recovered` banner stays on screen before auto-clearing.
   * Defaults to 5_000ms. Set to `null` to disable auto-dismiss (the banner
   * stays until manually cleared).
   */
  recoveredDismissMs?: number | null;
  /** Optional extra Tailwind classes merged onto the outer wrapper. */
  className?: string;
}

const RECOVERED_DISMISS_MS_DEFAULT = 5_000;

export function P2PReconnectionStatus({
  reconnectionPhase,
  connectionState,
  reconnectAttempts,
  maxReconnectAttempts,
  connectionFailureReason,
  isSaving = false,
  onContinueLocally,
  onSaveForResume,
  onAbandon,
  onAcknowledgeReconnect,
  recoveredDismissMs = RECOVERED_DISMISS_MS_DEFAULT,
  className,
}: P2PReconnectionStatusProps) {
  // Stable phase: nothing to surface. Do not render at all so the game board
  // is uncluttered when the P2P connection is healthy.
  if (reconnectionPhase === "stable") return null;

  return (
    <div
      className={cn("w-full", className)}
      data-testid="p2p-reconnection-status"
      data-reconnection-phase={reconnectionPhase}
      data-connection-state={connectionState}
    >
      {reconnectionPhase === "recovered" ? (
        <RecoveredBanner
          reconnectAttempts={reconnectAttempts}
          maxReconnectAttempts={maxReconnectAttempts}
          onAcknowledgeReconnect={onAcknowledgeReconnect}
          recoveredDismissMs={recoveredDismissMs}
        />
      ) : null}

      {reconnectionPhase === "lost" ? (
        <ReconnectingBanner
          attemptLabel="Connection lost"
          body="Reconnecting to your peer. This usually takes a few seconds."
          reconnectAttempts={reconnectAttempts}
          maxReconnectAttempts={maxReconnectAttempts}
          iconVariant="lost"
        />
      ) : null}

      {reconnectionPhase === "reconnecting" ? (
        <ReconnectingBanner
          attemptLabel="Reconnecting…"
          body="Reconnecting to your peer. This usually takes a few seconds."
          reconnectAttempts={reconnectAttempts}
          maxReconnectAttempts={maxReconnectAttempts}
          iconVariant="reconnecting"
        />
      ) : null}

      {reconnectionPhase === "failed" ? (
        <FailedBanner
          reconnectAttempts={reconnectAttempts}
          maxReconnectAttempts={maxReconnectAttempts}
          connectionFailureReason={connectionFailureReason}
          isSaving={isSaving}
          onContinueLocally={onContinueLocally}
          onSaveForResume={onSaveForResume}
          onAbandon={onAbandon}
        />
      ) : null}
    </div>
  );
}

/**
 * Banner shown while the connection is in a `lost` or `reconnecting` phase.
 * Pure presentation — accessibility attributes and copy live here so the
 * parent component stays simple.
 */
function ReconnectingBanner({
  attemptLabel,
  body,
  reconnectAttempts,
  maxReconnectAttempts,
  iconVariant,
}: {
  attemptLabel: string;
  body: string;
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  iconVariant: "lost" | "reconnecting";
}) {
  const Icon = iconVariant === "reconnecting" ? Loader2 : WifiOff;
  const attemptText =
    maxReconnectAttempts > 0
      ? `Attempt ${Math.min(reconnectAttempts, maxReconnectAttempts)} of ${maxReconnectAttempts}`
      : null;

  return (
    <Alert
      role="status"
      aria-live="polite"
      variant="default"
      data-testid="p2p-reconnection-reconnecting"
    >
      <Icon
        className={cn(
          "h-4 w-4",
          iconVariant === "reconnecting" && "animate-spin",
        )}
        aria-hidden="true"
      />
      <AlertTitle data-testid="p2p-reconnection-reconnecting-title">
        <span className="flex flex-wrap items-center gap-2">
          {attemptLabel}
          {attemptText ? (
            <Badge
              variant="secondary"
              data-testid="p2p-reconnection-attempt-badge"
            >
              {attemptText}
            </Badge>
          ) : null}
        </span>
      </AlertTitle>
      <AlertDescription data-testid="p2p-reconnection-reconnecting-body">
        {body}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Transient "Reconnected" success banner. Auto-dismisses after
 * `recoveredDismissMs` so it doesn't linger on the screen.
 */
function RecoveredBanner({
  reconnectAttempts,
  maxReconnectAttempts,
  onAcknowledgeReconnect,
  recoveredDismissMs,
}: {
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  onAcknowledgeReconnect?: () => void;
  recoveredDismissMs: number | null;
}) {
  const dismissedRef = useRef(false);
  useEffect(() => {
    if (!onAcknowledgeReconnect) return;
    if (recoveredDismissMs == null || recoveredDismissMs <= 0) return;
    const id = setTimeout(() => {
      if (dismissedRef.current) return;
      dismissedRef.current = true;
      onAcknowledgeReconnect();
    }, recoveredDismissMs);
    return () => clearTimeout(id);
  }, [onAcknowledgeReconnect, recoveredDismissMs]);

  return (
    <Alert
      role="status"
      aria-live="polite"
      variant="default"
      data-testid="p2p-reconnection-recovered"
    >
      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      <AlertTitle data-testid="p2p-reconnection-recovered-title">
        <span className="flex flex-wrap items-center gap-2">
          Reconnected
          {reconnectAttempts > 0 && maxReconnectAttempts > 0 ? (
            <Badge
              variant="outline"
              data-testid="p2p-reconnection-recovered-badge"
            >
              Recovered on attempt {reconnectAttempts}
            </Badge>
          ) : null}
        </span>
      </AlertTitle>
      <AlertDescription data-testid="p2p-reconnection-recovered-body">
        The peer-to-peer connection is back. Game state has been
        re-synchronized.
      </AlertDescription>
    </Alert>
  );
}

/**
 * Banner shown when reconnection retries are exhausted. Surfaces the
 * actionable failure diagnostic and the three recovery actions that hand off
 * to the existing degrade flow from #1090 — the player can continue locally,
 * save for later, or abandon.
 */
function FailedBanner({
  reconnectAttempts,
  maxReconnectAttempts,
  connectionFailureReason,
  isSaving,
  onContinueLocally,
  onSaveForResume,
  onAbandon,
}: {
  reconnectAttempts: number;
  maxReconnectAttempts: number;
  connectionFailureReason: ConnectionFailureDiagnostic | null;
  isSaving: boolean;
  onContinueLocally: () => void;
  onSaveForResume: () => void;
  onAbandon: () => void;
}) {
  const reason =
    connectionFailureReason?.reason ??
    "The peer-to-peer connection failed and could not be recovered after all fallbacks and reconnection attempts.";
  const remediation = connectionFailureReason?.remediation;

  return (
    <Alert
      variant="destructive"
      role="alert"
      aria-live="assertive"
      data-testid="p2p-reconnection-failed"
    >
      <AlertCircle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle data-testid="p2p-reconnection-failed-title">
        <span className="flex flex-wrap items-center gap-2">
          Reconnection failed
          {reconnectAttempts > 0 && maxReconnectAttempts > 0 ? (
            <Badge
              variant="destructive"
              data-testid="p2p-reconnection-failed-attempt-badge"
            >
              {reconnectAttempts}/{maxReconnectAttempts} attempts used
            </Badge>
          ) : null}
        </span>
      </AlertTitle>
      <AlertDescription data-testid="p2p-reconnection-failed-body">
        <p>{reason}</p>
        {remediation ? (
          <p
            className="mt-1 text-sm"
            data-testid="p2p-reconnection-failed-remediation"
          >
            {remediation}
          </p>
        ) : null}
        <p
          className="mt-2 text-sm"
          data-testid="p2p-reconnection-failed-suggestion"
        >
          You can continue this game in local hot-seat mode, save it for later,
          or abandon it.
        </p>
      </AlertDescription>
      <div
        className="mt-3 flex flex-wrap gap-2"
        data-testid="p2p-reconnection-failed-actions"
      >
        <Button
          variant="default"
          size="sm"
          onClick={onContinueLocally}
          disabled={isSaving}
          data-testid="p2p-reconnection-failed-continue"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Continue locally
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onSaveForResume}
          disabled={isSaving}
          data-testid="p2p-reconnection-failed-save"
        >
          {isSaving ? "Saving…" : "Save for later"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onAbandon}
          disabled={isSaving}
          data-testid="p2p-reconnection-failed-abandon"
        >
          Abandon match
        </Button>
      </div>
    </Alert>
  );
}

export default P2PReconnectionStatus;

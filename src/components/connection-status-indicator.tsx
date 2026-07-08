/**
 * Connection Status Indicator Component
 * Shows real-time connection health with reconnection indicators
 */

"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Wifi,
  WifiOff,
  AlertTriangle,
  RefreshCw,
  Signal,
  SignalZero,
} from "lucide-react";
import type { ConnectionHealth } from "@/hooks/use-connection-health";
import {
  getConnectionStatusMessage,
  getConnectionStateColor,
  getConnectionStateIcon,
} from "@/hooks/use-connection-health";

interface ConnectionStatusIndicatorProps {
  health: ConnectionHealth;
  showDetails?: boolean;
  compact?: boolean;
}

export function ConnectionStatusIndicator({
  health,
  showDetails = false,
  compact = false,
}: ConnectionStatusIndicatorProps) {
  const statusMessage = getConnectionStatusMessage(health);
  const stateColor = getConnectionStateColor(health);

  const renderIcon = () => {
    if (health.isReconnecting) {
      return <RefreshCw className="w-4 h-4 animate-spin" />;
    }

    switch (health.connectionQuality) {
      case "excellent":
      case "good":
        return <Wifi className={`w-4 h-4 ${stateColor}`} />;
      case "fair":
        return <Wifi className={`w-4 h-4 ${stateColor}`} />;
      case "poor":
        return <WifiOff className={`w-4 h-4 ${stateColor}`} />;
      case "lost":
      default:
        return health.state === "connecting" ? (
          <SignalZero className={`w-4 h-4 ${stateColor}`} />
        ) : (
          <WifiOff className={`w-4 h-4 ${stateColor}`} />
        );
    }
  };

  const renderBadge = () => {
    const variant = health.isHealthy
      ? "default"
      : health.isReconnecting
        ? "destructive"
        : "secondary";

    if (compact) {
      return (
        <Badge
          variant={variant}
          data-testid="connection-status-indicator"
          data-connection-state={health.state}
          data-connection-quality={health.connectionQuality}
          data-hcm-affordance={
            !health.isHealthy || health.state === "connecting"
          }
          className="gap-1 border"
        >
          {renderIcon()}
        </Badge>
      );
    }

    return (
      <Badge
        variant={variant}
        data-testid="connection-status-indicator"
        data-connection-state={health.state}
        data-connection-quality={health.connectionQuality}
        data-hcm-affordance={!health.isHealthy || health.state === "connecting"}
        className="gap-2 border"
      >
        {renderIcon()}
        <span>{statusMessage}</span>
      </Badge>
    );
  };

  if (showDetails) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2">
              {renderBadge()}
              {health.latency !== undefined && (
                <span className="text-xs text-muted-foreground">
                  {health.latency}ms
                </span>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <div className="space-y-1 text-sm">
              <p className="font-semibold">{statusMessage}</p>
              {health.isReconnecting && (
                <p>
                  Reconnection attempt {health.reconnectAttempts} of{" "}
                  {health.maxReconnectAttempts}
                </p>
              )}
              {health.latency !== undefined && (
                <p>Latency: {health.latency}ms</p>
              )}
              <p>Quality: {health.connectionQuality}</p>
              <p className="text-xs text-muted-foreground">
                Last state change: {health.lastStateChange.toLocaleTimeString()}
              </p>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return renderBadge();
}

/**
 * Reconnecting Overlay Component
 * Shows a full overlay when connection is lost
 */
export function ReconnectingOverlay({
  health,
  onRetry,
}: {
  health: ConnectionHealth;
  onRetry?: () => void;
}) {
  if (
    !health.isReconnecting &&
    health.state !== "failed" &&
    health.state !== "disconnected"
  ) {
    return null;
  }

  return (
    <div
      data-testid="connection-reconnecting-overlay"
      data-connection-state={health.state}
      role="alertdialog"
      aria-labelledby="connection-reconnecting-title"
      aria-describedby="connection-reconnecting-body"
      className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50"
    >
      <div
        data-hcm-affordance
        className="bg-background p-6 rounded-lg shadow-lg max-w-md mx-4 border"
      >
        <div className="flex items-center gap-3 mb-4">
          {health.isReconnecting ? (
            <RefreshCw
              className="w-8 h-8 animate-spin text-primary"
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="w-8 h-8 text-destructive"
              aria-hidden="true"
            />
          )}
          <h2 id="connection-reconnecting-title" className="text-xl font-bold">
            {health.isReconnecting ? "Reconnecting..." : "Connection Lost"}
          </h2>
        </div>

        <p
          id="connection-reconnecting-body"
          className="text-muted-foreground mb-4"
        >
          {health.isReconnecting
            ? `Attempting to restore connection (Attempt ${health.reconnectAttempts}/${health.maxReconnectAttempts})...`
            : "Unable to connect to the game. Please check your connection."}
        </p>

        {health.latency !== undefined && (
          <div className="mb-4 p-3 bg-muted rounded-lg border">
            <div className="flex justify-between text-sm">
              <span>Connection Quality:</span>
              <span className="font-medium">{health.connectionQuality}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Latency:</span>
              <span className="font-medium">{health.latency}ms</span>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {onRetry && (
            <Button onClick={onRetry} className="flex-1">
              <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
              Retry
            </Button>
          )}
          {!health.isReconnecting && (
            <Button
              variant="outline"
              onClick={() => window.location.reload()}
              className="flex-1"
            >
              Reload Page
            </Button>
          )}
        </div>

        {health.reconnectAttempts >= health.maxReconnectAttempts && (
          <p className="text-xs text-destructive mt-2">
            Maximum reconnection attempts reached. Please reload the page.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Connection Quality Bar Component
 * Visual indicator of connection quality
 */
export function ConnectionQualityBar({ health }: { health: ConnectionHealth }) {
  const getQualityWidth = () => {
    switch (health.connectionQuality) {
      case "excellent":
        return "100%";
      case "good":
        return "75%";
      case "fair":
        return "50%";
      case "poor":
        return "25%";
      case "lost":
        return "0%";
      default:
        return "0%";
    }
  };

  const getQualityColor = () => {
    switch (health.connectionQuality) {
      case "excellent":
        return "bg-green-500";
      case "good":
        return "bg-green-400";
      case "fair":
        return "bg-yellow-400";
      case "poor":
        return "bg-orange-400";
      case "lost":
        return "bg-red-500";
      default:
        return "bg-red-500";
    }
  };

  return (
    <div
      className="w-full"
      data-testid="connection-quality-bar"
      data-connection-quality={health.connectionQuality}
    >
      <div className="flex justify-between text-xs mb-1">
        <span>Connection Quality</span>
        <span className="text-muted-foreground">
          {health.connectionQuality}
        </span>
      </div>
      <div
        className="h-2 bg-muted rounded-full overflow-hidden border"
        role="progressbar"
        aria-valuenow={
          health.connectionQuality === "excellent"
            ? 100
            : health.connectionQuality === "good"
              ? 75
              : health.connectionQuality === "fair"
                ? 50
                : health.connectionQuality === "poor"
                  ? 25
                  : 0
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Connection quality ${health.connectionQuality}`}
      >
        <div
          className={`h-full transition-all duration-300 ${getQualityColor()}`}
          style={{ width: getQualityWidth() }}
        />
      </div>
      {health.latency !== undefined && (
        <p className="text-xs text-muted-foreground mt-1">
          Latency: {health.latency}ms
        </p>
      )}
    </div>
  );
}

import { Button } from "@/components/ui/button";

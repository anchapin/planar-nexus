/**
 * P2PDiagnosticsPanel
 *
 * Toggleable, accessible NAT-traversal / ICE diagnostics surface for the
 * multiplayer area. Issue #1088.
 *
 * Two observation modes:
 *   1. **Live** — pass a `connection` (anything with a `getDiagnostics()`
 *      method, e.g. a `WebRTCConnection`). The panel polls it on an interval.
 *   2. **Self-test probe** — when no connection is supplied, a "Run connection
 *      test" button spins up an ephemeral RTCPeerConnection (using the app's
 *      ICE config) to classify the local NAT. This never touches game traffic.
 *
 * Reported data: gathered ICE candidate types (host/srflx/prflx/relay counts),
 * the selected candidate pair with RTT/packet-loss, the ICE connection
 * state/phase, an effective NAT-type heuristic, gathering timing, and candidate
 * errors. A restrictive NAT with no TURN configured surfaces an actionable
 * "TURN required" hint.
 *
 * The heavy logic lives in `@/lib/ice-diagnostics` (+ `useP2PDiagnostics`);
 * this component is presentational + light interaction only.
 */

"use client";

import { useCallback, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Activity,
  ChevronDown,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { getGlobalICEManager } from "@/lib/ice-config";
import {
  CANDIDATE_TYPE_ORDER,
  NAT_TYPE_META,
  runDiagnosticsProbe,
  type CandidateType,
  type ICEDiagnosticsSnapshot,
  type NATType,
} from "@/lib/ice-diagnostics";
import {
  useP2PDiagnostics,
  type DiagnosticsSource,
} from "@/hooks/use-p2p-diagnostics";

export interface P2PDiagnosticsPanelProps {
  /**
   * Optional live connection to observe. When omitted the panel runs a
   * self-contained NAT probe on demand.
   */
  connection?: DiagnosticsSource | null;
  /** Collapsed/expanded on first render. Defaults to collapsed. */
  defaultOpen?: boolean;
  /** Poll cadence (ms) for the live connection. Defaults to the hook default. */
  pollIntervalMs?: number;
  className?: string;
}

const CANDIDATE_LABEL: Record<CandidateType, string> = {
  host: "Host",
  srflx: "Server-reflexive",
  prflx: "Peer-reflexive",
  relay: "Relay (TURN)",
  unknown: "Unknown",
};

const PHASE_VARIANT: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
  }
> = {
  connected: { label: "Connected", variant: "default" },
  completed: { label: "Completed", variant: "default" },
  connecting: { label: "Connecting", variant: "secondary" },
  gathering: { label: "Gathering", variant: "secondary" },
  new: { label: "New", variant: "outline" },
  disconnected: { label: "Disconnected", variant: "outline" },
  failed: { label: "Failed", variant: "destructive" },
  closed: { label: "Closed", variant: "outline" },
};

function formatMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  if (ms < 1) return "<1 ms";
  return `${Math.round(ms)} ms`;
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function natBadgeVariant(
  nat: NATType,
): "default" | "secondary" | "destructive" | "outline" {
  switch (nat) {
    case "cone":
      return "default";
    case "turn-dependent":
      return "secondary";
    case "restrictive":
      return "destructive";
    default:
      return "outline";
  }
}

function StatRow({
  label,
  value,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Pure presentation of a diagnostics snapshot. Extracted so it can be reused by
 * both the live path and the probe path and unit-tested with mock snapshots.
 */
function DiagnosticsReadout({
  snapshot,
}: {
  snapshot: ICEDiagnosticsSnapshot;
}) {
  const phase = PHASE_VARIANT[snapshot.phase] ?? {
    label: snapshot.phase,
    variant: "outline" as const,
  };
  const nat = NAT_TYPE_META[snapshot.natType];
  const needsTurn =
    snapshot.natType === "restrictive" && !snapshot.hasTurnConfigured;
  const pair = snapshot.selectedPair;
  const lossPct =
    pair && pair.packetsSent != null && pair.packetsSent > 0
      ? ((pair.packetsLost ?? 0) / pair.packetsSent) * 100
      : null;

  return (
    <div className="space-y-4">
      {/* Status row */}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={phase.variant} data-testid="p2p-diag-phase-badge">
          {phase.label}
        </Badge>
        <Badge
          variant={natBadgeVariant(snapshot.natType)}
          data-testid="p2p-diag-nat-badge"
        >
          <ShieldAlert className="mr-1 h-3 w-3" aria-hidden="true" />
          {nat.label}
        </Badge>
        {snapshot.hasTurnConfigured ? (
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3 w-3" aria-hidden="true" />
            TURN configured
          </Badge>
        ) : null}
      </div>

      {/* TURN-required actionable hint */}
      {needsTurn ? (
        <Alert variant="destructive" data-testid="p2p-diag-turn-required">
          <TriangleAlert className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>TURN server required</AlertTitle>
          <AlertDescription>
            Only local (host) candidates were gathered, which means this network
            uses a restrictive/symmetric NAT that blocks direct peer-to-peer
            connections. Add a TURN relay server in your network settings to
            connect. See issue #983 for configuration guidance.
          </AlertDescription>
        </Alert>
      ) : null}

      <p className="text-sm text-muted-foreground">{nat.description}</p>

      <Separator />

      {/* Candidate types */}
      <section>
        <h4 className="mb-2 text-sm font-semibold">
          Gathered candidates
          <span className="ml-2 font-normal text-muted-foreground">
            ({snapshot.totalGathered})
          </span>
        </h4>
        <dl
          className="grid grid-cols-2 gap-x-4 sm:grid-cols-3"
          data-testid="p2p-diag-candidate-grid"
        >
          {CANDIDATE_TYPE_ORDER.map((type) => (
            <StatRow
              key={type}
              label={CANDIDATE_LABEL[type]}
              value={snapshot.candidateCounts[type] ?? 0}
              testId={`p2p-diag-count-${type}`}
            />
          ))}
        </dl>
      </section>

      <Separator />

      {/* Selected pair + quality */}
      <section>
        <h4 className="mb-2 text-sm font-semibold">Active connection</h4>
        <dl className="grid grid-cols-2 gap-x-4">
          <StatRow
            label="Local type"
            value={pair?.localType ?? "—"}
            testId="p2p-diag-local-type"
          />
          <StatRow
            label="Remote type"
            value={pair?.remoteType ?? "—"}
            testId="p2p-diag-remote-type"
          />
          <StatRow
            label="Round-trip time"
            value={formatMs(pair?.currentRttMs)}
            testId="p2p-diag-rtt"
          />
          <StatRow
            label="Packet loss"
            value={
              lossPct != null
                ? `${lossPct.toFixed(1)}%`
                : (pair?.packetsLost ?? "—")
            }
            testId="p2p-diag-loss"
          />
          <StatRow label="Sent" value={formatBytes(pair?.bytesSent)} />
          <StatRow label="Received" value={formatBytes(pair?.bytesReceived)} />
        </dl>
      </section>

      <Separator />

      {/* Gathering timing + errors */}
      <section>
        <h4 className="mb-2 text-sm font-semibold">Gathering</h4>
        <dl className="grid grid-cols-2 gap-x-4">
          <StatRow
            label="Gathering time"
            value={formatMs(snapshot.gatheringDurationMs)}
            testId="p2p-diag-gather-time"
          />
          <StatRow
            label="Candidate errors"
            value={snapshot.candidateErrors.length}
            testId="p2p-diag-errors"
          />
        </dl>
        {snapshot.candidateErrors.length > 0 ? (
          <ul
            className="mt-2 space-y-1 text-xs text-muted-foreground"
            data-testid="p2p-diag-error-list"
          >
            {snapshot.candidateErrors.slice(0, 5).map((err, idx) => (
              <li key={`${err.timestamp}-${idx}`}>
                <span className="font-medium text-destructive">
                  {err.errorCode != null ? `Error ${err.errorCode}` : "Error"}
                </span>
                {err.url ? ` · ${err.url}` : ""}
                {err.errorText ? ` · ${err.errorText}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

export function P2PDiagnosticsPanel({
  connection,
  defaultOpen = false,
  pollIntervalMs,
  className,
}: P2PDiagnosticsPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  const live = useP2PDiagnostics({
    connection: connection ?? null,
    pollIntervalMs,
  });

  // Probe state (used only when no live connection is supplied).
  const [probeSnapshot, setProbeSnapshot] =
    useState<ICEDiagnosticsSnapshot | null>(null);
  const [probeRunning, setProbeRunning] = useState(false);
  const [probeError, setProbeError] = useState<Error | null>(null);

  const liveMode = connection != null;
  const supported = live.supported;

  const runProbe = useCallback(async () => {
    setProbeRunning(true);
    setProbeError(null);
    try {
      const rtcConfig = getGlobalICEManager().getRTCConfiguration();
      const { snapshot } = await runDiagnosticsProbe(rtcConfig);
      setProbeSnapshot(snapshot);
    } catch (err) {
      setProbeError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setProbeRunning(false);
    }
  }, []);

  const activeSnapshot = liveMode ? live.snapshot : probeSnapshot;
  const loading = liveMode ? live.loading : probeRunning;
  const error = liveMode ? live.error : probeError;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn(
        "rounded-lg border bg-card text-card-foreground",
        className,
      )}
      data-testid="p2p-diagnostics-panel"
    >
      <div className="flex items-center justify-between gap-2 p-3">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start"
            aria-expanded={open}
            aria-controls="p2p-diagnostics-content"
          >
            <Activity className="h-4 w-4" aria-hidden="true" />
            Connection Diagnostics
            <ChevronDown
              className={cn(
                "ml-auto h-4 w-4 transition-transform",
                open && "rotate-180",
              )}
              aria-hidden="true"
            />
          </Button>
        </CollapsibleTrigger>
        {supported && liveMode ? (
          <Button
            variant="outline"
            size="icon"
            onClick={() => live.refresh()}
            disabled={loading}
            aria-label="Refresh diagnostics"
            data-testid="p2p-diag-refresh"
          >
            <RefreshCw
              className={cn("h-4 w-4", loading && "animate-spin")}
              aria-hidden="true"
            />
          </Button>
        ) : null}
        {!liveMode && supported ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void runProbe()}
            disabled={probeRunning}
            data-testid="p2p-diag-run-test"
          >
            {probeRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            )}
            Test
          </Button>
        ) : null}
      </div>

      <CollapsibleContent id="p2p-diagnostics-content">
        <div
          className="space-y-3 px-3 pb-3"
          role="region"
          aria-label="P2P connection diagnostics"
          aria-live="polite"
        >
          {!supported ? (
            <Alert variant="warning" data-testid="p2p-diag-unsupported">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Diagnostics unavailable</AlertTitle>
              <AlertDescription>
                This environment does not support WebRTC (RTCPeerConnection).
                Diagnostics require a browser or a Tauri webview with WebRTC
                enabled.
              </AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive" data-testid="p2p-diag-error">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              <AlertTitle>Could not read diagnostics</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}

          {supported && !error && !activeSnapshot ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="p2p-diag-idle"
            >
              {liveMode
                ? "Waiting for a peer connection…"
                : "Run a connection test to detect your NAT type and gather ICE candidates."}
            </p>
          ) : null}

          {supported && activeSnapshot ? (
            <DiagnosticsReadout snapshot={activeSnapshot} />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default P2PDiagnosticsPanel;

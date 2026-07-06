/**
 * P2PDiagnosticsPanel
 *
 * Toggleable, accessible NAT-traversal / ICE diagnostics surface for the
 * multiplayer area. Issue #1088. Per-peer live RTT/packet-loss/bytes-per-sec
 * table — Issue #1256.
 *
 * Three observation modes:
 *   1. **Per-peer mesh** — pass a `peerConnection` (anything with
 *      `getPeerIds()` + `getPeerDiagnostics(id)`, e.g. a 3+ player mesh
 *      `WebRTCConnection`). Renders a sortable per-peer table with live RTT,
 *      bytes/sec, packet-loss %, and a 30-sample RTT sparkline per peer.
 *   2. **Live** — pass a `connection` (anything with a `getDiagnostics()`
 *      method, e.g. a single-peer `WebRTCConnection`). The panel polls it on
 *      an interval.
 *   3. **Self-test probe** — when no connection is supplied, a "Run connection
 *      test" button spins up an ephemeral RTCPeerConnection (using the app's
 *      ICE config) to classify the local NAT. This never touches game traffic.
 *
 * Reported data: gathered ICE candidate types (host/srflx/prflx/relay counts),
 * the selected candidate pair with RTT/packet-loss, the ICE connection
 * state/phase, an effective NAT-type heuristic, gathering timing, candidate
 * errors, and (when in mesh mode) per-peer live counters. A restrictive NAT
 * with no TURN configured surfaces an actionable "TURN required" hint.
 *
 * The heavy logic lives in `@/lib/ice-diagnostics`, `@/lib/p2p-peer-stats`,
 * and `@/hooks/use-p2p-diagnostics`; this component is presentational + light
 * interaction only.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
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
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
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
  usePeerDiagnostics,
  type DiagnosticsSource,
  type PeerDiagnosticsRow,
  type PeerDiagnosticsSource,
} from "@/hooks/use-p2p-diagnostics";
import { rttSeries } from "@/lib/p2p-peer-stats";

export interface P2PDiagnosticsPanelProps {
  /**
   * Optional live single-connection source to observe. When omitted (and no
   * `peerConnection` is supplied either) the panel runs a self-contained NAT
   * probe on demand.
   */
  connection?: DiagnosticsSource | null;
  /**
   * Optional per-peer mesh source (issue #1256). When supplied, the panel
   * renders a sortable per-peer table with live RTT, bytes/sec, packet-loss,
   * and a sparkline of the last 30 samples per peer. Takes precedence over
   * `connection` when both are present.
   */
  peerConnection?: PeerDiagnosticsSource | null;
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
  peerConnection,
  defaultOpen = false,
  pollIntervalMs,
  className,
}: P2PDiagnosticsPanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  const live = useP2PDiagnostics({
    connection: peerConnection ? null : (connection ?? null),
    pollIntervalMs,
  });

  const peerLive = usePeerDiagnostics({
    connection: peerConnection ?? null,
    pollIntervalMs,
  });

  // Probe state (used only when no live connection is supplied).
  const [probeSnapshot, setProbeSnapshot] =
    useState<ICEDiagnosticsSnapshot | null>(null);
  const [probeRunning, setProbeRunning] = useState(false);
  const [probeError, setProbeError] = useState<Error | null>(null);

  const peerMode = peerConnection != null;
  const liveMode = !peerMode && connection != null;
  const supported = peerMode ? peerLive.supported : live.supported;

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

  const activeSnapshot = peerMode
    ? null
    : liveMode
      ? live.snapshot
      : probeSnapshot;
  const loading = peerMode
    ? peerLive.loading
    : liveMode
      ? live.loading
      : probeRunning;
  const error = peerMode
    ? peerLive.error
    : liveMode
      ? live.error
      : probeError;
  const refresh = peerMode
    ? () => peerLive.refresh()
    : liveMode
      ? () => live.refresh()
      : null;
  const peerSummary = peerMode ? peerLive.summary : null;

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
        {supported && (liveMode || peerMode) && refresh ? (
          <Button
            variant="outline"
            size="icon"
            onClick={() => refresh()}
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
        {!liveMode && !peerMode && supported ? (
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

          {supported && !error && !activeSnapshot && !peerSummary ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="p2p-diag-idle"
            >
              {peerMode
                ? "Waiting for peers to connect…"
                : liveMode
                  ? "Waiting for a peer connection…"
                  : "Run a connection test to detect your NAT type and gather ICE candidates."}
            </p>
          ) : null}

          {supported && peerSummary ? (
            <PeerDiagnosticsTable summary={peerSummary} />
          ) : null}

          {supported && !peerSummary && activeSnapshot ? (
            <DiagnosticsReadout snapshot={activeSnapshot} />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ──────────────────────────────────────────────────────────────────────────── *
 *  Per-peer table + sparkline — issue #1256.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Sortable columns exposed by the per-peer table. */
type PeerSortKey =
  | "name"
  | "rtt"
  | "bytesOut"
  | "bytesIn"
  | "loss"
  | "queue";
type SortDir = "asc" | "desc";

/**
 * Pure-SVG sparkline for the last 30 RTT samples of a single peer. Renders a
 * polyline within a fixed-size viewport, with axes implicit (the line itself
 * is the data). Empty / single-sample windows render a flat baseline.
 */
function RttSparkline({
  samples,
  width = 90,
  height = 24,
}: {
  samples: number[];
  width?: number;
  height?: number;
}) {
  // Filter NaN placeholders but keep alignment by remembering the original
  // index — only the position along the x axis matters, the y range is
  // computed from finite values only.
  const finite: number[] = samples.filter(
    (v) => typeof v === "number" && Number.isFinite(v),
  );
  if (samples.length === 0 || finite.length === 0) {
    return (
      <svg
        role="img"
        aria-label="RTT sparkline (no data)"
        width={width}
        height={height}
        data-testid="p2p-diag-sparkline"
      >
        <line
          x1={0}
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity={0.3}
          strokeWidth={1}
        />
      </svg>
    );
  }

  let min = finite[0];
  let max = finite[0];
  for (const v of finite) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Pad the range by 10% so a flat trace does not collapse onto a single line.
  const span = max - min || Math.max(1, max);
  const paddedMin = min - span * 0.1;
  const paddedMax = max + span * 0.1;
  const range = paddedMax - paddedMin || 1;

  const stepX = samples.length > 1 ? width / (samples.length - 1) : 0;

  // Build an SVG path that lifts the pen (move-to) between NaN samples so
  // gaps render as discontinuities rather than a single zig-zag across the
  // missing data. Each segment is `M x,y L x,y L x,y ...`.
  const segments: string[] = [];
  let current: string[] = [];
  samples.forEach((v, i) => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      if (current.length > 0) {
        segments.push(current.join(" "));
        current = [];
      }
      return;
    }
    const x = i * stepX;
    const y = height - ((v - paddedMin) / range) * height;
    const cmd = current.length === 0 ? "M" : "L";
    current.push(`${cmd}${x.toFixed(1)},${y.toFixed(1)}`);
  });
  if (current.length > 0) segments.push(current.join(" "));

  return (
    <svg
      role="img"
      aria-label={`RTT sparkline (${finite.length} samples, ${Math.round(min)}–${Math.round(max)} ms)`}
      width={width}
      height={height}
      className="text-primary"
      data-testid="p2p-diag-sparkline"
    >
      {segments.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

function formatBytesPerSec(bytesPerSec: number | null): string {
  if (bytesPerSec == null || !Number.isFinite(bytesPerSec)) return "—";
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatPct(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct.toFixed(1)}%`;
}

/**
 * Sortable header button for the per-peer table.
 */
function SortableHeader({
  label,
  columnKey,
  active,
  dir,
  onClick,
  testId,
}: {
  label: string;
  columnKey: PeerSortKey;
  active: boolean;
  dir: SortDir;
  onClick: (key: PeerSortKey) => void;
  testId?: string;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onClick(columnKey)}
      className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
      aria-label={`Sort by ${label}${
        active ? ` (${dir === "asc" ? "ascending" : "descending"})` : ""
      }`}
      data-testid={testId}
    >
      {label}
      <Icon className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

function sortRows(
  rows: PeerDiagnosticsRow[],
  key: PeerSortKey,
  dir: SortDir,
): PeerDiagnosticsRow[] {
  const factor = dir === "asc" ? 1 : -1;
  const compare = (a: PeerDiagnosticsRow, b: PeerDiagnosticsRow): number => {
    switch (key) {
      case "name":
        return factor * (a.peerId.localeCompare(b.peerId));
      case "rtt":
        return (
          factor *
          ((a.aggregate.rttMs ?? Number.POSITIVE_INFINITY) -
            (b.aggregate.rttMs ?? Number.POSITIVE_INFINITY))
        );
      case "bytesOut":
        return (
          factor *
          ((a.aggregate.bytesOutPerSec ?? -1) -
            (b.aggregate.bytesOutPerSec ?? -1))
        );
      case "bytesIn":
        return (
          factor *
          ((a.aggregate.bytesInPerSec ?? -1) -
            (b.aggregate.bytesInPerSec ?? -1))
        );
      case "loss":
        return (
          factor *
          ((a.aggregate.packetLossPct ?? -1) -
            (b.aggregate.packetLossPct ?? -1))
        );
      case "queue":
        return (
          factor *
          ((a.aggregate.queueDepth ?? -1) - (b.aggregate.queueDepth ?? -1))
        );
      default:
        return 0;
    }
  };
  return rows.slice().sort(compare);
}

/**
 * Per-peer live diagnostics table — issue #1256. Renders one row per peer
 * with live RTT, bytes-in/out per second, packet-loss %, queue depth, and an
 * RTT sparkline (last 30 samples). Columns are sortable by clicking the
 * header button.
 */
function PeerDiagnosticsTable({
  summary,
}: {
  summary: import("@/hooks/use-p2p-diagnostics").PeerDiagnosticsSummary;
}) {
  const [sortKey, setSortKey] = useState<PeerSortKey>("rtt");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const sortedPeers = useMemo(
    () => sortRows(summary.peers, sortKey, sortDir),
    [summary.peers, sortKey, sortDir],
  );

  const handleSort = useCallback((key: PeerSortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "name" ? "asc" : "desc");
      return key;
    });
  }, []);

  if (summary.peers.length === 0) {
    return (
      <p
        className="text-sm text-muted-foreground"
        data-testid="p2p-diag-peer-empty"
      >
        No peers connected yet.
      </p>
    );
  }

  return (
    <section data-testid="p2p-diag-peer-table">
      <h4 className="mb-2 text-sm font-semibold">
        Per-peer live stats
        <span className="ml-2 font-normal text-muted-foreground">
          ({summary.peers.length})
        </span>
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="py-2 pr-2">
                <SortableHeader
                  label="Peer"
                  columnKey="name"
                  active={sortKey === "name"}
                  dir={sortDir}
                  onClick={handleSort}
                  testId="p2p-diag-sort-name"
                />
              </th>
              <th scope="col" className="py-2 pr-2">
                <SortableHeader
                  label="RTT"
                  columnKey="rtt"
                  active={sortKey === "rtt"}
                  dir={sortDir}
                  onClick={handleSort}
                  testId="p2p-diag-sort-rtt"
                />
              </th>
              <th scope="col" className="py-2 pr-2">
                <SortableHeader
                  label="Out"
                  columnKey="bytesOut"
                  active={sortKey === "bytesOut"}
                  dir={sortDir}
                  onClick={handleSort}
                  testId="p2p-diag-sort-bytesout"
                />
              </th>
              <th scope="col" className="py-2 pr-2">
                <SortableHeader
                  label="In"
                  columnKey="bytesIn"
                  active={sortKey === "bytesIn"}
                  dir={sortDir}
                  onClick={handleSort}
                  testId="p2p-diag-sort-bytesin"
                />
              </th>
              <th scope="col" className="py-2 pr-2">
                <SortableHeader
                  label="Loss"
                  columnKey="loss"
                  active={sortKey === "loss"}
                  dir={sortDir}
                  onClick={handleSort}
                  testId="p2p-diag-sort-loss"
                />
              </th>
              <th scope="col" className="py-2 pr-2">
                <SortableHeader
                  label="Queue"
                  columnKey="queue"
                  active={sortKey === "queue"}
                  dir={sortDir}
                  onClick={handleSort}
                  testId="p2p-diag-sort-queue"
                />
              </th>
              <th scope="col" className="py-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Trend
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedPeers.map((peer) => (
              <tr
                key={peer.peerId}
                className="border-b last:border-0"
                data-testid={`p2p-diag-peer-row-${peer.peerId}`}
              >
                <td className="py-2 pr-2 align-top">
                  <div
                    className="font-medium"
                    data-testid={`p2p-diag-peer-name-${peer.peerId}`}
                  >
                    {peer.displayName ?? peer.peerId}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {peer.peerId}
                  </div>
                </td>
                <td className="py-2 pr-2 align-top tabular-nums">
                  {formatMs(peer.aggregate.rttMs)}
                </td>
                <td className="py-2 pr-2 align-top tabular-nums">
                  {formatBytesPerSec(peer.aggregate.bytesOutPerSec)}
                </td>
                <td className="py-2 pr-2 align-top tabular-nums">
                  {formatBytesPerSec(peer.aggregate.bytesInPerSec)}
                </td>
                <td className="py-2 pr-2 align-top tabular-nums">
                  {formatPct(peer.aggregate.packetLossPct)}
                </td>
                <td className="py-2 pr-2 align-top tabular-nums">
                  {peer.aggregate.queueDepth ?? "—"}
                </td>
                <td className="py-2 align-top">
                  <RttSparkline samples={rttSeries(peer.history)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default P2PDiagnosticsPanel;

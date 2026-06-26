/**
 * ICE / NAT-traversal diagnostics — runtime observability for P2P connections.
 * Issue #1088: Add NAT-traversal diagnostics panel with ICE candidate reporting.
 *
 * This module is a *pure data layer*: it classifies ICE candidate types, derives
 * an effective NAT-type heuristic, aggregates the selected candidate pair from
 * `getStats()`, and collects live ICE events from an `RTCPeerConnection`. The UI
 * (panel + hook) consumes the resulting {@link ICEDiagnosticsSnapshot}.
 *
 * Design notes:
 *  - All classification/aggregation is framework-agnostic and synchronous, so it
 *    can be unit-tested without a real browser WebRTC stack (mock RTCStatsReport
 *    as a plain `Map`, feed candidate SDP strings, assert counts/NAT type).
 *  - The {@link ICEDiagnosticsCollector} attaches to an `RTCPeerConnection` via
 *    `addEventListener` so it never clobbers existing `onicecandidate` /
 *    `oniceconnectionstatechange` handlers wired by the connection manager. It
 *    only observes; it never drives the connection.
 */

/**
 * The candidate `typ` values defined by RFC 8445 / WebRTC.
 *
 * - `host`       — a directly reachable local interface address
 * - `srflx`      — server-reflexive address (STUN-mapped public address)
 * - `prflx`      — peer-reflexive address (learned during connectivity checks)
 * - `relay`      — a TURN relayed address (relay)
 * - `unknown`    — could not be classified (malformed/empty candidate)
 */
export type CandidateType = "host" | "srflx" | "prflx" | "relay" | "unknown";

/**
 * A single high-level phase derived from the ICE gathering + connection state
 * machines, for compact display in the diagnostics panel.
 */
export type ICEPhase =
  | "new"
  | "gathering"
  | "connecting"
  | "connected"
  | "completed"
  | "disconnected"
  | "failed"
  | "closed";

/**
 * Effective NAT-type heuristic derived from the gathered candidate mix.
 *
 * - `restrictive`    — only host candidates ⇒ the NAT is dropping server-reflexive
 *                      mappings (symmetric/restrictive NAT). Direct P2P almost
 *                      always fails; a TURN relay is required.
 * - `cone`           — host + srflx (and/or prflx) candidates ⇒ a NAT that can
 *                      be traversed directly (cone/endpoint-independent mapping).
 * - `turn-dependent` — a relay candidate is in use ⇒ connectivity depends on a
 *                      reachable TURN server.
 * - `unknown`        — no candidates yet (still gathering) or empty.
 */
export type NATType = "restrictive" | "cone" | "turn-dependent" | "unknown";

/** IP address family inferred from a candidate address. */
export type IPFamily = "ipv4" | "ipv6" | "unknown";

/**
 * A normalized, classified ICE candidate record.
 *
 * `address`/`candidate` are retained for developer self-diagnosis; the panel
 * may redact them for screenshots. They never leave the client.
 */
export interface CandidateRecord {
  type: CandidateType;
  address: string | null;
  protocol: string | null;
  ipFamily: IPFamily;
  /** Raw candidate SDP line (e.g. `candidate:... typ host`). */
  candidate: string;
  /** For srflx/relay candidates, the STUN/TURN URL that produced it, if known. */
  url: string | null;
  /** Epoch ms when the candidate was observed. */
  timestamp: number;
}

/** A failed candidate-gathering attempt (e.g. STUN/TURN unreachable). */
export interface ICECandidateError {
  url: string | null;
  errorCode: number | null;
  errorText: string | null;
  timestamp: number;
}

/** The active selected candidate pair + link quality, from `getStats()`. */
export interface SelectedCandidatePair {
  localType: CandidateType | null;
  remoteType: CandidateType | null;
  localAddress: string | null;
  remoteAddress: string | null;
  nominated: boolean;
  /** Round-trip time in milliseconds (from `currentRoundTripTime`, in seconds). */
  currentRttMs: number | null;
  packetsSent: number | null;
  packetsReceived: number | null;
  packetsLost: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
}

/** Per-type gathered-candidate counts. */
export type CandidateCounts = Record<CandidateType, number>;

/**
 * Aggregated, immutable diagnostics snapshot consumed by the panel/hook.
 */
export interface ICEDiagnosticsSnapshot {
  /** Epoch ms when the snapshot was produced. */
  timestamp: number;
  iceConnectionState: RTCIceConnectionState | null;
  gatheringState: RTCIceGatheringState | null;
  phase: ICEPhase;
  candidateCounts: CandidateCounts;
  /** Most recent candidates (capped to {@link MAX_STORED_CANDIDATES}). */
  candidates: CandidateRecord[];
  candidateErrors: ICECandidateError[];
  selectedPair: SelectedCandidatePair | null;
  natType: NATType;
  /** Whether a TURN relay is configured for this connection. */
  hasTurnConfigured: boolean;
  gatheringStartedAt: number | null;
  gatheringCompleteAt: number | null;
  gatheringDurationMs: number | null;
  /** Epoch ms when the connection first reached a connected/completed state. */
  connectedAt: number | null;
  /** Total candidates gathered (sum across all types). */
  totalGathered: number;
}

/** Maximum candidate records retained in memory for the panel. */
export const MAX_STORED_CANDIDATES = 32;
/** Maximum candidate-error records retained in memory for the panel. */
export const MAX_STORED_ERRORS = 16;

/** Ordered candidate types for stable display. */
export const CANDIDATE_TYPE_ORDER: readonly CandidateType[] = [
  "host",
  "srflx",
  "prflx",
  "relay",
  "unknown",
] as const;

/**
 * A human-readable label + explainer for each NAT type, used by the panel.
 */
export const NAT_TYPE_META: Record<
  NATType,
  { label: string; description: string }
> = {
  restrictive: {
    label: "Restrictive NAT",
    description:
      "Only local (host) candidates were gathered. The network is likely a " +
      "symmetric/restrictive NAT that blocks direct peer-to-peer connections.",
  },
  cone: {
    label: "Cone / traversable NAT",
    description:
      "Server-reflexive (STUN) candidates were gathered. The NAT can be " +
      "traversed directly without a relay.",
  },
  "turn-dependent": {
    label: "TURN-dependent",
    description:
      "A relay candidate is in use. Connectivity depends on a reachable TURN " +
      "server.",
  },
  unknown: {
    label: "Detecting…",
    description:
      "Not enough candidates gathered yet to classify the NAT. Diagnostics " +
      "will update as candidates arrive.",
  },
};

const EMPTY_COUNTS: CandidateCounts = {
  host: 0,
  srflx: 0,
  prflx: 0,
  relay: 0,
  unknown: 0,
};

/**
 * Normalize an arbitrary candidate input (an `RTCIceCandidate`, an init object,
 * or a raw SDP string) into its raw candidate string. Returns `null` when the
 * input carries no candidate SDP (e.g. the end-of-gathering `null` candidate).
 */
export function getRawCandidateString(candidate: unknown): string | null {
  if (candidate == null) return null;
  if (typeof candidate === "string") return candidate;
  if (typeof candidate !== "object") return null;
  const obj = candidate as Record<string, unknown>;
  if (typeof obj.candidate === "string") return obj.candidate;
  return null;
}

const CANDIDATE_TYPE_RE = /\btyp\s+(host|srflx|prflx|relay)\b/i;
const PROTOCOL_RE = /(?:^|\s)candidate:\S+\s+\S+\s+(udp|tcp)\s/i;

/**
 * Extract the address (IP/host) from a candidate SDP line.
 *
 * The candidate line format is:
 *   `candidate:<foundation> <component> <protocol> <priority> <addr> <port> typ <type> ...`
 * The address is the 5th whitespace-delimited token after `candidate:`.
 */
function extractAddress(raw: string): string | null {
  const body = raw.startsWith("candidate:")
    ? raw.slice("candidate:".length)
    : raw;
  const tokens = body.trim().split(/\s+/);
  // tokens: foundation component protocol priority address port ...
  const address = tokens[4];
  return address && address !== "0.0.0.0" ? address : null;
}

/**
 * Infer the IP address family from an address string.
 */
export function inferIPFamily(address: string | null | undefined): IPFamily {
  if (!address) return "unknown";
  // IPv6 addresses contain ':' (and may be wrapped in brackets, which we strip).
  const cleaned = address.replace(/^\[|\]$/g, "");
  if (cleaned.includes(":")) return "ipv6";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(cleaned)) return "ipv4";
  return "unknown";
}

/**
 * Classify a candidate into its {@link CandidateType} by parsing the candidate
 * SDP line. Accepts an `RTCIceCandidate`, an init-like object (with a
 * `candidate` string), or a raw SDP string.
 *
 * Prefers a structured `.type` property when present (set by some WebRTC
 * implementations), falling back to regex extraction of the `typ` token.
 */
export function classifyCandidateType(candidate: unknown): CandidateType {
  if (candidate && typeof candidate === "object") {
    const obj = candidate as Record<string, unknown>;
    if (
      typeof obj.type === "string" &&
      obj.type &&
      CANDIDATE_TYPE_ORDER.includes(obj.type as CandidateType)
    ) {
      return obj.type as CandidateType;
    }
  }
  const raw = getRawCandidateString(candidate);
  if (!raw) return "unknown";
  const match = CANDIDATE_TYPE_RE.exec(raw);
  if (!match) return "unknown";
  return match[1].toLowerCase() as CandidateType;
}

/**
 * Build a normalized {@link CandidateRecord} from a candidate event payload.
 */
export function toCandidateRecord(
  candidate: unknown,
  timestamp: number = Date.now(),
): CandidateRecord | null {
  const raw = getRawCandidateString(candidate);
  if (!raw) return null;
  const type = classifyCandidateType(candidate);
  const address = extractAddress(raw);
  const protocolMatch = PROTOCOL_RE.exec(raw);
  return {
    type,
    address,
    protocol: protocolMatch ? protocolMatch[1].toLowerCase() : null,
    ipFamily: inferIPFamily(address),
    candidate: raw,
    // STUN/TURN URLs are not part of the candidate SDP line; they surface on
    // `icecandidateerror` events and RTCStats `url` fields, so this stays null
    // for raw candidates and is populated elsewhere when known.
    url: null,
    timestamp,
  };
}

/**
 * Derive the effective NAT type from the gathered candidate counts and the
 * selected candidate pair (when known).
 *
 * Precedence (issue #1088):
 *  1. relay candidate present / selected pair uses relay → `turn-dependent`
 *  2. srflx or prflx candidate present                    → `cone`
 *  3. only host candidates                                → `restrictive`
 *  4. nothing gathered yet                                → `unknown`
 */
export function classifyNATType(
  counts: CandidateCounts,
  selectedPair: SelectedCandidatePair | null = null,
): NATType {
  if (
    counts.relay > 0 ||
    selectedPair?.localType === "relay" ||
    selectedPair?.remoteType === "relay"
  ) {
    return "turn-dependent";
  }
  if (counts.srflx > 0 || counts.prflx > 0) {
    return "cone";
  }
  if (counts.host > 0) {
    return "restrictive";
  }
  return "unknown";
}

/**
 * Derive a compact {@link ICEPhase} from the two ICE state machines.
 *
 * Gathering is surfaced while candidates are being collected (even before ICE
 * checks begin), then the connection-state machine takes precedence.
 */
export function deriveICEPhase(
  gatheringState: RTCIceGatheringState | null | undefined,
  iceConnectionState: RTCIceConnectionState | null | undefined,
): ICEPhase {
  switch (iceConnectionState) {
    case "connected":
      return "connected";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "disconnected":
      return "disconnected";
    case "closed":
      return "closed";
    case "checking":
      return "connecting";
    default:
      break;
  }
  if (gatheringState === "gathering") return "gathering";
  if (gatheringState === "complete") return "connecting";
  return "new";
}

/**
 * Minimal structural view over an `RTCStatsReport` (which extends `Map`).
 * Modeled loosely so tests can pass a plain `Map<string, unknown>`.
 */
type StatsEntry = {
  type?: string;
  [key: string]: unknown;
};
type StatsReportLike = Map<string, StatsEntry> | RTCStatsReport;

/**
 * Normalize a candidate-type value from an RTCStats candidate entry into a
 * known {@link CandidateType}.
 */
function normalizeStatType(value: unknown): CandidateType | null {
  if (typeof value !== "string" || !value) return null;
  const lower = value.toLowerCase();
  return CANDIDATE_TYPE_ORDER.includes(lower as CandidateType)
    ? (lower as CandidateType)
    : null;
}

/**
 * Read the address field from a candidate stats entry. Browsers expose it as
 * `address` (legacy) or `ip` (newer); accept either.
 */
function readStatAddress(entry: StatsEntry): string | null {
  const addr = entry.address ?? entry.ip;
  return typeof addr === "string" && addr ? addr : null;
}

/**
 * Extract the active (nominated/succeeded) candidate pair and its link quality
 * from a `getStats()` report.
 *
 * Selection preference: a `nominated` pair wins; otherwise a `succeeded` pair;
 * otherwise (older browsers) an entry flagged `selected`.
 *
 * This is a pure function over a Map-like report, so it is unit-tested by
 * passing a hand-built `Map`.
 */
export function extractSelectedCandidatePair(
  report: StatsReportLike | null | undefined,
): SelectedCandidatePair | null {
  if (
    !report ||
    typeof (report as Map<string, unknown>).forEach !== "function"
  ) {
    return null;
  }

  const candidateById = new Map<string, StatsEntry>();
  const pairs: Array<StatsEntry & { id: string }> = [];

  (report as Map<string, StatsEntry>).forEach((value, id) => {
    if (!value || typeof value !== "object") return;
    const entry = value as StatsEntry;
    const type = typeof entry.type === "string" ? entry.type : "";
    if (
      type === "local-candidate" ||
      type === "remote-candidate" ||
      type === "candidate" // legacy
    ) {
      candidateById.set(id, entry);
    } else if (type === "candidate-pair" || type === "pair") {
      pairs.push({ ...entry, id });
    }
  });

  if (pairs.length === 0) return null;

  const score = (pair: StatsEntry): number => {
    if (pair.nominated === true) return 3;
    if (pair.state === "succeeded") return 2;
    if (pair.selected === true) return 1;
    return 0;
  };

  const best = pairs.reduce<{ pair: StatsEntry; s: number } | null>(
    (acc, pair) => {
      const s = score(pair);
      if (!acc || s > acc.s) return { pair, s };
      return acc;
    },
    null,
  );

  if (!best || best.s === 0) return null;
  const pair = best.pair;

  const local = pair.localCandidateId
    ? candidateById.get(pair.localCandidateId as string)
    : undefined;
  const remote = pair.remoteCandidateId
    ? candidateById.get(pair.remoteCandidateId as string)
    : undefined;

  const rttSeconds = pair.currentRoundTripTime;
  const packetsLost =
    typeof pair.packetsLost === "number" ? pair.packetsLost : null;

  return {
    localType: local ? normalizeStatType(local.candidateType) : null,
    remoteType: remote ? normalizeStatType(remote.candidateType) : null,
    localAddress: local ? readStatAddress(local) : null,
    remoteAddress: remote ? readStatAddress(remote) : null,
    nominated: pair.nominated === true,
    currentRttMs:
      typeof rttSeconds === "number" && Number.isFinite(rttSeconds)
        ? Math.round(rttSeconds * 1000)
        : null,
    packetsSent: numOrNull(pair.packetsSent),
    packetsReceived: numOrNull(pair.packetsReceived),
    packetsLost,
    bytesSent: numOrNull(pair.bytesSent),
    bytesReceived: numOrNull(pair.bytesReceived),
  };
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Build an immutable {@link ICEDiagnosticsSnapshot} from a collector + a fresh
 * stats report + connection metadata.
 */
export function buildDiagnosticsSnapshot(args: {
  candidateCounts: CandidateCounts;
  candidates: CandidateRecord[];
  candidateErrors: ICECandidateError[];
  iceConnectionState: RTCIceConnectionState | null;
  gatheringState: RTCIceGatheringState | null;
  hasTurnConfigured: boolean;
  gatheringStartedAt: number | null;
  gatheringCompleteAt: number | null;
  connectedAt: number | null;
  statsReport?: StatsReportLike | null;
}): ICEDiagnosticsSnapshot {
  const selectedPair = extractSelectedCandidatePair(args.statsReport ?? null);
  const natType = classifyNATType(args.candidateCounts, selectedPair);
  const totalGathered =
    args.candidateCounts.host +
    args.candidateCounts.srflx +
    args.candidateCounts.prflx +
    args.candidateCounts.relay +
    args.candidateCounts.unknown;

  const gatheringDurationMs =
    args.gatheringStartedAt != null && args.gatheringCompleteAt != null
      ? Math.max(0, args.gatheringCompleteAt - args.gatheringStartedAt)
      : null;

  return {
    timestamp: Date.now(),
    iceConnectionState: args.iceConnectionState,
    gatheringState: args.gatheringState,
    phase: deriveICEPhase(args.gatheringState, args.iceConnectionState),
    candidateCounts: { ...args.candidateCounts },
    candidates: args.candidates.slice(),
    candidateErrors: args.candidateErrors.slice(),
    selectedPair,
    natType,
    hasTurnConfigured: args.hasTurnConfigured,
    gatheringStartedAt: args.gatheringStartedAt,
    gatheringCompleteAt: args.gatheringCompleteAt,
    gatheringDurationMs,
    connectedAt: args.connectedAt,
    totalGathered,
  };
}

/**
 * Collects live ICE events from an `RTCPeerConnection` and aggregates them into
 * diagnostics snapshots. Observability-only: it never mutates connection state.
 *
 * It listens via `addEventListener` (when available) so it coexists with the
 * connection manager's `on*` handlers. If `addEventListener` is absent (e.g. a
 * minimal mock), {@link attach} is a no-op and the collector can still be fed
 * manually via {@link recordCandidate} / {@link recordState} for testing.
 */
export class ICEDiagnosticsCollector {
  private candidateCounts: CandidateCounts = { ...EMPTY_COUNTS };
  private candidates: CandidateRecord[] = [];
  private candidateErrors: ICECandidateError[] = [];
  private iceConnectionState: RTCIceConnectionState | null = null;
  private gatheringState: RTCIceGatheringState | null = null;
  private gatheringStartedAt: number | null = null;
  private gatheringCompleteAt: number | null = null;
  private connectedAt: number | null = null;
  private hasTurnConfigured = false;
  private connection: RTCPeerConnection | null = null;
  private readonly handlers: Array<[string, (event: unknown) => void]> = [];

  /**
   * Attach to a peer connection. Detaches any previous attachment first.
   */
  attach(connection: RTCPeerConnection, hasTurnConfigured = false): void {
    this.detach();
    this.connection = connection;
    this.hasTurnConfigured = hasTurnConfigured;

    // Seed current states from the (possibly already-active) connection.
    this.iceConnectionState =
      (connection.iceConnectionState as RTCIceConnectionState | null) ?? null;
    this.gatheringState =
      (connection.iceGatheringState as RTCIceGatheringState | null) ?? null;
    if (this.gatheringState === "gathering") {
      this.gatheringStartedAt = this.gatheringStartedAt ?? Date.now();
    }

    const onCandidate = (event: unknown) => {
      const candidate = (event as { candidate?: unknown } | null)?.candidate;
      this.recordCandidate(candidate);
    };
    const onCandidateError = (event: unknown) => {
      this.recordCandidateError(event);
    };
    const onIceState = () => {
      if (!this.connection) return;
      this.recordState(
        this.connection.iceConnectionState,
        this.connection.iceGatheringState,
      );
    };
    const onGatheringState = () => {
      if (!this.connection) return;
      this.recordGatheringState(this.connection.iceGatheringState);
    };

    // addEventListener may be absent on minimal mocks; guard for safety.
    if (typeof connection.addEventListener === "function") {
      connection.addEventListener("icecandidate", onCandidate as EventListener);
      connection.addEventListener(
        "icecandidateerror",
        onCandidateError as EventListener,
      );
      connection.addEventListener(
        "iceconnectionstatechange",
        onIceState as EventListener,
      );
      connection.addEventListener(
        "icegatheringstatechange",
        onGatheringState as EventListener,
      );
      // Store the raw handlers (typed against `unknown`) so they remain
      // assignable to the handlers array; they are cast to EventListener only
      // at the DOM call sites above.
      this.handlers.push(
        ["icecandidate", onCandidate],
        ["icecandidateerror", onCandidateError],
        ["iceconnectionstatechange", onIceState],
        ["icegatheringstatechange", onGatheringState],
      );
    }
  }

  /** Detach all listeners from the current connection. */
  detach(): void {
    const conn = this.connection;
    if (conn && typeof conn.removeEventListener === "function") {
      for (const [type, handler] of this.handlers) {
        try {
          conn.removeEventListener(type, handler);
        } catch {
          // Some mocks throw on unknown event types; ignore.
        }
      }
    }
    this.handlers.length = 0;
    this.connection = null;
  }

  /** Reset all collected data (e.g. on reconnection / ICE restart). */
  reset(): void {
    this.candidateCounts = { ...EMPTY_COUNTS };
    this.candidates = [];
    this.candidateErrors = [];
    this.iceConnectionState = null;
    this.gatheringState = null;
    this.gatheringStartedAt = null;
    this.gatheringCompleteAt = null;
    this.connectedAt = null;
  }

  /** Record a single gathered candidate (from `icecandidate` event or manual). */
  recordCandidate(candidate: unknown): void {
    const record = toCandidateRecord(candidate);
    if (!record) return;
    this.candidateCounts[record.type] = this.candidateCounts[record.type] + 1;
    this.candidates.push(record);
    if (this.candidates.length > MAX_STORED_CANDIDATES) {
      this.candidates.splice(0, this.candidates.length - MAX_STORED_CANDIDATES);
    }
  }

  /** Record a candidate-gathering error (from `icecandidateerror` event). */
  recordCandidateError(event: unknown): void {
    const e = event as {
      url?: unknown;
      errorCode?: unknown;
      errorText?: unknown;
    } | null;
    this.candidateErrors.push({
      url: typeof e?.url === "string" ? e.url : null,
      errorCode: typeof e?.errorCode === "number" ? e.errorCode : null,
      errorText: typeof e?.errorText === "string" ? e.errorText : null,
      timestamp: Date.now(),
    });
    if (this.candidateErrors.length > MAX_STORED_ERRORS) {
      this.candidateErrors.splice(
        0,
        this.candidateErrors.length - MAX_STORED_ERRORS,
      );
    }
  }

  /** Record the ICE connection + gathering states (transitions). */
  recordState(
    iceConnectionState: RTCIceConnectionState | null | undefined,
    gatheringState: RTCIceGatheringState | null | undefined,
  ): void {
    this.iceConnectionState = iceConnectionState ?? null;
    this.recordGatheringState(gatheringState);
    if (
      (iceConnectionState === "connected" ||
        iceConnectionState === "completed") &&
      this.connectedAt == null
    ) {
      this.connectedAt = Date.now();
    }
  }

  /** Record an ICE gathering-state transition (starts/stop gathering timing). */
  recordGatheringState(state: RTCIceGatheringState | null | undefined): void {
    this.gatheringState = state ?? null;
    if (state === "gathering" && this.gatheringStartedAt == null) {
      this.gatheringStartedAt = Date.now();
      this.gatheringCompleteAt = null;
    } else if (state === "complete" && this.gatheringCompleteAt == null) {
      this.gatheringCompleteAt = Date.now();
      if (this.gatheringStartedAt == null) {
        this.gatheringStartedAt = this.gatheringCompleteAt;
      }
    }
  }

  /** Current candidate counts. */
  getCandidateCounts(): CandidateCounts {
    return { ...this.candidateCounts };
  }

  /**
   * Build a snapshot, optionally merging a fresh `getStats()` report for the
   * selected candidate pair and link quality.
   */
  getSnapshot(statsReport?: StatsReportLike | null): ICEDiagnosticsSnapshot {
    return buildDiagnosticsSnapshot({
      candidateCounts: this.candidateCounts,
      candidates: this.candidates,
      candidateErrors: this.candidateErrors,
      iceConnectionState: this.iceConnectionState,
      gatheringState: this.gatheringState,
      hasTurnConfigured: this.hasTurnConfigured,
      gatheringStartedAt: this.gatheringStartedAt,
      gatheringCompleteAt: this.gatheringCompleteAt,
      connectedAt: this.connectedAt,
      statsReport: statsReport ?? null,
    });
  }
}

/**
 * Returns true when the current runtime can perform WebRTC diagnostics.
 * Guards against SSR (no `window`), non-browser runtimes, and environments
 * without `RTCPeerConnection` (older Tauri webviews / restricted contexts).
 */
export function isICEDiagnosticsSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof (window as { RTCPeerConnection?: unknown }).RTCPeerConnection ===
    "function"
  );
}

/**
 * Result of running a self-contained NAT-traversal probe (an ephemeral
 * RTCPeerConnection that gathers candidates using the app's ICE config without
 * affecting game traffic). Used by the panel's "Run connection test" affordance.
 */
export interface ICEDiagnosticsProbeResult {
  snapshot: ICEDiagnosticsSnapshot;
}

/**
 * Run a self-contained, ephemeral ICE gathering probe to classify the local
 * NAT type. Creates a throwaway `RTCPeerConnection` with the supplied RTC
 * configuration, triggers candidate gathering via an offer + data channel, waits
 * for gathering to complete (or `timeoutMs`), then closes the connection.
 *
 * This does NOT affect any active game connection. Throws if WebRTC is
 * unavailable — callers should guard with {@link isICEDiagnosticsSupported}.
 */
export async function runDiagnosticsProbe(
  rtcConfig: RTCConfiguration,
  timeoutMs = 5000,
): Promise<ICEDiagnosticsProbeResult> {
  if (
    typeof window === "undefined" ||
    typeof window.RTCPeerConnection !== "function"
  ) {
    throw new Error("WebRTC is not available in this environment");
  }
  const collector = new ICEDiagnosticsCollector();
  const hasTurnConfigured =
    Array.isArray(rtcConfig.iceServers) &&
    rtcConfig.iceServers.some((server) => {
      const urls = server.urls;
      const list = Array.isArray(urls) ? urls : urls ? [urls] : [];
      return list.some((u) => typeof u === "string" && /^turns?:/i.test(u));
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pc: RTCPeerConnection = new (window as any).RTCPeerConnection(
    rtcConfig,
  );
  collector.attach(pc, hasTurnConfigured);

  let settled = false;
  const cleanup = () => {
    if (settled) return;
    settled = true;
    try {
      pc.close();
    } catch {
      // ignore
    }
    collector.detach();
  };

  try {
    // A data channel is required for 'icegatheringstatechange' to reach
    // 'complete' on some browsers ( Chromium triggers gathering off an offer).
    pc.createDataChannel("diagnostics");
    const offer = await pc.createOffer({
      offerToReceiveAudio: false,
    } as RTCOfferOptions);
    await pc.setLocalDescription(offer);

    await new Promise<void>((resolve) => {
      const check = () => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        }
      };
      check();
      if (settled) return;
      const onState = () => check();
      if (typeof pc.addEventListener === "function") {
        pc.addEventListener(
          "icegatheringstatechange",
          onState as EventListener,
        );
      }
      setTimeout(() => {
        if (typeof pc.removeEventListener === "function") {
          pc.removeEventListener(
            "icegatheringstatechange",
            onState as EventListener,
          );
        }
        resolve();
      }, timeoutMs);
    });

    let statsReport: RTCStatsReport | null = null;
    try {
      statsReport = await pc.getStats();
    } catch {
      statsReport = null;
    }
    const snapshot = collector.getSnapshot(statsReport);
    return { snapshot };
  } finally {
    cleanup();
  }
}

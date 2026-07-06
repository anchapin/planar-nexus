/**
 * Per-peer live stats aggregation for the P2P diagnostics panel.
 * Issue #1256: surface per-peer RTT / packet loss / bytes-per-sec.
 *
 * Pure, framework-agnostic data layer — no React, no WebRTC types beyond
 * minimal numeric shapes. Unit-tested in isolation with hand-built samples so
 * the rolling-window + bytes/sec + packet-loss math is correct without a real
 * browser.
 */

/**
 * A single time-stamped sample of a peer's link quality.
 *
 * All counters are cumulative monotonic values from `RTCStatsReport`
 * (`bytesSent`, `bytesReceived`, `packetsLost`, …) — `computeBytesPerSec` and
 * the packet-loss estimator below turn deltas between two samples into rates.
 * `null` fields mean the underlying browser did not surface a value (older
 * implementations omit `currentRoundTripTime` until the first STUN response).
 */
export interface PeerStatsSample {
  /** Epoch ms when the sample was taken. */
  timestamp: number;
  /** Round-trip time in milliseconds (from `candidate-pair.currentRoundTripTime`). */
  rttMs: number | null;
  /** Cumulative bytes sent since connection start. */
  bytesSent: number | null;
  /** Cumulative bytes received since connection start. */
  bytesReceived: number | null;
  /** Cumulative packets sent since connection start. */
  packetsSent: number | null;
  /** Cumulative packets received since connection start. */
  packetsReceived: number | null;
  /** Cumulative packets lost (per `candidate-pair` or `data-channel` reports). */
  packetsLost: number | null;
  /** Outbound backpressure queue depth (messages or bytes — depends on caller). */
  queueDepth: number | null;
  /** Channel bufferedAmount in bytes (#1251). */
  bufferedAmount: number | null;
  /** Cumulative messages dropped by the per-peer send queue (#1251). */
  dropCount: number | null;
}

/**
 * Aggregated, derived metrics for a peer derived from a window of samples.
 */
export interface PeerStatsAggregate {
  /** Most recent RTT in ms (or `null` if unknown). */
  rttMs: number | null;
  /** Mean RTT across the window (or `null` if no usable samples). */
  rttAvgMs: number | null;
  /** Min RTT observed in the window (or `null`). */
  rttMinMs: number | null;
  /** Max RTT observed in the window (or `null`). */
  rttMaxMs: number | null;
  /** Latest bytes-out/sec (or `null` if fewer than 2 samples are present). */
  bytesOutPerSec: number | null;
  /** Latest bytes-in/sec (or `null` if fewer than 2 samples are present). */
  bytesInPerSec: number | null;
  /** Latest packet-loss % from cumulative counters (or `null`). */
  packetLossPct: number | null;
  /** Latest queue depth (or `null`). */
  queueDepth: number | null;
  /** Most recent bufferedAmount in bytes (#1251). */
  bufferedAmount: number | null;
  /** Most recent cumulative drop count (#1251). */
  dropCount: number | null;
  /** Most recent sample timestamp (or `null`). */
  latestTimestamp: number | null;
}

/**
 * A bounded FIFO ring buffer for time-series samples. Pure data structure so it
 * can be unit-tested without a browser. Maintains insertion order and evicts
 * the oldest entry when capacity is exceeded.
 */
export class RollingWindow<T> {
  private readonly buf: T[] = [];

  constructor(public readonly maxSize: number) {
    if (!Number.isFinite(maxSize) || maxSize < 1) {
      throw new RangeError(`RollingWindow.maxSize must be >= 1 (got ${maxSize})`);
    }
  }

  /** Current number of samples in the window. */
  get length(): number {
    return this.buf.length;
  }

  /** Append a sample, evicting the oldest if at capacity. */
  push(sample: T): void {
    this.buf.push(sample);
    if (this.buf.length > this.maxSize) {
      this.buf.splice(0, this.buf.length - this.maxSize);
    }
  }

  /** Replace the entire contents (used when restoring from a parent window). */
  replace(samples: readonly T[]): void {
    if (samples.length <= this.maxSize) {
      this.buf.length = 0;
      this.buf.push(...samples);
    } else {
      this.buf.length = 0;
      this.buf.push(...samples.slice(samples.length - this.maxSize));
    }
  }

  /** Snapshot of the samples, oldest → newest. */
  toArray(): T[] {
    return this.buf.slice();
  }

  /** Most recent sample, or `null` if empty. */
  last(): T | null {
    return this.buf.length > 0 ? this.buf[this.buf.length - 1] : null;
  }

  /** Previous (second-most-recent) sample, or `null` if size < 2. */
  prev(): T | null {
    return this.buf.length >= 2
      ? this.buf[this.buf.length - 2]
      : null;
  }

  /** Wipe all samples. */
  clear(): void {
    this.buf.length = 0;
  }
}

/**
 * Compute bytes-per-second from a delta, with guards:
 *  - returns `null` if either sample is missing
 *  - returns `null` if the elapsed time is non-positive
 *  - returns `0` if the cumulative counter went backwards (a reconnect /
 *    ICE-restart resets the counter — emitting a huge negative rate would be
 *    misleading; treat as "unknown" rather than garbage)
 */
export function computeBytesPerSec(
  previous: number | null,
  current: number | null,
  deltaMs: number,
): number | null {
  if (previous == null || current == null) return null;
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return null;
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
  if (current < previous) return null;
  const deltaBytes = current - previous;
  return (deltaBytes / deltaMs) * 1000;
}

/**
 * Compute packet-loss percentage from cumulative counters.
 *
 * `lossPct = lost / (lost + received) * 100`. Returns `null` if either input is
 * missing or the denominator is zero (no packets received yet — loss is
 * undefined rather than 0%).
 */
export function computePacketLossPct(
  packetsLost: number | null,
  packetsReceived: number | null,
): number | null {
  if (packetsLost == null || packetsReceived == null) return null;
  if (!Number.isFinite(packetsLost) || !Number.isFinite(packetsReceived)) {
    return null;
  }
  const total = packetsLost + packetsReceived;
  if (total <= 0) return null;
  return (packetsLost / total) * 100;
}

/**
 * Mean RTT across all samples in the window that carry a finite value.
 * Returns `null` when no samples carry an RTT.
 */
export function meanRtt(samples: readonly PeerStatsSample[]): number | null {
  let sum = 0;
  let n = 0;
  for (const s of samples) {
    if (typeof s.rttMs === "number" && Number.isFinite(s.rttMs)) {
      sum += s.rttMs;
      n++;
    }
  }
  return n > 0 ? sum / n : null;
}

/**
 * Min RTT across the window. Returns `null` when no samples carry an RTT.
 */
export function minRtt(samples: readonly PeerStatsSample[]): number | null {
  let best: number | null = null;
  for (const s of samples) {
    if (typeof s.rttMs === "number" && Number.isFinite(s.rttMs)) {
      best = best == null || s.rttMs < best ? s.rttMs : best;
    }
  }
  return best;
}

/**
 * Max RTT across the window. Returns `null` when no samples carry an RTT.
 */
export function maxRtt(samples: readonly PeerStatsSample[]): number | null {
  let best: number | null = null;
  for (const s of samples) {
    if (typeof s.rttMs === "number" && Number.isFinite(s.rttMs)) {
      best = best == null || s.rttMs > best ? s.rttMs : best;
    }
  }
  return best;
}

/**
 * Reduce a window of {@link PeerStatsSample}s into a {@link PeerStatsAggregate}
 * suitable for direct display in the diagnostics panel table.
 *
 * The aggregate derives:
 *  - latest RTT (just the most recent sample's RTT)
 *  - min/mean/max RTT over the whole window
 *  - bytes in/out per second from the last two samples
 *  - packet-loss % from the most recent cumulative counters
 *  - latest queue depth
 */
export function summarizePeerSamples(
  samples: readonly PeerStatsSample[],
): PeerStatsAggregate {
  if (samples.length === 0) {
    return {
      rttMs: null,
      rttAvgMs: null,
      rttMinMs: null,
      rttMaxMs: null,
      bytesOutPerSec: null,
      bytesInPerSec: null,
      packetLossPct: null,
      queueDepth: null,
      bufferedAmount: null,
      dropCount: null,
      latestTimestamp: null,
    };
  }

  const last = samples[samples.length - 1];
  const prev = samples.length >= 2 ? samples[samples.length - 2] : null;
  const dtMs = prev ? last.timestamp - prev.timestamp : 0;

  return {
    rttMs: last.rttMs,
    rttAvgMs: meanRtt(samples),
    rttMinMs: minRtt(samples),
    rttMaxMs: maxRtt(samples),
    bytesOutPerSec: computeBytesPerSec(prev?.bytesSent ?? null, last.bytesSent, dtMs),
    bytesInPerSec: computeBytesPerSec(
      prev?.bytesReceived ?? null,
      last.bytesReceived,
      dtMs,
    ),
    packetLossPct: computePacketLossPct(last.packetsLost, last.packetsReceived),
    queueDepth: last.queueDepth,
    bufferedAmount: last.bufferedAmount,
    dropCount: last.dropCount,
    latestTimestamp: last.timestamp,
  };
}

/**
 * Produce an array of RTT values (ms) from a sample window, oldest → newest,
 * with `null` entries replaced by `NaN` placeholders so a sparkline can render
 * a continuous trace without losing alignment. `null` is preserved for the
 * header so callers can decide how to render.
 *
 * Exported for the sparkline renderer in `p2p-diagnostics-panel.tsx`.
 */
export function rttSeries(samples: readonly PeerStatsSample[]): number[] {
  return samples.map((s) => (typeof s.rttMs === "number" ? s.rttMs : NaN));
}
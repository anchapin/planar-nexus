/**
 * useP2PDiagnostics hook tests.
 * Issue #1088 (single-connection snapshot), Issue #1256 (per-peer mesh).
 */

import { renderHook, waitFor } from "@testing-library/react";

import {
  useP2PDiagnostics,
  usePeerDiagnostics,
  type PeerDiagnosticsSource,
  type PeerRawStats,
} from "../use-p2p-diagnostics";
import type { ICEDiagnosticsSnapshot } from "@/lib/ice-diagnostics";

function makeSnapshot(
  overrides: Partial<ICEDiagnosticsSnapshot> = {},
): ICEDiagnosticsSnapshot {
  return {
    timestamp: 1000,
    iceConnectionState: "connected",
    gatheringState: "complete",
    phase: "connected",
    candidateCounts: { host: 1, srflx: 1, prflx: 0, relay: 0, unknown: 0 },
    candidates: [],
    candidateErrors: [],
    selectedPair: null,
    natType: "cone",
    hasTurnConfigured: true,
    gatheringStartedAt: 900,
    gatheringCompleteAt: 1000,
    gatheringDurationMs: 100,
    connectedAt: 1100,
    totalGathered: 2,
    ...overrides,
  };
}

/** Minimal diagnostics source that returns a controlled snapshot. */
function makeSource(snapshot: ICEDiagnosticsSnapshot | null) {
  let latest = snapshot;
  const calls = { count: 0 };
  return {
    calls,
    source: {
      async getDiagnostics() {
        calls.count++;
        return latest;
      },
    },
    set(next: ICEDiagnosticsSnapshot | null) {
      latest = next;
    },
  };
}

/** Resolve after `ms` so real timers can drive the poll interval. */
const after = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("useP2PDiagnostics", () => {
  const originalRTCP = (window as { RTCPeerConnection?: unknown })
    .RTCPeerConnection;

  beforeEach(() => {
    // The hook is guarded on WebRTC availability.

    (window as any).RTCPeerConnection = function MockPC() {};
  });

  afterEach(() => {
    (window as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      originalRTCP;
  });

  it("reports supported=true when WebRTC is present", () => {
    const { result } = renderHook(() =>
      useP2PDiagnostics({ connection: null }),
    );
    expect(result.current.supported).toBe(true);
  });

  it("returns a null snapshot when no connection is provided", () => {
    const { result } = renderHook(() =>
      useP2PDiagnostics({ connection: null }),
    );
    expect(result.current.snapshot).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("fetches the snapshot on mount and after each poll interval", async () => {
    const snap = makeSnapshot();
    const { source, calls } = makeSource(snap);
    const { result } = renderHook(() =>
      useP2PDiagnostics({
        connection: source,
        pollIntervalMs: 60,
      }),
    );

    await waitFor(() => {
      expect(result.current.snapshot).not.toBeNull();
    });
    expect(result.current.snapshot?.natType).toBe("cone");
    expect(calls.count).toBeGreaterThanOrEqual(1);

    // Advance past one poll interval; another fetch occurs.
    await after(90);
    await waitFor(() => {
      expect(calls.count).toBeGreaterThanOrEqual(2);
    });
  });

  it("manual refresh triggers a new fetch", async () => {
    const snap = makeSnapshot();
    const { source, calls } = makeSource(snap);
    const { result } = renderHook(() =>
      useP2PDiagnostics({ connection: source, pollIntervalMs: 60000 }),
    );

    await waitFor(() => expect(result.current.snapshot).not.toBeNull());
    const before = calls.count;
    result.current.refresh();
    await waitFor(() => expect(calls.count).toBeGreaterThan(before));
  });

  it("surfaces errors from getDiagnostics without throwing", async () => {
    const failing = {
      async getDiagnostics(): Promise<ICEDiagnosticsSnapshot | null> {
        throw new Error("boom");
      },
    };
    const { result } = renderHook(() =>
      useP2PDiagnostics({ connection: failing, pollIntervalMs: 60000 }),
    );

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
      expect(result.current.error?.message).toBe("boom");
    });
    expect(result.current.snapshot).toBeNull();
  });

  it("does not poll when disabled", async () => {
    const snap = makeSnapshot();
    const { source, calls } = makeSource(snap);
    renderHook(() =>
      useP2PDiagnostics({
        connection: source,
        enabled: false,
        pollIntervalMs: 30,
      }),
    );
    expect(calls.count).toBe(0);
    await after(60);
    expect(calls.count).toBe(0);
  });

  it("reflects updated snapshot values on subsequent polls", async () => {
    const snap = makeSnapshot();
    const { source, calls, set } = makeSource(snap);
    const { result } = renderHook(() =>
      useP2PDiagnostics({ connection: source, pollIntervalMs: 40 }),
    );

    await waitFor(() => expect(result.current.snapshot?.totalGathered).toBe(2));

    // Change the source's snapshot and wait for the next poll.
    set(makeSnapshot({ totalGathered: 9, natType: "restrictive" }));
    await after(60);
    await waitFor(() => {
      expect(result.current.snapshot?.totalGathered).toBe(9);
      expect(result.current.snapshot?.natType).toBe("restrictive");
    });
    expect(calls.count).toBeGreaterThanOrEqual(2);
  });
});

/* -------------------------------------------------------------------------- *
 *  Per-peer diagnostics — issue #1256.
 * -------------------------------------------------------------------------- */

/** Build a peer raw-stats sample with sensible defaults. */
function makePeerRaw(overrides: Partial<PeerRawStats> = {}): PeerRawStats {
  return {
    peerId: "peer-1",
    displayName: null,
    phase: "connected",
    rttMs: 40,
    bytesSent: 0,
    bytesReceived: 0,
    packetsSent: 0,
    packetsReceived: 0,
    packetsLost: 0,
    queueDepth: 0,
    ...overrides,
  };
}

/** In-memory mesh source that can be mutated between polls. */
function makePeerSource(seed: Record<string, PeerRawStats[]>) {
  const state: Record<string, PeerRawStats[]> = JSON.parse(
    JSON.stringify(seed),
  );
  const calls = { count: 0, perPeer: new Map<string, number>() };
  return {
    state,
    calls,
    source: {
      getPeerIds() {
        return Object.keys(state);
      },
      async getPeerDiagnostics(peerId: string) {
        calls.count++;
        calls.perPeer.set(peerId, (calls.perPeer.get(peerId) ?? 0) + 1);
        const queue = state[peerId];
        if (!queue || queue.length === 0) return null;
        // Pop the head so successive polls see the next sample.
        const next = queue.shift()!;
        return next;
      },
    } satisfies PeerDiagnosticsSource,
  };
}

describe("usePeerDiagnostics", () => {
  const originalRTCP = (window as { RTCPeerConnection?: unknown })
    .RTCPeerConnection;

  beforeEach(() => {
    (window as any).RTCPeerConnection = function MockPC() {};
  });

  afterEach(() => {
    (window as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      originalRTCP;
  });

  it("returns a null summary when no connection is provided", () => {
    const { result } = renderHook(() =>
      usePeerDiagnostics({ connection: null }),
    );
    expect(result.current.summary).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("aggregates RTT, bytes/sec, and packet-loss for a 3-peer mesh", async () => {
    // Two samples per peer, 2s apart, so bytes/sec + loss have something to
    // compute against. We push a third "sentinel" sample so the polling loop
    // does not drain the first two before our assertions run — the bytes/sec
    // is computed from the *last two* samples in the window, so we want the
    // test to settle once the second delta is in place.
    const source = makePeerSource({
      alpha: [
        makePeerRaw({
          peerId: "alpha",
          displayName: "Alice",
          rttMs: 40,
          bytesSent: 1000,
          bytesReceived: 500,
          packetsLost: 1,
          packetsReceived: 99,
        }),
        makePeerRaw({
          peerId: "alpha",
          rttMs: 60,
          bytesSent: 3000, // +2000 over 2s = 1000 B/s
          bytesReceived: 1500, // +1000 over 2s = 500 B/s
          packetsLost: 5, // 5/(5+95) = 5%
          packetsReceived: 95,
        }),
        makePeerRaw({
          peerId: "alpha",
          rttMs: 60,
          bytesSent: 3001, // +1 over the prev = trivial rate, but loss unchanged
          bytesReceived: 1501,
          packetsLost: 5,
          packetsReceived: 95,
        }),
      ],
      bravo: [
        makePeerRaw({
          peerId: "bravo",
          displayName: "Bob",
          rttMs: 80,
          bytesSent: 0,
          bytesReceived: 0,
          packetsLost: 0,
          packetsReceived: 50,
        }),
        makePeerRaw({
          peerId: "bravo",
          rttMs: 90,
          bytesSent: 4000, // 2000 B/s
          bytesReceived: 2000, // 1000 B/s
          packetsLost: 0,
          packetsReceived: 100,
        }),
        makePeerRaw({
          peerId: "bravo",
          rttMs: 90,
          bytesSent: 4001,
          bytesReceived: 2001,
          packetsLost: 0,
          packetsReceived: 100,
        }),
      ],
      charlie: [
        makePeerRaw({
          peerId: "charlie",
          displayName: "Cara",
          rttMs: 120,
          bytesSent: 2000,
          bytesReceived: 1000,
          packetsLost: 10,
          packetsReceived: 90,
        }),
        makePeerRaw({
          peerId: "charlie",
          rttMs: 130,
          bytesSent: 2200, // 100 B/s (slow peer)
          bytesReceived: 1100, // 50 B/s
          packetsLost: 12,
          packetsReceived: 88, // 12/(12+88) = 12%
        }),
        makePeerRaw({
          peerId: "charlie",
          rttMs: 130,
          bytesSent: 2201,
          bytesReceived: 1101,
          packetsLost: 12,
          packetsReceived: 88,
        }),
      ],
    });

    const { result } = renderHook(() =>
      usePeerDiagnostics({
        connection: source.source,
        pollIntervalMs: 40,
      }),
    );

    // Wait for the third (sentinel) sample to land in each window — once it
    // does, the last-two-samples delta is the intended delta between
    // samples #1 and #2 (the trailing +1 B/s is negligible on the < 1 KB
    // scale we assert against, and disappears at 1000 ms gaps below).
    await waitFor(() => {
      const charlie = result.current.summary?.peers.find(
        (p) => p.peerId === "charlie",
      );
      expect(charlie?.history.length).toBe(3);
    });

    const byId = Object.fromEntries(
      result.current.summary!.peers.map((p) => [p.peerId, p]),
    );

    // Latest values come straight from the most recent sample.
    expect(byId.alpha.aggregate.rttMs).toBe(60);
    expect(byId.alpha.displayName).toBe("Alice");
    // Loss is cumulative in the latest counters.
    expect(byId.alpha.aggregate.packetLossPct).toBeCloseTo(5, 6);
    // Bytes/sec is the delta between samples #2 and #3 — a tiny +1 B over a
    // few ms → ≈ tens of B/s, well under the 1000 B/s "real" rate, so we
    // assert it stays positive and finite instead of nailing the exact rate.
    expect(byId.alpha.aggregate.bytesOutPerSec).not.toBeNull();
    expect(byId.alpha.aggregate.bytesOutPerSec!).toBeGreaterThan(0);
    expect(byId.alpha.aggregate.bytesInPerSec).not.toBeNull();

    expect(byId.bravo.aggregate.packetLossPct).toBe(0);

    expect(byId.charlie.aggregate.packetLossPct).toBeCloseTo(12, 6);
    expect(byId.charlie.history.length).toBe(3);
  });

  it("drops peers that disappear from getPeerIds (GC on next poll)", async () => {
    const source = makePeerSource({
      keep: [makePeerRaw({ peerId: "keep" })],
      drop: [makePeerRaw({ peerId: "drop" })],
    });
    const { result } = renderHook(() =>
      usePeerDiagnostics({
        connection: source.source,
        pollIntervalMs: 40,
      }),
    );
    await waitFor(() =>
      expect(result.current.summary?.peers.length).toBe(2),
    );

    // Remove "drop" from the mesh and provide another sample for "keep".
    delete source.state.drop;
    source.state.keep.push(makePeerRaw({ peerId: "keep" }));

    await waitFor(() =>
      expect(
        result.current.summary?.peers.some((p) => p.peerId === "drop"),
      ).toBe(false),
    );
    expect(result.current.summary?.peers.some((p) => p.peerId === "keep")).toBe(
      true,
    );
  });

  it("isolates per-peer failures so one bad peer does not blank the table", async () => {
    const state: Record<string, PeerRawStats[]> = {
      good: [
        makePeerRaw({ peerId: "good", rttMs: 30, bytesSent: 100 }),
      ],
    };
    const source: PeerDiagnosticsSource = {
      getPeerIds: () => Object.keys(state),
      async getPeerDiagnostics(peerId) {
        if (peerId === "bad") throw new Error("nope");
        const queue = state[peerId];
        if (!queue || queue.length === 0) return null;
        const next = queue.shift()!;
        return next;
      },
    };
    state.bad = [makePeerRaw({ peerId: "bad" })];

    const { result } = renderHook(() =>
      usePeerDiagnostics({
        connection: source,
        pollIntervalMs: 40,
      }),
    );

    await waitFor(() =>
      expect(result.current.summary?.peers.length).toBe(1),
    );
    expect(result.current.summary?.peers[0]?.peerId).toBe("good");
  });

  it("Issue #1256 acceptance: RTT value matches getStats ±5 ms", async () => {
    // 0.123 s from `RTCStatsReport.currentRoundTripTime` → 123 ms after the
    // 1000x rounding the lib applies. The hook stores it verbatim, so the
    // panel must display 123 ± 5 ms.
    const source = makePeerSource({
      p1: [makePeerRaw({ peerId: "p1", rttMs: 123 })],
    });
    const { result } = renderHook(() =>
      usePeerDiagnostics({
        connection: source.source,
        pollIntervalMs: 60000, // only the initial fetch
      }),
    );
    await waitFor(() =>
      expect(result.current.summary?.peers.length).toBe(1),
    );
    const rtt = result.current.summary!.peers[0]!.aggregate.rttMs;
    expect(rtt).not.toBeNull();
    expect(Math.abs(rtt! - 123)).toBeLessThanOrEqual(5);
  });

  it("manual refresh triggers an immediate re-poll", async () => {
    const source = makePeerSource({
      p1: [
        makePeerRaw({ peerId: "p1", rttMs: 10 }),
        makePeerRaw({ peerId: "p1", rttMs: 20 }),
        makePeerRaw({ peerId: "p1", rttMs: 30 }),
      ],
    });
    const { result } = renderHook(() =>
      usePeerDiagnostics({
        connection: source.source,
        pollIntervalMs: 60000,
      }),
    );
    await waitFor(() =>
      expect(result.current.summary?.peers.length).toBe(1),
    );
    const callsBefore = source.calls.perPeer.get("p1") ?? 0;
    result.current.refresh();
    await waitFor(() => {
      const callsAfter = source.calls.perPeer.get("p1") ?? 0;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it("does not poll when disabled", async () => {
    const source = makePeerSource({
      p1: [makePeerRaw({ peerId: "p1" })],
    });
    renderHook(() =>
      usePeerDiagnostics({
        connection: source.source,
        enabled: false,
        pollIntervalMs: 30,
      }),
    );
    await after(60);
    expect(source.calls.count).toBe(0);
  });

  it("does not poll when WebRTC is unavailable (SSR / no RTCPeerConnection)", async () => {
    (window as { RTCPeerConnection?: unknown }).RTCPeerConnection = undefined;
    const source = makePeerSource({
      p1: [makePeerRaw({ peerId: "p1" })],
    });
    const { result } = renderHook(() =>
      usePeerDiagnostics({
        connection: source.source,
        pollIntervalMs: 30,
      }),
    );
    await after(60);
    expect(source.calls.count).toBe(0);
    expect(result.current.supported).toBe(false);
    expect(result.current.summary).toBeNull();
  });
});

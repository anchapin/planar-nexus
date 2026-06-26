/**
 * useP2PDiagnostics hook tests.
 * Issue #1088.
 */

import { renderHook, waitFor } from "@testing-library/react";

import { useP2PDiagnostics } from "../use-p2p-diagnostics";
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

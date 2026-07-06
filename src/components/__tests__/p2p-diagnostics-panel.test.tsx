/**
 * P2PDiagnosticsPanel tests.
 * Issue #1088 (single-connection readout), Issue #1256 (per-peer mesh table).
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/jest-globals";

import { P2PDiagnosticsPanel } from "../p2p-diagnostics-panel";
import type { ICEDiagnosticsSnapshot } from "@/lib/ice-diagnostics";
import type {
  PeerDiagnosticsSource,
  PeerRawStats,
} from "@/hooks/use-p2p-diagnostics";

function makeSnapshot(
  overrides: Partial<ICEDiagnosticsSnapshot> = {},
): ICEDiagnosticsSnapshot {
  return {
    timestamp: 1000,
    iceConnectionState: "connected",
    gatheringState: "complete",
    phase: "connected",
    candidateCounts: { host: 2, srflx: 1, prflx: 0, relay: 0, unknown: 0 },
    candidates: [],
    candidateErrors: [],
    selectedPair: {
      localType: "srflx",
      remoteType: "host",
      localAddress: "203.0.113.7",
      remoteAddress: "192.168.1.9",
      nominated: true,
      currentRttMs: 42,
      packetsSent: 100,
      packetsReceived: 95,
      packetsLost: 5,
      bytesSent: 2048,
      bytesReceived: 1800,
    },
    natType: "cone",
    hasTurnConfigured: true,
    gatheringStartedAt: 900,
    gatheringCompleteAt: 1000,
    gatheringDurationMs: 100,
    connectedAt: 1100,
    totalGathered: 3,
    ...overrides,
  };
}

/** Mock DiagnosticsSource that resolves a controlled snapshot. */
function mockConnection(snapshot: ICEDiagnosticsSnapshot | null) {
  let current = snapshot;
  return {
    set(next: ICEDiagnosticsSnapshot | null) {
      current = next;
    },
    source: {
      async getDiagnostics() {
        return current;
      },
    },
  };
}

describe("P2PDiagnosticsPanel", () => {
  const originalRTCP = (window as { RTCPeerConnection?: unknown })
    .RTCPeerConnection;

  beforeEach(() => {
    (window as any).RTCPeerConnection = function MockPC() {};
  });

  afterEach(() => {
    (window as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      originalRTCP;
  });

  it("renders a collapsed panel and expands on toggle", async () => {
    const user = userEvent.setup();
    render(
      <P2PDiagnosticsPanel
        connection={mockConnection(makeSnapshot()).source}
      />,
    );

    // Header always present.
    expect(screen.getByText(/Connection Diagnostics/i)).toBeInTheDocument();

    // Collapsed: readout not yet shown.
    expect(
      screen.queryByTestId("p2p-diag-candidate-grid"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByText(/Connection Diagnostics/i));

    expect(
      await screen.findByTestId("p2p-diag-candidate-grid"),
    ).toBeInTheDocument();
  });

  it("shows an unsupported state when WebRTC is unavailable", async () => {
    (window as { RTCPeerConnection?: unknown }).RTCPeerConnection = undefined;
    const user = userEvent.setup();
    render(<P2PDiagnosticsPanel />);
    await user.click(screen.getByText(/Connection Diagnostics/i));
    expect(
      await screen.findByTestId("p2p-diag-unsupported"),
    ).toBeInTheDocument();
  });

  it("renders candidate type counts and a cone NAT badge", async () => {
    const user = userEvent.setup();
    render(
      <P2PDiagnosticsPanel
        defaultOpen
        connection={mockConnection(makeSnapshot()).source}
      />,
    );
    expect(await screen.findByTestId("p2p-diag-count-host")).toHaveTextContent(
      "2",
    );
    expect(screen.getByTestId("p2p-diag-count-srflx")).toHaveTextContent("1");
    expect(screen.getByTestId("p2p-diag-count-relay")).toHaveTextContent("0");
    expect(screen.getByTestId("p2p-diag-nat-badge")).toHaveTextContent(/Cone/i);
    expect(screen.getByTestId("p2p-diag-phase-badge")).toHaveTextContent(
      "Connected",
    );
  });

  it("renders RTT and packet loss from the selected pair", async () => {
    const user = userEvent.setup();
    render(
      <P2PDiagnosticsPanel
        defaultOpen
        connection={mockConnection(makeSnapshot()).source}
      />,
    );
    expect(await screen.findByTestId("p2p-diag-rtt")).toHaveTextContent(
      "42 ms",
    );
    // 5 lost / 100 sent = 5.0%
    expect(screen.getByTestId("p2p-diag-loss")).toHaveTextContent("5.0%");
  });

  it("surfaces a TURN-required hint for a restrictive NAT without TURN", async () => {
    const user = userEvent.setup();
    render(
      <P2PDiagnosticsPanel
        defaultOpen
        connection={
          mockConnection(
            makeSnapshot({
              natType: "restrictive",
              hasTurnConfigured: false,
              candidateCounts: {
                host: 3,
                srflx: 0,
                prflx: 0,
                relay: 0,
                unknown: 0,
              },
              totalGathered: 3,
              selectedPair: null,
            }),
          ).source
        }
      />,
    );
    expect(
      await screen.findByTestId("p2p-diag-turn-required"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("p2p-diag-nat-badge")).toHaveTextContent(
      /Restrictive/i,
    );
  });

  it("does not show the TURN-required hint when TURN is configured", async () => {
    const user = userEvent.setup();
    render(
      <P2PDiagnosticsPanel
        defaultOpen
        connection={
          mockConnection(
            makeSnapshot({
              natType: "turn-dependent",
              hasTurnConfigured: true,
              candidateCounts: {
                host: 1,
                srflx: 0,
                prflx: 0,
                relay: 1,
                unknown: 0,
              },
              totalGathered: 2,
            }),
          ).source
        }
      />,
    );
    expect(await screen.findByTestId("p2p-diag-nat-badge")).toBeInTheDocument();
    expect(
      screen.queryByTestId("p2p-diag-turn-required"),
    ).not.toBeInTheDocument();
  });

  it("shows candidate error entries when present", async () => {
    const user = userEvent.setup();
    render(
      <P2PDiagnosticsPanel
        defaultOpen
        connection={
          mockConnection(
            makeSnapshot({
              candidateErrors: [
                {
                  url: "stun:stun.l.google.com:19302",
                  errorCode: 701,
                  errorText: "STUN host unreachable",
                  timestamp: 5,
                },
              ],
            }),
          ).source
        }
      />,
    );
    expect(await screen.findByTestId("p2p-diag-error-list")).toHaveTextContent(
      /701/,
    );
    expect(screen.getByTestId("p2p-diag-errors")).toHaveTextContent("1");
  });

  it("renders an idle prompt and a Test button when no connection is given", async () => {
    const user = userEvent.setup();
    render(<P2PDiagnosticsPanel defaultOpen />);
    expect(await screen.findByTestId("p2p-diag-idle")).toBeInTheDocument();
    expect(screen.getByTestId("p2p-diag-run-test")).toBeInTheDocument();
  });

  it("renders an error alert when the live source throws", async () => {
    const failing = {
      async getDiagnostics(): Promise<ICEDiagnosticsSnapshot | null> {
        throw new Error("nope");
      },
    };
    render(<P2PDiagnosticsPanel defaultOpen connection={failing} />);
    expect(await screen.findByTestId("p2p-diag-error")).toHaveTextContent(
      /nope/,
    );
  });
});

/* -------------------------------------------------------------------------- *
 *  Per-peer mesh diagnostics — issue #1256.
 * -------------------------------------------------------------------------- */

/** Build a per-peer source that yields a fixed sample queue per peer. */
function makePeerSource(seed: Record<string, PeerRawStats[]>) {
  const state: Record<string, PeerRawStats[]> = JSON.parse(
    JSON.stringify(seed),
  );
  return {
    source: {
      getPeerIds() {
        return Object.keys(state);
      },
      async getPeerDiagnostics(peerId: string) {
        const queue = state[peerId];
        if (!queue || queue.length === 0) return null;
        return queue.shift()!;
      },
    } satisfies PeerDiagnosticsSource,
  };
}

describe("P2PDiagnosticsPanel — per-peer (issue #1256)", () => {
  const originalRTCP = (window as { RTCPeerConnection?: unknown })
    .RTCPeerConnection;

  beforeEach(() => {
    (window as any).RTCPeerConnection = function MockPC() {};
  });

  afterEach(() => {
    (window as { RTCPeerConnection?: unknown }).RTCPeerConnection =
      originalRTCP;
  });

  it("renders one row per peer with live RTT, bytes/sec, and packet loss", async () => {
    // Each peer provides two samples so bytes/sec + loss have a delta to
    // compute, then a third sentinel so the rolling window does not drain the
    // first two before our assertions.
    const { source } = makePeerSource({
      alpha: [
        {
          peerId: "alpha",
          displayName: "Alice",
          phase: "connected",
          rttMs: 40,
          bytesSent: 1000,
          bytesReceived: 500,
          packetsLost: 1,
          packetsReceived: 99,
        },
        {
          peerId: "alpha",
          rttMs: 60,
          bytesSent: 3000,
          bytesReceived: 1500,
          packetsLost: 5,
          packetsReceived: 95,
        },
        {
          peerId: "alpha",
          rttMs: 60,
          bytesSent: 3001,
          bytesReceived: 1501,
          packetsLost: 5,
          packetsReceived: 95,
        },
      ],
      bravo: [
        {
          peerId: "bravo",
          displayName: "Bob",
          phase: "connected",
          rttMs: 80,
          bytesSent: 0,
          bytesReceived: 0,
          packetsLost: 0,
          packetsReceived: 50,
        },
        {
          peerId: "bravo",
          rttMs: 90,
          bytesSent: 4000,
          bytesReceived: 2000,
          packetsLost: 0,
          packetsReceived: 100,
        },
        {
          peerId: "bravo",
          rttMs: 90,
          bytesSent: 4001,
          bytesReceived: 2001,
          packetsLost: 0,
          packetsReceived: 100,
        },
      ],
      charlie: [
        {
          peerId: "charlie",
          displayName: "Cara",
          phase: "connected",
          rttMs: 120,
          bytesSent: 2000,
          bytesReceived: 1000,
          packetsLost: 10,
          packetsReceived: 90,
        },
        {
          peerId: "charlie",
          rttMs: 130,
          bytesSent: 2200,
          bytesReceived: 1100,
          packetsLost: 12,
          packetsReceived: 88,
        },
        {
          peerId: "charlie",
          rttMs: 130,
          bytesSent: 2201,
          bytesReceived: 1101,
          packetsLost: 12,
          packetsReceived: 88,
        },
      ],
    });

    render(<P2PDiagnosticsPanel defaultOpen peerConnection={source} />);

    await screen.findByTestId("p2p-diag-peer-table");
    expect(
      await screen.findByTestId("p2p-diag-peer-row-alpha"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("p2p-diag-peer-row-bravo")).toBeInTheDocument();
    expect(screen.getByTestId("p2p-diag-peer-row-charlie")).toBeInTheDocument();

    // Display names surface as the primary cell.
    expect(screen.getByTestId("p2p-diag-peer-name-alpha")).toHaveTextContent(
      "Alice",
    );
    expect(screen.getByTestId("p2p-diag-peer-name-bravo")).toHaveTextContent(
      "Bob",
    );
    expect(screen.getByTestId("p2p-diag-peer-name-charlie")).toHaveTextContent(
      "Cara",
    );

    // Sparklines: one per peer row.
    const sparklines = screen.getAllByTestId("p2p-diag-sparkline");
    expect(sparklines.length).toBeGreaterThanOrEqual(3);
  });

  it("sorts the per-peer table by RTT when the RTT header is clicked", async () => {
    const { source } = makePeerSource({
      slow: [
        { peerId: "slow", rttMs: 200, bytesSent: 0, bytesReceived: 0 },
        { peerId: "slow", rttMs: 200, bytesSent: 0, bytesReceived: 0 },
        { peerId: "slow", rttMs: 200, bytesSent: 0, bytesReceived: 0 },
      ],
      fast: [
        { peerId: "fast", rttMs: 20, bytesSent: 0, bytesReceived: 0 },
        { peerId: "fast", rttMs: 20, bytesSent: 0, bytesReceived: 0 },
        { peerId: "fast", rttMs: 20, bytesSent: 0, bytesReceived: 0 },
      ],
      mid: [
        { peerId: "mid", rttMs: 80, bytesSent: 0, bytesReceived: 0 },
        { peerId: "mid", rttMs: 80, bytesSent: 0, bytesReceived: 0 },
        { peerId: "mid", rttMs: 80, bytesSent: 0, bytesReceived: 0 },
      ],
    });

    render(<P2PDiagnosticsPanel defaultOpen peerConnection={source} />);
    await screen.findByTestId("p2p-diag-peer-table");

    // The RTT column defaults to ascending: fast (20) → mid (80) → slow (200).
    const rows = await screen.findAllByTestId(/p2p-diag-peer-row-/);
    expect(rows[0]).toHaveAttribute("data-testid", "p2p-diag-peer-row-fast");
    expect(rows[2]).toHaveAttribute("data-testid", "p2p-diag-peer-row-slow");

    // Click RTT header to flip to descending.
    await userEvent.setup().click(screen.getByTestId("p2p-diag-sort-rtt"));
    const rowsDesc = await screen.findAllByTestId(/p2p-diag-peer-row-/);
    expect(rowsDesc[0]).toHaveAttribute("data-testid", "p2p-diag-peer-row-slow");
  });

  it("renders an empty-state message when no peers are connected", async () => {
    const source: PeerDiagnosticsSource = {
      getPeerIds: () => [],
      async getPeerDiagnostics() {
        return null;
      },
    };
    render(<P2PDiagnosticsPanel defaultOpen peerConnection={source} />);
    expect(
      await screen.findByTestId("p2p-diag-peer-empty"),
    ).toBeInTheDocument();
  });

  it("renders the unsupported alert when WebRTC is unavailable", async () => {
    (window as { RTCPeerConnection?: unknown }).RTCPeerConnection = undefined;
    const source: PeerDiagnosticsSource = {
      getPeerIds: () => ["x"],
      async getPeerDiagnostics() {
        return null;
      },
    };
    render(<P2PDiagnosticsPanel defaultOpen peerConnection={source} />);
    expect(
      await screen.findByTestId("p2p-diag-unsupported"),
    ).toBeInTheDocument();
  });

  it("peers take precedence over the legacy single-connection path", async () => {
    // When both `peerConnection` and `connection` are supplied, the panel
    // must show the per-peer table — not the single-connection readout.
    const { source } = makePeerSource({
      p1: [
        { peerId: "p1", rttMs: 42 },
        { peerId: "p1", rttMs: 42 },
        { peerId: "p1", rttMs: 42 },
      ],
    });
    const single = mockConnection(makeSnapshot()).source;

    render(
      <P2PDiagnosticsPanel
        defaultOpen
        peerConnection={source}
        connection={single}
      />,
    );

    await screen.findByTestId("p2p-diag-peer-table");
    // The single-connection candidate grid must not be rendered.
    expect(screen.queryByTestId("p2p-diag-candidate-grid")).toBeNull();
  });
});

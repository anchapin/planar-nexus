/**
 * P2PDiagnosticsPanel tests.
 * Issue #1088.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/jest-globals";

import { P2PDiagnosticsPanel } from "../p2p-diagnostics-panel";
import type { ICEDiagnosticsSnapshot } from "@/lib/ice-diagnostics";

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

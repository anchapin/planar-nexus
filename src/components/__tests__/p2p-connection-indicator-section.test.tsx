/**
 * P2PConnectionIndicatorSection hook-consumer wrapper tests — issue #986.
 *
 * The wrapper delegates state to {@link useP2PConnection}. We mock the hook
 * so the test isolates the wrapper's responsibilities:
 *   - Forwards `connectionState` from the hook to the indicator.
 *   - Disables the heavy subsystems (handshake / conflict-resolution /
 *     host-migration) so the section is read-only.
 *   - Renders nothing extra — the presentational chip is the only output.
 *   - Forwards the `compact` flag through to the chip.
 *   - Forwards the `className` to the chip.
 *
 * We do NOT re-test the per-state visual mapping (covered in
 * p2p-connection-indicator.test.tsx). The wrapper only verifies wiring.
 */

import { render, screen } from "@testing-library/react";

import type { P2PConnectionState } from "@/lib/p2p-game-connection";

// Mock the hook BEFORE importing the component that consumes it.
const mockUseP2PConnection = jest.fn();
jest.mock("@/hooks/use-p2p-connection", () => ({
  __esModule: true,
  useP2PConnection: (options: unknown) => mockUseP2PConnection(options),
}));

// Import after the mock is registered.
import { P2PConnectionIndicatorSection } from "../p2p-connection-indicator-section";

function makeHookReturn(
  connectionState: P2PConnectionState,
): ReturnType<typeof mockUseP2PConnection> {
  // Only the fields read by the wrapper matter; cast through unknown to the
  // hook's return type without copying the full surface.
  return {
    connectionState,
  } as unknown as ReturnType<typeof mockUseP2PConnection>;
}

describe("P2PConnectionIndicatorSection (#986)", () => {
  beforeEach(() => {
    mockUseP2PConnection.mockReset();
  });

  it("passes connectionState from the hook to the indicator", () => {
    mockUseP2PConnection.mockReturnValue(makeHookReturn("connected"));
    render(
      <P2PConnectionIndicatorSection
        playerId="player-1"
        playerName="Player 1"
        role="host"
      />,
    );
    expect(screen.getByTestId("p2p-connection-indicator")).toHaveAttribute(
      "data-connection-state",
      "connected",
    );
  });

  it.each([
    "disconnected",
    "signaling",
    "connecting",
    "connected",
    "reconnecting",
    "failed",
  ] as const)(
    "forwards the %s state from the hook to the indicator",
    (state) => {
      mockUseP2PConnection.mockReturnValue(makeHookReturn(state));
      render(
        <P2PConnectionIndicatorSection
          playerId="player-1"
          playerName="Player 1"
          role="host"
        />,
      );
      expect(screen.getByTestId("p2p-connection-indicator")).toHaveAttribute(
        "data-connection-state",
        state,
      );
    },
  );

  it("disables handshake, conflict resolution, and host migration on the hook", () => {
    mockUseP2PConnection.mockReturnValue(makeHookReturn("disconnected"));
    render(
      <P2PConnectionIndicatorSection
        playerId="player-1"
        playerName="Player 1"
        role="host"
      />,
    );
    expect(mockUseP2PConnection).toHaveBeenCalledTimes(1);
    const opts = mockUseP2PConnection.mock.calls[0][0];
    expect(opts).toMatchObject({
      playerId: "player-1",
      playerName: "Player 1",
      role: "host",
      enableHandshake: false,
      enableConflictResolution: false,
      enableHostMigration: false,
    });
  });

  it("forwards the optional gameCode to the hook", () => {
    mockUseP2PConnection.mockReturnValue(makeHookReturn("disconnected"));
    render(
      <P2PConnectionIndicatorSection
        playerId="player-1"
        playerName="Player 1"
        role="joiner"
        gameCode="ABCDEF"
      />,
    );
    expect(mockUseP2PConnection.mock.calls[0][0]).toMatchObject({
      role: "joiner",
      gameCode: "ABCDEF",
    });
  });

  it("forwards the compact flag to the chip (hides the label)", () => {
    mockUseP2PConnection.mockReturnValue(makeHookReturn("connected"));
    render(
      <P2PConnectionIndicatorSection
        playerId="player-1"
        playerName="Player 1"
        role="host"
        compact
      />,
    );
    expect(
      screen.queryByTestId("p2p-connection-indicator-label"),
    ).not.toBeInTheDocument();
    // Dot + chip still rendered.
    expect(screen.getByTestId("p2p-connection-indicator")).toHaveAttribute(
      "data-connection-state",
      "connected",
    );
  });

  it("forwards a custom className to the chip", () => {
    mockUseP2PConnection.mockReturnValue(makeHookReturn("disconnected"));
    render(
      <P2PConnectionIndicatorSection
        playerId="player-1"
        playerName="Player 1"
        role="host"
        className="header-chip"
      />,
    );
    expect(screen.getByTestId("p2p-connection-indicator")).toHaveClass(
      "header-chip",
    );
  });
});

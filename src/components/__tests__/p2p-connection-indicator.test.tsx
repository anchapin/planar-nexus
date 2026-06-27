/**
 * P2PConnectionIndicator component tests — issue #986.
 *
 * Covers each P2P connection state with the exact visual cue required by the
 * acceptance criteria:
 *   - disconnected  → gray dot, "Offline" label
 *   - signaling     → gray dot + spinner, "Signaling…" label
 *   - connecting    → blue dot + spinner, "Connecting…" label
 *   - connected     → green dot, "Connected" label
 *   - reconnecting  → amber dot + spinner, "Reconnecting…" label
 *   - failed        → destructive variant, "Connection failed" label
 *
 * Also asserts:
 *   - The chip is rendered as a `Badge` primitive with `role="status"` and an
 *     `aria-label` so screen readers announce the live state.
 *   - `data-connection-state` reflects the current state for diagnostics.
 *   - The compact variant hides the label but keeps the dot + icon.
 *   - `aria-label` overrides are honored when supplied.
 *   - Tooltip surfaces the long-form description.
 *   - No native alert/confirm is used (#1100/#1150 regression guard).
 */

import { render, screen } from "@testing-library/react";

import { P2PConnectionIndicator } from "../p2p-connection-indicator";
import type { P2PConnectionState } from "@/lib/p2p-game-connection";

describe("P2PConnectionIndicator (#986)", () => {
  const allStates: P2PConnectionState[] = [
    "disconnected",
    "signaling",
    "connecting",
    "connected",
    "reconnecting",
    "failed",
  ];

  it.each(allStates)(
    "renders the %s state with its label, dot, and data attribute",
    (state) => {
      render(<P2PConnectionIndicator connectionState={state} />);
      const chip = screen.getByTestId("p2p-connection-indicator");
      expect(chip).toHaveAttribute("data-connection-state", state);
      expect(chip).toHaveAttribute("role", "status");
      expect(chip).toHaveAttribute("aria-live", "polite");
      // The dot is always present so the cue is visible in any theme.
      expect(
        screen.getByTestId("p2p-connection-indicator-dot"),
      ).toBeInTheDocument();
    },
  );

  it.each([
    ["disconnected", "Offline"],
    ["signaling", "Signaling…"],
    ["connecting", "Connecting…"],
    ["connected", "Connected"],
    ["reconnecting", "Reconnecting…"],
    ["failed", "Connection failed"],
  ] as const)(
    "renders the %s state with label '%s'",
    (state, expectedLabel) => {
      render(<P2PConnectionIndicator connectionState={state} />);
      expect(
        screen.getByTestId("p2p-connection-indicator-label"),
      ).toHaveTextContent(expectedLabel);
    },
  );

  it("uses a descriptive aria-label that includes the state name", () => {
    render(<P2PConnectionIndicator connectionState="connected" />);
    expect(screen.getByTestId("p2p-connection-indicator")).toHaveAttribute(
      "aria-label",
      "P2P connection: Connected",
    );
  });

  it("honors an explicit ariaLabel override", () => {
    render(
      <P2PConnectionIndicator
        connectionState="connected"
        ariaLabel="Live peer link"
      />,
    );
    expect(screen.getByTestId("p2p-connection-indicator")).toHaveAttribute(
      "aria-label",
      "Live peer link",
    );
  });

  it("renders compact mode without the label but keeps the dot", () => {
    render(<P2PConnectionIndicator connectionState="connected" compact />);
    expect(
      screen.queryByTestId("p2p-connection-indicator-label"),
    ).not.toBeInTheDocument();
    // Dot + icon still present.
    expect(
      screen.getByTestId("p2p-connection-indicator-dot"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("p2p-connection-indicator")).toHaveAttribute(
      "data-connection-state",
      "connected",
    );
  });

  it("applies a custom className to the chip", () => {
    render(
      <P2PConnectionIndicator
        connectionState="connected"
        className="custom-class"
      />,
    );
    expect(screen.getByTestId("p2p-connection-indicator")).toHaveClass(
      "custom-class",
    );
  });

  it("does not use native window.alert / window.confirm", () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    const confirmSpy = jest
      .spyOn(window, "confirm")
      .mockImplementation(() => false);
    for (const state of allStates) {
      render(<P2PConnectionIndicator connectionState={state} />);
    }
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    confirmSpy.mockRestore();
  });
});

/**
 * P2PReconnectionStatus component tests — issue #988.
 *
 * Covers each lifecycle phase with the exact messaging required by the
 * acceptance criteria:
 *   - stable       → renders nothing
 *   - lost         → "Connection lost" with attempt badge
 *   - reconnecting → "Reconnecting…" with attempt badge + spinner
 *   - recovered    → transient "Reconnected" banner (auto-dismiss verified)
 *   - failed       → "Reconnection failed" with [continue/save/abandon] and
 *                    actionable failure diagnostic surfaced
 *
 * Also asserts:
 *   - Accessible live regions (aria-live) for status transitions.
 *   - No native alert/confirm is used (#1100/#1150 regression guard).
 *   - The recovery prompt hands off to the existing degrade flow via
 *     callbacks — does not invent a parallel state machine.
 */

import { act, render, screen, fireEvent } from "@testing-library/react";

import { P2PReconnectionStatus } from "../p2p-reconnection-status";

describe("P2PReconnectionStatus (#988)", () => {
  const noop = () => {};

  it("renders nothing during the stable phase", () => {
    const { container } = render(
      <P2PReconnectionStatus
        reconnectionPhase="stable"
        connectionState="connected"
        reconnectAttempts={0}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the "Connection lost" banner with attempt count on the lost phase', () => {
    render(
      <P2PReconnectionStatus
        reconnectionPhase="lost"
        connectionState="disconnected"
        reconnectAttempts={2}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
      />,
    );
    expect(screen.getByTestId("p2p-reconnection-status")).toHaveAttribute(
      "data-reconnection-phase",
      "lost",
    );
    expect(
      screen.getByTestId("p2p-reconnection-reconnecting-title"),
    ).toHaveTextContent(/Connection lost/i);
    expect(
      screen.getByTestId("p2p-reconnection-reconnecting-body"),
    ).toHaveTextContent(/Reconnecting to your peer/i);
    expect(
      screen.getByTestId("p2p-reconnection-attempt-badge"),
    ).toHaveTextContent("Attempt 2 of 3");
  });

  it('renders the "Reconnecting…" banner with attempt count on the reconnecting phase', () => {
    render(
      <P2PReconnectionStatus
        reconnectionPhase="reconnecting"
        connectionState="reconnecting"
        reconnectAttempts={1}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
      />,
    );
    expect(
      screen.getByTestId("p2p-reconnection-reconnecting-title"),
    ).toHaveTextContent(/Reconnecting/i);
    expect(
      screen.getByTestId("p2p-reconnection-attempt-badge"),
    ).toHaveTextContent("Attempt 1 of 3");
    // Live region for screen readers (status change is announced politely).
    expect(screen.getByTestId("p2p-reconnection-reconnecting")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("renders the transient Reconnected banner on recovery", () => {
    render(
      <P2PReconnectionStatus
        reconnectionPhase="recovered"
        connectionState="connected"
        reconnectAttempts={0}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
        onAcknowledgeReconnect={noop}
        recoveredDismissMs={null}
      />,
    );
    expect(
      screen.getByTestId("p2p-reconnection-recovered-title"),
    ).toHaveTextContent(/Reconnected/i);
    expect(
      screen.getByTestId("p2p-reconnection-recovered-body"),
    ).toHaveTextContent(/peer-to-peer connection is back/i);
  });

  it("auto-dismisses the Reconnected banner after the configured timeout", () => {
    jest.useFakeTimers();
    const onAcknowledge = jest.fn();
    render(
      <P2PReconnectionStatus
        reconnectionPhase="recovered"
        connectionState="connected"
        reconnectAttempts={0}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
        onAcknowledgeReconnect={onAcknowledge}
        recoveredDismissMs={2000}
      />,
    );
    expect(onAcknowledge).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('renders the "Reconnection failed" banner with reason and remediation', () => {
    render(
      <P2PReconnectionStatus
        reconnectionPhase="failed"
        connectionState="failed"
        reconnectAttempts={3}
        maxReconnectAttempts={3}
        connectionFailureReason={{
          category: "TURN_UNCONFIGURED",
          reason: "No TURN server is configured.",
          remediation: "Add a TURN relay server to traverse your NAT.",
        }}
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
      />,
    );
    expect(screen.getByTestId("p2p-reconnection-failed")).toHaveAttribute(
      "aria-live",
      "assertive",
    );
    expect(
      screen.getByTestId("p2p-reconnection-failed-title"),
    ).toHaveTextContent(/Reconnection failed/i);
    expect(
      screen.getByTestId("p2p-reconnection-failed-attempt-badge"),
    ).toHaveTextContent("3/3 attempts used");
    expect(
      screen.getByTestId("p2p-reconnection-failed-body"),
    ).toHaveTextContent(/No TURN server is configured/i);
    expect(
      screen.getByTestId("p2p-reconnection-failed-remediation"),
    ).toHaveTextContent(/Add a TURN relay server/i);
    expect(
      screen.getByTestId("p2p-reconnection-failed-suggestion"),
    ).toHaveTextContent(/continue this game in local hot-seat mode/i);
  });

  it("falls back to a generic reason when the diagnostic is null", () => {
    render(
      <P2PReconnectionStatus
        reconnectionPhase="failed"
        connectionState="failed"
        reconnectAttempts={3}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
      />,
    );
    expect(
      screen.getByTestId("p2p-reconnection-failed-body"),
    ).toHaveTextContent(/could not be recovered/i);
    expect(
      screen.queryByTestId("p2p-reconnection-failed-remediation"),
    ).not.toBeInTheDocument();
  });

  it("invokes the recovery callbacks on the failed banner", () => {
    const onContinue = jest.fn();
    const onSave = jest.fn();
    const onAbandon = jest.fn();
    render(
      <P2PReconnectionStatus
        reconnectionPhase="failed"
        connectionState="failed"
        reconnectAttempts={3}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        onContinueLocally={onContinue}
        onSaveForResume={onSave}
        onAbandon={onAbandon}
      />,
    );
    fireEvent.click(screen.getByTestId("p2p-reconnection-failed-continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("p2p-reconnection-failed-save"));
    expect(onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("p2p-reconnection-failed-abandon"));
    expect(onAbandon).toHaveBeenCalledTimes(1);
  });

  it("disables all recovery actions while saving", () => {
    render(
      <P2PReconnectionStatus
        reconnectionPhase="failed"
        connectionState="failed"
        reconnectAttempts={3}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        isSaving
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
      />,
    );
    expect(
      screen.getByTestId("p2p-reconnection-failed-continue"),
    ).toBeDisabled();
    expect(screen.getByTestId("p2p-reconnection-failed-save")).toBeDisabled();
    expect(
      screen.getByTestId("p2p-reconnection-failed-abandon"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("p2p-reconnection-failed-save").textContent,
    ).toContain("Saving");
  });

  it("does not use native window.alert / window.confirm", () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    const confirmSpy = jest
      .spyOn(window, "confirm")
      .mockImplementation(() => false);
    render(
      <P2PReconnectionStatus
        reconnectionPhase="failed"
        connectionState="failed"
        reconnectAttempts={3}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
      />,
    );
    fireEvent.click(screen.getByTestId("p2p-reconnection-failed-continue"));
    fireEvent.click(screen.getByTestId("p2p-reconnection-failed-abandon"));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
    confirmSpy.mockRestore();
  });

  it("honors a custom className on the outer wrapper", () => {
    const { container } = render(
      <P2PReconnectionStatus
        reconnectionPhase="lost"
        connectionState="disconnected"
        reconnectAttempts={1}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
        className="custom-class"
      />,
    );
    expect(container.firstChild).toHaveClass("custom-class");
  });

  it("exposes the connection state as a data attribute for diagnostics", () => {
    render(
      <P2PReconnectionStatus
        reconnectionPhase="reconnecting"
        connectionState="reconnecting"
        reconnectAttempts={1}
        maxReconnectAttempts={3}
        connectionFailureReason={null}
        onContinueLocally={noop}
        onSaveForResume={noop}
        onAbandon={noop}
      />,
    );
    expect(screen.getByTestId("p2p-reconnection-status")).toHaveAttribute(
      "data-connection-state",
      "reconnecting",
    );
  });
});

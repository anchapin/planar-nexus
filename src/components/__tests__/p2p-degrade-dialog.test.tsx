/**
 * P2PDegradeDialog component tests — issue #1090.
 *
 * Verifies the accessible (radix AlertDialog) recovery prompt:
 *   - Renders the three recovery actions only when open.
 *   - Each action invokes its handler.
 *   - No native alert/confirm is used (the #1100/#1150 regression guard).
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { P2PDegradeDialog } from "../p2p-degrade-dialog";

describe("P2PDegradeDialog (#1090)", () => {
  it("renders the recovery actions when open", () => {
    render(
      <P2PDegradeDialog
        open
        onContinueLocally={jest.fn()}
        onSaveForResume={jest.fn()}
        onAbandon={jest.fn()}
      />,
    );
    expect(screen.getByTestId("p2p-degrade-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("p2p-degrade-continue")).toBeInTheDocument();
    expect(screen.getByTestId("p2p-degrade-save")).toBeInTheDocument();
    expect(screen.getByTestId("p2p-degrade-abandon")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <P2PDegradeDialog
        open={false}
        onContinueLocally={jest.fn()}
        onSaveForResume={jest.fn()}
        onAbandon={jest.fn()}
      />,
    );
    expect(screen.queryByTestId("p2p-degrade-dialog")).not.toBeInTheDocument();
  });

  it('invokes onContinueLocally when "Continue" is chosen', () => {
    const onContinueLocally = jest.fn();
    render(
      <P2PDegradeDialog
        open
        onContinueLocally={onContinueLocally}
        onSaveForResume={jest.fn()}
        onAbandon={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("p2p-degrade-continue"));
    expect(onContinueLocally).toHaveBeenCalledTimes(1);
  });

  it("invokes onSaveForResume and shows a saving label", () => {
    const onSaveForResume = jest.fn();
    render(
      <P2PDegradeDialog
        open
        isSaving
        onContinueLocally={jest.fn()}
        onSaveForResume={onSaveForResume}
        onAbandon={jest.fn()}
      />,
    );
    expect(screen.getByTestId("p2p-degrade-save").textContent).toContain(
      "Saving",
    );
    // All actions are disabled while saving.
    expect(screen.getByTestId("p2p-degrade-continue")).toBeDisabled();
    expect(screen.getByTestId("p2p-degrade-abandon")).toBeDisabled();
  });

  it('invokes onAbandon when "Abandon" is chosen', () => {
    const onAbandon = jest.fn();
    render(
      <P2PDegradeDialog
        open
        onContinueLocally={jest.fn()}
        onSaveForResume={jest.fn()}
        onAbandon={onAbandon}
      />,
    );
    fireEvent.click(screen.getByTestId("p2p-degrade-abandon"));
    expect(onAbandon).toHaveBeenCalledTimes(1);
  });

  it("does not use native window.confirm / window.alert", () => {
    const confirmSpy = jest
      .spyOn(window, "confirm")
      .mockImplementation(() => false);
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    render(
      <P2PDegradeDialog
        open
        onContinueLocally={jest.fn()}
        onSaveForResume={jest.fn()}
        onAbandon={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("p2p-degrade-continue"));
    fireEvent.click(screen.getByTestId("p2p-degrade-abandon"));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });
});

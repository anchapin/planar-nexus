import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { AttractionDialog } from "../AttractionDialog";

/**
 * Issue #2418 (slice 9) — the "Attraction" dialog.
 *
 * The dialog is a memoized leaf of `GameBoardContent`; these tests cover the
 * behaviour that the extraction must preserve: nothing is rendered while the
 * dialog is closed, the die prompt is shown before the spin, the rolled value
 * and revealed cards are shown afterwards, and dismissing the dialog calls the
 * close handler.
 */

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: jest.fn(),
    cardName: "Circus Tent",
    spinResult: 0,
    revealedCards: [] as string[],
    onSpinAndCast: jest.fn(),
    ...overrides,
  };
}

describe("AttractionDialog", () => {
  it("renders nothing while it is closed", () => {
    render(<AttractionDialog {...makeProps({ isOpen: false })} />);
    expect(screen.queryByText("Attraction!")).toBeNull();
    expect(screen.queryByText("Spin & Cast")).toBeNull();
  });

  it("renders the card wording and the die prompt before the spin", () => {
    render(<AttractionDialog {...makeProps()} />);
    expect(screen.getByText("Attraction!")).toBeDefined();
    expect(
      screen.getByText("Circus Tent - Spin the die to reveal cards"),
    ).toBeDefined();
    expect(
      screen.getByText("Spin the Attraction die to determine the result"),
    ).toBeDefined();
    expect(screen.queryByText("Rolled!")).toBeNull();
  });

  it("spins and casts when the spin button is clicked", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<AttractionDialog {...props} />);

    await user.click(screen.getByText("Spin & Cast"));
    expect(props.onSpinAndCast).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("renders the rolled value and the revealed cards after the spin", () => {
    render(
      <AttractionDialog
        {...makeProps({ spinResult: 3, revealedCards: ["Mountain", "Island"] })}
      />,
    );
    expect(screen.getByText("3")).toBeDefined();
    expect(screen.getByText("Rolled!")).toBeDefined();
    expect(screen.getByText("Revealed cards:")).toBeDefined();
    expect(screen.getByText("Mountain, Island")).toBeDefined();
    expect(screen.queryByText("Spin & Cast")).toBeNull();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("does not render the revealed cards block when nothing was revealed", () => {
    render(<AttractionDialog {...makeProps({ spinResult: 2 })} />);
    expect(screen.getByText("2")).toBeDefined();
    expect(screen.queryByText("Revealed cards:")).toBeNull();
  });

  it("calls the close handler when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<AttractionDialog {...props} />);

    await user.click(screen.getByText("Cancel"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSpinAndCast).not.toHaveBeenCalled();
  });

  it("calls the close handler from the done button after the spin", async () => {
    const user = userEvent.setup();
    const props = makeProps({ spinResult: 4 });
    render(<AttractionDialog {...props} />);

    await user.click(screen.getByText("Done"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSpinAndCast).not.toHaveBeenCalled();
  });
});

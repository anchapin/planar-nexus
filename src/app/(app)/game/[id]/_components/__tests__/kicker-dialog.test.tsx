import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { KickerDialog } from "../KickerDialog";

/**
 * Issue #2418 (slice 9) — the "kicker option" dialog.
 *
 * The dialog is a memoized leaf of `GameBoardContent`; these tests cover the
 * behaviour that the extraction must preserve: nothing is rendered while the
 * dialog is closed, the card wording and both cast options are rendered while
 * it is open, each option reports the matching `withKicker` flag, and
 * dismissing the dialog calls the close handler.
 */

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: jest.fn(),
    cardName: "Burst Lightning",
    description: "Pay {1}{R} more.",
    onSelect: jest.fn(),
    ...overrides,
  };
}

describe("KickerDialog", () => {
  it("renders nothing while it is closed", () => {
    render(<KickerDialog {...makeProps({ isOpen: false })} />);
    expect(screen.queryByText("Kicker Option")).toBeNull();
    expect(screen.queryByText("Cast with kicker")).toBeNull();
  });

  it("renders the card wording when it is open", () => {
    render(<KickerDialog {...makeProps()} />);
    expect(screen.getByText("Kicker Option")).toBeDefined();
    expect(
      screen.getByText("Burst Lightning has an optional kicker cost."),
    ).toBeDefined();
  });

  it("renders both cast options", () => {
    render(<KickerDialog {...makeProps()} />);
    expect(screen.getByText("Cast without kicker")).toBeDefined();
    expect(screen.getByText("Pay only the base mana cost")).toBeDefined();
    expect(screen.getByText("Cast with kicker")).toBeDefined();
    expect(screen.getByText("Pay {1}{R} more.")).toBeDefined();
  });

  it("falls back to a generic kicker description when there is none", () => {
    render(<KickerDialog {...makeProps({ description: "" })} />);
    expect(
      screen.getByText("Pay extra cost for additional effect"),
    ).toBeDefined();
  });

  it("reports casting without kicker", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<KickerDialog {...props} />);

    await user.click(screen.getByText("Cast without kicker"));
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(false);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("reports casting with kicker", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<KickerDialog {...props} />);

    await user.click(screen.getByText("Cast with kicker"));
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(true);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("calls the close handler when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<KickerDialog {...props} />);

    await user.click(screen.getByText("Cancel"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});

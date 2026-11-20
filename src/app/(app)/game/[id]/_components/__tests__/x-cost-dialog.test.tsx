import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { XCostDialog } from "../XCostDialog";

/**
 * Issue #2418 (slice 9) — the "choose X value" dialog.
 *
 * The dialog is a memoized leaf of `GameBoardContent`; these tests cover the
 * behaviour that the extraction must preserve: nothing is rendered while the
 * dialog is closed, the spell wording and the current X value are rendered
 * while it is open, the stepper/preset buttons report the new value, casting
 * reports the value to cast for, and dismissing the dialog calls the close
 * handler.
 */

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: jest.fn(),
    cardName: "Alchemist's Torrent",
    description: "Deal X damage to any target.",
    value: 2,
    onValueChange: jest.fn(),
    onCast: jest.fn(),
    ...overrides,
  };
}

describe("XCostDialog", () => {
  it("renders nothing while it is closed", () => {
    render(<XCostDialog {...makeProps({ isOpen: false })} />);
    expect(screen.queryByText("Choose X Value")).toBeNull();
    expect(screen.queryByText(/Alchemist's Torrent/)).toBeNull();
  });

  it("renders the spell wording and the current value when it is open", () => {
    render(<XCostDialog {...makeProps()} />);
    expect(screen.getByText("Choose X Value")).toBeDefined();
    expect(screen.getByText("Deal X damage to any target.")).toBeDefined();
    expect(screen.getByText("2", { selector: "div" })).toBeDefined();
    expect(screen.getByText("Max: 2")).toBeDefined();
  });

  it("falls back to a generic description when the spell has none", () => {
    render(<XCostDialog {...makeProps({ description: "" })} />);
    expect(
      screen.getByText("Choose a value for Alchemist's Torrent"),
    ).toBeDefined();
  });

  it("increments and decrements the value through the stepper", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<XCostDialog {...props} />);

    await user.click(screen.getByText("+"));
    expect(props.onValueChange).toHaveBeenCalledWith(3);

    await user.click(screen.getByText("−"));
    expect(props.onValueChange).toHaveBeenCalledWith(1);
    expect(props.onCast).not.toHaveBeenCalled();
  });

  it("never decrements below zero", async () => {
    const user = userEvent.setup();
    const props = makeProps({ value: 0 });
    render(<XCostDialog {...props} />);

    const minus = screen.getByText("−").closest("button");
    expect(minus).not.toBeNull();
    expect(minus).toBeDisabled();
    await user.click(minus as HTMLButtonElement);
    expect(props.onValueChange).not.toHaveBeenCalled();
  });

  it("reports the preset value when a preset button is clicked", async () => {
    const user = userEvent.setup();
    const props = makeProps({ value: 3 });
    render(<XCostDialog {...props} />);

    await user.click(screen.getByText("1", { selector: "button" }));
    expect(props.onValueChange).toHaveBeenCalledWith(1);
    expect(props.onCast).not.toHaveBeenCalled();
  });

  it("disables presets above the current value", () => {
    render(<XCostDialog {...makeProps({ value: 1 })} />);
    expect(screen.getByText("2", { selector: "button" })).toBeDisabled();
    expect(screen.getByText("0", { selector: "button" })).not.toBeDisabled();
  });

  it("casts with the current value", async () => {
    const user = userEvent.setup();
    const props = makeProps({ value: 3 });
    render(<XCostDialog {...props} />);

    await user.click(screen.getByText("Cast with X=3"));
    expect(props.onCast).toHaveBeenCalledTimes(1);
    expect(props.onCast).toHaveBeenCalledWith(3);
    expect(props.onValueChange).not.toHaveBeenCalled();
  });

  it("offers a shortcut cast button for values above three", async () => {
    const user = userEvent.setup();
    const props = makeProps({ value: 5 });
    render(<XCostDialog {...props} />);

    await user.click(screen.getByText("Cast X=5"));
    expect(props.onCast).toHaveBeenCalledWith(5);
  });

  it("calls the close handler when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<XCostDialog {...props} />);

    await user.click(screen.getByText("Cancel"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onCast).not.toHaveBeenCalled();
  });
});

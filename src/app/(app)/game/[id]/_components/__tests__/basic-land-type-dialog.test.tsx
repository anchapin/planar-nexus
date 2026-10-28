import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { BasicLandTypeDialog } from "../BasicLandTypeDialog";

/**
 * Issue #2418 (slice 8) — the "choose a basic land type" dialog.
 *
 * The dialog is a memoized leaf of `GameBoardContent`; these tests cover the
 * behaviour that the extraction must preserve: nothing is rendered while the
 * dialog is closed, the card wording and the land choices are rendered while
 * it is open, picking a choice calls back with the land name, and dismissing
 * the dialog calls the close handler.
 */

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: jest.fn(),
    cardName: "Llanowar Elves",
    options: [
      { name: "Plains", description: "Produces white mana" },
      { name: "Island", description: "Produces blue mana" },
    ],
    onSelect: jest.fn(),
    ...overrides,
  };
}

describe("BasicLandTypeDialog", () => {
  it("renders nothing while it is closed", () => {
    render(<BasicLandTypeDialog {...makeProps({ isOpen: false })} />);
    expect(screen.queryByText("Choose Basic Land Type")).toBeNull();
    expect(screen.queryByText("Plains")).toBeNull();
  });

  it("renders the card wording when it is open", () => {
    render(<BasicLandTypeDialog {...makeProps()} />);
    expect(screen.getByText("Choose Basic Land Type")).toBeDefined();
    expect(
      screen.getByText(
        "Llanowar Elves allows you to choose a basic land type. Select one.",
      ),
    ).toBeDefined();
  });

  it("renders one button per basic land type", () => {
    render(<BasicLandTypeDialog {...makeProps()} />);
    expect(screen.getByText("Plains")).toBeDefined();
    expect(screen.getByText("Produces white mana")).toBeDefined();
    expect(screen.getByText("Island")).toBeDefined();
    expect(screen.getByText("Produces blue mana")).toBeDefined();
  });

  it("calls back with the picked land type", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<BasicLandTypeDialog {...props} />);

    await user.click(screen.getByText("Island"));
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith("Island");
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("calls the close handler when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<BasicLandTypeDialog {...props} />);

    await user.click(screen.getByText("Close"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});

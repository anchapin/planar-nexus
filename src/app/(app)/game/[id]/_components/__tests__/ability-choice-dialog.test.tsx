import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { AbilityChoiceDialog } from "../AbilityChoiceDialog";

/**
 * Issue #2418 (slice 5) — the "activated ability choice (CR 602)" dialog.
 *
 * The dialog is a memoized leaf of `GameBoardContent`; these tests cover the
 * behaviour that the extraction must preserve: nothing is rendered while the
 * dialog is closed, the board/hand wording is rendered while it is open, one
 * button per choice is rendered and picking one calls back the right handler,
 * and dismissing the dialog calls the close handler.
 */

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: jest.fn(),
    cardName: "Counterspell",
    isHandActivation: false,
    options: [
      { abilityIndex: 0, label: "Tap: Counter target spell" },
      { abilityIndex: 1, label: "Counter target spell" },
    ],
    onSelect: jest.fn(),
    ...overrides,
  };
}

describe("AbilityChoiceDialog", () => {
  it("renders nothing while it is closed", () => {
    render(<AbilityChoiceDialog {...makeProps({ isOpen: false })} />);
    expect(screen.queryByText("Activate an ability")).toBeNull();
    expect(screen.queryByText("Tap: Counter target spell")).toBeNull();
  });

  it("renders the board wording when it is open", () => {
    render(<AbilityChoiceDialog {...makeProps()} />);
    expect(screen.getByText("Activate an ability")).toBeDefined();
    expect(
      screen.getByText("Choose an ability of Counterspell."),
    ).toBeDefined();
  });

  it("renders the hand wording for hand activations", () => {
    render(
      <AbilityChoiceDialog
        {...makeProps({
          cardName: "Kaito, Bane of Nightmares",
          isHandActivation: true,
        })}
      />,
    );
    expect(screen.getByText("Use a card from your hand")).toBeDefined();
    expect(
      screen.getByText("Choose what to do with Kaito, Bane of Nightmares."),
    ).toBeDefined();
  });

  it("renders one button per choice", () => {
    render(<AbilityChoiceDialog {...makeProps()} />);
    expect(screen.getByText("Tap: Counter target spell")).toBeDefined();
    expect(screen.getByText("Counter target spell")).toBeDefined();
  });

  it("calls back with the picked choice", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<AbilityChoiceDialog {...props} />);

    await user.click(screen.getByText("Counter target spell"));
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith({
      abilityIndex: 1,
      label: "Counter target spell",
    });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("calls the close handler when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<AbilityChoiceDialog {...props} />);

    await user.click(screen.getByText("Close"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});

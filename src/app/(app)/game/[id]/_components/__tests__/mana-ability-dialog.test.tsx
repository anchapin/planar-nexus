import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { ManaAbilityDialog } from "../ManaAbilityDialog";

/**
 * Issue #2418 (slice 7) — the "mana ability choice" dialog.
 *
 * The dialog is a memoized leaf of `GameBoardContent`; these tests cover the
 * behaviour that the extraction must preserve: nothing is rendered while the
 * dialog is closed, the card wording and the mana choices are rendered while
 * it is open, picking a choice calls back with its index, and dismissing the
 * dialog calls the close handler.
 */

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: jest.fn(),
    cardName: "Reflecting Pool",
    options: [
      { description: "Tap: Add {C}", manaText: "C" },
      { description: "Tap: Add {U}", manaText: "U" },
    ],
    onSelect: jest.fn(),
    ...overrides,
  };
}

describe("ManaAbilityDialog", () => {
  it("renders nothing while it is closed", () => {
    render(<ManaAbilityDialog {...makeProps({ isOpen: false })} />);
    expect(screen.queryByText("Choose Mana")).toBeNull();
    expect(screen.queryByText("Tap: Add {C}")).toBeNull();
  });

  it("renders the card wording when it is open", () => {
    render(<ManaAbilityDialog {...makeProps()} />);
    expect(screen.getByText("Choose Mana")).toBeDefined();
    expect(
      screen.getByText(
        "Reflecting Pool can produce different colors of mana. Choose one.",
      ),
    ).toBeDefined();
  });

  it("renders one button per choice", () => {
    render(<ManaAbilityDialog {...makeProps()} />);
    expect(screen.getByText("Tap: Add {C}")).toBeDefined();
    expect(screen.getByText("Tap: Add {U}")).toBeDefined();
    expect(screen.getByText("Add C to your mana pool")).toBeDefined();
    expect(screen.getByText("Add U to your mana pool")).toBeDefined();
  });

  it("calls back with the index of the picked choice", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ManaAbilityDialog {...props} />);

    await user.click(screen.getByText("Tap: Add {U}"));
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith(1);
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("calls the close handler when the dialog is dismissed", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ManaAbilityDialog {...props} />);

    await user.click(screen.getByText("Close"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSelect).not.toHaveBeenCalled();
  });
});

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { ShocklandDialog } from "../ShocklandDialog";

/**
 * Issue #2418 (slice 6) — the Shockland ETB choice dialog.
 *
 * The dialog is a memoized leaf of `GameBoardContent`; these tests cover the
 * behaviour that the extraction must preserve: nothing is rendered while the
 * dialog is closed, the card name is rendered while it is open, and each
 * action button calls back the right handler.
 */

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    cardName: "Shockland",
    onOpenChange: jest.fn(),
    onEnterTapped: jest.fn(),
    onPayLife: jest.fn(),
    ...overrides,
  };
}

describe("ShocklandDialog", () => {
  it("renders nothing while it is closed", () => {
    render(<ShocklandDialog {...makeProps({ isOpen: false })} />);
    expect(screen.queryByText("Enter the Battlefield")).toBeNull();
    expect(screen.queryByText("Enter Tapped")).toBeNull();
  });

  it("renders the card name and both choices when it is open", () => {
    render(<ShocklandDialog {...makeProps()} />);
    expect(screen.getByText("Enter the Battlefield")).toBeDefined();
    expect(
      screen.getByText(
        "Shockland can enter tapped or you can pay 2 life to have it enter untapped.",
      ),
    ).toBeDefined();
    expect(screen.getByText("Enter Tapped")).toBeDefined();
    expect(screen.getByText("No life loss")).toBeDefined();
    expect(screen.getByText("Pay 2 Life")).toBeDefined();
    expect(screen.getByText("Enters untapped")).toBeDefined();
  });

  it("invokes the enter-tapped callback", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ShocklandDialog {...props} />);

    await user.click(screen.getByText("Enter Tapped"));
    expect(props.onEnterTapped).toHaveBeenCalled();
    expect(props.onPayLife).not.toHaveBeenCalled();
  });

  it("invokes the pay-life callback", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ShocklandDialog {...props} />);

    await user.click(screen.getByText("Pay 2 Life"));
    expect(props.onPayLife).toHaveBeenCalled();
    expect(props.onEnterTapped).not.toHaveBeenCalled();
  });
});

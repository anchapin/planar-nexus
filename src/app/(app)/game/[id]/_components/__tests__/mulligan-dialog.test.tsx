import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { MulliganDialog } from "../MulliganDialog";

/**
 * Issue #2418 (slice 3) — the mulligan / opening-hand dialog.
 *
 * The dialog is a memoized leaf of `GameBoardContent`; these tests cover the
 * behaviour that the extraction must preserve: nothing is rendered while the
 * dialog is closed, the opening hand (and the mulligan badge) is rendered while
 * it is open, and each action button calls back the right handler.
 */

// `next/image` is not exercised in jsdom — the card art branch is covered by
// mocking it to a plain <img>.
jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ComponentProps<"img">) =>
    React.createElement("img", { alt: props.alt, src: props.src }),
}));

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onOpenChange: jest.fn(),
    mulliganCount: 0,
    handCards: [
      {
        id: "c1",
        name: "Llanowar Elves",
        manaCost: "{G}",
        typeLine: "Creature",
      },
      {
        id: "c2",
        name: "Counterspell",
        manaCost: "{U}{U}",
        typeLine: "Instant",
      },
    ],
    onMulligan: jest.fn(),
    onKeepHand: jest.fn(),
    ...overrides,
  };
}

describe("MulliganDialog", () => {
  it("renders nothing while it is closed", () => {
    render(<MulliganDialog {...makeProps({ isOpen: false })} />);
    expect(screen.queryByText("Opening Hand")).toBeNull();
    expect(screen.queryByText("Keep Hand")).toBeNull();
  });

  it("renders the opening hand when it is open", () => {
    render(<MulliganDialog {...makeProps()} />);
    expect(screen.getByText("Opening Hand")).toBeDefined();
    expect(screen.getByText("Llanowar Elves")).toBeDefined();
    expect(screen.getByText("Counterspell")).toBeDefined();
    expect(screen.getByText("{G}")).toBeDefined();
  });

  it("shows the empty-hand message when there are no cards", () => {
    render(<MulliganDialog {...makeProps({ handCards: [] })} />);
    expect(screen.getByText("Your hand is empty")).toBeDefined();
  });

  it("shows the mulligan badge only after the first mulligan", () => {
    const { unmount } = render(<MulliganDialog {...makeProps()} />);
    expect(screen.queryByText("Mulligan 0")).toBeNull();
    unmount();

    render(<MulliganDialog {...makeProps({ mulliganCount: 2 })} />);
    expect(screen.getByText("Mulligan 2")).toBeDefined();
    expect(screen.getByText("Next mulligan: draw 4 cards")).toBeDefined();
  });

  it("invokes the keep-hand callback", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<MulliganDialog {...props} />);

    await user.click(screen.getByTestId("keep-hand-button"));
    expect(props.onKeepHand).toHaveBeenCalled();
    expect(props.onMulligan).not.toHaveBeenCalled();
  });

  it("invokes the mulligan callback", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<MulliganDialog {...props} />);

    await user.click(screen.getByText("Mulligan"));
    expect(props.onMulligan).toHaveBeenCalled();
    expect(props.onKeepHand).not.toHaveBeenCalled();
  });

  it("disables the mulligan button at the maximum number of mulligans", () => {
    render(<MulliganDialog {...makeProps({ mulliganCount: 6 })} />);
    expect((screen.getByText("Mulligan") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

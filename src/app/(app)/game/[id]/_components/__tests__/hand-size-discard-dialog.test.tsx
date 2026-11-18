import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { HandSizeDiscardDialog } from "@/components/choice-dialog";

/**
 * Issue #2940 — the cleanup-discard dialog (CR 514.1) of the single-player
 * board.
 *
 * The dialog keeps the player's selection in its own state and used to clear
 * that state from an effect keyed on the *identity* of its `cards` prop. Both
 * call sites built that array inline, so any unrelated re-render of the board
 * silently wiped the selection.
 *
 * These tests pin the fixed contract:
 *
 *  - the call-site pattern (`useMemo` keyed on the pending choice + a stable
 *    `onConfirm`) keeps the selection across an unrelated parent re-render,
 *  - the dialog itself tolerates an equal-but-new `cards` array,
 *  - a *different* choice still clears the selection,
 *  - confirming still reports the picked card ids (CR 514.1 semantics).
 */

interface Choice {
  prompt: string;
  minChoices: number;
  choices: { value: string; label: string }[];
}

const HAND_SIZE_CHOICE: Choice = {
  prompt: "Discard down to 7 cards",
  minChoices: 1,
  choices: [
    { value: "card-a", label: "Forest" },
    { value: "card-b", label: "Grizzly Bears" },
  ],
};

const OTHER_CHOICE: Choice = {
  prompt: "Discard down to 7 cards",
  minChoices: 1,
  choices: [
    { value: "card-c", label: "Llanowar Elves" },
    { value: "card-d", label: "Counterspell" },
  ],
};

/**
 * Mirrors the call site of the dialog on the board: the card list is derived
 * with `useMemo` (keyed on the pending choice) and the confirm callback is a
 * stable `useCallback`.
 */
function DiscardDialogCallSite({
  choice,
  onConfirm,
  unrelated,
}: {
  choice: Choice;
  onConfirm: (cardIds: string[]) => void;
  /** Changes on every unrelated re-render of the parent. */
  unrelated: number;
}) {
  const cards = React.useMemo(
    () =>
      choice.choices.map((c) => ({
        id: String(c.value),
        name: c.label,
      })),
    [choice],
  );

  const handleConfirm = React.useCallback(
    (cardIds: string[]) => onConfirm(cardIds),
    [onConfirm],
  );

  return (
    <div>
      <span data-testid="unrelated">{unrelated}</span>
      <HandSizeDiscardDialog
        open
        prompt={choice.prompt}
        count={choice.minChoices}
        cards={cards}
        onConfirm={handleConfirm}
      />
    </div>
  );
}

/** The pick button of a card (the button carries the `aria-pressed` state). */
function cardButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(name) });
}

/** The "Discard" confirm button of the dialog. */
function confirmButton(): HTMLElement {
  return screen.getByRole("button", { name: /Discard/ });
}

describe("HandSizeDiscardDialog (#2940)", () => {
  it("keeps the selection across an unrelated parent re-render", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn<(cardIds: string[]) => void>();

    const { rerender } = render(
      <DiscardDialogCallSite
        choice={HAND_SIZE_CHOICE}
        onConfirm={onConfirm}
        unrelated={0}
      />,
    );

    await user.click(cardButton("Forest"));
    expect(cardButton("Forest")).toHaveAttribute("aria-pressed", "true");
    expect(confirmButton()).not.toBeDisabled();

    // The parent re-renders with an equal-but-new props object (the pending
    // choice is unchanged, only unrelated state moved).
    rerender(
      <DiscardDialogCallSite
        choice={HAND_SIZE_CHOICE}
        onConfirm={onConfirm}
        unrelated={1}
      />,
    );

    expect(cardButton("Forest")).toHaveAttribute("aria-pressed", "true");
    expect(confirmButton()).not.toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("keeps the selection when the card list is an equal-but-new array", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn<(cardIds: string[]) => void>();

    const cards = () =>
      HAND_SIZE_CHOICE.choices.map((c) => ({
        id: String(c.value),
        name: c.label,
      }));

    const { rerender } = render(
      <HandSizeDiscardDialog
        open
        prompt={HAND_SIZE_CHOICE.prompt}
        count={HAND_SIZE_CHOICE.minChoices}
        cards={cards()}
        onConfirm={onConfirm}
      />,
    );

    await user.click(cardButton("Grizzly Bears"));
    expect(cardButton("Grizzly Bears")).toHaveAttribute("aria-pressed", "true");

    // A fresh array with the same content must not clear the selection.
    rerender(
      <HandSizeDiscardDialog
        open
        prompt={HAND_SIZE_CHOICE.prompt}
        count={HAND_SIZE_CHOICE.minChoices}
        cards={cards()}
        onConfirm={onConfirm}
      />,
    );

    expect(cardButton("Grizzly Bears")).toHaveAttribute("aria-pressed", "true");
    expect(confirmButton()).not.toBeDisabled();
  });

  it("keeps the selection when the parent rebuilds the card list inline", async () => {
    // The pre-fix call site rebuilt the card list on every render of the
    // board; the dialog must not treat that as a new offer.
    const user = userEvent.setup();
    const onConfirm = jest.fn<(cardIds: string[]) => void>();

    function InlineCallSite({ unrelated }: { unrelated: number }) {
      return (
        <div>
          <span data-testid="unrelated">{unrelated}</span>
          <HandSizeDiscardDialog
            open
            prompt={HAND_SIZE_CHOICE.prompt}
            count={HAND_SIZE_CHOICE.minChoices}
            cards={HAND_SIZE_CHOICE.choices.map((c) => ({
              id: String(c.value),
              name: c.label,
            }))}
            onConfirm={onConfirm}
          />
        </div>
      );
    }

    const { rerender } = render(<InlineCallSite unrelated={0} />);

    await user.click(cardButton("Forest"));
    expect(cardButton("Forest")).toHaveAttribute("aria-pressed", "true");

    rerender(<InlineCallSite unrelated={1} />);

    expect(cardButton("Forest")).toHaveAttribute("aria-pressed", "true");
    expect(confirmButton()).not.toBeDisabled();
  });

  it("clears the selection when the choice itself changes", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn<(cardIds: string[]) => void>();

    const { rerender } = render(
      <DiscardDialogCallSite
        choice={HAND_SIZE_CHOICE}
        onConfirm={onConfirm}
        unrelated={0}
      />,
    );

    await user.click(cardButton("Forest"));
    expect(cardButton("Forest")).toHaveAttribute("aria-pressed", "true");

    // A different choice is offered: the previous selection is stale.
    rerender(
      <DiscardDialogCallSite
        choice={OTHER_CHOICE}
        onConfirm={onConfirm}
        unrelated={1}
      />,
    );

    expect(cardButton("Llanowar Elves")).toHaveAttribute("aria-pressed", "false");
    expect(confirmButton()).toBeDisabled();
  });

  it("confirms the picked card ids", async () => {
    const user = userEvent.setup();
    const onConfirm = jest.fn<(cardIds: string[]) => void>();

    render(
      <DiscardDialogCallSite
        choice={HAND_SIZE_CHOICE}
        onConfirm={onConfirm}
        unrelated={0}
      />,
    );

    await user.click(cardButton("Forest"));
    await user.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(["card-a"]);
  });
});

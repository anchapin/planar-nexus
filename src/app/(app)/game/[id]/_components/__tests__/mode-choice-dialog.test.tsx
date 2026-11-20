import React, { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, jest } from "@jest/globals";
import { ModeChoiceDialog } from "../ModeChoiceDialog";

/**
 * Issue #2418 (slice 9) — the "choose mode" dialog.
 *
 * The dialog is a memoized leaf of `GameBoardContent`; these tests cover the
 * behaviour that the extraction must preserve:
 *
 *  - the single-pick flavour (modal spell): picking a mode reports its index
 *    and the choice is confirmed immediately,
 *  - the multi-pick flavour (modal ability, #2525): every click toggles a
 *    mode and the choice is only committed once `choose` modes are picked,
 *  - the multi-pick flavour is not dismissable — the dialog stays open until
 *    a mode is picked.
 */

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    isOpen: true,
    onClose: jest.fn(),
    cardName: "Abrade",
    modes: ["Destroy target creature.", "Destroy target artifact."],
    selectionMode: "single" as const,
    onSelect: jest.fn(),
    onSelectIndex: jest.fn(),
    ...overrides,
  };
}

/** The "default" button variant of the picked modes (see ui/button). */
function isPicked(button: HTMLElement | null): boolean {
  return !!button?.className.includes("bg-primary");
}

describe("ModeChoiceDialog", () => {
  it("renders nothing while it is closed", () => {
    render(<ModeChoiceDialog {...makeProps({ isOpen: false })} />);
    expect(screen.queryByText("Choose Mode")).toBeNull();
    expect(screen.queryByText("Destroy target creature.")).toBeNull();
  });

  it("renders one button per mode with the single-pick wording", () => {
    render(<ModeChoiceDialog {...makeProps()} />);
    expect(screen.getByText("Choose Mode")).toBeDefined();
    expect(
      screen.getByText("Abrade has multiple modes. Choose one."),
    ).toBeDefined();
    expect(screen.getByText("Mode 1")).toBeDefined();
    expect(screen.getByText("Destroy target creature.")).toBeDefined();
    expect(screen.getByText("Mode 2")).toBeDefined();
    expect(screen.getByText("Destroy target artifact.")).toBeDefined();
  });

  it("reports the index of the picked mode in single-pick mode", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ModeChoiceDialog {...props} />);

    await user.click(screen.getByText("Destroy target artifact."));
    expect(props.onSelectIndex).toHaveBeenCalledTimes(1);
    expect(props.onSelectIndex).toHaveBeenCalledWith(1);
    expect(props.onSelect).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("calls the close handler when the dismissable dialog is dismissed", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<ModeChoiceDialog {...props} />);

    await user.click(screen.getByText("Close"));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSelectIndex).not.toHaveBeenCalled();
  });

  it("renders the multi-pick wording and highlights the picked modes", () => {
    render(
      <ModeChoiceDialog
        {...makeProps({
          selectionMode: "multi",
          choose: 2,
          picked: ["Destroy target creature."],
        })}
      />,
    );
    expect(screen.getByText("Abrade: choose 2.")).toBeDefined();
    expect(
      isPicked(screen.getByText("Destroy target creature.").closest("button")),
    ).toBe(true);
    expect(
      isPicked(screen.getByText("Destroy target artifact.").closest("button")),
    ).toBe(false);
  });

  it("reports the picked mode in multi-pick mode", async () => {
    const user = userEvent.setup();
    const props = makeProps({ selectionMode: "multi", choose: 2 });
    render(<ModeChoiceDialog {...props} />);

    await user.click(screen.getByText("Destroy target creature."));
    expect(props.onSelect).toHaveBeenCalledTimes(1);
    expect(props.onSelect).toHaveBeenCalledWith("Destroy target creature.");
    expect(props.onSelectIndex).not.toHaveBeenCalled();
  });

  it("toggles modes until the choose count is reached", async () => {
    const user = userEvent.setup();
    const modes = ["Destroy target creature.", "Destroy target artifact."];
    const committed: string[][] = [];

    // Mirrors the toggle-until-`choose` semantics of the parent handler
    // (`handleAbilityModeSelect`).
    function Harness() {
      const [picked, setPicked] = useState<string[]>([]);
      return (
        <ModeChoiceDialog
          isOpen
          dismissable={false}
          cardName="Abrade"
          modes={modes}
          selectionMode="multi"
          choose={2}
          picked={picked}
          onSelect={(mode) => {
            const next = picked.includes(mode)
              ? picked.filter((m) => m !== mode)
              : [...picked, mode];
            if (next.length < 2) {
              setPicked(next);
              return;
            }
            committed.push(modes.filter((m) => next.includes(m)));
          }}
        />
      );
    }

    render(<Harness />);

    // First pick: toggled on, nothing committed yet.
    await user.click(screen.getByText("Destroy target creature."));
    expect(
      isPicked(screen.getByText("Destroy target creature.").closest("button")),
    ).toBe(true);
    expect(committed).toHaveLength(0);

    // Second click on the same mode: toggled off again.
    await user.click(screen.getByText("Destroy target creature."));
    expect(
      isPicked(screen.getByText("Destroy target creature.").closest("button")),
    ).toBe(false);
    expect(committed).toHaveLength(0);

    // Two distinct modes: the choice is committed, in the order of `modes`.
    await user.click(screen.getByText("Destroy target artifact."));
    expect(committed).toHaveLength(0);
    await user.click(screen.getByText("Destroy target creature."));
    expect(committed).toHaveLength(1);
    expect(committed[0]).toEqual([
      "Destroy target creature.",
      "Destroy target artifact.",
    ]);
  });

  it("cannot be dismissed when it is not dismissable", async () => {
    const user = userEvent.setup();
    const props = makeProps({ selectionMode: "multi", choose: 1, dismissable: false });
    render(<ModeChoiceDialog {...props} />);

    await user.click(screen.getByText("Close"));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Choose Mode")).toBeDefined();
  });
});

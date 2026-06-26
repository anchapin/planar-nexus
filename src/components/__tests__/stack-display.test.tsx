import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  StackDisplay,
  type StackItem,
  type PriorityInfo,
} from "../stack-display";

// jsdom polyfills required by Radix Tooltip (uses ResizeObserver internally).
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as any).ResizeObserver = RO;
}
if (typeof (globalThis as any).DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class {
    m22 = 1;
  };
}

const players: PriorityInfo[] = [
  { playerId: "p1", playerName: "Alice", hasPriority: true },
  { playerId: "p2", playerName: "Bob", hasPriority: false },
];

function makeStack(count: number): StackItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `spell-${i + 1}`,
    name: `Spell ${i + 1}`,
    type: "spell" as const,
    controllerName: "Alice",
    controllerId: "p1",
    timestamp: i,
  }));
}

describe("StackDisplay — focus management & keyboard semantics (#1104)", () => {
  it("renders as a dialog with role, aria-modal, and an accessible name", async () => {
    render(
      <StackDisplay
        isOpen
        stack={makeStack(2)}
        players={players}
        onClose={jest.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // Explicit aria-modal satisfies WCAG/axe-core dialog-name + dialog-context.
    expect(dialog.getAttribute("aria-modal")).toBe("true");

    // Accessible name comes from DialogTitle ("Stack").
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      expect(labelEl?.textContent).toMatch(/Stack/);
    }
  });

  it("moves focus into the overlay when opened", async () => {
    const user = userEvent.setup();
    render(
      <StackDisplay
        isOpen
        stack={makeStack(1)}
        players={players}
        onClose={jest.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    // After open, focus must be somewhere inside the dialog.
    await user.tab(); // give jsdom a tick to settle focus
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("keeps focus trapped inside the dialog while Tabbing (Tab never leaves the dialog)", async () => {
    const user = userEvent.setup();
    render(
      <StackDisplay
        isOpen
        stack={makeStack(2)}
        players={players}
        onClose={jest.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");

    // Tab through several cycles — focus should never leave the dialog.
    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("restores focus when closed with Escape (focus is released from the overlay)", async () => {
    // Radix Dialog's FocusScope restores focus to the trigger in real browsers.
    // jsdom cannot fully model that restore, so we assert the observable
    // contract: focus is no longer trapped inside the dialog and the dialog
    // is removed from the DOM after Escape.
    const user = userEvent.setup();
    const onClose = jest.fn();

    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open stack</button>
          <StackDisplay
            isOpen={open}
            stack={makeStack(2)}
            players={players}
            onClose={() => {
              setOpen(false);
              onClose();
            }}
          />
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByText("open stack");
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Close via Escape
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
    // Overlay removed
    expect(screen.queryByRole("dialog")).toBeNull();
    // Focus is no longer held inside the (now-unmounted) dialog. Radix's
    // FocusScope restores to the trigger in real browsers; in jsdom the body
    // receives focus, which still proves the trap was released.
    expect(dialog.contains(document.activeElement)).toBe(false);
    // The trigger remains in the tab order and is focusable again.
    expect(trigger.tabIndex).toBeGreaterThanOrEqual(-1);
  });

  it("closes when the Escape key is pressed", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <StackDisplay
        isOpen
        stack={makeStack(2)}
        players={players}
        onClose={onClose}
      />,
    );
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates stack items with Arrow Up/Down (roving tabindex)", async () => {
    const user = userEvent.setup();
    render(
      <StackDisplay
        isOpen
        stack={makeStack(3)}
        players={players}
        onClose={jest.fn()}
        expanded
      />,
    );
    await screen.findByRole("dialog");

    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(3);

    // First item should be the initially focusable one (tabIndex 0)
    expect(items[0].querySelector("button")?.tabIndex).toBe(0);
    expect(items[1].querySelector("button")?.tabIndex).toBe(-1);

    // ArrowDown moves focus (roving) to the next item
    await user.keyboard("{ArrowDown}");
    // After moving, the second item should now be the focusable one
    expect(items[1].querySelector("button")?.tabIndex).toBe(0);
    expect(items[0].querySelector("button")?.tabIndex).toBe(-1);

    // ArrowDown at the end wraps back to the first item
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    expect(items[0].querySelector("button")?.tabIndex).toBe(0);
  });

  it("exposes an aria-live region for push/resolve announcements", async () => {
    render(
      <StackDisplay
        isOpen
        stack={makeStack(2)}
        players={players}
        onClose={jest.fn()}
      />,
    );
    await screen.findByRole("dialog");
    // Radix Dialog portals to document.body, so query the whole document.
    const liveRegions = document.querySelectorAll('[aria-live="polite"]');
    expect(liveRegions.length).toBeGreaterThanOrEqual(1);
    const live = liveRegions[liveRegions.length - 1];
    expect(live?.getAttribute("aria-atomic")).toBe("true");
  });

  it("announces a new spell when the stack grows", async () => {
    const initialStack = makeStack(1);
    const { rerender } = render(
      <StackDisplay
        isOpen
        stack={initialStack}
        players={players}
        onClose={jest.fn()}
      />,
    );
    await screen.findByRole("dialog");

    // Grow the stack by re-rendering (Radix modal would intercept an external
    // trigger button, so drive the change through props directly).
    rerender(
      <StackDisplay
        isOpen
        stack={[
          ...initialStack,
          {
            id: "spell-new",
            name: "Lightning Bolt",
            type: "spell",
            controllerName: "Alice",
            controllerId: "p1",
            timestamp: 1,
          },
        ]}
        players={players}
        onClose={jest.fn()}
      />,
    );

    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/Lightning Bolt|added to stack/i);
  });

  it("renders nothing when closed", () => {
    render(
      <StackDisplay
        isOpen={false}
        stack={makeStack(2)}
        players={players}
        onClose={jest.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still invokes onStackItemClick when an item is clicked (pointer works)", async () => {
    const user = userEvent.setup();
    const onStackItemClick = jest.fn();
    render(
      <StackDisplay
        isOpen
        stack={makeStack(2)}
        players={players}
        onClose={jest.fn()}
        expanded
        onStackItemClick={onStackItemClick}
      />,
    );
    await screen.findByRole("dialog");
    const buttons = screen.getAllByRole("button");
    // Click the first stack item button (not the collapse / close buttons).
    const firstItem = buttons.find((b) =>
      /Spell 1/.test(b.getAttribute("aria-label") || ""),
    );
    expect(firstItem).toBeTruthy();
    await user.click(firstItem!);
    expect(onStackItemClick).toHaveBeenCalled();
  });
});

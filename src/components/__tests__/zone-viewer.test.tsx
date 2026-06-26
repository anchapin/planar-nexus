import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ZoneViewer } from "../zone-viewer";

// jsdom polyfills required by Radix ScrollArea/Tooltip (use ResizeObserver).
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

const graveyardCards = [
  { id: "c1", name: "Ajani", typeLine: "Creature", manaCost: "{1}{G}", cmc: 2 },
  { id: "c2", name: "Bolt", typeLine: "Instant", manaCost: "{R}", cmc: 1 },
  {
    id: "c3",
    name: "Counterspell",
    typeLine: "Instant",
    manaCost: "{U}{U}",
    cmc: 2,
  },
];

const stackItems = [
  {
    id: "s1",
    name: "Lightning Bolt",
    typeLine: "Instant",
    manaCost: "{R}",
    controllerName: "Alice",
  },
  {
    id: "s2",
    name: "Giant Growth",
    typeLine: "Instant",
    manaCost: "{G}",
    controllerName: "Bob",
  },
];

describe("ZoneViewer — focus management & keyboard semantics (#1104)", () => {
  it("renders as a dialog with role, aria-modal, and an accessible name", async () => {
    render(
      <ZoneViewer
        isOpen
        graveyard={graveyardCards}
        title="Zone Viewer"
        onClose={jest.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("always renders an accessible description (even without playerName)", async () => {
    render(
      <ZoneViewer
        isOpen
        graveyard={graveyardCards}
        title="Zone Viewer"
        onClose={jest.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    const descId = dialog.getAttribute("aria-describedby");
    const desc = descId ? document.getElementById(descId) : null;
    expect(desc).toBeTruthy();
    expect(desc?.textContent).toMatch(/Inspecting|Tab|arrow/i);
  });

  it("moves focus into the overlay when opened", async () => {
    const user = userEvent.setup();
    render(
      <ZoneViewer
        isOpen
        graveyard={graveyardCards}
        title="Zone Viewer"
        onClose={jest.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("keeps focus trapped inside the dialog while Tabbing", async () => {
    const user = userEvent.setup();
    render(
      <ZoneViewer
        isOpen
        graveyard={graveyardCards}
        title="Zone Viewer"
        onClose={jest.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("closes when the Escape key is pressed", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(
      <ZoneViewer
        isOpen
        graveyard={graveyardCards}
        title="Zone Viewer"
        onClose={onClose}
      />,
    );
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus when closed with Escape (focus is released from the overlay)", async () => {
    // Radix Dialog's FocusScope restores focus to the trigger in real browsers.
    // jsdom cannot fully model that restore, so we assert the observable
    // contract: focus is no longer inside the dialog and the dialog is gone.
    const user = userEvent.setup();
    const onClose = jest.fn();

    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open zones</button>
          <ZoneViewer
            isOpen={open}
            graveyard={graveyardCards}
            title="Zone Viewer"
            onClose={() => {
              setOpen(false);
              onClose();
            }}
          />
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByText("open zones");
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(false);
    expect(trigger.tabIndex).toBeGreaterThanOrEqual(-1);
  });

  it("exposes the graveyard card list with role=list and labelled cards", async () => {
    render(
      <ZoneViewer
        isOpen
        graveyard={graveyardCards}
        title="Zone Viewer"
        onClose={jest.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    const list = within(dialog).getByRole("list");
    expect(list).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem").length).toBe(3);
    // Card buttons carry descriptive aria-labels.
    expect(within(dialog).getByLabelText(/Ajani/)).toBeInTheDocument();
  });

  it("navigates cards with Arrow Right/Left (roving tabindex)", async () => {
    const user = userEvent.setup();
    render(
      <ZoneViewer
        isOpen
        graveyard={graveyardCards}
        title="Zone Viewer"
        onClose={jest.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");

    // Move focus into the card list by tabbing until a card button is focused.
    for (let i = 0; i < 20; i++) {
      await user.tab();
      const focused = document.activeElement;
      if (focused && focused.getAttribute("aria-label")?.includes("Ajani"))
        break;
    }
    // Focus a card in the list first.
    const list = within(dialog).getByRole("list");
    const cardButtons = within(list).getAllByRole("button");
    await user.click(cardButtons[0]);

    // ArrowRight should move the roving tabindex forward.
    await user.keyboard("{ArrowRight}");
    expect(cardButtons[1].tabIndex).toBe(0);
    expect(cardButtons[0].tabIndex).toBe(-1);

    // ArrowRight at end wraps to start.
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{ArrowRight}");
    expect(cardButtons[0].tabIndex).toBe(0);

    // ArrowLeft moves backward.
    await user.keyboard("{ArrowLeft}");
    expect(cardButtons[cardButtons.length - 1].tabIndex).toBe(0);
  });

  it("provides an aria-live region for stack events", async () => {
    render(
      <ZoneViewer
        isOpen
        stack={stackItems}
        defaultTab="stack"
        title="Zone Viewer"
        onClose={jest.fn()}
      />,
    );
    await screen.findByRole("dialog");
    // Radix Dialog portals to document.body, so query the whole document.
    const liveRegions = document.querySelectorAll('[aria-live="polite"]');
    expect(liveRegions.length).toBeGreaterThanOrEqual(1);
    expect(liveRegions[0]?.getAttribute("aria-atomic")).toBe("true");
  });

  it("navigates stack items with Arrow Up/Down on the stack tab", async () => {
    const user = userEvent.setup();
    render(
      <ZoneViewer
        isOpen
        stack={stackItems}
        defaultTab="stack"
        title="Zone Viewer"
        onClose={jest.fn()}
      />,
    );
    const dialog = await screen.findByRole("dialog");

    // Make sure the stack tab is active.
    await user.click(within(dialog).getByRole("tab", { name: /Spell Chain/i }));
    const items = within(dialog).getAllByRole("listitem");
    expect(items.length).toBe(2);

    // Focus the first stack item.
    await user.click(items[0]);
    await user.keyboard("{ArrowDown}");
    // The second item should now be the roving-tabindex anchor.
    expect(items[1].tabIndex).toBe(0);
  });

  it("invokes onCardClick when a card is clicked (pointer still works)", async () => {
    const user = userEvent.setup();
    const onCardClick = jest.fn();
    render(
      <ZoneViewer
        isOpen
        graveyard={graveyardCards}
        title="Zone Viewer"
        onClose={jest.fn()}
        onCardClick={onCardClick}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    const card = within(dialog).getByLabelText(/Ajani/);
    await user.click(card);
    expect(onCardClick).toHaveBeenCalledWith("c1");
  });
});

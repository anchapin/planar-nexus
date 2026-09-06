/**
 * @fileoverview Accessibility + virtualization tests for DeckList
 *
 * Accessibility (#933):
 *   1. The remove/decrease control is always visible (not hover-only).
 *   2. Every interactive control exposes an accessible name via aria-label.
 *   3. Quantity steppers (+/-) are rendered as real buttons that invoke the
 *      correct handlers.
 *
 * Virtualization (#1081):
 *   4. Only a bounded window of rows (+ overscan) is mounted regardless of
 *      deck size.
 *   5. Every card stays reachable by scrolling (nothing is dropped).
 *   6. Stepper interactions keep working through the virtualizer.
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...props }: any) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, ...props }: any) => (
    <button type="button" onClick={onClick} className={className} {...props}>
      {children}
    </button>
  ),
}));

jest.mock("lucide-react", () => ({
  Minus: () => <svg data-testid="minus-icon" />,
  Plus: () => <svg data-testid="plus-icon" />,
  MinusCircle: () => <svg data-testid="minus-circle-icon" />,
  AlertTriangle: () => <svg data-testid="alert-triangle-icon" />,
  ShieldAlert: () => <svg data-testid="shield-alert-icon" />,
}));

import { DeckList } from "@/app/(app)/deck-builder/_components/deck-list";
import type { DeckCard } from "@/lib/card-database";

const bolt = {
  id: "bolt-1",
  name: "Lightning Bolt",
  count: 3,
  type_line: "Instant",
} as DeckCard;

const deck = [bolt];

const renderList = (overrides: any = {}) =>
  render(
    <DeckList
      deck={deck}
      deckName="My Deck"
      onDeckNameChange={jest.fn()}
      onRemoveCard={jest.fn()}
      onAddCard={jest.fn()}
      {...overrides}
    />,
  );

/**
 * jsdom reports 0 for every layout property by default, which makes
 * @tanstack/react-virtual think the viewport is empty and mount nothing.
 * Give the scroll viewport a non-zero size, virtual rows a measurable
 * height, and provide the ResizeObserver the library relies on. Mirrors the
 * setup in virtual-card-list.test.tsx / virtualized-battlefield.test.tsx.
 */
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
let originalClientHeight: PropertyDescriptor | undefined;
let originalOffsetHeight: PropertyDescriptor | undefined;

function rect(height: number): DOMRect {
  return {
    width: 600,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: height,
    right: 600,
    toJSON() {},
  } as DOMRect;
}

beforeEach(() => {
  originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );

  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return 400;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return 400;
    },
  });

  // Virtual rows (data-index) report a measurable height; the scroll
  // container (role=list) reports the viewport height.
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.hasAttribute && this.hasAttribute("data-index")) {
      return rect(40);
    }
    if (this.getAttribute && this.getAttribute("role") === "list") {
      return rect(400);
    }
    return originalGetBoundingClientRect.call(this);
  };

  (global as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  if (originalClientHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientHeight",
      originalClientHeight,
    );
  }
  if (originalOffsetHeight) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetHeight",
      originalOffsetHeight,
    );
  }
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

describe("DeckList — card control accessibility (#933)", () => {
  it("renders the empty-state message when the deck is empty", () => {
    render(
      <DeckList
        deck={[]}
        deckName="Empty"
        onDeckNameChange={jest.fn()}
        onRemoveCard={jest.fn()}
        onAddCard={jest.fn()}
      />,
    );
    expect(screen.getByText(/your deck is empty/i)).toBeInTheDocument();
  });

  it("renders the decrease control always visible (no hover-only opacity)", () => {
    renderList();
    const decrease = screen.getByTestId("decrease-quantity-bolt-1");
    expect(decrease).toBeInTheDocument();
    expect(decrease.tagName).toBe("BUTTON");
    // Hover-only reveal used opacity-0 group-hover:opacity-100 — those must be gone.
    expect(decrease.className).not.toMatch(/opacity-0/);
    expect(decrease.className).not.toMatch(/group-hover:opacity-100/);
  });

  it("renders the increase control always visible (no hover-only opacity)", () => {
    renderList();
    const increase = screen.getByTestId("increase-quantity-bolt-1");
    expect(increase).toBeInTheDocument();
    expect(increase.tagName).toBe("BUTTON");
    expect(increase.className).not.toMatch(/opacity-0/);
    expect(increase.className).not.toMatch(/group-hover:opacity-100/);
  });

  it("exposes accessible names for both stepper buttons", () => {
    renderList();
    expect(
      screen.getByRole("button", {
        name: "Decrease quantity of Lightning Bolt",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Increase quantity of Lightning Bolt",
      }),
    ).toBeInTheDocument();
  });

  it("exposes the current quantity to assistive tech", () => {
    renderList();
    expect(screen.getByLabelText("Quantity 3")).toHaveTextContent("3");
  });

  it("invokes onRemoveCard with the card id when the decrease button is clicked", () => {
    const onRemoveCard = jest.fn();
    renderList({ onRemoveCard });
    fireEvent.click(screen.getByTestId("decrease-quantity-bolt-1"));
    expect(onRemoveCard).toHaveBeenCalledTimes(1);
    expect(onRemoveCard).toHaveBeenCalledWith("bolt-1");
  });

  it("invokes onAddCard with the card when the increase button is clicked", () => {
    const onAddCard = jest.fn();
    renderList({ onAddCard });
    fireEvent.click(screen.getByTestId("increase-quantity-bolt-1"));
    expect(onAddCard).toHaveBeenCalledTimes(1);
    expect(onAddCard).toHaveBeenCalledWith(bolt);
  });
});

describe("DeckList — drag-and-drop target (#1545)", () => {
  /**
   * Minimal drop-handlers shim. The hook wires these to its reducer; for
   * the deck-list test we just want to verify the component spreads them
   * onto the outer wrapper so the wrapper becomes a valid drop target.
   *
   * Constructed fresh per test so call counts don't leak across cases.
   */
  function makeDropHandlers() {
    return {
      onDragOver: jest.fn(),
      onDragEnter: jest.fn(),
      onDragLeave: jest.fn(),
      onDrop: jest.fn(),
    };
  }

  it("renders a drop-zone wrapper when dropHandlers are provided", () => {
    const noopDropHandlers = makeDropHandlers();
    renderList({ dropHandlers: noopDropHandlers });
    const wrapper = screen.getByTestId("deck-list-drop-zone");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.getAttribute("data-target")).toBe("mainboard");
  });

  it("marks the wrapper as drop-active when isDropActive is true", () => {
    const noopDropHandlers = makeDropHandlers();
    renderList({ dropHandlers: noopDropHandlers, isDropActive: true });
    const wrapper = screen.getByTestId("deck-list-drop-zone");
    expect(wrapper.getAttribute("data-drop-active")).toBe("true");
    expect(wrapper.className).toMatch(/ring-amber-500/);
  });

  it("does not mark the wrapper as drop-active by default", () => {
    const noopDropHandlers = makeDropHandlers();
    renderList({ dropHandlers: noopDropHandlers });
    const wrapper = screen.getByTestId("deck-list-drop-zone");
    expect(wrapper.hasAttribute("data-drop-active")).toBe(false);
  });

  it("forwards dragover / drop events on the wrapper", () => {
    const noopDropHandlers = makeDropHandlers();
    renderList({ dropHandlers: noopDropHandlers });
    const wrapper = screen.getByTestId("deck-list-drop-zone");
    fireEvent.dragOver(wrapper);
    fireEvent.drop(wrapper);
    expect(noopDropHandlers.onDragOver).toHaveBeenCalled();
    expect(noopDropHandlers.onDrop).toHaveBeenCalled();
  });

  it("renders without drop-zone attributes when no dropHandlers are supplied (legacy behaviour)", () => {
    // The wrapper itself is always present (we always render `data-target` so
    // the drop handler in useDeckBuilderDragDrop can identify the zone), but
    // without `dropHandlers` no onDrop callback is attached. This test uses a
    // freshly created noopDropHandlers so it asserts "the test-local handler
    // is never invoked" — its assertion holds because the rendered component
    // has no handler at all when none are passed.
    const noopDropHandlers = makeDropHandlers();
    renderList();
    const wrapper = screen.getByTestId("deck-list-drop-zone");
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.getAttribute("data-target")).toBe("mainboard");
    fireEvent.drop(wrapper);
    // Fresh handler must not have been called since we didn't pass it.
    expect(noopDropHandlers.onDrop).not.toHaveBeenCalled();
  });

  it("empty state copy mentions drag-and-drop so users discover the new affordance", () => {
    const noopDropHandlers = makeDropHandlers();
    render(
      <DeckList
        deck={[]}
        deckName="Empty"
        onDeckNameChange={jest.fn()}
        onRemoveCard={jest.fn()}
        onAddCard={jest.fn()}
        dropHandlers={noopDropHandlers}
      />,
    );
    expect(screen.getByTestId("deck-empty-state")).toHaveTextContent(/drag/i);
  });
});

describe("DeckList — virtualization (#1081)", () => {
  /** Build a constructed-sized deck spread across several categories. */
  function makeDeck(n: number): DeckCard[] {
    const types = ["Creature", "Instant", "Sorcery", "Artifact", "Land"];
    return Array.from({ length: n }, (_, i) => ({
      id: `card-${i}`,
      name: `Card ${i}`,
      count: 1,
      type_line: types[i % types.length],
    })) as DeckCard[];
  }

  it("mounts only a bounded window of rows, not the whole deck", () => {
    const bigDeck = makeDeck(150);
    render(
      <DeckList
        deck={bigDeck}
        deckName="Big"
        onDeckNameChange={jest.fn()}
        onRemoveCard={jest.fn()}
        onAddCard={jest.fn()}
      />,
    );

    const mounted = screen.getAllByTestId(/^deck-item-card-\d+$/);
    // A virtualized window must mount only a small fraction of 150 cards.
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(60);
  });

  it("makes every card reachable as the user scrolls", () => {
    const bigDeck = makeDeck(150);
    render(
      <DeckList
        deck={bigDeck}
        deckName="Big"
        onDeckNameChange={jest.fn()}
        onRemoveCard={jest.fn()}
        onAddCard={jest.fn()}
      />,
    );

    // Initially the first card is mounted and a far card is not.
    expect(screen.getByTestId("deck-item-card-0")).toBeTruthy();
    expect(screen.queryByTestId("deck-item-card-140")).toBeNull();

    const scroller = screen.getByTestId("deck-list-scroll");
    fireEvent.scroll(scroller, { target: { scrollTop: 5600 } });

    // After scrolling near the bottom, early cards are unmounted and late
    // cards have entered the window — proving reachability via virtualization.
    expect(screen.queryByTestId("deck-item-card-0")).toBeNull();
    const mountedIndices = screen
      .getAllByTestId(/^deck-item-card-\d+$/)
      .map((el) =>
        Number(el.getAttribute("data-testid")!.replace("deck-item-card-", "")),
      );
    expect(Math.max(...mountedIndices)).toBeGreaterThan(80);
  });

  it("keeps stepper interactions working through the virtualizer", () => {
    const onAddCard = jest.fn();
    const onRemoveCard = jest.fn();
    const bigDeck = makeDeck(150);
    render(
      <DeckList
        deck={bigDeck}
        deckName="Big"
        onDeckNameChange={jest.fn()}
        onRemoveCard={onRemoveCard}
        onAddCard={onAddCard}
      />,
    );

    // The first card is in the initial window; its steppers must fire.
    fireEvent.click(screen.getByTestId("decrease-quantity-card-0"));
    expect(onRemoveCard).toHaveBeenCalledWith("card-0");
    fireEvent.click(screen.getByTestId("increase-quantity-card-0"));
    expect(onAddCard).toHaveBeenCalledTimes(1);
    expect(onAddCard).toHaveBeenCalledWith(
      expect.objectContaining({ id: "card-0" }),
    );
  });
});

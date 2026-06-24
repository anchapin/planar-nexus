import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { VirtualCardList } from "../virtual-card-list";
import type { CollectionCard } from "@/hooks/use-collection";

function makeCards(n: number): CollectionCard[] {
  return Array.from({ length: n }, (_, i) => ({
    card: {
      id: `card-${i}`,
      name: `Card ${i}`,
      set: "tst",
      collector_number: String(i),
    } as CollectionCard["card"],
    quantity: (i % 5) + 1,
    addedAt: new Date().toISOString(),
  }));
}

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

describe("VirtualCardList", () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  let originalClientHeight: PropertyDescriptor | undefined;
  let originalOffsetHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );

    // Give the scroll viewport a non-zero size in jsdom.
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

    // Give virtual rows a measurable height so dynamic measuring stabilizes.
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.hasAttribute && this.hasAttribute("data-index")) {
        return rect(80);
      }
      if (this.getAttribute && this.getAttribute("role") === "list") {
        return rect(400);
      }
      return originalGetBoundingClientRect.call(this);
    };

    // jsdom lacks ResizeObserver, which @tanstack/react-virtual relies on.
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

  it("renders only a bounded window of items, not the whole list", () => {
    const cards = makeCards(1000);
    render(
      <VirtualCardList
        cards={cards}
        className="h-[400px]"
        renderRow={(c) => <div>{c.card.name}</div>}
      />,
    );

    const rendered = screen.getAllByText(/^Card \d+$/);
    // A virtualized window must mount only a small fraction of 1000 items.
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(100);
  });

  it("makes every item reachable as the user scrolls", () => {
    const cards = makeCards(1000);
    render(
      <VirtualCardList
        cards={cards}
        className="h-[400px]"
        renderRow={(c) => <div>{c.card.name}</div>}
      />,
    );

    // Initially the first item is mounted and a far item is not.
    expect(screen.getByText("Card 0")).toBeTruthy();
    expect(screen.queryByText("Card 900")).toBeNull();

    const scroller = document.querySelector('[role="list"]') as HTMLElement;
    scroller.scrollTop = 79000;
    fireEvent.scroll(scroller);

    // After scrolling near the bottom, early items are unmounted and late
    // items have entered the window — proving reachability via virtualization.
    expect(screen.queryByText("Card 0")).toBeNull();
    const renderedIndices = screen
      .getAllByText(/^Card \d+$/)
      .map((el) => Number(el.textContent?.replace("Card ", "")));
    expect(Math.max(...renderedIndices)).toBeGreaterThan(400);
  });

  it("keeps existing row interactions working", () => {
    const onAdd = jest.fn();
    const cards = makeCards(3);
    render(
      <VirtualCardList
        cards={cards}
        className="h-[400px]"
        renderRow={(c) => (
          <button type="button" onClick={() => onAdd(c.card.id)}>
            add {c.card.name}
          </button>
        )}
      />,
    );

    fireEvent.click(screen.getByText("add Card 0"));
    expect(onAdd).toHaveBeenCalledWith("card-0");
  });

  it("renders no rows for an empty list without error", () => {
    const { container } = render(
      <VirtualCardList
        cards={[]}
        className="h-[400px]"
        renderRow={(c) => <div>{c.card.name}</div>}
      />,
    );
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  });
});

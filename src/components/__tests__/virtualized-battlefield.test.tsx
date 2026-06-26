import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  VirtualizedBattlefield,
  BattlefieldCard,
} from "../virtualized-battlefield";
import type { CardState, ZoneType } from "@/types/game";

/**
 * Build N minimal battlefield permanents. Cast through `unknown` to avoid
 * constructing a full ScryfallCard (mirrors the pattern in
 * virtual-card-list.test.tsx). Only the fields the component reads
 * (`id`, `card.name`, `card.image_uris`, `tapped`) are populated.
 */
function makePermanents(n: number, tappedFrom = -1): CardState[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `perm-${i}`,
    card: {
      id: `card-${i}`,
      name: `Permanent ${i}`,
      image_uris: { normal: `https://example.com/img-${i}.jpg` },
    },
    tapped: i >= tappedFrom ? true : undefined,
  })) as unknown as CardState[];
}

/**
 * A jsdom-sized DOMRect. jsdom reports 0 for every layout property by
 * default, which makes @tanstack/react-virtual think the viewport is empty
 * and mount nothing — so the tests must give it real numbers.
 */
function rect(width: number, height: number): DOMRect {
  return {
    width,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    toJSON() {},
  } as DOMRect;
}

describe("VirtualizedBattlefield", () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalOffsetWidth: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    originalOffsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );

    // Give the horizontal scroll viewport a narrow width so only a few cards
    // fit, forcing windowing of the rest.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 300;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return 300;
      },
    });

    // Virtual items (data-index) report the estimated card width; the scroll
    // container (role=list) reports the viewport width.
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.hasAttribute && this.hasAttribute("data-index")) {
        return rect(56, 80);
      }
      if (this.getAttribute && this.getAttribute("role") === "list") {
        return rect(300, 96);
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
    if (originalClientWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientWidth",
        originalClientWidth,
      );
    }
    if (originalOffsetWidth) {
      Object.defineProperty(
        HTMLElement.prototype,
        "offsetWidth",
        originalOffsetWidth,
      );
    }
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("mounts only a bounded window of permanents, not the whole board", () => {
    const cards = makePermanents(100);
    render(
      <VirtualizedBattlefield
        cards={cards}
        zone="battlefield"
        onCardClick={jest.fn()}
      />,
    );

    const mounted = screen.getAllByTestId(/^battlefield-card-/);
    // Windowing: some permanents render, but far fewer than the full 100.
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(100);
    // Overscan keeps the window comfortably bounded for a 300px viewport.
    expect(mounted.length).toBeLessThanOrEqual(40);
  });

  it("renders zero permanent nodes for an empty board without crashing", () => {
    render(
      <VirtualizedBattlefield
        cards={[]}
        zone="battlefield"
        onCardClick={jest.fn()}
      />,
    );
    expect(screen.queryAllByTestId(/^battlefield-card-/)).toHaveLength(0);
  });

  it("preserves per-permanent click targeting on visible (mounted) items", () => {
    const cards = makePermanents(100);
    const onCardClick = jest.fn();
    render(
      <VirtualizedBattlefield
        cards={cards}
        zone="battlefield"
        onCardClick={onCardClick}
      />,
    );

    const mounted = screen.getAllByTestId(/^battlefield-card-/);
    expect(mounted.length).toBeGreaterThan(0);

    // The first mounted permanent is the first card (scroll starts at 0).
    fireEvent.click(mounted[0]);
    expect(onCardClick).toHaveBeenCalledTimes(1);
    expect(onCardClick).toHaveBeenCalledWith("perm-0", "battlefield");
  });

  it("uses a stable, unique key per permanent so targeting identity is correct", () => {
    // Duplicate names must not collide: keys are derived from card.id.
    const cards = [
      { id: "a1", card: { name: " Goblin" } },
      { id: "a2", card: { name: "Goblin" } },
    ] as unknown as CardState[];
    const onCardClick = jest.fn();
    const { container } = render(
      <VirtualizedBattlefield
        cards={cards}
        zone="battlefield"
        onCardClick={onCardClick}
      />,
    );
    // Two distinct listitems mounted for two distinct ids.
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(2);
  });
});

describe("BattlefieldCard", () => {
  it("renders the image when image_uris.normal is present", () => {
    const card = {
      id: "p1",
      card: {
        name: "Lightning Bolt",
        image_uris: { normal: "https://example.com/bolt.jpg" },
      },
    } as unknown as CardState;
    render(
      <BattlefieldCard
        card={card}
        zone={"battlefield" as ZoneType}
        onCardClick={jest.fn()}
      />,
    );
    const node = screen.getByTestId("battlefield-card-lightning-bolt");
    expect(node).toBeTruthy();
    expect(node.querySelector("img")).toBeTruthy();
  });

  it("renders a name fallback when no image is available", () => {
    const card = {
      id: "p2",
      card: { name: "Fallback Token" },
    } as unknown as CardState;
    render(
      <BattlefieldCard
        card={card}
        zone={"battlefield" as ZoneType}
        onCardClick={jest.fn()}
      />,
    );
    const node = screen.getByTestId("battlefield-card-fallback-token");
    expect(node.textContent).toContain("Fallback Token");
    expect(node.querySelector("img")).toBeNull();
  });

  it("shows the TAPPED indicator and fires onCardClick with the right zone", () => {
    const onCardClick = jest.fn();
    const card = {
      id: "p3",
      card: {
        name: "Tapped Guy",
        image_uris: { normal: "https://example.com/x.jpg" },
      },
      tapped: true,
    } as unknown as CardState;
    render(
      <BattlefieldCard
        card={card}
        zone={"battlefield" as ZoneType}
        onCardClick={onCardClick}
      />,
    );
    const node = screen.getByTestId("battlefield-card-tapped-guy");
    expect(node.textContent).toContain("TAPPED");

    fireEvent.click(node);
    expect(onCardClick).toHaveBeenCalledWith("p3", "battlefield");
  });
});

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import {
  VirtualizedZoneStrip,
  BattlefieldCard,
  ZONE_WINDOWING_THRESHOLDS,
  BATTLEFIELD_WINDOWING_THRESHOLD,
  getZoneThreshold,
} from "../virtualized-zone-strip";
import type { CardState, ZoneType } from "@/types/game";

/**
 * Build N minimal zone cards. Cast through `unknown` to avoid constructing a
 * full ScryfallCard (mirrors virtualized-battlefield.test.tsx). Only the
 * fields the component reads (`id`, `card.name`, `card.image_uris`,
 * `tapped`) are populated.
 */
function makeCards(n: number, tappedFrom = -1): CardState[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `card-${i}`,
    card: {
      id: `scry-${i}`,
      name: `Permanent ${i}`,
      image_uris: { normal: `https://example.com/img-${i}.jpg` },
    },
    tapped: i >= tappedFrom ? true : undefined,
  })) as unknown as CardState[];
}

/** A jsdom-sized DOMRect — jsdom reports 0 for every layout property. */
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

/**
 * Shared jsdom layout shims — @tanstack/react-virtual needs real viewport +
 * item sizes, and a ResizeObserver, none of which jsdom provides.
 */
function installLayoutShims(itemSize: { w: number; h: number }, viewport: { w: number; h: number }) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return viewport.w;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return viewport.h;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get() {
      return viewport.w;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get() {
      return viewport.h;
    },
  });
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.hasAttribute && this.hasAttribute("data-index")) {
      return rect(itemSize.w, itemSize.h);
    }
    if (this.getAttribute && this.getAttribute("role") === "list") {
      return rect(viewport.w, viewport.h);
    }
    return rect(viewport.w, viewport.h);
  };
  (global as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe("VirtualizedZoneStrip — thresholds", () => {
  it("exports a per-zone threshold table with the battlefield default preserved from #1082", () => {
    expect(BATTLEFIELD_WINDOWING_THRESHOLD).toBe(20);
    expect(ZONE_WINDOWING_THRESHOLDS.battlefield).toBe(20);
    // Other zones have tuned thresholds (acceptance: thresholds exported).
    expect(ZONE_WINDOWING_THRESHOLDS.graveyard).toBe(40);
    expect(ZONE_WINDOWING_THRESHOLDS.exile).toBe(25);
    expect(ZONE_WINDOWING_THRESHOLDS.library).toBe(15);
  });

  it("getZoneThreshold resolves each zone and falls back to the default", () => {
    expect(getZoneThreshold("battlefield")).toBe(20);
    expect(getZoneThreshold("graveyard")).toBe(40);
    expect(getZoneThreshold("exile")).toBe(25);
    expect(getZoneThreshold("library")).toBe(15);
  });
});

describe("VirtualizedZoneStrip — horizontal windowing (any zone)", () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;
  let originalOffsetWidth: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    originalOffsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    // Narrow 300px viewport so only a handful of 56px cards fit.
    installLayoutShims({ w: 56, h: 80 }, { w: 300, h: 96 });
  });

  afterEach(() => {
    if (originalClientWidth)
      Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    if (originalClientHeight)
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    if (originalOffsetWidth)
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("accepts a zone prop and window-renders a battlefield over its threshold", () => {
    const cards = makeCards(100);
    render(
      <VirtualizedZoneStrip
        cards={cards}
        zone="battlefield"
        onCardClick={jest.fn()}
      />,
    );
    const mounted = screen.getAllByTestId(/^battlefield-card-/);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(100);
    // Bounded window + overscan for a 300px viewport.
    expect(mounted.length).toBeLessThanOrEqual(40);
  });

  it("window-renders a graveyard zone (count > threshold)", () => {
    // 50 graveyard cards > graveyard threshold (40).
    const cards = makeCards(50);
    render(
      <VirtualizedZoneStrip
        cards={cards}
        zone="graveyard"
        onCardClick={jest.fn()}
      />,
    );
    const mounted = screen.getAllByTestId(/^battlefield-card-/);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(50);
    expect(mounted.length).toBeLessThanOrEqual(40);
    // Accessible label reflects the zone.
    expect(screen.getByRole("list").getAttribute("aria-label")).toContain(
      "graveyard",
    );
  });

  it("window-renders exile and library zones", () => {
    for (const zone of ["exile", "library"] as ZoneType[]) {
      const { unmount } = render(
        <VirtualizedZoneStrip
          cards={makeCards(60)}
          zone={zone}
          onCardClick={jest.fn()}
        />,
      );
      const mounted = screen.getAllByTestId(/^battlefield-card-/);
      expect(mounted.length).toBeGreaterThan(0);
      expect(mounted.length).toBeLessThan(60);
      unmount();
    }
  });

  it("mounts zero nodes for an empty zone without crashing", () => {
    render(
      <VirtualizedZoneStrip
        cards={[]}
        zone="exile"
        onCardClick={jest.fn()}
      />,
    );
    expect(screen.queryAllByTestId(/^battlefield-card-/)).toHaveLength(0);
  });

  it("preserves per-card click targeting on mounted items", () => {
    const cards = makeCards(100);
    const onCardClick = jest.fn();
    render(
      <VirtualizedZoneStrip
        cards={cards}
        zone="exile"
        onCardClick={onCardClick}
      />,
    );
    const mounted = screen.getAllByTestId(/^battlefield-card-/);
    fireEvent.click(mounted[0]);
    expect(onCardClick).toHaveBeenCalledTimes(1);
    expect(onCardClick).toHaveBeenCalledWith("card-0", "exile");
  });
});

describe("VirtualizedZoneStrip — vertical mode", () => {
  const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
  let originalClientWidth: PropertyDescriptor | undefined;
  let originalClientHeight: PropertyDescriptor | undefined;
  let originalOffsetWidth: PropertyDescriptor | undefined;
  let originalOffsetHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalClientWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientWidth",
    );
    originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    originalOffsetWidth = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    // Narrow vertical viewport so only a few rows fit.
    installLayoutShims({ w: 56, h: 80 }, { w: 96, h: 240 });
  });

  afterEach(() => {
    if (originalClientWidth)
      Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    if (originalClientHeight)
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    if (originalOffsetWidth)
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalOffsetWidth);
    if (originalOffsetHeight)
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  });

  it("window-renders a vertical library strip and sets aria-orientation=vertical", () => {
    const cards = makeCards(100);
    render(
      <VirtualizedZoneStrip
        cards={cards}
        zone="library"
        orientation="vertical"
        onCardClick={jest.fn()}
      />,
    );
    const mounted = screen.getAllByTestId(/^battlefield-card-/);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(100);
    const list = screen.getByRole("list");
    expect(list.getAttribute("aria-orientation")).toBe("vertical");
    // Label reflects the zone.
    expect(list.getAttribute("aria-label")).toContain("library");
  });

  it("horizontal mode sets aria-orientation=horizontal", () => {
    render(
      <VirtualizedZoneStrip
        cards={makeCards(60)}
        zone="graveyard"
        orientation="horizontal"
        onCardClick={jest.fn()}
      />,
    );
    expect(
      screen.getByRole("list").getAttribute("aria-orientation"),
    ).toBe("horizontal");
  });
});

describe("BattlefieldCard re-export", () => {
  it("is exported from the zone-strip module", () => {
    const card = {
      id: "p1",
      card: { name: "Lilypad", image_uris: { normal: "https://example.com/l.jpg" } },
    } as unknown as CardState;
    render(
      <BattlefieldCard
        card={card}
        zone={"battlefield" as ZoneType}
        onCardClick={jest.fn()}
      />,
    );
    expect(screen.getByTestId("battlefield-card-lilypad")).toBeTruthy();
  });
});

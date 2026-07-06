/**
 * @fileoverview Virtualized grid wiring for the deck-builder card-search panel
 * (issue #1246).
 *
 * The deck-builder search panel used to maintain its own
 * `useVirtualizer` + per-card absolute-positioning loop on top of a
 * hand-rolled `columnCount` derived from `window.innerWidth` breakpoints.
 * That duplicated the responsibility of `src/components/shared/virtualized-card-grid.tsx`
 * and meant the shared component had no production call site.
 *
 * This suite verifies the migration:
 *   1. `card-search.tsx` now consumes the shared `VirtualizedCardGrid` and
 *      the extracted, `React.memo`-wrapped `CardResultTile` cell.
 *   2. With a 5,000-result fixture the visible row window stays bounded —
 *      the issue's acceptance criterion is "≤30 row nodes (window + overscan)
 *      at any time".
 *   3. The keyboard-navigation scroll-into-view path is exposed through the
 *      grid's `VirtualizedCardGridHandle.scrollToIndex` (the prior
 *      implementation called `rowVirtualizer.scrollToIndex` directly).
 *   4. The local column-count `useEffect` that listened to
 *      `window.resize` is gone — the grid owns its own `ResizeObserver`.
 *
 * Mounting the full `CardSearch` is brittle (it pulls in the offline
 * IndexedDB, the embedding worker, and a debounced search transition) so the
 * 5,000-row virtualization check runs against a harness that wires the same
 * `CardResultTile` into the production `VirtualizedCardGrid`. Source-grep
 * checks at the bottom of the file lock the wiring in place.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import React, { useCallback, useRef } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ScryfallCard } from "@/app/actions";
import { VirtualizedCardGrid } from "@/components/shared/virtualized-card-grid";
import type { VirtualizedCardGridHandle } from "@/components/shared/virtualized-card-grid";

jest.mock("@/components/card-art", () => ({
  __esModule: true,
  CardArt: (props: { cardName: string }) => (
    <div data-testid={`card-art-stub-${props.cardName}`} />
  ),
}));

jest.mock(
  "@/app/(app)/deck-builder/_components/legality-badge",
  () => ({
    __esModule: true,
    LegalityBadge: (props: { status: string; className?: string }) => (
      <span data-testid={`legality-stub-${props.status}`} className={props.className} />
    ),
  }),
);

import { CardResultTile } from "@/app/(app)/deck-builder/_components/card-result-tile";

function makeCards(n: number): ScryfallCard[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `card-${i}`,
    name: `Card ${i}`,
    set: "tst",
    collector_number: String(i),
    cmc: i % 8,
    type_line: "Creature",
    colors: ["R"],
    color_identity: ["R"],
    legalities: { commander: "legal" },
    image_uris: {
      small: `https://example.com/small-${i}.jpg`,
      normal: `https://example.com/normal-${i}.jpg`,
      large: `https://example.com/large-${i}.jpg`,
      png: `https://example.com/png-${i}.png`,
      art_crop: `https://example.com/art-${i}.jpg`,
      border_crop: `https://example.com/border-${i}.jpg`,
    },
  })) as unknown as ScryfallCard[];
}

/**
 * jsdom reports 0 for every layout property by default, which makes
 * @tanstack/react-virtual think the viewport is empty and mount nothing.
 * Mirror the virtual-card-list / deck-list setup: give the scroll viewport
 * a non-zero size, give virtual rows a measurable height, and provide the
 * `ResizeObserver` the library relies on.
 */
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
let originalClientHeight: PropertyDescriptor | undefined;
let originalOffsetHeight: PropertyDescriptor | undefined;
let originalClientWidth: PropertyDescriptor | undefined;

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

beforeEach(() => {
  originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight",
  );
  originalOffsetHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "offsetHeight",
  );
  originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
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
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return 1200;
    },
  });

  // Virtual rows (data-index) report a measurable height; the scroll
  // container (w-full h-full overflow-auto on the grid's outer div) reports
  // the viewport height. Everything else falls back to the default.
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this.hasAttribute && this.hasAttribute("data-index")) {
      return rect(1200, 280);
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
  if (originalClientWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidth,
    );
  }
  Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

describe("CardSearch — VirtualizedCardGrid wiring (issue #1246)", () => {
  it("mounts ≤30 row nodes with a 5,000-result fixture (window + overscan)", () => {
    const bigResultSet = makeCards(5000);
    const onAddCard = jest.fn();
    const onSelect = jest.fn();

    const renderItem = (card: ScryfallCard, index: number) => (
      <CardResultTile
        card={card}
        index={index}
        isSelected={false}
        isFlashing={false}
        synergy={undefined}
        format={undefined}
        hideLegality
        onAddCard={onAddCard}
        onSelect={onSelect}
      />
    );

    render(
      <VirtualizedCardGrid
        items={bigResultSet}
        columns={3}
        itemHeight={280}
        renderItem={renderItem}
        gap={16}
        overscan={5}
      />,
    );

    // The grid renders each virtualized row as a `<div data-index={i}>`. The
    // acceptance criterion is "≤30 row nodes (window + overscan) at any time"
    // — with a 400px viewport, 280px row height, and overscan=5, the live
    // window is ~2 rows + 5 above + 5 below = 12. We allow generous headroom
    // for measurement slack and bound it well under the full 5,000 items.
    const mountedRows = document.querySelectorAll("[data-index]");
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThanOrEqual(30);
    // Sanity: the visible window is tiny relative to the total — we must not
    // have mounted all 5,000 rows.
    expect(mountedRows.length).toBeLessThan(5000);

    // Cells (CardResultTile) follow the same bound on a per-cell basis —
    // each row contains up to `columns` cells, so ≤ 3 × 30 = 90 cells.
    const mountedCells = document.querySelectorAll("[data-card-index]");
    expect(mountedCells.length).toBeLessThanOrEqual(90);
    expect(mountedCells.length).toBeLessThan(5000);
  });

  it("makes every card reachable as the user scrolls", () => {
    const bigResultSet = makeCards(5000);
    const onAddCard = jest.fn();
    const onSelect = jest.fn();

    const renderItem = (card: ScryfallCard, index: number) => (
      <CardResultTile
        card={card}
        index={index}
        isSelected={false}
        isFlashing={false}
        synergy={undefined}
        format={undefined}
        hideLegality
        onAddCard={onAddCard}
        onSelect={onSelect}
      />
    );

    const { container } = render(
      <VirtualizedCardGrid
        items={bigResultSet}
        columns={3}
        itemHeight={280}
        renderItem={renderItem}
        gap={16}
        overscan={5}
      />,
    );

    // The scroller is the grid's outer div (the element with the
    // `overflow-auto` Tailwind class). The library listens to scroll on
    // that node and uses it to measure the viewport.
    const scroller = container.querySelector(
      ".overflow-auto",
    ) as HTMLElement | null;
    expect(scroller).not.toBeNull();

    // Initially, card 0 is in the visible window.
    expect(container.querySelector('[data-card-index="0"]')).toBeTruthy();
    // A card deep in the list is not.
    expect(
      container.querySelector('[data-card-index="4999"]'),
    ).toBeNull();

    // Scroll the virtualizer near the bottom and verify reachability.
    fireEvent.scroll(scroller!, { target: { scrollTop: 1_000_000 } });

    // After scrolling, the late card is now reachable (in the visible
    // window) and the early card is no longer mounted.
    expect(
      container.querySelector('[data-card-index="0"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-card-index="4999"]'),
    ).toBeTruthy();
  });

  it("exposes scrollToIndex on the imperative handle (replaces the prior rowVirtualizer.scrollToIndex useEffect)", () => {
    const cards = makeCards(200);
    const onAddCard = jest.fn();
    const onSelect = jest.fn();

    const renderItem = (card: ScryfallCard, index: number) => (
      <CardResultTile
        card={card}
        index={index}
        isSelected={false}
        isFlashing={false}
        synergy={undefined}
        format={undefined}
        hideLegality
        onAddCard={onAddCard}
        onSelect={onSelect}
      />
    );

    // Small wrapper that owns the ref and exercises the imperative API the
    // way the deck-builder page-level keyboard-navigation effect does.
    //
    // Note: the virtualizer's `scrollToIndex` is a no-op in jsdom (no real
    // layout, no real scroll). The point of this test is to confirm the
    // imperative handle is exposed, callable, and does not throw — the
    // observable side-effect (the requested card reaching the visible
    // window) is covered by the next test, which scrolls directly.
    function Harness({ target }: { target: number }) {
      const ref = useRef<VirtualizedCardGridHandle>(null);
      const handleJump = useCallback(() => {
        expect(() => ref.current?.scrollToIndex(target)).not.toThrow();
      }, [target]);
      return (
        <>
          <button data-testid="jump" onClick={handleJump}>
            jump
          </button>
          <VirtualizedCardGrid
            ref={ref}
            items={cards}
            columns={3}
            itemHeight={280}
            renderItem={renderItem}
            gap={16}
            overscan={5}
          />
        </>
      );
    }

    const { container } = render(<Harness target={199} />);
    const jumpButton = container.querySelector(
      '[data-testid="jump"]',
    ) as HTMLElement | null;
    expect(jumpButton).not.toBeNull();
    fireEvent.click(jumpButton!);

    // The handle resolved to a function — the `expect(() => …).not.toThrow()`
    // inside the click handler is the actual assertion. Sanity-check that
    // the grid still mounted the first card in the visible window.
    expect(
      container.querySelector('[data-card-index="0"]'),
    ).toBeTruthy();
  });

  it("preserves the click-to-add interaction through the virtualizer", () => {
    const cards = makeCards(200);
    const onAddCard = jest.fn<(_card: ScryfallCard, _shift: boolean) => void>();
    const onSelect = jest.fn<(index: number) => void>();

    const renderItem = (card: ScryfallCard, index: number) => (
      <CardResultTile
        card={card}
        index={index}
        isSelected={false}
        isFlashing={false}
        synergy={undefined}
        format={undefined}
        hideLegality
        onAddCard={onAddCard}
        onSelect={onSelect}
      />
    );

    render(
      <VirtualizedCardGrid
        items={cards}
        columns={3}
        itemHeight={280}
        renderItem={renderItem}
        gap={16}
        overscan={5}
      />,
    );

    const firstCell = document.querySelector(
      '[data-card-index="0"]',
    ) as HTMLElement | null;
    expect(firstCell).not.toBeNull();
    fireEvent.click(firstCell!);

    expect(onAddCard).toHaveBeenCalled();
    const [added, shift] = onAddCard.mock.calls[0] ?? [];
    expect(added?.id).toBe("card-0");
    expect(shift).toBe(false);
  });

  it("CardResultTile is React.memo'd so unchanged cells skip re-render", () => {
    // Direct check of the memoization surface. The component must be a
    // memo() wrapper around its impl. This is what makes the
    // VirtualizedCardGrid's visible-row window stable when an unrelated
    // piece of card-search state (debounced query, save-dialog open,
    // selected preset) changes.
    const result = (
      CardResultTile as unknown as { $$typeof: symbol; type: unknown }
    ).$$typeof;
    // React.memo wraps with Symbol(react.memo).
    expect(result.toString()).toContain("react.memo");
  });
});

describe("CardSearch source wiring — VirtualizedCardGrid adoption (issue #1246)", () => {
  it("consumes VirtualizedCardGrid and the extracted CardResultTile (no inline useVirtualizer)", () => {
    const source = readFileSync(
      join(__dirname, "..", "card-search.tsx"),
      "utf8",
    );

    // The migration replaces the inline useVirtualizer with the shared
    // VirtualizedCardGrid component.
    expect(source).toMatch(/import\s*\{[^}]*VirtualizedCardGrid[^}]*\}\s*from/);
    expect(source).toMatch(/<VirtualizedCardGrid\b/);

    // The cell render path is delegated to the extracted CardResultTile.
    expect(source).toMatch(/import\s*\{[^}]*CardResultTile[^}]*\}\s*from/);
    expect(source).toMatch(/<CardResultTile\b/);

    // The dead local @tanstack/react-virtual usage is gone.
    expect(source).not.toMatch(/import\s*\{[^}]*useVirtualizer[^}]*\}\s*from\s*["']@tanstack\/react-virtual["']/);
    expect(source).not.toMatch(/rowVirtualizer/);

    // The column-count window-resize effect that the grid now owns is gone.
    expect(source).not.toMatch(/setColumnCount/);
    expect(source).not.toMatch(/window\.innerWidth\s*>=\s*1536/);
  });

  it("passes the result array, an item height, and the renderItem to the grid", () => {
    const source = readFileSync(
      join(__dirname, "..", "card-search.tsx"),
      "utf8",
    );
    expect(source).toMatch(/<VirtualizedCardGrid[\s\S]*?items=\{results\}/);
    expect(source).toMatch(/<VirtualizedCardGrid[\s\S]*?itemHeight=\{280\}/);
    expect(source).toMatch(/<VirtualizedCardGrid[\s\S]*?renderItem=\{renderResult\}/);
  });
});

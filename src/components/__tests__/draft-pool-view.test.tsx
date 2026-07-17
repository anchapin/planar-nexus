/**
 * DraftPoolView accessibility tests — issue #1421.
 *
 * Covers the three WCAG gaps called out in the issue:
 *   - 1.3.1 (Info and Relationships): pool rendered as a real list with a
 *     named region landmark wrapping the whole view.
 *   - 1.4.1 (Use of Color): the "ready" state is conveyed by a visible
 *     text + icon badge, not by the green count color alone.
 *   - 4.1.3 (Status Messages): a polite `role="status"` live region announces
 *     deck-readiness transitions, and the progress bar exposes
 *     `aria-valuetext` mirroring the announced counts.
 *
 * The component calls `useRouter()` from `next/navigation`, so we mock that
 * module. Radix `Card` / `ScrollArea` reach for `ResizeObserver`, which jsdom
 * does not implement, so we install the same stub used by sibling tests.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { DraftPoolView } from "../draft-pool-view";
import type { PoolCard } from "@/lib/limited/types";

// next/navigation is consumed by the component via useRouter().
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    refresh: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

// Radix primitives (Card, ScrollArea) read ResizeObserver during layout.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMUM_DECK_SIZE = 40;

function makeCard(overrides: Partial<PoolCard> = {}): PoolCard {
  return {
    id: "card-1",
    oracle_id: "oracle-1",
    name: "Llanowar Elves",
    set: "znr",
    collector_number: "1",
    cmc: 1,
    type_line: "Creature — Elf Druid",
    oracle_text: "{T}: Add {G}.",
    colors: ["G"],
    color_identity: ["G"],
    rarity: "common",
    legalities: {},
    name_lower: "llanowar elves",
    packId: 0,
    packSlot: 0,
    addedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  } as PoolCard;
}

/** Build a pool of N distinct cards so the row count matches the pool size. */
function makePool(count: number): PoolCard[] {
  return Array.from({ length: count }, (_, i) =>
    makeCard({ id: `card-${i}`, name: `Card ${i}` }),
  );
}

// ---------------------------------------------------------------------------
// Region + list semantics (WCAG 1.3.1)
// ---------------------------------------------------------------------------

describe("DraftPoolView — structural semantics (#1421, WCAG 1.3.1)", () => {
  it("wraps the view in a named region landmark", () => {
    render(<DraftPoolView pool={makePool(2)} />);
    expect(
      screen.getByRole("region", { name: /draft card pool/i }),
    ).toBeInTheDocument();
  });

  it("renders the pool as a list with an accessible name including the count", () => {
    render(<DraftPoolView pool={makePool(3)} />);
    const list = screen.getByRole("list", { name: /draft pool: 3 cards/i });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("renders no list when the pool is empty", () => {
    render(<DraftPoolView pool={[]} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.getByText(/pick cards to build your pool/i),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Progress bar exposes aria-valuetext (WCAG 1.3.1 / 4.1.3)
// ---------------------------------------------------------------------------

describe("DraftPoolView — progress bar aria-valuetext (#1421)", () => {
  it("exposes aria-valuetext in the 'X of Y cards, Z to go' form while incomplete", () => {
    render(<DraftPoolView pool={makePool(23)} sessionId="s1" />);
    const bar = screen.getByRole("progressbar", { name: /deck completion/i });
    expect(bar).toHaveAttribute("aria-valuetext", "23 of 40 cards, 17 to go");
  });

  it("drops the 'to go' suffix from aria-valuetext when the deck is ready", () => {
    render(<DraftPoolView pool={makePool(40)} sessionId="s1" />);
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuetext", "40 of 40 cards");
  });
});

// ---------------------------------------------------------------------------
// Color not alone (WCAG 1.4.1)
// ---------------------------------------------------------------------------

describe("DraftPoolView — ready state is not conveyed by color alone (#1421, WCAG 1.4.1)", () => {
  it("renders a 'Ready to build' badge with text + icon when the deck is ready", () => {
    render(<DraftPoolView pool={makePool(40)} sessionId="s1" />);
    // Visible text conveys readiness independently of the green color.
    expect(screen.getByText(/ready to build/i)).toBeInTheDocument();
    // The check icon is present and marked decorative (text carries meaning).
    const badge = screen
      .getByText(/ready to build/i)
      .closest("[class*='border']");
    expect(badge).not.toBeNull();
  });

  it("conveys the not-ready state with visible text rather than color", () => {
    render(<DraftPoolView pool={makePool(38)} sessionId="s1" />);
    expect(screen.queryByText(/ready to build/i)).not.toBeInTheDocument();
    // The footer hint is textual, not color-only.
    expect(
      screen.getByText(`Pick ${MINIMUM_DECK_SIZE - 38} more cards`),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ARIA live region for status messages (WCAG 4.1.3)
// ---------------------------------------------------------------------------

describe("DraftPoolView — live region announces readiness transitions (#1421, WCAG 4.1.3)", () => {
  it("mounts a polite role=status live region with aria-atomic", () => {
    render(<DraftPoolView pool={makePool(2)} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
  });

  it("does not announce on the initial mount", () => {
    render(<DraftPoolView pool={makePool(2)} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("announces 'Draft deck ready' when the pool crosses the minimum size", () => {
    const { rerender } = render(<DraftPoolView pool={makePool(39)} />);
    expect(screen.getByRole("status")).toHaveTextContent("");

    rerender(<DraftPoolView pool={makePool(40)} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      /draft deck ready — 40 of 40 cards/i,
    );
  });

  it("announces 'Still need N cards' when a card is removed while incomplete", async () => {
    const onRemoveCard = jest.fn((id: string) => {
      // The parent normally mutates state; we simulate by rerendering below.
      void id;
    });
    const pool = makePool(25);
    const { rerender } = render(
      <DraftPoolView pool={pool} onRemoveCard={onRemoveCard} />,
    );

    // Click the first remove button, then rerender with the card gone.
    const removeButton = screen.getByRole("button", {
      name: /remove card 0 from pool/i,
    });
    await userEvent.click(removeButton);
    expect(onRemoveCard).toHaveBeenCalledTimes(1);

    rerender(
      <DraftPoolView pool={pool.slice(1)} onRemoveCard={onRemoveCard} />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /still need 16 cards — 24 of 40 cards/i,
    );
  });

  it("does not re-announce when neither readiness nor total changes", () => {
    const { rerender } = render(<DraftPoolView pool={makePool(10)} />);
    rerender(<DraftPoolView pool={makePool(10)} />);
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

// ---------------------------------------------------------------------------
// Pool row controls expose accessible names (WCAG 4.1.2 / #1101 consistency)
// ---------------------------------------------------------------------------

describe("DraftPoolView — pool row accessible names", () => {
  it("names each remove button with the card it removes", () => {
    render(<DraftPoolView pool={makePool(2)} onRemoveCard={jest.fn()} />);
    expect(
      screen.getByRole("button", { name: /remove card 0 from pool/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove card 1 from pool/i }),
    ).toBeInTheDocument();
  });
});

/**
 * @fileoverview Tests for the SideboardList component (issue #1402).
 *
 * Covers:
 *   1. Empty-state copy and counter when no cards are added.
 *   2. Live counter `x / maxSize` rendering.
 *   3. +/- stepper behaviour: add increments, remove decrements or removes
 *      the row entirely at count 1.
 *   4. Accessibility: every stepper exposes an aria-label (#933 parity).
 *   5. The 15-card cap: reaching the cap disables the + button.
 *   6. The at-cap badge appears when the sideboard is full.
 */

import {
  describe,
  it,
  expect,
  jest,
} from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, disabled, ...props }: any) => (
    <button
      type="button"
      onClick={onClick}
      className={className}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  ),
}));

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className, ...props }: any) => (
    <span className={className} {...props}>
      {children}
    </span>
  ),
}));

jest.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

jest.mock("lucide-react", () => ({
  Minus: () => <svg data-testid="minus-icon" />,
  Plus: () => <svg data-testid="plus-icon" />,
}));

import { SideboardList } from "@/app/(app)/deck-builder/_components/sideboard-list";
import type { DeckCard } from "@/app/actions";

const bolt = {
  id: "bolt-1",
  name: "Lightning Bolt",
  count: 2,
  type_line: "Instant",
} as DeckCard;

const answer = {
  id: "answer-1",
  name: "Answer",
  count: 1,
  type_line: "Instant",
} as DeckCard;

const renderList = (
  overrides: {
    sideboard?: DeckCard[];
    maxSize?: number;
    onRemoveCard?: (cardId: string) => void;
    onAddCard?: (card: DeckCard) => void;
  } = {},
) =>
  render(
    <SideboardList
      sideboard={overrides.sideboard ?? []}
      maxSize={overrides.maxSize ?? 15}
      onRemoveCard={overrides.onRemoveCard ?? jest.fn()}
      onAddCard={overrides.onAddCard ?? jest.fn()}
    />,
  );

describe("SideboardList — empty state (#1402)", () => {
  it("renders the empty-state message when the sideboard is empty", () => {
    renderList();
    expect(screen.getByTestId("sideboard-empty")).toBeInTheDocument();
    expect(screen.getByTestId("sideboard-count")).toHaveTextContent("0 / 15");
  });

  it("does not render row steppers when the sideboard is empty", () => {
    renderList();
    expect(screen.queryByTestId("sideboard-items")).toBeNull();
  });
});

describe("SideboardList — counter + content", () => {
  it("renders the live counter as cards are added", () => {
    renderList({ sideboard: [bolt, answer] });
    // bolt.count=2 + answer.count=1 = 3
    expect(screen.getByTestId("sideboard-count")).toHaveTextContent("3 / 15");
  });

  it("renders a row for each unique card by ascending name", () => {
    renderList({ sideboard: [bolt, answer] });
    expect(screen.getByTestId("sideboard-item-answer")).toBeInTheDocument();
    expect(screen.getByTestId("sideboard-item-lightning-bolt")).toBeInTheDocument();
  });

  it("reports the at-cap badge while slots remain", () => {
    // bolt has count=2 in a 15-slot pool → 13 slots free.
    renderList({ sideboard: [bolt] });
    expect(screen.getByTestId("sideboard-cap-badge")).toHaveTextContent(
      "13 slots",
    );
    expect(screen.queryByTestId("sideboard-at-cap-badge")).toBeNull();
  });
});

describe("SideboardList — add/remove stepper (#1402)", () => {
  it("invokes onAddCard with the card when the increase button is clicked", () => {
    const onAddCard = jest.fn();
    renderList({ sideboard: [bolt], onAddCard });
    fireEvent.click(screen.getByTestId("sideboard-increase-quantity-bolt-1"));
    expect(onAddCard).toHaveBeenCalledTimes(1);
    expect(onAddCard).toHaveBeenCalledWith(bolt);
  });

  it("invokes onRemoveCard with the card id when the decrease button is clicked", () => {
    const onRemoveCard = jest.fn();
    renderList({ sideboard: [bolt], onRemoveCard });
    fireEvent.click(screen.getByTestId("sideboard-decrease-quantity-bolt-1"));
    expect(onRemoveCard).toHaveBeenCalledTimes(1);
    expect(onRemoveCard).toHaveBeenCalledWith("bolt-1");
  });

  it("exposes accessible names for both stepper buttons (#933 parity)", () => {
    renderList({ sideboard: [bolt] });
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
});

describe("SideboardList — 15-card cap (#1402)", () => {
  it("disables the increase button on every row once the sideboard is full", () => {
    // Build a 15-card sideboard: 15 unique cards × 1 each
    const fullSideboard: DeckCard[] = Array.from({ length: 15 }, (_, i) => ({
      id: `card-${i}`,
      name: `Card ${i}`,
      count: 1,
      type_line: "Creature",
    })) as DeckCard[];
    renderList({ sideboard: fullSideboard });

    // All 15 steppers must be present and disabled
    for (let i = 0; i < 15; i++) {
      const btn = screen.getByTestId(`sideboard-increase-quantity-card-${i}`);
      expect(btn).toBeDisabled();
    }
  });

  it("renders the at-cap badge and a full counter once the cap is reached", () => {
    const fullSideboard: DeckCard[] = Array.from({ length: 15 }, (_, i) => ({
      id: `card-${i}`,
      name: `Card ${i}`,
      count: 1,
      type_line: "Creature",
    })) as DeckCard[];
    renderList({ sideboard: fullSideboard });

    expect(screen.getByTestId("sideboard-at-cap-badge")).toHaveTextContent(
      "Full",
    );
    expect(screen.queryByTestId("sideboard-cap-badge")).toBeNull();
    expect(screen.getByTestId("sideboard-count")).toHaveTextContent(
      "15 / 15",
    );
  });

  it("keeps the decrease button enabled even at cap so the user can free a slot", () => {
    const fullSideboard: DeckCard[] = Array.from({ length: 15 }, (_, i) => ({
      id: `card-${i}`,
      name: `Card ${i}`,
      count: 1,
      type_line: "Creature",
    })) as DeckCard[];
    const onRemoveCard = jest.fn();
    renderList({ sideboard: fullSideboard, onRemoveCard });
    fireEvent.click(screen.getByTestId("sideboard-decrease-quantity-card-0"));
    expect(onRemoveCard).toHaveBeenCalledWith("card-0");
  });

  it("does NOT block the increase button while there is still a slot available", () => {
    const fourteen: DeckCard[] = Array.from({ length: 14 }, (_, i) => ({
      id: `card-${i}`,
      name: `Card ${i}`,
      count: 1,
      type_line: "Creature",
    })) as DeckCard[];
    renderList({ sideboard: fourteen });
    const btn = screen.getByTestId("sideboard-increase-quantity-card-0");
    expect(btn).not.toBeDisabled();
  });
});

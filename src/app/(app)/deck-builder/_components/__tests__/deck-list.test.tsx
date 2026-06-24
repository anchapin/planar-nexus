/**
 * @fileoverview Accessibility tests for DeckList
 *
 * Verifies deck-list card controls are keyboard-accessible (issue #933):
 *   1. The remove/decrease control is always visible (not hover-only).
 *   2. Every interactive control exposes an accessible name via aria-label.
 *   3. Quantity steppers (+/-) are rendered as real buttons that invoke the
 *      correct handlers.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardDescription: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: any) => <div>{children}</div>,
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
}));

import { DeckList } from "@/app/(app)/deck-builder/_components/deck-list";

const bolt = {
  id: "bolt-1",
  name: "Lightning Bolt",
  count: 3,
  type_line: "Instant",
} as any;

const deck = [bolt] as any;

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
      screen.getByRole("button", { name: "Decrease quantity of Lightning Bolt" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Increase quantity of Lightning Bolt" }),
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

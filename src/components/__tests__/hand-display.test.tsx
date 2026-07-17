/**
 * @fileoverview Accessibility tests for the HandDisplay toolbar (issue #1420).
 *
 * The hand-display toolbar ships three icon-only `<Button size="sm">` controls
 * (sort, display mode, clear-selection) plus a card-back affordance for the
 * opponent's hand. Before #1420 these elements derived their accessible name
 * solely from a Radix `<Tooltip>` rendered in a portal, which is NOT part of
 * the accessible-name computation. This left screen-reader users with empty
 * names ("button") and, for the opponent's hand, an entirely keyboard-unreachable
 * affordance.
 *
 * These tests verify the WCAG 2.1 SC 4.1.2 (Name, Role, Value) fixes:
 *
 *   1. The hand is exposed as a `role="region"` landmark with an accessible
 *      name ("Your hand" / "Opponent hand").
 *   2. Each toolbar button resolves to a `getByRole("button", { name })`
 *      query — i.e. its accessible name comes from `aria-label`, not the
 *      tooltip alone.
 *   3. The sort and display-mode labels update with component state so the
 *      announced action reflects the current context.
 *   4. The clear-selection label is dynamic with the selection count.
 *   5. The opponent card-back wrapper is a real `<button>` with an
 *      accessible name and therefore keyboard-focusable/operable.
 */

import { describe, it, expect } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

import { HandDisplay } from "@/components/hand-display";
import type { CardState } from "@/types/game";
import type { ScryfallCard } from "@/app/actions";

function makeScryfallCard(
  name: string,
  overrides: Partial<ScryfallCard> = {},
): ScryfallCard {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    type_line: "Creature",
    mana_cost: "{1}",
    cmc: 1,
    colors: [],
    color_identity: [],
    oracle_text: "",
    ...overrides,
  } as ScryfallCard;
}

function makeCardState(name: string, playerId = "p1"): CardState {
  return {
    id: `${playerId}-${name}`,
    card: makeScryfallCard(name),
    zone: "hand",
    playerId,
    tapped: false,
    faceDown: false,
  };
}

// Cards intentionally omit `image_uris` so CardDisplay renders its fallback
// layout (no next/image) and the toolbar is the focus of these tests.
const currentHand: CardState[] = [
  makeCardState("Alpha Beast"),
  makeCardState("Beta Drake"),
  makeCardState("Gamma Wurm"),
];

const opponentHand: CardState[] = [
  makeCardState("Hidden One", "p2"),
  makeCardState("Hidden Two", "p2"),
];

// Stable empty-array reference. The component's `selectedCardIds = []` default
// creates a fresh array per render, which would otherwise retrigger its
// `[selectedCardIds]` effect on every render (infinite loop). Passing this
// constant keeps the prop referentially stable.
const NO_SELECTION: string[] = [];

describe("HandDisplay — region landmark (#1420)", () => {
  it("exposes the current player's hand as a named region", () => {
    render(
      <HandDisplay
        cards={currentHand}
        isCurrentPlayer={true}
        selectedCardIds={NO_SELECTION}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Your hand" }),
    ).toBeInTheDocument();
  });

  it("exposes the opponent's hand as a named region", () => {
    render(
      <HandDisplay
        cards={opponentHand}
        isCurrentPlayer={false}
        selectedCardIds={NO_SELECTION}
      />,
    );
    expect(
      screen.getByRole("region", { name: "Opponent hand" }),
    ).toBeInTheDocument();
  });
});

describe("HandDisplay — toolbar buttons expose accessible names (#1420)", () => {
  it("announces the sort and display-mode buttons by name", () => {
    render(
      <HandDisplay
        cards={currentHand}
        isCurrentPlayer={true}
        selectedCardIds={NO_SELECTION}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Sort hand, currently by name/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Switch to spread layout" }),
    ).toBeInTheDocument();
  });

  it("updates the sort label as the sort option cycles", () => {
    render(
      <HandDisplay
        cards={currentHand}
        isCurrentPlayer={true}
        selectedCardIds={NO_SELECTION}
      />,
    );
    const sortButton = screen.getByRole("button", {
      name: /Sort hand, currently by name/i,
    });

    fireEvent.click(sortButton);
    expect(
      screen.getByRole("button", { name: /Sort hand, currently by manaCost/i }),
    ).toBeInTheDocument();

    fireEvent.click(sortButton);
    expect(
      screen.getByRole("button", { name: /Sort hand, currently by type/i }),
    ).toBeInTheDocument();
  });

  it("flips the display-mode label when toggled", () => {
    render(
      <HandDisplay
        cards={currentHand}
        isCurrentPlayer={true}
        selectedCardIds={NO_SELECTION}
      />,
    );
    const displayButton = screen.getByRole("button", {
      name: "Switch to spread layout",
    });

    fireEvent.click(displayButton);
    expect(
      screen.getByRole("button", { name: "Switch to overlapping layout" }),
    ).toBeInTheDocument();
  });

  it("exposes the clear-selection button with a count-aware name", () => {
    const onCardSelect = jest.fn();
    render(
      <HandDisplay
        cards={currentHand}
        isCurrentPlayer={true}
        selectedCardIds={NO_SELECTION}
        onCardSelect={onCardSelect}
      />,
    );

    // No clear button until something is selected.
    expect(
      screen.queryByRole("button", { name: /Clear.*selected/i }),
    ).not.toBeInTheDocument();

    // Select one card → singular label.
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Card: Alpha Beast/i }),
    );
    expect(
      screen.getByRole("button", { name: "Clear 1 selected card" }),
    ).toBeInTheDocument();

    // Select a second card → plural label.
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Card: Beta Drake/i }),
    );
    expect(
      screen.getByRole("button", { name: "Clear 2 selected cards" }),
    ).toBeInTheDocument();
  });

  it("clears the selection when the clear-selection button is activated", () => {
    const onCardSelect = jest.fn();
    render(
      <HandDisplay
        cards={currentHand}
        isCurrentPlayer={true}
        selectedCardIds={NO_SELECTION}
        onCardSelect={onCardSelect}
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: /Card: Alpha Beast/i }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear 1 selected card" }),
    );
    expect(onCardSelect).toHaveBeenLastCalledWith([]);
  });
});

describe("HandDisplay — opponent card backs are keyboard-operable (#1420)", () => {
  it("renders each opponent card back as a named, focusable button", () => {
    const onCardClick = jest.fn();
    render(
      <HandDisplay
        cards={opponentHand}
        isCurrentPlayer={false}
        selectedCardIds={NO_SELECTION}
        onCardClick={onCardClick}
      />,
    );

    const backs = screen.getAllByRole("button", {
      name: "Opponent card (face down)",
    });
    expect(backs).toHaveLength(opponentHand.length);

    fireEvent.click(backs[0]);
    expect(onCardClick).toHaveBeenCalledWith(opponentHand[0].id);
  });
});

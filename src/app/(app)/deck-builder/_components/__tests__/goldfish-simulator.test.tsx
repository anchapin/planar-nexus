/**
 * @fileoverview Tests for the GoldfishSimulator (issue #1439).
 *
 * Covers the min-cards guard (acceptance: "min-cards guard renders copy") shown
 * when the deck is too small to deal an opening hand, plus a positive render of
 * the simulator controls and seeded run for a sufficient deck. The real
 * simulation logic in @/lib/goldfish-simulator is exercised end-to-end;
 * Radix primitives render thanks to the ResizeObserver polyfill in
 * jest.setup.js.
 */

import { describe, it, expect } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import { GoldfishSimulator } from "../goldfish-simulator";
import type { DeckCard } from "@/app/actions";

function landCard(count: number): DeckCard {
  return {
    id: "mountain",
    name: "Mountain",
    cmc: 0,
    type_line: "Basic Land — Mountain",
    colors: [],
    color_identity: ["R"],
    legalities: {},
    count,
  } as unknown as DeckCard;
}

function spellCard(name: string, cmc: number, count: number): DeckCard {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    cmc,
    type_line: `Creature — ${name}`,
    colors: ["R"],
    color_identity: ["R"],
    legalities: {},
    count,
  } as unknown as DeckCard;
}

describe("GoldfishSimulator min-cards guard", () => {
  it("renders the guard when the deck has fewer than 7 cards", () => {
    render(
      <GoldfishSimulator deck={[landCard(3)]} format="legendary-commander" />,
    );
    expect(screen.getByTestId("goldfish-guard")).toBeInTheDocument();
    expect(screen.getByText(/Add at least 7 cards/i)).toBeInTheDocument();
    expect(screen.queryByTestId("goldfish-simulator")).not.toBeInTheDocument();
  });

  it("mentions the format minimum card count inside the guard", () => {
    render(
      <GoldfishSimulator deck={[landCard(2)]} format="legendary-commander" />,
    );
    expect(screen.getByText(/requires 100/i)).toBeInTheDocument();
  });
});

describe("GoldfishSimulator controls", () => {
  it("renders the simulator controls and a seeded run for a valid deck", () => {
    const deck = [
      landCard(24),
      spellCard("Goblin Guide", 1, 4),
      spellCard("Bear", 2, 32),
    ];
    render(<GoldfishSimulator deck={deck} format="legendary-commander" />);
    expect(screen.queryByTestId("goldfish-guard")).not.toBeInTheDocument();
    expect(screen.getByTestId("goldfish-simulator")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Run goldfish simulation/i }),
    ).toBeInTheDocument();
    // Seeded auto-run produces statistics.
    expect(screen.getByText(/Avg opening lands/i)).toBeInTheDocument();
    expect(screen.getByText(/Mulligan rate/i)).toBeInTheDocument();
  });

  it("re-runs the simulation when the Run button is pressed", () => {
    const deck = [landCard(24), spellCard("Bear", 2, 36)];
    render(<GoldfishSimulator deck={deck} format="legendary-commander" />);
    const runButton = screen.getByRole("button", {
      name: /Run goldfish simulation/i,
    });
    // Clicking should not throw and should keep the stats surface mounted.
    fireEvent.click(runButton);
    expect(screen.getByText(/Avg opening lands/i)).toBeInTheDocument();
  });
});

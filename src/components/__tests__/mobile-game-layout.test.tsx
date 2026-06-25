import React from "react";
import { render, screen, within } from "@testing-library/react";
import { MobileGameLayout } from "../mobile-game-layout";
import type { PlayerState } from "@/types/game";

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "player-1",
    name: "Test Player",
    lifeTotal: 20,
    poisonCounters: 0,
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    library: [],
    commandZone: [],
    isCurrentTurn: true,
    hasPriority: true,
    landsPlayedThisTurn: 0,
    ...overrides,
  };
}

describe("MobileGameLayout", () => {
  it("renders a player area for each player", () => {
    const players = [
      makePlayer({ id: "p1", name: "Alice", isCurrentTurn: false }),
      makePlayer({ id: "p2", name: "Bob", isCurrentTurn: true }),
    ];

    render(<MobileGameLayout players={players} playerCount={2} currentTurnIndex={1} />);

    expect(screen.getByTestId("mobile-player-area-alice")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-player-area-bob")).toBeInTheDocument();
  });

  it("marks the current turn player", () => {
    const players = [
      makePlayer({ id: "p1", name: "Alice", isCurrentTurn: false }),
      makePlayer({ id: "p2", name: "Bob", isCurrentTurn: true }),
    ];

    render(<MobileGameLayout players={players} playerCount={2} currentTurnIndex={1} />);

    expect(screen.getByText("Bob's Turn")).toBeInTheDocument();
  });

  it("renders zone buttons with touch-friendly min height (48px class)", () => {
    const players = [makePlayer({ id: "p1", name: "Solo" })];

    const { container } = render(
      <MobileGameLayout players={players} playerCount={2} currentTurnIndex={0} />,
    );

    const zoneButtons = container.querySelectorAll("button.min-h-\\[48px\\]");
    // At least the 4 core zones (library, graveyard, exile, battlefield)
    expect(zoneButtons.length).toBeGreaterThanOrEqual(4);
  });

  it("shows concede and draw controls with 44px+ tap targets", () => {
    const players = [makePlayer({ id: "p1", name: "Solo" })];

    const { container } = render(
      <MobileGameLayout
        players={players}
        playerCount={2}
        currentTurnIndex={0}
        onConcede={jest.fn()}
        onOfferDraw={jest.fn()}
      />,
    );

    // The controls bar is the first child div with border-b
    const controlsBar = container.querySelector(".border-b");
    expect(controlsBar).toBeTruthy();

    // Concede button in the controls bar has h-11
    const concedeBtn = within(controlsBar!).getByText("Concede").closest("button");
    expect(concedeBtn).toHaveClass("h-11");
  });

  it("highlights the local player area with primary border", () => {
    const players = [
      makePlayer({ id: "p1", name: "Opponent" }),
      makePlayer({ id: "p2", name: "You" }),
    ];

    const { container } = render(
      <MobileGameLayout players={players} playerCount={2} currentTurnIndex={0} />,
    );

    const cards = container.querySelectorAll('[data-testid^="mobile-player-area-"]');
    const localCard = cards[cards.length - 1];
    expect(localCard?.className).toContain("border-primary");
  });

  it("renders the local player's hand display", () => {
    const players = [
      makePlayer({ id: "p1", name: "Opponent" }),
      makePlayer({
        id: "p2",
        name: "You",
        hand: [
          {
            id: "card-1",
            card: {
              id: "scryfall-1",
              name: "Lightning Bolt",
              mana_cost: "{R}",
              type_line: "Instant",
            },
          } as any,
        ],
      }),
    ];

    render(<MobileGameLayout players={players} playerCount={2} currentTurnIndex={0} />);

    // HandDisplay shows "1 card" badge
    const handBadge = screen.getByText(/1 card/);
    expect(handBadge).toBeInTheDocument();
  });

  it("does not render the turn controls bar when game is over", () => {
    const players = [makePlayer({ id: "p1", name: "Solo" })];

    const { container } = render(
      <MobileGameLayout
        players={players}
        playerCount={2}
        currentTurnIndex={0}
        isGameOver={true}
        onConcede={jest.fn()}
      />,
    );

    // The turn badge in the controls bar should not be present
    expect(screen.queryByText("Solo's Turn")).not.toBeInTheDocument();
    // The controls bar (border-b) should not be rendered
    expect(container.querySelector(".border-b")).not.toBeTruthy();
  });
});

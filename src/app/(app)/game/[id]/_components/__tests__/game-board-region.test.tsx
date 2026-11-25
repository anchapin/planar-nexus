import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { GameBoardRegion } from "../GameBoardRegion";
import type { PlayerState } from "@/types/game";

/**
 * Issue #2418 (SLICE 10) — the extracted "Game Board" region.
 *
 * The board itself is mocked out (it is a huge, hook-heavy subtree): the
 * mock records the props it was called with and renders a consumer of the
 * target-highlight context, so the test can assert that
 *
 * 1. the region renders the same `<main data-tutorial="battlefield">`
 *    wrapper and forwards the given players to `GameBoard`;
 * 2. the legal-target ids are published through the context provider;
 * 3. the memoized region bails out when its props are unchanged (render
 *    isolation).
 */

const mockBoard = {
  props: null as Record<string, unknown> | null,
  renderCount: 0,
};

jest.mock("@/components/game-board", () => {
  const reactActual = jest.requireActual<typeof import("react")>("react");
  const ctxActual = jest.requireActual<
    typeof import("@/components/target-highlight-context")
  >("@/components/target-highlight-context");
  const TargetProbe = (props: Record<string, unknown>) => {
    const legalTargetIds = reactActual.useContext(
      ctxActual.TargetHighlightContext,
    );
    return reactActual.createElement("div", {
      "data-testid": "mock-board",
      "data-player-count": String(props.playerCount),
      "data-current-turn-index": String(props.currentTurnIndex),
      "data-legal-targets": Array.from(legalTargetIds).join(","),
    });
  };
  return {
    GameBoard: (props: Record<string, unknown>) => {
      mockBoard.props = props;
      mockBoard.renderCount += 1;
      return reactActual.createElement(TargetProbe, props);
    },
  };
});

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "p1",
    name: "Alex",
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

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    players: [makePlayer(), makePlayer({ id: "p2", name: "AI" })],
    playerCount: 2 as const,
    currentTurnIndex: 1,
    onCardClick: jest.fn(),
    onZoneClick: jest.fn(),
    onConcede: jest.fn(),
    onOfferDraw: jest.fn(),
    onAcceptDraw: jest.fn(),
    onDeclineDraw: jest.fn(),
    legalTargetIds: new Set<string>(),
    ...overrides,
  };
}

describe("GameBoardRegion", () => {
  beforeEach(() => {
    mockBoard.props = null;
    mockBoard.renderCount = 0;
  });

  it("renders the battlefield wrapper", () => {
    const { container } = render(<GameBoardRegion {...makeProps()} />);
    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main?.getAttribute("data-tutorial")).toBe("battlefield");
    expect(main?.getAttribute("class")).toBe("flex-1 min-h-0 overflow-hidden");
  });

  it("forwards the given players and board props to GameBoard", () => {
    const props = makeProps();
    render(<GameBoardRegion {...props} />);

    expect(mockBoard.props).not.toBeNull();
    expect(mockBoard.props?.players).toBe(props.players);
    expect(mockBoard.props?.playerCount).toBe(2);
    expect(mockBoard.props?.currentTurnIndex).toBe(1);
    expect(mockBoard.props?.onCardClick).toBe(props.onCardClick);
    expect(mockBoard.props?.onZoneClick).toBe(props.onZoneClick);
    expect(mockBoard.props?.onConcede).toBe(props.onConcede);
    expect(mockBoard.props?.onOfferDraw).toBe(props.onOfferDraw);
    expect(mockBoard.props?.onAcceptDraw).toBe(props.onAcceptDraw);
    expect(mockBoard.props?.onDeclineDraw).toBe(props.onDeclineDraw);
  });

  it("publishes the legal target ids through the target-highlight provider", () => {
    render(
      <GameBoardRegion
        {...makeProps({ legalTargetIds: new Set(["card-1", "card-2"]) })}
      />,
    );
    const board = screen.getByTestId("mock-board");
    expect(board.getAttribute("data-legal-targets")).toBe("card-1,card-2");
  });

  it("renders an empty legal-target set when nothing is targeted", () => {
    render(<GameBoardRegion {...makeProps()} />);
    const board = screen.getByTestId("mock-board");
    expect(board.getAttribute("data-legal-targets")).toBe("");
  });

  it("does not re-render the board when the props are unchanged (render isolation)", () => {
    const props = makeProps();
    const { rerender } = render(<GameBoardRegion {...props} />);
    expect(mockBoard.renderCount).toBe(1);

    rerender(<GameBoardRegion {...props} />);
    expect(mockBoard.renderCount).toBe(1);

    rerender(
      <GameBoardRegion {...props} currentTurnIndex={props.currentTurnIndex + 1} />,
    );
    expect(mockBoard.renderCount).toBe(2);
  });
});

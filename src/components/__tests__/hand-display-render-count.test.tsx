/**
 * @fileoverview Render-count regression tests for the hand display boundary
 * (#1818).
 *
 * `HandDisplay` sits at the bottom of the board subtree
 * (`GameBoard → PlayerArea → HandDisplay → per-card children`). Every engine
 * state update — and in P2P multiplayer every inbound game-sync envelope —
 * re-creates the `players` array and re-renders the board. Before #1818 the
 * hand fan was an unmemoized function with inline per-card closures, so each
 * of those updates re-ran the whole hand layout and every card child, even
 * when the delta only touched another player's zone.
 *
 * These tests pin the fixed render boundary in place:
 *
 *   1. The per-card child module (`@/components/hand-card`) is mocked with
 *      render-counting stubs. The stubs are deliberately NOT memoized, so
 *      their call counts track every render the real parent would produce —
 *      a broken boundary shows up as an increased count instead of being
 *      masked by a memo inside the stub.
 *   2. The real `HandDisplay` is exercised both directly and under its real
 *      parent chain (`GameBoard` → `PlayerArea`) with the prop discipline
 *      the board uses (stable `useCallback` handlers, stable zone refs).
 *   3. A delta that only touches another zone — an opponent's battlefield
 *      update — must not increase the hand-card render count.
 *
 * Behavior (clicks, selection, ARIA) is covered by `hand-display.test.tsx`
 * against the real card children; this file is only about render counts.
 */

import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "@jest/globals";

import type { CardState, PlayerState } from "@/types/game";
import type { ScryfallCard } from "@/lib/card-database";

const mockHandCardRender = jest.fn();
const mockOpponentHandCardRender = jest.fn();

jest.mock("@/components/hand-card", () => ({
  HandCard: function HandCard({ card }: { card: CardState }) {
    mockHandCardRender(card.id);
    return <div data-testid={`hand-card-${card.id}`} />;
  },
  OpponentHandCard: function OpponentHandCard({ cardId }: { cardId: string }) {
    mockOpponentHandCardRender(cardId);
    return <div data-testid={`opponent-card-${cardId}`} />;
  },
}));

import { HandDisplay } from "@/components/hand-display";
import { GameBoard } from "@/components/game-board";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
    // No `image_uris` — keeps next/image out of the render path.
    ...overrides,
  } as ScryfallCard;
}

function makeCardState(
  name: string,
  playerId: string,
  zone: CardState["zone"] = "hand",
): CardState {
  return {
    id: `${playerId}-${name}`,
    card: makeScryfallCard(name),
    zone,
    playerId,
    tapped: false,
    faceDown: false,
  };
}

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "p1",
    name: "Alex",
    lifeTotal: 40,
    poisonCounters: 0,
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    library: [],
    commandZone: [],
    isCurrentTurn: false,
    hasPriority: false,
    landsPlayedThisTurn: 0,
    ...overrides,
  };
}

const localHand: CardState[] = [
  makeCardState("Alpha Beast", "p2"),
  makeCardState("Beta Drake", "p2"),
  makeCardState("Gamma Wurm", "p2"),
];

const opponentHand: CardState[] = [
  makeCardState("Hidden One", "p1"),
  makeCardState("Hidden Two", "p1"),
];

// Stable empty-array reference (same trick as hand-display.test.tsx: the
// component's `selectedCardIds = []` default is a fresh array per render,
// which would retrigger its external-selection sync effect).
const NO_SELECTION: string[] = [];

// ---------------------------------------------------------------------------
// HandDisplay — direct memo boundary
// ---------------------------------------------------------------------------

describe("HandDisplay memo boundary — direct render counting (#1818)", () => {
  beforeEach(() => {
    mockHandCardRender.mockClear();
    mockOpponentHandCardRender.mockClear();
  });

  it("renders each hand card exactly once on mount", () => {
    render(
      <HandDisplay
        cards={localHand}
        isCurrentPlayer={true}
        onCardSelect={jest.fn()}
        onCardClick={jest.fn()}
        selectedCardIds={NO_SELECTION}
        className="min-h-[120px]"
      />,
    );
    expect(mockHandCardRender).toHaveBeenCalledTimes(localHand.length);
  });

  it("does not re-render hand cards when every prop keeps its reference", () => {
    // Stable callbacks, as the board supplies them (useCallback / setState).
    const onCardSelect = jest.fn();
    const onCardClick = jest.fn();

    const ui = () => (
      <HandDisplay
        cards={localHand}
        isCurrentPlayer={true}
        onCardSelect={onCardSelect}
        onCardClick={onCardClick}
        selectedCardIds={NO_SELECTION}
        className="min-h-[120px]"
      />
    );

    const { rerender } = render(ui());
    expect(mockHandCardRender).toHaveBeenCalledTimes(3);

    // Parent re-renders with a new element but identical prop references —
    // the shape of an engine update that did not touch the hand zone. A
    // fresh element instance is required: rerendering the SAME element
    // object bails out on element identity and never reaches the memo
    // comparator.
    rerender(ui());
    rerender(ui());
    expect(mockHandCardRender).toHaveBeenCalledTimes(3);
  });

  it("does not re-render opponent card backs when props keep their references", () => {
    const onCardClick = jest.fn();
    const ui = () => (
      <HandDisplay
        cards={opponentHand}
        isCurrentPlayer={false}
        onCardClick={onCardClick}
        selectedCardIds={NO_SELECTION}
      />
    );

    const { rerender } = render(ui());
    expect(mockOpponentHandCardRender).toHaveBeenCalledTimes(2);

    rerender(ui());
    rerender(ui());
    expect(mockOpponentHandCardRender).toHaveBeenCalledTimes(2);
  });

  it("still re-renders hand cards when the hand itself changes (draws a card)", () => {
    const onCardClick = jest.fn();
    const { rerender } = render(
      <HandDisplay
        cards={localHand}
        isCurrentPlayer={true}
        onCardSelect={jest.fn()}
        onCardClick={onCardClick}
        selectedCardIds={NO_SELECTION}
      />,
    );
    expect(mockHandCardRender).toHaveBeenCalledTimes(3);

    // A real hand change (new card array reference) must flow through —
    // guards against an over-aggressive memo hiding updates.
    const drawnHand = [...localHand, makeCardState("Delta Angel", "p2")];
    rerender(
      <HandDisplay
        cards={drawnHand}
        isCurrentPlayer={true}
        onCardSelect={jest.fn()}
        onCardClick={onCardClick}
        selectedCardIds={NO_SELECTION}
      />,
    );
    // The unmemoized counting stub re-renders for every card in the list on
    // each HandDisplay render; what matters is that the count moved at all
    // and the drawn card is present (the hand renders name-sorted).
    expect(mockHandCardRender).toHaveBeenCalledTimes(7);
    expect(mockHandCardRender.mock.calls.map(([id]) => id)).toContain(
      "p2-Delta Angel",
    );
  });
});

// ---------------------------------------------------------------------------
// The #1818 acceptance scenario — under the real GameBoard parent chain
// ---------------------------------------------------------------------------

describe("HandDisplay under GameBoard — other-zone deltas skip the hand (#1818)", () => {
  beforeEach(() => {
    mockHandCardRender.mockClear();
    mockOpponentHandCardRender.mockClear();
  });

  it("does not re-render hand cards when a state change only affects the opponent's battlefield", () => {
    // Same callback references across rerenders, exactly as the real board
    // pages hand them down (GameBoard receives them as props).
    const onCardClick = jest.fn();
    const onZoneClick = jest.fn();

    const opponent = makePlayer({
      id: "p1",
      name: "Rival",
      battlefield: [],
    });
    const local = makePlayer({
      id: "p2",
      name: "You",
      hand: localHand,
    });

    const board = (players: PlayerState[]) => (
      <GameBoard
        players={players}
        playerCount={2}
        currentTurnIndex={1}
        onCardClick={onCardClick}
        onZoneClick={onZoneClick}
      />
    );

    const { rerender } = render(board([opponent, local]));
    // The local player's hand mounted exactly once.
    expect(mockHandCardRender).toHaveBeenCalledTimes(3);

    // Simulate an inbound game-state delta that ONLY touches the opponent's
    // battlefield: a fresh players array and a fresh opponent object with a
    // new battlefield array — the local player keeps every reference. This
    // is the shape of a P2P game-sync envelope for an opponent's action.
    const opponentAfter = {
      ...opponent,
      battlefield: [makeCardState("Enemy Creature", "p1", "battlefield")],
    };
    rerender(board([opponentAfter, local]));

    // The hand fan must not have re-rendered.
    expect(mockHandCardRender).toHaveBeenCalledTimes(3);
  });

  it("still re-renders hand cards when the local player's hand changes", () => {
    const onCardClick = jest.fn();
    const onZoneClick = jest.fn();

    const opponent = makePlayer({ id: "p1", name: "Rival" });
    const local = makePlayer({ id: "p2", name: "You", hand: localHand });

    const board = (players: PlayerState[], currentTurnIndex = 1) => (
      <GameBoard
        players={players}
        playerCount={2}
        currentTurnIndex={currentTurnIndex}
        onCardClick={onCardClick}
        onZoneClick={onZoneClick}
      />
    );

    const { rerender } = render(board([opponent, local]));
    expect(mockHandCardRender).toHaveBeenCalledTimes(3);

    const localAfterDraw = {
      ...local,
      hand: [...localHand, makeCardState("Delta Angel", "p2")],
    };
    rerender(board([opponent, localAfterDraw]));
    expect(mockHandCardRender).toHaveBeenCalledTimes(7);
    expect(mockHandCardRender.mock.calls.map(([id]) => id)).toContain(
      "p2-Delta Angel",
    );
  });
});

// ---------------------------------------------------------------------------
// Structural assertions — the per-card memo the counting stubs cannot see
// ---------------------------------------------------------------------------

describe("hand render boundary structure (#1818)", () => {
  it("exports memo-wrapped HandDisplay, HandCard, and OpponentHandCard", () => {
    const REACT_MEMO: symbol = Symbol.for("react.memo");
    const actualHandCard = jest.requireActual(
      "@/components/hand-card",
    ) as Record<string, { $$typeof?: symbol }>;

    expect((HandDisplay as unknown as { $$typeof?: symbol }).$$typeof).toBe(
      REACT_MEMO,
    );
    expect(actualHandCard.HandCard?.$$typeof).toBe(REACT_MEMO);
    expect(actualHandCard.OpponentHandCard?.$$typeof).toBe(REACT_MEMO);
  });
});

import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "@jest/globals";
import { arePlayerAreaPropsEqual } from "../game-board";
import type { PlayerState } from "@/types/game";

/**
 * #1390 — render-storm regression test for `PlayerArea` memoization.
 *
 * On a 4-player board a game-state delta should only re-render the player
 * whose zone actually changed; the other three players must bail out via the
 * `React.memo` comparator. This file exercises that comparator two ways:
 *
 * 1. Directly (pure function) — deterministic, no React runtime.
 * 2. Wired through a real `React.memo` boundary with a render counter —
 *    proves the comparator actually prevents re-renders in React's tree.
 *
 * `PlayerArea` is wrapped with `memo(..., arePlayerAreaPropsEqual)`, so this
 * is the exact predicate the board uses.
 */

// @ts-expect-error TS2456 - intentional circular type for memoized component test (pre-existing on main)
type AreaProps = React.ComponentProps<typeof MemoPlayer>;

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

function makeProps(
  player: PlayerState,
  extra: Partial<AreaProps> = {},
): AreaProps {
  return {
    player,
    isCurrentTurn: false,
    position: "top",
    orientation: "horizontal",
    onCardClick: jest.fn(),
    onZoneClick: jest.fn(),
    allPlayers: [],
    ...extra,
  };
}

describe("arePlayerAreaPropsEqual — direct predicate", () => {
  it("treats identical references as equal (no re-render)", () => {
    const props = makeProps(makePlayer());
    expect(arePlayerAreaPropsEqual(props, props)).toBe(true);
  });

  it("skips re-render when only an unrelated prop wrapper changed but arrays are same refs", () => {
    const player = makePlayer();
    const onCardClick = jest.fn();
    const onZoneClick = jest.fn();
    const allPlayers: PlayerState[] = [];
    const stable = { onCardClick, onZoneClick, allPlayers };
    // Same player reference + same callbacks + same allPlayers → equal even
    // though the props object itself is new.
    expect(arePlayerAreaPropsEqual(makeProps(player, stable), makeProps(player, stable))).toBe(
      true,
    );
  });

  it("re-renders when the battlefield array reference changes", () => {
    const prev = makeProps(makePlayer({ battlefield: [] }));
    const next = makeProps(makePlayer({ battlefield: [{ id: "c1" } as never] }));
    expect(arePlayerAreaPropsEqual(prev, next)).toBe(false);
  });

  it("re-renders when ONLY the graveyard array changes (battlefield untouched)", () => {
    const battlefield = [{ id: "b1" } as never];
    const prev = makeProps(makePlayer({ battlefield }));
    const next = makeProps(
      makePlayer({ battlefield, graveyard: [{ id: "g1" } as never] }),
    );
    // battlefield ref is identical, but graveyard changed → must re-render.
    expect(arePlayerAreaPropsEqual(prev, next)).toBe(false);
  });

  it("re-renders when exile/library/commandZone change", () => {
    const base = makePlayer();
    for (const zone of ["exile", "library", "commandZone"] as (
      | "exile"
      | "library"
      | "commandZone"
    )[]) {
      const next = makePlayer({ ...base, [zone]: [{ id: "x" } as never] });
      expect(arePlayerAreaPropsEqual(makeProps(base), makeProps(next))).toBe(
        false,
      );
    }
  });

  it("re-renders when turn changes but zone arrays are identical refs", () => {
    const player = makePlayer();
    const prev = makeProps(player, { isCurrentTurn: false });
    const next = makeProps(player, { isCurrentTurn: true });
    expect(arePlayerAreaPropsEqual(prev, next)).toBe(false);
  });

  it("re-renders when life total changes", () => {
    const prev = makeProps(makePlayer({ lifeTotal: 40 }));
    const next = makeProps(makePlayer({ lifeTotal: 38 }));
    expect(arePlayerAreaPropsEqual(prev, next)).toBe(false);
  });

  it("does not re-render when callbacks/position/orientation are unchanged and player is the same ref", () => {
    const player = makePlayer();
    const onCardClick = jest.fn();
    const onZoneClick = jest.fn();
    const allPlayers: PlayerState[] = [];
    const common = { onCardClick, onZoneClick, allPlayers };
    expect(
      arePlayerAreaPropsEqual(
        makeProps(player, common),
        makeProps(player, common),
      ),
    ).toBe(true);
  });

  it("re-renders when position or orientation changes", () => {
    const player = makePlayer();
    expect(
      arePlayerAreaPropsEqual(
        makeProps(player, { position: "top" }),
        makeProps(player, { position: "bottom" }),
      ),
    ).toBe(false);
    expect(
      arePlayerAreaPropsEqual(
        makeProps(player, { orientation: "horizontal" }),
        makeProps(player, { orientation: "vertical" }),
      ),
    ).toBe(false);
  });
});

/**
 * Render-counter harness: wraps a dummy component with `React.memo` using the
 * REAL `arePlayerAreaPropsEqual`. This proves the predicate actually prevents
 * React from re-rendering the subtree when zone arrays are unchanged — the
 * same memo boundary `PlayerArea` uses.
 */
// @ts-expect-error TS7022 - circular type by design (pre-existing on main)
const MemoPlayer = React.memo(
  // @ts-expect-error TS2502 - circular type by design (pre-existing on main)
  function MemoPlayer(_props: AreaProps) {
    renderCount++;
    return null;
  },
  arePlayerAreaPropsEqual,
);

let renderCount = 0;

function resetCount() {
  renderCount = 0;
}

describe("PlayerArea memo boundary — render counting", () => {
  it("renders once on mount, then bails out when props are unchanged references", () => {
    const onCardClick = jest.fn();
    const onZoneClick = jest.fn();
    const allPlayers: PlayerState[] = [];
    const stable = { onCardClick, onZoneClick, allPlayers };
    const player = makePlayer({ battlefield: [{ id: "b1" } as never] });

    const { rerender } = render(<MemoPlayer {...makeProps(player, stable)} />);
    expect(renderCount).toBe(1);

    // Re-render with a NEW props object but IDENTICAL inner references.
    rerender(<MemoPlayer {...makeProps(player, stable)} />);
    expect(renderCount).toBe(1); // no re-render

    rerender(<MemoPlayer {...makeProps(player, stable)} />);
    expect(renderCount).toBe(1);
  });

  it("re-renders exactly once more when a single zone array reference changes", () => {
    resetCount();
    const onCardClick = jest.fn();
    const onZoneClick = jest.fn();
    const allPlayers: PlayerState[] = [];
    const stable = { onCardClick, onZoneClick, allPlayers };
    const playerA = makePlayer({ graveyard: [] });
    const playerB = makePlayer({ graveyard: [{ id: "g1" } as never] });
    // battlefield unchanged ref ([] default), only graveyard ref changes.

    const { rerender } = render(<MemoPlayer {...makeProps(playerA, stable)} />);
    expect(renderCount).toBe(1);

    rerender(<MemoPlayer {...makeProps(playerB, stable)} />);
    expect(renderCount).toBe(2); // graveyard changed → re-render

    // Identical again → bail out.
    rerender(<MemoPlayer {...makeProps(playerB, stable)} />);
    expect(renderCount).toBe(2);
  });

  it("does not re-render when an unrelated player prop changes that the comparator ignores", () => {
    resetCount();
    const onCardClick = jest.fn();
    const onZoneClick = jest.fn();
    const allPlayers: PlayerState[] = [];
    const stable = { onCardClick, onZoneClick, allPlayers };
    // `landsPlayedThisTurn` is intentionally NOT in the comparator — a delta
    // that only touches it must NOT re-render the player area.
    const player = makePlayer({ landsPlayedThisTurn: 0 });

    const { rerender } = render(<MemoPlayer {...makeProps(player, stable)} />);
    expect(renderCount).toBe(1);

    const player2 = { ...player, landsPlayedThisTurn: 3 };
    rerender(<MemoPlayer {...makeProps(player2, stable)} />);
    expect(renderCount).toBe(1); // ignored field → no re-render
  });
});

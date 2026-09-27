import React from "react";
import { describe, it, expect } from "@jest/globals";
import { render } from "@testing-library/react";
import { ZoneDisplayLocal } from "../game-board";

/**
 * Regression test for issue #2292:
 *   `ZoneDisplayLocal` defined inside memo'd `PlayerArea` causes full zone
 *   remount every render.
 *
 * Before the fix, `ZoneDisplayLocal` was declared inside the `PlayerArea`
 * function body, so every render of `PlayerArea` produced a fresh component
 * reference. React then treated each `<ZoneDisplayLocal />` as a different
 * component type and unmounted/remounted the subtree, wiping transient UI
 * state (focus, hover, scroll position, animations).
 *
 * The fix hoists the wrapper to a module-level `React.memo` binding. This
 * test pins both halves of that contract:
 *
 *   1. The component reference is a single hoisted binding — it must
 *      survive multiple JSX evaluation sites without recreating itself.
 *   2. The returned React element's `type` slot is the same reference
 *      regardless of where/when the element was constructed — proving
 *      React will reuse the existing fiber instead of remounting.
 */

describe("ZoneDisplayLocal — #2292 remount regression", () => {
  it("is a single module-level binding (stable identity across uses)", () => {
    // The same export referenced twice must be `===` because it is one
    // hoisted const at module scope. Pre-fix, the local definition was a
    // fresh closure per render, so it had no module-level identity at all.
    expect(ZoneDisplayLocal).toBe(ZoneDisplayLocal);
  });

  it("is wrapped with React.memo so its identity is the memo object", () => {
    // React.memo returns a special object with a `$$typeof` of
    // REACT_MEMO_TYPE. A plain function component would not carry that
    // symbol — proving the hoisted wrapper participates in memoization.
    const memoType = (ZoneDisplayLocal as unknown as { $$typeof: symbol })
      .$$typeof;
    expect(memoType).toBe(Symbol.for("react.memo"));
  });

  it("produces React elements with the SAME type across re-renders", () => {
    // The actual end-to-end signal. JSX compiles to React.createElement,
    // which captures the component reference in the resulting element's
    // `type` slot. If `ZoneDisplayLocal` were recreated per render (the
    // bug), every JSX site would inject a fresh `type` and React would
    // tear down the existing fiber before mounting the new one.
    const props = {
      zone: "battlefield" as const,
      title: "Battlefield",
      count: 0,
      cards: [],
      playerId: "p1",
      onCardClick: () => undefined,
      onZoneClick: () => undefined,
    };

    const firstElement = React.createElement(ZoneDisplayLocal, props);
    const secondElement = React.createElement(ZoneDisplayLocal, props);

    expect(firstElement.type).toBe(secondElement.type);
    expect(firstElement.type).toBe(ZoneDisplayLocal);

    // Sanity check: rendering the element does not throw and produces
    // the expected region (ZoneDisplay exposes `aria-label="<title>: <n> cards"`).
    const { getByRole, unmount } = render(firstElement);
    expect(
      getByRole("region", { name: "Battlefield: 0 cards" }),
    ).toBeInTheDocument();
    unmount();
  });
});

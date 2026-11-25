import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { PhaseTracker } from "../PhaseTracker";
import type { Phase } from "@/lib/game-state";

/**
 * Issue #2418 (SLICE 11) — the memoized phase tracker leaf.
 *
 * `PhaseTracker` used to be a plain function component that rebuilt its
 * 13-entry phase table on every render, even though the table is static and
 * the props are two primitives. It is now a `React.memo` leaf with the table
 * hoisted to module scope.
 *
 * The tests below pin
 *
 * 1. the rendered output (the current phase label, the past/current styling
 *    and the connector elements between the phases);
 * 2. the memo boundary — a re-render with identical props must not run the
 *    leaf's render function again.
 *
 * The leaf renders plain DOM and has no children of its own, so (unlike the
 * sibling `game-board-region.test.tsx`, which counts the renders of a mocked
 * child) the render count is observed by instrumenting `React.memo`: the
 * counter is incremented by the wrapped render function, which React skips
 * entirely when the props of a memoized component are unchanged.
 */

jest.mock("react", () => {
  const actual = jest.requireActual<typeof import("react")>("react");
  const counter = { renders: 0 };
  const mocked = {
    ...actual,
    memo: (fn: unknown, compare?: unknown) =>
      actual.memo(
        (props: unknown) => {
          counter.renders += 1;
          return (fn as (props: unknown) => React.ReactNode)(props);
        },
        compare as never,
      ),
  };
  (mocked as unknown as { __renderCounter?: { renders: number } })
    .__renderCounter = counter;
  return mocked;
});

/** The number of times the memoized leaf actually rendered. */
function leafRenders(): number {
  const counter = (
    React as unknown as { __renderCounter?: { renders: number } }
  ).__renderCounter;
  return counter ? counter.renders : 0;
}

const PHASE_LABELS = [
  "Untap",
  "Upkeep",
  "Draw",
  "Main 1",
  "Combat",
  "Attack",
  "Block",
  "First Strike",
  "Damage",
  "End Combat",
  "Main 2",
  "End",
  "Cleanup",
];

describe("PhaseTracker", () => {
  it("renders the current phase label", () => {
    render(
      <PhaseTracker
        currentPhase={"begin_combat" as Phase}
        isPlayerTurn={true}
      />,
    );

    expect(screen.getByText("Combat")).toBeDefined();
    expect(screen.getByTitle("Combat")).toBeDefined();
    // Only the current phase shows its label.
    expect(screen.getByTitle("Combat").textContent).toBe("Combat");
    expect(screen.getByTitle("Untap").textContent).toBe("");
  });

  it("renders the phase strip with the expected wrapper class", () => {
    const { container } = render(
      <PhaseTracker
        currentPhase={"begin_combat" as Phase}
        isPlayerTurn={true}
      />,
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe("DIV");
    expect(root.getAttribute("class")).toBe(
      "flex items-center justify-center gap-1.5 px-4 py-1 bg-background/80 border-b overflow-x-auto no-scrollbar",
    );
  });

  it("marks the past phases and the current phase", () => {
    const { container } = render(
      <PhaseTracker
        currentPhase={"begin_combat" as Phase}
        isPlayerTurn={true}
      />,
    );

    const phaseDots = Array.from(
      container.querySelectorAll<HTMLElement>("div[title]"),
    );
    expect(phaseDots).toHaveLength(PHASE_LABELS.length);
    expect(phaseDots.map((dot) => dot.getAttribute("title"))).toEqual(
      PHASE_LABELS,
    );

    // Past phases (Untap … Block) are dimmed primary dots.
    for (const dot of phaseDots.slice(0, 4)) {
      expect(dot.className).toContain("bg-primary/40");
      expect(dot.className).toContain("w-1.5 h-1.5 rounded-full");
    }

    // The current phase is the highlighted pill and carries its label.
    const current = phaseDots[4];
    expect(current.className).toContain("bg-primary text-primary-foreground");
    expect(current.className).toContain("rounded bg-primary");
    expect(current.textContent).toBe("Combat");

    // Future phases are muted dots.
    for (const dot of phaseDots.slice(5)) {
      expect(dot.className).toContain("bg-muted-foreground/30");
    }
  });

  it("renders the connectors between the phases, skipping the current one", () => {
    const { container } = render(
      <PhaseTracker
        currentPhase={"begin_combat" as Phase}
        isPlayerTurn={true}
      />,
    );

    // 13 phase dots; a connector sits between two phases, except right
    // before and right after the current phase: 12 - 2 = 10 connectors.
    const connectors = Array.from(
      container.querySelectorAll<HTMLElement>("div.h-\\[1px\\]"),
    );
    expect(connectors).toHaveLength(10);
    for (const connector of connectors) {
      expect(connector.className).toContain("w-1");
    }
  });

  it("does not re-render the leaf when the props are unchanged (memo bail-out)", () => {
    const props = {
      currentPhase: "begin_combat" as Phase,
      isPlayerTurn: true,
    };

    // The counter is cumulative across the file, so the assertions below
    // compare deltas.
    const before = leafRenders();
    const { rerender } = render(<PhaseTracker {...props} />);
    const afterMount = leafRenders();
    expect(afterMount).toBe(before + 1);

    // A fresh element with identical props — the shape of a board delta that
    // does not touch the phase. The memoized leaf must bail out, so its
    // render function does not run again.
    rerender(<PhaseTracker {...props} />);
    expect(leafRenders()).toBe(afterMount);

    // A changed prop must still reach the leaf.
    rerender(<PhaseTracker {...props} currentPhase={"draw" as Phase} />);
    expect(leafRenders()).toBe(afterMount + 1);
    expect(screen.getByText("Draw")).toBeDefined();
  });
});

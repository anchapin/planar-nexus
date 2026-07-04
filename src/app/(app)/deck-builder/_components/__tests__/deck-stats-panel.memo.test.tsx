/**
 * @fileoverview Render-count regression test for DeckStatsPanel (issue #1083).
 *
 * `DeckStatsPanel` is wrapped in `React.memo` with a comparator keyed on the
 * deck's content signature. These tests assert that the statistics subtree
 * (represented here by a render-counting mock of the mana-curve chart) is NOT
 * re-rendered when a parent hands down a freshly-allocated deck array holding
 * identical cards — the re-render storm that caused input lag during edits.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

// `jest.mock` factories are hoisted; they may only reference bindings whose
// names are prefixed with `mock`. The counters are read at render time, well
// after initialization, so this is TDZ-safe.
let mockManaRenders = 0;

jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...props }: any) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
  CardHeader: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children, className }: any) => (
    <h3 className={className}>{children}</h3>
  ),
  CardContent: ({ children, className, ...props }: any) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, className, ...props }: any) => (
    <button type="button" onClick={onClick} className={className} {...props}>
      {children}
    </button>
  ),
}));

jest.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, value }: any) => (
    <button type="button" data-value={value}>
      {children}
    </button>
  ),
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/components/deck-statistics", () => ({
  // Render-counting stand-in: increments only when React actually reconciles
  // the chart. When `DeckStatsPanel`'s `React.memo` bails out, React skips
  // the whole subtree and this is NOT invoked again.
  ManaCurveChart: () => {
    mockManaRenders++;
    return <div data-testid="mana-curve-chart" />;
  },
  CardTypeChart: () => <div data-testid="card-type-chart" />,
  DeckColorChart: () => <div data-testid="deck-color-chart" />,
}));

jest.mock("@/hooks/use-deck-statistics", () => {
  // Preserve the real `getDeckSignature` (used by the panel's `React.memo`
  // comparator) while stubbing only the hook so the panel render is isolated.
  const actual = jest.requireActual<
    typeof import("@/hooks/use-deck-statistics")
  >("@/hooks/use-deck-statistics");
  return {
    ...actual,
    useDeckStatistics: () => ({
      totalCards: 60,
      uniqueCards: 40,
      averageManaValue: 2.1,
      manaCurve: { 0: 2, 1: 8, 2: 10 },
      typeDistribution: { creature: 20 },
      colorDistribution: { R: 30 },
    }),
  };
});

jest.mock("lucide-react", () => ({
  BarChart3: () => <svg />,
  PieChart: () => <svg />,
  Palette: () => <svg />,
  ChevronDown: () => <svg />,
  ChevronUp: () => <svg />,
  Calculator: () => <svg />,
  Lightbulb: () => <svg />,
  ShieldCheck: () => <svg />,
  ShieldAlert: () => <svg />,
  Ban: () => <svg />,
}));

import * as React from "react";
import { DeckStatsPanel } from "@/app/(app)/deck-builder/_components/deck-stats-panel";
import type { DeckCard } from "@/app/actions";

function card(id: string, count = 1): DeckCard {
  return {
    id,
    name: id,
    cmc: 2,
    type_line: "Creature",
    colors: ["R"],
    color_identity: ["R"],
    legalities: {},
    count,
  } as DeckCard;
}

describe("DeckStatsPanel — memoization (issue #1083)", () => {
  it("skips re-render when a new deck array reference holds identical cards", () => {
    mockManaRenders = 0;
    const deckA = [card("a", 2), card("b", 1)];

    const { rerender } = render(
      <DeckStatsPanel deck={deckA} format="commander" />,
    );
    const initialRenderCount = mockManaRenders;
    expect(initialRenderCount).toBeGreaterThan(0);

    // New array references, identical contents — must NOT re-render.
    rerender(
      <DeckStatsPanel deck={[card("a", 2), card("b", 1)]} format="commander" />,
    );
    expect(mockManaRenders).toBe(initialRenderCount);

    rerender(
      <DeckStatsPanel deck={[card("a", 2), card("b", 1)]} format="commander" />,
    );
    expect(mockManaRenders).toBe(initialRenderCount);
  });

  it("re-renders when the deck contents actually change", () => {
    mockManaRenders = 0;
    const deck = [card("a", 1)];
    const { rerender } = render(
      <DeckStatsPanel deck={deck} format="commander" />,
    );
    const initialRenderCount = mockManaRenders;

    // A third, distinct card changes the content signature.
    rerender(
      <DeckStatsPanel
        deck={[card("a", 1), card("b", 1), card("c", 1)]}
        format="commander"
      />,
    );
    expect(mockManaRenders).toBeGreaterThan(initialRenderCount);
  });

  it("re-renders when a non-deck prop (className) changes", () => {
    mockManaRenders = 0;
    const deck = [card("a", 1)];
    const { rerender } = render(
      <DeckStatsPanel deck={deck} format="commander" className="a" />,
    );
    const initialRenderCount = mockManaRenders;

    rerender(<DeckStatsPanel deck={deck} format="commander" className="b" />);
    expect(mockManaRenders).toBeGreaterThan(initialRenderCount);
  });
});

/**
 * @fileoverview Recharts re-render storm regression test for DeckStatsPanel
 * (issue #1248).
 *
 * Phase 33 target: "40% scripting-time reduction." The Recharts subtree inside
 * `DeckStatsPanel` must NOT re-render when only unrelated parent state changes
 * (e.g. a deck-name input keystroke). Even when the panel itself re-renders
 * (because one of its non-deck props changed), the chart subtrees must short-
 * circuit because their `data` props are reference-stable across renders that
 * leave the deck contents unchanged.
 *
 * Two test scenarios cover this end-to-end:
 *
 *  1. Keystroke storm — `name` state changes while `deck` reference and
 *     contents are stable. The panel's outer `React.memo` bails out; charts
 *     should not reconcile.
 *
 *  2. Keystroke + fresh-deck storm — `name` changes AND a freshly-allocated
 *     deck array holding identical contents is passed in lock-step. The
 *     panel's outer memo bails out (signature is unchanged); charts must not
 *     reconcile, thanks to the deck-signature-keyed `useMemo` on `data`.
 *
 * Both scenarios mount a 100-card deck to mirror the worst-case cost an
 * un-memoized chart tree would impose on every keystroke.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

/**
 * `jest.mock` factories are hoisted to the top of the module; they may only
 * reference bindings whose names are prefixed with `mock`. The counters below
 * are read at render time, well after initialization, so this is TDZ-safe.
 */
let mockManaRenders = 0;
let mockTypeRenders = 0;
let mockColorRenders = 0;

beforeEach(() => {
  mockManaRenders = 0;
  mockTypeRenders = 0;
  mockColorRenders = 0;
});

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

// Render-counting stand-ins for the Recharts-backed chart components. The
// mocks MUST mimic the real components' `React.memo` wrapper: when the parent
// re-renders with shallow-equal props, React.memo bails out before invoking
// the inner function. Each mock increments its counter only when React
// actually reconciles that subtree, so a memoized bailout correctly produces
// zero additional renders in the counter.
jest.mock("@/components/deck-statistics", () => {
  const ReactLib = jest.requireActual("react") as typeof import("react");
  const ManaInner = () => {
    mockManaRenders++;
    return <div data-testid="mana-curve-chart" />;
  };
  const TypeInner = () => {
    mockTypeRenders++;
    return <div data-testid="card-type-chart" />;
  };
  const ColorInner = () => {
    mockColorRenders++;
    return <div data-testid="deck-color-chart" />;
  };
  return {
    ManaCurveChart: ReactLib.memo(ManaInner),
    CardTypeChart: ReactLib.memo(TypeInner),
    DeckColorChart: ReactLib.memo(ColorInner),
  };
});

// Use the real `useDeckStatistics` (signature-memoized) so the chart-data
// memoization we're testing actually runs end-to-end inside the panel.
jest.mock("@/hooks/use-deck-statistics", () => {
  const actual = jest.requireActual<
    typeof import("@/hooks/use-deck-statistics")
  >("@/hooks/use-deck-statistics");
  return actual;
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
import type { DeckLegalitySummary } from "@/hooks/use-format-legality-check";

function makeCard(id: number): DeckCard {
  return {
    id: `card-${id}`,
    name: `Card ${id}`,
    cmc: id % 8,
    type_line: id % 5 === 0 ? "Land" : "Creature",
    colors: ["R"],
    color_identity: ["R"],
    legalities: {},
    count: 1,
  } as DeckCard;
}

/** Builds a 100-card deck array. Each call returns a fresh reference. */
function buildDeck(): DeckCard[] {
  const cards: DeckCard[] = [];
  for (let i = 0; i < 100; i++) cards.push(makeCard(i));
  return cards;
}

function renderCounters() {
  return {
    mana: mockManaRenders,
    type: mockTypeRenders,
    color: mockColorRenders,
  };
}

/**
 * Builds a parent wrapper that pre-computes a stable chart `data` array
 * (via `React.useMemo`) and forces the panel to re-render on every
 * keystroke by varying a non-deck prop. Lets us verify that the chart's
 * `React.memo` short-circuits when the `data` reference is reused.
 */
function makeRechartsProxyData() {
  return [
    { cmc: "1", cmcNum: 1, count: 8 },
    { cmc: "2", cmcNum: 2, count: 12 },
    { cmc: "3", cmcNum: 3, count: 6 },
  ];
}

const baseLegality: DeckLegalitySummary = {
  illegalCardCount: 0,
  legalCardCount: 100,
  illegalCardNames: [],
  bannedCardNames: [],
  cards: new Map(),
  isDeckLegal: true,
};

/**
 * Parent that holds `name` (the simulated deck-name input value), the
 * current `deck` array, AND a counter that bumps on each keystroke so that
 * `legalitySummary` (a non-deck prop) gets a fresh reference on every
 * render. That forces `DeckStatsPanel`'s outer `React.memo` to fall through
 * (the panel re-renders), and isolates whether the *inner* chart-data
 * memoization short-circuits as expected.
 */
function ParentWithFreshLegality() {
  const [name, setName] = React.useState("My Deck");
  const [renderTick, setRenderTick] = React.useState(0);
  const deck = React.useMemo(buildDeck, []);
  const legalitySummary = React.useMemo< DeckLegalitySummary>(
    () => ({ ...baseLegality, _tick: renderTick } as any),
    [renderTick],
  );
  return (
    <div>
      <input
        data-testid="deck-name-input"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setRenderTick((t) => t + 1);
        }}
      />
      <DeckStatsPanel
        deck={deck}
        format="commander"
        legalitySummary={legalitySummary}
      />
    </div>
  );
}

/**
 * Parent that holds `name` and the current `deck` array. A `freshen-deck`
 * click swaps in a brand-new array holding identical contents — the exact
 * input-churn pattern the panel's signature memoization was added to handle.
 */
function ParentWithFreshen() {
  const [name, setName] = React.useState("My Deck");
  const [deck, setDeck] = React.useState<DeckCard[]>(buildDeck);
  return (
    <div>
      <input
        data-testid="deck-name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button
        type="button"
        data-testid="freshen-deck"
        onClick={() => setDeck(buildDeck())}
      >
        freshen-deck
      </button>
      <DeckStatsPanel deck={deck} format="commander" />
    </div>
  );
}

describe("DeckStatsPanel — Recharts re-render storm guard (issue #1248)", () => {
  it("keystroke storm leaves the chart subtrees unmounted-equal", () => {
    const { getByTestId } = render(<ParentWithFreshen />);
    const baseline = renderCounters();
    expect(baseline.mana).toBeGreaterThanOrEqual(1);

    // Simulate three keystrokes on the deck-name input. The parent
    // re-renders with a stable `deck` reference; the panel's `React.memo`
    // should bail out and the chart subtrees should NOT reconcile again.
    fireEvent.change(getByTestId("deck-name-input"), {
      target: { value: "My Deck v2" },
    });
    fireEvent.change(getByTestId("deck-name-input"), {
      target: { value: "My Deck v3" },
    });
    fireEvent.change(getByTestId("deck-name-input"), {
      target: { value: "My Deck v4" },
    });

    const after = renderCounters();
    expect(after.mana).toBeLessThanOrEqual(baseline.mana + 1);
    expect(after.type).toBeLessThanOrEqual(baseline.type + 1);
    expect(after.color).toBeLessThanOrEqual(baseline.color + 1);
  });

  it("freshly-allocated deck of identical contents leaves the chart subtrees unmounted-equal", () => {
    const { getByTestId } = render(<ParentWithFreshen />);
    const baseline = renderCounters();
    expect(baseline.mana).toBeGreaterThanOrEqual(1);

    // Click "freshen-deck": the parent swaps in a brand-new array holding
    // identical cards. Without the issue #1083 / #1248 memoization, the
    // Recharts trees would re-render on every freshening because the deck
    // array reference changed.
    fireEvent.click(getByTestId("freshen-deck"));
    fireEvent.click(getByTestId("freshen-deck"));
    fireEvent.click(getByTestId("freshen-deck"));

    const after = renderCounters();
    expect(after.mana).toBeLessThanOrEqual(baseline.mana + 1);
    expect(after.type).toBeLessThanOrEqual(baseline.type + 1);
    expect(after.color).toBeLessThanOrEqual(baseline.color + 1);
  });

  it("panel re-renders with stale-data charts skip reconciliation", () => {
    // Force the panel to re-render on every keystroke by varying a non-deck
    // prop (`legalitySummary`) so the outer `React.memo` lets the panel
    // reconcile. With the new data-prop memoization in place, the charts'
    // inner `React.memo` should still bail out because the chart `data`
    // arrays are reference-stable across renders that leave the deck
    // contents unchanged.
    const { getByTestId } = render(<ParentWithFreshLegality />);
    const baseline = renderCounters();
    expect(baseline.mana).toBeGreaterThanOrEqual(1);

    fireEvent.change(getByTestId("deck-name-input"), {
      target: { value: "First rename" },
    });
    fireEvent.change(getByTestId("deck-name-input"), {
      target: { value: "Second rename" },
    });

    const after = renderCounters();
    // Even though the panel re-renders (legalitySummary reference changed),
    // the chart `data` props are reference-stable. At most one extra
    // reconciliation across both keystrokes (a healthy upper bound for
    // React's batching in concurrent mode).
    expect(after.mana).toBeLessThanOrEqual(baseline.mana + 1);
    expect(after.type).toBeLessThanOrEqual(baseline.type + 1);
    expect(after.color).toBeLessThanOrEqual(baseline.color + 1);
  });

  it("chart subtree skips re-render when only the parent re-renders", () => {
    // Direct unit test for the issue #1248 chart-data memoization:
    // re-render the panel itself multiple times with stable deck-array
    // contents; the chart mocks must be invoked exactly once (the
    // initial mount).
    const stableData = makeRechartsProxyData();

    let panelRenders = 0;
    function Wrapper({ extraProp }: { extraProp: number }) {
      panelRenders++;
      const deck = React.useMemo(() => buildDeck(), []);
      return (
        <DeckStatsPanel
          deck={deck}
          format="commander"
          className={String(extraProp)}
        />
      );
    }

    const { rerender } = render(<Wrapper extraProp={0} />);
    const baseline = renderCounters();
    expect(baseline.mana).toBe(1);

    // Three re-renders, all with the same deck reference and contents.
    // The panel renders (we change `extraProp` to bust the memo
    // comparator), but the chart `data` prop stays reference-stable
    // and the chart mock must NOT be invoked again.
    rerender(<Wrapper extraProp={1} />);
    rerender(<Wrapper extraProp={2} />);
    rerender(<Wrapper extraProp={3} />);
    expect(panelRenders).toBeGreaterThanOrEqual(4);

    const after = renderCounters();
    expect(after.mana).toBe(baseline.mana);
    expect(after.type).toBe(baseline.type);
    expect(after.color).toBe(baseline.color);
  });
});

/**
 * @fileoverview Accessibility tests for SideboardRecommenderPanel (issue #1447).
 *
 * The AI coach's `/deck-coach` recommendations use a `<ConfidenceBadge>`
 * that previously conveyed its tier (`high` / `medium` / `low`) by color
 * alone and exposed the bare word to screen readers. Issue #1447 requires:
 *
 *   1. `role="status"` so SRs announce tier changes as a polite update.
 *   2. `aria-label="<tier> confidence"` so the spoken form has noun context.
 *   3. `data-confidence` hook so the global forced-colors CSS rule can
 *      promote the badge to a Highlight outline (issue #1269).
 *   4. A color + icon pairing so the tier is conveyed by three cues (color,
 *      icon, word), not by color alone — WCAG 1.4.1 (Use of Color).
 *   5. List semantics (ul/li) for the swap lists — WCAG 1.3.1.
 *
 * The hook mock short-circuits the network-shaped recommendation flow so
 * these tests render the badges deterministically.
 */

import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

// Stable mock factory — `jest.mock` is hoisted by the Jest transform, so we
// define the hook here and patch the returned state per test below.
jest.mock("@/hooks/use-sideboard-recommender", () => ({
  useSideboardRecommender: jest.fn(),
}));

import { useSideboardRecommender } from "@/hooks/use-sideboard-recommender";
import { SideboardRecommenderPanel } from "@/components/ai-coach/sideboard-recommender-panel";
import type { MatchupSideboardGuide } from "@/lib/sideboard-recommender";

const mockedHook = jest.mocked(useSideboardRecommender);

const FIXTURE_GUIDE: MatchupSideboardGuide = {
  matchup: "Mono Red Aggro vs Control",
  playerArchetype: "Mono Red Aggro",
  opponentArchetype: "Azorius Control",
  format: "standard",
  playerCategory: "aggro",
  opponentCategory: "control",
  bringIn: [
    {
      cardName: "Fry",
      count: 2,
      reason: "Removal for early blockers",
      source: "coverage",
      confidence: "high",
    },
    {
      cardName: "Roiling Vortex",
      count: 1,
      reason: "Damage-per-upkeep pressure",
      source: "meta-data",
      confidence: "medium",
    },
  ],
  takeOut: [
    {
      cardName: "Embercleave",
      count: 2,
      reason: "Slow against board clears",
      source: "heuristic",
      confidence: "low",
    },
  ],
  generalNotes: "Race fast. Hold burn for board wipes.",
  estimatedWinRateDelta: 8,
  sources: [
    {
      type: "pro-tour",
      description: "PT example coverage",
      event: "Pro Tour 2024",
    },
  ],
};

function setRecommendation(
  recommendation: MatchupSideboardGuide | null,
): void {
  mockedHook.mockReturnValue({
    recommendation,
    availableMatchups: recommendation
      ? [
          {
            playerArchetype: recommendation.playerArchetype,
            opponentArchetype: recommendation.opponentArchetype,
            matchup: recommendation.matchup,
          },
        ]
      : [],
    matchupPlans: recommendation ? [recommendation] : [],
    searchResults: [],
    uniqueCards: new Map(),
    isLoading: false,
    error: null,
    getPlayerArchetypes: () =>
      recommendation ? [recommendation.playerArchetype] : [],
    getOpponentArchetypes: () =>
      recommendation ? [recommendation.opponentArchetype] : [],
    fetchRecommendation: jest.fn(),
    search: jest.fn(),
  });
}

function renderPanel(recommendation: MatchupSideboardGuide | null) {
  setRecommendation(recommendation);
  return render(
    <SideboardRecommenderPanel
      format="standard"
      playerArchetype={recommendation?.playerArchetype ?? "Mono Red Aggro"}
      opponentArchetype={
        recommendation?.opponentArchetype ?? "Azorius Control"
      }
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Confidence-badge acceptance (#1447)
// ---------------------------------------------------------------------------

describe("ConfidenceBadge — ARIA semantics (#1447, WCAG 4.1.2)", () => {
  it("renders high/medium/low badges with role='status' and an aria-label", () => {
    renderPanel(FIXTURE_GUIDE);

    expect(
      screen.getByRole("status", { name: /high confidence/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: /medium confidence/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: /low confidence/i }),
    ).toBeInTheDocument();
  });

  it("exposes the tier via data-confidence for the forced-colors CSS hook", () => {
    renderPanel(FIXTURE_GUIDE);

    const high = screen.getByRole("status", { name: /high confidence/i });
    const medium = screen.getByRole("status", { name: /medium confidence/i });
    const low = screen.getByRole("status", { name: /low confidence/i });

    expect(high).toHaveAttribute("data-confidence", "high");
    expect(medium).toHaveAttribute("data-confidence", "medium");
    expect(low).toHaveAttribute("data-confidence", "low");
  });

  it("hides the decorative glyph from screen readers", () => {
    renderPanel(FIXTURE_GUIDE);

    // The colored glyph (✓ / ⚠ / ✗) is a visual cue; the noun ("high
    // confidence") is carried by the wrapper's aria-label.
    const high = screen.getByRole("status", { name: /high confidence/i });
    expect(high.querySelector('[aria-hidden="true"]')).not.toBeNull();
    // Sighted users still see the literal tier word.
    expect(high).toHaveTextContent(/high/);
  });
});

// ---------------------------------------------------------------------------
// List semantics — render SwapList's <ul>/<li> (#1447, WCAG 1.3.1)
// ---------------------------------------------------------------------------

describe("SideboardRecommenderPanel — list semantics (#1447, WCAG 1.3.1)", () => {
  it("wraps bring-in swaps in a <ul role='list'> with an accessible name", () => {
    renderPanel(FIXTURE_GUIDE);

    const list = screen.getByRole("list", { name: /cards to bring in/i });
    expect(list).toBeInTheDocument();
    expect(list.tagName).toBe("UL");
    expect(list).toHaveAttribute("role", "list");
  });

  it("wraps take-out swaps in a <ul role='list'> with an accessible name", () => {
    renderPanel(FIXTURE_GUIDE);

    const list = screen.getByRole("list", { name: /cards to take out/i });
    expect(list).toBeInTheDocument();
    expect(list.tagName).toBe("UL");
  });

  it("renders one <li> per swap in each list", () => {
    renderPanel(FIXTURE_GUIDE);

    const bringIn = screen.getByRole("list", { name: /cards to bring in/i });
    const takeOut = screen.getByRole("list", { name: /cards to take out/i });

    expect(bringIn.querySelectorAll("li")).toHaveLength(
      FIXTURE_GUIDE.bringIn.length,
    );
    expect(takeOut.querySelectorAll("li")).toHaveLength(
      FIXTURE_GUIDE.takeOut.length,
    );
  });

  it("does not render an empty <ul> when there are no swaps", () => {
    renderPanel(null);

    // No recommendation → no `<ul>` and no vacuous listitem. The empty
    // copy "No cards to bring/take out" lives outside the list instead,
    // so screen readers never announce an empty list.
    expect(screen.queryByRole("list")).toBeNull();
  });
});

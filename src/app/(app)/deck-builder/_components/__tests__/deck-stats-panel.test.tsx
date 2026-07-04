/**
 * @fileoverview Accessibility tests for DeckStatsPanel
 *
 * Verifies the collapse toggle exposes an accessible name and expanded state
 * to assistive technology (issue #934).
 */

import { describe, it, expect, jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

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
  ManaCurveChart: () => <div data-testid="mana-curve-chart" />,
  CardTypeChart: () => <div data-testid="card-type-chart" />,
  DeckColorChart: () => <div data-testid="deck-color-chart" />,
}));

jest.mock("@/hooks/use-deck-statistics", () => ({
  useDeckStatistics: () => ({
    totalCards: 60,
    uniqueCards: 40,
    averageManaValue: 2.1,
    manaCurve: { 0: 2, 1: 8, 2: 10 },
    typeDistribution: { creature: 20, instant: 8, land: 24 },
    colorDistribution: { R: 30, Colorless: 24 },
  }),
}));

jest.mock("lucide-react", () => ({
  BarChart3: () => <svg />,
  PieChart: () => <svg />,
  Palette: () => <svg />,
  ChevronDown: () => <svg />,
  ChevronUp: () => <svg />,
  Calculator: () => <svg />,
  Lightbulb: () => <svg />,
}));

import { DeckStatsPanel } from "@/app/(app)/deck-builder/_components/deck-stats-panel";

const deck = [{ id: "card-1", count: 1 }] as any;

describe("DeckStatsPanel — collapse toggle accessibility", () => {
  it("renders null when the deck is empty", () => {
    const { container } = render(<DeckStatsPanel deck={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("labels the toggle button and reports the expanded state", () => {
    render(<DeckStatsPanel deck={deck} />);

    const toggle = screen.getByRole("button", {
      name: "Collapse deck statistics",
    });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "deck-statistics-content");
  });

  it("flips the accessible name and expanded state when toggled", () => {
    render(<DeckStatsPanel deck={deck} />);

    // Expanded initially
    const collapseBtn = screen.getByRole("button", {
      name: "Collapse deck statistics",
    });
    expect(collapseBtn).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapseBtn);

    const expandBtn = screen.getByRole("button", {
      name: "Expand deck statistics",
    });
    expect(expandBtn).toHaveAttribute("aria-expanded", "false");
    expect(expandBtn).toHaveAttribute(
      "aria-controls",
      "deck-statistics-content",
    );
  });

  it("exposes the controlled region via the matching id when expanded", () => {
    const { container } = render(<DeckStatsPanel deck={deck} />);
    const region = container.querySelector("#deck-statistics-content");
    expect(region).not.toBeNull();
  });
});

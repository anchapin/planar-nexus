/**
 * @fileoverview Accessibility tests for deck statistics chart components
 *
 * Each chart is purely visual (recharts SVG). These tests verify that a
 * screen-reader text alternative (a visually-hidden data table mirroring the
 * chart data) is rendered alongside every chart, and that the decorative
 * SVG chart itself is hidden from assistive technology (issue #934).
 */

import { describe, it, expect, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";

// Stub recharts so charts render without jsdom layout dependencies.
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  BarChart: ({ children }: any) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  PieChart: ({ children }: any) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: () => <div data-testid="pie" />,
  Cell: () => null,
  Legend: () => null,
}));

jest.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
  CardContent: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/lib/utils", () => ({
  cn: (...classes: any[]) => classes.filter(Boolean).join(" "),
}));

// Stub every lucide icon used anywhere in the module under test.
jest.mock(
  "lucide-react",
  () =>
    new Proxy(
      {},
      {
        get: () => () => <svg data-testid="lucide-icon" />,
      },
    ),
);

import {
  ManaCurveChart,
  CardTypeChart,
  DeckColorChart,
} from "@/components/deck-statistics";

function chartIsHiddenFromAT(container: HTMLElement): boolean {
  // The decorative SVG chart must live inside an aria-hidden wrapper.
  return (
    container.querySelector('[aria-hidden="true"] [data-testid]') !== null
  );
}

describe("ManaCurveChart — screen-reader alternative", () => {
  it("renders a visually-hidden data table mirroring the mana curve", () => {
    const { container } = render(
      <ManaCurveChart manaCurve={{ 0: 2, 1: 8, 2: 6, 7: 3 }} />,
    );

    const table = container.querySelector("table.sr-only");
    expect(table).not.toBeNull();
    expect(table).toHaveTextContent(/Mana curve/i);
    expect(table).toHaveTextContent("Converted Mana Cost");
    expect(table).toHaveTextContent("Number of Cards");
    // CMC bucket labels and counts are present.
    expect(table).toHaveTextContent("8");
    expect(table).toHaveTextContent("7+");
  });

  it("hides the decorative chart from assistive technology", () => {
    const { container } = render(<ManaCurveChart manaCurve={{ 1: 4 }} />);
    expect(chartIsHiddenFromAT(container)).toBe(true);
  });
});

describe("CardTypeChart — screen-reader alternative", () => {
  const typeDistribution = { creature: 20, instant: 8, sorcery: 4, land: 24 };

  it("renders a visually-hidden data table for the bar chart", () => {
    const { container } = render(
      <CardTypeChart typeDistribution={typeDistribution} chartType="bar" />,
    );

    const table = container.querySelector("table.sr-only");
    expect(table).not.toBeNull();
    expect(table).toHaveTextContent(/Card type breakdown/i);
    expect(table).toHaveTextContent("Percentage of Deck");
    expect(table).toHaveTextContent("Creature");
    expect(table).toHaveTextContent("Land");
  });

  it("renders a visually-hidden data table for the pie chart", () => {
    const { container } = render(
      <CardTypeChart typeDistribution={typeDistribution} chartType="pie" />,
    );

    const table = container.querySelector("table.sr-only");
    expect(table).not.toBeNull();
    expect(table).toHaveTextContent("Creature");
    expect(table).toHaveTextContent("Instant");
  });

  it("hides the decorative chart from assistive technology", () => {
    const { container } = render(
      <CardTypeChart typeDistribution={typeDistribution} chartType="bar" />,
    );
    expect(chartIsHiddenFromAT(container)).toBe(true);
  });

  it("shows an accessible empty state message when there are no cards", () => {
    const { container } = render(
      <CardTypeChart typeDistribution={{}} chartType="bar" />,
    );
    expect(container).toHaveTextContent(/No cards in deck/i);
    expect(container.querySelector("table.sr-only")).toBeNull();
  });
});

describe("DeckColorChart — screen-reader alternative", () => {
  const colorDistribution = { W: 5, U: 3, R: 12, Colorless: 8 };

  it("renders a visually-hidden data table mirroring the color distribution", () => {
    const { container } = render(
      <DeckColorChart colorDistribution={colorDistribution} />,
    );

    const table = container.querySelector("table.sr-only");
    expect(table).not.toBeNull();
    expect(table).toHaveTextContent(/Color distribution/i);
    expect(table).toHaveTextContent("Number of Cards");
    expect(table).toHaveTextContent("Percentage of Deck");
    // Resolved color names (not raw codes) are exposed to screen readers.
    expect(table).toHaveTextContent("White");
    expect(table).toHaveTextContent("Blue");
    expect(table).toHaveTextContent("Red");
    expect(table).toHaveTextContent("Colorless");
  });

  it("hides the decorative chart from assistive technology", () => {
    const { container } = render(
      <DeckColorChart colorDistribution={colorDistribution} />,
    );
    expect(chartIsHiddenFromAT(container)).toBe(true);
  });

  it("shows an accessible empty state message when there are no cards", () => {
    const { container } = render(<DeckColorChart colorDistribution={{}} />);
    expect(container).toHaveTextContent(/No cards in deck/i);
    expect(container.querySelector("table.sr-only")).toBeNull();
  });
});

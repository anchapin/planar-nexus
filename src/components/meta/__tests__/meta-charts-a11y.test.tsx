/**
 * @fileoverview Accessibility tests for meta-page chart components
 *
 * The four charts on the `/meta` analytics page are purely visual (recharts
 * SVG or a hand-rolled SVG gauge). These tests verify that each chart exposes
 * a screen-reader text alternative — either a visually-hidden `<table>` data
 * fallback mirroring the chart data, or a `role="img"` wrapper with an
 * `aria-label` and sr-only description — and that the decorative SVG itself
 * is hidden from assistive technology (issue #1388).
 *
 * Mirrors the convention established by `deck-statistics-charts.test.tsx`
 * (issue #934).
 */

import { describe, it, expect, jest } from "@jest/globals";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";

// Stub recharts so charts render without jsdom layout dependencies.
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: () => <div data-testid="pie" />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Cell: () => null,
  Legend: () => null,
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

import CardTrendChart from "@/components/meta/CardTrendChart";
import ArchetypeBalance from "@/components/meta/ArchetypeBalance";
import ColorDistributionChart from "@/components/meta/ColorDistributionChart";
import FormatHealthGauge from "@/components/meta/FormatHealthGauge";
import type {
  CardTrend,
  ColorDistribution,
  ArchetypeCategory,
} from "@/lib/meta";

function chartIsHiddenFromAT(container: HTMLElement): boolean {
  // The decorative SVG chart must live inside an aria-hidden wrapper.
  return container.querySelector('[aria-hidden="true"] [data-testid]') !== null;
}

describe("CardTrendChart — screen-reader alternative", () => {
  const data: CardTrend[] = [
    {
      cardName: "Lightning Bolt",
      data: [
        { week: "W1", inclusionRate: 85 },
        { week: "W2", inclusionRate: 90 },
      ],
    },
    {
      cardName: "Counterspell",
      data: [
        { week: "W1", inclusionRate: 60 },
        { week: "W2", inclusionRate: 72 },
      ],
    },
  ];

  it("renders a visually-hidden data table mirroring the inclusion rates", () => {
    const { container } = render(<CardTrendChart data={data} />);

    const table = container.querySelector("table.sr-only");
    expect(table).not.toBeNull();
    expect(table).toHaveTextContent(/card inclusion rate trend/i);
    // Series (card names) are exposed as column headers.
    expect(table).toHaveTextContent("Lightning Bolt");
    expect(table).toHaveTextContent("Counterspell");
    // Week buckets and rate values are present.
    expect(table).toHaveTextContent("W1");
    expect(table).toHaveTextContent("85.0%");
    expect(table).toHaveTextContent("72.0%");
  });

  it("hides the decorative line chart from assistive technology", () => {
    const { container } = render(<CardTrendChart data={data} />);
    expect(chartIsHiddenFromAT(container)).toBe(true);
  });
});

describe("ArchetypeBalance — screen-reader alternative", () => {
  const data: Record<ArchetypeCategory, number> = {
    aggro: 30,
    control: 25,
    midrange: 20,
    combo: 15,
    tempo: 10,
  };

  it("renders a visually-hidden data table mirroring the meta share", () => {
    const { container } = render(<ArchetypeBalance data={data} />);

    const table = container.querySelector("table.sr-only");
    expect(table).not.toBeNull();
    expect(table).toHaveTextContent(/archetype balance/i);
    expect(table).toHaveTextContent("Meta Share");
    expect(table).toHaveTextContent("Aggro");
    expect(table).toHaveTextContent("Control");
    expect(table).toHaveTextContent("30%");
  });

  it("hides the decorative bar chart from assistive technology", () => {
    const { container } = render(<ArchetypeBalance data={data} />);
    expect(chartIsHiddenFromAT(container)).toBe(true);
  });
});

describe("ColorDistributionChart — screen-reader alternative", () => {
  const data: ColorDistribution[] = [
    { color: "Red", percentage: 40, count: 12 },
    { color: "Blue", percentage: 35, count: 10 },
    { color: "Colorless", percentage: 25, count: 7 },
  ];

  it("renders a visually-hidden data table mirroring the color distribution", () => {
    const { container } = render(<ColorDistributionChart data={data} />);

    const table = container.querySelector("table.sr-only");
    expect(table).not.toBeNull();
    expect(table).toHaveTextContent(/color distribution/i);
    expect(table).toHaveTextContent("Percentage");
    expect(table).toHaveTextContent("Deck Count");
    expect(table).toHaveTextContent("Red");
    expect(table).toHaveTextContent("Blue");
    expect(table).toHaveTextContent("40.0%");
  });

  it("hides the decorative pie chart from assistive technology", () => {
    const { container } = render(<ColorDistributionChart data={data} />);
    expect(chartIsHiddenFromAT(container)).toBe(true);
  });
});

describe("FormatHealthGauge — screen-reader alternative", () => {
  it("exposes a role=img with an accessible name describing the score", () => {
    const { container } = render(<FormatHealthGauge score={82} />);

    const img = container.querySelector('[role="img"]');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/format health gauge/i),
    );
    expect(img).toHaveAttribute("aria-label", expect.stringContaining("82"));
    expect(img).toHaveAttribute(
      "aria-label",
      expect.stringContaining("healthy"),
    );
  });

  it("renders an sr-only description of the score", () => {
    const { container } = render(<FormatHealthGauge score={50} />);

    const desc = container.querySelector(".sr-only");
    expect(desc).not.toBeNull();
    expect(desc).toHaveTextContent(/format health score is 50/i);
    expect(desc).toHaveTextContent(/moderate/i);
  });

  it("hides the decorative gauge SVG from assistive technology", () => {
    const { container } = render(<FormatHealthGauge score={20} />);
    // The decorative SVG lives inside an aria-hidden wrapper.
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
  });
});

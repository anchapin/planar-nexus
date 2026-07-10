"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { CardTrend } from "@/lib/meta";

interface CardTrendChartProps {
  data: CardTrend[];
}

const CARD_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
  "#a855f7", // purple
  "#f97316", // orange
];

// Per-series dash patterns so each line is distinguishable in monochrome and
// forced-colors mode, not by color alone (WCAG 1.4.1 Use of Color).
const CARD_DASH_PATTERNS = [
  undefined, // solid
  "6 4", // dashed
  "2 3", // dotted
  "10 4 2 4", // dash-dot
  "8 2", // long dash
];

export default function CardTrendChart({ data }: CardTrendChartProps) {
  // Transform data for the chart
  const chartData =
    data[0]?.data.map((_, weekIndex) => {
      const point: Record<string, string | number> = {
        week: data[0].data[weekIndex].week,
      };
      data.forEach((cardTrend) => {
        point[cardTrend.cardName] =
          cardTrend.data[weekIndex]?.inclusionRate || 0;
      });
      return point;
    }) || [];

  return (
    <div>
      <div className="h-48" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
          >
            <XAxis
              dataKey="week"
              tick={{ fontSize: 10 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <YAxis
              domain={[50, 100]}
              tick={{ fontSize: 10 }}
              tickFormatter={(value) => `${value}%`}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
            />
            <Tooltip
              // recharts v3: formatter `value` is `ValueType | undefined`.
              formatter={(value, name) => [
                `${(typeof value === "number" ? value : Number(value ?? 0)).toFixed(1)}%`,
                name,
              ]}
              contentStyle={{
                backgroundColor: "var(--background)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Legend
              verticalAlign="top"
              height={20}
              formatter={(value) => (
                <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                  {value}
                </span>
              )}
            />
            {data.map((cardTrend, index) => (
              <Line
                key={cardTrend.cardName}
                type="monotone"
                dataKey={cardTrend.cardName}
                stroke={CARD_COLORS[index % CARD_COLORS.length]}
                strokeWidth={2}
                strokeDasharray={CARD_DASH_PATTERNS[index % CARD_DASH_PATTERNS.length]}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>
          Card inclusion rate trend: percentage of decks playing each card by
          week
        </caption>
        <thead>
          <tr>
            <th scope="col">Week</th>
            {data.map((cardTrend) => (
              <th key={cardTrend.cardName} scope="col">
                {cardTrend.cardName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chartData.map((point) => (
            <tr key={String(point.week)}>
              <th scope="row">{point.week}</th>
              {data.map((cardTrend) => (
                <td key={cardTrend.cardName}>
                  {(point[cardTrend.cardName] as number)?.toFixed(1)}%
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

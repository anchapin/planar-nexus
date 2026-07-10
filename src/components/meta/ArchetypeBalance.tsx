"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Cell,
} from "recharts";
import { ArchetypeCategory } from "@/lib/meta";

interface ArchetypeBalanceProps {
  data: Record<ArchetypeCategory, number>;
}

const ARCHETYPE_COLORS: Record<ArchetypeCategory, string> = {
  aggro: "#ef4444",
  control: "#3b82f6",
  midrange: "#22c55e",
  combo: "#a855f7",
  tempo: "#f97316",
};

export default function ArchetypeBalance({ data }: ArchetypeBalanceProps) {
  const chartData = Object.entries(data).map(([key, value]) => ({
    name: key.charAt(0).toUpperCase() + key.slice(1),
    value,
    color: ARCHETYPE_COLORS[key as ArchetypeCategory],
  }));

  return (
    <div>
      <div className="h-40" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 20, left: 0, bottom: 0 }}
          >
            <XAxis
              type="number"
              domain={[0, 40]}
              tick={{ fontSize: 10 }}
              tickFormatter={(value) => `${value}%`}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10 }}
              width={60}
            />
            <Tooltip
              // recharts v3: formatter `value` is `ValueType | undefined`.
              formatter={(value) => [
                `${typeof value === "number" ? value : Number(value ?? 0)}%`,
                "Meta Share",
              ]}
              contentStyle={{
                backgroundColor: "var(--background)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                fontSize: "12px",
              }}
            />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Archetype balance: share of the meta by archetype</caption>
        <thead>
          <tr>
            <th scope="col">Archetype</th>
            <th scope="col">Meta Share</th>
          </tr>
        </thead>
        <tbody>
          {chartData.map((entry) => (
            <tr key={entry.name}>
              <th scope="row">{entry.name}</th>
              <td>{entry.value}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

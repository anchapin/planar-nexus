'use client';

import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { CardTrend } from '@/lib/meta';

interface CardTrendChartProps {
  data: CardTrend[];
}

const CARD_COLORS = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#22c55e', // green
  '#a855f7', // purple
  '#f97316', // orange
];

export default function CardTrendChart({ data }: CardTrendChartProps) {
  // Transform data for the chart
  const chartData = data[0]?.data.map((_, weekIndex) => {
    const point: Record<string, string | number> = {
      week: data[0].data[weekIndex].week,
    };
    data.forEach((cardTrend) => {
      point[cardTrend.cardName] = cardTrend.data[weekIndex]?.inclusionRate || 0;
    });
    return point;
  }) || [];

  return (
    <div className="h-48">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <XAxis 
            dataKey="week" 
            tick={{ fontSize: 10 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <YAxis 
            domain={[50, 100]}
            tick={{ fontSize: 10 }}
            tickFormatter={(value) => `${value}%`}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
          />
          <Tooltip 
            formatter={(value: number, name: string) => [
              `${value.toFixed(1)}%`, 
              name
            ]}
            contentStyle={{
              backgroundColor: 'var(--background)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
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
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { ColorDistribution } from '@/lib/meta';

interface ColorDistributionChartProps {
  data: ColorDistribution[];
}

const COLOR_MAP: Record<string, string> = {
  'White': '#F8F6D8',
  'Blue': '#0E68AB',
  'Black': '#150B00',
  'Red': '#D3202A',
  'Green': '#00733E',
  'Multicolor': '#E6A138',
  'Colorless': '#9CA3A6',
};

export default function ColorDistributionChart({ data }: ColorDistributionChartProps) {
  const chartData = data.map(item => ({
    name: item.color,
    value: item.percentage,
    count: item.count,
  }));

  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={35}
            outerRadius={55}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={COLOR_MAP[entry.name] || '#9CA3A6'}
                stroke="none"
              />
            ))}
          </Pie>
          <Tooltip 
            formatter={(value: number) => [`${value.toFixed(1)}%`, 'Share']}
            contentStyle={{
              backgroundColor: 'var(--background)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          />
          <Legend 
            verticalAlign="bottom" 
            height={20}
            formatter={(value) => (
              <span className="text-xs text-muted-foreground">{value}</span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

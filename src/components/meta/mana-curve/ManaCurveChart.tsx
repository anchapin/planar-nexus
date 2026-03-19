"use client";

import React from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';
import { DeckManaCurve, StrategyCurveProfile } from '@/lib/mana-curve';

interface ManaCurveChartProps {
  deckCurve: DeckManaCurve;
  strategyProfile?: StrategyCurveProfile;
  showRecommendation?: boolean;
}

/**
 * Mana curve bar chart visualization
 */
export function ManaCurveChart({ 
  deckCurve, 
  strategyProfile,
  showRecommendation = true 
}: ManaCurveChartProps) {
  // Prepare data for chart
  const data = deckCurve.points
    .filter(p => p.cmc >= 1 && p.cmc <= 7)
    .map(point => {
      const ideal = strategyProfile?.idealDistribution.find(d => d.cmc === point.cmc);
      const totalNonLands = deckCurve.nonLands || 1;
      
      return {
        cmc: `CMC ${point.cmc}`,
        actual: point.count,
        ideal: ideal ? Math.round((ideal.count / 20) * totalNonLands) : 0,
      };
    });

  // Add land data at CMC 0
  const chartData = [
    { cmc: 'Lands', actual: deckCurve.lands, ideal: 0 },
    ...data,
  ];

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-background border rounded-lg p-3 shadow-lg">
          <p className="font-medium mb-1">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              {entry.name}: {entry.value} cards
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={chartData}
        margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
        <XAxis 
          dataKey="cmc" 
          tick={{ fontSize: 12 }}
          tickLine={false}
        />
        <YAxis 
          tick={{ fontSize: 12 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Bar 
          dataKey="actual" 
          name="Your Deck" 
          fill="#3b82f6" 
          radius={[4, 4, 0, 0]}
          maxBarSize={50}
        />
        {showRecommendation && strategyProfile && (
          <Bar 
            dataKey="ideal" 
            name="Recommended" 
            fill="#22c55e" 
            fillOpacity={0.5}
            radius={[4, 4, 0, 0]}
            maxBarSize={50}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}

export default ManaCurveChart;

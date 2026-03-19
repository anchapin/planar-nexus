'use client';

import { TrendData } from '@/lib/meta';
import TrendIndicator from './TrendIndicator';

interface ArchetypeTrendsProps {
  rising: TrendData[];
  declining: TrendData[];
}

export default function ArchetypeTrends({ rising, declining }: ArchetypeTrendsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Rising Archetypes */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-medium text-green-500">
          <span className="size-2 rounded-full bg-green-500" />
          Rising Archetypes
        </h4>
        <div className="space-y-2">
          {rising.length > 0 ? (
            rising.map((trend) => (
              <div 
                key={trend.archetypeId}
                className="flex items-center justify-between rounded-lg border border-green-500/20 bg-green-500/5 p-2"
              >
                <span className="truncate text-sm">{trend.archetypeName}</span>
                <TrendIndicator direction={trend.direction} change={trend.change} size="sm" />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No rising archetypes</p>
          )}
        </div>
      </div>

      {/* Declining Archetypes */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-medium text-red-500">
          <span className="size-2 rounded-full bg-red-500" />
          Declining Archetypes
        </h4>
        <div className="space-y-2">
          {declining.length > 0 ? (
            declining.map((trend) => (
              <div 
                key={trend.archetypeId}
                className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 p-2"
              >
                <span className="truncate text-sm">{trend.archetypeName}</span>
                <TrendIndicator direction={trend.direction} change={trend.change} size="sm" />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No declining archetypes</p>
          )}
        </div>
      </div>
    </div>
  );
}

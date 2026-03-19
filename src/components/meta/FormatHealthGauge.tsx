'use client';

import { cn } from '@/lib/utils';

interface FormatHealthGaugeProps {
  score: number;
}

export default function FormatHealthGauge({ score }: FormatHealthGaugeProps) {
  const getScoreColor = (score: number) => {
    if (score >= 70) return 'text-green-500';
    if (score >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getArcColor = (score: number) => {
    if (score >= 70) return '#22c55e';
    if (score >= 40) return '#eab308';
    return '#ef4444';
  };

  const getHealthLabel = (score: number) => {
    if (score >= 70) return 'Healthy';
    if (score >= 40) return 'Moderate';
    return 'Unhealthy';
  };

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const strokeDashoffset = circumference - progress;

  return (
    <div className="flex flex-col items-center">
      <div className="relative size-32">
        <svg className="size-full -rotate-90" viewBox="0 0 100 100">
          {/* Background circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-secondary"
          />
          {/* Progress circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={getArcColor(score)}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        {/* Score text in center */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-3xl font-bold', getScoreColor(score))}>
            {score}
          </span>
          <span className="text-xs text-muted-foreground">/ 100</span>
        </div>
      </div>
      <div className="mt-2 text-center">
        <span className={cn('font-medium', getScoreColor(score))}>
          {getHealthLabel(score)}
        </span>
        <p className="text-xs text-muted-foreground">Format Health Score</p>
      </div>
    </div>
  );
}

'use client';

import { TrendDirection } from '@/lib/meta';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrendIndicatorProps {
  direction: TrendDirection;
  change: number;
  size?: 'sm' | 'md' | 'lg';
}

export default function TrendIndicator({ direction, change, size = 'md' }: TrendIndicatorProps) {
  const getIcon = () => {
    switch (direction) {
      case 'rising':
        return <TrendingUp className={cn(iconSizes[size], 'text-green-500')} />;
      case 'declining':
        return <TrendingDown className={cn(iconSizes[size], 'text-red-500')} />;
      case 'stable':
        return <Minus className={cn(iconSizes[size], 'text-gray-400')} />;
    }
  };

  const getColor = () => {
    switch (direction) {
      case 'rising':
        return 'text-green-500';
      case 'declining':
        return 'text-red-500';
      case 'stable':
        return 'text-gray-400';
    }
  };

  const iconSizes = {
    sm: 'size-3',
    md: 'size-4',
    lg: 'size-5',
  };

  const textSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base',
  };

  return (
    <div className={cn('flex items-center gap-1', textSizes[size])}>
      {getIcon()}
      <span className={cn('font-medium', getColor())}>
        {change >= 0 ? '+' : ''}{change.toFixed(1)}%
      </span>
    </div>
  );
}

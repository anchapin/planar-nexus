'use client';

import { Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TimerColorState } from '@/hooks/use-draft-timer';

/**
 * Draft timer color configuration
 */
const TIMER_COLORS = {
  green: {
    border: 'border-green-500',
    text: 'text-green-500',
    bg: 'bg-green-500',
    pulse: false,
  },
  yellow: {
    border: 'border-yellow-500',
    text: 'text-yellow-500',
    bg: 'bg-yellow-500',
    pulse: true,
  },
  red: {
    border: 'border-red-500',
    text: 'text-red-500',
    bg: 'bg-red-500',
    pulse: true,
  },
} as const;

/**
 * Props for DraftTimer component
 */
export interface DraftTimerProps {
  /** Time remaining in seconds */
  timeRemaining: number;
  /** Current color state for visual feedback */
  colorState: TimerColorState;
  /** Maximum seconds (for progress bar calculation) */
  maxSeconds?: number;
  /** Whether the timer is paused */
  isPaused?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Format seconds as MM:SS
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Draft Timer Component
 * 
 * DRFT-06: Displays countdown from 45 seconds per pick
 * DRFT-07: Visual warnings with color states (green → yellow → red)
 * 
 * Features:
 * - Large timer display showing MM:SS
 * - Progress bar showing time remaining
 * - Color-coded border and text based on time state
 * - Pulsing animation when in warning/critical state
 */
export function DraftTimer({
  timeRemaining,
  colorState,
  maxSeconds = 45,
  isPaused = false,
  className,
}: DraftTimerProps) {
  const colors = TIMER_COLORS[colorState];
  const progress = (timeRemaining / maxSeconds) * 100;

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-colors',
        colors.border,
        isPaused && 'opacity-60',
        className
      )}
      role="timer"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`Draft timer: ${formatTime(timeRemaining)} remaining, ${colorState} state`}
    >
      {/* Clock icon with color */}
      <Clock
        className={cn(
          'w-6 h-6 flex-shrink-0',
          colors.text,
          colors.pulse && 'animate-pulse'
        )}
        aria-hidden="true"
      />

      {/* Timer display */}
      <span
        className={cn(
          'text-3xl font-mono font-bold min-w-[80px]',
          colors.text,
          colors.pulse && 'animate-pulse'
        )}
      >
        {formatTime(timeRemaining)}
      </span>

      {/* Progress bar */}
      <div className="flex-1 h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full transition-all duration-1000 ease-linear',
            colors.bg
          )}
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuenow={timeRemaining}
          aria-valuemin={0}
          aria-valuemax={maxSeconds}
        />
      </div>

      {/* Warning indicator when in critical state */}
      {colorState === 'red' && (
        <AlertTriangle
          className={cn('w-5 h-5 flex-shrink-0', colors.text, 'animate-pulse')}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/**
 * Compact Draft Timer for smaller spaces
 * Shows just the time with a mini progress bar
 */
export interface CompactDraftTimerProps {
  /** Time remaining in seconds */
  timeRemaining: number;
  /** Current color state */
  colorState: TimerColorState;
  /** Maximum seconds */
  maxSeconds?: number;
  /** Additional CSS classes */
  className?: string;
}

export function CompactDraftTimer({
  timeRemaining,
  colorState,
  maxSeconds = 45,
  className,
}: CompactDraftTimerProps) {
  const colors = TIMER_COLORS[colorState];
  const progress = (timeRemaining / maxSeconds) * 100;

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Clock
        className={cn(
          'w-4 h-4 flex-shrink-0',
          colors.text,
          colors.pulse && 'animate-pulse'
        )}
        aria-hidden="true"
      />
      <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            'h-full transition-all duration-1000 ease-linear',
            colors.bg
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span
        className={cn(
          'text-sm font-mono min-w-[40px]',
          colors.text,
          colors.pulse && 'animate-pulse'
        )}
      >
        {formatTime(timeRemaining)}
      </span>
    </div>
  );
}

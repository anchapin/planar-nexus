'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Clock, AlertTriangle, Play, Pause, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TimerState = 'idle' | 'running' | 'paused' | 'warning' | 'expired';

interface TurnTimerProps {
  totalSeconds: number; // Total time for the turn in seconds
  onExpire?: () => void;
  onStateChange?: (state: TimerState) => void;
  autoStart?: boolean;
  isCurrentPlayer?: boolean;
  showControls?: boolean;
  className?: string;
}

export function TurnTimer({
  totalSeconds,
  onExpire,
  onStateChange,
  autoStart = false,
  isCurrentPlayer = false,
  showControls = true,
  className,
}: TurnTimerProps) {
  const [timeRemaining, setTimeRemaining] = useState(totalSeconds);
  const [timerState, setTimerState] = useState<TimerState>(
    autoStart && isCurrentPlayer ? 'running' : 'idle'
  );

  // Warning threshold (last 30 seconds)
  const warningThreshold = 30;

  // Update timer state based on time remaining
  useEffect(() => {
    let newState: TimerState = timerState;

    if (timeRemaining <= 0) {
      newState = 'expired';
      onExpire?.();
    } else if (timeRemaining <= warningThreshold && timerState === 'running') {
      newState = 'warning';
    } else if (timeRemaining > warningThreshold && timerState === 'warning') {
      newState = 'running';
    }

    if (newState !== timerState) {
      setTimerState(newState);
      onStateChange?.(newState);
    }
  }, [timeRemaining, timerState, onExpire, onStateChange, warningThreshold]);

  // Countdown effect
  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (timerState === 'running' && timeRemaining > 0) {
      interval = setInterval(() => {
        setTimeRemaining((prev) => Math.max(0, prev - 1));
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [timerState, timeRemaining]);

  const handleStart = useCallback(() => {
    if (timeRemaining > 0) {
      setTimerState('running');
      onStateChange?.('running');
    }
  }, [timeRemaining, onStateChange]);

  const handlePause = useCallback(() => {
    setTimerState('paused');
    onStateChange?.('paused');
  }, [onStateChange]);

  const handleReset = useCallback(() => {
    setTimeRemaining(totalSeconds);
    setTimerState('idle');
    onStateChange?.('idle');
  }, [totalSeconds, onStateChange]);

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate progress percentage
  const progress = (timeRemaining / totalSeconds) * 100;

  // Determine color based on state
  const getProgressColor = () => {
    switch (timerState) {
      case 'warning':
        return 'bg-yellow-500';
      case 'expired':
        return 'bg-red-500';
      default:
        return 'bg-primary';
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {/* Timer display */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2 rounded-lg border',
          timerState === 'warning' && 'bg-yellow-500/10 border-yellow-500/50',
          timerState === 'expired' && 'bg-red-500/10 border-red-500/50',
          timerState === 'running' && 'bg-primary/5'
        )}
      >
        <div className="flex items-center gap-2">
          <Clock
            className={cn(
              'w-4 h-4',
              timerState === 'warning' && 'text-yellow-500 animate-pulse',
              timerState === 'expired' && 'text-red-500'
            )}
          />
          <span className="text-sm font-medium">
            {timerState === 'expired' ? 'Time!' : formatTime(timeRemaining)}
          </span>
        </div>

        {/* Controls */}
        {showControls && (
          <div className="flex items-center gap-1">
            {timerState === 'idle' || timerState === 'paused' ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleStart}
                disabled={timeRemaining === 0}
              >
                <Play className="w-3 h-3" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handlePause}
              >
                <Pause className="w-3 h-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={handleReset}
            >
              <RotateCcw className="w-3 h-3" />
            </Button>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <Progress
        value={progress}
        className="h-2"
      />

      {/* Warning indicator */}
      {timerState === 'warning' && (
        <div className="flex items-center gap-1 text-xs text-yellow-500 animate-pulse">
          <AlertTriangle className="w-3 h-3" />
          <span>Less than {warningThreshold} seconds!</span>
        </div>
      )}
    </div>
  );
}

// Compact timer for smaller spaces
interface CompactTimerProps {
  totalSeconds: number;
  timeRemaining: number;
  timerState: TimerState;
  className?: string;
}

export function CompactTimer({
  totalSeconds,
  timeRemaining,
  timerState,
  className,
}: CompactTimerProps) {
  const progress = (timeRemaining / totalSeconds) * 100;

  const getColor = () => {
    switch (timerState) {
      case 'warning':
        return 'text-yellow-500';
      case 'expired':
        return 'text-red-500';
      default:
        return 'text-foreground';
    }
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Clock className={cn('w-3 h-3', getColor())} />
      <Progress
        value={progress}
        className="w-16 h-1.5"
      />
      <span className={cn('text-xs font-mono min-w-[35px]', getColor())}>
        {Math.floor(timeRemaining / 60)}:{(
          timeRemaining % 60
        ).toString()
          .padStart(2, '0')}
      </span>
    </div>
  );
}

// Timer configuration component for lobby settings
interface TimerConfigProps {
  enabled: boolean;
  minutes: number;
  onEnabledChange: (enabled: boolean) => void;
  onMinutesChange: (minutes: number) => void;
  className?: string;
}

export function TimerConfig({
  enabled,
  minutes,
  onEnabledChange,
  onMinutesChange,
  className,
}: TimerConfigProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4" />
          <span className="text-sm font-medium">Turn Timer</span>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="toggle"
        />
      </div>

      {enabled && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">Minutes per turn:</label>
          <input
            type="number"
            min={1}
            max={60}
            value={minutes}
            onChange={(e) => onMinutesChange(parseInt(e.target.value) || 30)}
            className="w-16 px-2 py-1 text-sm border rounded"
          />
        </div>
      )}
    </div>
  );
}

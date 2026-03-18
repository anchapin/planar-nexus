'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTurnTimer } from './use-turn-timer';
import type { TimerState } from '@/components/turn-timer';

/**
 * Draft timer configuration
 * DRFT-06: 45 second default per pick
 * DRFT-07: Visual warning thresholds
 */
export const DRAFT_TIMER_CONFIG = {
  /** DRFT-06: Default time per pick */
  defaultSeconds: 45,
  /** DRFT-07: Yellow warning when <= 15 seconds */
  warningThreshold: 15,
  /** DRFT-07: Red critical when <= 5 seconds */
  criticalThreshold: 5,
} as const;

/**
 * Timer color state for visual feedback
 * DRFT-07: green → yellow → red progression
 */
export type TimerColorState = 'green' | 'yellow' | 'red';

/**
 * Get color state based on time remaining
 * DRFT-07: Visual warnings at thresholds
 */
function getColorState(seconds: number): TimerColorState {
  if (seconds <= DRAFT_TIMER_CONFIG.criticalThreshold) return 'red';
  if (seconds <= DRAFT_TIMER_CONFIG.warningThreshold) return 'yellow';
  return 'green';
}

/**
 * Options for useDraftTimer hook
 */
export interface UseDraftTimerOptions {
  /** Initial time in seconds (default: 45) */
  initialSeconds?: number;
  /** Auto-start timer on mount */
  autoStart?: boolean;
  /** Called when timer expires */
  onExpire: () => void;
  /** ID of the last card hovered by user (DRFT-08) */
  lastHoveredCardId: string | null;
  /** Called when auto-picking a card (DRFT-08) */
  onPickCard?: (cardId: string) => void;
  /** Called when showing skip dialog (DRFT-08) */
  onShowSkipDialog?: () => void;
}

/**
 * Return type for useDraftTimer hook
 */
export interface UseDraftTimerReturn {
  /** Remaining time in seconds */
  timeRemaining: number;
  /** Current color state for visual feedback */
  colorState: TimerColorState;
  /** Whether timer is currently running */
  isRunning: boolean;
  /** Start the timer */
  start: () => void;
  /** Pause the timer */
  pause: () => void;
  /** Reset timer to initial value */
  reset: () => void;
  /** Handle timer expiration - auto-pick or show skip dialog (DRFT-08) */
  handleExpire: () => void;
  /** Current last hovered card ID */
  lastHoveredCardId: string | null;
}

/**
 * Hook for managing draft timer with color states and auto-pick
 * 
 * DRFT-06: Counts down from 45 seconds per pick
 * DRFT-07: Shows color warnings (green >15s, yellow 5-15s, red ≤5s)
 * DRFT-08: Auto-picks last hovered card or shows skip dialog on expire
 */
export function useDraftTimer(options: UseDraftTimerOptions): UseDraftTimerReturn {
  const {
    initialSeconds = DRAFT_TIMER_CONFIG.defaultSeconds,
    autoStart = false,
    onExpire,
    lastHoveredCardId,
    onPickCard,
    onShowSkipDialog,
  } = options;

  const [timeRemaining, setTimeRemaining] = useState(initialSeconds);
  const [colorState, setColorState] = useState<TimerColorState>(() => getColorState(initialSeconds));
  const [isRunning, setIsRunning] = useState(false);

  // Keep callbacks ref updated
  const onExpireRef = useRef(onExpire);
  const onPickCardRef = useRef(onPickCard);
  const onShowSkipDialogRef = useRef(onShowSkipDialog);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    onPickCardRef.current = onPickCard;
  }, [onPickCard]);

  useEffect(() => {
    onShowSkipDialogRef.current = onShowSkipDialog;
  }, [onShowSkipDialog]);

  // Update color state based on time remaining
  useEffect(() => {
    setColorState(getColorState(timeRemaining));
  }, [timeRemaining]);

  // Countdown effect
  useEffect(() => {
    if (!isRunning || timeRemaining <= 0) return;

    const interval = setInterval(() => {
      setTimeRemaining((prev) => {
        const newTime = Math.max(0, prev - 1);
        
        if (newTime === 0) {
          // Timer expired - call handleExpire logic
          setIsRunning(false);
          // The handleExpire function will be called by the component
        }
        
        return newTime;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, timeRemaining]);

  // Auto-expire when time hits 0
  useEffect(() => {
    if (timeRemaining === 0 && isRunning) {
      setIsRunning(false);
      onExpireRef.current?.();
    }
  }, [timeRemaining, isRunning]);

  /**
   * Start the timer
   */
  const start = useCallback(() => {
    if (timeRemaining > 0) {
      setIsRunning(true);
    }
  }, [timeRemaining]);

  /**
   * Pause the timer
   */
  const pause = useCallback(() => {
    setIsRunning(false);
  }, []);

  /**
   * Reset timer to initial value
   */
  const reset = useCallback(() => {
    setTimeRemaining(initialSeconds);
    setColorState(getColorState(initialSeconds));
    setIsRunning(false);
  }, [initialSeconds]);

  /**
   * Handle timer expiration - auto-pick or show skip dialog
   * DRFT-08: Auto-pick last hovered card, or prompt skip
   */
  const handleExpire = useCallback(() => {
    if (lastHoveredCardId && onPickCardRef.current) {
      // Auto-pick the hovered card
      onPickCardRef.current(lastHoveredCardId);
    } else if (onShowSkipDialogRef.current) {
      // Show skip confirmation dialog
      onShowSkipDialogRef.current();
    }
  }, [lastHoveredCardId]);

  return {
    timeRemaining,
    colorState,
    isRunning,
    start,
    pause,
    reset,
    handleExpire,
    lastHoveredCardId,
  };
}

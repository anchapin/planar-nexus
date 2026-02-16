'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type RoundTimerState = 'idle' | 'running' | 'paused' | 'warning' | 'overtime' | 'expired';

export interface RoundTimerConfig {
  roundDurationMinutes: number;  // Total round time in minutes
  turnDurationSeconds: number;   // Time per turn in seconds
  warningThresholdSeconds: number; // When to show warnings
  overtimeDurationSeconds: number; // Overtime per player
  maxExtensions: number;          // Max number of time extensions
  extensionDurationSeconds: number; // Duration of each extension
}

export interface RoundTimerStatus {
  roundState: RoundTimerState;
  roundTimeRemaining: number;    // Total round time remaining in seconds
  turnTimeRemaining: number;      // Current turn time remaining in seconds
  currentTurn: number;
  totalTurns: number;
  extensionsUsed: number;
  isPlayerTurn: boolean;
}

interface UseRoundTimerOptions {
  config: RoundTimerConfig;
  isPlayerTurn: boolean;
  totalTurns: number;
  onRoundExpire?: () => void;
  onTurnExpire?: () => void;
  onWarning?: () => void;
}

interface UseRoundTimerReturn {
  status: RoundTimerStatus;
  startRound: () => void;
  pauseRound: () => void;
  resumeRound: () => void;
  endTurn: () => void;
  useExtension: () => boolean;
  requestExtension: () => void;
  canUseExtension: boolean;
  addTime: (seconds: number) => void;
}

const DEFAULT_CONFIG: RoundTimerConfig = {
  roundDurationMinutes: 50,     // Standard tournament round
  turnDurationSeconds: 60,     // 1 minute per turn
  warningThresholdSeconds: 30, // Warning at 30 seconds
  overtimeDurationSeconds: 300, // 5 minutes overtime
  maxExtensions: 2,             // 2 time extensions
  extensionDurationSeconds: 120, // 2 minutes per extension
};

export function useRoundTimer({
  config = DEFAULT_CONFIG,
  isPlayerTurn,
  totalTurns,
  onRoundExpire,
  onTurnExpire,
  onWarning,
}: UseRoundTimerOptions): UseRoundTimerReturn {
  const [roundState, setRoundState] = useState<RoundTimerState>('idle');
  const [roundTimeRemaining, setRoundTimeRemaining] = useState(
    config.roundDurationMinutes * 60
  );
  const [turnTimeRemaining, setTurnTimeRemaining] = useState(config.turnDurationSeconds);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [extensionsUsed, setExtensionsUsed] = useState(0);
  const [extensionRequested, setExtensionRequested] = useState(false);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const onRoundExpireRef = useRef(onRoundExpire);
  const onTurnExpireRef = useRef(onTurnExpire);
  const onWarningRef = useRef(onWarning);

  // Update refs when callbacks change
  useEffect(() => {
    onRoundExpireRef.current = onRoundExpire;
    onTurnExpireRef.current = onTurnExpire;
    onWarningRef.current = onWarning;
  }, [onRoundExpire, onTurnExpire, onWarning]);

  // Main timer effect
  useEffect(() => {
    if (roundState !== 'running') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      // Update round time
      setRoundTimeRemaining((prev) => {
        const newTime = prev - 1;
        
        if (newTime <= 0) {
          setRoundState('expired');
          onRoundExpireRef.current?.();
          return 0;
        }
        
        // Check for warning state
        if (newTime <= config.warningThresholdSeconds && roundState !== 'warning') {
          setRoundState('warning');
          onWarningRef.current?.();
        }
        
        return newTime;
      });

      // Update turn time only if it's player's turn
      if (isPlayerTurn) {
        setTurnTimeRemaining((prev) => {
          const newTime = prev - 1;
          
          if (newTime <= 0) {
            onTurnExpireRef.current?.();
            return 0;
          }
          
          return newTime;
        });
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [roundState, isPlayerTurn, config.warningThresholdSeconds]);

  const startRound = useCallback(() => {
    setRoundState('running');
    setRoundTimeRemaining(config.roundDurationMinutes * 60);
    setTurnTimeRemaining(config.turnDurationSeconds);
    setCurrentTurn(1);
    setExtensionsUsed(0);
    setExtensionRequested(false);
  }, [config]);

  const pauseRound = useCallback(() => {
    if (roundState === 'running') {
      setRoundState('paused');
    }
  }, [roundState]);

  const resumeRound = useCallback(() => {
    if (roundState === 'paused') {
      setRoundState('running');
    }
  }, [roundState]);

  const endTurn = useCallback(() => {
    setTurnTimeRemaining(config.turnDurationSeconds);
    setCurrentTurn((prev) => prev + 1);
    setExtensionRequested(false);
  }, [config.turnDurationSeconds]);

  const useExtension = useCallback(() => {
    if (extensionsUsed >= config.maxExtensions) {
      return false;
    }
    
    setExtensionsUsed((prev) => prev + 1);
    setTurnTimeRemaining((prev) => prev + config.extensionDurationSeconds);
    setRoundTimeRemaining((prev) => prev + config.extensionDurationSeconds);
    setExtensionRequested(false);
    return true;
  }, [extensionsUsed, config.maxExtensions, config.extensionDurationSeconds]);

  const requestExtension = useCallback(() => {
    if (extensionsUsed < config.maxExtensions && !extensionRequested) {
      setExtensionRequested(true);
    }
  }, [extensionsUsed, config.maxExtensions, extensionRequested]);

  const addTime = useCallback((seconds: number) => {
    setRoundTimeRemaining((prev) => prev + seconds);
    if (isPlayerTurn) {
      setTurnTimeRemaining((prev) => prev + seconds);
    }
  }, [isPlayerTurn]);

  const canUseExtension = extensionsUsed < config.maxExtensions && !extensionRequested;

  // Determine overall state for display
  const getDisplayState = (): RoundTimerState => {
    if (roundTimeRemaining <= 0) return 'expired';
    if (roundTimeRemaining <= config.warningThresholdSeconds) return 'warning';
    if (extensionRequested) return 'overtime';
    return roundState;
  };

  const status: RoundTimerStatus = {
    roundState: getDisplayState(),
    roundTimeRemaining,
    turnTimeRemaining: isPlayerTurn ? turnTimeRemaining : config.turnDurationSeconds,
    currentTurn,
    totalTurns,
    extensionsUsed,
    isPlayerTurn,
  };

  return {
    status,
    startRound,
    pauseRound,
    resumeRound,
    endTurn,
    useExtension,
    requestExtension,
    canUseExtension,
    addTime,
  };
}

// Format seconds to MM:SS
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Format seconds to H:MM:SS for longer durations
export function formatLongTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

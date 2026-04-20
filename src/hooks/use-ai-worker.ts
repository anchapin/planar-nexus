'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { aiWorkerClient } from '@/ai/worker/ai-worker-client';
import type { AnalyzeStatePayload } from '@/ai/worker/worker-types';
import type { DetailedEvaluation } from '@/ai/game-state-evaluator';

/**
 * Hook to interact with the AI Worker reactively.
 * 
 * Manages thinking state, result storage, and request cancellation.
 */
export function useAIWorker() {
  const [isThinking, setIsThinking] = useState(false);
  const [lastResult, setLastResult] = useState<DetailedEvaluation | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep track of the current request ID to handle cancellation/stale results
  const currentRequestId = useRef<number>(0);

  /**
   * Cleans up the worker on unmount.
   */
  useEffect(() => {
    return () => {
      // In a real app, we might not want to terminate the singleton 
      // but rather just ignore pending results.
      currentRequestId.current += 1;
    };
  }, []);

  /**
   * Analyzes the given game state using the AI Worker.
   */
  const analyzeState = useCallback(async (payload: AnalyzeStatePayload) => {
    const requestId = ++currentRequestId.current;
    
    setIsThinking(true);
    setError(null);

    try {
      const api = aiWorkerClient.api;
      if (!api) {
        throw new Error('AI Worker API not initialized');
      }

      const result = await api.analyzeGameState(payload);

      // Only update state if this is still the most recent request
      if (requestId === currentRequestId.current) {
        setLastResult(result);
        setIsThinking(false);
        return result;
      }
    } catch (err) {
      if (requestId === currentRequestId.current) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown AI error';
        setError(errorMessage);
        setIsThinking(false);
      }
    }
    
    return null;
  }, []);

  /**
   * Resets the hook state.
   */
  const reset = useCallback(() => {
    currentRequestId.current += 1;
    setIsThinking(false);
    setLastResult(null);
    setError(null);
  }, []);

  return {
    isThinking,
    lastResult,
    error,
    analyzeState,
    reset,
  };
}

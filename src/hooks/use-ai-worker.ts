'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { AnalyzeStatePayload } from '@/ai/worker/worker-types';
import type { DetailedEvaluation } from '@/ai/game-state-evaluator';

/**
 * The worker bridge is only needed once a caller actually asks the worker for
 * an evaluation, so it is imported on demand (issue #2946). Importing it
 * lazily keeps the worker client — and the Comlink RPC bridge it pulls in —
 * out of the route's first-load payload. The module is a singleton, so the
 * promise is cached and the worker is still created only once, on first use.
 */
type AIWorkerClientModule = typeof import('@/ai/worker/ai-worker-client');

let aiWorkerClientModule: Promise<AIWorkerClientModule> | null = null;

function loadAIWorkerClient(): Promise<AIWorkerClientModule> {
  if (!aiWorkerClientModule) {
    aiWorkerClientModule = import('@/ai/worker/ai-worker-client');
  }
  return aiWorkerClientModule;
}

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
      // Loaded on demand so the worker client stays out of the first-load
      // payload; the worker itself is still created lazily on first use.
      const { aiWorkerClient } = await loadAIWorkerClient();
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

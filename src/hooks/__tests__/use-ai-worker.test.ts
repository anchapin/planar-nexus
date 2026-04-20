import { renderHook, act } from '@testing-library/react';
import { useAIWorker } from '../use-ai-worker';
import { aiWorkerClient } from '@/ai/worker/ai-worker-client';

// Mock the AI Worker Client
jest.mock('@/ai/worker/ai-worker-client', () => ({
  aiWorkerClient: {
    api: {
      analyzeGameState: jest.fn(),
      evaluateBoard: jest.fn(),
      quickScore: jest.fn(),
      detectArchetype: jest.fn(),
    },
  },
}));

describe('useAIWorker hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useAIWorker());
    expect(result.current.isThinking).toBe(false);
    expect(result.current.lastResult).toBe(null);
    expect(result.current.error).toBe(null);
  });

  it('updates state during and after analysis', async () => {
    const mockResult = { score: 0.75, summary: 'Good state', factors: [] };
    (aiWorkerClient.api!.analyzeGameState as unknown as jest.Mock).mockResolvedValue(mockResult);

    const { result } = renderHook(() => useAIWorker());
    
    let analysisPromise: Promise<any>;
    await act(async () => {
      analysisPromise = result.current.analyzeState({
        gameState: {} as any,
        playerId: 'player1'
      });
    });

    // Wait for the result
    const finalResult = await analysisPromise!;

    expect(result.current.isThinking).toBe(false);
    expect(result.current.lastResult).toEqual(mockResult);
    expect(finalResult).toEqual(mockResult);
    expect(aiWorkerClient.api!.analyzeGameState).toHaveBeenCalledTimes(1);
  });

  it('handles errors from the worker', async () => {
    (aiWorkerClient.api!.analyzeGameState as unknown as jest.Mock).mockRejectedValue(new Error('Worker error'));

    const { result } = renderHook(() => useAIWorker());
    
    await act(async () => {
      await result.current.analyzeState({
        gameState: {} as any,
        playerId: 'player1'
      });
    });

    expect(result.current.isThinking).toBe(false);
    expect(result.current.error).toBe('Worker error');
    expect(result.current.lastResult).toBe(null);
  });

  it('handles stale results through cancellation mechanism', async () => {
    // This test simulates multiple overlapping calls
    let resolve1: (value: any) => void;
    const promise1 = new Promise((resolve) => { resolve1 = resolve; });
    const mockResult1 = { score: 0.1 };
    const mockResult2 = { score: 0.9 };

    (aiWorkerClient.api!.analyzeGameState as unknown as jest.Mock)
      .mockReturnValueOnce(promise1)
      .mockResolvedValueOnce(mockResult2);

    const { result } = renderHook(() => useAIWorker());
    
    // First call (slow)
    act(() => {
      result.current.analyzeState({ gameState: {} as any, playerId: 'player1' });
    });

    // Second call (fast)
    await act(async () => {
      await result.current.analyzeState({ gameState: {} as any, playerId: 'player1' });
    });

    expect(result.current.lastResult).toEqual(mockResult2);

    // Resolve the first call
    await act(async () => {
      resolve1!(mockResult1);
    });

    // The result should still be mockResult2, as mockResult1 was from a stale request
    expect(result.current.lastResult).toEqual(mockResult2);
    expect(aiWorkerClient.api!.analyzeGameState).toHaveBeenCalledTimes(2);
  });

  it('resets the hook state', async () => {
    const mockResult = { score: 0.75 };
    (aiWorkerClient.api!.analyzeGameState as unknown as jest.Mock).mockResolvedValue(mockResult);

    const { result } = renderHook(() => useAIWorker());
    
    await act(async () => {
      await result.current.analyzeState({ gameState: {} as any, playerId: 'player1' });
    });

    expect(result.current.lastResult).toEqual(mockResult);

    act(() => {
      result.current.reset();
    });

    expect(result.current.lastResult).toBe(null);
    expect(result.current.isThinking).toBe(false);
    expect(result.current.error).toBe(null);
  });
});

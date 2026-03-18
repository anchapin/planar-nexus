/**
 * Test scaffold for draft timer hook
 * 
 * Phase 15-03: Draft Timer with Color States
 * Requirements: DRFT-06, DRFT-07, DRFT-08
 * 
 * DRFT-06: Draft timer counts down per pick (default 45s)
 * DRFT-07: Timer visual warnings green → yellow → red
 * DRFT-08: Timer expiration auto-picks last hovered card or skip
 */

import { renderHook, act } from '@testing-library/react';
import { useDraftTimer, DRAFT_TIMER_CONFIG, TimerColorState } from '../use-draft-timer';

// Mock useTurnTimer to isolate draft timer logic
jest.mock('../use-turn-timer', () => ({
  useTurnTimer: jest.fn(() => ({
    timeRemaining: 45,
    timerState: 'idle',
    start: jest.fn(),
    pause: jest.fn(),
    reset: jest.fn(),
    addTime: jest.fn(),
  })),
}));

describe('DRFT-06: Draft timer countdown', () => {
  describe('DRAFT_TIMER_CONFIG', () => {
    it('should have default of 45 seconds', () => {
      expect(DRAFT_TIMER_CONFIG.defaultSeconds).toBe(45);
    });

    it('should have warning threshold of 15 seconds', () => {
      expect(DRAFT_TIMER_CONFIG.warningThreshold).toBe(15);
    });

    it('should have critical threshold of 5 seconds', () => {
      expect(DRAFT_TIMER_CONFIG.criticalThreshold).toBe(5);
    });
  });

  describe('useDraftTimer', () => {
    it('should initialize with default 45 seconds', () => {
      const mockOnExpire = jest.fn();
      const { result } = renderHook(() => useDraftTimer({
        onExpire: mockOnExpire,
        lastHoveredCardId: null,
      }));

      expect(result.current.timeRemaining).toBe(45);
    });

    it('should accept custom initial seconds', () => {
      const mockOnExpire = jest.fn();
      const { result } = renderHook(() => useDraftTimer({
        initialSeconds: 30,
        onExpire: mockOnExpire,
        lastHoveredCardId: null,
      }));

      expect(result.current.timeRemaining).toBe(30);
    });
  });
});

describe('DRFT-07: Timer color states', () => {
  describe('TimerColorState type', () => {
    it('should be one of green, yellow, or red', () => {
      const states: TimerColorState[] = ['green', 'yellow', 'red'];
      expect(states).toContain('green');
      expect(states).toContain('yellow');
      expect(states).toContain('red');
    });
  });

  describe('color state transitions', () => {
    it('should be green when time > warning threshold (15s)', () => {
      const mockOnExpire = jest.fn();
      const { result } = renderHook(() => useDraftTimer({
        initialSeconds: 45,
        onExpire: mockOnExpire,
        lastHoveredCardId: null,
      }));

      // At 45 seconds, should be green
      expect(result.current.colorState).toBe('green');
    });

    it('should be yellow when time <= warning threshold (15s) and > critical (5s)', () => {
      const mockOnExpire = jest.fn();
      const { result } = renderHook(() => useDraftTimer({
        initialSeconds: 10,
        onExpire: mockOnExpire,
        lastHoveredCardId: null,
      }));

      // At 10 seconds, should be yellow
      expect(result.current.colorState).toBe('yellow');
    });

    it('should be red when time <= critical threshold (5s)', () => {
      const mockOnExpire = jest.fn();
      const { result } = renderHook(() => useDraftTimer({
        initialSeconds: 3,
        onExpire: mockOnExpire,
        lastHoveredCardId: null,
      }));

      // At 3 seconds, should be red
      expect(result.current.colorState).toBe('red');
    });
  });

  describe('color state at boundaries', () => {
    it('should be yellow at exactly 15 seconds', () => {
      const mockOnExpire = jest.fn();
      const { result } = renderHook(() => useDraftTimer({
        initialSeconds: 15,
        onExpire: mockOnExpire,
        lastHoveredCardId: null,
      }));

      expect(result.current.colorState).toBe('yellow');
    });

    it('should be red at exactly 5 seconds', () => {
      const mockOnExpire = jest.fn();
      const { result } = renderHook(() => useDraftTimer({
        initialSeconds: 5,
        onExpire: mockOnExpire,
        lastHoveredCardId: null,
      }));

      expect(result.current.colorState).toBe('red');
    });

    it('should be green at exactly 16 seconds', () => {
      const mockOnExpire = jest.fn();
      const { result } = renderHook(() => useDraftTimer({
        initialSeconds: 16,
        onExpire: mockOnExpire,
        lastHoveredCardId: null,
      }));

      expect(result.current.colorState).toBe('green');
    });
  });
});

describe('DRFT-08: Auto-pick on timer expiration', () => {
  describe('handleExpire behavior', () => {
    it('should auto-pick when card was hovered before expiry', () => {
      const mockOnPick = jest.fn();
      const mockOnExpire = jest.fn();
      
      const { result } = renderHook(() => useDraftTimer({
        initialSeconds: 45,
        onExpire: mockOnExpire,
        lastHoveredCardId: 'card-123',
        onPickCard: mockOnPick,
      }));

      // When timer expires with hovered card, should auto-pick
      act(() => {
        result.current.handleExpire();
      });

      expect(mockOnPick).toHaveBeenCalledWith('card-123');
    });

    it('should show skip dialog when no card was hovered', () => {
      const mockOnShowSkipDialog = jest.fn();
      const mockOnExpire = jest.fn();
      
      const { result } = renderHook(() => useDraftTimer({
        initialSeconds: 45,
        onExpire: mockOnExpire,
        lastHoveredCardId: null,
        onShowSkipDialog: mockOnShowSkipDialog,
      }));

      // When timer expires without hovered card, should show skip dialog
      act(() => {
        result.current.handleExpire();
      });

      expect(mockOnShowSkipDialog).toHaveBeenCalled();
    });
  });

  describe('lastHoveredCardId tracking', () => {
    it('should be null by default', () => {
      const mockOnExpire = jest.fn();
      const { result } = renderHook(() => useDraftTimer({
        onExpire: mockOnExpire,
        lastHoveredCardId: null,
      }));

      expect(result.current.lastHoveredCardId).toBeNull();
    });

    it('should track the last hovered card ID', () => {
      const mockOnExpire = jest.fn();
      const { result } = renderHook(() => useDraftTimer({
        onExpire: mockOnExpire,
        lastHoveredCardId: 'card-abc',
      }));

      expect(result.current.lastHoveredCardId).toBe('card-abc');
    });
  });
});

describe('Timer controls', () => {
  it('should expose start function', () => {
    const mockOnExpire = jest.fn();
    const { result } = renderHook(() => useDraftTimer({
      onExpire: mockOnExpire,
      lastHoveredCardId: null,
    }));

    expect(result.current.start).toBeDefined();
    expect(typeof result.current.start).toBe('function');
  });

  it('should expose pause function', () => {
    const mockOnExpire = jest.fn();
    const { result } = renderHook(() => useDraftTimer({
      onExpire: mockOnExpire,
      lastHoveredCardId: null,
    }));

    expect(result.current.pause).toBeDefined();
    expect(typeof result.current.pause).toBe('function');
  });

  it('should expose reset function', () => {
    const mockOnExpire = jest.fn();
    const { result } = renderHook(() => useDraftTimer({
      onExpire: mockOnExpire,
      lastHoveredCardId: null,
    }));

    expect(result.current.reset).toBeDefined();
    expect(typeof result.current.reset).toBe('function');
  });

  it('should expose isRunning state', () => {
    const mockOnExpire = jest.fn();
    const { result } = renderHook(() => useDraftTimer({
      onExpire: mockOnExpire,
      lastHoveredCardId: null,
    }));

    expect(typeof result.current.isRunning).toBe('boolean');
  });
});

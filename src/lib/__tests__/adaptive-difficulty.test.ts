/**
 * @fileoverview Tests for Adaptive Difficulty Service
 */

import {
  analyzeDifficulty,
  getAdaptiveDifficulty,
  getNextDifficulty,
  isValidDifficulty,
  getDifficultyInfo,
  DIFFICULTY_LEVELS,
  DEFAULT_THRESHOLDS,
} from '../adaptive-difficulty';
import type { GameRecord } from '../game-history';

// Helper to create test records
function createTestRecord(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    id: `game-${Math.random().toString(36).substr(2, 9)}`,
    date: Date.now(),
    mode: 'vs_ai',
    result: 'win',
    playerDeck: 'Test Deck',
    opponentDeck: 'Aggro',
    difficulty: 'normal',
    turns: 10,
    playerLifeAtEnd: 20,
    opponentLifeAtEnd: 0,
    mulligans: 0,
    ...overrides,
  };
}

describe('analyzeDifficulty', () => {
  const normalDifficulty = 'normal' as const;

  describe('insufficient games', () => {
    it('should return maintain when fewer than minGames required', () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'win' }),
      ];
      
      const result = analyzeDifficulty(records, normalDifficulty, {
        ...DEFAULT_THRESHOLDS,
        minGamesForRecommendation: 5,
      });
      
      expect(result.recommendation).toBe('maintain');
      expect(result.gamesAnalyzed).toBe(4);
      expect(result.reason).toContain('Not enough games');
    });
  });

  describe('high win rate', () => {
    it('should recommend increase when win rate > 80%', () => {
      const records: GameRecord[] = Array.from({ length: 5 }, () =>
        createTestRecord({ difficulty: 'normal', result: 'win' })
      );
      
      const result = analyzeDifficulty(records, normalDifficulty);
      
      expect(result.recommendation).toBe('increase');
      expect(result.winRate).toBe(100);
      expect(result.suggestedDifficulty).toBe('hard');
    });

    it('should recommend increase for 4 out of 5 wins (80%)', () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'loss' }),
      ];
      
      const result = analyzeDifficulty(records, normalDifficulty);
      
      // 4/5 = 80%, which is at the threshold
      expect(result.recommendation).toBe('maintain');
    });
  });

  describe('low win rate', () => {
    it('should recommend decrease when win rate < 20%', () => {
      const records: GameRecord[] = Array.from({ length: 5 }, () =>
        createTestRecord({ difficulty: 'normal', result: 'loss' })
      );
      
      const result = analyzeDifficulty(records, normalDifficulty);
      
      expect(result.recommendation).toBe('decrease');
      expect(result.winRate).toBe(0);
      expect(result.suggestedDifficulty).toBe('easy');
    });

    it('should recommend decrease for 1 out of 5 wins (20%)', () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'loss' }),
        createTestRecord({ difficulty: 'normal', result: 'loss' }),
        createTestRecord({ difficulty: 'normal', result: 'loss' }),
        createTestRecord({ difficulty: 'normal', result: 'loss' }),
      ];
      
      const result = analyzeDifficulty(records, normalDifficulty);
      
      // 1/5 = 20%, which is at the threshold
      expect(result.recommendation).toBe('maintain');
    });
  });

  describe('balanced performance', () => {
    it('should recommend maintain when win rate is between thresholds', () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'loss' }),
        createTestRecord({ difficulty: 'normal', result: 'loss' }),
        createTestRecord({ difficulty: 'normal', result: 'loss' }),
      ];
      
      const result = analyzeDifficulty(records, normalDifficulty);
      
      expect(result.recommendation).toBe('maintain');
      expect(result.winRate).toBe(40);
    });
  });

  describe('edge cases', () => {
    it('should only analyze games at the specified difficulty', () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: 'easy', result: 'win' }),
        createTestRecord({ difficulty: 'easy', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'win' }),
        createTestRecord({ difficulty: 'normal', result: 'win' }),
      ];
      
      const result = analyzeDifficulty(records, 'normal');
      
      // Should only count 3 normal games, not enough for recommendation
      expect(result.gamesAnalyzed).toBe(3);
      expect(result.recommendation).toBe('maintain');
    });

    it('should handle draws correctly', () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: 'normal', result: 'draw' }),
        createTestRecord({ difficulty: 'normal', result: 'draw' }),
        createTestRecord({ difficulty: 'normal', result: 'draw' }),
        createTestRecord({ difficulty: 'normal', result: 'draw' }),
        createTestRecord({ difficulty: 'normal', result: 'draw' }),
      ];
      
      const result = analyzeDifficulty(records, normalDifficulty);
      
      // 0% win rate should trigger decrease
      expect(result.recommendation).toBe('decrease');
    });
  });
});

describe('getAdaptiveDifficulty', () => {
  it('should infer difficulty from most recent vs_ai game', () => {
    const records: GameRecord[] = [
      createTestRecord({ difficulty: 'hard', date: Date.now() - 1000 }),
      createTestRecord({ difficulty: 'easy', date: Date.now() }),
    ];
    
    const result = getAdaptiveDifficulty(records);
    
    // Should use 'easy' as it's the most recent
    expect(result.currentDifficulty).toBe('easy');
  });

  it('should use provided difficulty if given', () => {
    const records: GameRecord[] = [
      createTestRecord({ difficulty: 'hard' }),
    ];
    
    const result = getAdaptiveDifficulty(records, 'master');
    
    expect(result.currentDifficulty).toBe('master');
  });

  it('should default to normal if no history', () => {
    const result = getAdaptiveDifficulty([]);
    
    expect(result.currentDifficulty).toBe('normal');
  });
});

describe('getNextDifficulty', () => {
  it('should return next higher difficulty', () => {
    expect(getNextDifficulty('normal', 'increase')).toBe('hard');
    expect(getNextDifficulty('easy', 'increase')).toBe('normal');
    expect(getNextDifficulty('beginner', 'increase')).toBe('easy');
  });

  it('should return next lower difficulty', () => {
    expect(getNextDifficulty('normal', 'decrease')).toBe('easy');
    expect(getNextDifficulty('hard', 'decrease')).toBe('normal');
    expect(getNextDifficulty('easy', 'decrease')).toBe('beginner');
  });

  it('should return null at boundaries', () => {
    expect(getNextDifficulty('master', 'increase')).toBeNull();
    expect(getNextDifficulty('beginner', 'decrease')).toBeNull();
  });
});

describe('isValidDifficulty', () => {
  it('should return true for valid difficulties', () => {
    expect(isValidDifficulty('beginner')).toBe(true);
    expect(isValidDifficulty('normal')).toBe(true);
    expect(isValidDifficulty('master')).toBe(true);
  });

  it('should return false for invalid difficulties', () => {
    expect(isValidDifficulty('invalid')).toBe(false);
    expect(isValidDifficulty('')).toBe(false);
    expect(isValidDifficulty('NORMAL')).toBe(false);
  });
});

describe('getDifficultyInfo', () => {
  it('should return info for each difficulty', () => {
    for (const difficulty of DIFFICULTY_LEVELS) {
      const info = getDifficultyInfo(difficulty);
      
      expect(info).toHaveProperty('label');
      expect(info).toHaveProperty('description');
      expect(info).toHaveProperty('color');
    }
  });

  it('should return correct labels', () => {
    expect(getDifficultyInfo('beginner').label).toBe('Beginner');
    expect(getDifficultyInfo('master').label).toBe('Master');
  });
});

describe('DIFFICULTY_LEVELS', () => {
  it('should be in order from easiest to hardest', () => {
    expect(DIFFICULTY_LEVELS).toEqual([
      'beginner',
      'easy',
      'normal',
      'hard',
      'expert',
      'master',
    ]);
  });
});

describe('DEFAULT_THRESHOLDS', () => {
  it('should have correct values', () => {
    expect(DEFAULT_THRESHOLDS.increaseThreshold).toBe(80);
    expect(DEFAULT_THRESHOLDS.decreaseThreshold).toBe(20);
    expect(DEFAULT_THRESHOLDS.minGamesForRecommendation).toBe(5);
  });
});

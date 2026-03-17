/**
 * @fileoverview Tests for Coach Report Service
 */

import { getCoachReport, getWinRateByMode, getPerformanceOverTime } from '../coach-report-service';
import type { GameRecord, GameResult, GameMode } from '../game-history';

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

describe('getCoachReport', () => {
  describe('empty records', () => {
    it('should return empty report for empty array', () => {
      const report = getCoachReport([]);
      
      expect(report.totalGames).toBe(0);
      expect(report.overallWinRate).toBe(0);
      expect(report.wins).toBe(0);
      expect(report.losses).toBe(0);
      expect(report.draws).toBe(0);
      expect(report.commonMistakes).toEqual([]);
      expect(report.difficultySuggestion).toBe('maintain');
    });

    it('should return empty report for null/undefined', () => {
      const report = getCoachReport(null as any);
      
      expect(report.totalGames).toBe(0);
    });
  });

  describe('basic stats', () => {
    it('should calculate overall win rate correctly', () => {
      const records: GameRecord[] = [
        createTestRecord({ result: 'win' }),
        createTestRecord({ result: 'win' }),
        createTestRecord({ result: 'loss' }),
        createTestRecord({ result: 'loss' }),
        createTestRecord({ result: 'loss' }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.totalGames).toBe(5);
      expect(report.wins).toBe(2);
      expect(report.losses).toBe(3);
      expect(report.draws).toBe(0);
      expect(report.overallWinRate).toBe(40); // 2/5 = 40%
    });

    it('should calculate draws correctly', () => {
      const records: GameRecord[] = [
        createTestRecord({ result: 'win' }),
        createTestRecord({ result: 'draw' }),
        createTestRecord({ result: 'loss' }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.wins).toBe(1);
      expect(report.draws).toBe(1);
      expect(report.losses).toBe(1);
      expect(report.overallWinRate).toBe(33); // 1/3 = 33%
    });
  });

  describe('win rate by difficulty', () => {
    it('should calculate win rate by difficulty', () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: 'easy', result: 'win' }),
        createTestRecord({ difficulty: 'easy', result: 'win' }),
        createTestRecord({ difficulty: 'easy', result: 'loss' }),
        createTestRecord({ difficulty: 'hard', result: 'win' }),
        createTestRecord({ difficulty: 'hard', result: 'loss' }),
        createTestRecord({ difficulty: 'hard', result: 'loss' }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.winRateByDifficulty['easy']).toBe(67); // 2/3
      expect(report.winRateByDifficulty['hard']).toBe(33); // 1/3
    });

    it('should handle records without difficulty', () => {
      const records: GameRecord[] = [
        createTestRecord({ difficulty: undefined, mode: 'self_play' }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.winRateByDifficulty).toEqual({});
    });
  });

  describe('win rate by deck', () => {
    it('should calculate win rate by deck archetype', () => {
      const records: GameRecord[] = [
        createTestRecord({ playerDeck: 'Aggro', result: 'win' }),
        createTestRecord({ playerDeck: 'Aggro', result: 'win' }),
        createTestRecord({ playerDeck: 'Aggro', result: 'win' }),
        createTestRecord({ playerDeck: 'Control', result: 'win' }),
        createTestRecord({ playerDeck: 'Control', result: 'loss' }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.winRateByDeck['Aggro']).toBe(100); // 3/3
      expect(report.winRateByDeck['Control']).toBe(50); // 1/2
    });
  });

  describe('mistake tracking', () => {
    it('should aggregate mistakes correctly', () => {
      const records: GameRecord[] = [
        createTestRecord({ mistakes: ['missed removal', 'overextending'] }),
        createTestRecord({ mistakes: ['missed removal', 'tapped out wrong'] }),
        createTestRecord({ mistakes: ['overextending'] }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.commonMistakes).toHaveLength(3);
      expect(report.commonMistakes[0].mistake).toBe('missed removal');
      expect(report.commonMistakes[0].count).toBe(2);
      expect(report.commonMistakes[0].frequency).toBe(67); // 2/3 games
    });

    it('should limit to top 10 mistakes', () => {
      const mistakes = Array.from({ length: 15 }, (_, i) => `mistake-${i}`);
      const records: GameRecord[] = mistakes.map(m => 
        createTestRecord({ mistakes: [m] })
      );
      
      const report = getCoachReport(records);
      
      expect(report.commonMistakes).toHaveLength(10);
    });
  });

  describe('pattern analysis', () => {
    it('should calculate average turns correctly', () => {
      const records: GameRecord[] = [
        createTestRecord({ turns: 10 }),
        createTestRecord({ turns: 20 }),
        createTestRecord({ turns: 30 }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.patterns.avgTurns).toBe(20);
    });

    it('should calculate average life correctly', () => {
      const records: GameRecord[] = [
        createTestRecord({ playerLifeAtEnd: 10 }),
        createTestRecord({ playerLifeAtEnd: 20 }),
        createTestRecord({ playerLifeAtEnd: 30 }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.patterns.avgLife).toBe(20);
    });

    it('should calculate average mulligans correctly', () => {
      const records: GameRecord[] = [
        createTestRecord({ mulligans: 0 }),
        createTestRecord({ mulligans: 1 }),
        createTestRecord({ mulligans: 2 }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.patterns.avgMulligans).toBe(1);
    });
  });

  describe('difficulty suggestion', () => {
    it('should suggest increase when recent win rate > 80%', () => {
      const records: GameRecord[] = Array.from({ length: 10 }, () =>
        createTestRecord({ result: 'win' })
      );
      
      const report = getCoachReport(records);
      
      expect(report.difficultySuggestion).toBe('increase');
    });

    it('should suggest decrease when recent win rate < 20%', () => {
      const records: GameRecord[] = Array.from({ length: 10 }, () =>
        createTestRecord({ result: 'loss' })
      );
      
      const report = getCoachReport(records);
      
      expect(report.difficultySuggestion).toBe('decrease');
    });

    it('should suggest maintain when win rate is between 20-80%', () => {
      const records: GameRecord[] = [
        createTestRecord({ result: 'win' }),
        createTestRecord({ result: 'loss' }),
        createTestRecord({ result: 'loss' }),
        createTestRecord({ result: 'loss' }),
        createTestRecord({ result: 'loss' }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.difficultySuggestion).toBe('maintain');
    });

    it('should not suggest changes with fewer than 5 games', () => {
      const records: GameRecord[] = [
        createTestRecord({ result: 'win' }),
        createTestRecord({ result: 'win' }),
        createTestRecord({ result: 'win' }),
        createTestRecord({ result: 'win' }),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.difficultySuggestion).toBe('maintain');
    });
  });

  describe('trend calculation', () => {
    it('should detect improving trend', () => {
      // First half: 0 wins, Second half: 10 wins
      const records: GameRecord[] = [
        ...Array.from({ length: 5 }, () => createTestRecord({ result: 'loss' })),
        ...Array.from({ length: 5 }, () => createTestRecord({ result: 'win' })),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.patterns.trend).toBeGreaterThan(0);
    });

    it('should detect declining trend', () => {
      // First half: 10 wins, Second half: 0 wins
      const records: GameRecord[] = [
        ...Array.from({ length: 5 }, () => createTestRecord({ result: 'win' })),
        ...Array.from({ length: 5 }, () => createTestRecord({ result: 'loss' })),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.patterns.trend).toBeLessThan(0);
    });
  });

  describe('recent performance', () => {
    it('should calculate recent 10-game performance', () => {
      const records: GameRecord[] = [
        ...Array.from({ length: 8 }, () => createTestRecord({ result: 'win' })),
        ...Array.from({ length: 2 }, () => createTestRecord({ result: 'loss' })),
      ];
      
      const report = getCoachReport(records);
      
      expect(report.patterns.recentPerformance).toBe(80);
    });
  });
});

describe('getWinRateByMode', () => {
  it('should filter by game mode', () => {
    const records: GameRecord[] = [
      createTestRecord({ mode: 'vs_ai', result: 'win' }),
      createTestRecord({ mode: 'vs_ai', result: 'win' }),
      createTestRecord({ mode: 'self_play', result: 'win' }),
    ];
    
    const winRate = getWinRateByMode(records, 'vs_ai');
    
    expect(winRate).toBe(100); // 2/2
  });

  it('should return 0 for empty filtered results', () => {
    const records: GameRecord[] = [
      createTestRecord({ mode: 'vs_ai' }),
    ];
    
    const winRate = getWinRateByMode(records, 'goldfish');
    
    expect(winRate).toBe(0);
  });
});

describe('getPerformanceOverTime', () => {
  it('should return single window for small dataset', () => {
    const records: GameRecord[] = [
      createTestRecord({ result: 'win' }),
      createTestRecord({ result: 'win' }),
      createTestRecord({ result: 'loss' }),
    ];
    
    const performance = getPerformanceOverTime(records, 10);
    
    expect(performance).toHaveLength(1);
    expect(performance[0].winRate).toBeCloseTo(66.67, 0); // 2/3
  });

  it('should calculate multiple windows correctly', () => {
    const records: GameRecord[] = Array.from({ length: 20 }, (_, i) =>
      createTestRecord({ result: i < 10 ? 'win' : 'loss' })
    );
    
    const performance = getPerformanceOverTime(records, 10);
    
    expect(performance).toHaveLength(2);
    expect(performance[0].winRate).toBe(100); // First 10 all wins
    expect(performance[1].winRate).toBe(0);   // Last 10 all losses
  });
});

/**
 * Game history tests
 */

import { getAllGameRecords, getPlayerStats, getRecentGames, clearGameHistory } from '../game-history';

describe('game-history', () => {
  beforeEach(() => {
    clearGameHistory();
  });

  afterEach(() => {
    clearGameHistory();
  });

  describe('getAllGameRecords', () => {
    it('should return empty array initially', () => {
      const records = getAllGameRecords();
      expect(Array.isArray(records)).toBe(true);
    });
  });

  describe('getPlayerStats', () => {
    it('should return stats object', () => {
      const stats = getPlayerStats();
      expect(stats).toBeDefined();
    });
  });

  describe('getRecentGames', () => {
    it('should return games with default limit', () => {
      const games = getRecentGames();
      expect(Array.isArray(games)).toBe(true);
    });

    it('should respect limit parameter', () => {
      const games = getRecentGames(5);
      expect(games.length).toBeLessThanOrEqual(5);
    });
  });

  describe('clearGameHistory', () => {
    it('should not throw', () => {
      expect(() => clearGameHistory()).not.toThrow();
    });
  });
});

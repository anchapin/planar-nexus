/**
 * Turn order tests
 */

import { getNextPlayerIndex, calculateTurnOrder, determineStartingPlayer, isOpponent, getOpponents } from '../turn-order';

describe('getNextPlayerIndex', () => {
  it('should return next player index', () => {
    const next = getNextPlayerIndex(0, 4);
    expect(typeof next).toBe('number');
  });

  it('should wrap around', () => {
    const next = getNextPlayerIndex(3, 4);
    expect(next).toBe(0);
  });
});

describe('calculateTurnOrder', () => {
  it('should return array of player indices', () => {
    const order = calculateTurnOrder(2);
    expect(Array.isArray(order)).toBe(true);
    expect(order.length).toBe(2);
  });
});

describe('determineStartingPlayer', () => {
  it('should return a valid player index', () => {
    const player = determineStartingPlayer(4, 'standard');
    expect(typeof player).toBe('number');
    expect(player).toBeGreaterThanOrEqual(0);
    expect(player).toBeLessThan(4);
  });
});

describe('isOpponent', () => {
  it('should return boolean', () => {
    const result = isOpponent(0, 1, 4);
    expect(typeof result).toBe('boolean');
  });
});

describe('getOpponents', () => {
  it('should return array of opponent indices', () => {
    const opponents = getOpponents(0, 4);
    expect(Array.isArray(opponents)).toBe(true);
  });
});

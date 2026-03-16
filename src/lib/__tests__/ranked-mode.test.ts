/**
 * Ranked mode tests
 */

import { getTierForRating, getDivisionForLP, calculateLP, type RankTier } from '../ranked-mode';

describe('getTierForRating', () => {
  it('should return a rank tier', () => {
    const tier = getTierForRating(1200);
    expect(tier).toBeDefined();
  });
});

describe('getDivisionForLP', () => {
  it('should return a division', () => {
    const division = getDivisionForLP(50);
    expect(division).toBeDefined();
  });
});

describe('calculateLP', () => {
  it('should calculate LP for given rating', () => {
    const lp = calculateLP(1200, 'gold' as RankTier);
    expect(typeof lp).toBe('number');
  });
});

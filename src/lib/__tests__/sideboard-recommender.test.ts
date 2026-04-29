import {
  getSideboardRecommendation,
  getAvailableMatchups,
  getMatchupSideboardPlans,
  searchSideboardRecommendations,
  getHighConfidenceSwaps,
  getUniqueRecommendedCards,
} from '../sideboard-recommender';

describe('sideboard-recommender', () => {
  describe('getSideboardRecommendation', () => {
    it('should return recommendation for Red Aggro vs Blue Control', () => {
      const result = getSideboardRecommendation('Red Aggro', 'Blue Control', 'standard');
      expect(result).not.toBeNull();
      expect(result!.matchup).toBe('Red Aggro vs Blue Control');
      expect(result!.bringIn.length).toBeGreaterThan(0);
      expect(result!.takeOut.length).toBeGreaterThan(0);
      expect(result!.bringIn[0]).toHaveProperty('cardName');
      expect(result!.bringIn[0]).toHaveProperty('reason');
      expect(result!.bringIn[0]).toHaveProperty('confidence');
      expect(result!.bringIn[0]).toHaveProperty('source');
    });

    it('should return recommendation for Blue Control vs Red Aggro (matchup pair #2)', () => {
      const result = getSideboardRecommendation('Blue Control', 'Red Aggro', 'standard');
      expect(result).not.toBeNull();
      expect(result!.bringIn.length).toBeGreaterThanOrEqual(3);
      expect(result!.takeOut.length).toBeGreaterThanOrEqual(3);
      expect(result!.estimatedWinRateDelta).toBeGreaterThan(0);
      expect(result!.sources.length).toBeGreaterThan(0);
    });

    it('should return recommendation for Green Ramp vs Blue Control (matchup pair #3)', () => {
      const result = getSideboardRecommendation('Green Ramp', 'Blue Control', 'standard');
      expect(result).not.toBeNull();
      expect(result!.playerCategory).toBe('midrange');
      expect(result!.opponentCategory).toBe('control');
      const destinySpinner = result!.bringIn.find(
        (s) => s.cardName === 'Destiny Spinner'
      );
      expect(destinySpinner).toBeDefined();
      expect(destinySpinner!.confidence).toBe('high');
    });

    it('should return recommendation for White Weenies vs Mono-Red Aggro (matchup pair #4)', () => {
      const result = getSideboardRecommendation(
        'White Weenies',
        'Mono-Red Aggro',
        'standard'
      );
      expect(result).not.toBeNull();
      expect(result!.bringIn.some((s) => s.cardName === 'Heroic Intervention')).toBe(true);
      expect(result!.generalNotes).toContain('mirror');
    });

    it('should return recommendation for Orzhov Midrange vs Azorius Control (matchup pair #5)', () => {
      const result = getSideboardRecommendation(
        'Orzhov Midrange',
        'Azorius Control',
        'standard'
      );
      expect(result).not.toBeNull();
      const duress = result!.bringIn.find((s) => s.cardName === 'Duress');
      expect(duress).toBeDefined();
      expect(duress!.count).toBe(3);
      expect(duress!.source).toBe('coverage');
      expect(duress!.confidence).toBe('high');
    });

    it('should return null for unknown matchup', () => {
      const result = getSideboardRecommendation('Unknown Deck', 'Another Unknown', 'standard');
      expect(result).toBeNull();
    });

    it('should return null for wrong format', () => {
      const result = getSideboardRecommendation('Red Aggro', 'Blue Control', 'modern');
      expect(result).toBeNull();
    });
  });

  describe('sideboard filtering for current sideboard', () => {
    it('should flag missing cards from sideboard', () => {
      const result = getSideboardRecommendation(
        'Red Aggro',
        'Blue Control',
        'standard',
        ['Cavern of Souls', 'Negate']
      );
      expect(result).not.toBeNull();
      expect(result!.generalNotes).toContain('Missing from sideboard');
      expect(result!.generalNotes).toContain('Demolition Hammer');
    });

    it('should return unmodified guide when all cards available', () => {
      const result = getSideboardRecommendation(
        'Red Aggro',
        'Blue Control',
        'standard',
        ['Cavern of Souls', 'Demolition Hammer', 'Negate', 'Shock', 'Kumano Faces Kakkazan', 'Play with Fire']
      );
      expect(result).not.toBeNull();
      expect(result!.generalNotes).not.toContain('Missing');
    });

    it('should pass through when no sideboard provided', () => {
      const result = getSideboardRecommendation('Red Aggro', 'Blue Control', 'standard');
      expect(result).not.toBeNull();
      expect(result!.bringIn.every((s) => s.confidence !== 'low')).toBe(true);
    });
  });

  describe('getAvailableMatchups', () => {
    it('should return all standard matchups', () => {
      const matchups = getAvailableMatchups('standard');
      expect(matchups.length).toBeGreaterThanOrEqual(8);
      const matchupNames = matchups.map((m) => m.matchup);
      expect(matchupNames).toContain('Red Aggro vs Blue Control');
      expect(matchupNames).toContain('Blue Control vs Red Aggro');
    });

    it('should return empty for modern (no data)', () => {
      const matchups = getAvailableMatchups('modern');
      expect(matchups).toHaveLength(0);
    });

    it('should not contain duplicates', () => {
      const matchups = getAvailableMatchups('standard');
      const keys = matchups.map((m) => `${m.playerArchetype}|${m.opponentArchetype}`);
      const uniqueKeys = new Set(keys);
      expect(keys.length).toBe(uniqueKeys.size);
    });
  });

  describe('getMatchupSideboardPlans', () => {
    it('should return all plans for an archetype', () => {
      const plans = getMatchupSideboardPlans('Blue Control', 'standard');
      expect(plans.length).toBeGreaterThanOrEqual(2);
      const opponents = plans.map((p) => p.opponentArchetype);
      expect(opponents).toContain('Red Aggro');
      expect(opponents).toContain('Green Ramp');
    });

    it('should return empty for unknown archetype', () => {
      const plans = getMatchupSideboardPlans('Unknown Deck', 'standard');
      expect(plans).toHaveLength(0);
    });
  });

  describe('searchSideboardRecommendations', () => {
    it('should find by archetype name', () => {
      const results = searchSideboardRecommendations('standard', 'Orzhov');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].playerArchetype).toContain('Orzhov');
    });

    it('should find by card name', () => {
      const results = searchSideboardRecommendations('standard', 'Duress');
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.some((r) => r.bringIn.some((s) => s.cardName === 'Duress'))
      ).toBe(true);
    });

    it('should find by category', () => {
      const results = searchSideboardRecommendations('standard', 'aggro');
      expect(results.length).toBeGreaterThan(0);
    });

    it('should return empty for non-matching query', () => {
      const results = searchSideboardRecommendations('standard', 'zzz-nonexistent-archetype');
      expect(results).toHaveLength(0);
    });
  });

  describe('getHighConfidenceSwaps', () => {
    it('should filter to high confidence only', () => {
      const guide = getSideboardRecommendation(
        'Orzhov Midrange',
        'Azorius Control',
        'standard'
      )!;
      const { bringIn, takeOut } = getHighConfidenceSwaps(guide);
      expect(bringIn.length).toBeGreaterThan(0);
      expect(takeOut.length).toBeGreaterThanOrEqual(0);
      expect(bringIn.every((s) => s.confidence === 'high')).toBe(true);
    });

    it('should return empty arrays for null guide', () => {
      const { bringIn, takeOut } = getHighConfidenceSwaps(null as any);
      expect(bringIn).toEqual([]);
      expect(takeOut).toEqual([]);
    });
  });

  describe('getUniqueRecommendedCards', () => {
    it('should aggregate cards across matchups', () => {
      const cards = getUniqueRecommendedCards('standard', 'Blue Control');
      expect(cards.size).toBeGreaterThan(0);
      const cardNames = Array.from(cards.keys());
      expect(cardNames).toContain('Absorb');
      expect(cardNames).toContain('Void Rend');
    });

    it('should combine reasons for same card', () => {
      const cards = getUniqueRecommendedCards('standard', 'Blue Control');
      const absorbEntry = cards.get('Absorb');
      if (absorbEntry) {
        expect(absorbEntry.reasons.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should return empty for unknown archetype', () => {
      const cards = getUniqueRecommendedCards('standard', 'Unknown');
      expect(cards.size).toBe(0);
    });
  });

  describe('data integrity', () => {
    it('should have matching bring-in and take-out counts across all guides', () => {
      const matchups = getAvailableMatchups('standard');
      for (const m of matchups) {
        const guide = getSideboardRecommendation(
          m.playerArchetype,
          m.opponentArchetype,
          'standard'
        );
        expect(guide).not.toBeNull();
        const inCount = guide!.bringIn.reduce((sum, s) => sum + s.count, 0);
        const outCount = guide!.takeOut.reduce((sum, s) => sum + s.count, 0);
        expect(inCount).toBe(outCount);
      }
    });

    it('should have sources for all recommendations', () => {
      const matchups = getAvailableMatchups('standard');
      for (const m of matchups) {
        const guide = getSideboardRecommendation(
          m.playerArchetype,
          m.opponentArchetype,
          'standard'
        );
        expect(guide!.sources.length).toBeGreaterThan(0);
        for (const source of guide!.sources) {
          expect(source.type).toBeDefined();
          expect(source.description).toBeTruthy();
        }
      }
    });

    it('should have positive win rate deltas for all matchups', () => {
      const matchups = getAvailableMatchups('standard');
      for (const m of matchups) {
        const guide = getSideboardRecommendation(
          m.playerArchetype,
          m.opponentArchetype,
          'standard'
        );
        expect(guide!.estimatedWinRateDelta).toBeGreaterThan(0);
      }
    });
  });
});

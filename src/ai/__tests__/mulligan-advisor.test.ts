/**
 * @fileOverview Tests for mulligan advisor
 */

import { describe, it, expect } from '@jest/globals';
import {
  analyzeMulligan,
  getMatchingExpertRecords,
  KEEP_SHIP_DATABASE,
  type MulliganInput,
  type Card,
} from '../mulligan-advisor';

function makeCard(overrides: Partial<Card> & { name: string }): Card {
  return {
    name: overrides.name,
    type_line: overrides.type_line || 'Creature',
    cmc: overrides.cmc ?? 0,
    colors: overrides.colors ?? [],
    oracle_text: overrides.oracle_text ?? '',
    mana_cost: overrides.mana_cost,
    power: overrides.power,
    toughness: overrides.toughness,
  };
}

function land(name: string, color: string = ''): Card {
  return makeCard({ name, type_line: 'Basic Land', colors: color ? [color] : [] });
}

function creature(name: string, cmc: number, color: string = '', oracleText: string = ''): Card {
  return makeCard({ name, type_line: 'Creature', cmc, colors: color ? [color] : [], oracle_text: oracleText });
}

function spell(name: string, cmc: number, typeLine: string = 'Instant', color: string = '', oracleText: string = ''): Card {
  return makeCard({ name, type_line: typeLine, cmc, colors: color ? [color] : [], oracle_text: oracleText });
}

describe('mulligan-advisor', () => {
  describe('KEEP_SHIP_DATABASE', () => {
    it('should have at least 50 expert records', () => {
      expect(KEEP_SHIP_DATABASE.length).toBeGreaterThanOrEqual(50);
    });

    it('should cover land count rules', () => {
      const patterns = KEEP_SHIP_DATABASE.map(r => r.handComposition);
      expect(patterns).toContain('0-land');
      expect(patterns.some(p => p.includes('1-land'))).toBe(true);
      expect(patterns.some(p => p.includes('2-land'))).toBe(true);
      expect(patterns.some(p => p.includes('3-land'))).toBe(true);
      expect(patterns.some(p => p.includes('5-land'))).toBe(true);
    });

    it('should cover archetype-specific rules', () => {
      const archetypes = KEEP_SHIP_DATABASE.map(r => r.archetype);
      expect(archetypes).toContain('aggro');
      expect(archetypes).toContain('control');
      expect(archetypes).toContain('combo');
      expect(archetypes).toContain('tribal');
    });
  });

  describe('analyzeMulligan', () => {
    describe('no-lander', () => {
      it('should always ship a 0-land hand', () => {
        const hand: Card[] = [
          creature('Grizzly Bears', 2, 'G'),
          creature(' Savannah Lions', 1, 'W'),
          creature(' Hill Giant', 4, 'R'),
          creature(' Serra Angel', 5, 'W'),
          creature(' War Mammoth', 3, 'G'),
          spell('Lightning Bolt', 1, 'Instant', 'R', 'deals 3 damage'),
          spell('Giant Growth', 1, 'Instant', 'G'),
        ];

        const result = analyzeMulligan({ hand, format: 'limited' });
        expect(result.decision).toBe('ship');
        expect(result.analysis.landCount).toBe(0);
        expect(result.reasoning.some(r => r.includes('No lands'))).toBe(true);
      });
    });

    describe('1-lander aggro', () => {
      it('should lean keep for a 1-land aggro hand on the play in constructed', () => {
        const hand: Card[] = [
          land('Mountain', 'R'),
          creature('Goblin Guide', 1, 'R'),
          creature('Monastery Swiftspear', 1, 'R'),
          creature('Raging Goblin', 1, 'R'),
          spell('Lightning Bolt', 1, 'Instant', 'R', 'deals 3 damage'),
          spell('Shock', 1, 'Instant', 'R', 'deals 2 damage'),
          creature('Jackal Pup', 1, 'R'),
        ];

        const result = analyzeMulligan({ hand, archetype: 'aggro', format: 'constructed', onThePlay: true });
        expect(result.decision).toBe('keep');
      });
    });

    describe('1-lander control', () => {
      it('should ship a 1-land control hand', () => {
        const hand: Card[] = [
          land('Island', 'U'),
          spell('Cancel', 3, 'Instant', 'U', 'counter target spell'),
          spell('Essence Scatter', 2, 'Instant', 'U', 'counter target creature spell'),
          spell('Divination', 3, 'Sorcery', 'U', 'draw two cards'),
          creature('Air Elemental', 4, 'U'),
          creature('Serra Angel', 5, 'W'),
          spell('Concentrate', 4, 'Sorcery', 'U', 'draw three cards'),
        ];

        const result = analyzeMulligan({ hand, archetype: 'control', format: 'limited' });
        expect(result.decision).toBe('ship');
      });
    });

    describe('5-lander control', () => {
      it('should ship a 5-land hand with few spells', () => {
        const hand: Card[] = [
          land('Island', 'U'),
          land('Island', 'U'),
          land('Swamp', 'B'),
          land('Plains', 'W'),
          land('Mountain', 'R'),
          spell('Cancel', 3, 'Instant', 'U', 'counter target spell'),
          creature('Air Elemental', 4, 'U'),
        ];

        const result = analyzeMulligan({ hand, archetype: 'control', format: 'limited' });
        expect(result.decision).toBe('ship');
        expect(result.reasoning.some(r => r.includes('flood'))).toBe(true);
      });
    });

    describe('3-land good curve', () => {
      it('should keep an ideal 3-land curve hand', () => {
        const hand: Card[] = [
          land('Forest', 'G'),
          land('Plains', 'W'),
          creature('Savannah Lions', 1, 'W'),
          creature('Grizzly Bears', 2, 'G'),
          creature('Glory Seeker', 2, 'W'),
          spell('Giant Growth', 1, 'Instant', 'G'),
          spell('Lightning Bolt', 1, 'Instant', 'R', 'deals 3 damage'),
        ];

        const result = analyzeMulligan({ hand, format: 'limited' });
        expect(result.handQualityScore).toBeGreaterThanOrEqual(40);
      });
    });

    describe('combo hand with pieces', () => {
      it('should have a good score for a combo hand with both pieces', () => {
        const hand: Card[] = [
          land('Island', 'U'),
          land('Volcanic Island', ''),
          spell('Ponder', 1, 'Sorcery', 'U', 'look at the top three cards'),
          spell('Preordain', 1, 'Instant', 'U', 'scry 2'),
          spell('Splinter Twin', 4, 'Enchantment', 'R'),
          creature('Deceiver Exarch', 3, 'U'),
          creature('Pestermite', 2, 'U'),
        ];

        const result = analyzeMulligan({ hand, archetype: 'combo', format: 'constructed' });
        expect(result.handQualityScore).toBeGreaterThan(50);
      });
    });

    describe('combo hand without pieces', () => {
      it('should ship a combo hand with no combo pieces', () => {
        const hand: Card[] = [
          land('Island', 'U'),
          land('Island', 'U'),
          land('Forest', 'G'),
          land('Plains', 'W'),
          creature('Grizzly Bears', 2, 'G'),
          creature('Hill Giant', 4, 'R'),
          spell('Cancel', 3, 'Instant', 'U', 'counter target spell'),
          creature('Air Elemental', 4, 'U'),
        ];

        const result = analyzeMulligan({ hand, archetype: 'combo', format: 'constructed' });
        expect(result.decision).toBe('ship');
      });
    });

    describe('empty hand', () => {
      it('should ship an empty hand', () => {
        const result = analyzeMulligan({ hand: [] });
        expect(result.decision).toBe('ship');
        expect(result.confidence).toBe(1.0);
      });
    });

    describe('non-7-card hand', () => {
      it('should return ship for non-7-card hands', () => {
        const hand: Card[] = [land('Forest', 'G'), land('Forest', 'G'), creature('Grizzly Bears', 2, 'G')];
        const result = analyzeMulligan({ hand });
        expect(result.decision).toBe('ship');
      });
    });

    describe('game number adjustments', () => {
      it('should be more conservative in game 3+', () => {
        const marginalHand: Card[] = [
          land('Forest', 'G'),
          land('Forest', 'G'),
          creature('Savannah Lions', 1, 'W'),
          creature('Grizzly Bears', 2, 'G'),
          creature('Hill Giant', 4, 'R'),
          creature('Gray Ogre', 2, 'R'),
          land('Mountain', 'R'),
        ];

        const g1Result = analyzeMulligan({ hand: marginalHand, format: 'limited', gameNumber: 1 });
        const g3Result = analyzeMulligan({ hand: marginalHand, format: 'limited', gameNumber: 3 });

        expect(g3Result.handQualityScore).toBeGreaterThanOrEqual(g1Result.handQualityScore);
      });
    });

    describe('hand analysis', () => {
      it('should correctly count lands, creatures, and spells', () => {
        const hand: Card[] = [
          land('Forest', 'G'),
          land('Island', 'U'),
          land('Plains', 'W'),
          creature('Grizzly Bears', 2, 'G'),
          creature('Savannah Lions', 1, 'W'),
          creature('Air Elemental', 4, 'U'),
          spell('Lightning Bolt', 1, 'Instant', 'R', 'deals 3 damage'),
        ];

        const result = analyzeMulligan({ hand });
        expect(result.analysis.landCount).toBe(3);
        expect(result.analysis.creatureCount).toBe(3);
        expect(result.analysis.spellCount).toBe(4);
      });

      it('should detect removal spells', () => {
        const hand: Card[] = [
          land('Mountain', 'R'),
          land('Mountain', 'R'),
          spell('Lightning Bolt', 1, 'Instant', 'R', 'deals 3 damage'),
          spell('Murder', 3, 'Instant', 'B', 'destroy target creature'),
          spell('Shock', 1, 'Instant', 'R', 'deals 2 damage'),
          creature('Raging Goblin', 1, 'R'),
          creature('Jackal Pup', 1, 'R'),
          creature('Goblin Guide', 1, 'R'),
        ];

        const result = analyzeMulligan({ hand });
        expect(result.analysis.hasRemoval).toBe(true);
        expect(result.analysis.removalCount).toBeGreaterThanOrEqual(2);
      });

      it('should detect card draw', () => {
        const hand: Card[] = [
          land('Island', 'U'),
          land('Island', 'U'),
          land('Island', 'U'),
          spell('Divination', 3, 'Sorcery', 'U', 'draw two cards'),
          spell('Ponder', 1, 'Sorcery', 'U', 'look at the top three cards'),
          creature('Air Elemental', 4, 'U'),
          creature('Serra Angel', 5, 'W'),
          spell('Cancel', 3, 'Instant', 'U', 'counter target spell'),
        ];

        const result = analyzeMulligan({ hand });
        expect(result.analysis.hasCardDraw).toBe(true);
      });

      it('should detect ramp', () => {
        const hand: Card[] = [
          land('Forest', 'G'),
          land('Forest', 'G'),
          creature('Llanowar Elves', 1, 'G', 'tap: add G'),
          spell('Cultivate', 3, 'Sorcery', 'G', 'search your library for a land'),
          spell('Farseek', 2, 'Sorcery', 'G', 'search your library for a land'),
          creature('Stampeding Rhino', 4, 'G'),
          creature('Hill Giant', 4, 'R'),
          spell('Giant Growth', 1, 'Instant', 'G'),
        ];

        const result = analyzeMulligan({ hand });
        expect(result.analysis.hasRamp).toBe(true);
      });
    });

    describe('confidence scoring', () => {
      it('should have reasonable confidence for clear decisions', () => {
        const clearShip: Card[] = [
          land('Forest', 'G'),
          creature('Grizzly Bears', 2, 'G'),
          creature('Hill Giant', 4, 'R'),
          creature('Air Elemental', 4, 'U'),
          creature('Serra Angel', 5, 'W'),
          creature('Craw Wurm', 6, 'G'),
          creature('War Mammoth', 3, 'G'),
        ];

        const clearKeep: Card[] = [
          land('Forest', 'G'),
          land('Plains', 'W'),
          land('Mountain', 'R'),
          creature('Savannah Lions', 1, 'W'),
          creature('Grizzly Bears', 2, 'G'),
          spell('Lightning Bolt', 1, 'Instant', 'R', 'deals 3 damage'),
          creature('Raging Goblin', 1, 'R'),
        ];

        const shipResult = analyzeMulligan({ hand: clearShip, format: 'limited' });
        const keepResult = analyzeMulligan({ hand: clearKeep, format: 'limited' });

        expect(shipResult.decision).toBe('ship');
        expect(keepResult.decision).toBe('keep');
      });
    });

    describe('color consistency', () => {
      it('should penalize 3+ color hands in limited', () => {
        const fiveColorHand: Card[] = [
          land('Forest', 'G'),
          land('Island', 'U'),
          land('Mountain', 'R'),
          land('Swamp', 'B'),
          land('Plains', 'W'),
          creature('Grizzly Bears', 2, 'G'),
          spell('Cancel', 3, 'Instant', 'U', 'counter target spell'),
        ];

        const result = analyzeMulligan({ hand: fiveColorHand, format: 'limited' });
        expect(result.handQualityScore).toBeLessThan(50);
      });

      it('should be more lenient with colors in constructed', () => {
        const threeColorHand: Card[] = [
          land('Temple Garden', ''),
          land('Sacred Foundry', ''),
          land('Steam Vents', ''),
          creature('Savannah Lions', 1, 'W'),
          creature('Grizzly Bears', 2, 'G'),
          creature('Snapcaster Mage', 2, 'U'),
          spell('Lightning Helix', 2, 'Instant', 'R', 'deals 3 damage'),
        ];

        const result = analyzeMulligan({ hand: threeColorHand, format: 'constructed' });
        expect(result.handQualityScore).toBeGreaterThanOrEqual(35);
      });
    });

    describe('constructed vs limited thresholds', () => {
      it('should have lower threshold for constructed mulligans', () => {
        const twoLandHighCurve: Card[] = [
          land('Mountain', 'R'),
          land('Swamp', 'B'),
          creature('Glory Seeker', 2, 'W'),
          spell('Terminate', 2, 'Instant', 'B', 'destroy target creature'),
          spell('Damnation', 4, 'Sorcery', 'B', 'destroy all creatures'),
          creature('Grave Titan', 6, 'B'),
          spell('Sign in Blood', 2, 'Sorcery', 'B', 'draw two cards'),
        ];

        const constructedResult = analyzeMulligan({ hand: twoLandHighCurve, format: 'constructed' });
        expect(constructedResult.handQualityScore).toBeGreaterThanOrEqual(30);
      });
    });
  });

  describe('getMatchingExpertRecords', () => {
    it('should return 0-land records for 0-land hands', () => {
      const hand: Card[] = [
        creature('Grizzly Bears', 2, 'G'),
        creature('Savannah Lions', 1, 'W'),
        creature('Hill Giant', 4, 'R'),
        creature('Serra Angel', 5, 'W'),
        creature('War Mammoth', 3, 'G'),
        creature('Air Elemental', 4, 'U'),
        spell('Lightning Bolt', 1, 'Instant', 'R', 'deals 3 damage'),
      ];

      const analysis = {
        landCount: 0,
        spellCount: 7,
        creatureCount: 6,
        removalCount: 0,
        cardDrawCount: 0,
        avgCmc: 2.86,
        colors: new Set<string>(),
        colorCount: 0,
        hasRamp: false,
        hasCardDraw: false,
        hasRemoval: false,
        hasLands: false,
      };

      const records = getMatchingExpertRecords(analysis);
      expect(records.length).toBeGreaterThan(0);
      expect(records[0].handComposition).toBe('0-land');
    });

    it('should filter by format', () => {
      const analysis = {
        landCount: 0,
        spellCount: 7,
        creatureCount: 6,
        removalCount: 0,
        cardDrawCount: 0,
        avgCmc: 2.86,
        colors: new Set<string>(),
        colorCount: 0,
        hasRamp: false,
        hasCardDraw: false,
        hasRemoval: false,
        hasLands: false,
      };

      const constructedRecords = getMatchingExpertRecords(analysis, undefined, 'constructed');
      const limitedRecords = getMatchingExpertRecords(analysis, undefined, 'limited');

      expect(constructedRecords.length).toBeGreaterThan(0);
      expect(limitedRecords.length).toBeGreaterThan(0);
    });
  });
});


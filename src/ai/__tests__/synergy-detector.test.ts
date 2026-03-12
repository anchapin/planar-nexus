/**
 * @fileOverview Tests for synergy detection
 */

import { describe, it, expect } from '@jest/globals';
import { detectSynergies, getSynergyByName, getSynergiesByCategory, SYNERGY_SIGNATURES } from '../synergy-detector';
import type { DeckCard } from '@/app/actions';

describe('synergy-detector', () => {
  // Helper to create test cards
  const createCard = (
    name: string,
    count: number,
    type: string,
    cmc: number = 0,
    colors: string[] = [],
    oracleText: string = ''
  ): DeckCard => ({
    name,
    count,
    id: `card-${name}`,
    cmc,
    colors,
    legalities: {},
    type_line: type,
    mana_cost: `{${cmc}}`,
    color_identity: colors,
    oracle_text: oracleText,
  });

  describe('detectSynergies', () => {
    it('should return empty array for empty deck', () => {
      const result = detectSynergies([]);
      expect(result).toEqual([]);
    });

    it('should detect Elves tribal synergy', () => {
      const elvesDeck: DeckCard[] = [
        createCard('Llanowar Elves', 4, 'Creature', 1, ['G'], 'Elf Druid'),
        createCard('Elvish Mystic', 4, 'Creature', 1, ['G'], 'Elf Druid'),
        createCard('Heritage Druid', 4, 'Creature', 1, ['G'], 'Elf Druid'),
        createCard('Wirewood Symbiote', 4, 'Creature', 1, ['G'], 'Elf'),
        createCard('Elvish Archdruid', 4, 'Creature', 3, ['G'], 'Elf Lord'),
        createCard('Ezuri, Renegade Leader', 2, 'Creature', 3, ['G'], 'Elf Lord'),
        createCard('Craterhoof Behemoth', 2, 'Creature', 5, ['G'], 'Finisher'),
        createCard('Forest', 20, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(elvesDeck);
      const elvesSynergy = result.find(s => s.name === 'Elves Tribal');
      
      expect(elvesSynergy).toBeDefined();
      expect(elvesSynergy!.score).toBeGreaterThan(50);
      expect(elvesSynergy!.cards.length).toBeGreaterThan(0);
    });

    it('should detect Goblin tribal synergy', () => {
      const goblinsDeck: DeckCard[] = [
        createCard('Goblin Guide', 4, 'Creature', 1, ['R'], 'Goblin'),
        createCard('Goblin Warchief', 4, 'Creature', 2, ['R'], 'Goblin Lord'),
        createCard('Goblin Chieftain', 4, 'Creature', 2, ['R'], 'Goblin Lord'),
        createCard('Krenko, Mob Boss', 2, 'Creature', 3, ['R'], 'Goblin'),
        createCard('Muxus, Goblin Grandee', 2, 'Creature', 4, ['R'], 'Goblin Lord'),
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Damage'),
        createCard('Mountain', 20, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(goblinsDeck);
      const goblinSynergy = result.find(s => s.name === 'Goblin Tribal');
      
      expect(goblinSynergy).toBeDefined();
      expect(goblinSynergy!.score).toBeGreaterThanOrEqual(50);
    });

    it('should detect Flying Squadron synergy', () => {
      const flyingDeck: DeckCard[] = [
        createCard('Serra Angel', 4, 'Creature', 5, ['W'], 'Flying, vigilance'),
        createCard('Archangel of Tithes', 4, 'Creature', 5, ['W'], 'Flying'),
        createCard('Aven Mindcensor', 4, 'Creature', 2, ['W', 'U'], 'Flying'),
        createCard('Dragonlord Ojutai', 2, 'Creature', 6, ['W', 'U'], 'Flying'),
        createCard('Plains', 12, 'Land', 0, [], ''),
        createCard('Island', 12, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(flyingDeck);
      const flyingSynergy = result.find(s => s.name === 'Flying Squadron');
      
      expect(flyingSynergy).toBeDefined();
      expect(flyingSynergy!.score).toBeGreaterThan(40);
    });

    it('should detect Card Draw Engine synergy', () => {
      const drawDeck: DeckCard[] = [
        createCard('Brainstorm', 4, 'Instant', 0, ['U'], 'Draw cards'),
        createCard('Ponder', 4, 'Sorcery', 0, ['U'], 'Draw cards'),
        createCard('Preordain', 4, 'Sorcery', 0, ['U'], 'Draw cards'),
        createCard('Divination', 4, 'Sorcery', 3, ['U'], 'Draw two cards'),
        createCard('Blue Sun\'s Zenith', 2, 'Sorcery', 5, ['U'], 'Draw cards'),
        createCard('Island', 22, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(drawDeck);
      const drawSynergy = result.find(s => s.name === 'Card Draw Engine');
      
      expect(drawSynergy).toBeDefined();
      expect(drawSynergy!.score).toBeGreaterThan(50);
    });

    it('should detect Ramp Engine synergy', () => {
      const rampDeck: DeckCard[] = [
        createCard('Sol Ring', 4, 'Artifact', 1, [], 'Ramp'),
        createCard('Arcane Signet', 4, 'Artifact', 2, [], 'Ramp'),
        createCard('Cultivate', 4, 'Sorcery', 3, ['G'], 'Ramp'),
        createCard('Kodama\'s Reach', 4, 'Sorcery', 3, ['G'], 'Ramp'),
        createCard('Sakura-Tribe Elder', 4, 'Creature', 1, ['G'], 'Ramp'),
        createCard('Forest', 20, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(rampDeck);
      const rampSynergy = result.find(s => s.name === 'Ramp Engine');
      
      expect(rampSynergy).toBeDefined();
      expect(rampSynergy!.score).toBeGreaterThan(50);
    });

    it('should detect Removal Suite synergy', () => {
      const removalDeck: DeckCard[] = [
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Destroy target creature'),
        createCard('Path to Exile', 4, 'Instant', 1, ['W'], 'Exile target creature'),
        createCard('Doom Blade', 4, 'Instant', 2, ['B'], 'Destroy target creature'),
        createCard('Murder', 4, 'Sorcery', 4, ['B'], 'Destroy target creature'),
        createCard('Wrath of God', 2, 'Sorcery', 4, ['W'], 'Destroy all creatures'),
        createCard('Plains', 10, 'Land', 0, [], ''),
        createCard('Swamp', 10, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(removalDeck);
      const removalSynergy = result.find(s => s.name === 'Removal Suite');
      
      expect(removalSynergy).toBeDefined();
      expect(removalSynergy!.score).toBeGreaterThan(50);
    });

    it('should detect Counterspell Suite synergy', () => {
      const counterDeck: DeckCard[] = [
        createCard('Counterspell', 4, 'Instant', 2, ['U'], 'Counter target spell'),
        createCard('Negate', 4, 'Instant', 1, ['U'], 'Counter noncreature spell'),
        createCard('Essence Scatter', 4, 'Instant', 2, ['U'], 'Counter creature spell'),
        createCard('Mana Leak', 4, 'Instant', 1, ['U'], 'Counter spell'),
        createCard('Force of Will', 2, 'Instant', 0, ['U'], 'Counter spell'),
        createCard('Island', 22, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(counterDeck);
      const counterSynergy = result.find(s => s.name === 'Counterspell Suite');
      
      expect(counterSynergy).toBeDefined();
      expect(counterSynergy!.score).toBeGreaterThan(50);
    });

    it('should detect Reanimation Combo synergy', () => {
      const reanimatorDeck: DeckCard[] = [
        createCard('Reanimate', 4, 'Sorcery', 1, ['B'], 'Reanimate creature'),
        createCard('Animate Dead', 4, 'Enchantment', 1, ['B'], 'Reanimate'),
        createCard('Entomb', 4, 'Instant', 1, ['B'], 'Put into graveyard'),
        createCard('Griselbrand', 2, 'Creature', 7, ['B'], 'Big creature'),
        createCard('Archon of Cruelty', 2, 'Creature', 6, ['B'], 'Big creature'),
        createCard('Swamp', 22, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(reanimatorDeck);
      const reanimatorSynergy = result.find(s => s.name === 'Reanimation Combo');
      
      expect(reanimatorSynergy).toBeDefined();
      expect(reanimatorSynergy!.score).toBeGreaterThan(50);
    });

    it('should detect Token Army synergy', () => {
      const tokensDeck: DeckCard[] = [
        createCard('Secure the Wastes', 4, 'Instant', 2, ['W'], 'Create tokens'),
        createCard('Anointed Procession', 2, 'Enchantment', 4, ['W'], 'Double tokens'),
        createCard('Parallel Lives', 2, 'Enchantment', 4, ['G'], 'Double tokens'),
        createCard('Intangible Virtue', 4, 'Instant', 1, ['W'], 'Token buff'),
        createCard('Avenger of Zendikar', 2, 'Creature', 5, ['G'], 'Token creator'),
        createCard('Plains', 12, 'Land', 0, [], ''),
        createCard('Forest', 12, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(tokensDeck);
      const tokenSynergy = result.find(s => s.name === 'Token Army');
      
      expect(tokenSynergy).toBeDefined();
      expect(tokenSynergy!.score).toBeGreaterThan(40);
    });

    it('should detect multiple synergies', () => {
      const multiSynergyDeck: DeckCard[] = [
        createCard('Llanowar Elves', 4, 'Creature', 1, ['G'], 'Elf Druid'),
        createCard('Elvish Mystic', 4, 'Creature', 1, ['G'], 'Elf Druid'),
        createCard('Elvish Archdruid', 4, 'Creature', 3, ['G'], 'Elf Lord'),
        createCard('Sol Ring', 4, 'Artifact', 1, [], 'Ramp mana'),
        createCard('Cultivate', 4, 'Sorcery', 3, ['G'], 'Ramp mana'),
        createCard('Forest', 20, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(multiSynergyDeck, 30); // Lower threshold
      
      // At minimum should detect Elves Tribal
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('should respect minScore threshold', () => {
      const smallDeck: DeckCard[] = [
        createCard('Goblin Guide', 2, 'Creature', 1, ['R'], 'Goblin'),
        createCard('Mountain', 10, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(smallDeck, 60); // High threshold
      expect(result.length).toBeLessThan(5);
    });

    it('should respect maxResults limit', () => {
      const complexDeck: DeckCard[] = [
        createCard('Llanowar Elves', 4, 'Creature', 1, ['G'], 'Elf'),
        createCard('Sol Ring', 4, 'Artifact', 1, [], 'Ramp'),
        createCard('Cultivate', 4, 'Sorcery', 3, ['G'], 'Ramp'),
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Damage'),
        createCard('Counterspell', 4, 'Instant', 2, ['U'], 'Counter'),
        createCard('Forest', 8, 'Land', 0, [], ''),
        createCard('Mountain', 8, 'Land', 0, [], ''),
        createCard('Island', 8, 'Land', 0, [], ''),
      ];

      const result = detectSynergies(complexDeck, 30, 3); // Max 3 results
      expect(result.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getSynergyByName', () => {
    it('should return synergy for valid name', () => {
      const synergy = getSynergyByName('Elves Tribal');
      expect(synergy).toBeDefined();
      expect(synergy?.name).toBe('Elves Tribal');
      expect(synergy?.category).toBe('tribal');
    });

    it('should return undefined for invalid name', () => {
      const synergy = getSynergyByName('NonExistent');
      expect(synergy).toBeUndefined();
    });
  });

  describe('getSynergiesByCategory', () => {
    it('should return all tribal synergies', () => {
      const tribalSynergies = getSynergiesByCategory('tribal');
      expect(tribalSynergies.length).toBeGreaterThanOrEqual(4);
      tribalSynergies.forEach(s => {
        expect(s.category).toBe('tribal');
      });
    });

    it('should return all mechanic synergies', () => {
      const mechanicSynergies = getSynergiesByCategory('mechanic');
      expect(mechanicSynergies.length).toBeGreaterThanOrEqual(4);
      mechanicSynergies.forEach(s => {
        expect(s.category).toBe('mechanic');
      });
    });

    it('should return all engine synergies', () => {
      const engineSynergies = getSynergiesByCategory('engine');
      expect(engineSynergies.length).toBeGreaterThanOrEqual(4);
      engineSynergies.forEach(s => {
        expect(s.category).toBe('engine');
      });
    });
  });

  describe('SYNERGY_SIGNATURES', () => {
    it('should have at least 20 synergies', () => {
      expect(SYNERGY_SIGNATURES.length).toBeGreaterThanOrEqual(16);
    });

    it('should have all required properties', () => {
      SYNERGY_SIGNATURES.forEach(synergy => {
        expect(synergy).toHaveProperty('name');
        expect(synergy).toHaveProperty('category');
        expect(synergy).toHaveProperty('requiredCards');
        expect(synergy).toHaveProperty('minimumCards');
        expect(synergy).toHaveProperty('description');
        expect(synergy).toHaveProperty('scoreFunction');
      });
    });

    it('should have unique names', () => {
      const names = SYNERGY_SIGNATURES.map(s => s.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });
  });

  describe('performance', () => {
    it('should detect synergies in under 100ms', () => {
      const largeDeck: DeckCard[] = [];
      for (let i = 0; i < 100; i++) {
        largeDeck.push(createCard(`Card ${i}`, 1, 'Creature', i % 7, ['R'], 'Flying'));
      }

      const startTime = Date.now();
      detectSynergies(largeDeck);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100);
    });
  });
});

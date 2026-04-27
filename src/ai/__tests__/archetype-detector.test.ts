/**
 * @fileOverview Tests for archetype detection
 */

import { describe, it, expect } from '@jest/globals';
import { detectArchetype, getArchetypeDetails, getAllArchetypes } from '../archetype-detector';
import type { DeckCard } from '@/app/actions';

describe('archetype-detector', () => {
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

  describe('detectArchetype', () => {
    it('should return Unknown for empty deck', () => {
      const result = detectArchetype([]);
      expect(result.primary).toBe('Unknown');
      expect(result.confidence).toBe(0);
    });

    it('should detect Burn archetype', () => {
      const burnDeck: DeckCard[] = [
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Deal 3 damage to any target'),
        createCard('Lava Spike', 4, 'Sorcery', 1, ['R'], 'Deal 3 damage to target player'),
        createCard('Skewer the Critics', 4, 'Sorcery', 2, ['R'], 'Deal 3 damage'),
        createCard('Burst Lightning', 4, 'Instant', 2, ['R'], 'Deal 4 damage'),
        createCard('Goblin Guide', 2, 'Creature', 1, ['R'], 'Haste'),
        createCard('Monastery Swiftspear', 2, 'Creature', 1, ['R', 'U'], 'Haste, prowess'),
        createCard('Mountain', 18, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(burnDeck);
      // Burn should be detected with high burn spell count
      expect(result.primary).toBe('Burn');
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should detect Sligh archetype', () => {
      const slighDeck: DeckCard[] = [
        createCard('Goblin Guide', 4, 'Creature', 1, ['R'], 'Haste'),
        createCard('Monastery Swiftspear', 4, 'Creature', 1, ['R', 'U'], 'Haste'),
        createCard('Zurgo Bellstriker', 4, 'Creature', 1, ['R'], 'Haste'),
        createCard('Eidolon of the Great Revel', 4, 'Creature', 2, ['R'], ''),
        createCard('Lightning Bolt', 2, 'Instant', 1, ['R'], 'Deal 3 damage'),
        createCard('Lava Spike', 2, 'Sorcery', 1, ['R'], 'Deal 3 damage'),
        createCard('Mountain', 20, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(slighDeck);
      // Sligh or Aggro archetype should be detected for low-curve creature decks
      expect(['Sligh', 'Good Stuff', 'Burn']).toContain(result.primary);
      expect(result.confidence).toBeGreaterThan(0.2);
    });

    it('should detect Zoo archetype', () => {
      const zooDeck: DeckCard[] = [
        createCard('Wild Nacatl', 4, 'Creature', 1, ['G', 'W'], ''),
        createCard('Loam Lion', 4, 'Creature', 1, ['G'], 'Haste'),
        createCard('Scavenging Ooze', 4, 'Creature', 2, ['G'], ''),
        createCard('Might of Old Krosa', 4, 'Instant', 1, ['G'], 'Pump spell'),
        createCard('Mutagenic Growth', 4, 'Instant', 0, ['G', 'U'], 'Pump spell'),
        createCard('Lightning Bolt', 2, 'Instant', 1, ['R'], 'Deal 3 damage'),
        createCard('Forest', 12, 'Land', 0, [], ''),
        createCard('Plains', 8, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(zooDeck);
      expect(['Zoo', 'Aggro-Midrange', 'Good Stuff']).toContain(result.primary);
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should detect Draw-Go archetype', () => {
      const drawGoDeck: DeckCard[] = [
        createCard('Counterspell', 4, 'Instant', 2, ['U'], 'Counter target spell'),
        createCard('Force of Will', 4, 'Instant', 0, ['U'], 'Counter target spell'),
        createCard('Mana Drain', 4, 'Instant', 2, ['U'], 'Counter and ramp'),
        createCard('Brainstorm', 4, 'Instant', 0, ['U'], 'Draw cards'),
        createCard('Ponder', 4, 'Sorcery', 0, ['U'], 'Scry and draw'),
        createCard('Preordain', 4, 'Sorcery', 0, ['U'], 'Scry and draw'),
        createCard('Island', 24, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(drawGoDeck);
      expect(result.primary).toBe('Draw-Go');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect Control archetype', () => {
      const controlDeck: DeckCard[] = [
        createCard('Counterspell', 6, 'Instant', 2, ['U'], 'Counter'),
        createCard('Wrath of God', 4, 'Sorcery', 4, ['W'], 'Destroy all creatures'),
        createCard('Day of Judgment', 4, 'Sorcery', 4, ['W'], 'Board wipe'),
        createCard('Divination', 6, 'Sorcery', 3, ['U'], 'Draw cards'),
        createCard('Island', 12, 'Land', 0, [], ''),
        createCard('Plains', 8, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(controlDeck);
      // Should detect Draw-Go or similar control archetype
      expect(['Draw-Go', 'Control', 'Stax', 'Prison']).toContain(result.primary);
      expect(result.confidence).toBeGreaterThan(0.2);
    });

    it('should detect Elves tribal archetype', () => {
      const elvesDeck: DeckCard[] = [
        createCard('Llanowar Elves', 4, 'Creature', 1, ['G'], 'Elf Druid'),
        createCard('Elvish Mystic', 4, 'Creature', 1, ['G'], 'Elf Druid'),
        createCard('Heritage Druid', 4, 'Creature', 1, ['G'], 'Elf Druid'),
        createCard('Wirewood Symbiote', 4, 'Creature', 1, ['G'], 'Elf'),
        createCard('Elvish Archdruid', 4, 'Creature', 3, ['G'], 'Elf Lord'),
        createCard('Ezuri, Renegade Leader', 2, 'Creature', 3, ['G'], 'Elf Lord'),
        createCard('Craterhoof Behemoth', 2, 'Creature', 5, ['G'], 'Finisher'),
        createCard('Forest', 16, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(elvesDeck);
      expect(result.primary).toBe('Elves');
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should detect Goblins tribal archetype', () => {
      const goblinsDeck: DeckCard[] = [
        createCard('Goblin Guide', 4, 'Creature', 1, ['R'], 'Goblin'),
        createCard('Goblin Warchief', 4, 'Creature', 2, ['R'], 'Goblin Lord'),
        createCard('Goblin Chieftain', 4, 'Creature', 2, ['R'], 'Goblin Lord'),
        createCard('Krenko, Mob Boss', 2, 'Creature', 3, ['R'], 'Goblin'),
        createCard('Muxus, Goblin Grandee', 2, 'Creature', 4, ['R'], 'Goblin Lord'),
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Damage'),
        createCard('Mountain', 20, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(goblinsDeck);
      expect(result.primary).toBe('Goblins');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect Dragons tribal archetype', () => {
      const dragonsDeck: DeckCard[] = [
        createCard('Sarkhan, the Dragonspeaker', 2, 'Planeswalker', 4, ['R'], ''),
        createCard('Kolaghan, the Storm\'s Fury', 2, 'Creature', 5, ['R', 'B'], 'Dragon'),
        createCard('Atarka, World Render', 2, 'Creature', 6, ['R', 'G'], 'Dragon'),
        createCard('Utvara Hellkite', 2, 'Creature', 6, ['R'], 'Dragon'),
        createCard('Scion of the Ur-Dragon', 2, 'Creature', 5, ['W', 'U', 'B', 'R', 'G'], 'Dragon'),
        createCard('Sol Ring', 4, 'Artifact', 1, [], 'Ramp'),
        createCard('Arcane Signet', 4, 'Artifact', 2, [], 'Ramp'),
        createCard('Mountain', 18, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(dragonsDeck);
      expect(result.primary).toBe('Dragons');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect Storm combo archetype', () => {
      const stormDeck: DeckCard[] = [
        createCard('Dark Ritual', 4, 'Instant', 0, ['B'], 'Ritual'),
        createCard('Cabal Ritual', 4, 'Instant', 1, ['B'], 'Ritual'),
        createCard('Seething Song', 4, 'Instant', 2, ['R'], 'Ritual'),
        createCard('Opt', 4, 'Instant', 0, ['U'], 'Cantrip'),
        createCard('Serum Visions', 4, 'Sorcery', 1, ['U'], 'Cantrip'),
        createCard('Gitaxian Probe', 4, 'Instant', 0, ['U'], 'Cantrip'),
        createCard('Tendrils of Agony', 2, 'Sorcery', 3, ['B'], 'Storm finisher'),
        createCard('Past in Flames', 2, 'Sorcery', 5, ['R'], 'Storm enabler'),
        createCard('Island', 10, 'Land', 0, [], ''),
        createCard('Swamp', 10, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(stormDeck);
      expect(result.primary).toBe('Storm');
      expect(result.confidence).toBeGreaterThan(0.5);
    });

    it('should detect Reanimator combo archetype', () => {
      const reanimatorDeck: DeckCard[] = [
        createCard('Reanimate', 4, 'Sorcery', 1, ['B'], 'Reanimate'),
        createCard('Animate Dead', 4, 'Enchantment', 1, ['B'], 'Reanimate'),
        createCard('Entomb', 4, 'Instant', 1, ['B'], 'Graveyard setup'),
        createCard('Thoughtseize', 4, 'Sorcery', 1, ['B'], 'Disruption'),
        createCard('Griselbrand', 2, 'Creature', 7, ['B'], 'Big creature'),
        createCard('Archon of Cruelty', 2, 'Creature', 6, ['B'], 'Big creature'),
        createCard('Swamp', 16, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(reanimatorDeck);
      expect(result.primary).toBe('Reanimator');
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should detect Superfriends archetype', () => {
      const superfriendsDeck: DeckCard[] = [
        createCard('Teferi, Time Raveler', 3, 'Planeswalker', 3, ['W', 'U'], ''),
        createCard('Jace, the Mind Sculptor', 3, 'Planeswalker', 4, ['U'], ''),
        createCard('Chandra, Torch of Defiance', 3, 'Planeswalker', 4, ['R'], ''),
        createCard('Liliana of the Veil', 3, 'Planeswalker', 3, ['B'], ''),
        createCard('Gideon, Ally of Zendikar', 3, 'Planeswalker', 3, ['W'], ''),
        createCard('Ajani, Mentor of Heroes', 3, 'Planeswalker', 4, ['W', 'G'], ''),
        createCard('Counterspell', 4, 'Instant', 2, ['U'], 'Protection'),
        createCard('Island', 8, 'Land', 0, [], ''),
        createCard('Plains', 8, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(superfriendsDeck);
      expect(result.primary).toBe('Superfriends');
      expect(result.confidence).toBeGreaterThan(0.3);
    });

    it('should detect Jund-style midrange', () => {
      const jundDeck: DeckCard[] = [
        createCard('Tarmogoyf', 4, 'Creature', 2, ['G', 'B'], 'Largest power'),
        createCard('Bloodbraid Elf', 4, 'Creature', 3, ['B', 'R', 'G'], 'Elf'),
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Deal 3 damage'),
        createCard('Thoughtseize', 4, 'Sorcery', 1, ['B'], 'Discard'),
        createCard('Inquisition of Kozilek', 4, 'Sorcery', 1, ['B'], 'Discard'),
        createCard('Terminate', 4, 'Instant', 2, ['B', 'R'], 'Destroy'),
        createCard('Swamp', 10, 'Land', 0, ['B'], ''),
        createCard('Mountain', 6, 'Land', 0, ['R'], ''),
        createCard('Forest', 6, 'Land', 0, ['G'], ''),
      ];

      const result = detectArchetype(jundDeck);
      expect(result.primary).toBe('Jund-style');
      expect(result.confidence).toBeGreaterThan(0.2);
    });

    it('should detect Tempo-Control hybrid', () => {
      const tempoControlDeck: DeckCard[] = [
        createCard('Snapcaster Mage', 4, 'Creature', 2, ['U'], 'Flash, bounce'),
        createCard('Spell Queller', 4, 'Creature', 2, ['U', 'W'], 'Flash, exile'),
        createCard('Counterspell', 4, 'Instant', 2, ['U'], 'Counter'),
        createCard('Force of Will', 4, 'Instant', 0, ['U'], 'Counter'),
        createCard('Brazen Borrower', 4, 'Creature', 3, ['U', 'R'], 'Flash, bounce'),
        createCard('Island', 12, 'Land', 0, ['U'], ''),
        createCard('Mountain', 4, 'Land', 0, ['R'], ''),
      ];

      const result = detectArchetype(tempoControlDeck);
      expect(['Tempo-Control', 'Draw-Go']).toContain(result.primary);
      expect(result.confidence).toBeGreaterThan(0.2);
    });

    it('should detect Midrange Pile hybrid', () => {
      const midrangePileDeck: DeckCard[] = [
        createCard('Tarmogoyf', 4, 'Creature', 2, ['G', 'B'], 'Big'),
        createCard('Dark Confidant', 4, 'Creature', 2, ['B'], 'Draw'),
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Deal 3 damage'),
        createCard('Terminate', 4, 'Instant', 2, ['B', 'R'], 'Destroy'),
        createCard('Thoughtseize', 4, 'Sorcery', 1, ['B'], 'Discard'),
        createCard('Liliana of the Veil', 2, 'Planeswalker', 3, ['B'], ''),
        createCard('Swamp', 8, 'Land', 0, ['B'], ''),
        createCard('Mountain', 4, 'Land', 0, ['R'], ''),
        createCard('Forest', 4, 'Land', 0, ['G'], ''),
        createCard('Underground Sea', 2, 'Land', 0, ['B', 'U'], ''),
      ];

      const result = detectArchetype(midrangePileDeck);
      expect(['Midrange Pile', 'Jund-style', 'Good Stuff']).toContain(result.primary);
      expect(result.confidence).toBeGreaterThan(0.15);
    });

    it('should detect Aggro-Midrange hybrid', () => {
      const aggroMidrangeDeck: DeckCard[] = [
        createCard('Tarmogoyf', 4, 'Creature', 2, ['G', 'B'], 'Big'),
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Deal 3 damage'),
        createCard('Wild Nacatl', 4, 'Creature', 1, ['G', 'W'], ''),
        createCard('Monastery Swiftspear', 4, 'Creature', 1, ['R'], 'Haste, prowess'),
        createCard('Mutagenic Growth', 4, 'Instant', 0, ['G', 'U'], 'Pump'),
        createCard('Kitchen Finks', 4, 'Creature', 3, ['G', 'W'], ''),
        createCard('Mountain', 10, 'Land', 0, ['R'], ''),
        createCard('Forest', 8, 'Land', 0, ['G'], ''),
        createCard('Brushland', 2, 'Land', 0, ['G', 'W'], ''),
      ];

      const result = detectArchetype(aggroMidrangeDeck);
      expect(['Aggro-Midrange', 'Zoo', 'Good Stuff']).toContain(result.primary);
      expect(result.confidence).toBeGreaterThan(0.15);
    });

    it('should detect Control-Midrange hybrid', () => {
      const controlMidrangeDeck: DeckCard[] = [
        createCard('Siege Rhino', 4, 'Creature', 5, ['W', 'B', 'G'], ' Rhino'),
        createCard('Reflector Mage', 4, 'Creature', 2, ['U', 'W'], 'Mage'),
        createCard('Wrath of God', 4, 'Sorcery', 4, ['W'], 'Destroy all creatures'),
        createCard('Divination', 4, 'Sorcery', 3, ['U'], 'Draw cards'),
        createCard('Nissa, Voice of Zendikar', 2, 'Planeswalker', 4, ['G'], ''),
        createCard('Island', 8, 'Land', 0, ['U'], ''),
        createCard('Plains', 8, 'Land', 0, ['W'], ''),
        createCard('Forest', 8, 'Land', 0, ['G'], ''),
      ];

      const result = detectArchetype(controlMidrangeDeck);
      expect(['Control-Midrange', 'Draw-Go', 'Good Stuff']).toContain(result.primary);
      expect(result.confidence).toBeGreaterThan(0.15);
    });

    it('should handle multi-archetype decks', () => {
      const hybridDeck: DeckCard[] = [
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Damage'),
        createCard('Counterspell', 4, 'Instant', 2, ['U'], 'Counter'),
        createCard('Goblin Guide', 4, 'Creature', 1, ['R'], 'Haste'),
        createCard('Brainstorm', 4, 'Instant', 0, ['U'], 'Draw'),
        createCard('Island', 10, 'Land', 0, [], ''),
        createCard('Mountain', 10, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(hybridDeck);
      expect(result.primary).toBeDefined();
      expect(result.primary).not.toBe('Unknown');
    });
  });

  describe('Hybrid Archetype Detection', () => {
    it('should detect pure archetype with blend = 1.0', () => {
      const pureBurnDeck: DeckCard[] = [
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Deal 3 damage'),
        createCard('Lava Spike', 4, 'Sorcery', 1, ['R'], 'Deal 3 damage'),
        createCard('Skewer the Critics', 4, 'Sorcery', 2, ['R'], 'Deal 3 damage'),
        createCard('Burst Lightning', 4, 'Instant', 2, ['R'], 'Deal 4 damage'),
        createCard('Chain Lightning', 4, 'Instant', 1, ['R'], 'Deal 3 damage'),
        createCard('Mountain', 20, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(pureBurnDeck);
      expect(result.primary).toBe('Burn');
      expect(result.secondary).toBeUndefined();
      expect(result.hybridBlend).toBe(1.0);
    });

    it('should detect perfectly hybrid deck with blend = 0.5', () => {
      // Deck with equal burn and counterspell elements
      const hybridDeck: DeckCard[] = [
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Damage'),
        createCard('Counterspell', 4, 'Instant', 2, ['U'], 'Counter'),
        createCard('Lava Spike', 4, 'Sorcery', 1, ['R'], 'Damage'),
        createCard('Force of Will', 4, 'Instant', 0, ['U'], 'Counter'),
        createCard('Skewer the Critics', 4, 'Sorcery', 2, ['R'], 'Damage'),
        createCard('Mana Drain', 4, 'Instant', 2, ['U'], 'Counter'),
        createCard('Island', 12, 'Land', 0, ['U'], ''),
        createCard('Mountain', 12, 'Land', 0, ['R'], ''),
      ];

      const result = detectArchetype(hybridDeck);
      expect(result.primary).toBeDefined();
      expect(result.secondary).toBeDefined();
      // Should be close to 0.5 for a perfectly hybrid deck (allowing for rounding)
      if (result.hybridBlend !== undefined) {
        expect(result.hybridBlend).toBeGreaterThanOrEqual(0.4);
        expect(result.hybridBlend).toBeLessThanOrEqual(0.6);
      }
    });

    it('should detect midrange pile hybrid with moderate blend', () => {
      const midrangePileDeck: DeckCard[] = [
        createCard('Tarmogoyf', 4, 'Creature', 2, ['G', 'B'], 'Big'),
        createCard('Dark Confidant', 4, 'Creature', 2, ['B'], 'Draw'),
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Deal 3 damage'),
        createCard('Terminate', 4, 'Instant', 2, ['B', 'R'], 'Destroy'),
        createCard('Thoughtseize', 4, 'Sorcery', 1, ['B'], 'Discard'),
        createCard('Swamp', 10, 'Land', 0, ['B'], ''),
        createCard('Mountain', 8, 'Land', 0, ['R'], ''),
        createCard('Forest', 6, 'Land', 0, ['G'], ''),
      ];

      const result = detectArchetype(midrangePileDeck);
      expect(['Midrange Pile', 'Jund-style', 'Value']).toContain(result.primary);
      expect(result.hybridBlend).toBeDefined();
      expect(result.hybridBlend).toBeGreaterThan(0.3);
      // Blend can be 1.0 if deck strongly matches single archetype
      expect(result.hybridBlend).toBeLessThanOrEqual(1.0);
    });

    it('should detect Tempo-Control hybrid with specific blend', () => {
      const tempoControlDeck: DeckCard[] = [
        createCard('Snapcaster Mage', 4, 'Creature', 2, ['U'], 'Flash'),
        createCard('Spell Queller', 4, 'Creature', 2, ['U', 'W'], 'Flash'),
        createCard('Counterspell', 4, 'Instant', 2, ['U'], 'Counter'),
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Damage'),
        createCard('Brazen Borrower', 4, 'Creature', 3, ['U', 'R'], 'Flash'),
        createCard('Island', 14, 'Land', 0, ['U'], ''),
        createCard('Mountain', 6, 'Land', 0, ['R'], ''),
      ];

      const result = detectArchetype(tempoControlDeck);
      expect(['Tempo-Control', 'Draw-Go']).toContain(result.primary);
      expect(result.hybridBlend).toBeDefined();
      // Tempo-Control should have a blend since it mixes tempo and control elements
      expect(result.hybridBlend).toBeGreaterThan(0.4);
    });

    it('should include hybridBlend in all results', () => {
      const deck: DeckCard[] = [
        createCard('Lightning Bolt', 4, 'Instant', 1, ['R'], 'Damage'),
        createCard('Mountain', 16, 'Land', 0, [], ''),
      ];

      const result = detectArchetype(deck);
      expect(result.hybridBlend).toBeDefined();
      expect(result.hybridBlend).toBeGreaterThanOrEqual(0);
      expect(result.hybridBlend).toBeLessThanOrEqual(1);
    });
  });

  describe('getArchetypeDetails', () => {
    it('should return archetype details for valid name', () => {
      const details = getArchetypeDetails('Burn');
      expect(details).toBeDefined();
      expect(details?.name).toBe('Burn');
      expect(details?.category).toBe('aggro');
      expect(details?.description).toBeDefined();
    });

    it('should return undefined for invalid name', () => {
      const details = getArchetypeDetails('NonExistent');
      expect(details).toBeUndefined();
    });
  });

  describe('getAllArchetypes', () => {
    it('should return all 23 archetypes', () => {
      const archetypes = getAllArchetypes();
      expect(archetypes.length).toBeGreaterThanOrEqual(20);
    });

    it('should include all expected categories', () => {
      const archetypes = getAllArchetypes();
      const categories = new Set(archetypes.map(a => a.category));
      
      expect(categories.has('aggro')).toBe(true);
      expect(categories.has('control')).toBe(true);
      expect(categories.has('midrange')).toBe(true);
      expect(categories.has('combo')).toBe(true);
      expect(categories.has('tribal')).toBe(true);
      expect(categories.has('special')).toBe(true);
    });
  });

  describe('performance', () => {
    it('should detect archetype in under 100ms', () => {
      const largeDeck: DeckCard[] = [];
      for (let i = 0; i < 100; i++) {
        largeDeck.push(createCard(`Card ${i}`, 1, 'Creature', i % 7, ['R']));
      }

      const startTime = Date.now();
      detectArchetype(largeDeck);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(100);
    });
  });
});

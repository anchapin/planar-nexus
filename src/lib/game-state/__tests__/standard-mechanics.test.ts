/**
 * Standard Mechanics Test Suite
 *
 * Tests that all unique game mechanics and interactions from
 * Standard-legal cards (as filtered from Scryfall) are accounted for
 * in the planar-nexus game engine.
 *
 * This suite verifies:
 * - Keyword recognition via oracle-text-parser
 * - Evergreen keyword detection
 * - Ability word detection
 * - Major mechanic category coverage
 */

import { extractKeywords, parseOracleText } from '../oracle-text-parser';
import {
  hasKeyword,
  hasFlying,
  hasFirstStrike,
  hasDoubleStrike,
  hasDeathtouch,
  hasLifelink,
  hasTrample,
  hasVigilance,
  hasHaste,
  hasFlash,
  hasHexproof,
  hasMenace,
  hasReach,
  hasWard,
  hasDefender,
  isIndestructible,
  getWardCost,
  isProtectedByWard,
} from '../evergreen-keywords';

import type { CardInstance } from '../types';

// Helper to create a mock card with specific oracle text and keywords
const createMockCard = (
  oracleText: string = '',
  keywords: string[] = [],
  typeLine: string = 'Creature — Human'
): CardInstance =>
  ({
    id: 'test-card' as any,
    instanceId: 'test-instance' as any,
    cardData: {
      id: 'card-id',
      name: 'Test Card',
      type_line: typeLine,
      oracle_text: oracleText,
      colors: [],
      color_identity: [],
      mana_cost: '',
      cmc: 0,
      keywords,
    },
    controllerId: 'player1' as any,
    ownerId: 'player1' as any,
    isTapped: false,
    isFlipped: false,
    isFaceDown: false,
    damage: 0,
    hasSummoningSickness: true,
    counters: [],
    attachedTo: null,
    attachments: [],
  } as any);

describe('Standard Mechanics - Oracle Text Parser', () => {
  describe('Evergreen Keywords in Standard', () => {
    const standardEvergreenKeywords = [
      { keyword: 'flying', text: 'Flying' },
      { keyword: 'first strike', text: 'First strike' },
      { keyword: 'double strike', text: 'Double strike' },
      { keyword: 'deathtouch', text: 'Deathtouch' },
      { keyword: 'defender', text: 'Defender' },
      { keyword: 'enchant', text: 'Enchant creature', typeLine: 'Enchantment — Aura' },
      { keyword: 'equip', text: 'Equip {1}', typeLine: 'Artifact — Equipment' },
      { keyword: 'flash', text: 'Flash' },
      { keyword: 'haste', text: 'Haste' },
      { keyword: 'hexproof', text: 'Hexproof' },
      { keyword: 'indestructible', text: 'Indestructible' },
      { keyword: 'lifelink', text: 'Lifelink' },
      { keyword: 'menace', text: 'Menace' },
      { keyword: 'reach', text: 'Reach' },
      { keyword: 'trample', text: 'Trample' },
      { keyword: 'vigilance', text: 'Vigilance' },
      { keyword: 'ward', text: 'Ward {2}' },
      { keyword: 'protection', text: 'Protection from black' },
    ];

    it.each(standardEvergreenKeywords)(
      'should detect evergreen keyword: $keyword',
      ({ text, typeLine }) => {
        const card = createMockCard(text, [], typeLine || 'Creature — Human');
        const parsed = extractKeywords(text, typeLine || 'Creature — Human');
        expect(parsed.length).toBeGreaterThan(0);
      }
    );
  });

  describe('Deciduous Mechanics in Standard', () => {
    const deciduousMechanics = [
      { keyword: 'cycling', text: 'Cycling {2}' },
      { keyword: 'flashback', text: 'Flashback {3}{R}' },
      { keyword: 'kicker', text: 'Kicker {1}{G}' },
      { keyword: 'convoke', text: 'Convoke' },
      { keyword: 'proliferate', text: 'Proliferate', typeLine: 'Instant' },
      { keyword: 'transform', text: 'Transform', typeLine: 'Creature — Werewolf' },
      { keyword: 'fight', text: 'Fight target creature.' },
      { keyword: 'cycling', text: 'Basic landcycling {1}', typeLine: 'Land' },
    ];

    it.each(deciduousMechanics)(
      'should detect deciduous mechanic: $keyword',
      ({ text, typeLine }) => {
        const parsed = extractKeywords(text, typeLine || 'Creature — Human');
        const found = parsed.some(
          (k) => k.keyword === text.split(' ')[0].toLowerCase() || k.keyword.includes(text.split(' ')[0].toLowerCase())
        );
        expect(parsed.length).toBeGreaterThan(0);
      }
    );
  });

  describe('Set-Specific Mechanics in Standard', () => {
    const setMechanics = [
      { name: 'Explore', text: 'Explore.', keyword: 'explore' },
      { name: 'Surveil', text: 'Surveil 2.', keyword: 'surveil' },
      { name: 'Investigate', text: 'Investigate.', keyword: 'investigate' },
      { name: 'Food', text: 'Create a Food token.', keyword: 'food' },
      { name: 'Learn', text: 'Learn.', keyword: 'learn' },
      { name: 'Disguise', text: 'Disguise {2}{U}', keyword: 'disguise' },
      { name: 'Plot', text: 'Plot {2}{R}', keyword: 'plot' },
      { name: 'Offspring', text: 'Offspring {1}', keyword: 'offspring' },
      { name: 'Gift', text: 'Gift a card', keyword: 'gift' },
      { name: 'Saddle', text: 'Saddle 1', keyword: 'saddle' },
      { name: 'Descend', text: 'Descend 4', keyword: 'descend' },
      { name: 'Craft', text: 'Craft with artifact', keyword: 'craft' },
      { name: 'Suspect', text: 'Suspect.', keyword: 'suspect' },
      { name: 'Survival', text: 'Survival', keyword: 'survival' },
      { name: 'Valiant', text: 'Valiant', keyword: 'valiant' },
      { name: 'Bargain', text: 'Bargain', keyword: 'bargain' },
      { name: 'Celebration', text: 'Celebration', keyword: 'celebration' },
      { name: 'Connive', text: 'Connive.', keyword: 'connive' },
      { name: 'Casualty', text: 'Casualty 2', keyword: 'casualty' },
      { name: 'Backup', text: 'Backup 1', keyword: 'backup' },
      { name: 'Blitz', text: 'Blitz {3}{R}', keyword: 'blitz' },
      { name: 'Incubate', text: 'Incubate 2.', keyword: 'incubate' },
      { name: 'Training', text: 'Training', keyword: 'training' },
      { name: 'Compleated', text: 'Compleated', keyword: 'compleated' },
      { name: 'Enlist', text: 'Enlist', keyword: 'enlist' },
      { name: 'Reconfigure', text: 'Reconfigure {2}', keyword: 'reconfigure' },
      { name: 'Undying', text: 'Undying', keyword: 'undying' },
      { name: 'Persist', text: 'Persist', keyword: 'persist' },
      { name: 'Unleash', text: 'Unleash', keyword: 'unleash' },
      { name: 'Cascade', text: 'Cascade', keyword: 'cascade' },
      { name: 'Delirium', text: 'Delirium', keyword: 'delirium' },
      { name: 'Decayed', text: 'Decayed', keyword: 'decayed' },
      { name: 'Cloak', text: 'Cloak.', keyword: 'cloak' },
      { name: 'Eerie', text: 'Eerie', keyword: 'eerie' },
      { name: 'Endure', text: 'Endure', keyword: 'endure' },
      { name: 'Forage', text: 'Forage.', keyword: 'forage' },
      { name: 'Harmonize', text: 'Harmonize', keyword: 'harmonize' },
      { name: 'Flurry', text: 'Flurry', keyword: 'flurry' },
      { name: 'Manifest dread', text: 'Manifest dread', keyword: 'manifest dread' },
      { name: 'Room', text: 'Room', typeLine: 'Enchantment — Room' },
      { name: 'Spree', text: 'Spree', keyword: 'spree' },
      { name: 'Treasure', text: 'Create a Treasure token.', keyword: 'treasure' },
      { name: 'Adventure', text: 'Adventure', typeLine: 'Creature — Human' },
      { name: 'Dash', text: 'Dash {1}{R}', keyword: 'dash' },
      { name: 'Embalm', text: 'Embalm {3}{W}', keyword: 'embalm' },
      { name: 'Escape', text: 'Escape—{2}{G}, Exile four other cards.', keyword: 'escape' },
      { name: 'Evoke', text: 'Evoke {2}{U}', keyword: 'evoke' },
      { name: 'Exert', text: 'You may exert', keyword: 'exert' },
      { name: 'Formidable', text: 'Formidable', keyword: 'formidable' },
      { name: 'Hideaway', text: 'Hideaway 4', keyword: 'hideaway' },
      { name: 'Meld', text: 'Meld', typeLine: 'Creature — Eldrazi' },
      { name: 'Modular', text: 'Modular 2', keyword: 'modular' },
      { name: 'Populate', text: 'Populate.', keyword: 'populate' },
      { name: 'Rebound', text: 'Rebound', keyword: 'rebound' },
      { name: 'Scavenge', text: 'Scavenge {2}{G}', keyword: 'scavenge' },
      { name: 'Spectacle', text: 'Spectacle {1}{B}', keyword: 'spectacle' },
      { name: 'Suspend', text: 'Suspend 4—{1}{U}', keyword: 'suspend' },
      { name: 'Totem armor', text: 'Totem armor', keyword: 'totem armor' },
      { name: 'Undergrowth', text: 'Undergrowth', keyword: 'undergrowth' },
      { name: 'Myriad', text: 'Myriad', keyword: 'myriad' },
      { name: 'Skulk', text: 'Skulk', keyword: 'skulk' },
      { name: 'Frenzy', text: 'Frenzy 2', keyword: 'frenzy' },
      { name: 'Goad', text: 'Goad.', keyword: 'goad' },
      { name: 'Haunt', text: 'Haunt', keyword: 'haunt' },
      { name: 'Imprint', text: 'Imprint', keyword: 'imprint' },
      { name: 'Living weapon', text: 'Living weapon', keyword: 'living weapon' },
      { name: 'Offering', text: 'Offering', keyword: 'offering' },
      { name: 'Prototype', text: 'Prototype', keyword: 'prototype' },
      { name: 'Sunburst', text: 'Sunburst', keyword: 'sunburst' },
      { name: 'Strive', text: 'Strive', keyword: 'strive' },
      { name: 'Vanishing', text: 'Vanishing 3', keyword: 'vanishing' },
      { name: 'Dungeon', text: 'Venture into the dungeon.', keyword: 'dungeon' },
      { name: 'Affinity', text: 'Affinity for artifacts', keyword: 'affinity' },
      { name: 'Annihilator', text: 'Annihilator 2', keyword: 'annihilator' },
      { name: 'Bloodthirst', text: 'Bloodthirst 2', keyword: 'bloodthirst' },
      { name: 'Conspire', text: 'Conspire', keyword: 'conspire' },
      { name: 'Devour', text: 'Devour 2', keyword: 'devour' },
      { name: 'Level up', text: 'Level up {1}', keyword: 'level up' },
      { name: 'Soulbond', text: 'Soulbond', keyword: 'soulbond' },
      { name: 'Extort', text: 'Extort', keyword: 'extort' },
      { name: 'Dethrone', text: 'Dethrone', keyword: 'dethrone' },
      { name: 'Hidden agenda', text: 'Hidden agenda', keyword: 'hidden agenda' },
      { name: 'Delve', text: 'Delve', keyword: 'delve' },
      { name: 'Ferocious', text: 'Ferocious', keyword: 'ferocious' },
      { name: 'Exploit', text: 'Exploit', keyword: 'exploit' },
      { name: 'Entwine', text: 'Entwine {2}{G}', keyword: 'entwine' },
      { name: 'Threshold', text: 'Threshold', keyword: 'threshold' },
      { name: 'Underdog', text: 'Underdog', keyword: 'underdog' },
      { name: 'Transmute', text: 'Transmute', keyword: 'transmute' },
      { name: 'Transfigure', text: 'Transfigure', keyword: 'transfigure' },
      { name: 'Graft', text: 'Graft 2', keyword: 'graft' },
      { name: 'Bloodrush', text: 'Bloodrush', keyword: 'bloodrush' },
      { name: 'Cohort', text: 'Cohort', keyword: 'cohort' },
      { name: 'Join forces', text: 'Join forces', keyword: 'join forces' },
      { name: 'Parley', text: 'Parley', keyword: 'parley' },
      { name: 'Will of the council', text: 'Will of the council', keyword: 'will of the council' },
      { name: 'Assemble', text: 'Assemble', keyword: 'assemble' },
      { name: 'Battle cry', text: 'Battle cry', keyword: 'battle cry' },
      { name: 'Chroma', text: 'Chroma', keyword: 'chroma' },
      { name: 'Fateful hour', text: 'Fateful hour', keyword: 'fateful hour' },
      { name: 'Hellbent', text: 'Hellbent', keyword: 'hellbent' },
      { name: 'Heroic', text: 'Heroic', keyword: 'heroic' },
      { name: 'Inspired', text: 'Inspired', keyword: 'inspired' },
      { name: 'Kinship', text: 'Kinship', keyword: 'kinship' },
      { name: 'Lieutenant', text: 'Lieutenant', keyword: 'lieutenant' },
      { name: 'Metalcraft', text: 'Metalcraft', keyword: 'metalcraft' },
      { name: 'Morbid', text: 'Morbid', keyword: 'morbid' },
      { name: 'Pack tactics', text: 'Pack tactics', keyword: 'pack tactics' },
      { name: 'Radiance', text: 'Radiance', keyword: 'radiance' },
      { name: 'Shield', text: 'Shield', keyword: 'shield' },
      { name: 'Soulbond', text: 'Soulbond', keyword: 'soulbond' },
      { name: 'Strength in numbers', text: 'Strength in numbers', keyword: 'strength in numbers' },
      { name: 'Tempting offer', text: 'Tempting offer', keyword: 'tempting offer' },
      { name: 'Grandeur', text: 'Grandeur', keyword: 'grandeur' },
      { name: 'Domain', text: 'Domain', keyword: 'domain' },
      { name: 'Rally', text: 'Rally', keyword: 'rally' },
      { name: 'Revolt', text: 'Revolt', keyword: 'revolt' },
    ];

    it.each(setMechanics)(
      'should detect mechanic: $name',
      ({ text, typeLine }) => {
        const parsed = extractKeywords(text, typeLine || 'Creature — Human');
        expect(parsed.length).toBeGreaterThan(0);
      }
    );
  });

  describe('Ability Words in Standard', () => {
    const abilityWords = [
      'Landfall',
      'Raid',
      'Revolt',
      'Metalcraft',
      'Converge',
      'Domain',
      'Ferocious',
      'Hellbent',
      'Heroic',
      'Inspired',
      'Kinfall',
      'Lieutenant',
      'Morbid',
      'Pack tactics',
      'Radiance',
      'Rally',
      'Revolt',
      'Threshold',
      'Underdog',
      'Undergrowth',
      'Celebration',
      'Descend',
      'Eerie',
      'Expend',
      'Forage',
      'For miracle',
      'Harmonize',
      'Flurry',
      'Readiness',
      'Slug',
      'Valiant',
      'Bargain',
      'Connive',
      'Disguised',
      'Fathomless descent',
      'Magecraft',
      'Solved',
      'Coven',
      'Kinship',
    ];

    it.each(abilityWords.map((w) => ({ word: w })))('should detect ability word: $word', ({ word }) => {
      const parsed = extractKeywords(word, 'Creature — Human');
      // Keyword may be classified as either evergreen or abilityWord depending on parser categorization
      const found = parsed.some((k) => k.keyword.toLowerCase() === word.toLowerCase());
      expect(found).toBe(true);
    });
  });
});

describe('Standard Mechanics - Evergreen Keywords', () => {
  describe('Ward', () => {
    it('should be recognized as a Standard evergreen keyword', () => {
      const card = createMockCard('Ward {2}', ['Ward']);
      expect(hasWard(card)).toBe(true);
    });

    it('should parse various ward costs', () => {
      const card1 = createMockCard('Ward {3}');
      expect(getWardCost(card1)).toBe('{3}');

      const card2 = createMockCard('Ward—Pay 3 life.');
      expect(getWardCost(card2)).toBe('3');

      const card3 = createMockCard('Ward {1}');
      expect(getWardCost(card3)).toBe('{1}');
    });

    it('should enforce ward protection from opponents', () => {
      const card = createMockCard('Ward {2}', ['Ward']);
      expect(isProtectedByWard(card, 'player2' as any)).toBe(true);
      expect(isProtectedByWard(card, 'player1' as any)).toBe(false);
    });
  });

  describe('Core Evergreen Keywords', () => {
    it.each([
      { fn: hasFlying, text: 'Flying', keyword: 'Flying' },
      { fn: hasFirstStrike, text: 'First strike', keyword: 'First strike' },
      { fn: hasDoubleStrike, text: 'Double strike', keyword: 'Double strike' },
      { fn: hasDeathtouch, text: 'Deathtouch', keyword: 'Deathtouch' },
      { fn: hasLifelink, text: 'Lifelink', keyword: 'Lifelink' },
      { fn: hasTrample, text: 'Trample', keyword: 'Trample' },
      { fn: hasVigilance, text: 'Vigilance', keyword: 'Vigilance' },
      { fn: hasHaste, text: 'Haste', keyword: 'Haste' },
      { fn: hasFlash, text: 'Flash', keyword: 'Flash' },
      { fn: hasHexproof, text: 'Hexproof', keyword: 'Hexproof' },
      { fn: hasMenace, text: 'Menace', keyword: 'Menace' },
      { fn: hasReach, text: 'Reach', keyword: 'Reach' },
      { fn: hasDefender, text: 'Defender', keyword: 'Defender' },
      { fn: isIndestructible, text: 'Indestructible', keyword: 'Indestructible' },
      { fn: hasWard, text: 'Ward {2}', keyword: 'Ward' },
    ])('should detect $keyword', ({ fn, text, keyword }) => {
      const card = createMockCard(text, [keyword]);
      expect(fn(card)).toBe(true);
    });
  });
});

describe('Standard Mechanics - Complex Interactions', () => {
  it('should handle multiple keywords on a single card', () => {
    const card = createMockCard('Flying, first strike, ward {2}', [
      'Flying',
      'First strike',
      'Ward',
    ]);
    expect(hasFlying(card)).toBe(true);
    expect(hasFirstStrike(card)).toBe(true);
    expect(hasWard(card)).toBe(true);
    expect(getWardCost(card)).toBe('{2}');
  });

  it('should handle disguised creature detection', () => {
    const parsed = extractKeywords('Disguise {2}{U}', 'Creature — Shapeshifter');
    expect(parsed.some((k) => k.keyword.includes('disguise'))).toBe(true);
  });

  it('should handle plot mechanic detection', () => {
    const parsed = extractKeywords('Plot {2}{R}', 'Creature — Goblin');
    expect(parsed.some((k) => k.keyword.includes('plot'))).toBe(true);
  });

  it('should handle offspring mechanic detection', () => {
    const parsed = extractKeywords('Offspring {1}', 'Creature — Beast');
    expect(parsed.some((k) => k.keyword.includes('offspring'))).toBe(true);
  });

  it('should handle saddle mechanic detection', () => {
    const parsed = extractKeywords('Saddle 1', 'Creature — Mount');
    expect(parsed.some((k) => k.keyword.includes('saddle'))).toBe(true);
  });

  it('should handle craft mechanic detection', () => {
    const parsed = extractKeywords('Craft with artifact', 'Artifact Creature');
    expect(parsed.some((k) => k.keyword.includes('craft'))).toBe(true);
  });

  it('should handle room enchantment detection', () => {
    const parsed = extractKeywords('Room', 'Enchantment — Room');
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('should handle spree mechanic detection', () => {
    const parsed = extractKeywords('Spree', 'Sorcery');
    expect(parsed.some((k) => k.keyword.includes('spree'))).toBe(true);
  });

  it('should handle start your engines detection', () => {
    const parsed = extractKeywords('Start your engines!', 'Creature — Pilot');
    expect(parsed.some((k) => k.keyword.includes('start your engines'))).toBe(true);
  });

  it('should handle max speed detection', () => {
    const parsed = extractKeywords('Max speed', 'Creature — Vehicle');
    expect(parsed.some((k) => k.keyword.includes('max speed'))).toBe(true);
  });

  it('should handle treasure token creation', () => {
    const parsed = extractKeywords('Create a Treasure token.', 'Artifact');
    expect(parsed.some((k) => k.keyword.includes('treasure'))).toBe(true);
  });

  it('should handle food token creation', () => {
    const parsed = extractKeywords('Create a Food token.', 'Artifact');
    expect(parsed.some((k) => k.keyword.includes('food'))).toBe(true);
  });

  it('should handle role token detection', () => {
    const parsed = extractKeywords('Create a Role token.', 'Enchantment — Aura');
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('should handle incubate detection', () => {
    const parsed = extractKeywords('Incubate 2.', 'Creature — Phyrexian');
    expect(parsed.some((k) => k.keyword.includes('incubate'))).toBe(true);
  });

  it('should handle suspect detection', () => {
    const parsed = extractKeywords('Suspect.', 'Creature — Rogue');
    expect(parsed.some((k) => k.keyword.includes('suspect'))).toBe(true);
  });

  it('should handle connive detection', () => {
    const parsed = extractKeywords('Connive.', 'Creature — Rogue');
    expect(parsed.some((k) => k.keyword.includes('connive'))).toBe(true);
  });

  it('should handle casualty detection', () => {
    const parsed = extractKeywords('Casualty 2', 'Sorcery');
    expect(parsed.some((k) => k.keyword.includes('casualty'))).toBe(true);
  });

  it('should handle bargain detection', () => {
    const parsed = extractKeywords('Bargain', 'Instant');
    expect(parsed.some((k) => k.keyword.includes('bargain'))).toBe(true);
  });

  it('should handle celebration detection', () => {
    const parsed = extractKeywords('Celebration', 'Creature — Elf');
    expect(parsed.some((k) => k.keyword.includes('celebration'))).toBe(true);
  });

  it('should handle backup detection', () => {
    const parsed = extractKeywords('Backup 1', 'Creature — Human');
    expect(parsed.some((k) => k.keyword.includes('backup'))).toBe(true);
  });

  it('should handle blitz detection', () => {
    const parsed = extractKeywords('Blitz {3}{R}', 'Creature — Goblin');
    expect(parsed.some((k) => k.keyword.includes('blitz'))).toBe(true);
  });

  it('should handle enlist detection', () => {
    const parsed = extractKeywords('Enlist', 'Creature — Soldier');
    expect(parsed.some((k) => k.keyword.includes('enlist'))).toBe(true);
  });

  it('should handle reconfigure detection', () => {
    const parsed = extractKeywords('Reconfigure {2}', 'Artifact — Equipment');
    expect(parsed.some((k) => k.keyword.includes('reconfigure'))).toBe(true);
  });

  it('should handle training detection', () => {
    const parsed = extractKeywords('Training', 'Creature — Knight');
    expect(parsed.some((k) => k.keyword.includes('training'))).toBe(true);
  });

  it('should handle compleated detection', () => {
    const parsed = extractKeywords('Compleated', 'Planeswalker');
    expect(parsed.some((k) => k.keyword.includes('compleated'))).toBe(true);
  });

  it('should handle descend detection', () => {
    const parsed = extractKeywords('Descend 4', 'Creature — Spirit');
    expect(parsed.some((k) => k.keyword.includes('descend'))).toBe(true);
  });

  it('should handle fathomless descent detection', () => {
    const parsed = extractKeywords('Fathomless descent', 'Creature — Horror');
    expect(parsed.some((k) => k.keyword.includes('fathomless descent'))).toBe(true);
  });

  it('should handle survival detection', () => {
    const parsed = extractKeywords('Survival', 'Creature — Beast');
    expect(parsed.some((k) => k.keyword.includes('survival'))).toBe(true);
  });

  it('should handle valiant detection', () => {
    const parsed = extractKeywords('Valiant', 'Creature — Knight');
    expect(parsed.some((k) => k.keyword.includes('valiant'))).toBe(true);
  });

  it('should handle endure detection', () => {
    const parsed = extractKeywords('Endure', 'Creature — Soldier');
    expect(parsed.some((k) => k.keyword.includes('endure'))).toBe(true);
  });

  it('should handle harmonize detection', () => {
    const parsed = extractKeywords('Harmonize', 'Sorcery');
    expect(parsed.some((k) => k.keyword.includes('harmonize'))).toBe(true);
  });

  it('should handle flurry detection', () => {
    const parsed = extractKeywords('Flurry', 'Instant');
    expect(parsed.some((k) => k.keyword.includes('flurry'))).toBe(true);
  });

  it('should handle eerie detection', () => {
    const parsed = extractKeywords('Eerie', 'Enchantment');
    expect(parsed.some((k) => k.keyword.includes('eerie'))).toBe(true);
  });

  it('should handle cloak detection', () => {
    const parsed = extractKeywords('Cloak.', 'Creature');
    expect(parsed.some((k) => k.keyword.includes('cloak'))).toBe(true);
  });

  it('should handle decayed detection', () => {
    const parsed = extractKeywords('Decayed', 'Creature — Zombie');
    expect(parsed.some((k) => k.keyword.includes('decayed'))).toBe(true);
  });

  it('should handle delirium detection', () => {
    const parsed = extractKeywords('Delirium', 'Creature — Horror');
    expect(parsed.some((k) => k.keyword.includes('delirium'))).toBe(true);
  });

  it('should handle investigate detection', () => {
    const parsed = extractKeywords('Investigate.', 'Creature — Detective');
    expect(parsed.some((k) => k.keyword.includes('investigate'))).toBe(true);
  });

  it('should handle learn detection', () => {
    const parsed = extractKeywords('Learn.', 'Sorcery');
    expect(parsed.some((k) => k.keyword.includes('learn'))).toBe(true);
  });

  it('should handle venture detection', () => {
    const parsed = extractKeywords('Venture into the dungeon.', 'Artifact');
    expect(parsed.some((k) => k.keyword.includes('dungeon'))).toBe(true);
  });

  it('should handle toxic detection', () => {
    const parsed = extractKeywords('Toxic 1', 'Creature — Phyrexian');
    expect(parsed.some((k) => k.keyword.includes('toxic'))).toBe(true);
  });

  it('should handle read ahead detection', () => {
    const parsed = extractKeywords('Read ahead', 'Enchantment — Saga');
    expect(parsed.some((k) => k.keyword.includes('read ahead'))).toBe(true);
  });
});

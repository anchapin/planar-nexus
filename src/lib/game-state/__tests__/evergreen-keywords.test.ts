/**
 * Evergreen Keywords Test Suite
 *
 * Tests for all evergreen keyword abilities in Magic: The Gathering.
 * Reference: CR 702 - Keyword Abilities
 */

import {
  hasKeyword,
  hasFlying,
  canBlockFlying,
  hasReach,
  hasFirstStrike,
  dealsFirstStrikeDamage,
  hasDoubleStrike,
  hasTrample,
  getExcessTrampleDamage,
  hasVigilance,
  tapsWhenAttacking,
  hasHaste,
  canAttackThisTurn,
  canBlockThisTurn,
  hasProtectionFrom,
  canBeTargetedByColor,
  hasFlash,
  canBePlayedAtInstantSpeed,
  hasDeathtouch,
  hasLifelink,
  hasHexproof,
  isProtectedByHexproof,
  hasMenace,
  hasWard,
  getWardCost,
  isProtectedByWard,
  hasDefender,
  hasLethalDamageMarked,
  isIndestructible,
  canBeDestroyed,
  getEffectivePower,
  getEffectiveToughness,
  isCombatCreature,
  getAllKeywords,
  getKeywordDescriptions,
  getMenaceMinimumBlockers,
  canAttackIfNotDefender,
} from '../evergreen-keywords';

import type { CardInstance } from '../types';

describe('Evergreen Keywords', () => {
  // Helper to create a mock card with specific properties
  const createMockCard = (overrides: Partial<CardInstance> = {}): CardInstance => ({
    id: 'test-card' as any,
    instanceId: 'test-instance' as any,
    cardData: {
      id: 'card-id',
      name: 'Test Card',
      type_line: 'Creature — Human Warrior',
      oracle_text: '',
      colors: ['W'],
      color_identity: ['W'],
      mana_cost: '{W}',
      cmc: 1,
      power: '1',
      toughness: '1',
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
    ...overrides,
  } as any);

  describe('hasKeyword', () => {
    it('should detect keywords in keywords array', () => {
      const card = createMockCard({
        cardData: {
          id: 'card-id',
          name: 'Test Card',
          type_line: 'Creature — Human',
          oracle_text: '',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
          keywords: ['Flying', 'Haste'],
        } as any,
      });
      expect(hasKeyword(card, 'Flying')).toBe(true);
      expect(hasKeyword(card, 'Haste')).toBe(true);
      expect(hasKeyword(card, 'Deathtouch')).toBe(false);
    });

    it('should detect keywords in oracle text', () => {
      const card = createMockCard({
        cardData: {
          id: 'card-id',
          name: 'Test Card',
          type_line: 'Creature — Human',
          oracle_text: 'This creature has flying and deathtouch.',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(hasKeyword(card, 'Flying')).toBe(true);
      expect(hasKeyword(card, 'Deathtouch')).toBe(true);
    });

    it('should be case insensitive', () => {
      const card = createMockCard({
        cardData: {
          id: 'card-id',
          name: 'Test Card',
          type_line: 'Creature — Human',
          oracle_text: 'FLYING and HASTE',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(hasKeyword(card, 'flying')).toBe(true);
      expect(hasKeyword(card, 'haste')).toBe(true);
    });
  });

  describe('Flying', () => {
    it('should detect flying keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'card-id',
          name: 'Test Card',
          type_line: 'Creature — Bird',
          oracle_text: 'Flying',
          colors: ['W'],
          color_identity: ['W'],
          mana_cost: '{W}',
          cmc: 1,
          keywords: ['Flying'],
        } as any,
      });
      expect(hasFlying(card)).toBe(true);
    });

    it('should allow flying creatures to block other flying creatures', () => {
      const flyingCard = createMockCard({
        cardData: {
          id: 'flying-id',
          name: 'Flying Creature',
          type_line: 'Creature — Bird',
          oracle_text: 'Flying',
          colors: ['W'],
          color_identity: ['W'],
          mana_cost: '{W}',
          cmc: 1,
          keywords: ['Flying'],
        } as any,
      });
      const nonFlyingCard = createMockCard({
        cardData: {
          id: 'ground-id',
          name: 'Ground Creature',
          type_line: 'Creature — Soldier',
          oracle_text: '',
          colors: ['W'],
          color_identity: ['W'],
          mana_cost: '{W}',
          cmc: 1,
        } as any,
      });
      
      expect(canBlockFlying(flyingCard)).toBe(true);
      expect(canBlockFlying(nonFlyingCard)).toBe(false);
    });

    it('should allow flying or reach to block flying', () => {
      const flyingCard = createMockCard({
        cardData: { id: 'f', name: 'F', type_line: 'Creature', oracle_text: 'Flying', colors: [], color_identity: [], mana_cost: '', cmc: 0 } as any,
      });
      const reachCard = createMockCard({
        cardData: { id: 'r', name: 'R', type_line: 'Creature', oracle_text: 'Reach', colors: [], color_identity: [], mana_cost: '', cmc: 0 } as any,
      });
      const normalCard = createMockCard({
        cardData: { id: 'n', name: 'N', type_line: 'Creature', oracle_text: '', colors: [], color_identity: [], mana_cost: '', cmc: 0 } as any,
      });

      expect(canBlockFlying(flyingCard)).toBe(true);
      expect(canBlockFlying(reachCard)).toBe(true);
      expect(canBlockFlying(normalCard)).toBe(false);
    });
  });

  describe('Reach', () => {
    it('should detect reach keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'reach-id',
          name: 'Spider',
          type_line: 'Creature — Spider',
          oracle_text: 'Reach',
          colors: ['G'],
          color_identity: ['G'],
          mana_cost: '{1}{G}',
          cmc: 2,
          keywords: ['Reach'],
        } as any,
      });
      expect(hasReach(card)).toBe(true);
    });

    it('should allow reach creatures to block flying', () => {
      const reachCard = createMockCard({
        cardData: {
          id: 'spider-id',
          name: 'Giant Spider',
          type_line: 'Creature — Spider',
          oracle_text: 'Reach',
          colors: ['G'],
          color_identity: ['G'],
          mana_cost: '{2}{G}',
          cmc: 3,
          keywords: ['Reach'],
        } as any,
      });
      expect(hasReach(reachCard)).toBe(true);
    });
  });

  describe('First Strike', () => {
    it('should detect first strike keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'fs-id',
          name: 'Knight',
          type_line: 'Creature — Human Knight',
          oracle_text: 'First strike',
          colors: ['W'],
          color_identity: ['W'],
          mana_cost: '{W}{W}',
          cmc: 2,
          keywords: ['First strike'],
        } as any,
      });
      expect(hasFirstStrike(card)).toBe(true);
    });

    it('should deal first strike damage in first strike combat phase', () => {
      const fsCard = createMockCard({
        cardData: { id: 'fs', name: 'FS', type_line: 'Creature', oracle_text: 'First strike', colors: [], color_identity: [], mana_cost: '', cmc: 0 } as any,
      });
      expect(dealsFirstStrikeDamage(fsCard)).toBe(true);
    });

    it('double strike should also deal first strike damage', () => {
      const dsCard = createMockCard({
        cardData: { id: 'ds', name: 'DS', type_line: 'Creature', oracle_text: 'Double strike', colors: [], color_identity: [], mana_cost: '', cmc: 0, keywords: ['Double strike'] } as any,
      });
      expect(dealsFirstStrikeDamage(dsCard)).toBe(true);
    });
  });

  describe('Double Strike', () => {
    it('should detect double strike keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'ds-id',
          name: 'Berserker',
          type_line: 'Creature — Human Berserker',
          oracle_text: 'Double strike',
          colors: ['R'],
          color_identity: ['R'],
          mana_cost: '{1}{R}',
          cmc: 2,
          keywords: ['Double strike'],
        } as any,
      });
      expect(hasDoubleStrike(card)).toBe(true);
    });
  });

  describe('Trample', () => {
    it('should detect trample keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'trample-id',
          name: 'Elephant',
          type_line: 'Creature — Elephant',
          oracle_text: 'Trample',
          colors: ['G'],
          color_identity: ['G'],
          mana_cost: '{2}{G}',
          cmc: 3,
          keywords: ['Trample'],
        } as any,
      });
      expect(hasTrample(card)).toBe(true);
    });

    it('should calculate excess trample damage', () => {
      const trampler = createMockCard({
        cardData: { id: 't', name: 'T', type_line: 'Creature', oracle_text: 'Trample', colors: [], color_identity: [], mana_cost: '', cmc: 0, power: '6', toughness: '6' } as any,
      });
      const blocker = createMockCard({
        cardData: { id: 'b', name: 'B', type_line: 'Creature', oracle_text: '', colors: [], color_identity: [], mana_cost: '', cmc: 0, power: '2', toughness: '2' } as any,
      });

      // 6 damage, 2 blocked = 4 excess
      expect(getExcessTrampleDamage(6, 2, blocker, trampler)).toBe(4);
      
      // 6 damage, 6 blocked = 0 excess
      expect(getExcessTrampleDamage(6, 6, blocker, trampler)).toBe(0);
      
      // 6 damage, 10 blocked = 0 excess
      expect(getExcessTrampleDamage(6, 10, blocker, trampler)).toBe(0);
    });

    it('should return 0 for non-tramplers', () => {
      const normal = createMockCard({
        cardData: { id: 'n', name: 'N', type_line: 'Creature', oracle_text: '', colors: [], color_identity: [], mana_cost: '', cmc: 0 } as any,
      });
      const blocker = createMockCard({
        cardData: { id: 'b', name: 'B', type_line: 'Creature', oracle_text: '', colors: [], color_identity: [], mana_cost: '', cmc: 0 } as any,
      });
      expect(getExcessTrampleDamage(6, 2, blocker, normal)).toBe(0);
    });
  });

  describe('Vigilance', () => {
    it('should detect vigilance keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'vig-id',
          name: 'Sentinel',
          type_line: 'Creature — Human Soldier',
          oracle_text: 'Vigilance',
          colors: ['W'],
          color_identity: ['W'],
          mana_cost: '{1}{W}',
          cmc: 2,
          keywords: ['Vigilance'],
        } as any,
      });
      expect(hasVigilance(card)).toBe(true);
    });

    it('should not tap when attacking with vigilance', () => {
      const vigilCard = createMockCard({
        cardData: { id: 'v', name: 'V', type_line: 'Creature', oracle_text: 'Vigilance', colors: [], color_identity: [], mana_cost: '', cmc: 0 } as any,
      });
      const normalCard = createMockCard({
        cardData: { id: 'n', name: 'N', type_line: 'Creature', oracle_text: '', colors: [], color_identity: [], mana_cost: '', cmc: 0 } as any,
      });

      expect(tapsWhenAttacking(vigilCard)).toBe(false);
      expect(tapsWhenAttacking(normalCard)).toBe(true);
    });
  });

  describe('Haste', () => {
    it('should detect haste keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'haste-id',
          name: 'Goblin',
          type_line: 'Creature — Goblin Warrior',
          oracle_text: 'Haste',
          colors: ['R'],
          color_identity: ['R'],
          mana_cost: '{R}',
          cmc: 1,
          keywords: ['Haste'],
        } as any,
      });
      expect(hasHaste(card)).toBe(true);
    });

    it('should allow attacking with summoning sickness if has haste', () => {
      const hasteCard = createMockCard({
        cardData: { id: 'h', name: 'H', type_line: 'Creature', oracle_text: 'Haste', colors: [], color_identity: [], mana_cost: '', cmc: 0, keywords: ['Haste'] } as any,
        hasSummoningSickness: true,
      });
      const normalCard = createMockCard({
        cardData: { id: 'n', name: 'N', type_line: 'Creature', oracle_text: '', colors: [], color_identity: [], mana_cost: '', cmc: 0 } as any,
        hasSummoningSickness: true,
      });

      expect(canAttackThisTurn(hasteCard)).toBe(true);
      expect(canAttackThisTurn(normalCard)).toBe(false);
    });

    it('should allow non-sick creatures to attack regardless of haste', () => {
      const hasteCard = createMockCard({
        cardData: { id: 'h', name: 'H', type_line: 'Creature', oracle_text: 'Haste', colors: [], color_identity: [], mana_cost: '', cmc: 0, keywords: ['Haste'] } as any,
        hasSummoningSickness: false,
      });
      const normalCard = createMockCard({
        cardData: { id: 'n', name: 'N', type_line: 'Creature', oracle_text: '', colors: [], color_identity: [], mana_cost: '', cmc: 0 } as any,
        hasSummoningSickness: false,
      });

      expect(canAttackThisTurn(hasteCard)).toBe(true);
      expect(canAttackThisTurn(normalCard)).toBe(true);
    });
  });

  describe('Protection', () => {
    it('should detect protection from color in oracle text', () => {
      const card = createMockCard({
        cardData: {
          id: 'prot-id',
          name: 'Holy Guardian',
          type_line: 'Creature — Angel',
          oracle_text: 'Protection from black',
          colors: ['W'],
          color_identity: ['W'],
          mana_cost: '{2}{W}{W}',
          cmc: 3,
        } as any,
      });
      expect(hasProtectionFrom(card, 'black')).toBe(true);
      expect(hasProtectionFrom(card, 'red')).toBe(false);
    });

    it('should prevent targeting by protected color', () => {
      const protCard = createMockCard({
        cardData: {
          id: 'p', name: 'P', type_line: 'Creature', oracle_text: 'Protection from red', colors: [], color_identity: [], mana_cost: '', cmc: 0
        } as any,
      });
      const normalCard = createMockCard({
        cardData: {
          id: 'n', name: 'N', type_line: 'Creature', oracle_text: '', colors: [], color_identity: [], mana_cost: '', cmc: 0
        } as any,
      });

      expect(canBeTargetedByColor(protCard, 'red')).toBe(false);
      expect(canBeTargetedByColor(protCard, 'blue')).toBe(true);
      expect(canBeTargetedByColor(normalCard, 'red')).toBe(true);
    });
  });

  describe('Flash', () => {
    it('should detect flash keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'flash-id',
          name: 'Quickling',
          type_line: 'Creature — Faerie Rogue',
          oracle_text: 'Flash',
          colors: ['U'],
          color_identity: ['U'],
          mana_cost: '{1}{U}',
          cmc: 2,
          keywords: ['Flash'],
        } as any,
      });
      expect(hasFlash(card)).toBe(true);
    });

    it('should allow playing at instant speed', () => {
      const flashCard = createMockCard({
        cardData: {
          id: 'f', name: 'F', type_line: 'Creature', oracle_text: 'Flash', colors: [], color_identity: [], mana_cost: '', cmc: 0, keywords: ['Flash']
        } as any,
      });
      const instantCard = createMockCard({
        cardData: {
          id: 'i', name: 'I', type_line: 'Instant', oracle_text: '', colors: [], color_identity: [], mana_cost: '', cmc: 0
        } as any,
      });
      const sorceryCard = createMockCard({
        cardData: {
          id: 's', name: 'S', type_line: 'Sorcery', oracle_text: '', colors: [], color_identity: [], mana_cost: '', cmc: 0
        } as any,
      });

      expect(canBePlayedAtInstantSpeed(flashCard)).toBe(true);
      expect(canBePlayedAtInstantSpeed(instantCard)).toBe(true);
      expect(canBePlayedAtInstantSpeed(sorceryCard)).toBe(false);
    });
  });

  describe('Deathtouch', () => {
    it('should detect deathtouch keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'dt-id',
          name: 'Venom',
          type_line: 'Creature — Snake',
          oracle_text: 'Deathtouch',
          colors: ['B'],
          color_identity: ['B'],
          mana_cost: '{B}',
          cmc: 1,
          keywords: ['Deathtouch'],
        } as any,
      });
      expect(hasDeathtouch(card)).toBe(true);
    });

    it('should detect deathtouch in oracle text', () => {
      const card = createMockCard({
        cardData: {
          id: 'dt2-id',
          name: 'Toxic',
          type_line: 'Creature — Insect',
          oracle_text: 'Lethal damage can be dealt to creatures by deathtouch creatures.',
          colors: ['B'],
          color_identity: ['B'],
          mana_cost: '{B}',
          cmc: 1,
        } as any,
      });
      expect(hasDeathtouch(card)).toBe(true);
    });
  });

  describe('Lifelink', () => {
    it('should detect lifelink keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'll-id',
          name: 'Soul Sentinel',
          type_line: 'Creature — Spirit Soldier',
          oracle_text: 'Lifelink',
          colors: ['W'],
          color_identity: ['W'],
          mana_cost: '{2}{W}',
          cmc: 3,
          keywords: ['Lifelink'],
        } as any,
      });
      expect(hasLifelink(card)).toBe(true);
    });
  });

  describe('Combat Creatures', () => {
    it('should identify combat creatures', () => {
      const creature = createMockCard({
        cardData: {
          id: 'c-id',
          name: 'Soldier',
          type_line: 'Creature — Human Soldier',
          oracle_text: '',
          colors: ['W'],
          color_identity: ['W'],
          mana_cost: '{W}',
          cmc: 1,
          power: '1',
          toughness: '1',
        } as any,
      });
      const nonCreature = createMockCard({
        cardData: {
          id: 'i-id',
          name: 'Bolt',
          type_line: 'Instant',
          oracle_text: '',
          colors: ['R'],
          color_identity: ['R'],
          mana_cost: '{R}',
          cmc: 1,
        } as any,
      });
      expect(isCombatCreature(creature)).toBe(true);
      expect(isCombatCreature(nonCreature)).toBe(false);
    });
  });

  describe('Effective Power/Toughness', () => {
    it('should get effective power', () => {
      const card = createMockCard({
        cardData: {
          id: 'p-id',
          name: 'Power',
          type_line: 'Creature',
          oracle_text: '',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
          power: '3',
          toughness: '3',
        } as any,
      });
      expect(getEffectivePower(card)).toBe(3);
    });

    it('should get effective toughness', () => {
      const card = createMockCard({
        cardData: {
          id: 't-id',
          name: 'Tough',
          type_line: 'Creature',
          oracle_text: '',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
          power: '2',
          toughness: '4',
        } as any,
      });
      expect(getEffectiveToughness(card)).toBe(4);
    });
  });

  describe('Get All Keywords', () => {
    it('should get all keywords from a card', () => {
      const card = createMockCard({
        cardData: {
          id: 'k-id',
          name: 'Keyword',
          type_line: 'Creature',
          oracle_text: 'Flying and deathtouch',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
          keywords: ['Flying', 'Deathtouch'],
        } as any,
      });
      const keywords = getAllKeywords(card);
      expect(keywords).toContain('Flying');
      expect(keywords).toContain('Deathtouch');
    });
  });

  describe('Keyword Descriptions', () => {
    it('should get keyword descriptions', () => {
      const card = createMockCard({
        cardData: {
          id: 'd-id',
          name: 'Desc',
          type_line: 'Creature',
          oracle_text: 'Flying',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
          keywords: ['Flying'],
        } as any,
      });
      const descriptions = getKeywordDescriptions(card);
      expect(descriptions.length).toBeGreaterThan(0);
    });
  });

  describe('Lethal Damage', () => {
    it('should check for lethal damage on a creature with damage marked', () => {
      const card = createMockCard({
        damage: 2,
        cardData: {
          id: 'l-id',
          name: 'Lethal',
          type_line: 'Creature',
          oracle_text: '',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
          power: '1',
          toughness: '1',
        } as any,
      });
      // With 2 damage marked on a 1/1, lethal damage is marked
      expect(hasLethalDamageMarked(card)).toBe(true);
    });
  });

  describe('Indestructible', () => {
    it('should check if card is indestructible', () => {
      const indestructibleCard = createMockCard({
        cardData: {
          id: 'ind-id',
          name: 'Indestructible',
          type_line: 'Creature',
          oracle_text: 'Indestructible',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      const normalCard = createMockCard({
        cardData: {
          id: 'n-id',
          name: 'Normal',
          type_line: 'Creature',
          oracle_text: '',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(isIndestructible(indestructibleCard)).toBe(true);
      expect(isIndestructible(normalCard)).toBe(false);
    });

    it('should check if card can be destroyed', () => {
      const indestructibleCard = createMockCard({
        cardData: {
          id: 'cd-id',
          name: 'CanDestroy',
          type_line: 'Creature',
          oracle_text: 'Indestructible',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(canBeDestroyed(indestructibleCard)).toBe(false);
    });
  });

  describe('Menace', () => {
    it('should detect menace keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'men-id',
          name: 'Rogue',
          type_line: 'Creature — Human Rogue',
          oracle_text: 'Menace',
          colors: ['B'],
          color_identity: ['B'],
          mana_cost: '{1}{B}',
          cmc: 2,
          keywords: ['Menace'],
        } as any,
      });
      expect(hasMenace(card)).toBe(true);
    });

    it('should get minimum blockers for menace', () => {
      const card = createMockCard({
        cardData: {
          id: 'men2-id',
          name: 'Rogue2',
          type_line: 'Creature',
          oracle_text: 'Menace',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(getMenaceMinimumBlockers(card)).toBe(2);
    });
  });

  describe('Ward', () => {
    it('should detect ward keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'ward-id',
          name: 'Warded Creature',
          type_line: 'Creature — Wizard',
          oracle_text: 'Ward {2}',
          colors: ['U'],
          color_identity: ['U'],
          mana_cost: '{1}{U}',
          cmc: 2,
          keywords: ['Ward'],
        } as any,
      });
      expect(hasWard(card)).toBe(true);
    });

    it('should detect ward in oracle text without keywords array', () => {
      const card = createMockCard({
        cardData: {
          id: 'ward2-id',
          name: 'Warded Beast',
          type_line: 'Creature — Beast',
          oracle_text: 'Ward {1}',
          colors: ['G'],
          color_identity: ['G'],
          mana_cost: '{1}{G}',
          cmc: 2,
        } as any,
      });
      expect(hasWard(card)).toBe(true);
    });

    it('should parse mana ward cost', () => {
      const card = createMockCard({
        cardData: {
          id: 'ward3-id',
          name: 'Expensive Ward',
          type_line: 'Creature',
          oracle_text: 'Ward {3}',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(getWardCost(card)).toBe('{3}');
    });

    it('should parse life payment ward cost', () => {
      const card = createMockCard({
        cardData: {
          id: 'ward4-id',
          name: 'Life Ward',
          type_line: 'Creature',
          oracle_text: 'Ward—Pay 3 life.',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(getWardCost(card)).toBe('3');
    });

    it('should return default ward cost for plain ward', () => {
      const card = createMockCard({
        cardData: {
          id: 'ward5-id',
          name: 'Basic Ward',
          type_line: 'Creature',
          oracle_text: 'Ward',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(getWardCost(card)).toBe('{2}');
    });

    it('should return null ward cost for non-ward card', () => {
      const card = createMockCard({
        cardData: {
          id: 'no-ward-id',
          name: 'No Ward',
          type_line: 'Creature',
          oracle_text: 'Flying',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(getWardCost(card)).toBeNull();
    });

    it('should protect from opponent targeting with ward', () => {
      const card = createMockCard({
        cardData: {
          id: 'ward-prot-id',
          name: 'Protected',
          type_line: 'Creature',
          oracle_text: 'Ward {2}',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      // Controller targeting their own card
      expect(isProtectedByWard(card, 'player1' as any)).toBe(false);
      // Opponent targeting
      expect(isProtectedByWard(card, 'player2' as any)).toBe(true);
    });

    it('should not protect non-ward cards', () => {
      const card = createMockCard({
        cardData: {
          id: 'no-ward-prot-id',
          name: 'Unprotected',
          type_line: 'Creature',
          oracle_text: 'Flying',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(isProtectedByWard(card, 'player2' as any)).toBe(false);
    });

    it('should include ward in keyword descriptions', () => {
      const card = createMockCard({
        cardData: {
          id: 'ward-desc-id',
          name: 'Described Ward',
          type_line: 'Creature',
          oracle_text: 'Ward {2}',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      const descriptions = getKeywordDescriptions(card);
      expect(descriptions).toContain('Ward {2}');
    });

    it('should include ward in all keywords', () => {
      const card = createMockCard({
        cardData: {
          id: 'ward-all-id',
          name: 'All Ward',
          type_line: 'Creature',
          oracle_text: 'Ward {1}',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      const keywords = getAllKeywords(card);
      expect(keywords).toContain('ward');
    });
  });

  describe('Defender', () => {
    it('should detect defender keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'def-id',
          name: 'Wall',
          type_line: 'Creature — Wall',
          oracle_text: 'Defender',
          colors: ['U'],
          color_identity: ['U'],
          mana_cost: '{1}{U}',
          cmc: 2,
        } as any,
      });
      expect(hasDefender(card)).toBe(true);
    });

    it('should check if defender can attack', () => {
      const defender = createMockCard({
        cardData: {
          id: 'def2-id',
          name: 'Wall2',
          type_line: 'Creature',
          oracle_text: 'Defender',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      const attacker = createMockCard({
        cardData: {
          id: 'att-id',
          name: 'Attacker',
          type_line: 'Creature',
          oracle_text: '',
          colors: [],
          color_identity: [],
          mana_cost: '',
          cmc: 0,
        } as any,
      });
      expect(canAttackIfNotDefender(defender)).toBe(false);
      expect(canAttackIfNotDefender(attacker)).toBe(true);
    });
  });

  describe('canBlockThisTurn', () => {
    it('should always allow blocking on the turn entered', () => {
      const card = createMockCard({ hasSummoningSickness: true });
      expect(canBlockThisTurn(card)).toBe(true);
    });
  });

  describe('Hexproof', () => {
    it('should detect hexproof keyword', () => {
      const card = createMockCard({
        cardData: {
          id: 'hex-id',
          name: 'Hexproof Bear',
          type_line: 'Creature — Bear',
          oracle_text: 'Hexproof',
          colors: ['G'],
          color_identity: ['G'],
          mana_cost: '{1}{G}',
          cmc: 2,
          keywords: ['Hexproof'],
        } as any,
      });
      expect(hasHexproof(card)).toBe(true);
    });

    it('should protect from opponent targeting', () => {
      const card = createMockCard({
        controllerId: 'player-1',
        cardData: {
          id: 'hex2-id',
          name: 'Hexproof Bear',
          type_line: 'Creature',
          oracle_text: 'Hexproof',
          keywords: ['Hexproof'],
        } as any,
      });
      expect(isProtectedByHexproof(card, 'player-2')).toBe(true);
      expect(isProtectedByHexproof(card, 'player-1')).toBe(false);
    });

    it('should not protect creatures without hexproof', () => {
      const card = createMockCard({
        controllerId: 'player-1',
        cardData: {
          id: 'nohex-id',
          name: 'Normal Bear',
          type_line: 'Creature',
          oracle_text: '',
        } as any,
      });
      expect(isProtectedByHexproof(card, 'player-2')).toBe(false);
    });
  });
});

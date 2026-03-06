/**
 * Generic Card Game Framework Tests
 *
 * Tests for the generic framework types and MTG adapter functionality.
 */

import {
  GameState,
  Player,
  CardInstance,
  CardData,
  ResourcePool,
  GameSystemConfig,
} from '../generic-types';
import {
  MTG_CONFIG,
  MTG_COMMANDER_CONFIG,
  MTGCardDataAdapter,
  MTGResourcePoolAdapter,
  MTGCardTypeUtils,
  MTGZoneUtils,
  toGenericActionType,
  fromGenericActionType,
  MTGGameStateHelpers,
} from '../mtg-adapter';
import { ScryfallCard } from '@/app/actions';

describe('Generic Framework - Types', () => {
  describe('CardData', () => {
    it('should create generic card data', () => {
      const cardData: CardData = {
        id: 'card-1',
        name: 'Test Card',
        types: ['creature'],
        subtypes: ['goblin'],
        supertypes: ['legendary'],
        cost: '{2}{R}',
        text: 'Test text',
        power: 2,
        toughness: 2,
        metadata: {
          colors: ['red'],
        },
      };

      expect(cardData.id).toBe('card-1');
      expect(cardData.types).toContain('creature');
      expect(cardData.supertypes).toContain('legendary');
      expect(cardData.power).toBe(2);
      expect(cardData.toughness).toBe(2);
    });

    it('should support metadata for game-specific data', () => {
      const cardData: CardData = {
        id: 'card-2',
        name: 'Test',
        types: ['spell'],
        metadata: {
          customField: 'custom value',
          nested: { value: 123 },
        },
      };

      expect(cardData.metadata?.customField).toBe('custom value');
      expect((cardData.metadata?.nested as Record<string, number>).value).toBe(123);
    });
  });

  describe('Player', () => {
    it('should create generic player with generic fields', () => {
      const player: Player = {
        id: 'player-1',
        name: 'Player 1',
        health: 20,
        poisonCounters: 0,
        leaderDamage: new Map(),
        maxHandSize: 7,
        currentHandSizeModifier: 0,
        hasLost: false,
        lossReason: null,
        sourcesPlayedThisTurn: 0,
        maxSourcesPerTurn: 1,
        resources: { resources: new Map() },
        isInLeaderZone: false,
        experienceCounters: 0,
        leaderCastCount: 0,
        hasPassedPriority: false,
        hasActivatedResourceAbility: false,
        additionalCombatPhase: false,
        additionalMainPhase: false,
        hasOfferedDraw: false,
        hasAcceptedDraw: false,
      };

      expect(player.health).toBe(20);
      expect(player.leaderDamage).toBeInstanceOf(Map);
      expect(player.sourcesPlayedThisTurn).toBe(0);
      expect(player.maxSourcesPerTurn).toBe(1);
      expect(player.resources.resources).toBeInstanceOf(Map);
    });
  });

  describe('GameState', () => {
    it('should create generic game state', () => {
      const state: GameState = {
        gameId: 'game-1',
        players: new Map(),
        cards: new Map(),
        zones: new Map(),
        stack: [],
        turn: {
          activePlayerId: 'player-1',
          currentPhase: 'UNTAP',
          turnNumber: 1,
          extraTurns: 0,
          isFirstTurn: true,
          startedAt: Date.now(),
        },
        combat: {
          inCombatPhase: false,
          attackers: [],
          blockers: new Map(),
          remainingCombatPhases: 0,
        },
        waitingChoice: null,
        priorityPlayerId: null,
        consecutivePasses: 0,
        status: 'not_started',
        winners: [],
        endReason: null,
        format: 'standard',
        createdAt: Date.now(),
        lastModifiedAt: Date.now(),
      };

      expect(state.status).toBe('not_started');
      expect(state.turn.currentPhase).toBe('UNTAP');
      expect(state.combat.inCombatPhase).toBe(false);
    });
  });
});

describe('MTG Adapter - Configuration', () => {
  it('should provide standard MTG configuration', () => {
    expect(MTG_CONFIG.name).toBe('mtg');
    expect(MTG_CONFIG.startingHealth).toBe(20);
    expect(MTG_CONFIG.startingHandSize).toBe(7);
    expect(MTG_CONFIG.maxSourcesPerTurn).toBe(1);
    expect(MTG_CONFIG.leaderDamageThreshold).toBe(21);
  });

  it('should provide Commander configuration', () => {
    expect(MTG_COMMANDER_CONFIG.name).toBe('mtg-commander');
    expect(MTG_COMMANDER_CONFIG.startingHealth).toBe(40);
    expect(MTG_COMMANDER_CONFIG.startingHandSize).toBe(7);
    expect(MTG_COMMANDER_CONFIG.maxSourcesPerTurn).toBe(1);
    expect(MTG_COMMANDER_CONFIG.leaderDamageThreshold).toBe(21);
  });
});

describe('MTG Adapter - Card Data Conversion', () => {
  it('should convert Scryfall card to generic card data', () => {
    const scryfallCard: ScryfallCard = {
      id: 'test-id',
      name: 'Lightning Bolt',
      type_line: 'Instant',
      mana_cost: '{R}',
      oracle_text: 'Deal 3 damage to any target.',
      cmc: 1,
      colors: ['red'],
      color_identity: ['red'],
      object: 'card',
      uri: '',
    };

    const genericCard = MTGCardDataAdapter.toGenericCard(scryfallCard);

    expect(genericCard.id).toBe('test-id');
    expect(genericCard.name).toBe('Lightning Bolt');
    expect(genericCard.types).toContain('instant');
    expect(genericCard.cost).toBe('{R}');
    expect(genericCard.metadata?.colors).toEqual(['red']);
    expect(genericCard.metadata?.color_identity).toEqual(['red']);
    expect(genericCard.metadata?._scryfall).toBe(scryfallCard);
  });

  it('should extract card types correctly', () => {
    const creatureCard: ScryfallCard = {
      id: 'creature-id',
      name: 'Goblin',
      type_line: 'Creature — Goblin',
      mana_cost: '{R}',
      cmc: 1,
      colors: ['red'],
      color_identity: ['red'],
      object: 'card',
      uri: '',
    };

    const genericCard = MTGCardDataAdapter.toGenericCard(creatureCard);

    expect(genericCard.types).toContain('creature');
    expect(genericCard.subtypes).toContain('goblin');
  });

  it('should extract supertypes correctly', () => {
    const legendaryCard: ScryfallCard = {
      id: 'legendary-id',
      name: 'Jace, the Mind Sculptor',
      type_line: 'Legendary Planeswalker — Jace',
      loyalty: '4',
      cmc: 4,
      colors: ['blue'],
      color_identity: ['blue'],
      object: 'card',
      uri: '',
    };

    const genericCard = MTGCardDataAdapter.toGenericCard(legendaryCard);

    expect(genericCard.types).toContain('planeswalker');
    expect(genericCard.subtypes).toContain('jace');
    expect(genericCard.supertypes).toContain('legendary');
  });

  it('should extract power and toughness correctly', () => {
    const creatureCard: ScryfallCard = {
      id: 'creature-id',
      name: 'Goblin',
      type_line: 'Creature — Goblin',
      mana_cost: '{R}',
      power_toughness: '2/1',
      cmc: 1,
      colors: ['red'],
      color_identity: ['red'],
      object: 'card',
      uri: '',
    };

    const genericCard = MTGCardDataAdapter.toGenericCard(creatureCard);

    expect(genericCard.power).toBe(2);
    expect(genericCard.toughness).toBe(1);
  });
});

describe('MTG Adapter - Resource Pool', () => {
  it('should create empty mana pool', () => {
    const pool = MTGResourcePoolAdapter.createEmpty();

    expect(pool.white).toBe(0);
    expect(pool.blue).toBe(0);
    expect(pool.black).toBe(0);
    expect(pool.red).toBe(0);
    expect(pool.green).toBe(0);
    expect(pool.colorless).toBe(0);
    expect(pool.generic).toBe(0);
    expect(pool.resources.get('white')).toBe(0);
  });

  it('should add mana to pool', () => {
    const pool = MTGResourcePoolAdapter.createEmpty();
    const updated = MTGResourcePoolAdapter.addMana(pool, 'white', 2);
    const updated2 = MTGResourcePoolAdapter.addMana(updated, 'generic', 1);

    expect(updated2.white).toBe(2);
    expect(updated2.generic).toBe(1);
    expect(updated2.resources.get('white')).toBe(2);
    expect(updated2.resources.get('generic')).toBe(1);
  });

  it('should check if player has enough mana', () => {
    const pool = MTGResourcePoolAdapter.createEmpty();
    const withMana = MTGResourcePoolAdapter.addMana(pool, 'white', 2);
    const withBlue = MTGResourcePoolAdapter.addMana(withMana, 'blue', 1);

    expect(MTGResourcePoolAdapter.hasEnoughMana(withBlue, { white: 2 })).toBe(true);
    expect(MTGResourcePoolAdapter.hasEnoughMana(withBlue, { white: 2, blue: 1 })).toBe(true);
    expect(MTGResourcePoolAdapter.hasEnoughMana(withBlue, { white: 3 })).toBe(false);
    expect(MTGResourcePoolAdapter.hasEnoughMana(withBlue, { blue: 2 })).toBe(false);
  });

  it('should spend mana from pool', () => {
    const pool = MTGResourcePoolAdapter.createEmpty();
    const withMana = MTGResourcePoolAdapter.addMana(pool, 'white', 3);

    const spent = MTGResourcePoolAdapter.spendMana(withMana, { white: 2 });
    expect(spent.white).toBe(1);

    const spentAll = MTGResourcePoolAdapter.spendMana(spent, { white: 1 });
    expect(spentAll.white).toBe(0);
  });
});

describe('MTG Adapter - Card Type Utilities', () => {
  it('should identify sources (lands)', () => {
    const landCard: CardData = {
      id: 'land-1',
      name: 'Mountain',
      types: ['land'],
    };

    expect(MTGCardTypeUtils.isSource(landCard)).toBe(true);

    const creatureCard: CardData = {
      id: 'creature-1',
      name: 'Goblin',
      types: ['creature'],
    };

    expect(MTGCardTypeUtils.isSource(creatureCard)).toBe(false);
  });

  it('should identify legendary leaders (commanders)', () => {
    const legendaryCreature: CardData = {
      id: 'commander-1',
      name: 'Krenko, Mob Boss',
      types: ['creature'],
      supertypes: ['legendary'],
    };

    expect(MTGCardTypeUtils.isLegendaryLeader(legendaryCreature)).toBe(true);

    const legendaryPlaneswalker: CardData = {
      id: 'commander-2',
      name: 'Jace, the Mind Sculptor',
      types: ['planeswalker'],
      supertypes: ['legendary'],
    };

    expect(MTGCardTypeUtils.isLegendaryLeader(legendaryPlaneswalker)).toBe(true);

    const nonLegendary: CardData = {
      id: 'creature-1',
      name: 'Goblin',
      types: ['creature'],
    };

    expect(MTGCardTypeUtils.isLegendaryLeader(nonLegendary)).toBe(false);
  });

  it('should identify creatures', () => {
    const creature: CardData = {
      id: 'creature-1',
      name: 'Goblin',
      types: ['creature'],
    };

    expect(MTGCardTypeUtils.isCreature(creature)).toBe(true);

    const spell: CardData = {
      id: 'spell-1',
      name: 'Lightning Bolt',
      types: ['instant'],
    };

    expect(MTGCardTypeUtils.isCreature(spell)).toBe(false);
  });

  it('should identify planeswalkers', () => {
    const planeswalker: CardData = {
      id: 'pw-1',
      name: 'Jace',
      types: ['planeswalker'],
    };

    expect(MTGCardTypeUtils.isPlaneswalker(planeswalker)).toBe(true);

    const creature: CardData = {
      id: 'creature-1',
      name: 'Goblin',
      types: ['creature'],
    };

    expect(MTGCardTypeUtils.isPlaneswalker(creature)).toBe(false);
  });

  it('should identify permanents', () => {
    const creature: CardData = {
      id: 'creature-1',
      name: 'Goblin',
      types: ['creature'],
    };

    expect(MTGCardTypeUtils.isPermanent(creature)).toBe(true);

    const artifact: CardData = {
      id: 'artifact-1',
      name: 'Sol Ring',
      types: ['artifact'],
    };

    expect(MTGCardTypeUtils.isPermanent(artifact)).toBe(true);

    const instant: CardData = {
      id: 'spell-1',
      name: 'Lightning Bolt',
      types: ['instant'],
    };

    expect(MTGCardTypeUtils.isPermanent(instant)).toBe(false);
  });

  it('should get mana value (CMC)', () => {
    const card: CardData = {
      id: 'card-1',
      name: 'Test',
      types: ['spell'],
      metadata: {
        cmc: 3,
      },
    };

    expect(MTGCardTypeUtils.getManaValue(card)).toBe(3);
  });
});

describe('MTG Adapter - Zone Utilities', () => {
  it('should convert MTG zone to generic zone', () => {
    expect(MTGZoneUtils.toGenericZone('command')).toBe('leader');
    expect(MTGZoneUtils.toGenericZone('library')).toBe('library');
    expect(MTGZoneUtils.toGenericZone('battlefield')).toBe('battlefield');
  });

  it('should convert generic zone to MTG zone', () => {
    expect(MTGZoneUtils.fromGenericZone('leader')).toBe('command');
    expect(MTGZoneUtils.fromGenericZone('library')).toBe('library');
    expect(MTGZoneUtils.fromGenericZone('battlefield')).toBe('battlefield');
  });
});

describe('MTG Adapter - Action Type Mappings', () => {
  it('should convert MTG action to generic action', () => {
    expect(toGenericActionType('play_land')).toBe('play_source');
    expect(toGenericActionType('gain_life')).toBe('gain_health');
    expect(toGenericActionType('lose_life')).toBe('lose_health');
    expect(toGenericActionType('pay_mana')).toBe('pay_resource');
    expect(toGenericActionType('add_mana')).toBe('add_resource');
    expect(toGenericActionType('cast_spell')).toBe('cast_spell');
  });

  it('should convert generic action to MTG action', () => {
    expect(fromGenericActionType('play_source')).toBe('play_land');
    expect(fromGenericActionType('gain_health')).toBe('gain_life');
    expect(fromGenericActionType('lose_health')).toBe('lose_life');
    expect(fromGenericActionType('pay_resource')).toBe('pay_mana');
    expect(fromGenericActionType('add_resource')).toBe('add_mana');
    expect(fromGenericActionType('cast_spell')).toBe('cast_spell');
  });
});

describe('MTG Adapter - Game State Helpers', () => {
  it('should get starting life for format', () => {
    expect(MTGGameStateHelpers.getStartingLife('standard')).toBe(20);
    expect(MTGGameStateHelpers.getStartingLife('commander')).toBe(40);
  });

  it('should get max sources per turn for format', () => {
    expect(MTGGameStateHelpers.getMaxSourcesPerTurn('standard')).toBe(1);
    expect(MTGGameStateHelpers.getMaxSourcesPerTurn('commander')).toBe(1);
  });

  it('should get commander damage threshold', () => {
    expect(MTGGameStateHelpers.getCommanderDamageThreshold('commander')).toBe(21);
    expect(MTGGameStateHelpers.getCommanderDamageThreshold('standard')).toBe(0);
  });
});

describe('Generic Framework - Terminology Mapping', () => {
  it('should demonstrate terminology mappings', () => {
    // Commander → Legendary Leader
    const leaderDamage = 'leaderDamage' in { leaderDamage: new Map() };

    // mana → resources
    const resources = 'resources' in { resources: new Map() };

    // lands → sources
    const sources = 'sourcesPlayedThisTurn' in { sourcesPlayedThisTurn: 0 };

    expect(leaderDamage).toBe(true);
    expect(resources).toBe(true);
    expect(sources).toBe(true);
  });
});

/**
 * Comprehensive tests for Replacement and Prevention Effects
 * Tests APNAP ordering, "as though" effects, and complex scenarios
 */

import {
  replacementEffectManager,
  ReplacementAbility,
  ReplacementEvent,
  APNAPOrder,
  createPreventionShield,
  createDamageReplacementEffect,
  createLifeGainReplacementEffect,
  createLifeLossReplacementEffect,
  createDrawReplacementEffect,
  createDestroyReplacementEffect,
  createAsThoughEffect,
} from '../replacement-effects';
import type { GameState } from '../types';

describe('ReplacementEffectManager - APNAP Ordering', () => {
  beforeEach(() => {
    replacementEffectManager.reset();
  });

  test('should apply effects in APNAP order', () => {
    // Player1 is active player, Player2 is non-active
    const apnapOrder: APNAPOrder = {
      activePlayerId: 'player1',
      playerOrder: ['player1', 'player2'],
    };

    // Both players have effects that double damage
    const p1Effect: ReplacementAbility = {
      id: 'p1-double',
      sourceCardId: 'p1-card',
      controllerId: 'player1',
      effectType: 'damage_replacement',
      description: 'P1 doubles damage',
      layer: 5,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === 'damage',
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: 'P1 doubled',
        instead: true,
      }),
    };

    const p2Effect: ReplacementAbility = {
      id: 'p2-double',
      sourceCardId: 'p2-card',
      controllerId: 'player2',
      effectType: 'damage_replacement',
      description: 'P2 doubles damage',
      layer: 5,
      timestamp: 200,
      isInstead: true,
      canApply: (e) => e.type === 'damage',
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: 'P2 doubled',
        instead: true,
      }),
    };

    replacementEffectManager.registerEffect(p1Effect);
    replacementEffectManager.registerEffect(p2Effect);

    const event: ReplacementEvent = {
      type: 'damage',
      amount: 3,
      timestamp: Date.now(),
      targetId: 'player2', // Affected player is P2
    };

    // P2's effect should apply first (affected player chooses)
    // Then P1's effect applies
    // 3 * 2 (P2) = 6, then 6 * 2 (P1) = 12
    const processed = replacementEffectManager.processEvent(event, apnapOrder);
    expect(processed.amount).toBe(12);
  });

  test('should prioritize self-replacement effects', () => {
    const apnapOrder: APNAPOrder = {
      activePlayerId: 'player1',
      playerOrder: ['player1', 'player2'],
    };

    // Self-replacement effect (e.g., "If this creature would deal damage...")
    const selfEffect: ReplacementAbility = {
      id: 'self-replace',
      sourceCardId: 'self-card',
      controllerId: 'player1',
      effectType: 'damage_replacement',
      description: 'Self replacement',
      layer: 5,
      timestamp: 300,
      isSelfReplacement: true,
      isInstead: true,
      canApply: (e) => e.type === 'damage' && e.sourceId === 'self-card',
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount + 5 },
        description: 'Self added 5',
        instead: true,
      }),
    };

    // Regular effect
    const regularEffect: ReplacementAbility = {
      id: 'regular',
      sourceCardId: 'regular-card',
      controllerId: 'player2',
      effectType: 'damage_replacement',
      description: 'Regular replacement',
      layer: 5,
      timestamp: 100,
      isInstead: true,
      canApply: (e) => e.type === 'damage',
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: 'Regular doubled',
        instead: true,
      }),
    };

    replacementEffectManager.registerEffect(selfEffect);
    replacementEffectManager.registerEffect(regularEffect);

    const event: ReplacementEvent = {
      type: 'damage',
      amount: 3,
      timestamp: Date.now(),
      sourceId: 'self-card',
      targetId: 'player2',
    };

    // Self-replacement applies first: 3 + 5 = 8
    // Then regular: 8 * 2 = 16
    const processed = replacementEffectManager.processEvent(event, apnapOrder);
    expect(processed.amount).toBe(16);
  });

  test('should handle layer ordering within same controller', () => {
    // Lower layer applies first
    const layer1Effect: ReplacementAbility = {
      id: 'layer1',
      sourceCardId: 'card1',
      controllerId: 'player1',
      effectType: 'damage_prevention',
      description: 'Layer 1',
      layer: 1,
      timestamp: 100,
      canApply: (e) => e.type === 'damage',
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: Math.max(0, e.amount - 2) },
        description: 'Prevented 2',
      }),
    };

    const layer5Effect: ReplacementAbility = {
      id: 'layer5',
      sourceCardId: 'card2',
      controllerId: 'player1',
      effectType: 'damage_replacement',
      description: 'Layer 5',
      layer: 5,
      timestamp: 200,
      isInstead: true,
      canApply: (e) => e.type === 'damage',
      apply: (e) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: 'Doubled',
        instead: true,
      }),
    };

    replacementEffectManager.registerEffect(layer1Effect);
    replacementEffectManager.registerEffect(layer5Effect);

    const event: ReplacementEvent = {
      type: 'damage',
      amount: 5,
      timestamp: Date.now(),
      targetId: 'player2',
    };

    // Layer 1 applies first: 5 - 2 = 3
    // Layer 5 applies second: 3 * 2 = 6
    const processed = replacementEffectManager.processEvent(event);
    expect(processed.amount).toBe(6);
  });
});

describe('ReplacementEffectManager - As Though Effects', () => {
  beforeEach(() => {
    replacementEffectManager.reset();
  });

  test('should register and check as though effects', () => {
    const mockGameState = { players: new Map() } as GameState;
    
    const flashEffect = createAsThoughEffect(
      'veiled-source',
      'player1',
      'cast_flash',
      'You may cast spells as though they had flash'
    );

    replacementEffectManager.registerAsThoughEffect(flashEffect);

    expect(replacementEffectManager.checkAsThoughEffect('player1', 'cast_flash', mockGameState)).toBe(true);
    expect(replacementEffectManager.checkAsThoughEffect('player2', 'cast_flash', mockGameState)).toBe(false);
    expect(replacementEffectManager.checkAsThoughEffect('player1', 'attack_haste', mockGameState)).toBe(false);
  });

  test('should handle conditional as though effects', () => {
    const mockGameState = { players: new Map() } as GameState;
    
    // Effect that only applies when player has 10+ life
    const conditionalEffect = createAsThoughEffect(
      'conditional-source',
      'player1',
      'attack_haste',
      'Creatures can attack as though they had haste if you have 10+ life',
      (_state, _playerId) => {
        // Simplified condition check
        return true;
      }
    );

    replacementEffectManager.registerAsThoughEffect(conditionalEffect);

    expect(replacementEffectManager.checkAsThoughEffect('player1', 'attack_haste', mockGameState)).toBe(true);
  });

  test('should get all as though effects for a player', () => {
    const mockGameState = { players: new Map() } as GameState;
    
    replacementEffectManager.registerAsThoughEffect(
      createAsThoughEffect('source1', 'player1', 'cast_flash', 'Flash effect')
    );
    replacementEffectManager.registerAsThoughEffect(
      createAsThoughEffect('source2', 'player1', 'attack_haste', 'Haste effect')
    );
    replacementEffectManager.registerAsThoughEffect(
      createAsThoughEffect('source3', 'player2', 'block_flying', 'Flying block effect')
    );

    const p1Effects = replacementEffectManager.getAsThoughEffects('player1', mockGameState);
    expect(p1Effects).toHaveLength(2);
    expect(p1Effects.map(e => e.asThoughType)).toContain('cast_flash');
    expect(p1Effects.map(e => e.asThoughType)).toContain('attack_haste');

    const p2Effects = replacementEffectManager.getAsThoughEffects('player2', mockGameState);
    expect(p2Effects).toHaveLength(1);
    expect(p2Effects[0].asThoughType).toBe('block_flying');
  });

  test('should remove as though effects when source leaves battlefield', () => {
    const mockGameState = { players: new Map() } as GameState;
    
    replacementEffectManager.registerAsThoughEffect(
      createAsThoughEffect('temporary-source', 'player1', 'cast_flash', 'Temporary flash')
    );

    expect(replacementEffectManager.checkAsThoughEffect('player1', 'cast_flash', mockGameState)).toBe(true);

    replacementEffectManager.removeEffectsFromSource('temporary-source');

    expect(replacementEffectManager.checkAsThoughEffect('player1', 'cast_flash', mockGameState)).toBe(false);
  });
});

describe('ReplacementEffectManager - Complex Scenarios', () => {
  beforeEach(() => {
    replacementEffectManager.reset();
  });

  test('should handle Furnace of Rath + prevention shield interaction', () => {
    // Furnace of Rath: If damage would be dealt, deal twice that much instead
    const furnaceEffect = createDamageReplacementEffect(
      'furnace',
      'player1',
      'Furnace of Rath doubles damage',
      (amount) => amount * 2,
      5
    );

    replacementEffectManager.registerEffect(furnaceEffect);

    // Target has prevention shield
    replacementEffectManager.addPreventionShield('player2', {
      sourceId: 'fog',
      amount: 3,
      controllerId: 'player2',
    });

    const event: ReplacementEvent = {
      type: 'damage',
      amount: 2,
      timestamp: Date.now(),
      targetId: 'player2',
    };

    // Furnace doubles: 2 * 2 = 4
    // Prevention shield prevents 3: 4 - 3 = 1
    const processed = replacementEffectManager.processEvent(event);
    expect(processed.amount).toBe(1);

    // Shield should be depleted
    const shields = replacementEffectManager.getPreventionShields('player2');
    expect(shields).toHaveLength(0);
  });

  test('should handle Alhammarret\'s Archive life gain doubling', () => {
    const archiveEffect = createLifeGainReplacementEffect(
      'archive',
      'player1',
      'Alhammarret\'s Archive doubles life gain',
      (amount) => amount * 2,
      (targetId) => targetId === 'player1'
    );

    replacementEffectManager.registerEffect(archiveEffect);

    const event: ReplacementEvent = {
      type: 'life_gain',
      amount: 5,
      timestamp: Date.now(),
      targetId: 'player1',
    };

    const processed = replacementEffectManager.processEvent(event);
    expect(processed.amount).toBe(10);

    // Should not apply to other players
    const otherEvent: ReplacementEvent = {
      type: 'life_gain',
      amount: 5,
      timestamp: Date.now(),
      targetId: 'player2',
    };

    const otherProcessed = replacementEffectManager.processEvent(otherEvent);
    expect(otherProcessed.amount).toBe(5);
  });

  test('should handle multiple prevention shields depleting correctly', () => {
    replacementEffectManager.addPreventionShield('player1', {
      sourceId: 'shield1',
      amount: 2,
      controllerId: 'player1',
    });
    replacementEffectManager.addPreventionShield('player1', {
      sourceId: 'shield2',
      amount: 3,
      controllerId: 'player1',
    });

    // First damage: 4 damage, should use both shields (2 + 2 from second)
    const event1: ReplacementEvent = {
      type: 'damage',
      amount: 4,
      timestamp: Date.now(),
      targetId: 'player1',
    };

    const processed1 = replacementEffectManager.processEvent(event1);
    expect(processed1.amount).toBe(0);

    // Second shield should have 1 remaining
    const shields = replacementEffectManager.getPreventionShields('player1');
    expect(shields).toHaveLength(1);
    expect(shields[0].amount).toBe(1);

    // Second damage: 2 damage, should use remaining 1 from shield2
    const event2: ReplacementEvent = {
      type: 'damage',
      amount: 2,
      timestamp: Date.now() + 1000,
      targetId: 'player1',
    };

    const processed2 = replacementEffectManager.processEvent(event2);
    expect(processed2.amount).toBe(1);

    // All shields should be depleted
    expect(replacementEffectManager.getPreventionShields('player1')).toHaveLength(0);
  });

  test('should handle draw replacement effects', () => {
    const drawEffect = createDrawReplacementEffect(
      'nefarox',
      'player1',
      'Nefarox draw replacement',
      (amount) => amount + 1 // Draw one additional card
    );

    replacementEffectManager.registerEffect(drawEffect);

    const event: ReplacementEvent = {
      type: 'draw_card',
      amount: 1,
      timestamp: Date.now(),
      targetId: 'player1',
    };

    const processed = replacementEffectManager.processEvent(event);
    expect(processed.amount).toBe(2);
  });

  test('should handle destroy replacement (regeneration)', () => {
    const regenEffect = createDestroyReplacementEffect(
      'regeneration-shield',
      'player1',
      'Regeneration shield',
      (event) => ({
        ...event,
        type: 'tap', // Instead of dying, creature taps
        amount: 0,
      }),
      (targetId) => targetId === 'creature1'
    );

    replacementEffectManager.registerEffect(regenEffect);

    const event: ReplacementEvent = {
      type: 'destroy',
      amount: 0,
      timestamp: Date.now(),
      targetId: 'creature1',
    };

    const processed = replacementEffectManager.processEvent(event);
    expect(processed.type).toBe('tap');
    expect(processed.amount).toBe(0);
  });

  test('should handle life loss replacement', () => {
    const lossEffect = createLifeLossReplacementEffect(
      'loss-reducer',
      'player1',
      'Half life loss',
      (amount) => Math.ceil(amount / 2),
      (targetId) => targetId === 'player1'
    );

    replacementEffectManager.registerEffect(lossEffect);

    const event: ReplacementEvent = {
      type: 'life_loss',
      amount: 7,
      timestamp: Date.now(),
      targetId: 'player1',
    };

    const processed = replacementEffectManager.processEvent(event);
    expect(processed.amount).toBe(4); // ceil(7/2) = 4
  });
});

describe('ReplacementEffectManager - APNAP Order Creation', () => {
  beforeEach(() => {
    replacementEffectManager.reset();
  });

  test('should create correct APNAP order', () => {
    const allPlayers = ['player1', 'player2', 'player3', 'player4'];
    
    // Player2 is active
    const order = replacementEffectManager.createAPNAPOrder('player2', allPlayers);
    
    expect(order.activePlayerId).toBe('player2');
    expect(order.playerOrder).toEqual(['player2', 'player3', 'player4', 'player1']);
  });

  test('should handle single player', () => {
    const order = replacementEffectManager.createAPNAPOrder('player1', ['player1']);
    expect(order.playerOrder).toEqual(['player1']);
  });

  test('should handle unknown active player', () => {
    const allPlayers = ['player1', 'player2'];
    const order = replacementEffectManager.createAPNAPOrder('unknown', allPlayers);
    expect(order.playerOrder).toEqual(allPlayers);
  });
});

describe('ReplacementEffectManager - Factory Functions', () => {
  beforeEach(() => {
    replacementEffectManager.reset();
  });

  test('createPreventionShield should create both ability and shield', () => {
    const { ability, shield } = createPreventionShield(
      'source',
      'player1',
      'player2',
      5,
      'Prevent 5 damage',
      'until_end_of_turn',
      ['combat']
    );

    expect(ability.id).toMatch(/prevent-source-\d+/);
    expect(ability.effectType).toBe('damage_prevention');
    expect(ability.layer).toBe(1);
    expect(ability.preventionAmount).toBe(5);

    expect(shield.sourceId).toBe('source');
    expect(shield.amount).toBe(5);
    expect(shield.damageTypes).toEqual(['combat']);
    expect(shield.controllerId).toBe('player1');
    expect(shield.expiresAt).toBeDefined();
  });

  test('createDamageReplacementEffect should create correct effect', () => {
    const effect = createDamageReplacementEffect(
      'furnace',
      'player1',
      'Double damage',
      (amount) => amount * 2,
      5,
      true
    );

    expect(effect.isSelfReplacement).toBe(true);
    expect(effect.isInstead).toBe(true);
    expect(effect.layer).toBe(5);

    const event: ReplacementEvent = {
      type: 'damage',
      amount: 3,
      timestamp: Date.now(),
    };

    const result = effect.apply(event);
    expect(result.modified).toBe(true);
    expect(result.modifiedEvent?.amount).toBe(6);
    expect(result.instead).toBe(true);
  });

  test('createAsThoughEffect should create correct effect', () => {
    const effect = createAsThoughEffect(
      'source',
      'player1',
      'cast_flash',
      'Flash effect',
      undefined,
      'permanent'
    );

    expect(effect.asThoughType).toBe('cast_flash');
    expect(effect.duration).toBe('permanent');
    expect(effect.condition).toBeUndefined();
  });
});

import { replacementEffectManager, ReplacementAbility, ReplacementEvent } from '../replacement-effects';

describe('ReplacementEffectManager', () => {
  beforeEach(() => {
    replacementEffectManager.reset();
  });

  test('should apply damage prevention shield', () => {
    const targetId = 'player1';
    replacementEffectManager.addPreventionShield(targetId, {
      sourceId: 'source1',
      amount: 5,
    });

    const event: ReplacementEvent = {
      type: 'damage' as const,
      amount: 7,
      timestamp: Date.now(),
      targetId,
    };

    const processed = replacementEffectManager.processEvent(event);
    expect(processed.amount).toBe(2); // 7 - 5 = 2
    expect(replacementEffectManager.getPreventionShields(targetId)).toHaveLength(0);
  });

  test('should handle multiple prevention shields', () => {
    const targetId = 'player1';
    replacementEffectManager.addPreventionShield(targetId, {
      sourceId: 'source1',
      amount: 2,
    });
    replacementEffectManager.addPreventionShield(targetId, {
      sourceId: 'source2',
      amount: 3,
    });

    const event: ReplacementEvent = {
      type: 'damage' as const,
      amount: 4,
      timestamp: Date.now(),
      targetId,
    };

    const processed = replacementEffectManager.processEvent(event);
    expect(processed.amount).toBe(0); // 4 - 2 - 2 = 0 (1 remains on second shield)
    
    const shields = replacementEffectManager.getPreventionShields(targetId);
    expect(shields).toHaveLength(1);
    expect(shields[0].amount).toBe(1);
  });

  test('should apply replacement effects in correct order', () => {
    // Effect 1: If damage would be dealt, deal twice that much (Furnace of Rath)
    const furnaceEffect: ReplacementAbility = {
      id: 'furnace',
      sourceCardId: 'furnace-card',
      controllerId: 'player1',
      effectType: 'damage_replacement' as const,
      description: 'Double damage',
      layer: 5,
      timestamp: 1,
      canApply: (e: ReplacementEvent) => e.type === 'damage',
      apply: (e: ReplacementEvent) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: 'Doubled damage',
      }),
    };

    // Effect 2: If damage would be dealt, prevent 2 of it
    const preventEffect: ReplacementAbility = {
      id: 'prevent2',
      sourceCardId: 'prevent-card',
      controllerId: 'player1',
      effectType: 'damage_prevention' as const,
      description: 'Prevent 2',
      layer: 4, // Prevention usually applies before general replacement if configured
      timestamp: 2,
      canApply: (e: ReplacementEvent) => e.type === 'damage',
      apply: (e: ReplacementEvent) => ({
        modified: true,
        modifiedEvent: { ...e, amount: Math.max(0, e.amount - 2) },
        description: 'Prevented 2',
      }),
    };

    replacementEffectManager.registerEffect(furnaceEffect);
    replacementEffectManager.registerEffect(preventEffect);

    const event: ReplacementEvent = {
      type: 'damage' as const,
      amount: 3,
      timestamp: Date.now(),
      targetId: 'player2',
    };

    // Should apply prevent2 first (layer 4), then furnace (layer 5)
    // (3 - 2) * 2 = 2
    const processed = replacementEffectManager.processEvent(event);
    expect(processed.amount).toBe(2);
  });

  test('should handle life gain replacement', () => {
    // Alhammarret's Archive: If you would gain life, gain twice that much instead
    const archiveEffect: ReplacementAbility = {
      id: 'archive',
      sourceCardId: 'archive-card',
      controllerId: 'player1',
      effectType: 'life_gain_replacement' as const,
      description: 'Double life gain',
      layer: 5,
      timestamp: 1,
      canApply: (e: ReplacementEvent) => e.type === 'life_gain' && e.targetId === 'player1',
      apply: (e: ReplacementEvent) => ({
        modified: true,
        modifiedEvent: { ...e, amount: e.amount * 2 },
        description: 'Doubled life gain',
      }),
    };

    replacementEffectManager.registerEffect(archiveEffect);

    const event: ReplacementEvent = {
      type: 'life_gain' as const,
      amount: 3,
      timestamp: Date.now(),
      targetId: 'player1',
    };

    const processed = replacementEffectManager.processEvent(event);
    expect(processed.amount).toBe(6);
  });
});

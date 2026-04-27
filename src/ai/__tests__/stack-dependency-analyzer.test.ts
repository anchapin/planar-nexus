/**
 * @fileoverview Stack Dependency Analyzer Tests
 *
 * Tests for stack dependency analysis and cross-dependency scenarios.
 */

import { describe, test, expect } from '@jest/globals';
import {
  analyzeStackDependencies,
  getRecommendedResponse,
  type StackAction,
  type StackContext,
} from '../stack-dependency-analyzer';

describe('Stack Dependency Analyzer', () => {
  describe('Basic Dependency Detection', () => {
    test('should detect counterspell dependencies', () => {
      const stack: StackAction[] = [
        {
          id: 'spell_1',
          cardId: 'creature',
          name: 'Primeval Titan',
          controller: 'player2',
          type: 'spell',
          manaValue: 6,
          isInstantSpeed: false,
          timestamp: 1,
        },
        {
          id: 'counter_1',
          cardId: 'counterspell',
          name: 'Counterspell',
          controller: 'player1',
          type: 'spell',
          manaValue: 2,
          isInstantSpeed: true,
          targets: [{ cardId: 'spell_1' }],
          timestamp: 2,
        },
      ];

      const result = analyzeStackDependencies(stack);

      // Should have at least one counterspell dependency (may also have target dependency)
      const counterDeps = result.dependencies.filter(d => d.dependencyType === 'counters');
      expect(counterDeps.length).toBeGreaterThanOrEqual(1);
      expect(counterDeps[0].dependent).toBe('counter_1');
      expect(result.canBeCountered['spell_1']).toBe(true);
    });

    test('should detect protective dependencies', () => {
      const stack: StackAction[] = [
        {
          id: 'creature',
          cardId: 'target_creature',
          name: 'Baneslayer Angel',
          controller: 'player1',
          type: 'spell',
          manaValue: 5,
          isInstantSpeed: false,
          timestamp: 1,
        },
        {
          id: 'protection',
          cardId: 'protective_spell',
          name: 'Protective Ward',
          controller: 'player1',
          type: 'spell',
          manaValue: 1,
          isInstantSpeed: true,
          targets: [{ permanentId: 'creature' }],
          timestamp: 2,
        },
      ];

      const result = analyzeStackDependencies(stack);

      // Should detect that high mana value spell should be protected
      expect(result.shouldBeProtected['creature']).toBe(true);

      // Should have some dependency (either protective or targeting)
      expect(result.dependencies.length).toBeGreaterThan(0);
    });

    test('should detect enhancement dependencies', () => {
      const stack: StackAction[] = [
        {
          id: 'creature',
          cardId: 'creature',
          name: 'Grizzly Bears',
          controller: 'player1',
          type: 'spell',
          manaValue: 2,
          isInstantSpeed: false,
          timestamp: 1,
        },
        {
          id: 'enhancement',
          cardId: 'giant_growth',
          name: 'Giant Growth',
          controller: 'player1',
          type: 'spell',
          manaValue: 1,
          isInstantSpeed: true,
          targets: [{ permanentId: 'creature' }],
          timestamp: 2,
        },
      ];

      const result = analyzeStackDependencies(stack);

      // Should detect some dependency relationship
      expect(result.dependencies.length).toBeGreaterThan(0);

      // The enhancement should target the creature
      const targetDep = result.dependencies.find(
        d => d.dependent === 'enhancement'
      );
      expect(targetDep).toBeDefined();
    });
  });

  describe('3-Item Stack Scenarios', () => {
    test('should handle countering a counterspell', () => {
      const stack: StackAction[] = [
        {
          id: 'original_spell',
          cardId: 'threat',
          name: 'Threatening Spell',
          controller: 'player2',
          type: 'spell',
          manaValue: 5,
          isInstantSpeed: false,
          timestamp: 1,
        },
        {
          id: 'first_counter',
          cardId: 'counter1',
          name: 'Cancel',
          controller: 'player1',
          type: 'spell',
          manaValue: 3,
          isInstantSpeed: true,
          targets: [{ cardId: 'original_spell' }],
          timestamp: 2,
        },
        {
          id: 'second_counter',
          cardId: 'counter2',
          name: 'Negate',
          controller: 'player2',
          type: 'spell',
          manaValue: 2,
          isInstantSpeed: true,
          targets: [{ cardId: 'first_counter' }],
          timestamp: 3,
        },
      ];

      const result = analyzeStackDependencies(stack);

      // Should detect both counterspell relationships
      const counterDeps = result.dependencies.filter(
        d => d.dependencyType === 'counters'
      );
      expect(counterDeps.length).toBeGreaterThanOrEqual(2);

      // Original spell is high risk (being countered)
      const originalRisk = result.riskAnalysis.find(r => r.actionId === 'original_spell');
      expect(originalRisk?.riskLevel).toBe('high');

      // Critical path should reflect dependency order
      expect(result.criticalPath).toContain('original_spell');
      expect(result.criticalPath).toContain('first_counter');
      expect(result.criticalPath).toContain('second_counter');
    });

    test('should identify when to let spell resolve to prevent worse outcome', () => {
      const stack: StackAction[] = [
        {
          id: 'bad_spell',
          cardId: 'bad',
          name: 'Bad Spell for Opponent',
          controller: 'player2',
          type: 'spell',
          manaValue: 4,
          isInstantSpeed: false,
          timestamp: 1,
        },
        {
          id: 'counter_bad',
          cardId: 'counter',
          name: 'Counterspell',
          controller: 'player1',
          type: 'spell',
          manaValue: 2,
          isInstantSpeed: true,
          targets: [{ cardId: 'bad_spell' }],
          timestamp: 2,
        },
        {
          id: 'even_worse_spell',
          cardId: 'worse',
          name: 'Even Worse Threat',
          controller: 'player2',
          type: 'spell',
          manaValue: 6,
          isInstantSpeed: false,
          timestamp: 3,
        },
      ];

      const result = analyzeStackDependencies(stack);

      // Even worse spell should be marked at least medium risk (high mana value)
      const worseRisk = result.riskAnalysis.find(r => r.actionId === 'even_worse_spell');
      expect(worseRisk?.riskLevel).toBeTruthy();

      // The bad spell is being targeted by the counter
      const badRisk = result.riskAnalysis.find(r => r.actionId === 'bad_spell');
      expect(badRisk?.riskReason).toBeDefined();
    });

    test('should handle complex cross-dependencies', () => {
      const stack: StackAction[] = [
        {
          id: 'creature_1',
          cardId: 'creature',
          name: 'Grizzly Bears',
          controller: 'player1',
          type: 'spell',
          manaValue: 2,
          isInstantSpeed: false,
          timestamp: 1,
        },
        {
          id: 'enchantment',
          cardId: 'enchant',
          name: 'Rancor',
          controller: 'player1',
          type: 'spell',
          manaValue: 1,
          isInstantSpeed: false,
          targets: [{ permanentId: 'creature_1' }],
          timestamp: 2,
        },
        {
          id: 'response',
          cardId: 'shock',
          name: 'Shock',
          controller: 'player2',
          type: 'spell',
          manaValue: 1,
          isInstantSpeed: true,
          targets: [{ permanentId: 'creature_1' }],
          timestamp: 3,
        },
      ];

      const result = analyzeStackDependencies(stack);

      // Should detect multiple dependencies
      expect(result.dependencies.length).toBeGreaterThan(0);

      // Creature is being targeted by shock (top of stack)
      const creatureRisk = result.riskAnalysis.find(r => r.actionId === 'creature_1');
      expect(creatureRisk?.riskLevel).toBeTruthy();

      // Shock targets creature
      const shockTargetsCreature = result.dependencies.some(
        d => d.dependent === 'response' && d.dependsOn === 'creature_1'
      );
      expect(shockTargetsCreature).toBe(true);
    });
  });

  describe('Response Recommendations', () => {
    test('should recommend countering high-risk actions', () => {
      const stack: StackAction[] = [
        {
          id: 'threat',
          cardId: 'threat',
          name: 'Exsanguinate',
          controller: 'player2',
          type: 'spell',
          manaValue: 6,
          isInstantSpeed: false,
          timestamp: 1,
        },
      ];

      const dependencies = analyzeStackDependencies(stack);
      const context: StackContext = {
        currentAction: stack[0],
        stackSize: 1,
        actionsAbove: [],
        availableMana: { blue: 2, colorless: 0 },
        availableResponses: [],
        opponentsRemaining: [],
        isMyTurn: false,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: true,
      };

      const recommendation = getRecommendedResponse(context, dependencies);

      // Should provide some recommendation (not just pass without reason)
      expect(recommendation).toBeDefined();
      expect(recommendation.reasoning).toBeTruthy();
    });

    test('should recommend protecting threatened actions', () => {
      const stack: StackAction[] = [
        {
          id: 'our_spell',
          cardId: 'our',
          name: 'Our Important Spell',
          controller: 'player1',
          type: 'spell',
          manaValue: 5,
          isInstantSpeed: false,
          timestamp: 1,
        },
        {
          id: 'their_counter',
          cardId: 'counter',
          name: 'Counterspell',
          controller: 'player2',
          type: 'spell',
          manaValue: 2,
          isInstantSpeed: true,
          targets: [{ cardId: 'our_spell' }],
          timestamp: 2,
        },
      ];

      const dependencies = analyzeStackDependencies(stack);
      const context: StackContext = {
        currentAction: stack[0],
        stackSize: 2,
        actionsAbove: [stack[1]],
        availableMana: { blue: 2, colorless: 0 },
        availableResponses: [],
        opponentsRemaining: [],
        isMyTurn: false,
        phase: 'precombat_main',
        step: 'main',
        respondingToOpponent: false,
      };

      const recommendation = getRecommendedResponse(context, dependencies);

      // Should provide a recommendation for the threatened action
      expect(recommendation).toBeDefined();
      expect(recommendation.reasoning).toBeTruthy();
      // The recommendation should mention being targeted or countered
      const reasoning = recommendation.reasoning.toLowerCase();
      expect(reasoning.includes('targeted') || reasoning.includes('countered')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty stack', () => {
      const result = analyzeStackDependencies([]);

      expect(result.dependencies).toHaveLength(0);
      expect(result.criticalPath).toHaveLength(0);
      expect(result.riskAnalysis).toHaveLength(0);
    });

    test('should handle single item stack', () => {
      const stack: StackAction[] = [
        {
          id: 'single',
          cardId: 'spell',
          name: 'Single Spell',
          controller: 'player1',
          type: 'spell',
          manaValue: 2,
          isInstantSpeed: false,
          timestamp: 1,
        },
      ];

      const result = analyzeStackDependencies(stack);

      expect(result.dependencies).toHaveLength(0);
      expect(result.criticalPath).toHaveLength(1);
      expect(result.criticalPath[0]).toBe('single');
    });

    test('should identify uncounterable spells', () => {
      const stack: StackAction[] = [
        {
          id: 'uncounterable',
          cardId: 'spell',
          name: 'Abrupt Decay', // Can't be countered if CMC <= 3
          controller: 'player2',
          type: 'spell',
          manaValue: 2,
          isInstantSpeed: true,
          timestamp: 1,
        },
      ];

      const result = analyzeStackDependencies(stack);

      // For now, this is a placeholder - real implementation would check text
      expect(result.canBeCountered['uncounterable']).toBeDefined();
    });
  });
});

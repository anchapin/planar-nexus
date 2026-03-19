/**
 * Unit tests for sideboard-plans.ts
 * 
 * Phase 20-01: Custom Sideboard Plans
 * Requirement: SIDE-03
 */

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(global, 'localStorage', { value: localStorageMock });

import {
  generatePlanId,
  getAllSideboardPlans,
  getSideboardPlansByFormat,
  getSideboardPlanById,
  saveSideboardPlan,
  updateSideboardPlan,
  deleteSideboardPlan,
  clearAllSideboardPlans,
  validateSideboardPlan,
} from '../sideboard-plans';

describe('sideboard-plans storage', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('generatePlanId', () => {
    it('should generate unique IDs', () => {
      const id1 = generatePlanId();
      const id2 = generatePlanId();
      
      expect(id1).toMatch(/^sideboard-\d+-[a-z0-9]+$/);
      expect(id2).not.toBe(id1);
    });
  });

  describe('getAllSideboardPlans', () => {
    it('should return empty array when no plans exist', () => {
      const plans = getAllSideboardPlans();
      expect(plans).toEqual([]);
    });

    it('should return stored plans', () => {
      const plan = {
        name: 'Test Plan',
        format: 'standard' as const,
        archetypeId: 'test-archetype',
        archetypeName: 'Test Archetype',
        opponentArchetypeId: 'opp-archetype',
        opponentArchetypeName: 'Opponent',
        inCards: [],
        outCards: [],
        notes: 'Test notes',
      };
      
      saveSideboardPlan(plan);
      const plans = getAllSideboardPlans();
      
      expect(plans.length).toBe(1);
      expect(plans[0].name).toBe('Test Plan');
    });
  });

  describe('getSideboardPlansByFormat', () => {
    it('should filter plans by format', () => {
      saveSideboardPlan({
        name: 'Standard Plan',
        format: 'standard',
        archetypeId: 'test',
        archetypeName: 'Test',
        opponentArchetypeId: 'opp',
        opponentArchetypeName: 'Opponent',
        inCards: [],
        outCards: [],
        notes: '',
      });
      
      saveSideboardPlan({
        name: 'Modern Plan',
        format: 'modern',
        archetypeId: 'test',
        archetypeName: 'Test',
        opponentArchetypeId: 'opp',
        opponentArchetypeName: 'Opponent',
        inCards: [],
        outCards: [],
        notes: '',
      });

      const standardPlans = getSideboardPlansByFormat('standard');
      expect(standardPlans.length).toBe(1);
      expect(standardPlans[0].format).toBe('standard');
    });
  });

  describe('getSideboardPlanById', () => {
    it('should return null for non-existent plan', () => {
      const plan = getSideboardPlanById('non-existent');
      expect(plan).toBeNull();
    });

    it('should return the plan by ID', () => {
      const saved = saveSideboardPlan({
        name: 'Test Plan',
        format: 'standard',
        archetypeId: 'test',
        archetypeName: 'Test',
        opponentArchetypeId: 'opp',
        opponentArchetypeName: 'Opponent',
        inCards: [],
        outCards: [],
        notes: '',
      });
      
      const plan = getSideboardPlanById(saved.id);
      expect(plan).not.toBeNull();
      expect(plan?.name).toBe('Test Plan');
    });
  });

  describe('saveSideboardPlan', () => {
    it('should save a new plan with generated ID and timestamps', () => {
      const plan = saveSideboardPlan({
        name: 'New Plan',
        format: 'commander',
        archetypeId: 'cmdr-aggro',
        archetypeName: 'Commander Aggro',
        opponentArchetypeId: 'cmdr-control',
        opponentArchetypeName: 'Commander Control',
        inCards: [
          { cardName: 'Swords to Plowshares', count: 1, reason: 'Remove creature' },
        ],
        outCards: [
          { cardName: 'Counterspell', count: 1, reason: 'Not needed' },
        ],
        notes: 'Test notes',
      });

      expect(plan.id).toMatch(/^sideboard-/);
      expect(plan.createdAt).toBeDefined();
      expect(plan.updatedAt).toBeDefined();
      expect(plan.inCards.length).toBe(1);
      expect(plan.outCards.length).toBe(1);
    });
  });

  describe('updateSideboardPlan', () => {
    it('should update an existing plan', () => {
      const saved = saveSideboardPlan({
        name: 'Original Name',
        format: 'standard',
        archetypeId: 'test',
        archetypeName: 'Test',
        opponentArchetypeId: 'opp',
        opponentArchetypeName: 'Opponent',
        inCards: [],
        outCards: [],
        notes: '',
      });

      const updated = updateSideboardPlan(saved.id, {
        name: 'Updated Name',
        notes: 'Added notes',
      });

      expect(updated).not.toBeNull();
      expect(updated?.name).toBe('Updated Name');
      expect(updated?.notes).toBe('Added notes');
      expect(updated?.id).toBe(saved.id);
    });

    it('should return null for non-existent plan', () => {
      const result = updateSideboardPlan('non-existent', { name: 'Test' });
      expect(result).toBeNull();
    });
  });

  describe('deleteSideboardPlan', () => {
    it('should delete a plan', () => {
      const saved = saveSideboardPlan({
        name: 'To Delete',
        format: 'standard',
        archetypeId: 'test',
        archetypeName: 'Test',
        opponentArchetypeId: 'opp',
        opponentArchetypeName: 'Opponent',
        inCards: [],
        outCards: [],
        notes: '',
      });

      const deleted = deleteSideboardPlan(saved.id);
      expect(deleted).toBe(true);
      
      const plan = getSideboardPlanById(saved.id);
      expect(plan).toBeNull();
    });

    it('should return false for non-existent plan', () => {
      const result = deleteSideboardPlan('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('clearAllSideboardPlans', () => {
    it('should remove all plans', () => {
      saveSideboardPlan({
        name: 'Plan 1',
        format: 'standard',
        archetypeId: 'test',
        archetypeName: 'Test',
        opponentArchetypeId: 'opp',
        opponentArchetypeName: 'Opponent',
        inCards: [],
        outCards: [],
        notes: '',
      });
      
      saveSideboardPlan({
        name: 'Plan 2',
        format: 'modern',
        archetypeId: 'test',
        archetypeName: 'Test',
        opponentArchetypeId: 'opp',
        opponentArchetypeName: 'Opponent',
        inCards: [],
        outCards: [],
        notes: '',
      });

      clearAllSideboardPlans();
      
      const plans = getAllSideboardPlans();
      expect(plans.length).toBe(0);
    });
  });

  describe('validateSideboardPlan', () => {
    it('should return valid for complete plan', () => {
      const plan = {
        name: 'Valid Plan',
        format: 'standard' as const,
        archetypeId: 'test',
        archetypeName: 'Test',
        opponentArchetypeId: 'opp',
        opponentArchetypeName: 'Opponent',
        inCards: [{ cardName: 'Test', count: 1, reason: 'Test' }],
        outCards: [{ cardName: 'Test', count: 1, reason: 'Test' }],
      };
      
      const result = validateSideboardPlan(plan);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for missing name', () => {
      const plan = {
        name: '',
        format: 'standard' as const,
        archetypeId: 'test',
        archetypeName: 'Test',
        opponentArchetypeId: 'opp',
        opponentArchetypeName: 'Opponent',
        inCards: [],
        outCards: [],
      };
      
      const result = validateSideboardPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Plan name is required');
    });

    it('should return errors for missing format', () => {
      const plan = {
        name: 'Test',
        format: '' as any,
        archetypeId: 'test',
        archetypeName: 'Test',
        opponentArchetypeId: 'opp',
        opponentArchetypeName: 'Opponent',
        inCards: [],
        outCards: [],
      };
      
      const result = validateSideboardPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Format is required');
    });

    it('should return errors for missing archetype', () => {
      const plan = {
        name: 'Test',
        format: 'standard' as const,
        archetypeId: '',
        archetypeName: '',
        opponentArchetypeId: '',
        opponentArchetypeName: '',
        inCards: [],
        outCards: [],
      };
      
      const result = validateSideboardPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Player archetype is required');
      expect(result.errors).toContain('Opponent archetype is required');
    });
  });
});

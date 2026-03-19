/**
 * Custom Sideboard Plans
 * 
 * Provides localStorage persistence for user-created sideboard plans.
 */

import { SideboardCard } from './anti-meta';
import { MagicFormat, ArchetypeCategory } from './meta';

export interface SavedSideboardPlan {
  id: string;
  name: string;
  format: MagicFormat;
  archetypeId: string;
  archetypeName: string;
  opponentArchetypeId: string;
  opponentArchetypeName: string;
  inCards: SideboardCard[];
  outCards: SideboardCard[];
  notes: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'planar-nexus-sideboard-plans';

/**
 * Generate a unique ID for a new plan
 */
export function generatePlanId(): string {
  return `sideboard-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Get all saved sideboard plans from localStorage
 */
export function getAllSideboardPlans(): SavedSideboardPlan[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const plans = JSON.parse(stored);
    return Array.isArray(plans) ? plans : [];
  } catch (error) {
    console.error('Failed to load sideboard plans:', error);
    return [];
  }
}

/**
 * Get plans filtered by format
 */
export function getSideboardPlansByFormat(format: MagicFormat): SavedSideboardPlan[] {
  const plans = getAllSideboardPlans();
  return plans.filter(plan => plan.format === format);
}

/**
 * Get a single plan by ID
 */
export function getSideboardPlanById(id: string): SavedSideboardPlan | null {
  const plans = getAllSideboardPlans();
  return plans.find(plan => plan.id === id) || null;
}

/**
 * Save a new sideboard plan
 */
export function saveSideboardPlan(plan: Omit<SavedSideboardPlan, 'id' | 'createdAt' | 'updatedAt'>): SavedSideboardPlan {
  const plans = getAllSideboardPlans();
  
  const newPlan: SavedSideboardPlan = {
    ...plan,
    id: generatePlanId(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  plans.push(newPlan);
  
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
  }
  
  return newPlan;
}

/**
 * Update an existing sideboard plan
 */
export function updateSideboardPlan(id: string, updates: Partial<Omit<SavedSideboardPlan, 'id' | 'createdAt'>>): SavedSideboardPlan | null {
  const plans = getAllSideboardPlans();
  const index = plans.findIndex(plan => plan.id === id);
  
  if (index === -1) return null;
  
  const updatedPlan: SavedSideboardPlan = {
    ...plans[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  
  plans[index] = updatedPlan;
  
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
  }
  
  return updatedPlan;
}

/**
 * Delete a sideboard plan by ID
 */
export function deleteSideboardPlan(id: string): boolean {
  const plans = getAllSideboardPlans();
  const index = plans.findIndex(plan => plan.id === id);
  
  if (index === -1) return false;
  
  plans.splice(index, 1);
  
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
  }
  
  return true;
}

/**
 * Delete all sideboard plans
 */
export function clearAllSideboardPlans(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/**
 * Validate a sideboard plan
 */
export function validateSideboardPlan(plan: Partial<SavedSideboardPlan>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!plan.name || plan.name.trim().length === 0) {
    errors.push('Plan name is required');
  }
  
  if (!plan.format) {
    errors.push('Format is required');
  }
  
  if (!plan.archetypeId) {
    errors.push('Player archetype is required');
  }
  
  if (!plan.opponentArchetypeId) {
    errors.push('Opponent archetype is required');
  }
  
  if (!plan.inCards || !Array.isArray(plan.inCards)) {
    errors.push('In-cards list is required');
  }
  
  if (!plan.outCards || !Array.isArray(plan.outCards)) {
    errors.push('Out-cards list is required');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

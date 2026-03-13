/**
 * @fileOverview Custom Card Storage
 * 
 * Local storage utilities for saving and loading custom cards
 * Part of the Custom Card Creation Studio (Issue #593)
 */

import type { CustomCardDefinition } from './custom-card';

const STORAGE_KEY = 'planar-nexus-custom-cards';

/**
 * Get all custom cards from local storage
 */
export function getCustomCards(): CustomCardDefinition[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const cards = JSON.parse(stored) as CustomCardDefinition[];
    return cards;
  } catch (error) {
    console.error('Error loading custom cards:', error);
    return [];
  }
}

/**
 * Save a custom card to local storage
 */
export function saveCustomCard(card: CustomCardDefinition): void {
  if (typeof window === 'undefined') return;
  
  try {
    const cards = getCustomCards();
    const existingIndex = cards.findIndex(c => c.id === card.id);
    
    if (existingIndex >= 0) {
      cards[existingIndex] = { ...card, updatedAt: Date.now() };
    } else {
      cards.push(card);
    }
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
  } catch (error) {
    console.error('Error saving custom card:', error);
    throw error;
  }
}

/**
 * Delete a custom card from local storage
 */
export function deleteCustomCard(cardId: string): void {
  if (typeof window === 'undefined') return;
  
  try {
    const cards = getCustomCards();
    const filteredCards = cards.filter(c => c.id !== cardId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredCards));
  } catch (error) {
    console.error('Error deleting custom card:', error);
    throw error;
  }
}

/**
 * Get a single custom card by ID
 */
export function getCustomCardById(cardId: string): CustomCardDefinition | undefined {
  const cards = getCustomCards();
  return cards.find(c => c.id === cardId);
}

/**
 * Export all custom cards as JSON
 */
export function exportAllCustomCards(): string {
  const cards = getCustomCards();
  return JSON.stringify(cards, null, 2);
}

/**
 * Import custom cards from JSON
 */
export function importCustomCards(json: string): { success: boolean; count: number; errors: string[] } {
  const errors: string[] = [];
  
  try {
    const imported = JSON.parse(json) as CustomCardDefinition[];
    
    if (!Array.isArray(imported)) {
      return { success: false, count: 0, errors: ['Invalid format: expected array of cards'] };
    }
    
    const existingCards = getCustomCards();
    let count = 0;
    
    imported.forEach((card, index) => {
      if (!card.id || !card.name) {
        errors.push(`Card ${index + 1}: Missing required fields (id, name)`);
        return;
      }
      
      const existingIndex = existingCards.findIndex(c => c.id === card.id);
      if (existingIndex >= 0) {
        existingCards[existingIndex] = card;
      } else {
        existingCards.push(card);
      }
      count++;
    });
    
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existingCards));
    
    return { success: true, count, errors };
  } catch (error) {
    return { 
      success: false, 
      count: 0, 
      errors: [error instanceof Error ? error.message : 'Unknown error'] 
    };
  }
}

/**
 * Clear all custom cards
 */
export function clearAllCustomCards(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Get custom card count
 */
export function getCustomCardCount(): number {
  return getCustomCards().length;
}

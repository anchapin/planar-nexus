/**
 * @fileOverview Deck Storage Manager with IndexedDB
 *
 * Unit 16: Local Storage Migration
 *
 * Provides:
 * - Save/load decks using IndexedDB
 * - Deck management operations
 * - Export/import functionality
 * - Backward compatibility with localStorage
 */

import type { DeckCard } from '@/app/actions';
import { indexedDBStorage, StoredDeck } from './indexeddb-storage';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Deck with metadata
 */
export interface Deck {
  /** Unique identifier */
  id: string;
  /** Deck name */
  name: string;
  /** Format */
  format: string;
  /** Cards with quantities */
  cards: DeckCard[];
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Additional metadata */
  metadata?: {
    /** Deck description */
    description?: string;
    /** Commander (for Commander format) */
    commander?: string;
    /** Deck tags */
    tags?: string[];
    /** Color identity */
    colors?: string[];
  };
}

// ============================================================================
// STORAGE KEYS
// ============================================================================

const STORAGE_KEY = 'planar_nexus_decks';

// ============================================================================
// DECK STORAGE MANAGER
// ============================================================================

/**
 * Deck storage manager with IndexedDB support
 */
class DeckStorageManager {
  private initialized: boolean = false;

  /**
   * Initialize storage
   */
  private async initialize(): Promise<void> {
    if (!this.initialized) {
      await indexedDBStorage.initialize();
      this.initialized = true;
    }
  }

  /**
   * Convert Deck to StoredDeck for IndexedDB
   */
  private toStoredDeck(deck: Deck): StoredDeck {
    const storedCards: any[] = deck.cards.map((card: any) => ({
      card: {
        id: card.id,
        name: card.name,
        cmc: card.cmc || 0,
        colors: card.colors || [],
        color_identity: card.color_identity,
        type_line: card.type_line,
        image_uris: card.image_uris ? {
          normal: card.image_uris.normal,
          large: card.image_uris.large,
        } : undefined,
        oracle_text: card.oracle_text,
        mana_cost: card.mana_cost,
        keywords: card.keywords,
      },
      count: card.quantity,
    }));

    return {
      id: deck.id,
      name: deck.name,
      format: deck.format,
      cards: storedCards as any,
      createdAt: deck.createdAt,
      updatedAt: deck.updatedAt,
      metadata: deck.metadata || {},
    };
  }

  /**
   * Convert StoredDeck to Deck from IndexedDB
   */
  private fromStoredDeck(stored: StoredDeck): Deck {
    return {
      id: stored.id,
      name: stored.name,
      format: stored.format,
      cards: stored.cards.map(storedCard => ({
        ...storedCard.card,
        image_uris: storedCard.card.image_uris ? {
          small: storedCard.card.image_uris.normal || '',
          normal: storedCard.card.image_uris.normal || '',
          large: storedCard.card.image_uris.large || '',
          png: storedCard.card.image_uris.large || '',
          art_crop: storedCard.card.image_uris.large || '',
          border_crop: storedCard.card.image_uris.large || '',
        } : undefined,
        quantity: storedCard.count,
      })) as any,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
      metadata: stored.metadata,
    };
  }

  /**
   * Get all decks
   */
  async getAllDecks(): Promise<Deck[]> {
    if (typeof window === 'undefined') return [];

    try {
      await this.initialize();
      const storedDecks = await indexedDBStorage.getAll<StoredDeck>('decks');
      return storedDecks
        .map(this.fromStoredDeck)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    } catch (error) {
      console.error('Failed to get decks from IndexedDB:', error);

      // Fallback to localStorage
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];

        const decks = JSON.parse(stored);
        return Array.isArray(decks) ? decks : [];
      } catch (e) {
        console.error('Failed to parse decks from localStorage:', e);
        return [];
      }
    }
  }

  /**
   * Get deck by ID
   */
  async getDeck(id: string): Promise<Deck | null> {
    try {
      await this.initialize();
      const storedDeck = await indexedDBStorage.get<StoredDeck>('decks', id);
      return storedDeck ? this.fromStoredDeck(storedDeck) : null;
    } catch (error) {
      console.error('Failed to get deck from IndexedDB:', error);

      // Fallback to localStorage
      const decks = await this.getAllDecks();
      return decks.find(d => d.id === id) || null;
    }
  }

  /**
   * Save a deck
   */
  async saveDeck(deck: Deck): Promise<Deck> {
    const deckToSave = {
      ...deck,
      updatedAt: new Date().toISOString(),
    };

    try {
      await this.initialize();
      const storedDeck = this.toStoredDeck(deckToSave);
      await indexedDBStorage.set('decks', storedDeck);
      return deckToSave;
    } catch (error) {
      console.error('Failed to save deck to IndexedDB:', error);

      // Fallback to localStorage
      const decks = await this.getAllDecks();

      // Check if deck with same ID exists
      const existingIndex = decks.findIndex(d => d.id === deckToSave.id);

      if (existingIndex >= 0) {
        // Update existing
        decks[existingIndex] = deckToSave;
      } else {
        // Add new
        decks.push(deckToSave);
      }

      this.saveDecksToLocalStorage(decks);
      return deckToSave;
    }
  }

  /**
   * Create a new deck
   */
  async createDeck(name: string, format: string, cards: DeckCard[]): Promise<Deck> {
    const now = new Date().toISOString();
    const deck: Deck = {
      id: `deck-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      format,
      cards,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };

    return this.saveDeck(deck);
  }

  /**
   * Update an existing deck
   */
  async updateDeck(id: string, updates: Partial<Omit<Deck, 'id' | 'createdAt'>>): Promise<Deck | null> {
    const deck = await this.getDeck(id);
    if (!deck) return null;

    const updatedDeck: Deck = {
      ...deck,
      ...updates,
      id: deck.id,
      createdAt: deck.createdAt,
      updatedAt: new Date().toISOString(),
    };

    return this.saveDeck(updatedDeck);
  }

  /**
   * Delete a deck
   */
  async deleteDeck(id: string): Promise<boolean> {
    try {
      await this.initialize();
      await indexedDBStorage.delete('decks', id);
      return true;
    } catch (error) {
      console.error('Failed to delete deck from IndexedDB:', error);

      // Fallback to localStorage
      const decks = await this.getAllDecks();
      const filteredDecks = decks.filter(d => d.id !== id);

      if (filteredDecks.length === decks.length) {
        return false; // No deck was deleted
      }

      this.saveDecksToLocalStorage(filteredDecks);
      return true;
    }
  }

  /**
   * Duplicate a deck
   */
  async duplicateDeck(id: string, newName?: string): Promise<Deck | null> {
    const original = await this.getDeck(id);
    if (!original) return null;

    const now = new Date().toISOString();
    const duplicate: Deck = {
      ...original,
      id: `deck-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: newName || `${original.name} (Copy)`,
      createdAt: now,
      updatedAt: now,
    };

    return this.saveDeck(duplicate);
  }

  /**
   * Search decks by name or content
   */
  async searchDecks(query: string): Promise<Deck[]> {
    if (!query.trim()) return this.getAllDecks();

    const lowerQuery = query.toLowerCase();
    const decks = await this.getAllDecks();

    return decks.filter(
      deck =>
        deck.name.toLowerCase().includes(lowerQuery) ||
        deck.format.toLowerCase().includes(lowerQuery) ||
        deck.metadata?.tags?.some(tag => tag.toLowerCase().includes(lowerQuery)) ||
        deck.cards.some(
          card => card.name.toLowerCase().includes(lowerQuery)
        )
    );
  }

  /**
   * Filter decks by format
   */
  async filterByFormat(format: string): Promise<Deck[]> {
    const decks = await this.getAllDecks();
    return decks.filter(d => d.format === format);
  }

  /**
   * Get deck count
   */
  async getDeckCount(): Promise<number> {
    try {
      await this.initialize();
      return await indexedDBStorage.count('decks');
    } catch (error) {
      console.error('Failed to get deck count:', error);

      // Fallback to localStorage
      if (typeof window === 'undefined') return 0;
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return 0;
      try {
        const decks = JSON.parse(stored);
        return Array.isArray(decks) ? decks.length : 0;
      } catch {
        return 0;
      }
    }
  }

  /**
   * Export deck to JSON file
   */
  async exportDeck(id: string): Promise<void> {
    const deck = await this.getDeck(id);
    if (!deck) return;

    const blob = new Blob([JSON.stringify(deck, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deck-${deck.name.replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Import deck from JSON file
   */
  async importDeck(file: File): Promise<Deck | null> {
    try {
      const text = await file.text();
      const deck = JSON.parse(text) as Deck;

      // Generate new ID to avoid conflicts
      deck.id = `imported-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      deck.createdAt = new Date().toISOString();
      deck.updatedAt = new Date().toISOString();

      return this.saveDeck(deck);
    } catch (error) {
      console.error('Failed to import deck:', error);
      return null;
    }
  }

  /**
   * Clear all decks
   */
  async clearAllDecks(): Promise<void> {
    try {
      await this.initialize();
      await indexedDBStorage.clear('decks');

      // Also clear localStorage for backward compatibility
      if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (error) {
      console.error('Failed to clear decks:', error);

      // Fallback to localStorage
      if (typeof window !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }

  /**
   * Save decks to localStorage (fallback)
   */
  private saveDecksToLocalStorage(decks: Deck[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Default deck storage manager instance
 */
export const deckStorage = new DeckStorageManager();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate deck statistics
 */
export function calculateDeckStats(deck: Deck): {
  totalCards: number;
  uniqueCards: number;
  averageCMC: number;
  colorIdentity: string[];
} {
  const totalCards = deck.cards.reduce((sum, card) => sum + card.count, 0);
  const uniqueCards = deck.cards.length;
  const averageCMC =
    deck.cards.reduce((sum, card) => sum + (card.cmc || 0) * card.count, 0) / totalCards;

  // Calculate color identity
  const colorSet = new Set<string>();
  for (const card of deck.cards) {
    if (card.color_identity) {
      card.color_identity.forEach(color => colorSet.add(color));
    }
  }
  const colorIdentity = Array.from(colorSet);

  return {
    totalCards,
    uniqueCards,
    averageCMC,
    colorIdentity,
  };
}

/**
 * Format deck size
 */
export function formatDeckSize(count: number): string {
  return `${count} card${count === 1 ? '' : 's'}`;
}

/**
 * Validate deck for a format
 */
export function validateDeckFormat(deck: Deck): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Basic validation
  if (deck.cards.length === 0) {
    errors.push('Deck must contain at least one card');
  }

  const totalCards = deck.cards.reduce((sum, card) => sum + card.count, 0);

  // Format-specific validation
  switch (deck.format.toLowerCase()) {
    case 'commander':
      if (totalCards !== 100) {
        errors.push('Commander decks must have exactly 100 cards');
      }
      break;
    case 'standard':
    case 'modern':
    case 'pioneer':
    case 'historic':
      if (totalCards < 60) {
        errors.push(`${deck.format} decks must have at least 60 cards`);
      }
      break;
    case 'pauper': {
      if (totalCards < 60) {
        errors.push('Pauper decks must have at least 60 cards');
      }
      // Check that all cards are common
      const uncommonOrBetter = deck.cards.filter(
        card => card.rarity && card.rarity !== 'common'
      );
      if (uncommonOrBetter.length > 0) {
        errors.push('Pauper decks can only contain common cards');
      }
      break;
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

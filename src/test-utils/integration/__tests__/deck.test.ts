/**
 * Integration tests for deck creation and saving
 * 
 * These tests verify the deck creation and saving functionality
 * using mock data and localStorage mocking.
 */

import { createMockDeck, createMockCard } from '@/test-utils/integration';
import type { SavedDeck } from '@/app/actions';

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

describe('Deck Creation Integration Tests', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('createMockDeck', () => {
    it('should create a deck with default values', () => {
      const deck = createMockDeck();
      
      expect(deck).toBeDefined();
      expect(deck.name).toBe('Test Deck');
      expect(deck.format).toBe('commander');
      expect(deck.cards).toBeDefined();
      expect(Array.isArray(deck.cards)).toBe(true);
    });

    it('should create a deck with custom name', () => {
      const deck = createMockDeck({ name: 'My Custom Deck' });
      
      expect(deck.name).toBe('My Custom Deck');
    });

    it('should create a deck with custom format', () => {
      const deck = createMockDeck({ format: 'standard' });
      
      expect(deck.format).toBe('standard');
    });

    it('should create a deck with specified cards', () => {
      const cards = [
        { name: 'Lightning Bolt', quantity: 4 },
        { name: 'Counterspell', quantity: 4 },
      ];
      const deck = createMockDeck({ cards });
      
      expect(deck.cards).toHaveLength(2);
      expect(deck.cards[0].name).toBe('Lightning Bolt');
      expect(deck.cards[0].quantity).toBe(4);
    });

    it('should generate cards when cardCount is specified', () => {
      const deck = createMockDeck({ cardCount: 10 });
      
      expect(deck.cards).toHaveLength(10);
    });

    it('should include timestamps', () => {
      const deck = createMockDeck();
      
      expect(deck.createdAt).toBeDefined();
      expect(deck.updatedAt).toBeDefined();
    });

    it('should generate unique IDs', () => {
      const deck1 = createMockDeck();
      const deck2 = createMockDeck();
      
      expect(deck1.id).not.toBe(deck2.id);
    });
  });

  describe('Deck Validation', () => {
    it('should validate minimum card count', () => {
      const deck = createMockDeck({ cardCount: 60 });
      
      // Commander format requires 100 cards minimum
      const isValidCommander = deck.cards.reduce((sum, card) => sum + card.quantity, 0) >= 100;
      expect(isValidCommander).toBe(false); // 60 cards is not enough for commander
    });

    it('should validate 4-copy limit', () => {
      const cards = [
        { name: 'Lightning Bolt', quantity: 4 },
        { name: 'Counterspell', quantity: 4 },
      ];
      const deck = createMockDeck({ cards, format: 'commander' });
      
      // All cards should respect 4-copy limit
      deck.cards.forEach(card => {
        expect(card.quantity).toBeLessThanOrEqual(4);
      });
    });
  });

  describe('Deck Persistence', () => {
    it('should save deck to localStorage', () => {
      const deck = createMockDeck({ name: 'Test Save' });
      
      localStorage.setItem('saved-decks', JSON.stringify([deck]));
      
      const stored = localStorage.getItem('saved-decks');
      const parsed = stored ? JSON.parse(stored) : [];
      
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('Test Save');
    });

    it('should load deck from localStorage', () => {
      const deck = createMockDeck({ name: 'Persisted Deck' });
      localStorage.setItem('saved-decks', JSON.stringify([deck]));
      
      const stored = localStorage.getItem('saved-decks');
      const loadedDecks: SavedDeck[] = stored ? JSON.parse(stored) : [];
      
      expect(loadedDecks).toHaveLength(1);
      expect(loadedDecks[0].name).toBe('Persisted Deck');
    });

    it('should update existing deck', () => {
      const originalDeck = createMockDeck({ name: 'Original', id: 'deck-1' });
      localStorage.setItem('saved-decks', JSON.stringify([originalDeck]));
      
      const updatedDeck = { ...originalDeck, name: 'Updated' };
      const decks = JSON.parse(localStorage.getItem('saved-decks') || '[]');
      const updatedDecks = decks.map((d: SavedDeck) => d.id === updatedDeck.id ? updatedDeck : d);
      localStorage.setItem('saved-decks', JSON.stringify(updatedDecks));
      
      const stored = JSON.parse(localStorage.getItem('saved-decks') || '[]');
      expect(stored[0].name).toBe('Updated');
    });

    it('should delete deck from localStorage', () => {
      const deck1 = createMockDeck({ name: 'Deck 1', id: 'deck-1' });
      const deck2 = createMockDeck({ name: 'Deck 2', id: 'deck-2' });
      localStorage.setItem('saved-decks', JSON.stringify([deck1, deck2]));
      
      const decks = JSON.parse(localStorage.getItem('saved-decks') || '[]');
      const filteredDecks = decks.filter((d: SavedDeck) => d.id !== 'deck-1');
      localStorage.setItem('saved-decks', JSON.stringify(filteredDecks));
      
      const stored = JSON.parse(localStorage.getItem('saved-decks') || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('Deck 2');
    });
  });
});

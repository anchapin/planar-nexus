/**
 * Integration tests for deck CRUD operations
 * 
 * These tests verify the deck management functionality including:
 * - Creating decks
 * - Reading decks
 * - Updating decks
 * - Deleting decks
 */

import { describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { createMockDeck } from '@/test-utils/integration';

// Import the deck storage functions to test
import { deckStorage } from '@/lib/deck-storage';
import type { Deck } from '@/lib/deck-storage';

describe('Deck CRUD Integration Tests', () => {
  beforeAll(async () => {
    // Initialize: call any public method to trigger initialization
    // The initialize is called internally by each method
  });

  beforeEach(async () => {
    // Clear all decks before each test
    await deckStorage.clearAllDecks();
  });

  describe('Create Deck', () => {
    it('should create a new deck', async () => {
      const mockDeck = createMockDeck({
        name: 'Test Create Deck',
        format: 'commander',
        cardCount: 10
      });

      const result = await deckStorage.saveDeck(mockDeck as unknown as Deck);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.name).toBe('Test Create Deck');
      expect(result.format).toBe('commander');
      expect(result.cards.length).toBe(10);
    });

    it('should assign unique IDs to new decks', async () => {
      const deck1 = createMockDeck({ name: 'Deck 1' });
      const deck2 = createMockDeck({ name: 'Deck 2' });

      await deckStorage.saveDeck(deck1 as unknown as Deck);
      await deckStorage.saveDeck(deck2 as unknown as Deck);

      expect(deck1.id).not.toBe(deck2.id);
    });
  });

  describe('Read Deck', () => {
    it('should retrieve a deck by ID', async () => {
      const mockDeck = createMockDeck({
        name: 'Test Read Deck',
        format: 'modern'
      });

      await deckStorage.saveDeck(mockDeck as unknown as Deck);
      const retrieved = await deckStorage.getDeck(mockDeck.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(mockDeck.id);
      expect(retrieved?.name).toBe('Test Read Deck');
    });

    it('should return null for non-existent deck', async () => {
      const retrieved = await deckStorage.getDeck('non-existent-id');
      expect(retrieved).toBeNull();
    });

    it('should retrieve all decks', async () => {
      const deck1 = createMockDeck({ name: 'All Decks Test 1' });
      const deck2 = createMockDeck({ name: 'All Decks Test 2' });

      await deckStorage.saveDeck(deck1 as unknown as Deck);
      await deckStorage.saveDeck(deck2 as unknown as Deck);

      const allDecks = await deckStorage.getAllDecks();

      expect(allDecks.length).toBeGreaterThanOrEqual(2);
      expect(allDecks.some((d: Deck) => d.id === deck1.id)).toBe(true);
      expect(allDecks.some((d: Deck) => d.id === deck2.id)).toBe(true);
    });
  });

  describe('Update Deck', () => {
    it('should update an existing deck', async () => {
      const mockDeck = createMockDeck({ name: 'Original Name' });
      await deckStorage.saveDeck(mockDeck as unknown as Deck);

      // Modify deck
      mockDeck.name = 'Updated Name';
      mockDeck.cards = mockDeck.cards.slice(0, 5); // Reduce card count

      const updated = await deckStorage.saveDeck(mockDeck as unknown as Deck);

      expect(updated.name).toBe('Updated Name');
      expect(updated.cards.length).toBe(5);

      // Verify persisted
      const retrieved = await deckStorage.getDeck(mockDeck.id);
      expect(retrieved?.name).toBe('Updated Name');
    });

    it('should update deck timestamp on save', async () => {
      const mockDeck = createMockDeck();
      const savedDeck = await deckStorage.saveDeck(mockDeck as unknown as Deck);

      const originalUpdatedAt = savedDeck.updatedAt;

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 100));

      savedDeck.name = 'New Name';
      const updatedDeck = await deckStorage.saveDeck(savedDeck as unknown as Deck);

      expect(updatedDeck.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('Delete Deck', () => {
    it('should delete a deck', async () => {
      const mockDeck = createMockDeck({ name: 'To Delete' });
      await deckStorage.saveDeck(mockDeck as unknown as Deck);

      // Verify exists
      let retrieved = await deckStorage.getDeck(mockDeck.id);
      expect(retrieved).toBeDefined();

      // Delete
      await deckStorage.deleteDeck(mockDeck.id);

      // Verify gone
      retrieved = await deckStorage.getDeck(mockDeck.id);
      expect(retrieved).toBeNull();
    });

    it('should handle deleting non-existent deck gracefully', async () => {
      // Should not throw
      await expect(deckStorage.deleteDeck('non-existent-id')).resolves.not.toThrow();
    });
  });
});

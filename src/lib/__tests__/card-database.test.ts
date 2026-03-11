/**
 * Tests for the card database module
 *
 * Note: These tests require a browser environment with IndexedDB support.
 * They can be run using Jest with jsdom or in a real browser.
 */

import {
  initializeCardDatabase,
  searchCardsOffline,
  getCardByName,
  getCardById,
  isCardLegal,
  validateDeckOffline,
  getDatabaseStatus,
  addCard,
  addCards,
  clearDatabase,
  getAllCards,
  MinimalCard,
} from '../card-database';

describe('Card Database', () => {
  beforeAll(async () => {
    // Initialize database for all tests
    await initializeCardDatabase();
  });

  afterAll(async () => {
    // Clean up database after tests
    await clearDatabase();
  });

  describe('Initialization', () => {
    it('should initialize the database', async () => {
      const status = await getDatabaseStatus();
      expect(status.loaded).toBe(true);
      expect(status.cardCount).toBeGreaterThan(0);
    });
  });

  describe('Search Functionality', () => {
    it('should search for cards by name', async () => {
      const results = await searchCardsOffline('Sol Ring');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('Sol Ring');
    });

    it('should perform fuzzy search', async () => {
      const results = await searchCardsOffline('sol rn');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name.toLowerCase()).toContain('sol');
    });

    it('should respect maxCards limit', async () => {
      const results = await searchCardsOffline('land', { maxCards: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should filter by format', async () => {
      const results = await searchCardsOffline('Sol Ring', { format: 'commander' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].legalities.commander).toBe('legal');
    });

    it('should return empty array for short queries', async () => {
      const results = await searchCardsOffline('a');
      expect(results).toEqual([]);
    });

    it('should handle empty query', async () => {
      const results = await searchCardsOffline('');
      expect(results).toEqual([]);
    });
  });

  describe('Card Retrieval', () => {
    it('should get card by exact name', async () => {
      const card = await getCardByName('Sol Ring');
      expect(card).toBeDefined();
      expect(card?.name).toBe('Sol Ring');
    });

    it('should get card by ID', async () => {
      // First find the card by name to get its ID
      const cardByName = await getCardByName('Sol Ring');
      expect(cardByName).toBeDefined();

      const card = await getCardById(cardByName!.id);
      expect(card).toBeDefined();
      expect(card?.name).toBe('Sol Ring');
    });

    it('should return undefined for non-existent card', async () => {
      const card = await getCardByName('NonExistentCard');
      expect(card).toBeUndefined();
    });

    it('should be case-insensitive for name search', async () => {
      const card1 = await getCardByName('sol ring');
      const card2 = await getCardByName('SOL RING');
      const card3 = await getCardByName('Sol Ring');

      expect(card1?.id).toBe(card2?.id);
      expect(card2?.id).toBe(card3?.id);
    });
  });

  describe('Legality Checking', () => {
    it('should check if card is legal in format', async () => {
      const isLegal = await isCardLegal('Sol Ring', 'commander');
      expect(isLegal).toBe(true);
    });

    it('should return false for illegal card', async () => {
      // Note: Sol Ring is legal in most formats, so this test depends on having
      // a card that's not legal in a specific format
      const isLegal = await isCardLegal('Sol Ring', 'pauper');
      // Sol Ring is not legal in Pauper
      expect(isLegal).toBe(false);
    });
  });

  describe('Deck Validation', () => {
    it('should validate legal deck', async () => {
      const validation = await validateDeckOffline(
        [
          { name: 'Sol Ring', quantity: 1 },
          { name: 'Lightning Bolt', quantity: 4 },
        ],
        'commander'
      );
      expect(validation.valid).toBe(true);
      expect(validation.illegalCards).toEqual([]);
      expect(validation.issues).toEqual([]);
    });

    it('should detect illegal cards', async () => {
      const validation = await validateDeckOffline(
        [
          { name: 'Sol Ring', quantity: 1 },
          // Add a card that's not legal in the format
          { name: 'Ancestral Recall', quantity: 1 },
        ],
        'pauper'
      );
      expect(validation.valid).toBe(false);
      expect(validation.illegalCards.length).toBeGreaterThan(0);
    });

    it('should detect missing cards', async () => {
      const validation = await validateDeckOffline(
        [
          { name: 'Sol Ring', quantity: 1 },
          { name: 'NonExistentCard', quantity: 1 },
        ],
        'commander'
      );
      expect(validation.valid).toBe(false);
      expect(validation.issues.length).toBeGreaterThan(0);
      expect(validation.issues[0]).toContain('Card not found');
    });
  });

  describe('Card Management', () => {
    beforeEach(async () => {
      // Clear database before each test
      await clearDatabase();
    });

    it('should add a single card', async () => {
      const testCard: MinimalCard = {
        id: 'test-card-1',
        name: 'Test Card',
        cmc: 1,
        type_line: 'Creature',
        oracle_text: 'Test text',
        colors: ['R'],
        color_identity: ['R'],
        legalities: { commander: 'legal', modern: 'legal' },
      };

      await addCard(testCard);
      const status = await getDatabaseStatus();
      expect(status.cardCount).toBe(1);
    });

    it('should add multiple cards', async () => {
      const cards: MinimalCard[] = [
        {
          id: 'test-card-1',
          name: 'Test Card 1',
          cmc: 1,
          type_line: 'Creature',
          oracle_text: 'Test text',
          colors: ['R'],
          color_identity: ['R'],
          legalities: { commander: 'legal', modern: 'legal' },
        },
        {
          id: 'test-card-2',
          name: 'Test Card 2',
          cmc: 2,
          type_line: 'Sorcery',
          oracle_text: 'Test text',
          colors: ['U'],
          color_identity: ['U'],
          legalities: { commander: 'legal', modern: 'legal' },
        },
      ];

      await addCards(cards);
      const status = await getDatabaseStatus();
      expect(status.cardCount).toBe(2);
    });

    it('should update existing card', async () => {
      const card: MinimalCard = {
        id: 'test-card-1',
        name: 'Test Card',
        cmc: 1,
        type_line: 'Creature',
        oracle_text: 'Original text',
        colors: ['R'],
        color_identity: ['R'],
        legalities: { commander: 'legal', modern: 'legal' },
      };

      await addCard(card);

      const updatedCard: MinimalCard = {
        ...card,
        oracle_text: 'Updated text',
      };

      await addCard(updatedCard);

      const retrieved = await getCardById('test-card-1');
      expect(retrieved?.oracle_text).toBe('Updated text');
    });

    it('should clear all cards', async () => {
      const cards: MinimalCard[] = [
        {
          id: 'test-card-1',
          name: 'Test Card 1',
          cmc: 1,
          type_line: 'Creature',
          oracle_text: 'Test text',
          colors: ['R'],
          color_identity: ['R'],
          legalities: { commander: 'legal', modern: 'legal' },
        },
        {
          id: 'test-card-2',
          name: 'Test Card 2',
          cmc: 2,
          type_line: 'Sorcery',
          oracle_text: 'Test text',
          colors: ['U'],
          color_identity: ['U'],
          legalities: { commander: 'legal', modern: 'legal' },
        },
      ];

      await addCards(cards);
      let status = await getDatabaseStatus();
      expect(status.cardCount).toBe(2);

      await clearDatabase();
      status = await getDatabaseStatus();
      expect(status.cardCount).toBe(0);
    });

    it('should get all cards', async () => {
      const cards: MinimalCard[] = [
        {
          id: 'test-card-1',
          name: 'Test Card 1',
          cmc: 1,
          type_line: 'Creature',
          oracle_text: 'Test text',
          colors: ['R'],
          color_identity: ['R'],
          legalities: { commander: 'legal', modern: 'legal' },
        },
        {
          id: 'test-card-2',
          name: 'Test Card 2',
          cmc: 2,
          type_line: 'Sorcery',
          oracle_text: 'Test text',
          colors: ['U'],
          color_identity: ['U'],
          legalities: { commander: 'legal', modern: 'legal' },
        },
      ];

      await addCards(cards);
      const allCards = await getAllCards();
      expect(allCards.length).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid card data gracefully', async () => {
      // This test ensures the database doesn't crash on invalid data
      const result = await searchCardsOffline('InvalidCardThatDoesNotExist');
      expect(Array.isArray(result)).toBe(true);
    });

    it('should handle empty database', async () => {
      await clearDatabase();
      const result = await searchCardsOffline('Sol Ring');
      expect(result).toEqual([]);
    });
  });
});

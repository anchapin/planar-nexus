/**
 * Deck Factory
 * 
 * Provides factory functions for creating consistent test deck data
 * that matches the SavedDeck format.
 */

import type { DeckCard, SavedDeck } from '@/app/actions';
import { createCard, type CreateCardOptions } from './card';
import type { Format } from '@/lib/game-rules';

/**
 * Default deck name
 */
const DEFAULT_DECK_NAME = 'Test Deck';

/**
 * Options for creating a deck
 */
export interface CreateDeckOptions {
  /**
   * Deck name
   */
  name?: string;
  /**
   * Deck format (commander, standard, modern, etc.)
   */
  format?: Format;
  /**
   * Cards in the deck
   */
  cards?: DeckCard[];
  /**
   * Number of random cards to generate
   */
  cardCount?: number;
  /**
   * Card factory options for generating random cards
   */
  cardOptions?: CreateCardOptions;
  /**
   * Deck ID
   */
  id?: string;
  /**
   * Created timestamp
   */
  createdAt?: string;
  /**
   * Updated timestamp
   */
  updatedAt?: string;
}

/**
 * Generate a unique ID for decks
 */
let deckIdCounter = 0;
function generateDeckId(): string {
  deckIdCounter++;
  return `test-deck-${deckIdCounter.toString().padStart(4, '0')}`;
}

/**
 * Generate a timestamp
 */
function generateTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create a basic deck with default values
 * 
 * @param options - Deck options to override defaults
 * @returns A SavedDeck object
 * 
 * @example
 * const deck = createDeck({ name: 'My Commander Deck' });
 * console.log(deck.name); // 'My Commander Deck'
 * console.log(deck.format); // 'commander'
 */
export function createDeck(options: CreateDeckOptions = {}): SavedDeck {
  const id = options.id || generateDeckId();
  const timestamp = generateTimestamp();
  
  // Generate cards if cardCount is specified
  let cards: DeckCard[] = options.cards || [];
  if (options.cardCount && cards.length === 0) {
    cards = generateDeckCards(options.cardCount, options.cardOptions);
  }
  
  return {
    id,
    name: options.name || DEFAULT_DECK_NAME,
    format: options.format || 'commander',
    cards,
    createdAt: options.createdAt || timestamp,
    updatedAt: options.updatedAt || timestamp,
  };
}

/**
 * Generate random deck cards
 */
function generateDeckCards(count: number, options?: CreateCardOptions): DeckCard[] {
  const cards: DeckCard[] = [];
  const cardTypes = ['creature', 'instant', 'sorcery', 'artifact', 'enchantment', 'land'];
  
  for (let i = 0; i < count; i++) {
    const cardType = cardTypes[i % cardTypes.length];
    let card: ReturnType<typeof createCard>;
    
    switch (cardType) {
      case 'creature':
        card = createCard({
          ...options,
          name: options?.name ? `${options.name} Creature ${i + 1}` : `Test Creature ${i + 1}`,
          type_line: 'Creature — Bear',
          power: String(Math.floor(Math.random() * 4) + 1),
          toughness: String(Math.floor(Math.random() * 4) + 1),
        });
        break;
      case 'instant':
        card = createCard({
          ...options,
          name: options?.name ? `${options.name} Instant ${i + 1}` : `Test Instant ${i + 1}`,
          type_line: 'Instant',
        });
        break;
      case 'sorcery':
        card = createCard({
          ...options,
          name: options?.name ? `${options.name} Sorcery ${i + 1}` : `Test Sorcery ${i + 1}`,
          type_line: 'Sorcery',
        });
        break;
      case 'artifact':
        card = createCard({
          ...options,
          name: options?.name ? `${options.name} Artifact ${i + 1}` : `Test Artifact ${i + 1}`,
          type_line: 'Artifact',
          colors: [],
        });
        break;
      case 'enchantment':
        card = createCard({
          ...options,
          name: options?.name ? `${options.name} Enchantment ${i + 1}` : `Test Enchantment ${i + 1}`,
          type_line: 'Enchantment',
        });
        break;
      case 'land':
      default:
        card = createCard({
          ...options,
          name: options?.name ? `${options.name} Land ${i + 1}` : `Test Land ${i + 1}`,
          type_line: 'Land',
          cmc: 0,
          colors: [],
        });
        break;
    }
    
    cards.push({
      ...card,
      count: Math.floor(Math.random() * 3) + 1, // 1-3 copies
    });
  }
  
  return cards;
}

/**
 * Create a Commander deck
 * 
 * @param options - Deck options to override defaults
 * @returns A SavedDeck in Commander format
 * 
 * @example
 * const commander = createCommanderDeck({
 *   name: 'Jhoira Tribal',
 *   cardCount: 100
 * });
 * console.log(commander.format); // 'commander'
 */
export function createCommanderDeck(options: CreateDeckOptions = {}): SavedDeck {
  return createDeck({
    format: 'commander',
    cardCount: options.cardCount || 100,
    ...options,
  });
}

/**
 * Create a Limited deck (40 cards for Draft/Sealed)
 * 
 * @param options - Deck options to override defaults
 * @returns A SavedDeck in Standard format
 * 
 * @example
 * const limited = createLimitedDeck({ cardCount: 40 });
 * console.log(limited.cards.length); // 40
 */
export function createLimitedDeck(options: CreateDeckOptions = {}): SavedDeck {
  return createDeck({
    format: 'standard',
    cardCount: options.cardCount || 40,
    ...options,
  });
}

/**
 * Create a Standard deck (60 cards)
 * 
 * @param options - Deck options to override defaults
 * @returns A SavedDeck in Standard format
 * 
 * @example
 * const standard = createStandardDeck();
 * console.log(standard.format); // 'standard'
 */
export function createStandardDeck(options: CreateDeckOptions = {}): SavedDeck {
  return createDeck({
    format: 'standard',
    cardCount: options.cardCount || 60,
    ...options,
  });
}

/**
 * Create a Modern deck (60 cards)
 * 
 * @param options - Deck options to override defaults
 * @returns A SavedDeck in Modern format
 */
export function createModernDeck(options: CreateDeckOptions = {}): SavedDeck {
  return createDeck({
    format: 'modern',
    cardCount: options.cardCount || 60,
    ...options,
  });
}

/**
 * Create an empty deck
 * 
 * @param options - Deck options to override defaults
 * @returns An empty SavedDeck
 * 
 * @example
 * const empty = createEmptyDeck({ name: 'Empty Deck' });
 * console.log(empty.cards.length); // 0
 */
export function createEmptyDeck(options: CreateDeckOptions = {}): SavedDeck {
  return createDeck({
    cards: [],
    cardCount: 0,
    ...options,
  });
}

/**
 * Add cards to an existing deck
 * 
 * @param deck - The deck to add cards to
 * @param cards - Cards to add
 * @returns A new deck with the added cards
 * 
 * @example
 * const deck = createDeck();
 * const updated = addCardsToDeck(deck, [card1, card2]);
 */
export function addCardsToDeck(deck: SavedDeck, cards: DeckCard[]): SavedDeck {
  const existingCardMap = new Map(deck.cards.map(c => [c.id, c]));
  
  // Merge cards
  cards.forEach(card => {
    const existing = existingCardMap.get(card.id);
    if (existing) {
      existing.count += card.count;
    } else {
      existingCardMap.set(card.id, card);
    }
  });
  
  return {
    ...deck,
    cards: Array.from(existingCardMap.values()),
    updatedAt: generateTimestamp(),
  };
}

/**
 * Remove cards from a deck
 * 
 * @param deck - The deck to remove cards from
 * @param cardIds - IDs of cards to remove
 * @returns A new deck without the specified cards
 */
export function removeCardsFromDeck(deck: SavedDeck, cardIds: string[]): SavedDeck {
  const cardIdSet = new Set(cardIds);
  
  return {
    ...deck,
    cards: deck.cards.filter(card => !cardIdSet.has(card.id)),
    updatedAt: generateTimestamp(),
  };
}

/**
 * Reset deck ID counter (useful for test isolation)
 */
export function resetDeckIdCounter(): void {
  deckIdCounter = 0;
}

export default {
  createDeck,
  createCommanderDeck,
  createLimitedDeck,
  createStandardDeck,
  createModernDeck,
  createEmptyDeck,
  addCardsToDeck,
  removeCardsFromDeck,
  resetDeckIdCounter,
};

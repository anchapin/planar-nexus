/**
 * Fetch mock for Scryfall API
 * 
 * Provides mock implementations for Scryfall API responses
 * to enable offline testing without actual API calls.
 */

import type { MinimalCard } from '@/lib/card-database';

/**
 * Default mock card data for testing
 */
export const MOCK_CARDS = {
  lightningBolt: {
    id: '1',
    name: 'Lightning Bolt',
    oracle_id: 'abcdef12-3456-7890-abcd-ef1234567890',
    set: 'm19',
    collector_number: '141',
    cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    colors: ['R'],
    color_identity: ['R'],
    rarity: 'common',
    legalities: {
      standard: 'legal',
      modern: 'legal',
      legacy: 'legal',
      commander: 'legal',
    },
    mana_cost: '{R}',
    power: undefined,
    toughness: undefined,
  } as MinimalCard,
  
  birdsOfParadise: {
    id: '2',
    name: 'Birds of Paradise',
    oracle_id: 'bcdef123-4567-8901-bcde-f12345678901',
    set: 'm12',
    collector_number: '164',
    cmc: 1,
    type_line: 'Creature — Bird',
    oracle_text: 'Flying\nTap: Add one mana of any color.',
    colors: ['G'],
    color_identity: [],
    rarity: 'rare',
    legalities: {
      standard: 'not_legal',
      modern: 'legal',
      legacy: 'legal',
      commander: 'legal',
    },
    mana_cost: '{G}',
    power: '0',
    toughness: '1',
  } as MinimalCard,
  
  counterse: {
    id: '3',
    name: 'Counterspell',
    oracle_id: 'cdef1234-5678-9012-cdef-123456789012',
    set: 'mh2',
    collector_number: '247',
    cmc: 2,
    type_line: 'Instant',
    oracle_text: 'Counter target spell.',
    colors: ['U'],
    color_identity: ['U'],
    rarity: 'common',
    legalities: {
      standard: 'not_legal',
      modern: 'legal',
      legacy: 'legal',
      commander: 'legal',
    },
    mana_cost: '{U}{U}',
    power: undefined,
    toughness: undefined,
  } as MinimalCard,
  
  solRing: {
    id: '4',
    name: 'Sol Ring',
    oracle_id: 'def12345-6789-0123-def1-234567890123',
    set: 'cmd',
    collector_number: '210',
    cmc: 1,
    type_line: 'Artifact',
    oracle_text: '{Tap}: Add {C}{C}.',
    colors: [],
    color_identity: [],
    rarity: 'uncommon',
    legalities: {
      standard: 'not_legal',
      modern: 'legal',
      legacy: 'legal',
      commander: 'legal',
    },
    mana_cost: '{1}',
    power: undefined,
    toughness: undefined,
  } as MinimalCard,
  
  shock: {
    id: '5',
    name: 'Shock',
    oracle_id: 'ef123456-7890-1234-ef12-345678901234',
    set: 'm21',
    collector_number: '159',
    cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Shock deals 2 damage to any target.',
    colors: ['R'],
    color_identity: ['R'],
    rarity: 'common',
    legalities: {
      standard: 'legal',
      modern: 'legal',
      legacy: 'legal',
      commander: 'legal',
    },
    mana_cost: '{R}',
    power: undefined,
    toughness: undefined,
  } as MinimalCard,
};

/**
 * Mock Scryfall search response format
 */
export interface MockScryfallResponse<T> {
  object: 'list';
  total_cards: number;
  has_more: boolean;
  data: T[];
}

/**
 * Create a mock Scryfall search response
 */
export function createMockSearchResponse<T>(
  cards: T[],
  hasMore: boolean = false
): MockScryfallResponse<T> {
  return {
    object: 'list',
    total_cards: cards.length,
    has_more: hasMore,
    data: cards,
  };
}

/**
 * Mock fetch implementation
 * Returns mock data for Scryfall API endpoints
 */
export function createFetchMock() {
  return jest.fn().mockImplementation(async (url: string) => {
    // Handle card search endpoint
    if (url.includes('cards/search')) {
      const queryMatch = url.match(/q=([^&]+)/);
      const query = queryMatch ? decodeURIComponent(queryMatch[1]) : '';
      
      // Simple matching based on card names in query
      const matchingCards = Object.values(MOCK_CARDS).filter(card =>
        query.toLowerCase().includes(card.name.toLowerCase())
      );
      
      return {
        ok: true,
        json: async () => createMockSearchResponse(
          matchingCards.length > 0 ? matchingCards : [MOCK_CARDS.lightningBolt],
          false
        ),
      };
    }
    
    // Handle single card lookup
    if (url.includes('cards/') && !url.includes('search')) {
      const idMatch = url.match(/cards\/([^?]+)/);
      if (idMatch) {
        const cardId = idMatch[1];
        const card = Object.values(MOCK_CARDS).find(c => c.id === cardId);
        if (card) {
          return {
            ok: true,
            json: async () => card,
          };
        }
      }
      return {
        ok: true,
        json: async () => MOCK_CARDS.lightningBolt,
      };
    }
    
    // Handle named card lookup
    if (url.includes('cards/named')) {
      const nameMatch = url.match(/exact=([^&]+)/) || url.match(/fuzzy=([^&]+)/);
      if (nameMatch) {
        const name = decodeURIComponent(nameMatch[1]);
        const card = Object.values(MOCK_CARDS).find(c => 
          c.name.toLowerCase() === name.toLowerCase()
        );
        if (card) {
          return {
            ok: true,
            json: async () => card,
          };
        }
      }
      return {
        ok: true,
        json: async () => MOCK_CARDS.lightningBolt,
      };
    }
    
    // Default: return empty response
    return {
      ok: true,
      json: async () => createMockSearchResponse([]),
    };
  });
}

/**
 * Mock fetch instance
 */
export const mockFetch = createFetchMock();

/**
 * Helper to mock a specific card search result
 * 
 * @param cards - Cards to return for the search
 */
export function mockScryfallSearch<T extends MinimalCard = MinimalCard>(
  cards: T[]
): void {
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => createMockSearchResponse(cards),
  }));
}

/**
 * Helper to mock a specific card by ID
 * 
 * @param card - Card to return
 */
export function mockScryfallCard<T extends MinimalCard = MinimalCard>(
  card: T
): void {
  mockFetch.mockImplementation(async () => ({
    ok: true,
    json: async () => card,
  }));
}

/**
 * Reset mock to default behavior
 */
export function resetMockFetch(): void {
  mockFetch.mockImplementation(createFetchMock());
}

/**
 * Mock the global fetch function
 */
export function mockGlobalFetch(): void {
  global.fetch = mockFetch;
}

/**
 * Restore the original fetch function
 */
export function restoreFetch(): void {
  global.fetch = fetch;
}

export default {
  mockFetch,
  mockScryfallSearch,
  mockScryfallCard,
  resetMockFetch,
  mockGlobalFetch,
  restoreFetch,
  MOCK_CARDS,
};

/**
 * MSW handlers for mocking external API calls in integration tests
 * 
 * This module provides handlers for:
 * - Scryfall API (card search, card lookup)
 * - Custom server endpoints
 */

import { http, HttpResponse, delay } from 'msw';
import { setupWorker } from 'msw/browser';

/**
 * Scryfall API base URL
 */
const SCRYFALL_BASE = 'https://api.scryfall.com';

/**
 * Create mock Scryfall card data
 */
export function createMockScryfallCard(overrides: Partial<{
  id: string;
  name: string;
  set: string;
  collector_number: string;
  cmc: number;
  type_line: string;
  oracle_text: string;
  colors: string[];
  color_identity: string[];
  rarity: string;
  power: string;
  toughness: string;
}> = {}) {
  return {
    id: overrides.id || 'mock-card-id-1',
    oracle_id: overrides.oracle_id || 'mock-oracle-id-1',
    name: overrides.name || 'Mock Card',
    set: overrides.set || 'm21',
    collector_number: overrides.collector_number || '1',
    cmc: overrides.cmc || 2,
    type_line: overrides.type_line || 'Creature — Human Wizard',
    oracle_text: overrides.oracle_text || '{T}: Draw a card.',
    colors: overrides.colors || ['U'],
    color_identity: overrides.color_identity || ['U'],
    rarity: overrides.rarity || 'rare',
    power: overrides.power || '2',
    toughness: overrides.toughness || '2',
    legalities: {
      standard: 'legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
    },
    image_uris: {
      small: 'https://cards.scryfall.io/small/front/m/o/mock-card-id-1.jpg',
      normal: 'https://cards.scryfall.io/normal/front/m/o/mock-card-id-1.jpg',
      large: 'https://cards.scryfall.io/large/front/m/o/mock-card-id-1.jpg',
      png: 'https://cards.scryfall.io/png/front/m/o/mock-card-id-1.png',
      art_crop: 'https://cards.scryfall.io/art_crop/front/m/o/mock-card-id-1.jpg',
      border_crop: 'https://cards.scryfall.io/border_crop/front/m/o/mock-card-id-1.jpg',
    },
    mana_cost: '{2U}',
    flavor_text: 'A mock card for testing.',
    artist: 'Mock Artist',
  };
}

/**
 * Create a search response for Scryfall
 */
export function createMockSearchResponse(cards: ReturnType<typeof createMockScryfallCard>[], query: string) {
  return {
    object: 'search',
    total_cards: cards.length,
    has_more: false,
    data: cards,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Handlers for Scryfall API
 */
export const scryfallHandlers = [
  // Card search endpoint
  http.get(`${SCRYFALL_BASE}/cards/search`, async ({ request }) => {
    await delay(100);
    
    const url = new URL(request.url);
    const query = url.searchParams.get('q') || '';
    
    // Return mock cards based on query
    const mockCards = [
      createMockScryfallCard({ name: 'Lightning Bolt', set: 'm12', cmc: 1, type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', colors: ['R'], rarity: 'common' }),
      createMockScryfallCard({ name: 'Counterspell', set: 'mh2', cmc: 2, type_line: 'Instant', oracle_text: 'Counter target spell.', colors: ['U'], rarity: 'common' }),
      createMockScryfallCard({ name: 'Brainstorm', set: 'ice', cmc: 1, type_line: 'Instant', oracle_text: 'Draw three cards, then put two cards from your hand on top of your library.', colors: ['U'], rarity: 'common' }),
    ];
    
    return HttpResponse.json(createMockSearchResponse(mockCards, query));
  }),
  
  // Card lookup by name
  http.get(`${SCRYFALL_BASE}/cards/named`, async ({ request }) => {
    await delay(100);
    
    const url = new URL(request.url);
    const name = url.searchParams.get('exact') || url.searchParams.get('fuzzy') || '';
    
    const mockCard = createMockScryfallCard({ name });
    return HttpResponse.json(mockCard);
  }),
  
  // Card lookup by ID
  http.get(`${SCRYFALL_BASE}/cards/:id`, async ({ params }) => {
    await delay(100);
    
    const mockCard = createMockScryfallCard({ id: params.id as string });
    return HttpResponse.json(mockCard);
  }),
  
  // Random card
  http.get(`${SCRYFALL_BASE}/cards/random`, async () => {
    await delay(100);
    
    const mockCard = createMockScryfallCard();
    return HttpResponse.json(mockCard);
  }),
  
  // Set search
  http.get(`${SCRYFALL_BASE}/sets/:code`, async ({ params }) => {
    await delay(100);
    
    return HttpResponse.json({
      object: 'set',
      id: `set-${params.code}`,
      code: params.code,
      name: `Mock Set ${params.code}`,
      released_at: '2024-01-01',
      card_count: 100,
      set_type: 'expansion',
    });
  }),
];

/**
 * Default handlers array - export all handlers
 */
export const handlers = [...scryfallHandlers];

/**
 * Create the MSW worker for browser
 */
export function createWorker() {
  return setupWorker(...handlers);
}

export { http, HttpResponse, delay, setupWorker };

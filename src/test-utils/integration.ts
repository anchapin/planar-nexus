/**
 * Integration test utilities for Planar Nexus
 * 
 * These utilities are used for integration tests that test
 * the interaction between different parts of the application.
 */

/**
 * Create mock deck data for tests
 */
export function createMockDeck(overrides: Partial<{
  id: string;
  name: string;
  format: string;
  cards: Array<{ name: string; quantity: number }>;
  cardCount?: number;
}> = {}) {
  const { cardCount = 5 } = overrides;
  
  // Generate mock cards if cardCount is provided
  const cards = overrides.cards || Array.from({ length: cardCount }, (_, i) => ({
    name: `Test Card ${i + 1}`,
    quantity: i < 4 ? 4 : 1,
  }));
  
  return {
    id: overrides.id || `deck-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    name: overrides.name || 'Test Deck',
    format: overrides.format || 'commander',
    cards,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Create mock card data for tests
 */
export function createMockCard(overrides: Partial<{
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  colors: string[];
}> = {}) {
  return {
    id: overrides.id || `card-${Date.now()}`,
    oracle_id: 'mock-oracle-id',
    name: overrides.name || 'Mock Card',
    set: 'm21',
    collector_number: '1',
    cmc: 2,
    type_line: overrides.type_line || 'Creature — Human Wizard',
    oracle_text: overrides.oracle_text || '{T}: Draw a card.',
    colors: overrides.colors || ['U'],
    color_identity: ['U'],
    rarity: 'rare',
    power: '2',
    toughness: '2',
    legalities: {
      standard: 'legal',
      modern: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      commander: 'legal',
      pauper: 'not_legal',
    },
    ...overrides,
  };
}

/**
 * Start the MSW server (for Node.js environments)
 * Note: For deck storage tests, this is not required since IndexedDB is mocked
 */
export async function startServer() {
  // Not needed for deck storage tests - IndexedDB is mocked via fake-indexeddb
  console.log('Note: MSW server not needed for deck storage tests');
}

/**
 * Stop the MSW server
 */
export function stopServer() {
  // Not needed for deck storage tests
}

/**
 * Reset MSW handlers to default
 */
export function resetHandlers() {
  // Not needed for deck storage tests
}

/**
 * Use custom handlers for a specific test
 */
export function useHandlers(...handlers: any[]) {
  // Not needed for deck storage tests
}

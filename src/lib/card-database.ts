/**
 * @fileOverview Offline card database module
 * 
 * This module provides offline card search and validation using bundled data.
 * For use in Tauri/PWA offline mode.
 */

// Minimal card data for offline use (subset of Scryfall data)
export interface MinimalCard {
  id: string;
  name: string;
  cmc: number;
  type_line: string;
  oracle_text: string;
  colors: string[];
  color_identity: string[];
  legalities: Record<string, string>;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
  };
}

export interface CardDatabaseOptions {
  includeImages?: boolean;
  maxCards?: number;
}

// In-memory card database (will be populated on load)
let cardDatabase: Map<string, MinimalCard> = new Map();
let isLoaded = false;

// Load bundled card data
export async function initializeCardDatabase(): Promise<void> {
  if (isLoaded) return;
  
  // In a real implementation, this would load from a bundled JSON file
  // For now, we'll initialize with essential commander cards
  const essentialCards: MinimalCard[] = [
    {
      id: 'card-001',
      name: 'Sol Ring',
      cmc: 1,
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}{C}.',
      colors: [],
      color_identity: [],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-002',
      name: 'Arcane Signet',
      cmc: 2,
      type_line: 'Artifact',
      oracle_text: '{T}: Add {C}. Activate this ability only if you control a commander.',
      colors: [],
      color_identity: [],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-003',
      name: 'Lightning Bolt',
      cmc: 1,
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      colors: ['R'],
      color_identity: ['R'],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-004',
      name: 'Counterspell',
      cmc: 2,
      type_line: 'Instant',
      oracle_text: 'Counter target spell.',
      colors: ['U'],
      color_identity: ['U'],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-005',
      name: 'Swords to Plowshares',
      cmc: 1,
      type_line: 'Instant',
      oracle_text: 'Exile target creature. Its controller gains life equal to its power.',
      colors: ['W'],
      color_identity: ['W'],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-006',
      name: 'Rampant Growth',
      cmc: 2,
      type_line: 'Sorcery',
      oracle_text: 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
      colors: ['G'],
      color_identity: ['G'],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-007',
      name: 'Brainstorm',
      cmc: 1,
      type_line: 'Instant',
      oracle_text: 'Draw three cards, then put two cards from your hand on top of your library in any order.',
      colors: ['U'],
      color_identity: ['U'],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-008',
      name: 'Llanowar Elves',
      cmc: 1,
      type_line: 'Creature — Elf Druid',
      oracle_text: '{T}: Add {G}.',
      colors: ['G'],
      color_identity: ['G'],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-009',
      name: 'Cultivate',
      cmc: 3,
      type_line: 'Sorcery',
      oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      colors: ['G'],
      color_identity: ['G'],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-010',
      name: 'Path to Exile',
      cmc: 1,
      type_line: 'Instant',
      oracle_text: 'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
      colors: ['W'],
      color_identity: ['W'],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-011',
      name: 'Go for the Throat',
      cmc: 2,
      type_line: 'Instant',
      oracle_text: 'Destroy target artifact or creature.',
      colors: ['B'],
      color_identity: ['B'],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
    {
      id: 'card-012',
      name: 'Kodama\'s Reach',
      cmc: 3,
      type_line: 'Sorcery',
      oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
      colors: ['G'],
      color_identity: ['G'],
      legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
    },
  ];
  
  // Populate database
  for (const card of essentialCards) {
    cardDatabase.set(card.name.toLowerCase(), card);
    // Also index by ID
    cardDatabase.set(card.id, card);
  }
  
  isLoaded = true;
}

// Search cards by name (offline)
export function searchCardsOffline(query: string, options?: CardDatabaseOptions): MinimalCard[] {
  if (!isLoaded) {
    console.warn('Card database not initialized. Call initializeCardDatabase() first.');
    return [];
  }
  
  if (!query || query.length < 2) return [];
  
  const normalizedQuery = query.toLowerCase();
  const results: MinimalCard[] = [];
  
  for (const [, card] of cardDatabase) {
    if (card.name.toLowerCase().includes(normalizedQuery)) {
      results.push(card);
    }
  }
  
  // Sort by name match quality
  results.sort((a, b) => {
    const aExact = a.name.toLowerCase().startsWith(normalizedQuery);
    const bExact = b.name.toLowerCase().startsWith(normalizedQuery);
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return a.name.localeCompare(b.name);
  });
  
  const maxCards = options?.maxCards ?? 20;
  return results.slice(0, maxCards);
}

// Get card by exact name
export function getCardByName(name: string): MinimalCard | undefined {
  if (!isLoaded) return undefined;
  return cardDatabase.get(name.toLowerCase());
}

// Get card by ID
export function getCardById(id: string): MinimalCard | undefined {
  if (!isLoaded) return undefined;
  return cardDatabase.get(id);
}

// Check if a card is legal in a format
export function isCardLegal(cardName: string, format: string): boolean {
  const card = getCardByName(cardName);
  if (!card || !card.legalities) return false;
  return card.legalities[format] === 'legal';
}

// Validate deck against format
export function validateDeckOffline(
  cards: Array<{ name: string; quantity: number }>,
  format: string
): { valid: boolean; illegalCards: string[]; issues: string[] } {
  if (!isLoaded) {
    return { valid: false, illegalCards: [], issues: ['Card database not initialized'] };
  }
  
  const illegalCards: string[] = [];
  const issues: string[] = [];
  
  for (const card of cards) {
    const dbCard = getCardByName(card.name);
    if (!dbCard) {
      issues.push(`Card not found: ${card.name}`);
      continue;
    }
    
    if (dbCard.legalities[format] !== 'legal') {
      illegalCards.push(card.name);
    }
  }
  
  return {
    valid: illegalCards.length === 0 && issues.length === 0,
    illegalCards,
    issues,
  };
}

// Get database status
export function getDatabaseStatus(): { loaded: boolean; cardCount: number } {
  return {
    loaded: isLoaded,
    cardCount: cardDatabase.size,
  };
}

// Export for use in IndexedDB caching
export function getAllCards(): MinimalCard[] {
  return Array.from(cardDatabase.values());
}

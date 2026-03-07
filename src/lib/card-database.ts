/**
 * @fileOverview Offline card database module with IndexedDB storage
 *
 * This module provides offline card search and validation using IndexedDB for persistent storage
 * and Fuse.js for fuzzy search capabilities. Designed for use in Tauri/PWA offline mode.
 */

import Fuse from 'fuse.js';

// Minimal card data for offline use (subset of Scryfall data)
export interface MinimalCard {
  id: string;
  oracle_id?: string;
  name: string;
  set?: string;
  collector_number?: string;
  cmc: number;
  type_line: string;
  oracle_text?: string;
  colors: string[];
  color_identity: string[];
  rarity?: string;
  legalities: Record<string, string>;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
    png: string;
    art_crop: string;
    border_crop: string;
  };
  mana_cost?: string;
  power?: string;
  toughness?: string;
  keywords?: string[];
  // Card faces for double-faced/transform cards
  card_faces?: Array<{
    name: string;
    mana_cost?: string;
    type_line?: string;
    oracle_text?: string;
    power?: string;
    toughness?: string;
    image_uris?: {
      small: string;
      normal: string;
      large: string;
      png: string;
      art_crop: string;
      border_crop: string;
    };
  }>;
  // Layout type (normal, transform, modal_dfc, etc.)
  layout?: string;
  // Loyalty for planeswalkers
  loyalty?: string;
}

export interface CardDatabaseOptions {
  includeImages?: boolean;
  maxCards?: number;
  format?: string;
}

// IndexedDB configuration
const DB_NAME = 'PlanarNexusCardDB';
const DB_VERSION = 1;
const STORE_NAME = 'cards';
const INDEX_NAME = 'name';
const LEGALITY_INDEX_NAME = 'format_legality';

// Database state
let db: IDBDatabase | null = null;
let fuseInstance: Fuse<MinimalCard> | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// Essential commander cards for initial population
export const ESSENTIAL_CARDS: MinimalCard[] = [
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
  {
    id: 'card-013',
    name: 'Command Tower',
    cmc: 1,
    type_line: 'Land',
    oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.',
    colors: [],
    color_identity: [],
    legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
  },
  {
    id: 'card-014',
    name: 'Commander\'s Sphere',
    cmc: 3,
    type_line: 'Artifact',
    oracle_text: '{T}: Add one mana of any color in your commander\'s color identity.\n{1}, Sacrifice Commander\'s Sphere: Draw a card.',
    colors: [],
    color_identity: [],
    legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
  },
  {
    id: 'card-015',
    name: 'Arcane Lighthouse',
    cmc: 0,
    type_line: 'Land',
    oracle_text: '{T}: Add {C}.\n{4}, {T}: Until end of turn, creatures your opponents control lose hexproof and can\'t have shroud.',
    colors: [],
    color_identity: [],
    legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
  },
  {
    id: 'card-016',
    name: 'Dark Ritual',
    cmc: 1,
    type_line: 'Instant',
    oracle_text: 'Add {B}{B}{B}.',
    colors: ['B'],
    color_identity: ['B'],
    legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
  },
  {
    id: 'card-017',
    name: 'Mana Vault',
    cmc: 0,
    type_line: 'Artifact',
    oracle_text: 'Mana Vault doesn\'t untap during your untap step.\nAt the beginning of your upkeep, you may pay {4}. If you do, untap Mana Vault.\n{T}: Add {C}{C}{C}.',
    colors: [],
    color_identity: [],
    legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
  },
  {
    id: 'card-018',
    name: 'Birds of Paradise',
    cmc: 1,
    type_line: 'Creature — Bird',
    oracle_text: 'Flying\n{T}: Add one mana of any color.',
    colors: ['G'],
    color_identity: ['G', 'W', 'U', 'B', 'R'],
    legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
  },
  {
    id: 'card-019',
    name: 'Cyclonic Rift',
    cmc: 2,
    type_line: 'Instant',
    oracle_text: 'Return target nonland permanent you don\'t control to its owner\'s hand.\nOverload {6}{U} (You may cast this spell for its overload cost. If you do, change its text by replacing all instances of "target" with "each.")',
    colors: ['U'],
    color_identity: ['U'],
    legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
  },
  {
    id: 'card-020',
    name: 'Cultivate',
    cmc: 3,
    type_line: 'Sorcery',
    oracle_text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    colors: ['G'],
    color_identity: ['G'],
    legalities: { commander: 'legal', modern: 'legal', legacy: 'legal', vintage: 'legal' },
  },
];

/**
 * Open IndexedDB and create schema if needed
 */
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create object store for cards
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const cardStore = database.createObjectStore(STORE_NAME, { keyPath: 'id' });

        // Create indexes for fast lookups
        cardStore.createIndex(INDEX_NAME, 'name', { unique: false });

        // Compound index for format legality queries
        cardStore.createIndex(LEGALITY_INDEX_NAME, ['legalities.format', 'legalities.status'], { unique: false });
      }
    };
  });
}

/**
 * Initialize the card database
 */
export async function initializeCardDatabase(): Promise<void> {
  if (isInitialized) {
    return initPromise || Promise.resolve();
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Open IndexedDB
      db = await openDatabase();

      // Check if database is empty and populate with essential cards
      const cardCount = await getCardCount();
      if (cardCount === 0) {
        await populateDatabase(ESSENTIAL_CARDS);
      }

      // Load all cards into memory for fuzzy search
      const allCards = await getAllCardsFromDB();
      initializeFuzzySearch(allCards);

      isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize card database:', error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Initialize Fuse.js for fuzzy search
 */
function initializeFuzzySearch(cards: MinimalCard[]): void {
  const fuseOptions: any = {
    keys: [
      { name: 'name', weight: 0.7 },
      { name: 'type_line', weight: 0.2 },
      { name: 'oracle_text', weight: 0.1 },
    ],
    threshold: 0.3, // Lower = more strict matching
    distance: 100,
    minMatchCharLength: 2,
    includeScore: true,
  };

  fuseInstance = new Fuse(cards, fuseOptions);
}

/**
 * Populate database with cards
 */
async function populateDatabase(cards: MinimalCard[]): Promise<void> {
  if (!db) throw new Error('Database not initialized');

  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => resolve();

    cards.forEach((card) => {
      store.put(card);
    });
  });
}

/**
 * Get the total number of cards in the database
 */
async function getCardCount(): Promise<number> {
  if (!db) throw new Error('Database not initialized');

  const database = db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const countRequest = store.count();

    countRequest.onsuccess = () => resolve(countRequest.result);
    countRequest.onerror = () => reject(countRequest.error);
  });
}

/**
 * Get all cards from database
 */
async function getAllCardsFromDB(): Promise<MinimalCard[]> {
  if (!db) throw new Error('Database not initialized');

  const database = db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Search cards using fuzzy search (instant, no network required)
 */
export async function searchCardsOffline(
  query: string,
  options?: CardDatabaseOptions
): Promise<MinimalCard[]> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  if (!query || query.length < 2) return [];
  if (!fuseInstance) return [];

  const maxCards = options?.maxCards ?? 20;

  // Perform fuzzy search
  const results = fuseInstance.search(query, { limit: maxCards });

  // Filter by format if specified
  let cards = results.map((result) => result.item);

  if (options?.format) {
    cards = cards.filter((card) => card.legalities[options.format!] === 'legal');
  }

  return cards.slice(0, maxCards);
}

/**
 * Get card by exact name
 */
export async function getCardByName(name: string): Promise<MinimalCard | undefined> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  if (!db) return undefined;

  const database = db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index(INDEX_NAME);
    const request = index.getAll(name.toLowerCase());

    request.onsuccess = () => {
      const cards = request.result || [];
      // Find exact match (case-insensitive)
      const exactMatch = cards.find((card) =>
        card.name.toLowerCase() === name.toLowerCase()
      );
      resolve(exactMatch);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get card by ID
 */
export async function getCardById(id: string): Promise<MinimalCard | undefined> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  if (!db) return undefined;

  const database = db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if a card is legal in a format
 */
export async function isCardLegal(cardName: string, format: string): Promise<boolean> {
  const card = await getCardByName(cardName);
  if (!card || !card.legalities) return false;
  return card.legalities[format] === 'legal';
}

/**
 * Validate deck against format
 */
export async function validateDeckOffline(
  cards: Array<{ name: string; quantity: number }>,
  format: string
): Promise<{ valid: boolean; illegalCards: string[]; issues: string[] }> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  const illegalCards: string[] = [];
  const issues: string[] = [];

  for (const card of cards) {
    const dbCard = await getCardByName(card.name);
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

/**
 * Get database status
 */
export async function getDatabaseStatus(): Promise<{ loaded: boolean; cardCount: number }> {
  if (!isInitialized) {
    return { loaded: false, cardCount: 0 };
  }

  const cardCount = await getCardCount();
  return {
    loaded: true,
    cardCount,
  };
}

/**
 * Add a card to the database (for bulk importing)
 */
export async function addCard(card: MinimalCard): Promise<void> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  if (!db) throw new Error('Database not initialized');

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(card);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);

    // Reinitialize fuzzy search after adding a card
    transaction.oncomplete = async () => {
      const allCards = await getAllCardsFromDB();
      initializeFuzzySearch(allCards);
      resolve();
    };
  });
}

/**
 * Add multiple cards to the database (for bulk importing)
 */
export async function addCards(cards: MinimalCard[]): Promise<void> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  if (!db) throw new Error('Database not initialized');

  const transaction = db.transaction([STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = async () => {
      // Reinitialize fuzzy search after adding cards
      const allCards = await getAllCardsFromDB();
      initializeFuzzySearch(allCards);
      resolve();
    };

    cards.forEach((card) => {
      store.put(card);
    });
  });
}

/**
 * Clear all cards from the database
 */
export async function clearDatabase(): Promise<void> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  if (!db) throw new Error('Database not initialized');

  const database = db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      fuseInstance = null;
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Export all cards from the database
 */
export async function getAllCards(): Promise<MinimalCard[]> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  return getAllCardsFromDB();
}

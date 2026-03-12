/**
 * @fileOverview Offline card database module with IndexedDB storage
 *
 * This module provides offline card search and validation using IndexedDB for persistent storage
 * and Fuse.js for fuzzy search capabilities. Designed for use in Tauri/PWA offline mode.
 */

import Fuse from 'fuse.js';
import type { IFuseOptions } from 'fuse.js';

// Minimal card data for offline use (subset of Scryfall data)

/**
 * Shared Fuse.js search options for fuzzy card search
 */
export const FUSE_SEARCH_OPTIONS: IFuseOptions<MinimalCard> = {
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
  name_lower?: string; // For case-insensitive indexing
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
const DB_VERSION = 2; // Incremented for image cache store
const STORE_NAME = 'cards';
const INDEX_NAME = 'name';
const LEGALITY_INDEX_NAME = 'format_legality';
const IMAGE_STORE_NAME = 'card_images';

// Database state
let db: IDBDatabase | null = null;
let fuseInstance: Fuse<MinimalCard> | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// NOTE: Database starts empty. Users must import their own card data
// to avoid legal issues. Use scripts/fetch-cards-for-db.ts to generate
// a personal card database, then import via Settings → Database Management.

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
        cardStore.createIndex('name_lower', 'name_lower', { unique: false });

        // Compound index for format legality queries
        cardStore.createIndex(LEGALITY_INDEX_NAME, ['legalities.format', 'legalities.status'], { unique: false });
      }

      // Create object store for card images (added in version 2)
      if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        database.createObjectStore(IMAGE_STORE_NAME, { keyPath: 'cardId' });
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

      // Database starts empty - users must import their own card data
      // Load all cards into memory for fuzzy search
      const allCards = await getAllCardsFromDB();
      if (allCards.length > 0) {
        initializeFuzzySearch(allCards);
      }

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
  fuseInstance = new Fuse(cards, FUSE_SEARCH_OPTIONS);
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
      store.put({
        ...card,
        name_lower: card.name.toLowerCase(),
      });
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
    
    // Try name_lower index first if it exists, otherwise use name index
    let index;
    try {
      index = store.index('name_lower');
    } catch {
      index = store.index(INDEX_NAME);
    }
    
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
    const request = store.put({
      ...card,
      name_lower: card.name.toLowerCase(),
    });

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
      store.put({
        ...card,
        name_lower: card.name.toLowerCase(),
      });
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

/**
 * ==========================================
 * IMAGE CACHING FUNCTIONS
 * ==========================================
 */

/**
 * Cache a card image
 */
export async function cacheCardImage(cardId: string, imageUrl: string, imageData: Blob): Promise<void> {
  if (!db) throw new Error('Database not initialized');

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([IMAGE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    const request = store.put({
      cardId,
      imageUrl,
      imageData,
      cachedAt: Date.now(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get cached card image
 */
export async function getCachedImage(cardId: string): Promise<{ imageUrl: string; imageData: Blob } | null> {
  if (!db) throw new Error('Database not initialized');

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([IMAGE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    const request = store.get(cardId);

    request.onsuccess = () => {
      const result = request.result;
      if (result) {
        resolve({ imageUrl: result.imageUrl, imageData: result.imageData });
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get cached image count
 */
export async function getImageCount(): Promise<number> {
  if (!db) throw new Error('Database not initialized');

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([IMAGE_STORE_NAME], 'readonly');
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    const request = store.count();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Clear image cache
 */
export async function clearImageCache(): Promise<void> {
  if (!db) throw new Error('Database not initialized');

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([IMAGE_STORE_NAME], 'readwrite');
    const store = transaction.objectStore(IMAGE_STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * ==========================================
 * BULK IMPORT FUNCTIONS
 * ==========================================
 */

/**
 * Import cards from a JSON array (for user-provided card database)
 */
export async function importCardsFromJSON(cards: MinimalCard[], onProgress?: (count: number, total: number) => void): Promise<void> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  if (!db) throw new Error('Database not initialized');

  const batchSize = 100;
  let imported = 0;

  for (let i = 0; i < cards.length; i += batchSize) {
    const batch = cards.slice(i, i + batchSize);
    
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => resolve();

      batch.forEach((card) => {
        store.put({
          ...card,
          name_lower: card.name.toLowerCase(),
        });
      });
    });

    imported += batch.length;
    onProgress?.(imported, cards.length);
  }

  // Reinitialize fuzzy search with all cards
  const allCards = await getAllCardsFromDB();
  initializeFuzzySearch(allCards);
}

/**
 * Import cards from a JSON file (browser environment)
 */
export async function importCardsFromFile(file: File, onProgress?: (count: number, total: number) => Promise<void>): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];
  
  try {
    const text = await file.text();
    const cards = JSON.parse(text) as MinimalCard[];
    
    if (!Array.isArray(cards)) {
      throw new Error('Invalid format: expected an array of cards');
    }

    // Validate card structure
    const validCards: MinimalCard[] = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (!card.id || !card.name || !card.cmc || !card.type_line || !card.colors || !card.legalities) {
        errors.push(`Card ${i + 1}: Missing required fields`);
        continue;
      }
      validCards.push(card);
    }

    // Import valid cards
    await importCardsFromJSON(validCards, (count, total) => {
      onProgress?.(count, total);
    });

    return { count: validCards.length, errors };
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to parse card file: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(): Promise<{
  cardCount: number;
  imageCount: number;
  isInitialized: boolean;
}> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  const cardCount = await getCardCount();
  const imageCount = await getImageCount();

  return {
    cardCount,
    imageCount,
    isInitialized,
  };
}

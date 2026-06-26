/**
 * @fileOverview Offline card database module with IndexedDB storage
 *
 * This module provides offline card search and validation using IndexedDB for persistent storage
 * and Orama for indexed search capabilities. Designed for use in Tauri/PWA offline mode.
 */

import { cardSearchIndex } from "./search/card-search-index";
import {
  classifyWriteError,
  getStorageEstimate,
} from "./storage-quota";

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
  // ISO-8601 release date of the card's set (e.g. "2024-02-09").
  // Used by Standard rotation validation (see src/lib/game-rules.ts).
  release_date?: string;
}

export interface CardDatabaseOptions {
  includeImages?: boolean;
  maxCards?: number;
  format?: string;
}

// IndexedDB configuration
const DB_NAME = "PlanarNexusCardDB";
const DB_VERSION = 2; // Incremented for image cache store
const STORE_NAME = "cards";
const INDEX_NAME = "name";
const LEGALITY_INDEX_NAME = "format_legality";
const IMAGE_STORE_NAME = "card_images";

// Database state
let db: IDBDatabase | null = null;
let searchReady = false;
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
        const cardStore = database.createObjectStore(STORE_NAME, {
          keyPath: "id",
        });

        // Create indexes for fast lookups
        cardStore.createIndex(INDEX_NAME, "name", { unique: false });
        cardStore.createIndex("name_lower", "name_lower", { unique: false });

        // Compound index for format legality queries
        cardStore.createIndex(
          LEGALITY_INDEX_NAME,
          ["legalities.format", "legalities.status"],
          { unique: false },
        );
      }

      // Create object store for card images (added in version 2)
      if (!database.objectStoreNames.contains(IMAGE_STORE_NAME)) {
        database.createObjectStore(IMAGE_STORE_NAME, { keyPath: "cardId" });
      }
    };
  });
}

/**
 * Initialize the card database
 */
export async function initializeCardDatabase(): Promise<void> {
  if (searchReady) {
    return initPromise || Promise.resolve();
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      // Open IndexedDB
      db = await openDatabase();

      // Initialize Orama search index (restores from IndexedDB if available)
      const restored = await cardSearchIndex.init();

      // Only build the index fresh when nothing was restored from persistence
      if (!restored) {
        const allCards = await getAllCardsFromDB();
        if (allCards.length > 0) {
          await cardSearchIndex.indexCards(allCards);
          await cardSearchIndex.saveIndex();
        }
      }

      searchReady = true;
    } catch (error) {
      console.error("Failed to initialize card database:", error);
      throw error;
    }
  })();

  return initPromise;
}

/**
 * Populate database with cards
 */
async function populateDatabase(cards: MinimalCard[]): Promise<void> {
  if (!db) throw new Error("Database not initialized");

  const transaction = db.transaction([STORE_NAME], "readwrite");
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
  if (!db) throw new Error("Database not initialized");

  const database = db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], "readonly");
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
  if (!db) throw new Error("Database not initialized");

  const database = db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Search cards using Orama indexed search (instant, no network required)
 */
export async function searchCardsOffline(
  query: string,
  options?: CardDatabaseOptions,
): Promise<MinimalCard[]> {
  if (!searchReady) {
    await initializeCardDatabase();
  }

  if (!query || query.length < 2) return [];

  const maxCards = options?.maxCards ?? 20;

  // Perform Orama indexed search
  const searchResults = await cardSearchIndex.search(query, {
    limit: maxCards * 2,
  });

  // Get full card data from IndexedDB
  const cards: MinimalCard[] = [];
  for (const result of searchResults) {
    const card = await getCardById(result.id);
    if (card) {
      cards.push(card);
    }
    if (cards.length >= maxCards * 2) break;
  }

  // Filter by format if specified
  if (options?.format) {
    return cards
      .filter((card) => card.legalities[options.format!] === "legal")
      .slice(0, maxCards);
  }

  return cards.slice(0, maxCards);
}

/**
 * Get card by exact name
 */
export async function getCardByName(
  name: string,
): Promise<MinimalCard | undefined> {
  if (!searchReady) {
    await initializeCardDatabase();
  }

  if (!db) return undefined;

  const database = db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);

    // Try name_lower index first if it exists, otherwise use name index
    let index;
    try {
      index = store.index("name_lower");
    } catch {
      index = store.index(INDEX_NAME);
    }

    const request = index.getAll(name.toLowerCase());

    request.onsuccess = () => {
      const cards = request.result || [];
      // Find exact match (case-insensitive)
      let match = cards.find(
        (card) => card.name.toLowerCase() === name.toLowerCase(),
      );

      // If no exact match, try matching the front face of DFCs (e.g. "Serah Farron" matches "Serah Farron // Crystallized Serah")
      if (!match) {
        match = cards.find((card) => {
          if (card.name.includes(" // ")) {
            const frontFace = card.name.split(" // ")[0].trim().toLowerCase();
            return frontFace === name.toLowerCase();
          }
          return false;
        });
      }

      resolve(match);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get card by ID
 */
export async function getCardById(
  id: string,
): Promise<MinimalCard | undefined> {
  if (!searchReady) {
    await initializeCardDatabase();
  }

  if (!db) return undefined;

  const database = db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if a card is legal in a format
 */
export async function isCardLegal(
  cardName: string,
  format: string,
): Promise<boolean> {
  const card = await getCardByName(cardName);
  if (!card || !card.legalities) return false;
  return card.legalities[format] === "legal";
}

/**
 * Validate deck against format
 */
export async function validateDeckOffline(
  cards: Array<{ name: string; quantity: number }>,
  format: string,
): Promise<{ valid: boolean; illegalCards: string[]; issues: string[] }> {
  if (!searchReady) {
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

    if (dbCard.legalities[format] !== "legal") {
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
export async function getDatabaseStatus(): Promise<{
  loaded: boolean;
  cardCount: number;
}> {
  if (!searchReady) {
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
  if (!searchReady) {
    await initializeCardDatabase();
  }

  if (!db) throw new Error("Database not initialized");

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({
      ...card,
      name_lower: card.name.toLowerCase(),
    });

    request.onsuccess = () => resolve();
    request.onerror = () =>
      reject(classifyWriteError(request.error, "Failed to add card", STORE_NAME));

    // Reinitialize search index after adding a card
    transaction.oncomplete = async () => {
      await cardSearchIndex.clear();
      const allCards = await getAllCardsFromDB();
      await cardSearchIndex.indexCards(allCards);
      await cardSearchIndex.saveIndex();
      resolve();
    };
  });
}

/**
 * Add multiple cards to the database (for bulk importing)
 */
export async function addCards(cards: MinimalCard[]): Promise<void> {
  if (!searchReady) {
    await initializeCardDatabase();
  }

  if (!db) throw new Error("Database not initialized");

  const transaction = db.transaction([STORE_NAME], "readwrite");
  const store = transaction.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    transaction.onerror = () =>
      reject(
        classifyWriteError(transaction.error, "Failed to add cards", STORE_NAME),
      );
    transaction.oncomplete = async () => {
      // Reinitialize search index after adding cards
      await cardSearchIndex.clear();
      const allCards = await getAllCardsFromDB();
      await cardSearchIndex.indexCards(allCards);
      await cardSearchIndex.saveIndex();
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
  if (!searchReady) {
    await initializeCardDatabase();
  }

  if (!db) throw new Error("Database not initialized");

  const database = db;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = async () => {
      await cardSearchIndex.clear();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Export all cards from the database
 */
export async function getAllCards(): Promise<MinimalCard[]> {
  if (!searchReady) {
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
export async function cacheCardImage(
  cardId: string,
  imageUrl: string,
  imageData: Blob,
): Promise<void> {
  if (!db) throw new Error("Database not initialized");

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([IMAGE_STORE_NAME], "readwrite");
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
export async function getCachedImage(
  cardId: string,
): Promise<{ imageUrl: string; imageData: Blob } | null> {
  if (!db) throw new Error("Database not initialized");

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([IMAGE_STORE_NAME], "readonly");
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
  if (!db) throw new Error("Database not initialized");

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([IMAGE_STORE_NAME], "readonly");
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
  if (!db) throw new Error("Database not initialized");

  return new Promise((resolve, reject) => {
    const transaction = db!.transaction([IMAGE_STORE_NAME], "readwrite");
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
 * Import cards from a JSON array (for user-provided card database).
 * Uses a single transaction for the entire import with progress callbacks
 * at batch boundaries.
 */
export async function importCardsFromJSON(
  cards: MinimalCard[],
  onProgress?: (count: number, total: number) => void,
): Promise<void> {
  if (!searchReady) {
    await initializeCardDatabase();
  }

  if (!db) throw new Error("Database not initialized");

  // Capacity awareness (#1085): probe the storage estimate before the bulk
  // write so we (and the UI hook) can warn the user before writes start failing.
  // Non-blocking — we still attempt the write; an actual quota failure is
  // surfaced as a typed QuotaExceededError by the transaction handlers below.
  const estimate = await getStorageEstimate();
  if (estimate.available && estimate.level === "critical") {
    console.warn(
      `[card-database] Storage critically low before bulk import ` +
        `(${Math.round(estimate.ratio * 100)}% used). Writes may fail.`,
    );
  }

  const batchSize = 500;
  const cardsWithLowerName = cards.map((card) => ({
    ...card,
    name_lower: card.name.toLowerCase(),
  }));

  return new Promise<void>((resolve, reject) => {
    const transaction = db!.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    let error: Error | null = null;
    let index = 0;

    transaction.oncomplete = () => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    transaction.onerror = () => {
      if (!error) {
        error = classifyWriteError(
          transaction.error,
          "Card import transaction failed",
          STORE_NAME,
        );
      }
      reject(error);
    };

    transaction.onabort = () => {
      if (!error && transaction.error) {
        error = classifyWriteError(
          transaction.error,
          "Card import transaction aborted",
          STORE_NAME,
        );
      }
      reject(error || new Error("Transaction aborted"));
    };

    const queueBatch = () => {
      const batchEnd = Math.min(index + batchSize, cardsWithLowerName.length);

      while (index < batchEnd) {
        const card = cardsWithLowerName[index];
        const request = store.put(card);

        request.onerror = () => {
          if (!error) {
            error = classifyWriteError(
              request.error,
              "Failed to put card",
              STORE_NAME,
            );
            transaction.abort();
          }
        };

        index++;
      }

      if (onProgress) {
        onProgress(batchEnd, cardsWithLowerName.length);
      }

      if (index < cardsWithLowerName.length) {
        queueBatch();
      }
    };

    queueBatch();
  }).then(async () => {
    // Reinitialize search index with all cards
    await cardSearchIndex.clear();
    const allCards = await getAllCardsFromDB();
    await cardSearchIndex.indexCards(allCards);
    await cardSearchIndex.saveIndex();
  });
}

/**
 * Import cards from a JSON file (browser environment)
 */
export async function importCardsFromFile(
  file: File,
  onProgress?: (count: number, total: number) => Promise<void>,
): Promise<{ count: number; errors: string[] }> {
  const errors: string[] = [];

  try {
    const text = await file.text();
    const cards = JSON.parse(text) as MinimalCard[];

    if (!Array.isArray(cards)) {
      throw new Error("Invalid format: expected an array of cards");
    }

    // Validate card structure
    const validCards: MinimalCard[] = [];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      if (
        !card.id ||
        !card.name ||
        typeof card.cmc !== "number" ||
        !card.type_line ||
        !Array.isArray(card.colors) ||
        !card.legalities
      ) {
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
  if (!searchReady) {
    await initializeCardDatabase();
  }

  const cardCount = await getCardCount();
  const imageCount = await getImageCount();

  return {
    cardCount,
    imageCount,
    isInitialized: searchReady,
  };
}

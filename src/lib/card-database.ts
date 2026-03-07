/**
 * @fileOverview Offline card database module with IndexedDB storage
 *
 * This module provides offline card search and validation using IndexedDB for persistent storage
 * and Fuse.js for fuzzy search capabilities. Designed for use in Tauri/PWA offline mode.
 *
 * Unit 2: Original Card Data Schema
 * Includes generic card types that remove MTG IP while preserving game mechanics.
 */

import Fuse from 'fuse.js';

// ============================================================================
// GENERIC CARD SCHEMA (Unit 2: Original Card Data Schema)
// ============================================================================

/**
 * Generic color identities for cards (non-MTG terminology)
 * Using generic color names that map to MTG colors but are legally distinct
 */
export enum GenericColor {
  RED = "red",
  BLUE = "blue",
  GREEN = "green",
  BLACK = "black",
  WHITE = "white",
  COLORLESS = "colorless"
}

/**
 * Generic card types (non-MTG terminology)
 */
export enum GenericCardType {
  // Permanent types
  CREATURE = "creature",
  ARTIFACT = "artifact",
  ENCHANTMENT = "enchantment",
  LAND = "land",
  PLANESWALKER = "planeswalker",
  // Spell types
  INSTANT = "instant",
  SORCERY = "sorcery",
  // Special types
  TOKEN = "token"
}

/**
 * Subtypes for cards (e.g., creature types, artifact types)
 * These are generic descriptors that can map to MTG types but use legally distinct terms
 */
export type CardSubtype = string;

/**
 * Generic ability keywords using non-MTG terminology
 * These describe mechanical abilities without using trademarked terms
 */
export enum AbilityKeyword {
  // Evergreen keywords (generic terms)
  FIRST_STRIKE = "first_strike",
  DOUBLE_STRIKE = "double_strike",
  DEATHTOUCH = "deathtouch",
  HEXPROOF = "hexproof",
  LIFELINK = "lifelink",
  FLYING = "flying",
  TRAMPLE = "trample",
  HASTE = "haste",
  VIGILANCE = "vigilance",
  REACH = "reach",
  MENACE = "menace",
  INDESTRUCTIBLE = "indestructible",
  SHADOW = "shadow",
  PROTECTION = "protection",
  REGENERATION = "regeneration",
  SCRY = "scry",
  PUMP = "pump",
  // Cost keywords
  KICKER = "kicker",
  CYCLING = "cycling",
  FLASHBACK = "flashback",
  EVOLVE = "evolve",
  // Planeswalker abilities
  LOYALTY = "loyalty"
}

/**
 * Generic card interface - foundation for original card data
 * Removes MTG-specific terminology while preserving all game mechanics
 */
export interface GenericCard {
  /** Unique identifier for this card definition */
  id: string;

  /** Display name of the card */
  name: string;

  /** Primary card type (creature, artifact, enchantment, land, instant, sorcery, planeswalker) */
  type: GenericCardType;

  /** Subtypes (e.g., creature types, artifact types) */
  subtypes: CardSubtype[];

  /** Mana cost as a string (e.g., "{R}{R}" for two red mana) */
  manaCost: string;

  /** Converted mana cost (numeric value) */
  cmc: number;

  /** Generic colors in this card's cost */
  colors: GenericColor[];

  /** Color identity (all colors the card is) */
  colorIdentity: GenericColor[];

  /** Oracle text describing card abilities */
  text: string;

  /** Keywords this card has */
  keywords: AbilityKeyword[];

  /** For creatures: power stat */
  power?: number;

  /** For creatures: toughness stat */
  toughness?: number;

  /** For planeswalkers: starting loyalty */
  loyalty?: number;

  /** Format legality information */
  legalities: {
    commander: "legal" | "banned" | "restricted";
    standard: "legal" | "banned" | "restricted";
    modern: "legal" | "banned" | "restricted";
    pioneer: "legal" | "banned" | "restricted";
    legacy: "legal" | "banned" | "restricted";
    vintage: "legal" | "banned" | "restricted";
    pauper: "legal" | "banned" | "restricted";
  };

  /** Optional image URIs for card art */
  imageUris?: {
    small: string;
    normal: string;
    large: string;
  };

  /** Additional custom properties for flexibility */
  customProperties?: Record<string, unknown>;
}

/**
 * Deck card with quantity (generic version)
 */
export interface GenericDeckCard extends GenericCard {
  /** Number of copies of this card in deck */
  quantity: number;
}

/**
 * Saved deck structure (generic version)
 */
export interface GenericSavedDeck {
  /** Unique identifier */
  id: string;

  /** Deck name */
  name: string;

  /** Format this deck is built for */
  format: string;

  /** Cards in deck */
  cards: GenericDeckCard[];

  /** When deck was created */
  createdAt: string;

  /** When deck was last updated */
  updatedAt: string;
}

// ============================================================================
// LEGACY SCRYFALL TYPES (maintained for backward compatibility)
// ============================================================================

/**
 * Minimal card data for offline use (subset of Scryfall data)
 * @deprecated Use GenericCard for new implementations
 */
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

// ============================================================================
// CARD DATABASE IMPLEMENTATION
// ============================================================================

/**
 * Database type - can store either generic cards or Scryfall cards
 */
type DatabaseCard = GenericCard | MinimalCard;

// IndexedDB configuration
const DB_NAME = 'PlanarNexusCardDB';
const DB_VERSION = 1;
const STORE_NAME = 'cards';
const INDEX_NAME = 'name';
const LEGALITY_INDEX_NAME = 'format_legality';

// Database state
let db: IDBDatabase | null = null;
let fuseInstance: Fuse<DatabaseCard> | null = null;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Type guard to check if a card is a GenericCard
 */
export function isGenericCard(card: DatabaseCard): card is GenericCard {
  return 'type' in card && typeof card.type === 'string' && Object.values(GenericCardType).includes(card.type as GenericCardType);
}

/**
 * Type guard to check if a card is a legacy MinimalCard
 */
export function isMinimalCard(card: DatabaseCard): card is MinimalCard {
  return 'type_line' in card && typeof card.type_line === 'string';
}

// Original generic cards for initial database population
// These use generic terminology while preserving game mechanics
const ORIGINAL_GENERIC_CARDS: GenericCard[] = [
  {
    id: 'generic-001',
    name: 'Mana Ring',
    type: GenericCardType.ARTIFACT,
    subtypes: [],
    manaCost: '{C}',
    cmc: 1,
    colors: [],
    colorIdentity: [],
    text: '{T}: Add {C}{C}.',
    keywords: [],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-002',
    name: 'Arcane Signet',
    type: GenericCardType.ARTIFACT,
    subtypes: [],
    manaCost: '{C}{C}',
    cmc: 2,
    colors: [],
    colorIdentity: [],
    text: '{T}: Add {C}. Activate this ability only if you control a leader.',
    keywords: [],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-003',
    name: 'Fire Bolt',
    type: GenericCardType.INSTANT,
    subtypes: [],
    manaCost: '{R}',
    cmc: 1,
    colors: [GenericColor.RED],
    colorIdentity: [GenericColor.RED],
    text: 'Fire Bolt deals 3 damage to any target.',
    keywords: [],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-004',
    name: 'Counterspell',
    type: GenericCardType.INSTANT,
    subtypes: [],
    manaCost: '{U}{U}',
    cmc: 2,
    colors: [GenericColor.BLUE],
    colorIdentity: [GenericColor.BLUE],
    text: 'Counter target spell.',
    keywords: [],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-005',
    name: 'Exile the Weak',
    type: GenericCardType.INSTANT,
    subtypes: [],
    manaCost: '{W}',
    cmc: 1,
    colors: [GenericColor.WHITE],
    colorIdentity: [GenericColor.WHITE],
    text: 'Exile target creature. Its controller gains life equal to its power.',
    keywords: [],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-006',
    name: 'Nature\'s Growth',
    type: GenericCardType.SORCERY,
    subtypes: [],
    manaCost: '{G}',
    cmc: 2,
    colors: [GenericColor.GREEN],
    colorIdentity: [GenericColor.GREEN],
    text: 'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    keywords: [],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-007',
    name: 'Mind Dive',
    type: GenericCardType.INSTANT,
    subtypes: [],
    manaCost: '{U}',
    cmc: 1,
    colors: [GenericColor.BLUE],
    colorIdentity: [GenericColor.BLUE],
    text: 'Draw three cards, then put two cards from your hand on top of your library in any order.',
    keywords: [AbilityKeyword.SCRY],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-008',
    name: 'Forest Elf',
    type: GenericCardType.CREATURE,
    subtypes: ['Elf', 'Druid'],
    manaCost: '{G}',
    cmc: 1,
    colors: [GenericColor.GREEN],
    colorIdentity: [GenericColor.GREEN],
    text: '{T}: Add {G}.',
    keywords: [],
    power: 1,
    toughness: 1,
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-009',
    name: 'Double Cultivate',
    type: GenericCardType.SORCERY,
    subtypes: [],
    manaCost: '{G}{G}',
    cmc: 3,
    colors: [GenericColor.GREEN],
    colorIdentity: [GenericColor.GREEN],
    text: 'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    keywords: [],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-010',
    name: 'Path of Exile',
    type: GenericCardType.INSTANT,
    subtypes: [],
    manaCost: '{W}',
    cmc: 1,
    colors: [GenericColor.WHITE],
    colorIdentity: [GenericColor.WHITE],
    text: 'Exile target creature. Its controller may search their library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    keywords: [],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-011',
    name: 'Destroy Target',
    type: GenericCardType.INSTANT,
    subtypes: [],
    manaCost: '{B}{B}',
    cmc: 2,
    colors: [GenericColor.BLACK],
    colorIdentity: [GenericColor.BLACK],
    text: 'Destroy target artifact or creature.',
    keywords: [],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
  },
  {
    id: 'generic-012',
    name: 'Command Spire',
    type: GenericCardType.LAND,
    subtypes: [],
    manaCost: '',
    cmc: 0,
    colors: [],
    colorIdentity: [],
    text: '{T}: Add one mana of any color in your leader\'s color identity.',
    keywords: [],
    legalities: {
      commander: 'legal',
      standard: 'legal',
      modern: 'legal',
      pioneer: 'legal',
      legacy: 'legal',
      vintage: 'legal',
      pauper: 'legal'
    }
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
 * Initialize the card database with generic cards
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

      // Check if database is empty and populate with original generic cards
      const cardCount = await getCardCount();
      if (cardCount === 0) {
        await populateDatabase(ORIGINAL_GENERIC_CARDS);
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
 * Supports both GenericCard and MinimalCard types
 */
function initializeFuzzySearch(cards: DatabaseCard[]): void {
  const fuseOptions: Fuse.IFuseOptions<DatabaseCard> = {
    keys: [
      { name: 'name', weight: 0.7 },
      { name: 'type_line', weight: 0.2 },
      { name: 'text', weight: 0.1 },
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
async function populateDatabase(cards: DatabaseCard[]): Promise<void> {
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

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const countRequest = store.count();

    countRequest.onsuccess = () => resolve(countRequest.result);
    countRequest.onerror = () => reject(countRequest.error);
  });
}

/**
 * Get all cards from database
 */
async function getAllCardsFromDB(): Promise<DatabaseCard[]> {
  if (!db) throw new Error('Database not initialized');

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
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
): Promise<DatabaseCard[]> {
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
    cards = cards.filter((card) => {
      // Handle both GenericCard and MinimalCard format checking
      if (isGenericCard(card)) {
        return card.legalities[options.format!] === 'legal';
      } else {
        return card.legalities[options.format!] === 'legal';
      }
    });
  }

  return cards.slice(0, maxCards);
}

/**
 * Get card by exact name
 */
export async function getCardByName(name: string): Promise<DatabaseCard | undefined> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  if (!db) return undefined;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
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
export async function getCardById(id: string): Promise<DatabaseCard | undefined> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  if (!db) return undefined;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Get only generic cards from the database
 */
export async function getGenericCards(): Promise<GenericCard[]> {
  const allCards = await getAllCards();
  return allCards.filter(isGenericCard);
}

/**
 * Get only legacy Scryfall-style cards from the database
 */
export async function getLegacyCards(): Promise<MinimalCard[]> {
  const allCards = await getAllCards();
  return allCards.filter(isMinimalCard);
}

/**
 * Check if a card is legal in a format
 */
export async function isCardLegal(cardName: string, format: string): Promise<boolean> {
  const card = await getCardByName(cardName);
  if (!card) return false;

  if (isGenericCard(card)) {
    return card.legalities[format] === 'legal';
  } else {
    return card.legalities[format] === 'legal';
  }
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

    if (isGenericCard(dbCard)) {
      if (dbCard.legalities[format] !== 'legal') {
        illegalCards.push(card.name);
      }
    } else {
      if (dbCard.legalities[format] !== 'legal') {
        illegalCards.push(card.name);
      }
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
export async function getDatabaseStatus(): Promise<{ loaded: boolean; cardCount: number; genericCards: number; legacyCards: number }> {
  if (!isInitialized) {
    return { loaded: false, cardCount: 0, genericCards: 0, legacyCards: 0 };
  }

  const cardCount = await getCardCount();
  const allCards = await getAllCards();
  const genericCards = allCards.filter(isGenericCard).length;
  const legacyCards = allCards.filter(isMinimalCard).length;

  return {
    loaded: true,
    cardCount,
    genericCards,
    legacyCards,
  };
}

/**
 * Export all cards from the database
 */
export async function getAllCards(): Promise<DatabaseCard[]> {
  if (!isInitialized) {
    await initializeCardDatabase();
  }

  return getAllCardsFromDB();
}

/**
 * Add a card to the database (supports both generic and legacy cards)
 */
export async function addCard(card: DatabaseCard): Promise<void> {
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
export async function addCards(cards: DatabaseCard[]): Promise<void> {
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

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      fuseInstance = null;
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

// ============================================================================
// CONVERSION FUNCTIONS
// ============================================================================

/**
 * Convert a MinimalCard (Scryfall-style) to a GenericCard
 */
export function minimalCardToGenericCard(minimalCard: MinimalCard): GenericCard {
  // Map color strings to GenericColor enum
  const mapColors = (colors: string[]): GenericColor[] => {
    return colors.map(color => {
      switch (color.toLowerCase()) {
        case 'r': return GenericColor.RED;
        case 'u': return GenericColor.BLUE;
        case 'g': return GenericColor.GREEN;
        case 'b': return GenericColor.BLACK;
        case 'w': return GenericColor.WHITE;
        default: return GenericColor.COLORLESS;
      }
    });
  };

  // Extract card type from type_line
  const getCardType = (typeLine: string): GenericCardType => {
    const lowerType = typeLine.toLowerCase();
    if (lowerType.includes('creature')) return GenericCardType.CREATURE;
    if (lowerType.includes('artifact')) return GenericCardType.ARTIFACT;
    if (lowerType.includes('enchantment')) return GenericCardType.ENCHANTMENT;
    if (lowerType.includes('instant')) return GenericCardType.INSTANT;
    if (lowerType.includes('sorcery')) return GenericCardType.SORCERY;
    if (lowerType.includes('planeswalker')) return GenericCardType.PLANESWALKER;
    if (lowerType.includes('land')) return GenericCardType.LAND;
    return GenericCardType.ARTIFACT; // Default
  };

  // Extract subtypes
  const getSubtypes = (typeLine: string): string[] => {
    const parts = typeLine.split('—');
    if (parts.length > 1) {
      return parts[1].trim().split(' ').filter(Boolean);
    }
    return [];
  };

  // Map keywords
  const mapKeywords = (keywords?: string[]): AbilityKeyword[] => {
    if (!keywords) return [];
    return keywords.filter(k => Object.values(AbilityKeyword).includes(k as AbilityKeyword)) as AbilityKeyword[];
  };

  // Parse power/toughness
  const parsePowerToughness = (value?: string): number | undefined => {
    if (!value) return undefined;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
  };

  // Map legalities
  const mapLegalities = (legalities: Record<string, string>) => {
    return {
      commander: (legalities.commander as any) || 'legal',
      standard: (legalities.standard as any) || 'legal',
      modern: (legalities.modern as any) || 'legal',
      pioneer: (legalities.pioneer as any) || 'legal',
      legacy: (legalities.legacy as any) || 'legal',
      vintage: (legalities.vintage as any) || 'legal',
      pauper: (legalities.pauper as any) || 'legal',
    };
  };

  return {
    id: minimalCard.id,
    name: minimalCard.name,
    type: getCardType(minimalCard.type_line),
    subtypes: getSubtypes(minimalCard.type_line),
    manaCost: minimalCard.mana_cost || '',
    cmc: minimalCard.cmc,
    colors: mapColors(minimalCard.colors),
    colorIdentity: mapColors(minimalCard.color_identity),
    text: minimalCard.oracle_text || '',
    keywords: mapKeywords(minimalCard.keywords),
    power: parsePowerToughness(minimalCard.power),
    toughness: parsePowerToughness(minimalCard.toughness),
    legalities: mapLegalities(minimalCard.legalities),
    imageUris: minimalCard.image_uris ? {
      small: minimalCard.image_uris.small,
      normal: minimalCard.image_uris.normal,
      large: minimalCard.image_uris.large,
    } : undefined,
  };
}

/**
 * Convert a GenericCard to a MinimalCard (Scryfall-style)
 */
export function genericCardToMinimalCard(genericCard: GenericCard): MinimalCard {
  // Map GenericColor enum to strings
  const mapColorsToString = (colors: GenericColor[]): string[] => {
    return colors.map(color => color);
  };

  // Build type_line
  const buildTypeLine = (card: GenericCard): string => {
    const typeMap: Record<GenericCardType, string> = {
      [GenericCardType.CREATURE]: `Creature ${card.subtypes.length > 0 ? `— ${card.subtypes.join(' ')}` : ''}`,
      [GenericCardType.ARTIFACT]: `Artifact ${card.subtypes.length > 0 ? `— ${card.subtypes.join(' ')}` : ''}`,
      [GenericCardType.ENCHANTMENT]: `Enchantment ${card.subtypes.length > 0 ? `— ${card.subtypes.join(' ')}` : ''}`,
      [GenericCardType.INSTANT]: 'Instant',
      [GenericCardType.SORCERY]: 'Sorcery',
      [GenericCardType.PLANESWALKER]: 'Planeswalker',
      [GenericCardType.LAND]: `Land ${card.subtypes.length > 0 ? `— ${card.subtypes.join(' ')}` : ''}`,
      [GenericCardType.TOKEN]: 'Token',
    };
    return typeMap[card.type];
  };

  // Map legalities to Record<string, string>
  const mapLegalitiesToString = (legalities: any) => {
    return {
      commander: legalities.commander,
      standard: legalities.standard,
      modern: legalities.modern,
      pioneer: legalities.pioneer,
      legacy: legalities.legacy,
      vintage: legalities.vintage,
      pauper: legalities.pauper,
    };
  };

  return {
    id: genericCard.id,
    name: genericCard.name,
    cmc: genericCard.cmc,
    type_line: buildTypeLine(genericCard),
    oracle_text: genericCard.text,
    colors: mapColorsToString(genericCard.colors),
    color_identity: mapColorsToString(genericCard.colorIdentity),
    mana_cost: genericCard.manaCost,
    power: genericCard.power !== undefined ? String(genericCard.power) : undefined,
    toughness: genericCard.toughness !== undefined ? String(genericCard.toughness) : undefined,
    keywords: genericCard.keywords.map(k => k),
    legalities: mapLegalitiesToString(genericCard.legalities),
    image_uris: genericCard.imageUris ? {
      small: genericCard.imageUris.small,
      normal: genericCard.imageUris.normal,
      large: genericCard.imageUris.large,
      png: genericCard.imageUris.normal, // Use normal as fallback
      art_crop: genericCard.imageUris.normal,
      border_crop: genericCard.imageUris.normal,
    } : undefined,
  };
}

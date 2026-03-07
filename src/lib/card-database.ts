/**
 * @fileOverview Offline card database module
 *
 * This module provides offline card search and validation using bundled data.
 * For use in Tauri/PWA offline mode.
 *
 * Unit 2: Original Card Data Schema
 * This file now includes generic card types that remove MTG IP while preserving game mechanics.
 */

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
 * Generic card interface - the foundation for original card data
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
  /** Number of copies of this card in the deck */
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

  /** Cards in the deck */
  cards: GenericDeckCard[];

  /** When the deck was created */
  createdAt: string;

  /** When the deck was last updated */
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

// ============================================================================
// CARD DATABASE IMPLEMENTATION
// ============================================================================

/**
 * Database type - can store either generic cards or Scryfall cards
 */
type DatabaseCard = GenericCard | MinimalCard;

/**
 * In-memory card database (will be populated on load)
 * Supports both GenericCard and legacy MinimalCard
 */
const cardDatabase: Map<string, DatabaseCard> = new Map();
let isLoaded = false;

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

// ============================================================================
// INITIALIZATION
// ============================================================================

/**
 * Load bundled card data
 * Supports both generic cards and legacy Scryfall-style cards
 */
export async function initializeCardDatabase(): Promise<void> {
  if (isLoaded) return;

  // In a real implementation, this would load from a bundled JSON file
  // For now, we'll initialize with sample generic cards
  const genericCards: GenericCard[] = [
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
      name: 'Exile Blade',
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
      name: 'Rampant Growth',
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
      name: 'Brainstorm',
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
      name: 'Cultivate',
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
      name: 'Path to Exile',
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
      name: 'Destruction',
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
      name: 'Kodama\'s Reach',
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
    }
  ];

  // Populate database with generic cards
  for (const card of genericCards) {
    cardDatabase.set(card.name.toLowerCase(), card);
    // Also index by ID
    cardDatabase.set(card.id, card);
  }

  isLoaded = true;
}

// ============================================================================
// SEARCH AND RETRIEVAL FUNCTIONS
// ============================================================================

/**
 * Search cards by name (offline)
 * Returns generic cards and legacy minimal cards
 */
export function searchCardsOffline(query: string, options?: CardDatabaseOptions): DatabaseCard[] {
  if (!isLoaded) {
    console.warn('Card database not initialized. Call initializeCardDatabase() first.');
    return [];
  }

  if (!query || query.length < 2) return [];

  const normalizedQuery = query.toLowerCase();
  const results: DatabaseCard[] = [];

  for (const [, card] of cardDatabase) {
    const cardName = isGenericCard(card) ? card.name : card.name;
    if (cardName.toLowerCase().includes(normalizedQuery)) {
      results.push(card);
    }
  }

  // Sort by name match quality
  results.sort((a, b) => {
    const aName = isGenericCard(a) ? a.name : a.name;
    const bName = isGenericCard(b) ? b.name : b.name;
    const aExact = aName.toLowerCase().startsWith(normalizedQuery);
    const bExact = bName.toLowerCase().startsWith(normalizedQuery);
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return aName.localeCompare(bName);
  });

  const maxCards = options?.maxCards ?? 20;
  return results.slice(0, maxCards);
}

/**
 * Get card by exact name
 * Returns generic cards and legacy minimal cards
 */
export function getCardByName(name: string): DatabaseCard | undefined {
  if (!isLoaded) return undefined;
  return cardDatabase.get(name.toLowerCase());
}

/**
 * Get card by ID
 * Returns generic cards and legacy minimal cards
 */
export function getCardById(id: string): DatabaseCard | undefined {
  if (!isLoaded) return undefined;
  return cardDatabase.get(id);
}

/**
 * Get only generic cards (filters out legacy minimal cards)
 */
export function getGenericCards(): GenericCard[] {
  if (!isLoaded) return [];
  return Array.from(cardDatabase.values()).filter(isGenericCard);
}

/**
 * Get only legacy minimal cards (filters out generic cards)
 */
export function getLegacyCards(): MinimalCard[] {
  if (!isLoaded) return [];
  return Array.from(cardDatabase.values()).filter(isMinimalCard);
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Check if a card is legal in a format
 * Works with both generic cards and legacy minimal cards
 */
export function isCardLegal(cardName: string, format: string): boolean {
  const card = getCardByName(cardName);
  if (!card) return false;

  if (isGenericCard(card)) {
    return card.legalities[format as keyof typeof card.legalities] === 'legal';
  } else if (isMinimalCard(card)) {
    return card.legalities[format] === 'legal';
  }

  return false;
}

/**
 * Validate deck against format
 * Works with both generic cards and legacy minimal cards
 */
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

    if (!isCardLegal(card.name, format)) {
      illegalCards.push(card.name);
    }
  }

  return {
    valid: illegalCards.length === 0 && issues.length === 0,
    illegalCards,
    issues,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get database status
 */
export function getDatabaseStatus(): { loaded: boolean; cardCount: number; genericCards: number; legacyCards: number } {
  const allCards = Array.from(cardDatabase.values());
  const genericCount = allCards.filter(isGenericCard).length;
  const legacyCount = allCards.filter(isMinimalCard).length;

  return {
    loaded: isLoaded,
    cardCount: cardDatabase.size,
    genericCards: genericCount,
    legacyCards: legacyCount
  };
}

/**
 * Export all cards (both generic and legacy)
 */
export function getAllCards(): DatabaseCard[] {
  return Array.from(cardDatabase.values());
}

// ============================================================================
// MIGRATION/CONVERSION FUNCTIONS
// ============================================================================

/**
 * Convert a legacy MinimalCard to a GenericCard
 * This helps migrate from MTG-specific data to generic cards
 */
export function minimalCardToGenericCard(minimalCard: MinimalCard): GenericCard {
  // Parse type_line to determine card type
  const typeLine = minimalCard.type_line.toLowerCase();
  let type: GenericCardType;
  const subtypes: CardSubtype[] = [];

  if (typeLine.includes('creature')) {
    type = GenericCardType.CREATURE;
    const match = minimalCard.type_line.match(/Creature\s*—?\s*(.+)/);
    if (match) {
      subtypes.push(...match[1].trim().split(' ').filter(s => s));
    }
  } else if (typeLine.includes('instant')) {
    type = GenericCardType.INSTANT;
  } else if (typeLine.includes('sorcery')) {
    type = GenericCardType.SORCERY;
  } else if (typeLine.includes('artifact')) {
    type = GenericCardType.ARTIFACT;
  } else if (typeLine.includes('enchantment')) {
    type = GenericCardType.ENCHANTMENT;
  } else if (typeLine.includes('land')) {
    type = GenericCardType.LAND;
  } else if (typeLine.includes('planeswalker')) {
    type = GenericCardType.PLANESWALKER;
  } else {
    type = GenericCardType.ARTIFACT; // Default
  }

  // Map colors to GenericColor enum
  const colorMap: Record<string, GenericColor> = {
    'R': GenericColor.RED,
    'U': GenericColor.BLUE,
    'G': GenericColor.GREEN,
    'B': GenericColor.BLACK,
    'W': GenericColor.WHITE,
    'C': GenericColor.COLORLESS
  };

  const colors = minimalCard.colors.map(c => colorMap[c] || GenericColor.COLORLESS);
  const colorIdentity = minimalCard.color_identity.map(c => colorMap[c] || GenericColor.COLORLESS);

  // Determine keywords from oracle text
  const keywords: AbilityKeyword[] = [];
  const keywordPatterns: { keyword: AbilityKeyword; pattern: RegExp }[] = [
    { keyword: AbilityKeyword.FIRST_STRIKE, pattern: /first strike/i },
    { keyword: AbilityKeyword.DOUBLE_STRIKE, pattern: /double strike/i },
    { keyword: AbilityKeyword.DEATHTOUCH, pattern: /deathtouch/i },
    { keyword: AbilityKeyword.HEXPROOF, pattern: /hexproof/i },
    { keyword: AbilityKeyword.LIFELINK, pattern: /lifelink/i },
    { keyword: AbilityKeyword.FLYING, pattern: /flying/i },
    { keyword: AbilityKeyword.TRAMPLE, pattern: /trample/i },
    { keyword: AbilityKeyword.HASTE, pattern: /haste/i },
    { keyword: AbilityKeyword.VIGILANCE, pattern: /vigilance/i },
    { keyword: AbilityKeyword.REACH, pattern: /reach/i },
    { keyword: AbilityKeyword.MENACE, pattern: /menace/i },
    { keyword: AbilityKeyword.INDESTRUCTIBLE, pattern: /indestructible/i },
    { keyword: AbilityKeyword.PROTECTION, pattern: /protection from/i },
    { keyword: AbilityKeyword.SCRY, pattern: /scry/i },
  ];

  const text = minimalCard.oracle_text || '';
  for (const { keyword, pattern } of keywordPatterns) {
    if (pattern.test(text)) {
      keywords.push(keyword);
    }
  }

  // Parse power/toughness for creatures
  let power: number | undefined;
  let toughness: number | undefined;
  if (type === GenericCardType.CREATURE && minimalCard.oracle_text) {
    // Look for P/T in oracle text (usually shown as "X/Y")
    const ptMatch = minimalCard.oracle_text.match(/(\d+)\/(\d+)/);
    if (ptMatch) {
      power = parseInt(ptMatch[1], 10);
      toughness = parseInt(ptMatch[2], 10);
    }
  }

  // Map legalities
  const legalities = {
    commander: (minimalCard.legalities?.commander || 'legal') as "legal" | "banned" | "restricted",
    standard: (minimalCard.legalities?.standard || 'legal') as "legal" | "banned" | "restricted",
    modern: (minimalCard.legalities?.modern || 'legal') as "legal" | "banned" | "restricted",
    pioneer: (minimalCard.legalities?.pioneer || 'legal') as "legal" | "banned" | "restricted",
    legacy: (minimalCard.legalities?.legacy || 'legal') as "legal" | "banned" | "restricted",
    vintage: (minimalCard.legalities?.vintage || 'legal') as "legal" | "banned" | "restricted",
    pauper: (minimalCard.legalities?.pauper || 'legal') as "legal" | "banned" | "restricted"
  };

  return {
    id: minimalCard.id,
    name: minimalCard.name,
    type: type as GenericCardType,
    subtypes,
    manaCost: '', // Would need to parse from Scryfall data
    cmc: minimalCard.cmc,
    colors,
    colorIdentity,
    text: minimalCard.oracle_text || '',
    keywords,
    power,
    toughness,
    legalities,
    imageUris: minimalCard.image_uris ? {
      small: minimalCard.image_uris.small,
      normal: minimalCard.image_uris.normal,
      large: minimalCard.image_uris.large
    } : undefined
  };
}

/**
 * Convert a GenericCard to legacy MinimalCard format
 * Useful for backward compatibility
 */
export function genericCardToMinimalCard(genericCard: GenericCard): MinimalCard {
  // Construct type_line from type and subtypes
  const type_line = genericCard.type +
    (genericCard.subtypes.length > 0 ? ` — ${genericCard.subtypes.join(' ')}` : '');

  // Map GenericColor enum back to Scryfall color letters
  const colorMap: Record<GenericColor, string> = {
    [GenericColor.RED]: 'R',
    [GenericColor.BLUE]: 'U',
    [GenericColor.GREEN]: 'G',
    [GenericColor.BLACK]: 'B',
    [GenericColor.WHITE]: 'W',
    [GenericColor.COLORLESS]: 'C'
  };

  const colors = genericCard.colors.map(c => colorMap[c]);
  const color_identity = genericCard.colorIdentity.map(c => colorMap[c]);

  return {
    id: genericCard.id,
    name: genericCard.name,
    cmc: genericCard.cmc,
    type_line,
    oracle_text: genericCard.text,
    colors,
    color_identity,
    legalities: {
      commander: genericCard.legalities.commander,
      standard: genericCard.legalities.standard,
      modern: genericCard.legalities.modern,
      pioneer: genericCard.legalities.pioneer,
      legacy: genericCard.legalities.legacy,
      vintage: genericCard.legalities.vintage,
      pauper: genericCard.legalities.pauper
    },
    image_uris: genericCard.imageUris
  };
}

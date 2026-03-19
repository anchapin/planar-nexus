/**
 * Card Factory
 * 
 * Provides factory functions for creating consistent test card data
 * that matches the Scryfall card format.
 */

import type { MinimalCard } from '@/lib/card-database';

/**
 * Default legalities for cards
 */
const DEFAULT_LEGALITIES: Record<string, string> = {
  standard: 'legal',
  modern: 'legal',
  legacy: 'legal',
  commander: 'legal',
  pioneer: 'legal',
  pauper: 'legal',
  vintage: 'legal',
  brawl: 'legal',
  historic: 'legal',
  penny: 'legal',
};

/**
 * Default image URIs for testing
 */
const DEFAULT_IMAGE_URIS = {
  small: 'https://cards.scryfall.io/small/front/a/b/abc123.jpg',
  normal: 'https://cards.scryfall.io/normal/front/a/b/abc123.jpg',
  large: 'https://cards.scryfall.io/large/front/a/b/abc123.jpg',
  png: 'https://cards.scryfall.io/png/front/a/b/abc123.png',
  art_crop: 'https://cards.scryfall.io/art_crop/front/a/b/abc123.jpg',
  border_crop: 'https://cards.scryfall.io/border_crop/front/a/b/abc123.jpg',
};

/**
 * Options for creating a card
 */
export interface CreateCardOptions {
  /**
   * Card name
   */
  name?: string;
  /**
   * Card set code
   */
  set?: string;
  /**
   * Collector number
   */
  collector_number?: string;
  /**
   * Converted mana cost
   */
  cmc?: number;
  /**
   * Type line (e.g., "Instant", "Creature — Elf Druid")
   */
  type_line?: string;
  /**
   * Oracle text
   */
  oracle_text?: string;
  /**
   * Card colors (W, U, B, R, G)
   */
  colors?: string[];
  /**
   * Color identity
   */
  color_identity?: string[];
  /**
   * Rarity (common, uncommon, rare, mythic)
   */
  rarity?: string;
  /**
   * Mana cost (e.g., "{2}{U}")
   */
  mana_cost?: string;
  /**
   * Power (for creatures)
   */
  power?: string;
  /**
   * Toughness (for creatures)
   */
  toughness?: string;
  /**
   * Legalities
   */
  legalities?: Record<string, string>;
  /**
   * Image URIs
   */
  image_uris?: typeof DEFAULT_IMAGE_URIS;
  /**
   * Card ID (generated if not provided)
   */
  id?: string;
  /**
   * Oracle ID
   */
  oracle_id?: string;
  /**
   * Keywords
   */
  keywords?: string[];
  /**
   * Card faces for double-faced cards
   */
  card_faces?: MinimalCard['card_faces'];
  /**
   * Layout type
   */
  layout?: string;
  /**
   * Loyalty (for planeswalkers)
   */
  loyalty?: string;
}

/**
 * Generate a unique ID for cards
 */
let cardIdCounter = 0;
function generateCardId(): string {
  cardIdCounter++;
  return `test-card-${cardIdCounter.toString().padStart(4, '0')}`;
}

/**
 * Create a basic card with default values
 * 
 * @param options - Card options to override defaults
 * @returns A MinimalCard object
 * 
 * @example
 * const card = createCard({ name: 'Lightning Bolt' });
 * console.log(card.name); // 'Lightning Bolt'
 * console.log(card.cmc); // 1 (default)
 */
export function createCard(options: CreateCardOptions = {}): MinimalCard {
  const id = options.id || generateCardId();
  
  return {
    id,
    oracle_id: options.oracle_id || `oracle-${id}`,
    name: options.name || 'Test Card',
    set: options.set || 'tst',
    collector_number: options.collector_number || '1',
    cmc: options.cmc ?? 2,
    type_line: options.type_line || 'Instant',
    oracle_text: options.oracle_text || '',
    colors: options.colors || ['U'],
    color_identity: options.color_identity || ['U'],
    rarity: options.rarity || 'common',
    legalities: options.legalities || { ...DEFAULT_LEGALITIES },
    mana_cost: options.mana_cost || '{2}{U}',
    power: options.power,
    toughness: options.toughness,
    image_uris: options.image_uris || DEFAULT_IMAGE_URIS,
    keywords: options.keywords || [],
    card_faces: options.card_faces,
    layout: options.layout,
    loyalty: options.loyalty,
  };
}

/**
 * Create a land card
 * 
 * @param options - Card options to override defaults
 * @returns A MinimalCard representing a land
 * 
 * @example
 * const forest = createLand({ name: 'Forest' });
 * console.log(forest.type_line); // 'Land'
 * console.log(forest.colors); // []
 */
export function createLand(options: CreateCardOptions = {}): MinimalCard {
  return createCard({
    type_line: 'Land',
    colors: [],
    color_identity: options.color_identity || [],
    cmc: 0,
    mana_cost: undefined,
    power: undefined,
    toughness: undefined,
    ...options,
  });
}

/**
 * Create a creature card
 * 
 * @param options - Card options to override defaults
 * @returns A MinimalCard representing a creature
 * 
 * @example
 * const creature = createCreature({ 
 *   name: 'Grizzly Bears',
 *   power: '2',
 *   toughness: '2'
 * });
 * console.log(creature.type_line); // 'Creature — Bear'
 * console.log(creature.power); // '2'
 */
export function createCreature(options: CreateCardOptions = {}): MinimalCard {
  return createCard({
    type_line: options.type_line || 'Creature — Bear',
    power: options.power || '2',
    toughness: options.toughness || '2',
    ...options,
  });
}

/**
 * Create a spell card (instant or sorcery)
 * 
 * @param options - Card options to override defaults
 * @returns A MinimalCard representing a spell
 * 
 * @example
 * const spell = createSpell({ 
 *   name: 'Lightning Bolt',
 *   type_line: 'Instant',
 *   oracle_text: 'Lightning Bolt deals 3 damage to any target.'
 * });
 */
export function createSpell(options: CreateCardOptions = {}): MinimalCard {
  return createCard({
    type_line: options.type_line || 'Instant',
    power: undefined,
    toughness: undefined,
    ...options,
  });
}

/**
 * Create an artifact card
 * 
 * @param options - Card options to override defaults
 * @returns A MinimalCard representing an artifact
 * 
 * @example
 * const artifact = createArtifact({ name: 'Sol Ring' });
 * console.log(artifact.type_line); // 'Artifact'
 */
export function createArtifact(options: CreateCardOptions = {}): MinimalCard {
  return createCard({
    type_line: 'Artifact',
    colors: options.colors || [],
    color_identity: options.color_identity || [],
    power: undefined,
    toughness: undefined,
    ...options,
  });
}

/**
 * Create a planeswalker card
 * 
 * @param options - Card options to override defaults
 * @returns A MinimalCard representing a planeswalker
 * 
 * @example
 * const planeswalker = createPlaneswalker({ 
 *   name: 'Jace, Unraveler of Secrets',
 *   loyalty: '3'
 * });
 * console.log(planeswalker.type_line); // 'Legendary Planeswalker — Jace'
 * console.log(planeswalker.loyalty); // '3'
 */
export function createPlaneswalker(options: CreateCardOptions = {}): MinimalCard {
  return createCard({
    type_line: options.type_line || 'Legendary Planeswalker — Jace',
    loyalty: options.loyalty || '3',
    power: undefined,
    toughness: undefined,
    ...options,
  });
}

/**
 * Create an enchantment card
 * 
 * @param options - Card options to override defaults
 * @returns A MinimalCard representing an enchantment
 * 
 * @example
 * const enchantment = createEnchantment({ name: 'Glorious Anthem' });
 * console.log(enchantment.type_line); // 'Enchantment'
 */
export function createEnchantment(options: CreateCardOptions = {}): MinimalCard {
  return createCard({
    type_line: 'Enchantment',
    power: undefined,
    toughness: undefined,
    ...options,
  });
}

/**
 * Create a legendary creature
 * 
 * @param options - Card options to override defaults
 * @returns A MinimalCard representing a legendary creature
 * 
 * @example
 * const commander = createLegendaryCreature({ 
 *   name: 'Jhoira, Weatherlight Captain',
 *   power: '2',
 *   toughness: '2'
 * });
 * console.log(commander.type_line); // 'Legendary Creature — Human'
 */
export function createLegendaryCreature(options: CreateCardOptions = {}): MinimalCard {
  return createCard({
    type_line: options.type_line || 'Legendary Creature — Human',
    power: options.power || '2',
    toughness: options.toughness || '2',
    ...options,
  });
}

/**
 * Reset card ID counter (useful for test isolation)
 */
export function resetCardIdCounter(): void {
  cardIdCounter = 0;
}

/**
 * Create multiple cards with a factory function
 * 
 * @param count - Number of cards to create
 * @param factory - Factory function to create each card
 * @returns Array of cards
 * 
 * @example
 * const cards = createMany(5, createCreature);
 * // Creates 5 creature cards with default names
 */
export function createMany(
  count: number,
  factory: (options?: CreateCardOptions) => MinimalCard,
  options?: CreateCardOptions
): MinimalCard[] {
  return Array.from({ length: count }, (_, i) => 
    factory({ ...options, name: options?.name ? `${options.name} ${i + 1}` : undefined })
  );
}

export default {
  createCard,
  createLand,
  createCreature,
  createSpell,
  createArtifact,
  createPlaneswalker,
  createEnchantment,
  createLegendaryCreature,
  createMany,
  resetCardIdCounter,
};

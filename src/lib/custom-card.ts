/**
 * @fileOverview Custom Card Creation Types
 * 
 * Type definitions for the Custom Card Creation Studio feature (Issue #593)
 * WYSIWYG editor for creating custom Magic: The Gathering cards
 */

import type { MinimalCard } from './card-database';

// Card type categories
export type CustomCardType = 
  | 'creature'
  | 'instant'
  | 'sorcery'
  | 'artifact'
  | 'enchantment'
  | 'planeswalker'
  | 'land'
  | 'legendary'
  | 'token';

// Color types for Magic cards
export type CardColor = 'white' | 'blue' | 'black' | 'red' | 'green' | 'colorless';

// Frame style variants
export type CardFrameStyle = 
  | 'modern'
  | 'old'
  | 'future'
  | 'classic'
  | 'mirrodin'
  | 'innistrad'
  | 'zendikar'
  | 'Ixalan'
  | 'Strixhaven';

// Card rarity
export type CardRarity = 'common' | 'uncommon' | 'rare' | 'mythic';

// Typography settings for card text
export interface CardTypography {
  nameFont?: string;
  nameSize?: number;
  nameColor?: string;
  typeFont?: string;
  typeSize?: number;
  typeColor?: string;
  textFont?: string;
  textSize?: number;
  textColor?: string;
  oracleText?: string;
  flavorText?: string;
  power?: string;
  toughness?: string;
  loyalty?: string;
}

// Image handling for card art
export interface CardArtSettings {
  imageUrl?: string;
  imagePosition?: 'cover' | 'contain' | 'fill';
  useProceduralArt?: boolean;
  proceduralColors?: CardColor[];
  proceduralStyle?: 'abstract' | 'landscape' | 'creature' | 'spell' | 'artifact';
}

// Background settings
export interface CardBackgroundSettings {
  frameColor?: string;
  borderColor?: string;
  backgroundGradient?: {
    start: string;
    end: string;
    angle?: number;
  };
}

// Full custom card definition
export interface CustomCardDefinition {
  // Unique identifier
  id: string;
  
  // Basic card info
  name: string;
  manaCost?: string;
  typeLine: string;
  
  // Card type flags (can be multiple)
  cardTypes: CustomCardType[];
  subtypes?: string[];
  
  // Colors
  colors: CardColor[];
  colorIndicator?: CardColor[];
  
  // Oracle text (abilities)
  oracleText: string;
  
  // Optional flavor text
  flavorText?: string;
  
  // Power/Toughness (creatures)
  power?: string;
  toughness?: string;
  
  // Loyalty (planeswalkers)
  loyalty?: string;
  
  // Set info
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  
  // Rarity
  rarity: CardRarity;
  
  // Visual customization
  frameStyle: CardFrameStyle;
  typography: CardTypography;
  art: CardArtSettings;
  background: CardBackgroundSettings;
  
  // Art copyright/info
  artist?: string;
  copyright?: string;
  
  // Timestamps
  createdAt: number;
  updatedAt: number;
  
  // Is this a transform card?
  transformCardId?: string;
  backFace?: CustomCardDefinition;
}

// Default values for new cards
export const DEFAULT_CUSTOM_CARD: Omit<CustomCardDefinition, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  manaCost: '',
  typeLine: 'Creature — Human',
  cardTypes: ['creature'],
  subtypes: [],
  colors: ['white'],
  colorIndicator: undefined,
  oracleText: '',
  flavorText: '',
  power: '1',
  toughness: '1',
  loyalty: undefined,
  setCode: 'CUS',
  setName: 'Custom',
  collectorNumber: '001',
  rarity: 'common',
  frameStyle: 'modern',
  typography: {
    nameFont: 'Beleren',
    nameSize: 14,
    nameColor: '#000000',
    typeFont: 'Beleren',
    typeSize: 11,
    typeColor: '#000000',
    textFont: 'Beleren',
    textSize: 9,
    textColor: '#000000',
    oracleText: '',
    flavorText: '',
    power: '1',
    toughness: '1',
  },
  art: {
    imageUrl: undefined,
    imagePosition: 'cover',
    useProceduralArt: true,
    proceduralColors: ['white'],
    proceduralStyle: 'abstract',
  },
  background: {
    frameColor: '#f8f6d8',
    borderColor: '#000000',
  },
  artist: '',
  copyright: '',
  transformCardId: undefined,
  backFace: undefined,
};

// Color to Magic color mapping with hex values
export const CARD_COLORS: Record<CardColor, { name: string; hex: string; symbol: string }> = {
  white: { name: 'White', hex: '#f9f9f9', symbol: 'W' },
  blue: { name: 'Blue', hex: '#0e68ab', symbol: 'U' },
  black: { name: 'Black', hex: '#150b00', symbol: 'B' },
  red: { name: 'Red', hex: '#d3202a', symbol: 'R' },
  green: { name: 'Green', hex: '#00733e', symbol: 'G' },
  colorless: { name: 'Colorless', hex: '#9c9c9c', symbol: 'C' },
};

// Frame style color mappings
export const FRAME_STYLE_COLORS: Record<CardFrameStyle, { background: string; border: string; text: string }> = {
  modern: { background: '#f8f6d8', border: '#000000', text: '#000000' },
  old: { background: '#ebe4d4', border: '#000000', text: '#000000' },
  future: { background: '#cfcfcf', border: '#000000', text: '#000000' },
  classic: { background: '#f8f6d8', border: '#000000', text: '#000000' },
  mirrodin: { background: '#d8e8f8', border: '#000000', text: '#000000' },
  innistrad: { background: '#e8ddd0', border: '#000000', text: '#000000' },
  zendikar: { background: '#e8d8b8', border: '#000000', text: '#000000' },
  Ixalan: { background: '#d8c8a8', border: '#000000', text: '#000000' },
  Strixhaven: { background: '#d8d8e8', border: '#000000', text: '#000000' },
};

// Rarity color mapping
export const RARITY_COLORS: Record<CardRarity, string> = {
  common: '#000000',
  uncommon: '#8c8c8c',
  rare: '#d8a030',
  mythic: '#ff6b0a',
};

// Convert CustomCardDefinition to MinimalCard for database compatibility
export function customCardToMinimalCard(card: CustomCardDefinition): MinimalCard {
  return {
    id: card.id,
    name: card.name,
    set: card.setCode,
    collector_number: card.collectorNumber,
    cmc: parseManaCost(card.manaCost || ''),
    type_line: card.typeLine,
    oracle_text: card.oracleText,
    colors: card.colors,
    color_identity: card.colors,
    rarity: card.rarity,
    legalities: {}, // Custom cards have no format legality
    mana_cost: card.manaCost,
    power: card.power,
    toughness: card.toughness,
    keywords: [],
    layout: card.transformCardId ? 'transform' : 'normal',
    loyalty: card.loyalty,
  };
}

// Parse mana cost string to cmc
function parseManaCost(manaCost: string): number {
  if (!manaCost) return 0;
  
  let cmc = 0;
  // Match numbers
  const numbers = manaCost.match(/\d+/g);
  if (numbers) {
    cmc += numbers.reduce((sum, n) => sum + parseInt(n), 0);
  }
  // Match color mana symbols
  const colorMana = manaCost.match(/[WUBRGC]/gi);
  if (colorMana) {
    cmc += colorMana.length;
  }
  // Match Phyrexian mana
  const phyrexian = manaCost.match(/[WUBRG]\/P/gi);
  if (phyrexian) {
    cmc += phyrexian.length;
  }
  
  return cmc;
}

// Generate unique ID for custom cards
export function generateCustomCardId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Validate custom card
export function validateCustomCard(card: Partial<CustomCardDefinition>): string[] {
  const errors: string[] = [];
  
  if (!card.name || card.name.trim() === '') {
    errors.push('Card name is required');
  }
  
  if (!card.typeLine || card.typeLine.trim() === '') {
    errors.push('Card type line is required');
  }
  
  if (!card.oracleText || card.oracleText.trim() === '') {
    errors.push('Oracle text is required');
  }
  
  if (!card.cardTypes || card.cardTypes.length === 0) {
    errors.push('At least one card type is required');
  }
  
  // Validate power/toughness for creatures
  if (card.cardTypes?.includes('creature')) {
    if (card.power !== undefined && card.toughness !== undefined) {
      const powerNum = parseInt(card.power);
      const toughnessNum = parseInt(card.toughness);
      if (isNaN(powerNum) || isNaN(toughnessNum)) {
        errors.push('Power and toughness must be numbers');
      }
    }
  }
  
  // Validate loyalty for planeswalkers
  if (card.cardTypes?.includes('planeswalker')) {
    if (!card.loyalty) {
      errors.push('Planeswalkers must have a loyalty ability');
    }
  }
  
  return errors;
}

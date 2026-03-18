'use client';

import { useMemo } from 'react';
import type { DeckCard } from '@/app/actions';

/**
 * Result of deck card analysis
 */
export interface CardAnalysisResult {
  /** Total card count (sum of all counts) */
  totalCards: number;
  /** Number of unique cards */
  uniqueCards: number;
  /** Card count by color: W, U, B, R, G, Colorless */
  colorDistribution: Record<string, number>;
  /** Card count by converted mana cost: 0-7+ CMC */
  manaCurve: Record<number, number>;
  /** Card count by type: creature, instant, sorcery, etc. */
  typeDistribution: Record<string, number>;
  /** Average mana value of the deck */
  averageManaValue: number;
}

/**
 * Magic color codes for display
 */
const MAGIC_COLORS = ['W', 'U', 'B', 'R', 'G'] as const;

/**
 * Magic color hex codes for charts
 */
export const MAGIC_COLOR_HEX: Record<string, string> = {
  W: '#F9F99A',
  U: '#0E68AB',
  B: '#150B00',
  R: '#E12D2D',
  G: '#00733E',
  Colorless: '#9CA3AF',
};

/**
 * Card type categories to track
 */
const CARD_TYPES = [
  'creature',
  'instant',
  'sorcery',
  'enchantment',
  'artifact',
  'planeswalker',
  'land',
] as const;

/**
 * Analyze a deck of cards and calculate statistics
 * @param deck - Array of DeckCard objects
 * @returns CardAnalysisResult with deck statistics
 */
export function analyzeDeck(deck: DeckCard[]): CardAnalysisResult {
  // Initialize result
  const result: CardAnalysisResult = {
    totalCards: 0,
    uniqueCards: deck.length,
    colorDistribution: {
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 0,
      Colorless: 0,
    },
    manaCurve: {},
    typeDistribution: {},
    averageManaValue: 0,
  };

  // Initialize mana curve (0-7+)
  for (let i = 0; i <= 7; i++) {
    result.manaCurve[i] = 0;
  }

  // Initialize type distribution
  CARD_TYPES.forEach((type) => {
    result.typeDistribution[type] = 0;
  });

  // Calculate totals
  let totalCMC = 0;

  for (const card of deck) {
    const count = card.count || 1;
    result.totalCards += count;

    // Calculate mana curve
    const cmc = card.cmc ?? 0;
    const cmcBucket = cmc >= 7 ? 7 : cmc;
    result.manaCurve[cmcBucket] = (result.manaCurve[cmcBucket] || 0) + count;
    totalCMC += cmc * count;

    // Calculate color distribution
    const colors = card.colors || [];
    if (colors.length === 0) {
      // Colorless card
      result.colorDistribution.Colorless += count;
    } else if (colors.length === 1) {
      // Single color
      const color = colors[0];
      if (color in result.colorDistribution) {
        result.colorDistribution[color] += count;
      }
    } else {
      // Multi-color - add to each color
      for (const color of colors) {
        if (color in result.colorDistribution) {
          result.colorDistribution[color] += count;
        }
      }
    }

    // Calculate type distribution
    const typeLine = card.type_line || '';
    for (const type of CARD_TYPES) {
      // Check if type_line contains this type (case-insensitive)
      const regex = new RegExp(type, 'i');
      if (regex.test(typeLine)) {
        result.typeDistribution[type] += count;
      }
    }
  }

  // Calculate average mana value
  result.averageManaValue = result.totalCards > 0 
    ? Math.round((totalCMC / result.totalCards) * 100) / 100 
    : 0;

  return result;
}

/**
 * React hook for deck statistics
 * @param deck - Array of DeckCard objects
 * @returns Memoized CardAnalysisResult
 */
export function useDeckStatistics(deck: DeckCard[]) {
  return useMemo(() => analyzeDeck(deck), [deck]);
}

/**
 * Get chart data for mana curve
 * @param manaCurve - Mana curve record
 * @returns Array formatted for Recharts
 */
export function getManaCurveData(manaCurve: Record<number, number>) {
  return Object.entries(manaCurve).map(([cmc, count]) => ({
    cmc: cmc === '7' ? '7+' : cmc,
    count,
    cmcNum: parseInt(cmc),
  }));
}

/**
 * Get chart data for color distribution
 * @param colorDistribution - Color distribution record
 * @returns Array formatted for Recharts with percentages
 */
export function getColorDistributionData(colorDistribution: Record<string, number>) {
  const total = Object.values(colorDistribution).reduce((a, b) => a + b, 0);
  
  return Object.entries(colorDistribution)
    .filter(([, count]) => count > 0)
    .map(([color, count]) => ({
      color,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      fill: MAGIC_COLOR_HEX[color] || MAGIC_COLOR_HEX.Colorless,
    }));
}

/**
 * Get chart data for type distribution
 * @param typeDistribution - Type distribution record
 * @returns Array formatted for Recharts with percentages
 */
export function getTypeDistributionData(typeDistribution: Record<string, number>) {
  const total = Object.values(typeDistribution).reduce((a, b) => a + b, 0);
  
  // Type colors for charts
  const typeColors: Record<string, string> = {
    creature: '#8B5CF6',
    instant: '#3B82F6',
    sorcery: '#EF4444',
    enchantment: '#F59E0B',
    artifact: '#6B7280',
    planeswalker: '#EC4899',
    land: '#10B981',
  };

  return Object.entries(typeDistribution)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({
      type: type.charAt(0).toUpperCase() + type.slice(1),
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      fill: typeColors[type] || '#6B7280',
    }));
}

/**
 * Mana Curve Analysis
 * 
 * Provides mana curve analysis, visualization data, and recommendations
 * for deck optimization.
 */

import type { DeckCard } from '@/app/actions';
import { ArchetypeCategory } from './meta';

export interface ManaCurvePoint {
  cmc: number;
  count: number;
}

export interface DeckManaCurve {
  points: ManaCurvePoint[];
  totalCards: number;
  lands: number;
  nonLands: number;
  averageCMC: number;
  curveScore: number;
}

export interface ManaCurveRecommendation {
  type: 'add' | 'remove' | 'adjust';
  cmc: number;
  cardCount: number;
  reason: string;
}

export interface StrategyCurveProfile {
  archetype: string;
  idealDistribution: ManaCurvePoint[];
  minAverageCMC: number;
  maxAverageCMC: number;
  peakCMC: number[];
  description: string;
}

// Strategy-specific ideal mana curves
export const STRATEGY_CURVES: Record<string, StrategyCurveProfile> = {
  aggro: {
    archetype: 'aggro',
    idealDistribution: [
      { cmc: 0, count: 0 }, // Lands handled separately
      { cmc: 1, count: 8 },
      { cmc: 2, count: 6 },
      { cmc: 3, count: 3 },
      { cmc: 4, count: 1 },
      { cmc: 5, count: 0 },
      { cmc: 6, count: 0 },
      { cmc: 7, count: 0 },
    ],
    minAverageCMC: 0,
    maxAverageCMC: 2.5,
    peakCMC: [1, 2],
    description: 'Aggro decks want low curves with threats at 1-2 mana',
  },
  midrange: {
    archetype: 'midrange',
    idealDistribution: [
      { cmc: 0, count: 0 },
      { cmc: 1, count: 4 },
      { cmc: 2, count: 6 },
      { cmc: 3, count: 5 },
      { cmc: 4, count: 3 },
      { cmc: 5, count: 2 },
      { cmc: 6, count: 1 },
      { cmc: 7, count: 1 },
    ],
    minAverageCMC: 2.5,
    maxAverageCMC: 4.0,
    peakCMC: [2, 3],
    description: 'Midrange decks balance early plays with powerful top-end',
  },
  control: {
    archetype: 'control',
    idealDistribution: [
      { cmc: 0, count: 0 },
      { cmc: 1, count: 2 },
      { cmc: 2, count: 4 },
      { cmc: 3, count: 4 },
      { cmc: 4, count: 5 },
      { cmc: 5, count: 4 },
      { cmc: 6, count: 3 },
      { cmc: 7, count: 2 },
    ],
    minAverageCMC: 4.0,
    maxAverageCMC: 6.0,
    peakCMC: [4, 5, 6],
    description: 'Control decks want to win late with expensive spells',
  },
  combo: {
    archetype: 'combo',
    idealDistribution: [
      { cmc: 0, count: 0 },
      { cmc: 1, count: 4 },
      { cmc: 2, count: 5 },
      { cmc: 3, count: 3 },
      { cmc: 4, count: 2 },
      { cmc: 5, count: 2 },
      { cmc: 6, count: 2 },
      { cmc: 7, count: 2 },
    ],
    minAverageCMC: 2.0,
    maxAverageCMC: 4.0,
    peakCMC: [1, 2],
    description: 'Combo decks need fast mana to execute their combo',
  },
};

/**
 * Analyze a deck's mana curve
 */
export function analyzeDeckManaCurve(deck: DeckCard[]): DeckManaCurve {
  // Calculate CMC distribution
  const cmcCounts = new Map<number, number>();
  let lands = 0;
  let totalCMC = 0;
  let nonLandsCount = 0;

  for (const card of deck) {
    const cmc = card.cmc ?? 0;
    const quantity = card.count ?? 1;
    
    // Count lands (type line contains "Land")
    const isLand = card.type_line?.toLowerCase().includes('land') ?? false;
    
    if (isLand) {
      lands += quantity;
    } else {
      const current = cmcCounts.get(cmc) || 0;
      cmcCounts.set(cmc, current + quantity);
      totalCMC += quantity * cmc;
      nonLandsCount += quantity;
    }
  }

  // Build curve points (0-7+)
  const points: ManaCurvePoint[] = [];
  for (let cmc = 0; cmc <= 7; cmc++) {
    points.push({
      cmc,
      count: cmcCounts.get(cmc) || 0,
    });
  }

  // Calculate average CMC
  const averageCMC = nonLandsCount > 0 ? totalCMC / nonLandsCount : 0;

  // Calculate curve score (how well it matches ideal distribution)
  const curveScore = calculateCurveScore(points, determineStrategy(averageCMC));

  return {
    points,
    totalCards: deck.reduce((sum, c) => sum + (c.count ?? 1), 0),
    lands,
    nonLands: nonLandsCount,
    averageCMC,
    curveScore,
  };
}

/**
 * Determine deck strategy based on average CMC
 */
export function determineStrategy(averageCMC: number): string {
  if (averageCMC < 2.5) return 'aggro';
  if (averageCMC < 4.0) return 'midrange';
  return 'control';
}

/**
 * Get strategy profile for a given archetype
 */
export function getStrategyProfile(archetype: string): StrategyCurveProfile {
  // Normalize archetype to strategy type
  const normalized = archetype.toLowerCase();
  
  if (normalized.includes('aggro') || normalized.includes('burn') || normalized.includes('zoo')) {
    return STRATEGY_CURVES.aggro;
  }
  if (normalized.includes('control') || normalized.includes('prison') || normalized.includes('draw')) {
    return STRATEGY_CURVES.control;
  }
  if (normalized.includes('combo') || normalized.includes('twin') || normalized.includes('storm')) {
    return STRATEGY_CURVES.combo;
  }
  if (normalized.includes('midrange') || normalized.includes('tempo') || normalized.includes('value')) {
    return STRATEGY_CURVES.midrange;
  }

  // Default to midrange
  return STRATEGY_CURVES.midrange;
}

/**
 * Calculate how well the deck's curve matches the ideal
 */
function calculateCurveScore(points: ManaCurvePoint[], strategy: string): number {
  const profile = STRATEGY_CURVES[strategy];
  if (!profile) return 50;

  let score = 100;
  const nonLandPoints = points.filter(p => p.cmc > 0);
  const totalNonLands = nonLandPoints.reduce((sum, p) => sum + p.count, 0);

  if (totalNonLands === 0) return 0;

  for (const point of nonLandPoints) {
    const ideal = profile.idealDistribution.find(p => p.cmc === point.cmc);
    if (ideal) {
      const idealPercent = (ideal.count / 20) * 100; // Normalize to 20 cards
      const actualPercent = (point.count / totalNonLands) * 100;
      const diff = Math.abs(idealPercent - actualPercent);
      score -= diff * 0.5; // Penalty for deviation
    }
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Get mana curve recommendations based on current deck
 */
export function getManaCurveRecommendations(
  deckCurve: DeckManaCurve,
  archetype?: string
): ManaCurveRecommendation[] {
  const profile = archetype ? getStrategyProfile(archetype) : STRATEGY_CURVES[determineStrategy(deckCurve.averageCMC)];
  const recommendations: ManaCurveRecommendation[] = [];

  // Calculate total non-land cards
  const totalNonLands = deckCurve.nonLands;

  if (totalNonLands === 0) return recommendations;

  // Check for each CMC
  for (const point of deckCurve.points) {
    if (point.cmc === 0) continue; // Skip lands

    const ideal = profile.idealDistribution.find(p => p.cmc === point.cmc);
    if (!ideal) continue;

    const idealCount = Math.round((ideal.count / 20) * totalNonLands);
    const diff = point.count - idealCount;

    if (Math.abs(diff) >= 2) {
      if (diff > 0) {
        recommendations.push({
          type: 'remove',
          cmc: point.cmc,
          cardCount: diff,
          reason: `Too many ${point.cmc}-drops. Consider removing ${diff}.`,
        });
      } else {
        recommendations.push({
          type: 'add',
          cmc: point.cmc,
          cardCount: Math.abs(diff),
          reason: `Need more ${point.cmc}-drops. Consider adding ${Math.abs(diff)}.`,
        });
      }
    }
  }

  // Sort by CMC
  return recommendations.sort((a, b) => a.cmc - b.cmc);
}

/**
 * Get land count recommendations based on deck curve and strategy
 */
export function getLandCountRecommendations(
  deckCurve: DeckManaCurve,
  archetype?: string
): { min: number; max: number; recommended: number; reasoning: string } {
  const strategy = archetype ? getStrategyProfile(archetype) : STRATEGY_CURVES[determineStrategy(deckCurve.averageCMC)];
  const totalCards = deckCurve.totalCards;
  const avgCMC = deckCurve.averageCMC;

  // Base land count formula based on average CMC
  let recommendedLands: number;
  let reasoning: string;

  if (avgCMC < 2.0) {
    recommendedLands = Math.min(20, Math.floor(totalCards * 0.20));
    reasoning = 'Low curve aggro deck - fewer lands needed';
  } else if (avgCMC < 3.0) {
    recommendedLands = Math.floor(totalCards * 0.23);
    reasoning = 'Aggro-midrange hybrid - standard land count';
  } else if (avgCMC < 4.0) {
    recommendedLands = Math.floor(totalCards * 0.25);
    reasoning = 'Midrange deck - more lands for bigger spells';
  } else {
    recommendedLands = Math.min(30, Math.floor(totalCards * 0.28));
    reasoning = 'Control deck - need lands to cast expensive spells';
  }

  // Adjust based on strategy profile
  if (strategy.archetype === 'aggro') {
    recommendedLands = Math.min(20, recommendedLands);
  } else if (strategy.archetype === 'control') {
    recommendedLands = Math.max(24, recommendedLands);
  }

  // Add variance
  const min = Math.max(17, recommendedLands - 2);
  const max = Math.min(35, recommendedLands + 2);

  return {
    min,
    max,
    recommended: recommendedLands,
    reasoning,
  };
}

/**
 * Get color mana requirements analysis
 */
export function getColorManaRequirements(deck: DeckCard[]): {
  color: string;
  required: number;
  current: number;
  notes: string;
}[] {
  // Simplified color analysis based on card mana costs
  const colorRequirements: Map<string, { total: number; notes: string[] }> = new Map([
    ['White', { total: 0, notes: [] }],
    ['Blue', { total: 0, notes: [] }],
    ['Black', { total: 0, notes: [] }],
    ['Red', { total: 0, notes: [] }],
    ['Green', { total: 0, notes: [] }],
  ]);

  for (const card of deck) {
    const manaCost = card.mana_cost || '';
    const typeLine = card.type_line || '';

    // Skip lands
    if (typeLine.toLowerCase().includes('land')) continue;

    // Count colored mana symbols
    const whiteMatch = manaCost.match(/\{W\}/gi);
    const blueMatch = manaCost.match(/\{U\}/gi);
    const blackMatch = manaCost.match(/\{B\}/gi);
    const redMatch = manaCost.match(/\{R\}/gi);
    const greenMatch = manaCost.match(/\{G\}/gi);

    if (whiteMatch) {
      const req = colorRequirements.get('White')!;
      req.total += whiteMatch.length * (card.count ?? 1);
      if (whiteMatch.length >= 2) req.notes.push(`${card.name} requires ${whiteMatch.length} white`);
    }
    if (blueMatch) {
      const req = colorRequirements.get('Blue')!;
      req.total += blueMatch.length * (card.count ?? 1);
      if (blueMatch.length >= 2) req.notes.push(`${card.name} requires ${blueMatch.length} blue`);
    }
    if (blackMatch) {
      const req = colorRequirements.get('Black')!;
      req.total += blackMatch.length * (card.count ?? 1);
      if (blackMatch.length >= 2) req.notes.push(`${card.name} requires ${blackMatch.length} black`);
    }
    if (redMatch) {
      const req = colorRequirements.get('Red')!;
      req.total += redMatch.length * (card.count ?? 1);
      if (redMatch.length >= 2) req.notes.push(`${card.name} requires ${redMatch.length} red`);
    }
    if (greenMatch) {
      const req = colorRequirements.get('Green')!;
      req.total += greenMatch.length * (card.count ?? 1);
      if (greenMatch.length >= 2) req.notes.push(`${card.name} requires ${greenMatch.length} green`);
    }
  }

  // Convert to result format
  const results: { color: string; required: number; current: number; notes: string }[] = [];
  
  for (const [color, data] of colorRequirements) {
    if (data.total > 0) {
      // Rule of thumb: need roughly 1/3 of total mana sources for each pip
      const requiredSources = Math.ceil(data.total / 3);
      results.push({
        color,
        required: requiredSources,
        current: 0, // Would need to analyze mana base
        notes: data.notes.slice(0, 3).join('; ') || `${data.total} total pip${data.total > 1 ? 's' : ''} required`,
      });
    }
  }

  return results;
}

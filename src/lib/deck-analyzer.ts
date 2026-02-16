/**
 * @fileOverview Client-side deck analysis module
 * 
 * This module provides offline deck analysis using rule-based heuristics
 * instead of AI API calls. Works entirely client-side for offline support.
 */

import type { ScryfallCard, DeckCard } from '@/app/actions';

// Analysis categories
export interface DeckAnalysis {
  overallRating: number; // 1-10 scale
  manaCurve: ManaCurveAnalysis;
  colorDistribution: ColorDistribution;
  cardTypeDistribution: CardTypeDistribution;
  removalAnalysis: RemovalAnalysis;
  rampAnalysis: RampAnalysis;
  synergyAnalysis: SynergyAnalysis;
  suggestions: DeckSuggestion[];
}

export interface ManaCurveAnalysis {
  curve: { [cmc: number]: number };
  averageCMC: number;
  rating: number; // 1-10
  issues: string[];
}

export interface ColorDistribution {
  colors: { [color: string]: number };
  colorCount: number;
  rating: number;
  issues: string[];
}

export interface CardTypeDistribution {
  creatures: number;
  spells: number;
  lands: number;
  artifacts: number;
  enchantments: number;
  planeswalkers: number;
  rating: number;
  issues: string[];
}

export interface RemovalAnalysis {
  count: number;
  types: { [type: string]: number };
  rating: number;
  issues: string[];
}

export interface RampAnalysis {
  count: number;
  rating: number;
  issues: string[];
}

export interface SynergyAnalysis {
  pairs: Array<{ cards: string[]; description: string }>;
  rating: number;
  issues: string[];
}

export interface DeckSuggestion {
  category: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
}

// Card classification helpers
const COLOR_KEYWORDS: Record<string, string[]> = {
  'White': ['white', 'W', 'lifelink', 'lifetime', 'exalted'],
  'Blue': ['blue', 'U', 'flying', 'countermagic', 'draw'],
  'Black': ['black', 'B', 'deathtouch', 'drain', 'sacrifice'],
  'Red': ['red', 'R', 'haste', 'burn', 'damage'],
  'Green': ['green', 'G', 'trample', 'reach', 'growth'],
};

const RAMP_KEYWORDS = ['ramp', 'mana', 'rock', 'dork', 'cultivate', 'kodama', 'farseek', 'farseek', 'sol ring', 'arcane signet', 'darksteel ingot'];
const REMOVAL_KEYWORDS = ['destroy', 'exile', 'damage', 'fight', 'kill', 'remove', 'counter', 'destroy target', 'exile target'];
const CREATURE_KEYWORDS = ['creature', 'token'];
const SPELL_KEYWORDS = ['instant', 'sorcery'];
const ARTIFACT_KEYWORDS = ['artifact'];
const ENCHANTMENT_KEYWORDS = ['enchantment'];
const PLANESWALKER_KEYWORDS = ['planeswalker'];

export function analyzeDeck(cards: DeckCard[], format: string = 'commander'): DeckAnalysis {
  const allCards = flattenDeck(cards);
  
  const manaCurve = analyzeManaCurve(allCards);
  const colorDistribution = analyzeColors(allCards);
  const cardTypeDistribution = analyzeCardTypes(allCards);
  const removalAnalysis = analyzeRemoval(allCards);
  const rampAnalysis = analyzeRamp(allCards);
  const synergyAnalysis = analyzeSynergies(allCards);
  
  const overallRating = calculateOverallRating({
    manaCurve,
    colorDistribution,
    cardTypeDistribution,
    removalAnalysis,
    rampAnalysis,
    synergyAnalysis,
  });
  
  const suggestions = generateSuggestions({
    manaCurve,
    colorDistribution,
    cardTypeDistribution,
    removalAnalysis,
    rampAnalysis,
    synergyAnalysis,
  });
  
  return {
    overallRating,
    manaCurve,
    colorDistribution,
    cardTypeDistribution,
    removalAnalysis,
    rampAnalysis,
    synergyAnalysis,
    suggestions,
  };
}

function flattenDeck(cards: DeckCard[]): ScryfallCard[] {
  const flattened: ScryfallCard[] = [];
  for (const card of cards) {
    for (let i = 0; i < card.count; i++) {
      flattened.push(card);
    }
  }
  return flattened;
}

function analyzeManaCurve(cards: ScryfallCard[]): ManaCurveAnalysis {
  const curve: { [cmc: number]: number } = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0 };
  let totalCMC = 0;
  let nonLandCount = 0;
  
  for (const card of cards) {
    if (card.type_line && (card.type_line.includes('Land') || card.type_line.includes('land'))) {
      curve[0]++;
      continue;
    }
    
    const cmc = card.cmc ?? 0;
    const bucket = Math.min(Math.floor(cmc), 8);
    curve[bucket]++;
    totalCMC += cmc;
    nonLandCount++;
  }
  
  const averageCMC = nonLandCount > 0 ? totalCMC / nonLandCount : 0;
  
  const issues: string[] = [];
  let rating = 7;
  
  // Check for too many high CMC cards
  const highCmcCount = (curve[6] || 0) + (curve[7] || 0) + (curve[8] || 0);
  if (highCmcCount > 15) {
    issues.push('Too many high mana cost cards (6+). Consider adding more early game.');
    rating -= 2;
  }
  
  // Check for too few early game
  const earlyGame = (curve[1] || 0) + (curve[2] || 0) + (curve[3] || 0);
  if (earlyGame < 10) {
    issues.push('Not enough early game plays (1-3 mana). Add more cheap spells or creatures.');
    rating -= 2;
  }
  
  // Check for proper land count (approx 33-40% for commander)
  const landCount = curve[0];
  if (landCount < 30) {
    issues.push('Consider adding more lands (aim for 35-40).');
    rating -= 1;
  } else if (landCount > 45) {
    issues.push('Too many lands. Consider cutting some for more action spells.');
    rating -= 1;
  }
  
  rating = Math.max(1, Math.min(10, rating));
  
  return { curve, averageCMC, rating: Math.round(rating), issues };
}

function analyzeColors(cards: ScryfallCard[]): ColorDistribution {
  const colors: { [color: string]: number } = { W: 0, U: 0, B: 0, R: 0, G: 0, Colorless: 0 };
  const colorNames: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', Colorless: 'Colorless' };
  
  for (const card of cards) {
    if (!card.colors || card.colors.length === 0) {
      colors.Colorless++;
      continue;
    }
    
    for (const color of card.colors) {
      colors[color]++;
    }
  }
  
  const colorCount = Object.entries(colors).filter(([k, v]) => k !== 'Colorless' && v > 0).length;
  
  const issues: string[] = [];
  let rating = 7;
  
  // Check for color balance
  const colorEntries = Object.entries(colors).filter(([k]) => k !== 'Colorless');
  const maxCount = Math.max(...colorEntries.map(([, v]) => v));
  const minCount = Math.min(...colorEntries.filter(([, v]) => v > 0).map(([, v]) => v) || [0]);
  
  if (colorCount > 1 && maxCount > minCount * 3) {
    issues.push('Color distribution is very uneven. Consider adding more support for weaker colors.');
    rating -= 2;
  }
  
  // Check for greedy mana base (too many colors)
  if (colorCount > 3) {
    issues.push('Managing 4+ colors may cause mana issues. Consider a more focused color identity.');
    rating -= 1;
  }
  
  // Check for no color
  if (colorCount === 0) {
    issues.push('Colorless deck - consider adding colored mana sources.');
    rating -= 1;
  }
  
  rating = Math.max(1, Math.min(10, rating));
  
  return { colors, colorCount, rating: Math.round(rating), issues };
}

function analyzeCardTypes(cards: ScryfallCard[]): CardTypeDistribution {
  let creatures = 0, spells = 0, lands = 0, artifacts = 0, enchantments = 0, planeswalkers = 0;
  
  for (const card of cards) {
    const type = card.type_line?.toLowerCase() || '';
    
    if (type.includes('creature')) creatures++;
    else if (type.includes('land')) lands++;
    else if (type.includes('artifact')) artifacts++;
    else if (type.includes('enchantment')) enchantments++;
    else if (type.includes('planeswalker')) planeswalkers++;
    else if (type.includes('instant') || type.includes('sorcery')) spells++;
  }
  
  const total = creatures + spells + lands + artifacts + enchantments + planeswalkers;
  const issues: string[] = [];
  let rating = 7;
  
  // Commander recommendations
  const creatureRatio = creatures / total;
  const landRatio = lands / total;
  
  if (creatureRatio < 0.15) {
    issues.push('Too few creatures. Add more creatures for board presence.');
    rating -= 2;
  } else if (creatureRatio > 0.5) {
    issues.push('Too many creatures. Add more spells for versatility.');
    rating -= 1;
  }
  
  if (landRatio < 0.25) {
    issues.push('Not enough lands.');
    rating -= 2;
  } else if (landRatio > 0.45) {
    issues.push('Too many lands. Cut some for action spells.');
    rating -= 2;
  }
  
  rating = Math.max(1, Math.min(10, rating));
  
  return {
    creatures, spells, lands, artifacts, enchantments, planeswalkers,
    rating: Math.round(rating),
    issues
  };
}

function analyzeRemoval(cards: ScryfallCard[]): RemovalAnalysis {
  const types: { [type: string]: number } = { destruction: 0, exile: 0, damage: 0, counterspell: 0 };
  let count = 0;
  
  for (const card of cards) {
    const text = card.oracle_text?.toLowerCase() || '';
    const type = card.type_line?.toLowerCase() || '';
    
    // Skip creatures for removal analysis (they have these keywords but they're not removal)
    if (type.includes('creature') && !type.includes('instant') && !type.includes('sorcery')) {
      continue;
    }
    
    let isRemoval = false;
    
    if (text.includes('destroy target')) {
      types.destruction++;
      isRemoval = true;
    }
    if (text.includes('exile target')) {
      types.exile++;
      isRemoval = true;
    }
    if (text.includes('deals damage') || text.includes('damage to')) {
      types.damage++;
      isRemoval = true;
    }
    if (text.includes('counter target')) {
      types.counterspell++;
      isRemoval = true;
    }
    
    if (isRemoval) count++;
  }
  
  const issues: string[] = [];
  let rating = 7;
  
  if (count < 8) {
    issues.push('Not enough removal. Add more answers to opponent threats.');
    rating -= 2;
  } else if (count < 12) {
    issues.push('Consider adding more removal for better threat coverage.');
    rating -= 1;
  }
  
  // Check for variety
  const typeCount = Object.values(types).filter(v => v > 0).length;
  if (typeCount < 2 && count > 5) {
    issues.push('Your removal lacks variety. Mix destruction, exile, and counters.');
    rating -= 1;
  }
  
  rating = Math.max(1, Math.min(10, rating));
  
  return { count, types, rating: Math.round(rating), issues };
}

function analyzeRamp(cards: ScryfallCard[]): RampAnalysis {
  let count = 0;
  
  for (const card of cards) {
    const name = card.name?.toLowerCase() || '';
    const type = card.type_line?.toLowerCase() || '';
    const text = card.oracle_text?.toLowerCase() || '';
    
    // Common ramp cards
    const isRamp = (
      name.includes('sol ring') ||
      name.includes('signet') ||
      name.includes('tome') ||
      name.includes('crypt') ||
      name.includes('vault') ||
      name.includes('mana rock') ||
      name.includes('mana dork') ||
      name.includes('cultivate') ||
      name.includes('kodama') ||
      name.includes('rampant growth') ||
      name.includes('birds of paradise') ||
      name.includes('llanowar') ||
      (text.includes('add') && text.includes('mana') && (text.includes('color') || type.includes('artifact'))) ||
      (type.includes('land') && (text.includes('search') || text.includes('put onto the battlefield')))
    );
    
    if (isRamp) count++;
  }
  
  const issues: string[] = [];
  let rating = 7;
  
  if (count < 8) {
    issues.push('Not enough ramp. Add mana rocks and acceleration.');
    rating -= 3;
  } else if (count < 12) {
    issues.push('Consider adding more ramp for faster starts.');
    rating -= 1;
  }
  
  if (count > 20) {
    issues.push('Too much ramp. Add more threats and finishers.');
    rating -= 1;
  }
  
  rating = Math.max(1, Math.min(10, rating));
  
  return { count, rating: Math.round(rating), issues };
}

function analyzeSynergies(cards: ScryfallCard[]): SynergyAnalysis {
  const pairs: Array<{ cards: string[]; description: string }> = [];
  
  // Check for common synergy pairs
  const cardNames = cards.map(c => c.name.toLowerCase());
  
  // Token synergies
  if (cardNames.some(n => n.includes('sorin') || n.includes('vraska') || n.includes('sarkhan'))) {
    if (cardNames.some(n => n.includes('vampire') || n.includes('spirit') || n.includes('zombie'))) {
      pairs.push({ cards: ['Planeswalker', 'Token creatures'], description: 'Planeswalker + token generation' });
    }
  }
  
  // +1/+1 counters synergies
  if (cardNames.some(n => n.includes('counter') || n.includes('proliferate'))) {
    if (cardNames.some(n => n.includes('phyrexian') || n.includes('mikaeus'))) {
      pairs.push({ cards: ['Counter manipulation', '+1/+1 synergy'], description: '+1/+1 counter synergies' });
    }
  }
  
  // Draw/Discard synergies
  if (cardNames.some(n => n.includes('wheel') || n.includes('notion') || n.includes('rhystic')))) {
    if (cardNames.some(n => n.includes('lobotomy') || n.includes('thought'))) {
      pairs.push({ cards: ['Wheel effects', 'Discard'], description: 'Wheel + discard synergies' });
    }
  }
  
  const rating = Math.min(10, 5 + pairs.length * 1.5);
  const issues = pairs.length === 0 ? ['No obvious synergies detected. Consider adding cards that work well together.'] : [];
  
  return { pairs, rating: Math.round(rating), issues };
}

function calculateOverallRating(analyses: {
  manaCurve: ManaCurveAnalysis;
  colorDistribution: ColorDistribution;
  cardTypeDistribution: CardTypeDistribution;
  removalAnalysis: RemovalAnalysis;
  rampAnalysis: RampAnalysis;
  synergyAnalysis: SynergyAnalysis;
}): number {
  const weights = {
    manaCurve: 0.2,
    colorDistribution: 0.15,
    cardTypeDistribution: 0.2,
    removalAnalysis: 0.2,
    rampAnalysis: 0.15,
    synergyAnalysis: 0.1,
  };
  
  const rating = 
    analyses.manaCurve.rating * weights.manaCurve +
    analyses.colorDistribution.rating * weights.colorDistribution +
    analyses.cardTypeDistribution.rating * weights.cardTypeDistribution +
    analyses.removalAnalysis.rating * weights.removalAnalysis +
    analyses.rampAnalysis.rating * weights.rampAnalysis +
    analyses.synergyAnalysis.rating * weights.synergyAnalysis;
  
  return Math.round(rating * 10) / 10;
}

function generateSuggestions(analyses: {
  manaCurve: ManaCurveAnalysis;
  colorDistribution: ColorDistribution;
  cardTypeDistribution: CardTypeDistribution;
  removalAnalysis: RemovalAnalysis;
  rampAnalysis: RampAnalysis;
  synergyAnalysis: SynergyAnalysis;
}): DeckSuggestion[] {
  const suggestions: DeckSuggestion[] = [];
  
  // High priority
  if (analyses.rampAnalysis.rating < 5) {
    suggestions.push({
      category: 'Ramp',
      priority: 'high',
      title: 'Add More Ramp',
      description: 'Your deck needs more mana acceleration. Add cards like Sol Ring, Arcane Signet, and Cultivate.',
    });
  }
  
  if (analyses.removalAnalysis.rating < 5) {
    suggestions.push({
      category: 'Removal',
      priority: 'high',
      title: 'Add More Removal',
      description: 'Your deck needs more answers to threats. Add cards like Swords to Plowshares, Counterspell, or Path to Exile.',
    });
  }
  
  // Medium priority
  if (analyses.manaCurve.rating < 5) {
    suggestions.push({
      category: 'Mana Curve',
      priority: 'medium',
      title: 'Adjust Mana Curve',
      description: 'Your mana curve needs work. Reduce high CMC cards and add more early game plays.',
    });
  }
  
  if (analyses.colorDistribution.rating < 5) {
    suggestions.push({
      category: 'Colors',
      priority: 'medium',
      title: 'Improve Color Balance',
      description: 'Your color distribution is uneven. Add more dual lands or fix for your weaker colors.',
    });
  }
  
  if (analyses.cardTypeDistribution.rating < 5) {
    const types = analyses.cardTypeDistribution;
    if (types.creatures < 10) {
      suggestions.push({
        category: 'Creatures',
        priority: 'medium',
        title: 'Add More Creatures',
        description: 'Your deck needs more creatures for board presence and pressure.',
      });
    }
  }
  
  // Low priority
  if (analyses.synergyAnalysis.rating < 5) {
    suggestions.push({
      category: 'Synergy',
      priority: 'low',
      title: 'Add Synergistic Cards',
      description: 'Look for cards that work well together to create more powerful combinations.',
    });
  }
  
  return suggestions.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

// Export a summary function for quick overview
export function getDeckSummary(cards: DeckCard[], format: string = 'commander'): string {
  const analysis = analyzeDeck(cards, format);
  
  return `Deck Rating: ${analysis.overallRating}/10

Mana Curve: ${analysis.manaCurve.rating}/10 (avg ${analysis.manaCurve.averageCMC.toFixed(1)} CMC)
Colors: ${analysis.colorDistribution.colorCount} (${analysis.colorDistribution.rating}/10)
Card Types: ${analysis.cardTypeDistribution.rating}/10
Removal: ${analysis.removalAnalysis.count} cards (${analysis.removalAnalysis.rating}/10)
Ramp: ${analysis.rampAnalysis.count} cards (${analysis.rampAnalysis.rating}/10)
Synergies: ${analysis.synergyAnalysis.rating}/10

Top Suggestions:
${analysis.suggestions.slice(0, 3).map(s => `- ${s.title}: ${s.description}`).join('\n')}`;
}

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
  /** Format used for the optimal-curve comparison. */
  format?: DeckFormat;
  /** Per-bucket gaps vs. the format-optimal curve (excludes lands). */
  gaps?: ManaCurveGap[];
  /** Land-count gap vs. the format-optimal curve, if outside the band. */
  landGap?: ManaCurveGap | null;
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

// ============================================
// FORMAT-AWARE MANA CURVE OPTIMIZATION
// ============================================

/**
 * Formats with distinct optimal mana curves.
 * Commander runs 99 cards + a commander; Standard/Modern run 60-card decks.
 */
export type DeckFormat = 'commander' | 'standard' | 'modern';

/**
 * Target range for a single CMC bucket (or land count).
 * `target` is the ideal count; `min`/`max` define the acceptable band.
 */
export interface CmcTarget {
  min: number;
  target: number;
  max: number;
}

/**
 * Optimal mana curve profile for a given format.
 * `buckets` keys are CMC values 1..7 (where 7 represents 7+).
 */
export interface OptimalManaCurve {
  buckets: Record<number, CmcTarget>;
  lands: CmcTarget;
  description: string;
  tips: string[];
}

/**
 * Optimal mana curves per format. Counts reflect non-land spells and assume
 * a deck built close to the format's minimum size.
 *
 * - Commander (99 cards): higher curve, relies on ramp to cast expensive spells.
 * - Standard (60 cards): a balanced midrange-leaning curve.
 * - Modern (60 cards): slightly lower, faster curve than Standard.
 */
export const OPTIMAL_MANA_CURVES: Record<DeckFormat, OptimalManaCurve> = {
  commander: {
    buckets: {
      1: { min: 4, target: 6, max: 8 },
      2: { min: 7, target: 9, max: 12 },
      3: { min: 7, target: 9, max: 12 },
      4: { min: 5, target: 7, max: 9 },
      5: { min: 4, target: 6, max: 8 },
      6: { min: 3, target: 5, max: 7 },
      7: { min: 5, target: 8, max: 12 },
    },
    lands: { min: 35, target: 38, max: 42 },
    description: 'Commander curves run higher because longer games and ramp support expensive spells.',
    tips: [
      'Aim for ~38 lands; cut a land only with abundant ramp (10+ ramp sources).',
      'Front-load 2- and 3-drops so you always have an early play.',
      'Keep a healthy 7+ top-end — ramp makes expensive spells castable.',
      'Include 8-12 ramp sources to bridge into your higher CMC cards.',
    ],
  },
  standard: {
    buckets: {
      1: { min: 4, target: 7, max: 10 },
      2: { min: 5, target: 8, max: 11 },
      3: { min: 4, target: 6, max: 8 },
      4: { min: 2, target: 4, max: 6 },
      5: { min: 1, target: 3, max: 5 },
      6: { min: 0, target: 1, max: 3 },
      7: { min: 0, target: 1, max: 2 },
    },
    lands: { min: 22, target: 25, max: 28 },
    description: 'Standard decks want a smooth curve peaking at 2 drops with a tapering top end.',
    tips: [
      'Run ~24-25 lands for consistent early drops.',
      'Peak your non-land count at 2-drops for tempo.',
      'Limit 6+ drops unless you have ramp or a controlling game plan.',
      'Match your curve to your archetype: aggro stays low, control runs higher.',
    ],
  },
  modern: {
    buckets: {
      1: { min: 6, target: 9, max: 12 },
      2: { min: 6, target: 8, max: 11 },
      3: { min: 3, target: 5, max: 7 },
      4: { min: 1, target: 3, max: 5 },
      5: { min: 0, target: 2, max: 4 },
      6: { min: 0, target: 1, max: 2 },
      7: { min: 0, target: 1, max: 2 },
    },
    lands: { min: 20, target: 23, max: 26 },
    description: 'Modern is faster than Standard — prioritize efficient 1- and 2-drops.',
    tips: [
      'Run ~22-24 lands; lean lower for aggro, higher for control.',
      'Modern rewards efficient 1-drops — aim for 8+.',
      'Keep your curve low to race fast opponents.',
      'Justify every 4+ drop with immediate board impact.',
    ],
  },
};

/**
 * A single gap between the current deck and the optimal curve for one CMC bucket.
 * `difference = target - current` (positive means add cards, negative means cut).
 */
export interface ManaCurveGap {
  cmc: number;
  label: string;
  current: number;
  target: number;
  difference: number;
  severity: 'low' | 'medium' | 'high';
}

/**
 * Result of comparing a deck against its format-optimal mana curve.
 */
export interface ManaCurveComparison {
  format: DeckFormat;
  gaps: ManaCurveGap[];
  landGap: ManaCurveGap | null;
  totalGap: number;
}

const DROP_LABELS: Record<number, string> = {
  1: '1-drop',
  2: '2-drop',
  3: '3-drop',
  4: '4-drop',
  5: '5-drop',
  6: '6-drop',
  7: '7+-drop',
};

/**
 * Normalize an arbitrary format string (including legacy game-mode IDs such as
 * "constructed-core") to one of the supported DeckFormat values.
 */
export function normalizeDeckFormat(format: string | undefined | null): DeckFormat {
  const f = (format || '').toLowerCase();
  if (f.includes('commander')) return 'commander';
  if (f.includes('modern') || f.includes('extended')) return 'modern';
  if (f.includes('standard') || f.includes('core') || f.includes('pioneer') || f.includes('constructed')) {
    return 'standard';
  }
  return 'commander';
}

/**
 * Format-specific guidance tips for the mana curve tip panel.
 */
export function getManaCurveTips(format: DeckFormat | string = 'commander'): string[] {
  const normalized = normalizeDeckFormat(typeof format === 'string' ? format : 'commander');
  return OPTIMAL_MANA_CURVES[normalized].tips;
}

function gapSeverity(difference: number, target: number): 'low' | 'medium' | 'high' {
  const abs = Math.abs(difference);
  if (abs <= 1) return 'low';
  if (target > 0 && abs >= Math.ceil(target * 0.5)) return 'high';
  if (abs >= 3) return 'high';
  return 'medium';
}

/**
 * Build a bucket-level curve (1..7) of non-land spell counts from raw cards,
 * plus the land count. Bucket 7 aggregates everything at CMC 7 or higher.
 */
function buildCurveBuckets(cards: ScryfallCard[]): {
  buckets: Record<number, number>;
  lands: number;
} {
  const buckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  let lands = 0;

  for (const card of cards) {
    const typeLine = card.type_line || '';
    if (typeLine.toLowerCase().includes('land')) {
      lands++;
      continue;
    }
    const cmc = card.cmc ?? 0;
    const bucket = cmc <= 0 ? 1 : Math.min(Math.floor(cmc), 7);
    if (bucket >= 1) {
      buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
  }

  return { buckets, lands };
}

/**
 * Compare a deck's mana curve against the optimal curve for the given format.
 * Returns specific, actionable gaps per CMC bucket plus the land-count gap.
 */
export function compareToOptimal(deck: DeckCard[], format: DeckFormat | string = 'commander'): ManaCurveComparison {
  const normalized = normalizeDeckFormat(typeof format === 'string' ? format : format);
  const profile = OPTIMAL_MANA_CURVES[normalized];

  // Flatten deck (respecting counts) so multi-copy cards weigh correctly.
  const flattened: ScryfallCard[] = [];
  for (const card of deck) {
    for (let i = 0; i < (card.count || 1); i++) {
      flattened.push(card);
    }
  }

  const { buckets, lands } = buildCurveBuckets(flattened);
  const gaps: ManaCurveGap[] = [];

  for (let cmc = 1; cmc <= 7; cmc++) {
    const target = profile.buckets[cmc];
    if (!target) continue;
    const current = buckets[cmc] || 0;
    const difference = target.target - current;
    // Only surface a gap when the count falls outside the acceptable band.
    if (current < target.min || current > target.max) {
      gaps.push({
        cmc,
        label: DROP_LABELS[cmc] || `${cmc}-drop`,
        current,
        target: target.target,
        difference,
        severity: gapSeverity(difference, target.target),
      });
    }
  }

  const landDifference = profile.lands.target - lands;
  const landGap: ManaCurveGap | null =
    lands < profile.lands.min || lands > profile.lands.max
      ? {
          cmc: 0,
          label: 'lands',
          current: lands,
          target: profile.lands.target,
          difference: landDifference,
          severity: gapSeverity(landDifference, profile.lands.target),
        }
      : null;

  const totalGap = gaps.reduce((sum, g) => sum + Math.abs(g.difference), 0) + (landGap ? Math.abs(landGap.difference) : 0);

  return { format: normalized, gaps, landGap, totalGap };
}

/**
 * Turn a single gap into a human-readable "Add/Cut X more Y-drops" string.
 */
export function describeGap(gap: ManaCurveGap): string {
  const abs = Math.abs(gap.difference);
  if (abs === 0) return `${gap.label} are on target`;
  const action = gap.difference > 0 ? 'Add' : 'Cut';
  const range = abs <= 1 ? `${abs}` : `${Math.max(1, abs - 1)}-${abs}`;
  const direction = gap.difference > 0 ? 'more' : 'fewer';
  return `${action} ${range} ${direction} ${gap.label} (have ${gap.current}, target ~${gap.target}).`;
}

// Card classification helpers (reserved for future use)
// const CREATURE_KEYWORDS = ['creature', 'token'];
// const SPELL_KEYWORDS = ['instant', 'sorcery'];
// const ARTIFACT_KEYWORDS = ['artifact'];
// const ENCHANTMENT_KEYWORDS = ['enchantment'];
// const PLANESWALKER_KEYWORDS = ['planeswalker'];

export function analyzeDeck(cards: DeckCard[], _format: string = 'commander'): DeckAnalysis {
  const allCards = flattenDeck(cards);
  const normalizedFormat = normalizeDeckFormat(_format);

  const manaCurve = analyzeManaCurve(allCards, normalizedFormat);
  const colorDistribution = analyzeColors(allCards);
  const cardTypeDistribution = analyzeCardTypes(allCards);
  const removalAnalysis = analyzeRemoval(allCards);
  const rampAnalysis = analyzeRamp(allCards);
  const synergyAnalysis = analyzeSynergies(allCards);

  // Enrich the mana curve analysis with format-aware gaps.
  const comparison = compareToOptimal(cards, normalizedFormat);
  manaCurve.format = comparison.format;
  manaCurve.gaps = comparison.gaps;
  manaCurve.landGap = comparison.landGap;

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
    deckCards: cards,
    format: normalizedFormat,
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

function analyzeManaCurve(cards: ScryfallCard[], format: DeckFormat = 'commander'): ManaCurveAnalysis {
  const profile = OPTIMAL_MANA_CURVES[format];
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
  const highCmcCap = profile.buckets[6].max + profile.buckets[7].max;
  if (highCmcCount > highCmcCap + 2) {
    issues.push(`Too many high mana cost cards (6+). For ${format}, aim for ~${highCmcCap} spells at 6+ CMC.`);
    rating -= 2;
  }

  // Check for too few early game
  const earlyGame = (curve[1] || 0) + (curve[2] || 0) + (curve[3] || 0);
  const earlyTarget = profile.buckets[1].target + profile.buckets[2].target + profile.buckets[3].target;
  if (earlyGame < earlyTarget - 4) {
    issues.push(`Not enough early game plays (1-3 mana). For ${format}, aim for ~${earlyTarget} cards at 1-3 CMC.`);
    rating -= 2;
  }

  // Check for proper land count using the format-optimal band.
  const landCount = curve[0];
  if (landCount < profile.lands.min) {
    issues.push(`Consider adding more lands (aim for ${profile.lands.min}-${profile.lands.max} in ${format}).`);
    rating -= 1;
  } else if (landCount > profile.lands.max + 3) {
    issues.push('Too many lands. Consider cutting some for more action spells.');
    rating -= 1;
  }

  rating = Math.max(1, Math.min(10, rating));

  return { curve, averageCMC, rating: Math.round(rating), issues };
}

function analyzeColors(cards: ScryfallCard[]): ColorDistribution {
  const colors: { [color: string]: number } = { W: 0, U: 0, B: 0, R: 0, G: 0, Colorless: 0 };
  
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
  if (cardNames.some(n => n.includes('wheel') || n.includes('notion') || n.includes('rhystic'))) {
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
  deckCards?: DeckCard[];
  format?: DeckFormat;
}): DeckSuggestion[] {
  const suggestions: DeckSuggestion[] = [];
  const format = analyses.format ?? 'commander';

  // High priority — specific mana curve gaps ("Add/Cut X more Y-drops").
  const gaps = analyses.manaCurve.gaps ?? [];
  const significantGaps = gaps
    .filter((g) => g.severity !== 'low')
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  for (const gap of significantGaps.slice(0, 3)) {
    const isAdd = gap.difference > 0;
    suggestions.push({
      category: 'Mana Curve',
      priority: gap.severity === 'high' ? 'high' : 'medium',
      title: isAdd ? `Add more ${gap.label}s` : `Cut ${gap.label}s`,
      description: describeGap(gap),
    });
  }

  // Land count gap (specific).
  if (analyses.manaCurve.landGap) {
    const landGap = analyses.manaCurve.landGap;
    const isAdd = landGap.difference > 0;
    suggestions.push({
      category: 'Lands',
      priority: landGap.severity === 'high' ? 'high' : 'medium',
      title: isAdd ? 'Add more lands' : 'Cut some lands',
      description: describeGap(landGap),
    });
  }

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
  if (analyses.manaCurve.rating < 5 && gaps.length === 0) {
    suggestions.push({
      category: 'Mana Curve',
      priority: 'medium',
      title: 'Adjust Mana Curve',
      description: `Your mana curve needs work for ${format}. Reduce high CMC cards and add more early game plays.`,
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

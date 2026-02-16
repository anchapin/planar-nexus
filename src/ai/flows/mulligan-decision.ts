/**
 * @fileOverview Mulligan Decision AI
 *
 * Issue #39: Phase 3.1: Implement mulligan decision logic
 *
 * Provides:
 * - Hand strength evaluation
 * - Keep vs. mulligan threshold
 * - Land/spell ratio analysis
 * - Curve assessment
 * - Format-specific mulligan rules
 */

import type { ScryfallCard } from '@/app/actions';

/**
 * Represents a card in a hand for evaluation
 */
interface HandCard {
  cardData: ScryfallCard;
  manaValue: number;
  isLand: boolean;
  isCreature: boolean;
  isSpell: boolean;
  colors: string[];
  isColorless: boolean;
}

/**
 * Result of mulligan decision
 */
export interface MulliganDecision {
  /** Whether to take a mulligan */
  shouldMulligan: boolean;
  /** Confidence in the decision (0-1) */
  confidence: number;
  /** Reasoning for the decision */
  reasoning: string;
  /** Hand strength score (0-10) */
  handStrength: number;
  /** Analysis of the hand */
  analysis: HandAnalysis;
}

/**
 * Analysis of the hand
 */
export interface HandAnalysis {
  /** Number of lands in hand */
  landCount: number;
  /** Number of spells in hand */
  spellCount: number;
  /** Land-to-spell ratio */
  landSpellRatio: number;
  /** Average mana value of spells */
  averageSpellCost: number;
  /** Mana curve distribution */
  manaCurve: { [cost: number]: number };
  /** Color distribution */
  colorDistribution: { [color: string]: number };
  /** Whether hand has early game plays */
  hasEarlyGamePlay: boolean;
  /** Whether hand has late game threats */
  hasLateGameThreat: boolean;
  /** Whether colors are fixable */
  isColorFixable: boolean;
  /** Risk assessment */
  riskLevel: 'low' | 'medium' | 'high';
  /** Risk explanation */
  riskExplanation: string;
}

/**
 * Format-specific mulligan rules
 */
interface MulliganRules {
  /** Minimum lands for this format */
  minLands: number;
  /** Maximum lands for this format */
  maxLands: number;
  /** Ideal land count */
  idealLands: number;
  /** Minimum spells with mana value <= 2 */
  minEarlyGameCards: number;
  /** Threshold for keep vs mulligan */
  keepThreshold: number;
  /** Additional rules per format */
  specialRules?: {
    /** Whether commander damage matters */
    commanderDamage?: boolean;
    /** Starting life total */
    startingLife?: number;
    /** Whether this is a format where card quality matters more */
    qualityOverQuantity?: boolean;
  };
}

/**
 * Default mulligan rules per format
 */
const FORMAT_RULES: Record<string, MulliganRules> = {
  standard: {
    minLands: 2,
    maxLands: 6,
    idealLands: 3,
    minEarlyGameCards: 2,
    keepThreshold: 5.0,
  },
  modern: {
    minLands: 2,
    maxLands: 6,
    idealLands: 4,
    minEarlyGameCards: 2,
    keepThreshold: 5.0,
  },
  legacy: {
    minLands: 1,
    maxLands: 5,
    idealLands: 3,
    minEarlyGameCards: 2,
    keepThreshold: 5.5,
    specialRules: {
      qualityOverQuantity: true, // In Legacy, card quality matters more
    },
  },
  vintage: {
    minLands: 1,
    maxLands: 5,
    idealLands: 3,
    minEarlyGameCards: 2,
    keepThreshold: 5.5,
    specialRules: {
      qualityOverQuantity: true,
    },
  },
  commander: {
    minLands: 2,
    maxLands: 10,
    idealLands: 3,
    minEarlyGameCards: 1,
    keepThreshold: 4.5,
    specialRules: {
      commanderDamage: true,
      startingLife: 40,
    },
  },
  pauper: {
    minLands: 2,
    maxLands: 6,
    idealLands: 4,
    minEarlyGameCards: 3,
    keepThreshold: 4.5,
  },
  pioneer: {
    minLands: 2,
    maxLands: 6,
    idealLands: 3,
    minEarlyGameCards: 2,
    keepThreshold: 5.0,
  },
};

/**
 * Difficulty level for mulligan decisions
 */
export type MulliganDifficulty = 'conservative' | 'balanced' | 'aggressive';

/**
 * Difficulty modifiers
 */
const DIFFICULTY_MODIFIERS: Record<MulliganDifficulty, { keepThreshold: number; riskTolerance: number }> = {
  conservative: {
    keepThreshold: -0.5, // More likely to keep
    riskTolerance: -0.2,
  },
  balanced: {
    keepThreshold: 0,
    riskTolerance: 0,
  },
  aggressive: {
    keepThreshold: 0.5, // More likely to mulligan
    riskTolerance: 0.2,
  },
};

/**
 * Analyze a hand of cards
 */
export function analyzeHand(
  hand: ScryfallCard[],
  _librarySize: number = 60
): HandAnalysis {
  const handCards: HandCard[] = hand.map(card => parseCardForMulligan(card));

  // Count lands and spells
  const landCount = handCards.filter(c => c.isLand).length;
  const spellCount = handCards.filter(c => c.isSpell).length;

  // Calculate mana curve
  const manaCurve: { [cost: number]: number } = {};
  handCards.forEach(card => {
    if (!card.isLand) {
      const cost = Math.min(card.manaValue, 7); // Cap at 7 for curve purposes
      manaCurve[cost] = (manaCurve[cost] || 0) + 1;
    }
  });

  // Calculate color distribution
  const colorDistribution: { [color: string]: number } = {};
  handCards.forEach(card => {
    if (!card.isColorless && card.colors.length > 0) {
      card.colors.forEach(color => {
        colorDistribution[color] = (colorDistribution[color] || 0) + 1;
      });
    }
  });

  // Analyze early game plays (cards with mana value <= 2)
  const earlyGameCards = handCards.filter(c => !c.isLand && c.manaValue <= 2);
  const hasEarlyGamePlay = earlyGameCards.length > 0;

  // Analyze late game threats (cards with mana value >= 5)
  const lateGameCards = handCards.filter(c => !c.isLand && c.manaValue >= 5);
  const hasLateGameThreat = lateGameCards.length > 0;

  // Calculate average spell cost
  const spells = handCards.filter(c => !c.isLand);
  const averageSpellCost = spells.length > 0
    ? spells.reduce((sum, c) => sum + c.manaValue, 0) / spells.length
    : 0;

  // Land/spell ratio
  const landSpellRatio = spellCount > 0 ? landCount / spellCount : 0;

  // Color fixability (has multiple colors or colorless cards)
  const uniqueColors = Object.keys(colorDistribution).length;
  const hasColorless = handCards.some(c => c.isColorless);
  const isColorFixable = uniqueColors <= 2 || hasColorless || uniqueColors === 0;

  // Risk assessment
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  let riskExplanation = '';

  if (landCount < 2) {
    riskLevel = 'high';
    riskExplanation = 'Not enough lands to cast spells';
  } else if (landCount > 6) {
    riskLevel = 'high';
    riskExplanation = 'Too many lands, not enough spells';
  } else if (!hasEarlyGamePlay && landCount < 3) {
    riskLevel = 'medium';
    riskExplanation = 'Risk of being stuck with unplayable cards';
  } else if (averageSpellCost > 4 && landCount < 4) {
    riskLevel = 'medium';
    riskExplanation = 'High curve with few lands';
  } else if (!isColorFixable && uniqueColors > 2) {
    riskLevel = 'medium';
    riskExplanation = 'Multiple colors without fixers';
  } else {
    riskExplanation = 'Hand looks reasonable';
  }

  return {
    landCount,
    spellCount,
    landSpellRatio,
    averageSpellCost,
    manaCurve,
    colorDistribution,
    hasEarlyGamePlay,
    hasLateGameThreat,
    isColorFixable,
    riskLevel,
    riskExplanation,
  };
}

/**
 * Parse a ScryfallCard for mulligan evaluation
 */
function parseCardForMulligan(card: ScryfallCard): HandCard {
  const manaValue = card.cmc ?? 0;
  
  const typeLine = card.type_line?.toLowerCase() ?? '';
  const isLand = typeLine.includes('land');
  const isCreature = typeLine.includes('creature');
  const isSpell = !isLand;

  // Get colors
  const colors: string[] = card.colors ?? [];
  const isColorless = colors.length === 0;

  return {
    cardData: card,
    manaValue,
    isLand,
    isCreature,
    isSpell,
    colors,
    isColorless,
  };
}

/**
 * Evaluate hand strength
 */
function evaluateHandStrength(analysis: HandAnalysis, rules: MulliganRules): number {
  let score = 0;
  const maxScore = 10;

  // Land evaluation (30% of score)
  const idealLands = rules.idealLands;
  if (analysis.landCount === idealLands) {
    score += 3;
  } else if (analysis.landCount >= rules.minLands && analysis.landCount <= rules.maxLands) {
    const distance = Math.abs(analysis.landCount - idealLands);
    score += Math.max(0, 3 - distance * 0.5);
  } else if (analysis.landCount < rules.minLands) {
    score += Math.max(0, 1 - (rules.minLands - analysis.landCount));
  } else {
    // Too many lands
    score += Math.max(0, 2 - (analysis.landCount - rules.maxLands) * 0.5);
  }

  // Early game plays (25% of score)
  if (analysis.hasEarlyGamePlay) {
    score += 2.5;
  }

  // Late game threats (10% of score)
  if (analysis.hasLateGameThreat) {
    score += 1;
  }

  // Mana curve evaluation (15% of score)
  const curveScore = evaluateManaCurve(analysis.manaCurve);
  score += curveScore * 1.5;

  // Color fixability (10% of score)
  if (analysis.isColorFixable) {
    score += 1;
  }

  // Risk assessment (10% of score)
  switch (analysis.riskLevel) {
    case 'low':
      score += 1;
      break;
    case 'medium':
      score += 0.5;
      break;
    case 'high':
      // Penalty already applied in land evaluation
      break;
  }

  return Math.min(maxScore, Math.max(0, score));
}

/**
 * Evaluate mana curve
 */
function evaluateManaCurve(curve: { [cost: number]: number }): number {
  let score = 0;
  const totalCards = Object.values(curve).reduce((sum, count) => sum + count, 0);
  
  if (totalCards === 0) return 0;

  // Ideal early game: 1-2 cards at 1-2 mana
  const earlyGame = (curve[1] || 0) + (curve[2] || 0);
  const earlyGameRatio = earlyGame / totalCards;
  
  if (earlyGameRatio >= 0.3 && earlyGameRatio <= 0.6) {
    score += 1;
  } else if (earlyGameRatio > 0.6) {
    score += 0.8; // Slightly too aggressive
  } else {
    score += earlyGameRatio;
  }

  // Ideal mid game: 1-2 cards at 3-4 mana
  const midGame = (curve[3] || 0) + (curve[4] || 0);
  const midGameRatio = midGame / totalCards;
  score += midGameRatio * 0.5;

  // Late game is okay but not required
  const lateGame = (curve[5] || 0) + (curve[6] || 0) + (curve[7] || 0);
  if (lateGame > 0 && earlyGame > 0) {
    score += 0.5; // Has late game and early game - good curve
  }

  return Math.min(1, score);
}

/**
 * Make a mulligan decision for a given hand
 */
export function decideMulligan(
  hand: ScryfallCard[],
  format: string = 'standard',
  difficulty: MulliganDifficulty = 'balanced',
  librarySize: number = 60
): MulliganDecision {
  // Get format-specific rules, default to standard if unknown
  const rules = FORMAT_RULES[format.toLowerCase()] ?? FORMAT_RULES.standard;
  
  // Analyze the hand
  const analysis = analyzeHand(hand, librarySize);
  
  // Evaluate hand strength
  const handStrength = evaluateHandStrength(analysis, rules);
  
  // Get difficulty modifiers
  const difficultyMod = DIFFICULTY_MODIFIERS[difficulty];
  
  // Calculate keep threshold with difficulty adjustment
  const keepThreshold = rules.keepThreshold + difficultyMod.keepThreshold;
  
  // Adjust threshold based on risk
  let adjustedThreshold = keepThreshold;
  if (analysis.riskLevel === 'high') {
    adjustedThreshold += 0.5; // More likely to mulligan high risk hands
  } else if (analysis.riskLevel === 'low') {
    adjustedThreshold -= 0.3; // More likely to keep low risk hands
  }

  // Make decision
  const shouldMulligan = handStrength < adjustedThreshold;
  
  // Calculate confidence
  const strengthDiff = Math.abs(handStrength - adjustedThreshold);
  const confidence = Math.min(1, strengthDiff / 3 + 0.5);
  
  // Generate reasoning
  const reasoning = generateReasoning(shouldMulligan, analysis, handStrength, rules);

  return {
    shouldMulligan,
    confidence,
    reasoning,
    handStrength,
    analysis,
  };
}

/**
 * Generate human-readable reasoning for the decision
 */
function generateReasoning(
  shouldMulligan: boolean,
  analysis: HandAnalysis,
  handStrength: number,
  rules: MulliganRules
): string {
  const parts: string[] = [];

  // Land analysis
  if (analysis.landCount < rules.minLands) {
    parts.push(`Only ${analysis.landCount} land(s) - too few for ${rules.idealLands} ideal`);
  } else if (analysis.landCount > rules.maxLands) {
    parts.push(`${analysis.landCount} lands - too many, flooding risk`);
  } else if (analysis.landCount === rules.idealLands) {
    parts.push(`${analysis.landCount} lands - good count`);
  } else {
    parts.push(`${analysis.landCount} lands - acceptable`);
  }

  // Early game
  if (!analysis.hasEarlyGamePlay) {
    parts.push('no early plays');
  } else {
    parts.push('has early game plays');
  }

  // Curve
  if (analysis.averageSpellCost < 3) {
    parts.push('low curve');
  } else if (analysis.averageSpellCost > 5) {
    parts.push('high curve');
  }

  // Risk
  if (analysis.riskLevel === 'high') {
    parts.push(`high risk: ${analysis.riskExplanation}`);
  } else if (analysis.riskLevel === 'medium') {
    parts.push(`medium risk: ${analysis.riskExplanation}`);
  }

  // Conclusion
  if (shouldMulligan) {
    parts.push(`Hand strength ${handStrength.toFixed(1)} below threshold ${rules.keepThreshold}`);
    return `MULLIGAN: ${parts.join(', ')}`;
  } else {
    parts.push(`Hand strength ${handStrength.toFixed(1)} above threshold ${rules.keepThreshold}`);
    return `KEEP: ${parts.join(', ')}`;
  }
}

/**
 * Evaluate multiple possible hands (for scrying)
 */
export function evaluateHands(
  hands: ScryfallCard[][],
  format: string = 'standard',
  difficulty: MulliganDifficulty = 'balanced'
): MulliganDecision[] {
  return hands.map(hand => decideMulligan(hand, format, difficulty));
}

/**
 * Get the best hand from multiple options
 */
export function findBestHand(
  hands: ScryfallCard[][],
  format: string = 'standard',
  difficulty: MulliganDifficulty = 'balanced'
): { hand: ScryfallCard[]; decision: MulliganDecision } | null {
  if (hands.length === 0) return null;

  const decisions = evaluateHands(hands, format, difficulty);
  
  // Find the hand with highest strength that we would keep
  let bestHand: ScryfallCard[] | null = null;
  let bestDecision: MulliganDecision | null = null;
  let bestScore = -1;

  for (let i = 0; i < hands.length; i++) {
    const decision = decisions[i];
    const score = decision.shouldMulligan ? -1 : decision.handStrength;
    
    if (score > bestScore) {
      bestScore = score;
      bestHand = hands[i];
      bestDecision = decision;
    }
  }

  if (bestHand && bestDecision) {
    return { hand: bestHand, decision: bestDecision };
  }

  return null;
}

/**
 * Predict expected hand quality after mulligan
 */
export function predictMulliganValue(
  currentHandSize: number,
  currentDecision: MulliganDecision,
  librarySize: number
): { expectedStrength: number; variance: number } {
  // Simplified model - in reality this would be trained on data
  // After a mulligan, we draw one fewer card
  const newHandSize = currentHandSize - 1;
  
  // Smaller hands tend to be riskier but can be stronger
  // This is a rough approximation
  const sizeFactor = newHandSize / 7; // Normalize to 7-card hand
  
  // If we're keeping, current hand is good
  if (!currentDecision.shouldMulligan) {
    return {
      expectedStrength: currentDecision.handStrength,
      variance: 0.5,
    };
  }

  // If we're mulling, expect some degradation but variance is high
  // The smaller the hand we're drawing toward, the worse expected quality
  const expectedStrength = currentDecision.handStrength * 0.8 * sizeFactor;
  
  return {
    expectedStrength,
    variance: 1.5, // High variance when mulling
  };
}

/**
 * Factory function to create a mulligan decision AI
 */
export function createMulliganAI(
  format: string = 'standard',
  difficulty: MulliganDifficulty = 'balanced'
) {
  return {
    /**
     * Decide whether to mulligan
     */
    decide: (hand: ScryfallCard[], librarySize?: number) => 
      decideMulligan(hand, format, difficulty, librarySize),
    
    /**
     * Evaluate multiple hands
     */
    evaluate: (hands: ScryfallCard[][]) => 
      evaluateHands(hands, format, difficulty),
    
    /**
     * Find the best hand
     */
    findBest: (hands: ScryfallCard[][]) => 
      findBestHand(hands, format, difficulty),
    
    /**
     * Analyze a hand without making a decision
     */
    analyze: (hand: ScryfallCard[], librarySize?: number) => 
      analyzeHand(hand, librarySize),
    
    /**
     * Get format rules
     */
    getRules: () => FORMAT_RULES[format.toLowerCase()] ?? FORMAT_RULES.standard,
  };
}

export type { MulliganRules };

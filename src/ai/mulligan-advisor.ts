/**
 * @fileOverview Mulligan advisor using expert keep/ship decision data
 *
 * Evaluates 7-card opening hands for Limited and Constructed formats.
 * Combines heuristic rules derived from expert keep/ship data
 * (Limited Resources, Reid Duke's Level One, Marshall LR) with
 * archetype-aware weighting.
 */

import type { Card } from './types';
export type { Card };

export type MulliganDecision = 'keep' | 'ship';

export type ArchetypeCategory =
  | 'aggro'
  | 'control'
  | 'midrange'
  | 'combo'
  | 'tribal'
  | 'special';

export type GameFormat = 'limited' | 'constructed' | '*';

export interface MulliganInput {
  hand: Card[];
  archetype?: string;
  format?: GameFormat;
  gameNumber?: number;
  onThePlay?: boolean;
}

export interface HandAnalysis {
  landCount: number;
  spellCount: number;
  creatureCount: number;
  removalCount: number;
  cardDrawCount: number;
  avgCmc: number;
  colors: Set<string>;
  colorCount: number;
  hasRamp: boolean;
  hasCardDraw: boolean;
  hasRemoval: boolean;
  hasLands: boolean;
}

export interface MulliganAdvice {
  decision: MulliganDecision;
  confidence: number;
  reasoning: string[];
  analysis: HandAnalysis;
  handQualityScore: number;
}

export interface ExpertKeepShipRecord {
  handComposition: string;
  archetype: string;
  format: GameFormat;
  gameNumber: number;
  decision: MulliganDecision;
  reason: string;
}

const KEEP_SHIP_DATABASE: ExpertKeepShipRecord[] = [
  // === LAND COUNT RULES (Universal) ===
  { handComposition: '0-land', archetype: '*', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'Zero lands means you cannot play any spells. Ship and hope for a land in the top 6.' },
  { handComposition: '0-land', archetype: '*', format: 'constructed', gameNumber: 1, decision: 'ship', reason: 'Zero lands is unkeepable in any format.' },
  { handComposition: '1-land-bomb', archetype: 'aggro', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Aggressive decks can keep 1-lander if it has cheap threats and the land produces the right color for early plays.' },
  { handComposition: '1-land-bomb', archetype: 'aggro', format: 'constructed', gameNumber: 1, decision: 'keep', reason: 'Constructed aggro with a 1-drop and a land that casts it is a fine keep on the play.' },
  { handComposition: '1-land-no-action', archetype: 'control', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'Control needs to hit land drops consistently. One land with no early action spells is a mulligan.' },
  { handComposition: '1-land-no-action', archetype: 'control', format: 'limited', gameNumber: 2, decision: 'ship', reason: 'Even on the draw, control decks cannot afford to miss land drops.' },
  { handComposition: '1-land-no-action', archetype: 'control', format: 'constructed', gameNumber: 1, decision: 'ship', reason: 'Constructed control with 1 land and no cheap interaction is unkeepable.' },
  { handComposition: '2-land-curve', archetype: '*', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Two lands with a reasonable curve (spells at 2-3-4 CMC) is a fine keep in limited.' },
  { handComposition: '2-land-curve', archetype: '*', format: 'limited', gameNumber: 2, decision: 'keep', reason: 'Two lands with a curve is acceptable on the draw.' },
  { handComposition: '2-land-high-curve', archetype: '*', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Two lands with only 4+ CMC spells is risky. Keep only if the cards are individually very powerful.' },
  { handComposition: '5-land-few-spells', archetype: '*', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'Five lands and only two spells is land-flooded. Ship to find more action.' },
  { handComposition: '5-land-few-spells', archetype: 'control', format: 'constructed', gameNumber: 1, decision: 'ship', reason: 'Even control decks need more than two action spells. This is land-flooded.' },
  { handComposition: '6-land', archetype: '*', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'Six or more lands in a 7-card hand is always a mulligan. You need action.' },
  { handComposition: '7-land', archetype: '*', format: '*', gameNumber: 1, decision: 'ship', reason: 'All lands is an automatic mulligan.' },
  { handComposition: '3-land-curve', archetype: '*', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Three lands with a good curve is the ideal opening hand in limited.' },
  { handComposition: '3-land-curve', archetype: '*', format: 'constructed', gameNumber: 1, decision: 'keep', reason: 'Three lands with curve is generally a keep in constructed too.' },
  { handComposition: '4-land-curve', archetype: '*', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Four lands is on the edge but fine if you have enough action spells at different CMCs.' },
  { handComposition: '4-land-few-spells', archetype: 'aggro', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'Aggressive decks cannot afford to flood on lands. Too few threats.' },

  // === AGGRO SPECIFIC ===
  { handComposition: 'aggro-fast-start', archetype: 'aggro', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Aggro hands with 1-2 drop creatures and 2 lands are ideal keeps. Speed is king.' },
  { handComposition: 'aggro-slow-hand', archetype: 'aggro', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'Aggro hands with only 4+ CMC creatures are too slow. Ship to find early pressure.' },
  { handComposition: 'aggro-no-1-drop', archetype: 'aggro', format: 'constructed', gameNumber: 1, decision: 'ship', reason: 'Constructed aggro without a 1-drop on the play is often a mulligan. You need early pressure.' },
  { handComposition: 'aggro-no-1-drop', archetype: 'aggro', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'In limited, aggro decks may not have enough 1-drops to require them. A strong 2-3 curve is acceptable.' },
  { handComposition: 'aggro-no-1-drop', archetype: 'aggro', format: 'limited', gameNumber: 2, decision: 'keep', reason: 'On the draw, a 2-3 curve aggro hand is perfectly fine in limited.' },
  { handComposition: 'aggro-burn-heavy', archetype: 'burn', format: 'constructed', gameNumber: 1, decision: 'keep', reason: 'Burn decks keep hands with 2-3 burn spells and 1-2 lands. Curve is less important than raw damage output.' },
  { handComposition: 'aggro-1-land-2drop', archetype: 'aggro', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'One land with a 2-drop and a 3-drop on the play is a reasonable aggro keep in limited.' },

  // === CONTROL SPECIFIC ===
  { handComposition: 'control-removal-heavy', archetype: 'control', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Control hands with removal and a solid land base are fine. Early interaction is key.' },
  { handComposition: 'control-no-early-action', archetype: 'control', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'Control with only 5+ CMC spells and 2-3 lands cannot interact early. Ship to find removal or counters.' },
  { handComposition: 'control-no-early-action', archetype: 'control', format: 'constructed', gameNumber: 1, decision: 'ship', reason: 'Constructed control needs early interaction or card selection. Pure late-game hands are unkeepable.' },
  { handComposition: 'control-draw-and-lands', archetype: 'control', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Card draw plus lands is a solid control opening. Drawing into interaction is the plan.' },
  { handComposition: 'control-4-land-counters', archetype: 'control', format: 'constructed', gameNumber: 1, decision: 'keep', reason: 'Four lands with counterspells and card draw is a premium control hand.' },
  { handComposition: 'control-2-land-bomb', archetype: 'control', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'Two lands with only a single expensive threat is too risky for control. Need more interaction or lands.' },

  // === MIDRANGE SPECIFIC ===
  { handComposition: 'midrange-balanced', archetype: 'midrange', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Midrange hands with a mix of creatures, removal, and 3 lands are ideal keeps.' },
  { handComposition: 'midrange-no-removal', archetype: 'midrange', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Midrange can keep creature-heavy hands since creatures provide both offense and defense.' },
  { handComposition: 'midrange-all-removal', archetype: 'midrange', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Too much removal without threats means no win condition. Keep only if removal is very versatile.' },

  // === COMBO SPECIFIC ===
  { handComposition: 'combo-has-pieces', archetype: 'combo', format: 'constructed', gameNumber: 1, decision: 'keep', reason: 'If a combo hand has both pieces (or a tutor + piece) and the mana to execute, always keep.' },
  { handComposition: 'combo-half-pieces', archetype: 'combo', format: 'constructed', gameNumber: 1, decision: 'keep', reason: 'One combo piece with card selection (cantrips, tutors) is a reasonable keep.' },
  { handComposition: 'combo-no-pieces', archetype: 'combo', format: 'constructed', gameNumber: 1, decision: 'ship', reason: 'No combo pieces and no tutors/cantrips means no route to the combo. Ship.' },
  { handComposition: 'combo-1-land-tutor', archetype: 'combo', format: 'constructed', gameNumber: 1, decision: 'keep', reason: 'One land with a tutor (like Vampiric Tutor) to find the second land or a combo piece is a classic keep.' },

  // === TRIBAL SPECIFIC ===
  { handComposition: 'tribal-lord-and-tribe', archetype: 'tribal', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'A tribal hand with a lord and 2+ tribe members plus lands is an excellent keep.' },
  { handComposition: 'tribal-tribe-no-lord', archetype: 'tribal', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Multiple tribal creatures with lands is fine even without a lord. The synergy is inherent.' },
  { handComposition: 'tribal-no-tribe', archetype: 'tribal', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'Tribal deck with no tribal members in the opening hand is weak. Ship to find your tribe.' },

  // === COLOR/CONSISTENCY ===
  { handComposition: 'color-screw-risk', archetype: '*', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'Multiple colored spells requiring different colors with no fixing is a mulligan in limited.' },
  { handComposition: 'color-screw-risk', archetype: '*', format: 'constructed', gameNumber: 1, decision: 'keep', reason: 'In constructed, mana bases are better. A hand with playable spells even if not all colors is often keepable.' },
  { handComposition: 'mono-color-good-curve', archetype: '*', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Mono-color hands with a good curve and correct lands are always keeps. Maximum consistency.' },

  // === GAME NUMBER ADJUSTMENTS ===
  { handComposition: 'mediocre-g1', archetype: '*', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'On the play in game 1, be more willing to mulligan marginal hands to maximize your chance of a strong start.' },
  { handComposition: 'mediocre-g2', archetype: '*', format: 'limited', gameNumber: 2, decision: 'keep', reason: 'On the draw in game 2, keep slightly worse hands since you have the draw step advantage.' },
  { handComposition: 'mediocre-g3', archetype: '*', format: 'limited', gameNumber: 3, decision: 'keep', reason: 'In game 3+, be more cautious about mulliganing to 6 since you cannot afford to fall further behind on cards.' },

  // === CURVE QUALITY ===
  { handComposition: 'good-curve-2-3-4', archetype: '*', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'A smooth curve with plays at 2, 3, and 4 CMC plus lands is the gold standard in limited.' },
  { handComposition: 'good-curve-1-2-3', archetype: '*', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'A low curve with plays at 1, 2, and 3 CMC is excellent for aggro and tempo strategies.' },
  { handComposition: 'bad-curve-gap', archetype: '*', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'A hand with only 1-drops and 6-drops has a gap. Keep only if the 1-drops are strong enough to buy time.' },
  { handComposition: 'bad-curve-no-early', archetype: '*', format: 'limited', gameNumber: 1, decision: 'ship', reason: 'A hand with nothing playable before turn 4 is a mulligan. You will fall too far behind.' },

  // === RAMP / ACCELERATION ===
  { handComposition: 'ramp-2-land-ramp-spell', archetype: 'midrange', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Two lands plus a ramp spell and a payoff (big creature) is an excellent midrange keep.' },
  { handComposition: 'ramp-2-land-no-payoff', archetype: 'midrange', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Ramp without a payoff in hand is risky. Keep only if the rest of the hand has enough action.' },

  // === CARD DRAW / SELECTION ===
  { handComposition: 'selection-2-land-cantrip', archetype: '*', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'Card selection (cantrips, scry) smooths out draws. Two lands plus selection is a safe keep.' },
  { handComposition: 'selection-1-land-cantrip', archetype: '*', format: 'constructed', gameNumber: 1, decision: 'keep', reason: 'In constructed, a cantrip with one land is keepable because selection compensates for the land shortage.' },
  { handComposition: 'selection-1-land-cantrip', archetype: '*', format: 'limited', gameNumber: 1, decision: 'keep', reason: 'In limited, one land plus a cantrip is risky. The cantrip may not find a land.' },

  // === SPECIAL SITUATIONS ===
  { handComposition: 'sideboard-knowledge', archetype: '*', format: 'constructed', gameNumber: 2, decision: 'keep', reason: 'After sideboarding, your deck is tuned for the matchup. Keep hands that align with your post-board plan.' },
  { handComposition: 'hate-card-in-opener', archetype: '*', format: 'constructed', gameNumber: 2, decision: 'keep', reason: 'A hand with a key sideboard hate card is usually a keep, even if slightly below average.' },
];

function analyzeHand(hand: Card[]): HandAnalysis {
  let landCount = 0;
  let spellCount = 0;
  let creatureCount = 0;
  let removalCount = 0;
  let cardDrawCount = 0;
  let totalCmc = 0;
  let hasRamp = false;
  let hasCardDraw = false;
  let hasRemoval = false;
  let hasLands = false;
  const colors = new Set<string>();
  const spellTypes = new Set<string>();

  for (const card of hand) {
    const typeLine = (card.type_line || '').toLowerCase();
    const oracleText = (card.oracle_text || '').toLowerCase();
    const name = (card.name || '').toLowerCase();
    const cmc = card.cmc ?? 0;

    if (typeLine.includes('land') || typeLine === 'basic land') {
      landCount++;
      hasLands = true;
      continue;
    }

    spellCount++;
    totalCmc += cmc;

    if (typeLine.includes('creature')) {
      creatureCount++;
    }

    spellTypes.add(typeLine);

    const cardIdentity = card.colors || [];
    for (const color of cardIdentity) {
      colors.add(color);
    }

    if (
      oracleText.includes('destroy') ||
      oracleText.includes('exile') ||
      oracleText.includes('counter') ||
      oracleText.includes('sacrifice') ||
      name.includes('bolt') ||
      name.includes('terminate') ||
      name.includes('murder') ||
      name.includes('shock') ||
      name.includes('path to exile') ||
      oracleText.includes('deals') && oracleText.includes('damage') ||
      oracleText.includes('remove') ||
      oracleText.includes('return') ||
      name.includes('bounce')
    ) {
      removalCount++;
      hasRemoval = true;
    }

    if (
      oracleText.includes('draw') ||
      oracleText.includes('scry') ||
      oracleText.includes('look at the top') ||
      oracleText.includes('surveil') ||
      oracleText.includes('explore') ||
      name.includes('cantrip') ||
      name.includes('ponder') ||
      name.includes('brainstorm') ||
      name.includes('divination') ||
      name.includes('opt') ||
      name.includes('preordain')
    ) {
      cardDrawCount++;
      hasCardDraw = true;
    }

    if (
      oracleText.includes('search your library for a land') ||
      oracleText.includes('put a land') ||
      name.includes('ramp') ||
      name.includes('cultivate') ||
      name.includes('kodama') ||
      name.includes('farseek') ||
      name.includes('birds of paradise') ||
      name.includes('llanowar elves') ||
      name.includes('elvish mystic')
    ) {
      hasRamp = true;
    }
  }

  return {
    landCount,
    spellCount,
    creatureCount,
    removalCount,
    cardDrawCount,
    avgCmc: spellCount > 0 ? totalCmc / spellCount : 0,
    colors,
    colorCount: colors.size,
    hasRamp,
    hasCardDraw,
    hasRemoval,
    hasLands,
  };
}

function classifyArchetype(archetype?: string): ArchetypeCategory {
  if (!archetype) return 'midrange';

  const lower = archetype.toLowerCase();
  if (['burn', 'zoo', 'sligh', 'aggro-midrange'].some(a => lower.includes(a))) return 'aggro';
  if (['draw-go', 'stax', 'prison', 'tempo-control', 'control-midrange'].some(a => lower.includes(a))) return 'control';
  if (['storm', 'reanimator', 'infinite'].some(a => lower.includes(a))) return 'combo';
  if (['elves', 'goblins', 'zombies', 'dragons'].some(a => lower.includes(a))) return 'tribal';
  if (['lands', 'superfriends'].some(a => lower.includes(a))) return 'special';
  return 'midrange';
}

function scoreHandQuality(analysis: HandAnalysis, archetype: ArchetypeCategory, format: GameFormat, gameNumber: number, onThePlay: boolean): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;

  // === LAND COUNT SCORING ===
  if (analysis.landCount === 0) {
    score -= 60;
    reasons.push('No lands — cannot cast any spells');
  } else if (analysis.landCount === 1) {
    if (archetype === 'aggro' && analysis.avgCmc <= 2.0 && onThePlay) {
      score -= 10;
      reasons.push('Only 1 land, but low curve and aggro archetype make it acceptable');
    } else if (analysis.hasCardDraw && format === 'constructed' && onThePlay) {
      score -= 8;
      reasons.push('Only 1 land, but card selection can find more');
    } else {
      score -= 35;
      reasons.push('Only 1 land — high risk of missing land drops');
    }
  } else if (analysis.landCount === 2) {
    if (analysis.avgCmc <= 2.5 && analysis.spellCount >= 3) {
      score += 5;
      reasons.push('2 lands with a low curve is workable');
    } else if (analysis.avgCmc <= 3.5 && analysis.spellCount >= 3) {
      score += 0;
      reasons.push('2 lands with a reasonable curve is acceptable');
    } else if (analysis.avgCmc > 4.0) {
      score -= 20;
      reasons.push('2 lands with only expensive spells is risky');
    } else {
      score -= 5;
      reasons.push('2 lands — slightly below ideal but acceptable');
    }
  } else if (analysis.landCount === 3) {
    score += 10;
    reasons.push('3 lands — ideal land count for an opening hand');
  } else if (analysis.landCount === 4) {
    if (analysis.spellCount >= 3) {
      score += 5;
      reasons.push('4 lands with enough action is fine');
    } else if (analysis.spellCount === 2) {
      score -= 5;
      reasons.push('4 lands with only 2 spells is slightly flooded');
    } else {
      score -= 25;
      reasons.push('4+ lands with too few action spells');
    }
  } else if (analysis.landCount >= 5) {
    score -= 40;
    reasons.push(`${analysis.landCount} lands — severely land-flooded`);
  }

  // === CURVE SCORING ===
  if (analysis.spellCount === 0) {
    score -= 50;
    reasons.push('No non-land cards — no action');
  } else {
    if (analysis.avgCmc >= 1.5 && analysis.avgCmc <= 3.5) {
      score += 10;
      reasons.push('Good average mana value in the hand');
    } else if (analysis.avgCmc < 1.5) {
      score += 5;
      reasons.push('Very low curve — good for aggro, may lack late-game');
    } else if (analysis.avgCmc > 4.5) {
      score -= 25;
      reasons.push('Very high average CMC — will not have early plays');
    } else if (analysis.avgCmc > 3.5) {
      score -= 10;
      reasons.push('Above-average CMC — may be slow to start');
    }
  }

  // === CREATURE COUNT ===
  if (archetype === 'aggro' && analysis.creatureCount >= 3) {
    score += 10;
    reasons.push('Multiple early creatures for aggressive start');
  } else if (archetype === 'aggro' && analysis.creatureCount === 0) {
    score -= 20;
    reasons.push('Aggro hand with no creatures has no pressure');
  } else if (archetype === 'control' && analysis.creatureCount <= 1) {
    score += 5;
    reasons.push('Few creatures — appropriate for control strategy');
  } else if (analysis.creatureCount >= 2 && analysis.creatureCount <= 4) {
    score += 5;
    reasons.push('Good creature count for general play');
  }

  // === REMOVAL ===
  if (analysis.hasRemoval) {
    score += 5;
    reasons.push('Hand has removal for early interaction');
  }

  // === CARD DRAW ===
  if (analysis.hasCardDraw) {
    score += 8;
    reasons.push('Card draw/selection helps smooth future draws');
  }

  // === RAMP ===
  if (analysis.hasRamp && (archetype === 'midrange' || archetype === 'control' || archetype === 'combo')) {
    score += 8;
    reasons.push('Ramp helps accelerate into powerful plays');
  }

  // === COLOR CONSISTENCY ===
  if (analysis.colorCount >= 3 && format === 'limited') {
    score -= 15;
    reasons.push(`${analysis.colorCount} colors with limited fixing is risky`);
  } else if (analysis.colorCount <= 1) {
    score += 5;
    reasons.push('Mono-color — excellent mana consistency');
  }

  // === ARCHETYPE-SPECIFIC BONUSES ===
  if (archetype === 'combo') {
    if (analysis.hasCardDraw) {
      score += 5;
      reasons.push('Card selection helps find combo pieces');
    }
  }

  if (archetype === 'tribal' && analysis.creatureCount >= 3) {
    score += 5;
    reasons.push('Multiple creatures support tribal synergies');
  }

  // === FORMAT ADJUSTMENTS ===
  if (format === 'limited') {
    if (analysis.spellCount >= 4 && analysis.landCount >= 2 && analysis.landCount <= 4) {
      score += 5;
      reasons.push('Solid spell-to-land ratio for limited');
    }
  }

  // === GAME NUMBER ADJUSTMENTS ===
  if (gameNumber >= 3) {
    if (score < 60 && score >= 35) {
      score += 10;
      reasons.push('In game 3+, more conservative with mulligans (cannot afford to fall further behind on cards)');
    }
  } else if (gameNumber === 2 && !onThePlay) {
    if (score < 60 && score >= 30) {
      score += 5;
      reasons.push('On the draw in game 2, slightly more willing to keep marginal hands');
    }
  } else if (gameNumber === 1 && onThePlay) {
    if (score >= 55 && score <= 65) {
      score -= 5;
      reasons.push('On the play in game 1, slightly stricter with mulligans for optimal start');
    }
  }

  // === EARLY PLAY CHECK ===
  const earlyPlays = analysis.spellCount - countExpensiveOnly(analysis);
  if (earlyPlays === 0 && analysis.landCount < 4) {
    score -= 10;
    reasons.push('No early plays available before turn 4');
  }

  // === LOW LAND + HIGH CURVE PENALTY ===
  if (analysis.landCount <= 1 && analysis.avgCmc >= 3.0) {
    score -= 15;
    reasons.push('Very few lands with expensive spells — unlikely to cast anything on time');
  }

  return { score, reasons };
}

function countExpensiveOnly(analysis: HandAnalysis): number {
  return analysis.spellCount > 0 && analysis.avgCmc > 4.0 ? analysis.spellCount : 0;
}

export function analyzeMulligan(input: MulliganInput): MulliganAdvice {
  const { hand, archetype, format = 'limited', gameNumber = 1, onThePlay = true } = input;

  if (hand.length === 0) {
    return {
      decision: 'ship',
      confidence: 1.0,
      reasoning: ['Empty hand is not a valid opening hand'],
      analysis: createEmptyAnalysis(),
      handQualityScore: 0,
    };
  }

  if (hand.length !== 7) {
    return {
      decision: 'ship',
      confidence: 0.5,
      reasoning: ['Mulligan advisor expects a 7-card opening hand'],
      analysis: analyzeHand(hand),
      handQualityScore: 0,
    };
  }

  const analysis = analyzeHand(hand);
  const archetypeCategory = classifyArchetype(archetype);
  const { score, reasons } = scoreHandQuality(analysis, archetypeCategory, format, gameNumber, onThePlay);

  const threshold = format === 'limited' ? 40 : 35;
  const decision: MulliganDecision = score >= threshold ? 'keep' : 'ship';
  const confidence = Math.min(1, Math.max(0, Math.abs(score - threshold) / 50));

  return {
    decision,
    confidence,
    reasoning: reasons,
    analysis,
    handQualityScore: Math.max(0, Math.min(100, score)),
  };
}

export function getMatchingExpertRecords(analysis: HandAnalysis, archetype?: string, format?: GameFormat): ExpertKeepShipRecord[] {
  return KEEP_SHIP_DATABASE.filter(record => {
    if (record.format !== '*' && format && record.format !== format) return false;
    if (record.archetype !== '*' && archetype) {
      const archetypeLower = archetype.toLowerCase();
      if (!archetypeLower.includes(record.archetype)) return false;
    }
    if (record.handComposition === '0-land' && analysis.landCount !== 0) return false;
    if (record.handComposition === '1-land-bomb' && analysis.landCount !== 1) return false;
    if (record.handComposition === '1-land-no-action' && analysis.landCount !== 1) return false;
    if (record.handComposition === '5-land-few-spells' && analysis.landCount < 5) return false;
    if (record.handComposition === '6-land' && analysis.landCount < 6) return false;
    if (record.handComposition === '7-land' && analysis.landCount < 7) return false;
    if (record.handComposition === '2-land-curve' && analysis.landCount !== 2) return false;
    if (record.handComposition === '3-land-curve' && analysis.landCount !== 3) return false;
    if (record.handComposition === '4-land-curve' && analysis.landCount !== 4) return false;
    if (record.handComposition === '4-land-few-spells' && analysis.landCount !== 4) return false;
    return true;
  });
}

function createEmptyAnalysis(): HandAnalysis {
  return {
    landCount: 0,
    spellCount: 0,
    creatureCount: 0,
    removalCount: 0,
    cardDrawCount: 0,
    avgCmc: 0,
    colors: new Set(),
    colorCount: 0,
    hasRamp: false,
    hasCardDraw: false,
    hasRemoval: false,
    hasLands: false,
  };
}

export { KEEP_SHIP_DATABASE };

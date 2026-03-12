/**
 * @fileOverview Archetype signature definitions for deck detection
 *
 * Defines 18 archetypes across 6 categories with clear detection criteria,
 * mana curve expectations, and keyword requirements.
 */

import type { DeckCard } from '@/app/actions';

/**
 * Archetype signature for detection
 */
export interface ArchetypeSignature {
  /** Archetype name */
  name: string;
  /** Category (aggro, control, midrange, combo, tribal, special) */
  category: string;
  /** Minimum creature ratio (0-1) */
  minCreatureRatio?: number;
  /** Maximum creature ratio (0-1) */
  maxCreatureRatio?: number;
  /** Land ratio range [min, max] */
  landRatio?: [number, number];
  /** Average CMC range [min, max] */
  avgCmcRange?: [number, number];
  /** Minimum spell ratio (non-creature, non-land) */
  minSpellRatio?: number;
  /** Maximum spell ratio */
  maxSpellRatio?: number;
  /** Keyword requirements: keyword -> minimum count */
  keywordRequirements?: Map<string, number>;
  /** Card type requirements: type -> minimum count */
  cardTypeRequirements?: Map<string, number>;
  /** Specific card name patterns to look for */
  cardPatterns?: string[];
  /** Scoring function for this archetype */
  scoreFunction: (deck: DeckCard[], stats: DeckStats) => number;
  /** Description of the archetype */
  description: string;
}

/**
 * Deck statistics for archetype detection
 */
export interface DeckStats {
  totalCards: number;
  creatureCount: number;
  landCount: number;
  spellCount: number;
  avgCmc: number;
  creatureRatio: number;
  landRatio: number;
  spellRatio: number;
  colorDistribution: Record<string, number>;
  cardTypes: Record<string, number>;
  keywordCounts: Record<string, number>;
  manaCurve: number[];
}

/**
 * Archetype detection result
 */
export interface ArchetypeResult {
  /** Primary detected archetype */
  primary: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Secondary archetype (if applicable) */
  secondary?: string;
  /** Secondary confidence */
  secondaryConfidence?: number;
  /** All archetype scores */
  allScores: Array<{ name: string; score: number; category: string }>;
}

/**
 * Calculate deck statistics
 */
export function calculateDeckStats(deck: DeckCard[]): DeckStats {
  const totalCards = deck.reduce((sum, card) => sum + card.count, 0);
  
  let creatureCount = 0;
  let landCount = 0;
  let spellCount = 0;
  let totalCmc = 0;
  let cmcCount = 0;
  const colorDistribution: Record<string, number> = {};
  const cardTypes: Record<string, number> = {};
  const keywordCounts: Record<string, number> = {};
  const manaCurve = [0, 0, 0, 0, 0, 0, 0, 0]; // 0-7+ CMC

  const typeLine = (card: DeckCard) => (card.type_line || '').toLowerCase();
  const cardName = (card: DeckCard) => (card.name || '').toLowerCase();
  const oracleText = (card: DeckCard) => (card.oracle_text || '').toLowerCase();

  for (const card of deck) {
    const count = card.count;
    const cmc = card.cmc || 0;
    const type = typeLine(card);
    const name = cardName(card);
    const text = oracleText(card);

    // Count card types
    if (type.includes('creature')) {
      creatureCount += count;
      cardTypes.creature = (cardTypes.creature || 0) + count;
    }
    if (type.includes('land')) {
      landCount += count;
      cardTypes.land = (cardTypes.land || 0) + count;
    }
    if (type.includes('instant')) {
      cardTypes.instant = (cardTypes.instant || 0) + count;
    }
    if (type.includes('sorcery')) {
      cardTypes.sorcery = (cardTypes.sorcery || 0) + count;
    }
    if (type.includes('artifact')) {
      cardTypes.artifact = (cardTypes.artifact || 0) + count;
    }
    if (type.includes('enchantment')) {
      cardTypes.enchantment = (cardTypes.enchantment || 0) + count;
    }
    if (type.includes('planeswalker')) {
      cardTypes.planeswalker = (cardTypes.planeswalker || 0) + count;
    }

    // Count colors
    const colors = card.color_identity || card.colors || [];
    colors.forEach(color => {
      colorDistribution[color] = (colorDistribution[color] || 0) + count;
    });

    // Count CMC
    if (cmc > 0) {
      totalCmc += cmc * count;
      cmcCount += count;
    }
    const curveIndex = Math.min(cmc, 7);
    manaCurve[curveIndex] += count;

    // Count keywords in oracle text
    const keywords = [
      'flying', 'first strike', 'double strike', 'deathtouch', 'haste',
      'hexproof', 'indestructible', 'lifelink', 'menace', 'reach',
      'trample', 'vigilance', 'ward', 'draw', 'counter', 'destroy',
      'exile', 'sacrifice', 'token', 'ramp', 'mana', 'land',
      'burn', 'damage', 'direct', 'creature', 'card', 'search',
      'tutor', 'fetch', 'mill', 'graveyard', 'recur', 'return',
      'bounce', 'transform', 'modal', 'kick', 'overload', 'convoke',
      'delve', 'exploit', 'renown', 'surge', 'escalate', 'embalm',
      'eternalize', 'aftermath', 'jumpstart', 'spectacle', 'threshold',
      'delirium', 'morbid', 'metalcraft', 'landfall', 'battle cry',
      'bloodthirst', 'convoke', 'dredge', 'echo', 'evoke', 'fear',
      'flash', 'flanking', 'frenzy', 'intimidate', 'landwalk', 'modular',
      'ninjutsu', 'protection', 'provoke', 'shadow', 'shroud', 'skulk',
      'soulbond', 'soullink', 'spiritlink', 'storm', 'sunburst',
      'suspend', 'totem armor', 'transfigure', 'transmute', 'trample',
      'undying', 'unearth', 'vanishing', 'wither', 'worship'
    ];

    keywords.forEach(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'g');
      const matches = text.match(regex);
      if (matches) {
        keywordCounts[keyword] = (keywordCounts[keyword] || 0) + matches.length * count;
      }
    });
  }

  spellCount = totalCards - creatureCount - landCount;

  return {
    totalCards,
    creatureCount,
    landCount,
    spellCount,
    avgCmc: cmcCount > 0 ? totalCmc / cmcCount : 0,
    creatureRatio: totalCards > 0 ? creatureCount / totalCards : 0,
    landRatio: totalCards > 0 ? landCount / totalCards : 0,
    spellRatio: totalCards > 0 ? spellCount / totalCards : 0,
    colorDistribution,
    cardTypes,
    keywordCounts,
    manaCurve,
  };
}

/**
 * Helper function to count cards matching patterns
 */
function countPatternMatches(deck: DeckCard[], patterns: string[]): number {
  let count = 0;
  for (const card of deck) {
    const name = card.name.toLowerCase();
    const text = (card.oracle_text || '').toLowerCase();
    const type = (card.type_line || '').toLowerCase();
    const combined = `${name} ${text} ${type}`;
    
    for (const pattern of patterns) {
      if (combined.includes(pattern.toLowerCase())) {
        count += card.count;
        break;
      }
    }
  }
  return count;
}

/**
 * Helper function to get keyword count
 */
function getKeywordCount(stats: DeckStats, keyword: string): number {
  return stats.keywordCounts[keyword] || 0;
}

/**
 * Archetype signatures for 18 archetypes
 */
export const ARCHETYPE_SIGNATURES: ArchetypeSignature[] = [
  // === AGGRO ARCHETYPES (3) ===
  {
    name: 'Burn',
    category: 'aggro',
    description: 'Direct damage spells to quickly reduce opponent life to zero',
    minCreatureRatio: 0.2,
    maxCreatureRatio: 0.5,
    avgCmcRange: [1.5, 2.8],
    cardPatterns: ['lightning bolt', 'lava spike', 'skewer the critics', 'burst lightning', 'fireblast', 'chain lightning', 'flame slash', 'shock', 'incinerate', 'price of progress'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const burnSpells = countPatternMatches(deck, ['lightning bolt', 'lava spike', 'skewer', 'burst lightning', 'fireblast', 'chain lightning', 'flame slash', 'shock', 'incinerate', 'price of progress']);
      const burnRatio = burnSpells / Math.max(stats.totalCards, 1);
      
      if (burnRatio >= 0.3) score += 50;
      else if (burnRatio >= 0.2) score += 35;
      else if (burnRatio >= 0.1) score += 20;
      
      if (stats.avgCmc >= 1.5 && stats.avgCmc <= 2.8) score += 20;
      if (stats.creatureRatio >= 0.2 && stats.creatureRatio <= 0.5) score += 15;
      if (getKeywordCount(stats, 'damage') >= 6) score += 15;
      
      return score;
    },
  },
  {
    name: 'Zoo',
    category: 'aggro',
    description: 'Efficient creatures with pump spells for fast aggressive wins',
    minCreatureRatio: 0.5,
    maxCreatureRatio: 0.75,
    avgCmcRange: [1.8, 3.0],
    cardPatterns: ['goblin guide', 'monastery swiftspear', 'tarmogoyf', 'naya', 'pump', 'mutagenic growth', 'giant growth', 'berserk', 'ranger'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const pumpSpells = countPatternMatches(deck, ['pump', 'giant growth', 'mutagenic growth', 'berserk', 'might', 'strength', 'titanic growth']);
      
      if (stats.creatureRatio >= 0.5 && stats.creatureRatio <= 0.75) score += 35;
      else if (stats.creatureRatio >= 0.4) score += 20;
      
      if (stats.avgCmc >= 1.8 && stats.avgCmc <= 3.0) score += 20;
      if (pumpSpells >= 6) score += 30;
      else if (pumpSpells >= 3) score += 20;
      
      if (getKeywordCount(stats, 'haste') >= 4) score += 10;
      if (getKeywordCount(stats, 'trample') >= 4) score += 10;
      
      return score;
    },
  },
  {
    name: 'Sligh',
    category: 'aggro',
    description: 'Pure creature aggro with the lowest possible mana curve',
    minCreatureRatio: 0.65,
    maxCreatureRatio: 0.85,
    avgCmcRange: [1.2, 2.2],
    cardPatterns: ['sligh', 'red deck wins', 'rdw', 'cheap creature', 'one drop', 'two drop'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      
      // Must have high creature ratio
      if (stats.creatureRatio >= 0.6) score += 40;
      else if (stats.creatureRatio >= 0.5) score += 25;
      else return score; // Not Sligh if not creature-heavy
      
      // Must have low CMC
      if (stats.avgCmc >= 1.0 && stats.avgCmc <= 2.2) score += 30;
      else if (stats.avgCmc <= 2.5) score += 15;
      else return score; // Not Sligh if curve is too high
      
      // Check mana curve - should be heavily 1-2 CMC
      const lowCurve = stats.manaCurve[1] + stats.manaCurve[2];
      const lowCurveRatio = lowCurve / Math.max(stats.totalCards, 1);
      if (lowCurveRatio >= 0.5) score += 20;
      else if (lowCurveRatio >= 0.35) score += 10;
      
      if (getKeywordCount(stats, 'haste') >= 4) score += 10;
      
      // Bonus for low CMC creatures
      const lowCmcCreatures = stats.manaCurve[1] + stats.manaCurve[2];
      if (lowCmcCreatures >= 15) score += 10;
      
      return score;
    },
  },

  // === CONTROL ARCHETYPES (3) ===
  {
    name: 'Draw-Go',
    category: 'control',
    description: 'Counter-based control with heavy card draw, few creatures',
    minCreatureRatio: 0,
    maxCreatureRatio: 0.2,
    avgCmcRange: [2.0, 3.5],
    cardPatterns: ['counterspell', 'force of will', 'mana drain', 'mystic force', 'draw', 'concentrate', 'ancestral', 'brainstorm', 'ponder', 'preordain'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const counterspells = countPatternMatches(deck, ['counterspell', 'force of will', 'mana drain', 'mystic force', 'negate', 'dissolve', 'cancel', 'essence scatter']);
      const cardDraw = countPatternMatches(deck, ['draw', 'concentrate', 'ancestral', 'brainstorm', 'ponder', 'preordain', 'divination', 'blue sun', 'tidal influence']);
      
      if (counterspells >= 12) score += 35;
      else if (counterspells >= 8) score += 20;
      else if (counterspells >= 4) score += 10;
      
      if (cardDraw >= 10) score += 30;
      else if (cardDraw >= 6) score += 15;
      
      if (stats.creatureRatio <= 0.15) score += 20;
      else if (stats.creatureRatio <= 0.25) score += 10;
      
      const instantRatio = (stats.cardTypes.instant || 0) / Math.max(stats.totalCards, 1);
      if (instantRatio >= 0.3) score += 15;
      
      return score;
    },
  },
  {
    name: 'Stax',
    category: 'control',
    description: 'Resource denial through artifact taxes and lock pieces',
    minCreatureRatio: 0.1,
    maxCreatureRatio: 0.4,
    avgCmcRange: [2.5, 4.0],
    cardPatterns: ['static orb', 'stasis', 'winter orb', 'smokestack', 'crucible of worlds', 'lock', 'tax', 'strip mine', 'wasteland'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const artifacts = stats.cardTypes.artifact || 0;
      const artifactRatio = artifacts / Math.max(stats.totalCards, 1);
      const lockPieces = countPatternMatches(deck, ['static orb', 'stasis', 'winter orb', 'smokestack', 'thorn of amethyst', 'trinisphere', 'chalice', 'sphere', 'lock', 'tax']);
      
      if (artifactRatio >= 0.3) score += 30;
      else if (artifactRatio >= 0.2) score += 15;
      
      if (lockPieces >= 8) score += 35;
      else if (lockPieces >= 4) score += 20;
      
      if (stats.landRatio >= 0.35) score += 15;
      
      return score;
    },
  },
  {
    name: 'Prison',
    category: 'control',
    description: 'Lock opponents out of the game with permanent-based restrictions',
    minCreatureRatio: 0.1,
    maxCreatureRatio: 0.35,
    avgCmcRange: [2.5, 4.0],
    cardPatterns: ['prison', 'enchantment', 'pacifism', 'imprison', 'exile', 'banish', 'oblivion ring', 'detention sphere', 'sleep', 'paralyze'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const enchantments = stats.cardTypes.enchantment || 0;
      const enchantmentRatio = enchantments / Math.max(stats.totalCards, 1);
      const removal = countPatternMatches(deck, ['destroy', 'exile', 'banish', 'oblivion', 'detention', 'prison', 'pacifism', 'imprison', 'sleep', 'paralyze']);
      
      if (enchantmentRatio >= 0.25) score += 30;
      else if (enchantmentRatio >= 0.15) score += 15;
      
      if (removal >= 12) score += 35;
      else if (removal >= 8) score += 20;
      
      if (stats.avgCmc >= 2.5) score += 15;
      
      return score;
    },
  },

  // === MIDRANGE ARCHETYPES (3) ===
  {
    name: 'Good Stuff',
    category: 'midrange',
    description: 'Collection of individually powerful cards with balanced curve',
    minCreatureRatio: 0.35,
    maxCreatureRatio: 0.55,
    avgCmcRange: [2.5, 3.8],
    cardPatterns: ['value', 'efficient', 'threat', 'powerful', 'versatile', 'good stuff'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      
      if (stats.creatureRatio >= 0.35 && stats.creatureRatio <= 0.55) score += 30;
      
      if (stats.avgCmc >= 2.5 && stats.avgCmc <= 3.8) score += 25;
      
      // Balanced mana curve
      const curveBalance = Math.abs(stats.manaCurve[2] - stats.manaCurve[3]) < 5 && 
                          Math.abs(stats.manaCurve[3] - stats.manaCurve[4]) < 5;
      if (curveBalance) score += 20;
      
      // Variety of card types
      const typeVariety = Object.keys(stats.cardTypes).length;
      if (typeVariety >= 5) score += 15;
      
      return score;
    },
  },
  {
    name: 'Rock',
    category: 'midrange',
    description: 'Midrange creatures with removal and ramp',
    minCreatureRatio: 0.4,
    maxCreatureRatio: 0.6,
    avgCmcRange: [2.5, 3.8],
    cardPatterns: ['abrupt decay', 'thoughtseize', 'inquisition', 'tarmogoyf', 'dark confidant', 'scavenging ooze', 'liliana', 'golgari'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const removal = countPatternMatches(deck, ['destroy', 'removal', 'decay', 'doom', 'murder', 'victim', 'thoughtseize', 'inquisition']);
      const ramp = countPatternMatches(deck, ['ramp', 'mana', 'accelerate', 'cultivate', 'kodama', 'signet', 'stone']);
      
      if (stats.creatureRatio >= 0.4 && stats.creatureRatio <= 0.6) score += 30;
      
      if (removal >= 8) score += 25;
      else if (removal >= 4) score += 15;
      
      if (ramp >= 6) score += 20;
      else if (ramp >= 3) score += 10;
      
      if (stats.avgCmc >= 2.5 && stats.avgCmc <= 3.8) score += 15;
      
      return score;
    },
  },
  {
    name: 'Value',
    category: 'midrange',
    description: 'Card advantage engines with efficient creatures',
    minCreatureRatio: 0.35,
    maxCreatureRatio: 0.55,
    avgCmcRange: [2.5, 4.0],
    cardPatterns: ['draw', 'advantage', 'value', 'engine', 'witness', 'regrowth', 'recur', 'eternal', 'meren', 'kolaghan'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const cardAdvantage = countPatternMatches(deck, ['draw', 'advantage', 'value', 'engine', 'witness', 'regrowth', 'recur', 'eternal', 'meren', 'kolaghan', 'card']);
      
      if (cardAdvantage >= 10) score += 35;
      else if (cardAdvantage >= 6) score += 20;
      
      if (stats.creatureRatio >= 0.35 && stats.creatureRatio <= 0.55) score += 25;
      
      if (stats.avgCmc >= 2.5 && stats.avgCmc <= 4.0) score += 20;
      
      return score;
    },
  },

  // === COMBO ARCHETYPES (3) ===
  {
    name: 'Storm',
    category: 'combo',
    description: 'Cast many spells in one turn to build storm count for game-winning finish',
    minCreatureRatio: 0,
    maxCreatureRatio: 0.2,
    avgCmcRange: [1.5, 3.0],
    cardPatterns: ['storm', 'tendrils', 'past in flames', 'dark ritual', 'cabal ritual', 'mana crypt', 'cantrip', 'ritual', 'yawning portal'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const cantrips = countPatternMatches(deck, ['draw', 'cantrip', 'opt', 'peek', 'anticipate', 'serum', 'sleight', 'probe']);
      const rituals = countPatternMatches(deck, ['ritual', 'dark ritual', 'cabal ritual', 'seething song', 'pyretic ritual', 'mana crypt', 'sol ring']);
      
      if (cantrips >= 15) score += 35;
      else if (cantrips >= 10) score += 20;
      
      if (rituals >= 8) score += 35;
      else if (rituals >= 4) score += 20;
      
      if (stats.creatureRatio <= 0.15) score += 15;
      
      if (stats.avgCmc >= 1.5 && stats.avgCmc <= 3.0) score += 15;
      
      return score;
    },
  },
  {
    name: 'Reanimator',
    category: 'combo',
    description: 'Put big creatures into graveyard then return them to battlefield',
    minCreatureRatio: 0.3,
    maxCreatureRatio: 0.6,
    avgCmcRange: [2.5, 4.5],
    cardPatterns: ['reanimate', 'animate dead', 'necromancy', 'exhume', 'entomb', 'griselbrand', 'archon', 'shadowspear', 'graveyard', 'recur'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const reanimation = countPatternMatches(deck, ['reanimate', 'animate dead', 'necromancy', 'exhume', 'dance', 'return', 'recur', 'rise']);
      const graveyardSetup = countPatternMatches(deck, ['entomb', 'buried', 'mill', 'discard', 'cemetery', 'graveyard', 'loot', 'rummage']);

      if (reanimation >= 6) score += 45;
      else if (reanimation >= 4) score += 30;
      else if (reanimation >= 2) score += 15;

      if (graveyardSetup >= 6) score += 35;
      else if (graveyardSetup >= 3) score += 20;

      if (stats.creatureRatio >= 0.25 && stats.creatureRatio <= 0.6) score += 15;

      return score;
    },
  },
  {
    name: 'Infinite',
    category: 'combo',
    description: 'Two-card or more combinations that create infinite loops',
    minCreatureRatio: 0.2,
    maxCreatureRatio: 0.5,
    avgCmcRange: [2.0, 3.5],
    cardPatterns: ['infinite', 'combo', 'loop', 'thassa', 'oracle', 'kiki', 'exarch', 'splinter', 'twin', 'pact', 'protean'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const comboPieces = countPatternMatches(deck, ['infinite', 'combo', 'loop', 'thassa', 'oracle', 'kiki', 'exarch', 'splinter', 'twin', 'pact', 'protean', 'hulk', 'dramatic', 'reversal']);
      const tutors = countPatternMatches(deck, ['tutor', 'search', 'fetch', 'find', 'transmute', 'transfigure', 'congregate', 'assemble']);
      const protection = countPatternMatches(deck, ['protection', 'counterspell', 'deflect', 'foil', 'guard', 'shield', 'safe', 'untargetable']);
      
      if (comboPieces >= 10) score += 35;
      else if (comboPieces >= 6) score += 20;
      
      if (tutors >= 8) score += 25;
      else if (tutors >= 4) score += 15;
      
      if (protection >= 6) score += 20;
      
      return score;
    },
  },

  // === TRIBAL ARCHETYPES (4) ===
  {
    name: 'Elves',
    category: 'tribal',
    description: 'Elf tribal synergy with ramp and massive board presence',
    minCreatureRatio: 0.55,
    maxCreatureRatio: 0.8,
    avgCmcRange: [1.8, 3.2],
    cardPatterns: ['elf', 'elvish', 'heritage druid', 'wirewood', 'craterhoof', 'ezuri', 'imperator', 'archdruid'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const elves = countPatternMatches(deck, ['elf', 'elvish']);
      const elfRatio = elves / Math.max(stats.creatureCount, 1);
      const lords = countPatternMatches(deck, ['lord', 'archdruid', 'imperator', 'ezuri', 'caller', 'shaman']);
      const ramp = countPatternMatches(deck, ['ramp', 'mana', 'accelerate', 'cultivate', 'signet', 'stone']);
      
      // Must have significant elf count
      if (elves >= 18) score += 50;
      else if (elves >= 12) score += 40;
      else if (elves >= 8) score += 25;
      else if (elves >= 4) score += 15;
      else return score; // Not Elves without enough elves
      
      if (elfRatio >= 0.6) score += 20;
      else if (elfRatio >= 0.45) score += 15;
      
      if (lords >= 4) score += 15;
      else if (lords >= 2) score += 10;
      
      if (ramp >= 6) score += 15;
      else if (ramp >= 3) score += 10;
      
      if (stats.creatureRatio >= 0.5) score += 10;
      
      return score;
    },
  },
  {
    name: 'Goblins',
    category: 'tribal',
    description: 'Goblin tribal synergy with lords and sacrifice outlets',
    minCreatureRatio: 0.55,
    maxCreatureRatio: 0.8,
    avgCmcRange: [1.5, 2.8],
    cardPatterns: ['goblin', 'goblin king', 'muxus', 'krenko', 'mob', 'warren', 'warlord', 'chieftain'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const goblins = countPatternMatches(deck, ['goblin']);
      const goblinRatio = goblins / Math.max(stats.creatureCount, 1);
      const lords = countPatternMatches(deck, ['king', 'warlord', 'chieftain', 'boss', 'muxus', 'krenko', 'matron']);
      const sacrifice = countPatternMatches(deck, ['sacrifice', 'offering', 'munitions', 'explosion', 'bomb']);
      
      if (goblinRatio >= 0.6) score += 40;
      else if (goblinRatio >= 0.45) score += 25;
      
      if (lords >= 6) score += 20;
      else if (lords >= 3) score += 10;
      
      if (sacrifice >= 4) score += 15;
      
      if (stats.avgCmc <= 2.8) score += 10;
      
      return score;
    },
  },
  {
    name: 'Zombies',
    category: 'tribal',
    description: 'Zombie tribal synergy with graveyard recursion',
    minCreatureRatio: 0.5,
    maxCreatureRatio: 0.75,
    avgCmcRange: [2.0, 3.5],
    cardPatterns: ['zombie', 'lich', 'skeleton', 'undead', 'graveyard', 'recur', 'return', 'rise', 'death', 'necro'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const zombies = countPatternMatches(deck, ['zombie', 'lich', 'skeleton', 'undead']);
      const zombieRatio = zombies / Math.max(stats.creatureCount, 1);
      const graveyard = countPatternMatches(deck, ['graveyard', 'recur', 'return', 'rise', 'death', 'necro', 'entomb', 'reanimate']);
      
      if (zombieRatio >= 0.6) score += 40;
      else if (zombieRatio >= 0.45) score += 25;
      
      if (graveyard >= 10) score += 30;
      else if (graveyard >= 5) score += 15;
      
      return score;
    },
  },
  {
    name: 'Dragons',
    category: 'tribal',
    description: 'Dragon tribal with ramp for big flying threats',
    minCreatureRatio: 0.35,
    maxCreatureRatio: 0.6,
    avgCmcRange: [3.5, 5.5],
    cardPatterns: ['dragon', 'drake', 'wyrm', 'kolaghan', 'atarka', 'silumgar', 'oshiek', 'utvara', 'scion'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const dragons = countPatternMatches(deck, ['dragon', 'drake', 'wyrm']);
      const dragonRatio = dragons / Math.max(stats.creatureCount, 1);
      const ramp = countPatternMatches(deck, ['ramp', 'mana', 'accelerate', 'cultivate', 'signet', 'stone', 'sol ring']);
      
      if (dragonRatio >= 0.4) score += 40;
      else if (dragonRatio >= 0.25) score += 25;
      
      if (ramp >= 10) score += 25;
      else if (ramp >= 6) score += 15;
      
      if (stats.avgCmc >= 3.5) score += 15;
      
      if (getKeywordCount(stats, 'flying') >= 10) score += 10;
      
      return score;
    },
  },

  // === SPECIAL ARCHETYPES (2) ===
  {
    name: 'Lands',
    category: 'special',
    description: 'Land-focused strategy with land recursion and utility',
    minCreatureRatio: 0,
    maxCreatureRatio: 0.15,
    landRatio: [0.5, 0.7],
    avgCmcRange: [2.0, 3.5],
    cardPatterns: ['land', 'field', 'forest', 'island', 'swamp', 'mountain', 'plains', 'recur', 'return', 'fetch', 'utility', 'manland'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      
      // Lands archetype requires very high land ratio
      if (stats.landRatio >= 0.5 && stats.landRatio <= 0.7) score += 30;
      else if (stats.landRatio >= 0.45) score += 15;
      
      // Must have very few creatures
      if (stats.creatureRatio <= 0.1) score += 20;
      else if (stats.creatureRatio <= 0.15) score += 10;
      
      // Must have land recursion
      const landRecursion = countPatternMatches(deck, ['crucible', 'ramunap', 'witness', 'regrowth', 'land recursion', 'fetch land']);
      if (landRecursion >= 6) score += 35;
      else if (landRecursion >= 3) score += 20;
      else score -= 20; // Penalize if no land recursion
      
      // Must have land utility
      const landUtility = countPatternMatches(deck, ['manland', 'utility', 'bojuka', 'castle', 'field of the dead']);
      if (landUtility >= 4) score += 15;
      
      return Math.max(0, score);
    },
  },
  {
    name: 'Superfriends',
    category: 'special',
    description: 'Planeswalker-heavy deck with protection and value',
    minCreatureRatio: 0,
    maxCreatureRatio: 0.25,
    avgCmcRange: [3.0, 4.5],
    cardPatterns: ['planeswalker', 'walker', 'chandra', 'jace', 'liliana', 'gideon', 'ajani', 'teferi', 'sarkhan', 'vivi'],
    scoreFunction: (deck, stats) => {
      let score = 0;
      const planeswalkers = stats.cardTypes.planeswalker || 0;
      const pwRatio = planeswalkers / Math.max(stats.totalCards, 1);
      const protection = countPatternMatches(deck, ['protection', 'counterspell', 'deflect', 'foil', 'guard', 'shield', 'safe', 'heroic intervention']);
      
      if (pwRatio >= 0.2) score += 45;
      else if (pwRatio >= 0.12) score += 30;
      else if (pwRatio >= 0.06) score += 15;
      
      if (protection >= 8) score += 30;
      else if (protection >= 4) score += 15;
      
      if (stats.creatureRatio <= 0.15) score += 15;
      else if (stats.creatureRatio <= 0.25) score += 10;
      
      return score;
    },
  },
];

/**
 * Get archetype by name
 */
export function getArchetypeByName(name: string): ArchetypeSignature | undefined {
  return ARCHETYPE_SIGNATURES.find(a => a.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get all archetypes in a category
 */
export function getArchetypesByCategory(category: string): ArchetypeSignature[] {
  return ARCHETYPE_SIGNATURES.filter(a => a.category === category);
}

/**
 * Get all available archetype names
 */
export function getAvailableArchetypeNames(): string[] {
  return ARCHETYPE_SIGNATURES.map(a => a.name);
}

/**
 * @fileOverview Synergy detection for Magic: The Gathering decks
 *
 * Defines synergy signatures and scoring for identifying card combinations
 * that work well together.
 */

import type { DeckCard } from '@/app/actions';
import { SYNERGY_DATABASE, getSynergiesByType, type SynergyType } from './synergy-database';

/**
 * Synergy detection result
 */
export interface SynergyResult {
  /** Synergy name */
  name: string;
  /** Score (0-100) */
  score: number;
  /** Cards contributing to synergy */
  cards: string[];
  /** Description of the synergy */
  description: string;
  /** Synergy category */
  category: string;
  /** Synergy ID for reference */
  id?: string;
  /** Tribal information (if applicable) */
  tribalInfo?: TribalSynergyInfo;
  /** Total count of cards (with multiplicity) */
  totalCount?: number;
}

/**
 * Tribal synergy information
 */
export interface TribalSynergyInfo {
  /** Tribe name */
  tribe: string;
  /** Count of tribe members in deck */
  tribeMemberCount: number;
  /** Cards that are off-tribe (don't belong to the tribe) */
  offTribeCards: string[];
  /** Percentage of deck that is on-tribe */
  tribalDensity: number;
  /** Recommended tribal enhancements */
  recommendations: string[];
}

/**
 * Missing synergy information
 */
export interface MissingSynergy {
  /** Synergy name */
  synergy: string;
  /** What's missing */
  missing: string;
  /** Description of what's missing */
  description: string;
  /** Suggested card(s) to add */
  suggestion: string;
  /** Impact level if added */
  impact: 'high' | 'medium' | 'low';
}

/**
 * Synergy signature for detection
 */
export interface SynergySignature {
  /** Synergy name */
  name: string;
  /** Category (tribal, mechanic, engine, combo, etc.) */
  category: string;
  /** Required card patterns for synergy */
  requiredCards: string[];
  /** Bonus cards that enhance synergy */
  bonusCards?: string[];
  /** Minimum cards needed for synergy to register */
  minimumCards: number;
  /** Description of the synergy */
  description: string;
  /** Scoring function */
  scoreFunction: (deck: DeckCard[]) => SynergyResult;
}

/**
 * Helper to count cards matching patterns
 */
function countMatchingCards(deck: DeckCard[], patterns: string[]): { count: number; cards: string[] } {
  const matchedCards: string[] = [];
  let count = 0;

  for (const card of deck) {
    const name = card.name.toLowerCase();
    const text = (card.oracle_text || '').toLowerCase();
    const type = (card.type_line || '').toLowerCase();
    const combined = `${name} ${text} ${type}`;

    for (const pattern of patterns) {
      if (combined.includes(pattern.toLowerCase())) {
        count += card.count;
        if (!matchedCards.includes(card.name)) {
          matchedCards.push(card.name);
        }
        break;
      }
    }
  }

  return { count, cards: matchedCards };
}

/**
 * Tribal patterns for tribe detection
 */
const TRIBAL_PATTERNS: Record<string, string[]> = {
  elves: ['elf', 'elvish'],
  goblins: ['goblin'],
  zombies: ['zombie', 'lich', 'skeleton', 'undead'],
  dragons: ['dragon', 'drake', 'wyrm'],
  vampires: ['vampire'],
  merfolk: ['merfolk'],
  humans: ['human'],
};

/**
 * Detect which tribe a deck is focused on
 */
export function detectTribalAffiliation(deck: DeckCard[]): { tribe: string | null; memberCount: number; density: number } {
  const tribeScores: Record<string, { count: number; cards: string[] }> = {};

  // Initialize tribe scores
  for (const [tribe, patterns] of Object.entries(TRIBAL_PATTERNS)) {
    const result = countMatchingCards(deck, patterns);
    tribeScores[tribe] = { count: result.count, cards: result.cards };
  }

  // Find the dominant tribe
  let dominantTribe: string | null = null;
  let maxCount = 0;

  for (const [tribe, data] of Object.entries(tribeScores)) {
    if (data.count > maxCount) {
      maxCount = data.count;
      dominantTribe = tribe;
    }
  }

  // Calculate tribal density (percentage of creature cards that belong to the tribe)
  const totalCreatures = deck.filter(c => c.type_line?.toLowerCase().includes('creature')).reduce((sum, c) => sum + c.count, 0);
  const density = totalCreatures > 0 ? (maxCount / totalCreatures) * 100 : 0;

  // Only return a tribe if it has at least 5 members and decent density
  if (maxCount >= 5 && density >= 30) {
    return { tribe: dominantTribe, memberCount: maxCount, density };
  }

  return { tribe: null, memberCount: 0, density: 0 };
}

/**
 * Identify off-tribe cards in a tribal deck
 */
export function identifyOffTribeCards(deck: DeckCard[], tribe: string): string[] {
  const patterns = TRIBAL_PATTERNS[tribe];
  if (!patterns) return [];

  const offTribeCards: string[] = [];

  for (const card of deck) {
    // Skip lands and non-creatures
    if (!card.type_line?.toLowerCase().includes('creature')) continue;

    const name = card.name.toLowerCase();
    const text = (card.oracle_text || '').toLowerCase();
    const type = (card.type_line || '').toLowerCase();
    const combined = `${name} ${text} ${type}`;

    // Check if card belongs to the tribe
    const isTribeMember = patterns.some(pattern => combined.includes(pattern.toLowerCase()));

    if (!isTribeMember) {
      if (!offTribeCards.includes(card.name)) {
        offTribeCards.push(card.name);
      }
    }
  }

  return offTribeCards;
}

/**
 * Get tribal enhancement recommendations
 */
export function getTribalRecommendations(tribe: string, tribeMemberCount: number, offTribeCardCount: number): string[] {
  const recommendations: string[] = [];

  if (offTribeCardCount > 5) {
    recommendations.push(`Consider replacing ${Math.min(offTribeCardCount, 8)} off-tribe creatures with additional ${tribe} to strengthen your tribal synergy`);
  }

  if (tribeMemberCount >= 10 && tribeMemberCount < 15) {
    recommendations.push(`You have a solid ${tribe} foundation. Adding 3-5 more ${tribe} creatures would maximize tribal synergy`);
  }

  if (tribeMemberCount >= 15) {
    recommendations.push(`Excellent ${tribe} density! Focus on tribal lords and payoff cards to maximize your advantage`);
  }

  // Tribe-specific recommendations
  switch (tribe) {
    case 'elves':
      recommendations.push('Consider Elvish Archdruid or Ezuri, Renegade Leader as tribal lords');
      recommendations.push('Craterhoof Behemoth is a powerful finisher for elf decks');
      break;
    case 'goblins':
      recommendations.push('Consider Goblin Warchief or Muxus, Goblin Grandee as tribal lords');
      recommendations.push('Goblin Matron can help you find key goblins when needed');
      break;
    case 'zombies':
      recommendations.push('Consider Cemetery Reaper or Relentless Dead for graveyard recursion');
      recommendations.push('Lord of the Accursed can give your zombies menace for evasion');
      break;
    case 'dragons':
      recommendations.push('Consider Dragonlord Kolaghan or Dragonlord Ojutai as tribal lords');
      recommendations.push('Ensure you have enough ramp to cast your dragons on time');
      break;
    case 'vampires':
      recommendations.push('Consider Edgar Markov or Bloodlord of Vaasgoth as tribal lords');
      recommendations.push('Blood Artist provides value whenever creatures die');
      break;
    case 'merfolk':
      recommendations.push('Consider Master of the Pearl Trident or Lord of Atlantis as tribal lords');
      recommendations.push('Spreading Seas can give your merfolk unblockable attacks');
      break;
    case 'humans':
      recommendations.push('Consider Thalia\'s Lieutenant or Kessig Malcontents as tribal payoffs');
      recommendations.push('Thalia, Guardian of Thraben provides tempo disruption');
      break;
  }

  return recommendations;
}

/**
 * Synergy signatures database - 20 synergies across categories
 */
export const SYNERGY_SIGNATURES: SynergySignature[] = [
  // === TRIBAL SYNERGIES (7) ===
  {
    name: 'Elves Tribal',
    category: 'tribal',
    description: 'Elf creatures working together with lords and ramp',
    requiredCards: ['elf', 'elvish'],
    bonusCards: ['heritage druid', 'wirewood', 'ezuri', 'craterhoof', 'imperator', 'archdruid'],
    minimumCards: 10,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['elf', 'elvish']);
      const { count: bonusCount } = countMatchingCards(deck, ['heritage druid', 'wirewood', 'ezuri', 'craterhoof', 'imperator', 'archdruid', 'lord']);

      let score = 0;
      if (count >= 20) score = 95;
      else if (count >= 15) score = 85;
      else if (count >= 10) score = 70;
      else if (count >= 6) score = 50;
      else score = Math.min(40, count * 6);

      score = Math.min(100, score + bonusCount * 3);

      return { name: 'Elves Tribal', score, cards, description: 'Elf tribal synergy', category: 'tribal' };
    },
  },
  {
    name: 'Goblin Tribal',
    category: 'tribal',
    description: 'Goblin creatures with lords and sacrifice outlets',
    requiredCards: ['goblin'],
    bonusCards: ['krenko', 'muxus', 'warren', 'king', 'warlord', 'chieftain', 'matron'],
    minimumCards: 10,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['goblin']);
      const { count: bonusCount } = countMatchingCards(deck, ['krenko', 'muxus', 'warren', 'king', 'warlord', 'chieftain', 'matron', 'boss']);

      let score = 0;
      if (count >= 20) score = 95;
      else if (count >= 15) score = 85;
      else if (count >= 10) score = 70;
      else if (count >= 6) score = 50;
      else score = Math.min(40, count * 6);

      score = Math.min(100, score + bonusCount * 3);

      return { name: 'Goblin Tribal', score, cards, description: 'Goblin tribal synergy', category: 'tribal' };
    },
  },
  {
    name: 'Zombie Tribal',
    category: 'tribal',
    description: 'Zombie creatures with graveyard recursion',
    requiredCards: ['zombie', 'lich', 'skeleton', 'undead'],
    bonusCards: ['graveyard', 'recur', 'reanimate', 'return', 'rise', 'death', 'necro'],
    minimumCards: 12,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['zombie', 'lich', 'skeleton', 'undead']);
      const { count: bonusCount } = countMatchingCards(deck, ['graveyard', 'recur', 'reanimate', 'return', 'rise', 'death', 'necro']);

      let score = 0;
      if (count >= 18) score = 95;
      else if (count >= 12) score = 80;
      else if (count >= 8) score = 60;
      else if (count >= 4) score = 40;
      else score = Math.min(30, count * 5);

      score = Math.min(100, score + bonusCount * 2);

      return { name: 'Zombie Tribal', score, cards, description: 'Zombie tribal with graveyard synergy', category: 'tribal' };
    },
  },
  {
    name: 'Dragon Tribal',
    category: 'tribal',
    description: 'Dragon creatures with ramp for big threats',
    requiredCards: ['dragon', 'drake', 'wyrm'],
    bonusCards: ['ramp', 'mana', 'accelerate', 'cultivate', 'signet', 'kolaghan', 'atarka'],
    minimumCards: 8,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['dragon', 'drake', 'wyrm']);
      const { count: bonusCount } = countMatchingCards(deck, ['ramp', 'mana', 'accelerate', 'cultivate', 'signet', 'stone', 'kolaghan', 'atarka']);

      let score = 0;
      if (count >= 12) score = 95;
      else if (count >= 8) score = 80;
      else if (count >= 5) score = 60;
      else if (count >= 3) score = 40;
      else score = Math.min(30, count * 5);

      score = Math.min(100, score + bonusCount * 2);

      return { name: 'Dragon Tribal', score, cards, description: 'Dragon tribal with ramp', category: 'tribal' };
    },
  },
  {
    name: 'Vampire Tribal',
    category: 'tribal',
    description: 'Vampire creatures with life drain and card advantage',
    requiredCards: ['vampire'],
    bonusCards: ['bloodlord', 'bloodghast', 'blood artist', 'edgar', 'sorin'],
    minimumCards: 10,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['vampire']);
      const { count: bonusCount } = countMatchingCards(deck, ['bloodlord', 'bloodghast', 'blood artist', 'edgar', 'sorin', 'captain']);

      let score = 0;
      if (count >= 18) score = 90;
      else if (count >= 12) score = 75;
      else if (count >= 8) score = 55;
      else if (count >= 5) score = 35;
      else score = Math.min(25, count * 5);

      score = Math.min(100, score + bonusCount * 3);

      return { name: 'Vampire Tribal', score, cards, description: 'Vampire tribal with life drain', category: 'tribal' };
    },
  },
  {
    name: 'Merfolk Tribal',
    category: 'tribal',
    description: 'Merfolk creatures with lords and unblockable threats',
    requiredCards: ['merfolk'],
    bonusCards: ['lord', 'master', 'reejerey', 'coralhelm', 'seer'],
    minimumCards: 10,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['merfolk']);
      const { count: bonusCount } = countMatchingCards(deck, ['master of the pearl', 'lord of atlantis', 'reejerey', 'coralhelm', 'seer']);

      let score = 0;
      if (count >= 18) score = 90;
      else if (count >= 12) score = 75;
      else if (count >= 8) score = 55;
      else if (count >= 5) score = 35;
      else score = Math.min(25, count * 5);

      score = Math.min(100, score + bonusCount * 3);

      return { name: 'Merfolk Tribal', score, cards, description: 'Merfolk tribal with islandwalk', category: 'tribal', totalCount: count };
    },
  },
  {
    name: 'Human Tribal',
    category: 'tribal',
    description: 'Human creatures with anthem effects and tempo disruption',
    requiredCards: ['human'],
    bonusCards: ['thalia', 'kessig', 'champion', 'lieutenant', 'captain'],
    minimumCards: 12,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['human']);
      const { count: bonusCount } = countMatchingCards(deck, ['thalia', 'kessig', 'champion', 'lieutenant', 'captain']);

      let score = 0;
      if (count >= 20) score = 90;
      else if (count >= 14) score = 75;
      else if (count >= 10) score = 60;
      else if (count >= 6) score = 40;
      else score = Math.min(30, count * 5);

      score = Math.min(100, score + bonusCount * 2);

      return { name: 'Human Tribal', score, cards, description: 'Human tribal with anthems', category: 'tribal' };
    },
  },

  // === MECHANIC SYNERGIES (4) ===
  {
    name: 'Flying Squadron',
    category: 'mechanic',
    description: 'Multiple flying creatures for aerial dominance',
    requiredCards: ['flying'],
    bonusCards: ['evasion', 'unblockable', 'airborne'],
    minimumCards: 4,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['flying']);
      const { count: bonusCount } = countMatchingCards(deck, ['evasion', 'unblockable', 'airborne']);
      
      let score = 0;
      if (count >= 15) score = 90;
      else if (count >= 10) score = 80;
      else if (count >= 6) score = 65;
      else if (count >= 4) score = 50;
      else if (count >= 2) score = 35;
      else score = Math.min(25, count * 10);
      
      score = Math.min(100, score + bonusCount * 3);
      
      return { name: 'Flying Squadron', score, cards, description: 'Flying creatures synergy', category: 'mechanic' };
    },
  },
  {
    name: 'Deathtouch Pack',
    category: 'mechanic',
    description: 'Deathtouch creatures for efficient trading',
    requiredCards: ['deathtouch'],
    bonusCards: ['reach', 'fight', 'block'],
    minimumCards: 6,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['deathtouch']);
      const { count: bonusCount } = countMatchingCards(deck, ['reach', 'fight', 'block']);
      
      let score = 0;
      if (count >= 12) score = 85;
      else if (count >= 8) score = 70;
      else if (count >= 5) score = 50;
      else if (count >= 3) score = 30;
      else score = Math.min(20, count * 5);
      
      score = Math.min(100, score + bonusCount * 2);
      
      return { name: 'Deathtouch Pack', score, cards, description: 'Deathtouch creatures synergy', category: 'mechanic' };
    },
  },
  {
    name: 'Trample Charge',
    category: 'mechanic',
    description: 'Trample creatures for efficient damage',
    requiredCards: ['trample'],
    bonusCards: ['pump', 'growth', 'might', 'strength', 'overrun'],
    minimumCards: 6,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['trample']);
      const { count: bonusCount } = countMatchingCards(deck, ['pump', 'growth', 'might', 'strength', 'overrun']);
      
      let score = 0;
      if (count >= 12) score = 85;
      else if (count >= 8) score = 70;
      else if (count >= 5) score = 50;
      else if (count >= 3) score = 30;
      else score = Math.min(20, count * 5);
      
      score = Math.min(100, score + bonusCount * 3);
      
      return { name: 'Trample Charge', score, cards, description: 'Trample creatures synergy', category: 'mechanic' };
    },
  },
  {
    name: 'Haste Assault',
    category: 'mechanic',
    description: 'Haste creatures for immediate impact',
    requiredCards: ['haste'],
    bonusCards: ['attack', 'damage', 'first strike', 'double strike'],
    minimumCards: 6,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['haste']);
      const { count: bonusCount } = countMatchingCards(deck, ['attack', 'damage', 'first strike', 'double strike']);
      
      let score = 0;
      if (count >= 12) score = 85;
      else if (count >= 8) score = 70;
      else if (count >= 5) score = 50;
      else if (count >= 3) score = 30;
      else score = Math.min(20, count * 5);
      
      score = Math.min(100, score + bonusCount * 2);
      
      return { name: 'Haste Assault', score, cards, description: 'Haste creatures synergy', category: 'mechanic' };
    },
  },

  // === ENGINE SYNERGIES (4) ===
  {
    name: 'Card Draw Engine',
    category: 'engine',
    description: 'Multiple sources of card advantage',
    requiredCards: ['draw', 'card'],
    bonusCards: ['advantage', 'loot', 'rummage', 'scry', 'explore', 'investigate'],
    minimumCards: 8,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['draw', 'card draw', 'draw cards']);
      const { count: bonusCount } = countMatchingCards(deck, ['advantage', 'loot', 'rummage', 'scry', 'explore', 'investigate']);
      
      let score = 0;
      if (count >= 15) score = 95;
      else if (count >= 10) score = 80;
      else if (count >= 6) score = 60;
      else if (count >= 4) score = 40;
      else score = Math.min(30, count * 5);
      
      score = Math.min(100, score + bonusCount * 2);
      
      return { name: 'Card Draw Engine', score, cards, description: 'Card advantage engine', category: 'engine' };
    },
  },
  {
    name: 'Ramp Engine',
    category: 'engine',
    description: 'Mana acceleration for faster plays',
    requiredCards: ['ramp', 'mana'],
    bonusCards: ['accelerate', 'cultivate', 'kodama', 'signet', 'stone', 'sol ring', 'crystal'],
    minimumCards: 4,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['ramp', 'mana', 'accelerate']);
      const { count: bonusCount } = countMatchingCards(deck, ['cultivate', 'kodama', 'signet', 'stone', 'sol ring', 'crystal', 'gem', 'mana rock']);
      
      let score = 0;
      if (count >= 15) score = 95;
      else if (count >= 10) score = 85;
      else if (count >= 6) score = 70;
      else if (count >= 4) score = 55;
      else if (count >= 2) score = 40;
      else score = Math.min(30, count * 8);
      
      score = Math.min(100, score + bonusCount * 3);
      
      return { name: 'Ramp Engine', score, cards, description: 'Mana acceleration engine', category: 'engine' };
    },
  },
  {
    name: 'Removal Suite',
    category: 'engine',
    description: 'Comprehensive removal for threats',
    requiredCards: ['destroy', 'removal', 'exile'],
    bonusCards: ['banish', 'kill', 'murder', 'doom', 'victim', 'terminate', 'path'],
    minimumCards: 8,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['destroy', 'removal', 'exile', 'banish']);
      const { count: bonusCount } = countMatchingCards(deck, ['kill', 'murder', 'doom', 'victim', 'terminate', 'path', 'wrath', 'sweep']);
      
      let score = 0;
      if (count >= 15) score = 90;
      else if (count >= 10) score = 75;
      else if (count >= 6) score = 55;
      else if (count >= 4) score = 35;
      else score = Math.min(25, count * 5);
      
      score = Math.min(100, score + bonusCount * 2);
      
      return { name: 'Removal Suite', score, cards, description: 'Comprehensive removal', category: 'engine' };
    },
  },
  {
    name: 'Counterspell Suite',
    category: 'engine',
    description: 'Multiple counterspells for interaction',
    requiredCards: ['counter', 'negate'],
    bonusCards: ['deny', 'forbid', 'essence scatter', 'mystic', 'force', 'drain'],
    minimumCards: 6,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['counter', 'negate', 'counterspell']);
      const { count: bonusCount } = countMatchingCards(deck, ['deny', 'forbid', 'essence scatter', 'mystic', 'force', 'drain', 'cancel']);
      
      let score = 0;
      if (count >= 12) score = 90;
      else if (count >= 8) score = 75;
      else if (count >= 5) score = 55;
      else if (count >= 3) score = 35;
      else score = Math.min(25, count * 5);
      
      score = Math.min(100, score + bonusCount * 2);
      
      return { name: 'Counterspell Suite', score, cards, description: 'Counterspell interaction', category: 'engine' };
    },
  },

  // === COMBO SYNERGIES (4) ===
  {
    name: 'Reanimation Combo',
    category: 'combo',
    description: 'Reanimate big creatures from graveyard',
    requiredCards: ['reanimate', 'animate dead', 'necromancy', 'exhume'],
    bonusCards: ['entomb', 'buried', 'graveyard', 'big creature', 'griselbrand', 'archon'],
    minimumCards: 3,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['reanimate', 'animate dead', 'necromancy', 'exhume', 'dance', 'return']);
      const { count: bonusCount } = countMatchingCards(deck, ['entomb', 'buried', 'graveyard', 'griselbrand', 'archon', 'big creature']);
      
      let score = 0;
      if (count >= 8) score = 95;
      else if (count >= 5) score = 85;
      else if (count >= 3) score = 70;
      else if (count >= 2) score = 50;
      else score = Math.min(40, count * 15);
      
      score = Math.min(100, score + bonusCount * 3);
      
      return { name: 'Reanimation Combo', score, cards, description: 'Reanimate creatures from graveyard', category: 'combo' };
    },
  },
  {
    name: 'Storm Combo',
    category: 'combo',
    description: 'Cast many spells for storm finish',
    requiredCards: ['storm', 'ritual', 'cantrip'],
    bonusCards: ['tendrils', 'past in flames', 'dark ritual', 'cabal ritual', 'mana crypt'],
    minimumCards: 10,
    scoreFunction: (deck) => {
      const ritualCount = countMatchingCards(deck, ['ritual', 'dark ritual', 'cabal ritual', 'seething song', 'pyretic']);
      const cantripCount = countMatchingCards(deck, ['draw', 'cantrip', 'opt', 'peek', 'serum', 'probe']);
      const finisherCount = countMatchingCards(deck, ['storm', 'tendrils', 'past in flames', 'mind desire']);
      
      const total = ritualCount.count + cantripCount.count + finisherCount.count;
      const cards = [...ritualCount.cards, ...cantripCount.cards, ...finisherCount.cards];
      
      let score = 0;
      if (total >= 25) score = 95;
      else if (total >= 18) score = 80;
      else if (total >= 12) score = 60;
      else if (total >= 8) score = 40;
      else score = Math.min(30, total * 3);
      
      score = Math.min(100, score + finisherCount.count * 5);
      
      return { name: 'Storm Combo', score, cards, description: 'Storm combo finish', category: 'combo' };
    },
  },
  {
    name: 'Token Army',
    category: 'combo',
    description: 'Generate creature tokens for board presence',
    requiredCards: ['token', 'create', 'generate'],
    bonusCards: ['anthem', 'lord', 'procession', 'lives', 'virtue', 'secure'],
    minimumCards: 4,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['token', 'create', 'generate', 'army', 'soldier']);
      const { count: bonusCount } = countMatchingCards(deck, ['anthem', 'lord', 'procession', 'lives', 'virtue', 'secure', 'mass']);
      
      let score = 0;
      if (count >= 15) score = 90;
      else if (count >= 10) score = 80;
      else if (count >= 6) score = 65;
      else if (count >= 4) score = 50;
      else if (count >= 2) score = 35;
      else score = Math.min(25, count * 8);
      
      score = Math.min(100, score + bonusCount * 3);
      
      return { name: 'Token Army', score, cards, description: 'Token generation synergy', category: 'combo' };
    },
  },
  {
    name: 'Infinite Combo',
    category: 'combo',
    description: 'Two-card or more infinite combinations',
    requiredCards: ['infinite', 'combo', 'loop'],
    bonusCards: ['thassa', 'oracle', 'kiki', 'exarch', 'splinter', 'twin', 'protean', 'hulk'],
    minimumCards: 6,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['infinite', 'combo', 'loop', 'thassa', 'oracle', 'kiki', 'exarch', 'splinter', 'twin']);
      const { count: bonusCount } = countMatchingCards(deck, ['protean', 'hulk', 'dramatic', 'reversal', 'pact', 'tutor']);
      
      let score = 0;
      if (count >= 12) score = 95;
      else if (count >= 8) score = 80;
      else if (count >= 5) score = 60;
      else if (count >= 3) score = 40;
      else score = Math.min(30, count * 5);
      
      score = Math.min(100, score + bonusCount * 3);
      
      return { name: 'Infinite Combo', score, cards, description: 'Infinite combination potential', category: 'combo' };
    },
  },

  // === SPECIAL SYNERGIES (4) ===
  {
    name: 'Land Synergy',
    category: 'special',
    description: 'Land-focused strategy with recursion',
    requiredCards: ['land', 'field'],
    bonusCards: ['recur', 'return', 'fetch', 'search', 'crucible', 'ramunap', 'utility', 'manland'],
    minimumCards: 20,
    scoreFunction: (deck) => {
      const landCount = deck.filter(c => c.type_line?.toLowerCase().includes('land')).reduce((sum, c) => sum + c.count, 0);
      const { count: bonusCount, cards } = countMatchingCards(deck, ['recur', 'return', 'fetch', 'search', 'crucible', 'ramunap', 'utility', 'manland']);
      
      let score = 0;
      if (landCount >= 35) score = 90;
      else if (landCount >= 28) score = 75;
      else if (landCount >= 22) score = 55;
      else if (landCount >= 18) score = 35;
      else score = Math.min(25, landCount);
      
      score = Math.min(100, score + bonusCount * 3);
      
      return { name: 'Land Synergy', score, cards, description: 'Land-focused strategy', category: 'special' };
    },
  },
  {
    name: 'Planeswalker Value',
    category: 'special',
    description: 'Multiple planeswalkers for value',
    requiredCards: ['planeswalker'],
    bonusCards: ['walker', 'chandra', 'jace', 'liliana', 'gideon', 'ajani', 'teferi', 'protection'],
    minimumCards: 4,
    scoreFunction: (deck) => {
      const { count, cards } = countMatchingCards(deck, ['planeswalker']);
      const { count: bonusCount } = countMatchingCards(deck, ['walker', 'chandra', 'jace', 'liliana', 'gideon', 'ajani', 'teferi', 'protection']);
      
      let score = 0;
      if (count >= 10) score = 95;
      else if (count >= 6) score = 80;
      else if (count >= 4) score = 60;
      else if (count >= 2) score = 40;
      else score = Math.min(30, count * 10);
      
      score = Math.min(100, score + bonusCount * 2);
      
      return { name: 'Planeswalker Value', score, cards, description: 'Planeswalker value engine', category: 'special' };
    },
  },
  {
    name: 'Artifact Synergy',
    category: 'special',
    description: 'Artifact-focused strategy',
    requiredCards: ['artifact'],
    bonusCards: ['construct', 'robot', 'golem', 'equipment', 'module', 'affinity'],
    minimumCards: 12,
    scoreFunction: (deck) => {
      const artifactCount = deck.filter(c => c.type_line?.toLowerCase().includes('artifact')).reduce((sum, c) => sum + c.count, 0);
      const { count: bonusCount, cards } = countMatchingCards(deck, ['construct', 'robot', 'golem', 'equipment', 'module', 'affinity']);
      
      let score = 0;
      if (artifactCount >= 20) score = 90;
      else if (artifactCount >= 14) score = 75;
      else if (artifactCount >= 10) score = 55;
      else if (artifactCount >= 6) score = 35;
      else score = Math.min(25, artifactCount * 2);
      
      score = Math.min(100, score + bonusCount * 3);
      
      return { name: 'Artifact Synergy', score, cards, description: 'Artifact-focused strategy', category: 'special' };
    },
  },
  {
    name: 'Enchantment Synergy',
    category: 'special',
    description: 'Enchantment-focused strategy',
    requiredCards: ['enchantment'],
    bonusCards: ['aura', 'curse', 'shrine', 'saga', 'enchant'],
    minimumCards: 12,
    scoreFunction: (deck) => {
      const enchantmentCount = deck.filter(c => c.type_line?.toLowerCase().includes('enchantment')).reduce((sum, c) => sum + c.count, 0);
      const { count: bonusCount, cards } = countMatchingCards(deck, ['aura', 'curse', 'shrine', 'saga', 'enchant']);
      
      let score = 0;
      if (enchantmentCount >= 20) score = 90;
      else if (enchantmentCount >= 14) score = 75;
      else if (enchantmentCount >= 10) score = 55;
      else if (enchantmentCount >= 6) score = 35;
      else score = Math.min(25, enchantmentCount * 2);
      
      score = Math.min(100, score + bonusCount * 2);
      
      return { name: 'Enchantment Synergy', score, cards, description: 'Enchantment-focused strategy', category: 'special' };
    },
  },
];

/**
 * Detect synergies in a deck
 *
 * @param deck - Array of cards in the deck
 * @param minScore - Minimum score threshold (0-100)
 * @param maxResults - Maximum number of synergies to return
 * @returns Array of synergy results sorted by score
 */
export function detectSynergies(
  deck: DeckCard[],
  minScore: number = 40,
  maxResults: number = 10
): SynergyResult[] {
  if (deck.length === 0) return [];

  const results: SynergyResult[] = [];

  // Detect tribal affiliation first
  const tribalAffiliation = detectTribalAffiliation(deck);

  for (const signature of SYNERGY_SIGNATURES) {
    try {
      const result = signature.scoreFunction(deck);

      // Check minimum cards requirement (use total count with multiplicity, not unique names)
      const cardCount = result.totalCount ?? result.cards.length;
      if (cardCount < signature.minimumCards) {
        // Reduce score proportionally
        result.score = Math.floor(result.score * (cardCount / signature.minimumCards));
      }

      // Add tribal information for tribal synergies
      if (signature.category === 'tribal' && tribalAffiliation.tribe) {
        const tribeName = signature.name.toLowerCase().split(' ')[0]; // Extract "Elves" from "Elves Tribal"
        const tribeMap: Record<string, string> = {
          'elves': 'elves',
          'goblins': 'goblins',
          'zombies': 'zombies',
          'dragons': 'dragons',
          'vampires': 'vampires',
          'merfolk': 'merfolk',
          'humans': 'humans',
        };

        const tribeKey = tribeMap[tribeName];
        if (tribeKey && tribalAffiliation.tribe === tribeKey) {
          const offTribeCards = identifyOffTribeCards(deck, tribalAffiliation.tribe);
          const recommendations = getTribalRecommendations(
            tribalAffiliation.tribe,
            tribalAffiliation.memberCount,
            offTribeCards.length
          );

          result.tribalInfo = {
            tribe: tribalAffiliation.tribe,
            tribeMemberCount: tribalAffiliation.memberCount,
            offTribeCards,
            tribalDensity: tribalAffiliation.density,
            recommendations,
          };
        }
      }

      if (result.score >= minScore) {
        results.push(result);
      }
    } catch (error) {
      console.error(`Error detecting synergy ${signature.name}:`, error);
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Return top results
  return results.slice(0, maxResults);
}

/**
 * Get synergy by name
 */
export function getSynergyByName(name: string): SynergySignature | undefined {
  return SYNERGY_SIGNATURES.find(s => s.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get synergies by category
 */
export function getSynergiesByCategory(category: string): SynergySignature[] {
  return SYNERGY_SIGNATURES.filter(s => s.category === category);
}

/**
 * Get all synergy names
 */
export function getAvailableSynergyNames(): string[] {
  return SYNERGY_SIGNATURES.map(s => s.name);
}

/**
 * Detect missing synergies in a deck based on archetype context
 *
 * @param deck - Array of cards in the deck
 * @param archetype - Detected archetype name (optional, provides context)
 * @returns Array of missing synergy suggestions
 */
export function detectMissingSynergies(
  deck: DeckCard[],
  archetype?: string
): MissingSynergy[] {
  if (deck.length === 0) return [];

  const missing: MissingSynergy[] = [];

  // Check each synergy in the database for missing components
  for (const synergy of SYNERGY_DATABASE) {
    if (!synergy.missingSuggestions) continue;

    // Check if the synergy is partially present in the deck
    const isPartiallyPresent = checkPartialSynergyPresence(deck, synergy);

    if (isPartiallyPresent) {
      // Check each missing suggestion
      for (const suggestion of synergy.missingSuggestions) {
        if (suggestion.condition(deck)) {
          missing.push({
            synergy: synergy.name,
            missing: suggestion.missing,
            description: suggestion.description,
            suggestion: suggestion.suggestion.join(', '),
            impact: suggestion.impact,
          });
        }
      }
    }
  }

  // Add archetype-specific missing synergies
  if (archetype) {
    const archetypeMissing = getArchetypeSpecificMissingSynergies(deck, archetype);
    missing.push(...archetypeMissing);
  }

  // Sort by impact (high > medium > low)
  const impactOrder = { high: 0, medium: 1, low: 2 };
  missing.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);

  // Remove duplicates and limit results
  const seen = new Set<string>();
  return missing.filter(m => {
    const key = `${m.synergy}-${m.missing}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5); // Return top 5 missing synergies
}

/**
 * Check if a synergy is partially present in the deck
 */
function checkPartialSynergyPresence(deck: DeckCard[], synergy: { cards: string[]; minimumCards?: number }): boolean {
  const minCards = synergy.minimumCards || 3;
  let matchCount = 0;

  for (const card of deck) {
    const name = card.name.toLowerCase();
    const text = (card.oracle_text || '').toLowerCase();
    const type = (card.type_line || '').toLowerCase();
    const combined = `${name} ${text} ${type}`;

    for (const pattern of synergy.cards) {
      if (combined.includes(pattern.toLowerCase())) {
        matchCount += card.count;
        break;
      }
    }
  }

  // Consider synergy partially present if we have at least 30% of minimum cards
  return matchCount >= Math.ceil(minCards * 0.3);
}

/**
 * Get archetype-specific missing synergy suggestions
 */
function getArchetypeSpecificMissingSynergies(deck: DeckCard[], archetype: string): MissingSynergy[] {
  const missing: MissingSynergy[] = [];

  // Dragon Tribal specific suggestions
  if (archetype.toLowerCase().includes('dragon')) {
    const dragons = countPattern(deck, ['dragon', 'drake', 'wyrm']);
    const ramp = countPattern(deck, ['ramp', 'mana', 'accelerate', 'cultivate', 'signet', 'stone']);
    const lords = countPattern(deck, ['dragonlord', 'kolaghan', 'atarka', 'silumgar', 'utvara']);

    if (dragons >= 6 && ramp < 8) {
      missing.push({
        synergy: 'Dragon Tribal',
        missing: 'Ramp spells',
        description: `You have ${dragons} dragons but only ${ramp} ramp sources. Dragons need mana acceleration.`,
        suggestion: 'Sol Ring, Arcane Signet, Cultivate, Kodama\'s Reach',
        impact: 'high',
      });
    }

    if (dragons >= 8 && lords < 2) {
      missing.push({
        synergy: 'Dragon Tribal',
        missing: 'Dragon lords',
        description: `You have ${dragons} dragons but no dragon lords to buff them.`,
        suggestion: 'Dragonlord Kolaghan, Dragonlord Ojutai, Utvara Hellkite',
        impact: 'high',
      });
    }
  }

  // Elves Tribal specific suggestions
  if (archetype.toLowerCase().includes('elf')) {
    const elves = countPattern(deck, ['elf', 'elvish']);
    const lords = countPattern(deck, ['archdruid', 'ezuri', 'imperator', 'lord']);
    const finisher = countPattern(deck, ['craterhoof', 'overrun', 'finisher']);

    if (elves >= 10 && lords < 2) {
      missing.push({
        synergy: 'Elves Tribal',
        missing: 'Elf lords',
        description: `You have ${elves} elves but only ${lords} lords. Add more lords to buff your army.`,
        suggestion: 'Elvish Archdruid, Ezuri Renegade Leader, Imperator of Pleasures',
        impact: 'high',
      });
    }

    if (elves >= 12 && finisher < 2) {
      missing.push({
        synergy: 'Elves Tribal',
        missing: 'Finisher',
        description: 'Your elf army needs a finisher to close out games.',
        suggestion: 'Craterhoof Behemoth, Ezuri Renegade Leader',
        impact: 'high',
      });
    }
  }

  // Vampire Tribal specific suggestions
  if (archetype.toLowerCase().includes('vampire')) {
    const vampires = countPattern(deck, ['vampire']);
    const lords = countPattern(deck, ['edgar', 'bloodlord', 'stromkirk', 'captain', 'sorin']);
    const drain = countPattern(deck, ['life drain', 'blood artist', 'zulaport', 'whenever a creature dies']);

    if (vampires >= 8 && lords < 2) {
      missing.push({
        synergy: 'Vampire Tribal',
        missing: 'Vampire lords',
        description: `You have ${vampires} vampires but only ${lords} lords. Add more lords to buff your vampires.`,
        suggestion: 'Edgar Markov, Bloodlord of Vaasgoth, Stromkirk Captain',
        impact: 'high',
      });
    }

    if (vampires >= 8 && drain < 3) {
      missing.push({
        synergy: 'Vampire Tribal',
        missing: 'Life drain payoffs',
        description: 'Your vampires could benefit from life drain synergies.',
        suggestion: 'Blood Artist, Zulaport Cutthroat, Syr Konrad, the Grim',
        impact: 'medium',
      });
    }
  }

  // Merfolk Tribal specific suggestions
  if (archetype.toLowerCase().includes('merfolk')) {
    const merfolk = countPattern(deck, ['merfolk']);
    const lords = countPattern(deck, ['master of the pearl', 'lord of atlantis', 'reejerey', 'coralhelm']);
    const islandwalk = countPattern(deck, ['islandwalk', 'spreading seas', 'can\'t be blocked']);

    if (merfolk >= 8 && lords < 2) {
      missing.push({
        synergy: 'Merfolk Tribal',
        missing: 'Merfolk lords',
        description: `You have ${merfolk} merfolk but only ${lords} lords. Add more lords to buff your merfolk.`,
        suggestion: 'Master of the Pearl Trident, Lord of Atlantis, Merrow Reejerey',
        impact: 'high',
      });
    }

    if (merfolk >= 8 && islandwalk < 3) {
      missing.push({
        synergy: 'Merfolk Tribal',
        missing: 'Island walk support',
        description: 'Your merfolk could benefit from island walk enablers.',
        suggestion: 'Lord of Atlantis, Spreading Seas, Jace, the Mind Sculptor',
        impact: 'medium',
      });
    }
  }

  // Human Tribal specific suggestions
  if (archetype.toLowerCase().includes('human')) {
    const humans = countPattern(deck, ['human']);
    const lords = countPattern(deck, ['thalia', 'kessig', 'champion', 'lieutenant', 'captain']);
    const disruption = countPattern(deck, ['thalia', 'meddling', 'arbiter', 'counter target', 'tax']);

    if (humans >= 10 && lords < 2) {
      missing.push({
        synergy: 'Human Tribal',
        missing: 'Human lords',
        description: `You have ${humans} humans but only ${lords} lords. Add more lords to buff your humans.`,
        suggestion: 'Thalia\'s Lieutenant, Kessig Malcontents, Champion of the Parish',
        impact: 'high',
      });
    }

    if (humans >= 10 && disruption < 3) {
      missing.push({
        synergy: 'Human Tribal',
        missing: 'Tempo disruption',
        description: 'Your humans could benefit from tempo disruption spells.',
        suggestion: 'Thalia, Guardian of Thraben, Meddling Mage, Leonin Arbiter',
        impact: 'medium',
      });
    }
  }

  // Control archetype suggestions
  if (archetype.toLowerCase().includes('control') || archetype.toLowerCase().includes('draw-go')) {
    const counterspells = countPattern(deck, ['counter', 'negate', 'counterspell']);
    const cardDraw = countPattern(deck, ['draw', 'divination', 'brainstorm', 'ponder']);
    const boardWipe = countPattern(deck, ['wrath', 'sweep', 'all creatures', 'destroy all']);

    if (counterspells >= 8 && cardDraw < 8) {
      missing.push({
        synergy: 'Control',
        missing: 'Card draw',
        description: `You have ${counterspells} counterspells but only ${cardDraw} card draw sources.`,
        suggestion: 'Brainstorm, Ponder, Preordain, Divination',
        impact: 'high',
      });
    }

    if (cardDraw >= 10 && boardWipe < 3) {
      missing.push({
        synergy: 'Control',
        missing: 'Board wipes',
        description: 'Your control deck needs board wipes to handle creature-heavy matchups.',
        suggestion: 'Wrath of God, Supreme Verdict, Cleansing Nova',
        impact: 'medium',
      });
    }
  }

  // Aggro archetype suggestions
  if (archetype.toLowerCase().includes('aggro') || archetype.toLowerCase().includes('burn')) {
    const burnSpells = countPattern(deck, ['lightning bolt', 'burn', 'direct damage', 'shock']);
    const creatures = deck.filter(c => c.type_line?.toLowerCase().includes('creature')).length;
    const haste = countPattern(deck, ['haste', 'first strike']);

    if (creatures >= 15 && haste < 6) {
      missing.push({
        synergy: 'Aggro',
        missing: 'Haste creatures',
        description: 'Your aggro deck could benefit from more haste creatures for immediate impact.',
        suggestion: 'Goblin Guide, Monastery Swiftspear, Hellrider',
        impact: 'medium',
      });
    }

    if (burnSpells >= 8 && creatures < 12) {
      missing.push({
        synergy: 'Burn',
        missing: 'Burn creatures',
        description: 'Your burn deck needs creatures that can deal damage quickly.',
        suggestion: 'Goblin Guide, Monastery Swiftspear, Eidolon of the Raging Storm',
        impact: 'medium',
      });
    }
  }

  // Combo archetype suggestions
  if (archetype.toLowerCase().includes('combo') || archetype.toLowerCase().includes('storm')) {
    const comboPieces = countPattern(deck, ['combo', 'infinite', 'storm', 'ritual']);
    const protection = countPattern(deck, ['counterspell', 'protection', 'deflect', 'foil']);
    const tutors = countPattern(deck, ['tutor', 'search', 'fetch', 'find']);

    if (comboPieces >= 6 && tutors < 4) {
      missing.push({
        synergy: 'Combo',
        missing: 'Tutors',
        description: 'Your combo needs tutors to find key pieces consistently.',
        suggestion: 'Demonic Tutor, Mystical Tutor, Enlightened Tutor',
        impact: 'high',
      });
    }

    if (comboPieces >= 8 && protection < 6) {
      missing.push({
        synergy: 'Combo',
        missing: 'Protection',
        description: 'Your combo needs protection to resolve successfully.',
        suggestion: 'Counterspell, Pact of Negation, Deflecting Swat',
        impact: 'high',
      });
    }
  }

  return missing;
}

/**
 * Helper: Count cards matching patterns
 */
function countPattern(deck: DeckCard[], patterns: string[]): number {
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

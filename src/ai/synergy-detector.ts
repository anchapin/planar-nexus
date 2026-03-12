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
 * Synergy signatures database - 20 synergies across categories
 */
export const SYNERGY_SIGNATURES: SynergySignature[] = [
  // === TRIBAL SYNERGIES (4) ===
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
  
  for (const signature of SYNERGY_SIGNATURES) {
    try {
      const result = signature.scoreFunction(deck);
      
      // Check minimum cards requirement
      const cardCount = result.cards.length;
      if (cardCount < signature.minimumCards) {
        // Reduce score proportionally
        result.score = Math.floor(result.score * (cardCount / signature.minimumCards));
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

/**
 * Anti-Meta Counter Recommendations
 * 
 * Provides counter deck recommendations, sideboard guides, and mana base
 * recommendations for beating popular meta decks.
 */

import { MagicFormat, ArchetypeCategory } from './meta';

export interface CounterRecommendation {
  archetypeId: string;
  archetypeName: string;
  counterArchetypeId: string;
  counterArchetypeName: string;
  matchupWinRate: number;
  keyCards: string[];
  sideboardNotes: string;
  manaBaseNotes: string;
}

export interface SideboardRecommendation {
  archetypeId: string;
  opponentArchetypeId: string;
  sideboardGuide: SideboardGuide;
}

export interface SideboardGuide {
  in: SideboardCard[];
  out: SideboardCard[];
  notes: string;
}

export interface SideboardCard {
  cardName: string;
  count: number;
  reason: string;
}

export interface ManaBaseRecommendation {
  archetypeId: string;
  archetypeName: string;
  recommendedLands: number;
  colorRequirements: ColorManaRequirement[];
  manaCurve: ManaCurveRecommendation;
  notes: string;
}

export interface ColorManaRequirement {
  color: string;
  sources: number;
  notes: string;
}

export interface ManaCurveRecommendation {
  minLands: number;
  maxLands: number;
  ideal: number;
  reasoning: string;
}

// Anti-meta mock data
const antiMetaData: Record<MagicFormat, CounterRecommendation[]> = {
  standard: [
    {
      archetypeId: 'std-aggro-red',
      archetypeName: 'Red Aggro',
      counterArchetypeId: 'std-control-blue',
      counterArchetypeName: 'Blue Control',
      matchupWinRate: 58,
      keyCards: ['Propaganda', 'Evacuation', 'Doomwake Giant'],
      sideboardNotes: 'Bring in sweepers, remove burn spells',
      manaBaseNotes: '23-24 lands, focus on blue sources'
    },
    {
      archetypeId: 'std-control-blue',
      archetypeName: 'Blue Control',
      counterArchetypeId: 'std-combo-temur',
      counterArchetypeName: 'Temur Combo',
      matchupWinRate: 55,
      keyCards: ['Fable of the Mirror-Breaker', 'Turntimber Symbiosis', 'Lightning Strike'],
      sideboardNotes: 'Bring in counter magic, remove late game cards',
      manaBaseNotes: '25-26 lands, even blue/red/green sources'
    },
    {
      archetypeId: 'std-midrange-black',
      archetypeName: 'Black Midrange',
      counterArchetypeId: 'std-aggro-white',
      counterArchetypeName: 'White Aggro',
      matchupWinRate: 56,
      keyCards: ['Thalia, Guardian of Thraben', 'Adanto Vanguard', 'Legions Landing'],
      sideboardNotes: 'Bring in lifegain, remove expensive spells',
      manaBaseNotes: '22-23 lands, white/black sources'
    },
    {
      archetypeId: 'std-combo-temur',
      archetypeName: 'Temur Combo',
      counterArchetypeId: 'std-control-blue-black',
      counterArchetypeName: 'Dimir Control',
      matchupWinRate: 57,
      keyCards: ['Disallow', 'Negate', 'Fading Hope'],
      sideboardNotes: 'Bring in counterspells, remove vulnerable creatures',
      manaBaseNotes: '24-25 lands, blue/black focus'
    },
    {
      archetypeId: 'std-tempo-blue-red',
      archetypeName: 'Izzet Tempo',
      counterArchetypeId: 'std-midrange-green',
      counterArchetypeName: 'Green Midrange',
      matchupWinRate: 54,
      keyCards: ['Old-Growth Troll', 'Kazandu Mammoth', 'Gemrazer'],
      sideboardNotes: 'Bring in bigger creatures, remove burn',
      manaBaseNotes: '23-24 lands, green/red sources'
    }
  ],
  modern: [
    {
      archetypeId: 'mod-aggro-red',
      archetypeName: 'Burn',
      counterArchetypeId: 'mod-control-white',
      counterArchetypeName: 'White Control',
      matchupWinRate: 58,
      keyCards: ['Prismatic Ending', 'Teferi, Hero of Dominaria', 'Day of Judgment'],
      sideboardNotes: 'Bring in lifegain and sweepers',
      manaBaseNotes: '24-25 lands, white sources for Path'
    },
    {
      archetypeId: 'mod-combo-twin',
      archetypeName: 'Grixis Twin',
      counterArchetypeId: 'mod-midrange-jund',
      counterArchetypeName: 'Jund Midrange',
      matchupWinRate: 55,
      keyCards: ['Kolaghan\'s Command', 'Lightning Bolt', 'Tarmogoyf'],
      sideboardNotes: 'Bring in discard and removal',
      manaBaseNotes: '24 lands, black/red/green'
    },
    {
      archetypeId: 'mod-control-blue',
      archetypeName: 'Blue Tron',
      counterArchetypeId: 'mod-aggro-hammer',
      counterArchetypeName: 'Hammer Time',
      matchupWinRate: 56,
      keyCards: ['Urza\'s Saga', 'Colossus Hammer', 'Stoneforge Mystic'],
      sideboardNotes: 'Be aggressive, they can\'t interact much',
      manaBaseNotes: '20-21 lands, white sources'
    },
    {
      archetypeId: 'mod-midrange-jund',
      archetypeName: 'Jund Midrange',
      counterArchetypeId: 'mod-control-blue-white',
      counterArchetypeName: 'UW Control',
      matchupWinRate: 54,
      keyCards: ['Teferi, Hero of Dominaria', 'Counterspell', 'Supreme Verdict'],
      sideboardNotes: 'Card advantage wins, be patient',
      manaBaseNotes: '26 lands, even distribution'
    },
    {
      archetypeId: 'mod-aggro-shadow',
      archetypeName: 'Grief Shadow',
      counterArchetypeId: 'mod-control-murktide',
      counterArchetypeName: 'Murktide',
      matchupWinRate: 52,
      keyCards: ['Dragon\'s Rage Channeler', 'Murktide Regent', 'Counterspell'],
      sideboardNotes: 'Go long, they run out of gas',
      manaBaseNotes: '19-20 lands, heavy blue'
    }
  ],
  commander: [
    {
      archetypeId: 'cmdr-combo-twin',
      archetypeName: 'Thrasios/Vial Smasher',
      counterArchetypeId: 'cmdr-control-blue',
      counterArchetypeName: 'Blue Control',
      matchupWinRate: 52,
      keyCards: ['Force of Will', 'Cyclonic Rift', 'Jace, the Mind Sculptor'],
      sideboardNotes: 'Counters are key, hold removal',
      manaBaseNotes: '38-40 lands, heavy blue'
    },
    {
      archetypeId: 'cmdr-aggro-red',
      archetypeName: 'Krenko Aggro',
      counterArchetypeId: 'cmdr-control-white-blue',
      counterArchetypeName: 'W/U Control',
      matchupWinRate: 58,
      keyCards: ['Terminus', 'Counterspell', 'Teferi, Hero of Dominaria'],
      sideboardNotes: 'Sweepers early, card draw later',
      manaBaseNotes: '37-39 lands, white/blue'
    },
    {
      archetypeId: 'cmdr-storm',
      archetypeName: 'Storm (Najeela)',
      counterArchetypeId: 'cmdr-hatebear-white',
      counterArchetypeName: 'Hatebears',
      matchupWinRate: 48,
      keyCards: ['Thalia, Guardian of Thraben', 'Glowrider', 'Aven Mindcensor'],
      sideboardNotes: 'Tax effects stop storm',
      manaBaseNotes: '25-26 lands, white/green'
    },
    {
      archetypeId: 'cmdr-tribal-dragons',
      archetypeName: 'Dragon Tribal',
      counterArchetypeId: 'cmdr-control-black',
      counterArchetypeName: 'Black Control',
      matchupWinRate: 55,
      keyCards: ['Toxic Deluge', 'Damnation', 'Karn the Great Creator'],
      sideboardNotes: 'Wraths are key, fly over tokens',
      manaBaseNotes: '38 lands, black sources'
    }
  ]
};

// Mana base recommendations by archetype
const manaBaseRecommendations: Record<MagicFormat, ManaBaseRecommendation[]> = {
  standard: [
    {
      archetypeId: 'std-aggro-red',
      archetypeName: 'Red Aggro',
      recommendedLands: 22,
      colorRequirements: [
        { color: 'Red', sources: 18, notes: 'Primary color' },
        { color: 'Mountain', sources: 18, notes: 'Only red source needed' }
      ],
      manaCurve: { minLands: 20, maxLands: 23, ideal: 22, reasoning: 'Aggro decks want low curve' },
      notes: '22 lands is typical, can go to 21 with low curve'
    },
    {
      archetypeId: 'std-control-blue',
      archetypeName: 'Blue Control',
      recommendedLands: 26,
      colorRequirements: [
        { color: 'Blue', sources: 18, notes: 'Primary color' },
        { color: 'Island', sources: 18, notes: 'Only blue source needed' }
      ],
      manaCurve: { minLands: 25, maxLands: 27, ideal: 26, reasoning: 'Control needs lands for late game' },
      notes: '26 lands typical, 27 in slower metas'
    },
    {
      archetypeId: 'std-midrange-black',
      archetypeName: 'Black Midrange',
      recommendedLands: 24,
      colorRequirements: [
        { color: 'Black', sources: 16, notes: 'Primary' },
        { color: 'Swamp', sources: 16, notes: 'Main color' }
      ],
      manaCurve: { minLands: 23, maxLands: 25, ideal: 24, reasoning: 'Balanced curve typical' },
      notes: '24 lands handles 3-4 drop curve'
    }
  ],
  modern: [
    {
      archetypeId: 'mod-aggro-red',
      archetypeName: 'Burn',
      recommendedLands: 20,
      colorRequirements: [
        { color: 'Red', sources: 18, notes: '18-20 red sources ideal' },
        { color: 'Mountain', sources: 18, notes: 'Consider fetchable duals' }
      ],
      manaCurve: { minLands: 18, maxLands: 21, ideal: 20, reasoning: 'Very low curve' },
      notes: 'Can go as low as 18 with Monastery Swiftspear'
    },
    {
      archetypeId: 'mod-control-blue',
      archetypeName: 'Blue Control',
      recommendedLands: 26,
      colorRequirements: [
        { color: 'Blue', sources: 20, notes: 'High blue need for counters' },
        { color: 'Island', sources: 20, notes: 'Dual lands help' }
      ],
      manaCurve: { minLands: 25, maxLands: 28, ideal: 26, reasoning: 'Needs lands for terminus' },
      notes: '26 is starting point, adjust for curve'
    },
    {
      archetypeId: 'mod-midrange-jund',
      archetypeName: 'Jund Midrange',
      recommendedLands: 24,
      colorRequirements: [
        { color: 'Black', sources: 10, notes: '8-10 each' },
        { color: 'Red', sources: 10, notes: '8-10 each' },
        { color: 'Green', sources: 10, notes: '8-10 each' }
      ],
      manaCurve: { minLands: 23, maxLands: 25, ideal: 24, reasoning: 'Three colors need fixing' },
      notes: 'Fetchlands help with color consistency'
    }
  ],
  commander: [
    {
      archetypeId: 'cmdr-combo-twin',
      archetypeName: 'Thrasios/Vial Smasher',
      recommendedLands: 39,
      colorRequirements: [
        { color: 'Blue', sources: 15, notes: 'Primary' },
        { color: 'Red', sources: 10, notes: 'Splash' },
        { color: 'Green', sources: 8, notes: 'Optional splash' }
      ],
      manaCurve: { minLands: 37, maxLands: 42, ideal: 39, reasoning: 'Commander needs card draw' },
      notes: '40 is typical, more with expensive commanders'
    },
    {
      archetypeId: 'cmdr-control-white-blue',
      archetypeName: 'W/U Control',
      recommendedLands: 38,
      colorRequirements: [
        { color: 'White', sources: 15, notes: '15-18 each' },
        { color: 'Blue', sources: 18, notes: 'More blue for counters' }
      ],
      manaCurve: { minLands: 36, maxLands: 40, ideal: 38, reasoning: 'High starting life allows greed' },
      notes: 'Sol Ring and Arcane Signet help accelerate'
    },
    {
      archetypeId: 'cmdr-aggro-red',
      archetypeName: 'Krenko Aggro',
      recommendedLands: 35,
      colorRequirements: [
        { color: 'Red', sources: 20, notes: 'Needs many red sources' },
        { color: 'Mountain', sources: 20, notes: 'Goblin tokens do not need much' }
      ],
      manaCurve: { minLands: 33, maxLands: 36, ideal: 35, reasoning: 'Low curve but many cheap spells, tokens dont need much mana' },
      notes: 'Can go lower with artifact ramp'
    }
  ]
};

/**
 * Get counter recommendations for a specific archetype
 */
export function getCounterRecommendations(
  archetypeId: string,
  format: MagicFormat
): CounterRecommendation[] {
  const data = antiMetaData[format];
  return data.filter(r => r.archetypeId === archetypeId);
}

/**
 * Get all counter recommendations for a format
 */
export function getAllCounterRecommendations(format: MagicFormat): CounterRecommendation[] {
  return antiMetaData[format];
}

/**
 * Get sideboard recommendations for a matchup
 */
export function getSideboardRecommendations(
  archetypeId: string,
  opponentArchetypeId: string,
  format: MagicFormat
): SideboardGuide | null {
  const counters = getCounterRecommendations(archetypeId, format);
  const counter = counters.find(c => c.counterArchetypeId === opponentArchetypeId);
  
  // If we found a specific counter matchup
  if (counter) {
    return {
      in: counter.keyCards.slice(0, 3).map(card => ({ cardName: card, count: 1, reason: 'Strong in this matchup' })),
      out: [
        { cardName: 'Conditional Spell', count: 2, reason: 'Not effective vs opponent' },
        { cardName: 'Late Game Card', count: 1, reason: 'Too slow' }
      ],
      notes: counter.sideboardNotes
    };
  }
  
  // Generate generic sideboard guide if no specific counter found
  return {
    in: [],
    out: [
      { cardName: 'Conditional Spell', count: 2, reason: 'Not effective vs opponent' },
      { cardName: 'Late Game Card', count: 1, reason: 'Too slow' }
    ],
    notes: 'No specific recommendations for this matchup. Focus on generic good cards.'
  };
}

/**
 * Get mana base recommendations for an archetype
 */
export function getManaBaseRecommendations(
  archetypeId: string,
  format: MagicFormat
): ManaBaseRecommendation | null {
  const data = manaBaseRecommendations[format];
  return data.find(r => r.archetypeId === archetypeId) || null;
}

/**
 * Get all mana base recommendations for a format
 */
export function getAllManaBaseRecommendations(format: MagicFormat): ManaBaseRecommendation[] {
  return manaBaseRecommendations[format];
}

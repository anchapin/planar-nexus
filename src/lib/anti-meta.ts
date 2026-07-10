/**
 * Anti-Meta Counter Recommendations
 * 
 * Provides counter deck recommendations, sideboard guides, and mana base
 * recommendations for beating popular meta decks.
 */

import { MagicFormat, ArchetypeCategory } from './meta';

// Alias map: dashboard archetype IDs (`src/lib/meta.ts`) → anti-meta
// archetype IDs. The two modules originally shipped with different naming
// schemes (`std-aggro-1` vs `std-aggro-red`), which made the
// Counter/Sideboard/Mana Base tabs in `AntiMetaRecommendations` render empty
// for every archetype. Resolving through this map keeps `meta.ts` stable
// (smallest blast radius) while letting both ID styles coexist.
//
// For Commander the existing records (cmdr-aggro-red Krenko Aggro,
// cmdr-combo-twin Thrasios) target a different set of decks than the
// dashboard archetypes (Edgar Markov, Teferi, Chatterfang, Krenko Mob Boss,
// Malcolm), so this map points each dashboard commander at its own dedicated
// record added below (`cmdr-aggro-markov`, `cmdr-control-teferi`, etc.).
const ARCHETYPE_ALIASES: Record<string, string> = {
  'std-aggro-1': 'std-aggro-red',
  'std-control-1': 'std-control-blue',
  'std-midrange-1': 'std-midrange-black',
  'std-combo-1': 'std-combo-temur',
  'std-tempo-1': 'std-tempo-blue-red',
  'mod-aggro-1': 'mod-aggro-red',
  'mod-control-1': 'mod-control-blue',
  'mod-midrange-1': 'mod-midrange-jund',
  'mod-combo-1': 'mod-combo-twin',
  'mod-tempo-1': 'mod-aggro-shadow',
  'edh-aggro-1': 'cmdr-aggro-markov',
  'edh-control-1': 'cmdr-control-teferi',
  'edh-midrange-1': 'cmdr-midrange-chatterfang',
  'edh-combo-1': 'cmdr-combo-krenko',
  'edh-tempo-1': 'cmdr-tempo-malcolm',
};

function resolveArchetypeId(archetypeId: string): string {
  return ARCHETYPE_ALIASES[archetypeId] ?? archetypeId;
}

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
    },
    {
      archetypeId: 'cmdr-aggro-markov',
      archetypeName: 'Edgar Markov',
      counterArchetypeId: 'cmdr-control-teferi',
      counterArchetypeName: 'Teferi Control',
      matchupWinRate: 56,
      keyCards: ['Teferi, Hero of Dominaria', 'Path to Exile', 'Wrath of God'],
      sideboardNotes: 'Sweepers handle the Vampire wave, exile the general',
      manaBaseNotes: '37-39 lands, white/blue'
    },
    {
      archetypeId: 'cmdr-control-teferi',
      archetypeName: 'Teferi, Temporal Archmage',
      counterArchetypeId: 'cmdr-aggro-markov',
      counterArchetypeName: 'Edgar Markov Aggro',
      matchupWinRate: 54,
      keyCards: ['Vampire Nocturnus', 'Captivating Crew', 'Legions Landing'],
      sideboardNotes: 'Race under the lock, pressure before Stax lands',
      manaBaseNotes: '36-38 lands, white/black vampire count matters'
    },
    {
      archetypeId: 'cmdr-midrange-chatterfang',
      archetypeName: 'Chatterfang',
      counterArchetypeId: 'cmdr-control-teferi',
      counterArchetypeName: 'Teferi Control',
      matchupWinRate: 52,
      keyCards: ['Toxic Deluge', 'Counterspell', 'Cyclonic Rift'],
      sideboardNotes: 'Board wipes before the squirrel engine pops off',
      manaBaseNotes: '36-38 lands, black/green with blue splash'
    },
    {
      archetypeId: 'cmdr-combo-krenko',
      archetypeName: 'Krenko, Mob Boss',
      counterArchetypeId: 'cmdr-control-white-blue',
      counterArchetypeName: 'W/U Control',
      matchupWinRate: 55,
      keyCards: ['Terminus', 'Counterspell', 'Teferi, Hero of Dominaria'],
      sideboardNotes: 'Sweepers on the token chain, counter the chain payoff',
      manaBaseNotes: '37-39 lands, white/blue'
    },
    {
      archetypeId: 'cmdr-tempo-malcolm',
      archetypeName: 'Malcolm, Keen-Eyed Navigator',
      counterArchetypeId: 'cmdr-midrange-chatterfang',
      counterArchetypeName: 'Chatterfang Midrange',
      matchupWinRate: 51,
      keyCards: ['Tortured Existence', 'Squirrel Nest', 'Acornitage'],
      sideboardNotes: 'Out-grind the treasures, race them on value',
      manaBaseNotes: '35-37 lands, blue/red with black/green splash'
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
    },
    {
      archetypeId: 'std-combo-temur',
      archetypeName: 'Temur Combo',
      recommendedLands: 25,
      colorRequirements: [
        { color: 'Blue', sources: 14, notes: 'Primary engine color' },
        { color: 'Red', sources: 10, notes: 'Burn/removal' },
        { color: 'Green', sources: 8, notes: 'Ramp and finders' }
      ],
      manaCurve: { minLands: 24, maxLands: 27, ideal: 25, reasoning: 'Spell-heavy combo wants 25' },
      notes: 'Wilderness Reclamation lowers effective mana needs'
    },
    {
      archetypeId: 'std-tempo-blue-red',
      archetypeName: 'Izzet Tempo',
      recommendedLands: 20,
      colorRequirements: [
        { color: 'Blue', sources: 14, notes: 'Counters and card draw' },
        { color: 'Red', sources: 12, notes: 'Burn and tempo threats' }
      ],
      manaCurve: { minLands: 18, maxLands: 22, ideal: 20, reasoning: 'Tempo wants low curve' },
      notes: '20 lands with Delver is the sweet spot'
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
    },
    {
      archetypeId: 'mod-combo-twin',
      archetypeName: 'Grixis Twin',
      recommendedLands: 23,
      colorRequirements: [
        { color: 'Blue', sources: 12, notes: 'Cantrips + combo enabler' },
        { color: 'Red', sources: 10, notes: 'Combo payoff and removal' },
        { color: 'Black', sources: 8, notes: 'Discard and removal' }
      ],
      manaCurve: { minLands: 21, maxLands: 24, ideal: 23, reasoning: 'Cantrips compress the deck' },
      notes: 'Lower with Serum Visions + cantrip density'
    },
    {
      archetypeId: 'mod-aggro-shadow',
      archetypeName: 'Grief Shadow',
      recommendedLands: 19,
      colorRequirements: [
        { color: 'Blue', sources: 12, notes: 'Counters and DRC' },
        { color: 'Black', sources: 10, notes: 'Grief + removal' },
        { color: 'Red', sources: 4, notes: 'Lightning + sideboard splash' }
      ],
      manaCurve: { minLands: 17, maxLands: 21, ideal: 19, reasoning: 'Ultra low for tempo shell' },
      notes: '19 lands with Mishra\'s Bauble + Bauble-fueled cantrips'
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
    },
    {
      archetypeId: 'cmdr-aggro-markov',
      archetypeName: 'Edgar Markov',
      recommendedLands: 36,
      colorRequirements: [
        { color: 'White', sources: 18, notes: 'Anthem enabler' },
        { color: 'Black', sources: 18, notes: 'Vampire lords and removal' }
      ],
      manaCurve: { minLands: 34, maxLands: 38, ideal: 36, reasoning: 'Two color vampire tribal is greedy but manageable' },
      notes: 'Cavern of Souls + Unclaimed Territory help the tribal count'
    },
    {
      archetypeId: 'cmdr-control-teferi',
      archetypeName: 'Teferi, Temporal Archmage',
      recommendedLands: 38,
      colorRequirements: [
        { color: 'White', sources: 16, notes: 'Stax and removal' },
        { color: 'Blue', sources: 20, notes: 'Counters and card draw' }
      ],
      manaCurve: { minLands: 36, maxLands: 40, ideal: 38, reasoning: 'Stax wants land drops for tax effects' },
      notes: 'Null Rod / Stony Silence targets are critical sideboard considerations'
    },
    {
      archetypeId: 'cmdr-midrange-chatterfang',
      archetypeName: 'Chatterfang',
      recommendedLands: 36,
      colorRequirements: [
        { color: 'Black', sources: 16, notes: 'Sacrifice and tutor effects' },
        { color: 'Green', sources: 18, notes: 'Squirrel engine and ramp' }
      ],
      manaCurve: { minLands: 34, maxLands: 38, ideal: 36, reasoning: 'Midrange curve wants consistency' },
      notes: 'Pitiless Plunderer + squirrel token chain is the mana sink'
    },
    {
      archetypeId: 'cmdr-combo-krenko',
      archetypeName: 'Krenko, Mob Boss',
      recommendedLands: 35,
      colorRequirements: [
        { color: 'Red', sources: 24, notes: 'Mono-red wants heavy red count' }
      ],
      manaCurve: { minLands: 33, maxLands: 37, ideal: 35, reasoning: 'Mana-positive tokens lower needs' },
      notes: 'Skirk Prospector + Conspicuous Snoop engine wants rituals, not lands'
    },
    {
      archetypeId: 'cmdr-tempo-malcolm',
      archetypeName: 'Malcolm, Keen-Eyed Navigator',
      recommendedLands: 36,
      colorRequirements: [
        { color: 'Blue', sources: 18, notes: 'Cantrips and tempo threats' },
        { color: 'Red', sources: 14, notes: 'Treasure generation' }
      ],
      manaCurve: { minLands: 34, maxLands: 38, ideal: 36, reasoning: 'Treasure ramp lowers land needs' },
      notes: 'Dockside Extortionist covers the gap; cut lands before threats'
    }
  ]
};

/**
 * Get counter recommendations for a specific archetype.
 *
 * `archetypeId` is the dashboard archetype id (`src/lib/meta.ts`, e.g.
 * `std-aggro-1`). The internal record keys live under the anti-meta naming
 * scheme (e.g. `std-aggro-red`); `ARCHETYPE_ALIASES` reconciles the two so the
 * Counter / Sideboard / Mana Base tabs in `AntiMetaRecommendations` actually
 * populate. (Issue #1405.)
 */
export function getCounterRecommendations(
  archetypeId: string,
  format: MagicFormat
): CounterRecommendation[] {
  const data = antiMetaData[format];
  const resolved = resolveArchetypeId(archetypeId);
  return data.filter(r => r.archetypeId === resolved);
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
 * Get mana base recommendations for an archetype. See `getCounterRecommendations`
 * for why we route through the alias resolver (issue #1405).
 */
export function getManaBaseRecommendations(
  archetypeId: string,
  format: MagicFormat
): ManaBaseRecommendation | null {
  const data = manaBaseRecommendations[format];
  const resolved = resolveArchetypeId(archetypeId);
  return data.find(r => r.archetypeId === resolved) || null;
}

/**
 * Get all mana base recommendations for a format
 */
export function getAllManaBaseRecommendations(format: MagicFormat): ManaBaseRecommendation[] {
  return manaBaseRecommendations[format];
}

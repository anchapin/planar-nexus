/**
 * Meta Analysis Types and Mock Data
 * 
 * Provides deck archetype data, win rates, meta share, and card inclusion rates
 * for the Meta Analysis dashboard.
 */

export type MagicFormat = 'standard' | 'modern' | 'commander';

export type DateRange = '7days' | '30days' | 'alltime';

export type ArchetypeCategory = 'aggro' | 'control' | 'midrange' | 'combo' | 'tempo';

export type TrendDirection = 'rising' | 'declining' | 'stable';

export interface CardInclusion {
  cardName: string;
  inclusionRate: number;
  trend: TrendDirection;
  trendChange: number;
}

export interface DeckArchetype {
  id: string;
  name: string;
  category: ArchetypeCategory;
  format: MagicFormat;
  winRate: number;
  metaShare: number;
  colorIdentity: string[];
  topCards: CardInclusion[];
  description: string;
}

export interface ColorDistribution {
  color: string;
  percentage: number;
  count: number;
}

export interface FormatHealth {
  score: number;
  diversityScore: number;
  colorDistribution: ColorDistribution[];
  archetypeBalance: Record<ArchetypeCategory, number>;
}

export interface TrendData {
  archetypeId: string;
  archetypeName: string;
  previousMetaShare: number;
  currentMetaShare: number;
  change: number;
  direction: TrendDirection;
}

export interface CardTrendPoint {
  week: string;
  inclusionRate: number;
}

export interface CardTrend {
  cardName: string;
  data: CardTrendPoint[];
}

export interface MetaData {
  format: MagicFormat;
  dateRange: DateRange;
  lastUpdated: string;
  archetypes: DeckArchetype[];
  formatHealth: FormatHealth;
  risingArchetypes: TrendData[];
  decliningArchetypes: TrendData[];
  cardTrends: CardTrend[];
}

// Mock Data for Standard Format
const standardArchetypes: DeckArchetype[] = [
  {
    id: 'std-aggro-1',
    name: 'Red Aggro',
    category: 'aggro',
    format: 'standard',
    winRate: 52.3,
    metaShare: 14.2,
    colorIdentity: ['R'],
    description: 'Fast-paced aggressive deck using cheap burn and creatures',
    topCards: [
      { cardName: 'Goblin Guide', inclusionRate: 87, trend: 'stable', trendChange: 0.5 },
      { cardName: 'Lightning Bolt', inclusionRate: 82, trend: 'stable', trendChange: -0.2 },
      { cardName: 'Monastery Swiftspear', inclusionRate: 78, trend: 'rising', trendChange: 3.2 },
      { cardName: 'Eidolon of the Great Revel', inclusionRate: 65, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Burning-Tree Emissary', inclusionRate: 58, trend: 'declining', trendChange: -2.1 },
    ],
  },
  {
    id: 'std-control-1',
    name: 'Azorius Control',
    category: 'control',
    format: 'standard',
    winRate: 51.8,
    metaShare: 12.5,
    colorIdentity: ['W', 'U'],
    description: 'Counter-spell heavy control with Tef3iri and wraths',
    topCards: [
      { cardName: 'Counterspell', inclusionRate: 92, trend: 'stable', trendChange: 0.3 },
      { cardName: 'Teferi, Hero of Dominaria', inclusionRate: 85, trend: 'stable', trendChange: -0.5 },
      { cardName: 'Absorb', inclusionRate: 72, trend: 'rising', trendChange: 1.8 },
      { cardName: 'Supreme Verdict', inclusionRate: 68, trend: 'stable', trendChange: 0.2 },
      { cardName: 'Narset, Parter of Veils', inclusionRate: 55, trend: 'declining', trendChange: -1.5 },
    ],
  },
  {
    id: 'std-midrange-1',
    name: 'Sultai Midrange',
    category: 'midrange',
    format: 'standard',
    winRate: 53.1,
    metaShare: 11.8,
    colorIdentity: ['B', 'U', 'G'],
    description: 'Value-oriented midrange with graveyard synergies',
    topCards: [
      { cardName: 'Thoughtseize', inclusionRate: 89, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Tireless Tracker', inclusionRate: 81, trend: 'rising', trendChange: 2.4 },
      { cardName: 'Murderous Rider', inclusionRate: 75, trend: 'stable', trendChange: 0.3 },
      { cardName: 'Questing Beast', inclusionRate: 70, trend: 'stable', trendChange: -0.2 },
      { cardName: 'Casualties of War', inclusionRate: 45, trend: 'rising', trendChange: 1.1 },
    ],
  },
  {
    id: 'std-combo-1',
    name: 'Temur Reclamation',
    category: 'combo',
    format: 'standard',
    winRate: 54.2,
    metaShare: 9.3,
    colorIdentity: ['U', 'R', 'G'],
    description: 'Spell-heavy combo using Wilderness Reclamation',
    topCards: [
      { cardName: 'Wilderness Reclamation', inclusionRate: 95, trend: 'stable', trendChange: 0.4 },
      { cardName: 'Expansion // Explosion', inclusionRate: 88, trend: 'rising', trendChange: 1.9 },
      { cardName: 'Niv-Mizzet, Parun', inclusionRate: 82, trend: 'stable', trendChange: 0.2 },
      { cardName: "Chemister's Insight", inclusionRate: 76, trend: 'stable', trendChange: -0.3 },
      { cardName: 'Stormclaw Rager', inclusionRate: 52, trend: 'declining', trendChange: -3.2 },
    ],
  },
  {
    id: 'std-tempo-1',
    name: 'Izzet Tempo',
    category: 'tempo',
    format: 'standard',
    winRate: 50.5,
    metaShare: 8.7,
    colorIdentity: ['U', 'R'],
    description: 'Spell-heavy tempo with counter-burn package',
    topCards: [
      { cardName: 'Delver of Secrets', inclusionRate: 91, trend: 'rising', trendChange: 4.1 },
      { cardName: 'Spell Pierce', inclusionRate: 85, trend: 'stable', trendChange: 0.5 },
      { cardName: 'Lightning Strike', inclusionRate: 80, trend: 'stable', trendChange: -0.2 },
      { cardName: "Wizard's Lightning", inclusionRate: 72, trend: 'declining', trendChange: -1.8 },
      { cardName: 'Arclight Phoenix', inclusionRate: 68, trend: 'rising', trendChange: 2.3 },
    ],
  },
];

// Mock Data for Modern Format
const modernArchetypes: DeckArchetype[] = [
  {
    id: 'mod-aggro-1',
    name: 'Burn',
    category: 'aggro',
    format: 'modern',
    winRate: 51.5,
    metaShare: 15.8,
    colorIdentity: ['R'],
    description: 'Classic burn deck with Fetchland mana',
    topCards: [
      { cardName: 'Lightning Bolt', inclusionRate: 96, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Goblin Guide', inclusionRate: 88, trend: 'stable', trendChange: 0.2 },
      { cardName: 'Eidolon of the Great Revel', inclusionRate: 82, trend: 'stable', trendChange: -0.3 },
      { cardName: 'Searing Blaze', inclusionRate: 75, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Boros Charm', inclusionRate: 58, trend: 'declining', trendChange: -1.2 },
    ],
  },
  {
    id: 'mod-control-1',
    name: 'Jeskai Control',
    category: 'control',
    format: 'modern',
    winRate: 50.2,
    metaShare: 10.2,
    colorIdentity: ['W', 'U', 'R'],
    description: 'Three-color control with Lightning Helix',
    topCards: [
      { cardName: 'Counterspell', inclusionRate: 94, trend: 'stable', trendChange: 0.2 },
      { cardName: 'Teferi, Hero of Dominaria', inclusionRate: 86, trend: 'stable', trendChange: -0.1 },
      { cardName: 'Lightning Helix', inclusionRate: 80, trend: 'stable', trendChange: 0.3 },
      { cardName: 'Archangel Avacyn', inclusionRate: 52, trend: 'declining', trendChange: -2.1 },
      { cardName: 'Supreme Verdict', inclusionRate: 65, trend: 'stable', trendChange: 0.1 },
    ],
  },
  {
    id: 'mod-midrange-1',
    name: 'Tarmogoyf Midrange',
    category: 'midrange',
    format: 'modern',
    winRate: 52.8,
    metaShare: 13.5,
    colorIdentity: ['B', 'G'],
    description: 'Green-Black midrange with Tarmogoyf',
    topCards: [
      { cardName: 'Tarmogoyf', inclusionRate: 98, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Thoughtseize', inclusionRate: 95, trend: 'stable', trendChange: 0.2 },
      { cardName: 'Liliana of the Veil', inclusionRate: 88, trend: 'stable', trendChange: -0.2 },
      { cardName: 'Inquisition of Kozilek', inclusionRate: 82, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Traverse the Ulvenwald', inclusionRate: 70, trend: 'rising', trendChange: 1.5 },
    ],
  },
  {
    id: 'mod-combo-1',
    name: 'Amulet Titan',
    category: 'combo',
    format: 'modern',
    winRate: 53.5,
    metaShare: 8.9,
    colorIdentity: ['G', 'R'],
    description: 'Titan-shift combo with Amulet of Vigor',
    topCards: [
      { cardName: 'Primeval Titan', inclusionRate: 96, trend: 'stable', trendChange: 0.3 },
      { cardName: 'Amulet of Vigor', inclusionRate: 94, trend: 'stable', trendChange: 0.1 },
      { cardName: "Summoner's Pact", inclusionRate: 92, trend: 'stable', trendChange: 0.2 },
      { cardName: 'Explore', inclusionRate: 85, trend: 'rising', trendChange: 1.8 },
      { cardName: 'Dryad of the Ilysian Grove', inclusionRate: 78, trend: 'stable', trendChange: -0.3 },
    ],
  },
  {
    id: 'mod-tempo-1',
    name: 'Blue Moon',
    category: 'tempo',
    format: 'modern',
    winRate: 51.0,
    metaShare: 7.2,
    colorIdentity: ['U', 'R'],
    description: 'Spells-matter tempo with Blood Moon',
    topCards: [
      { cardName: 'Snapcaster Mage', inclusionRate: 92, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Blood Moon', inclusionRate: 88, trend: 'rising', trendChange: 2.5 },
      { cardName: 'Cryptic Command', inclusionRate: 82, trend: 'stable', trendChange: -0.2 },
      { cardName: 'Lightning Bolt', inclusionRate: 75, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Mysteries of the Past', inclusionRate: 45, trend: 'declining', trendChange: -1.8 },
    ],
  },
];

// Mock Data for Commander Format
const commanderArchetypes: DeckArchetype[] = [
  {
    id: 'edh-aggro-1',
    name: 'Edgar Markov',
    category: 'aggro',
    format: 'commander',
    winRate: 53.2,
    metaShare: 11.5,
    colorIdentity: ['W', 'B'],
    description: 'Vampire tribal aggro with Eminence ability',
    topCards: [
      { cardName: 'Edgar Markov', inclusionRate: 98, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Vampire Nocturnus', inclusionRate: 85, trend: 'stable', trendChange: 0.2 },
      { cardName: 'Captivating Crew', inclusionRate: 78, trend: 'rising', trendChange: 1.5 },
      { cardName: 'Patron of the Vein', inclusionRate: 72, trend: 'stable', trendChange: -0.2 },
      { cardName: 'Stromkirk Captain', inclusionRate: 65, trend: 'declining', trendChange: -1.2 },
    ],
  },
  {
    id: 'edh-control-1',
    name: 'Teferi, Temporal Archmage',
    category: 'control',
    format: 'commander',
    winRate: 51.8,
    metaShare: 14.2,
    colorIdentity: ['W', 'U'],
    description: 'Stax control with card draw and locks',
    topCards: [
      { cardName: 'Teferi, Temporal Archmage', inclusionRate: 96, trend: 'stable', trendChange: 0.2 },
      { cardName: 'Counterspell', inclusionRate: 92, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Rhystic Study', inclusionRate: 88, trend: 'rising', trendChange: 1.8 },
      { cardName: 'Mystic Remora', inclusionRate: 82, trend: 'stable', trendChange: 0.3 },
      { cardName: 'Sunder', inclusionRate: 65, trend: 'declining', trendChange: -1.5 },
    ],
  },
  {
    id: 'edh-midrange-1',
    name: 'Chatterfang',
    category: 'midrange',
    format: 'commander',
    winRate: 52.5,
    metaShare: 9.8,
    colorIdentity: ['B', 'G'],
    description: 'Squirrel tribal with sacrifice synergies',
    topCards: [
      { cardName: 'Chatterfang, Squirrel General', inclusionRate: 98, trend: 'stable', trendChange: 0.3 },
      { cardName: 'Squirrel Nest', inclusionRate: 88, trend: 'rising', trendChange: 2.1 },
      { cardName: 'Acornitage', inclusionRate: 82, trend: 'stable', trendChange: 0.2 },
      { cardName: 'Tortured Existence', inclusionRate: 75, trend: 'stable', trendChange: -0.1 },
      { cardName: "Life's Legacy", inclusionRate: 68, trend: 'rising', trendChange: 1.2 },
    ],
  },
  {
    id: 'edh-combo-1',
    name: 'Krenko, Mob Boss',
    category: 'combo',
    format: 'commander',
    winRate: 54.8,
    metaShare: 8.5,
    colorIdentity: ['R'],
    description: 'Goblin token combo with Krenko',
    topCards: [
      { cardName: 'Krenko, Mob Boss', inclusionRate: 98, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Goblin Bombardment', inclusionRate: 92, trend: 'stable', trendChange: 0.2 },
      { cardName: 'Impact Tremors', inclusionRate: 88, trend: 'rising', trendChange: 1.5 },
      { cardName: 'Siege-Gang Commander', inclusionRate: 82, trend: 'stable', trendChange: 0.1 },
      { cardName: 'Empty the Warrens', inclusionRate: 75, trend: 'declining', trendChange: -1.8 },
    ],
  },
  {
    id: 'edh-tempo-1',
    name: 'Malcolm, Keen-Eyed Navigator',
    category: 'tempo',
    format: 'commander',
    winRate: 50.8,
    metaShare: 6.2,
    colorIdentity: ['U', 'R'],
    description: 'Pirate tribal with treasure tokens',
    topCards: [
      { cardName: 'Malcolm, Keen-Eyed Navigator', inclusionRate: 96, trend: 'stable', trendChange: 0.2 },
      { cardName: 'Dockside Extortionist', inclusionRate: 94, trend: 'rising', trendChange: 2.8 },
      { cardName: 'Ragavan, Nimble Pilferer', inclusionRate: 88, trend: 'stable', trendChange: 0.1 },
      { cardName: "Faldasal's Kindling", inclusionRate: 75, trend: 'stable', trendChange: -0.2 },
      { cardName: 'Stormclaw Rager', inclusionRate: 58, trend: 'declining', trendChange: -1.5 },
    ],
  },
];

// Mock Format Health Data
const standardHealth: FormatHealth = {
  score: 72,
  diversityScore: 68,
  colorDistribution: [
    { color: 'White', percentage: 15, count: 3 },
    { color: 'Blue', percentage: 22, count: 5 },
    { color: 'Black', percentage: 18, count: 4 },
    { color: 'Red', percentage: 25, count: 6 },
    { color: 'Green', percentage: 12, count: 3 },
    { color: 'Multicolor', percentage: 6, count: 2 },
    { color: 'Colorless', percentage: 2, count: 1 },
  ],
  archetypeBalance: {
    aggro: 28,
    control: 22,
    midrange: 25,
    combo: 15,
    tempo: 10,
  },
};

const modernHealth: FormatHealth = {
  score: 78,
  diversityScore: 75,
  colorDistribution: [
    { color: 'White', percentage: 12, count: 2 },
    { color: 'Blue', percentage: 20, count: 4 },
    { color: 'Black', percentage: 22, count: 5 },
    { color: 'Red', percentage: 18, count: 4 },
    { color: 'Green', percentage: 15, count: 3 },
    { color: 'Multicolor', percentage: 10, count: 3 },
    { color: 'Colorless', percentage: 3, count: 1 },
  ],
  archetypeBalance: {
    aggro: 25,
    control: 18,
    midrange: 28,
    combo: 18,
    tempo: 11,
  },
};

const commanderHealth: FormatHealth = {
  score: 65,
  diversityScore: 58,
  colorDistribution: [
    { color: 'White', percentage: 14, count: 3 },
    { color: 'Blue', percentage: 20, count: 5 },
    { color: 'Black', percentage: 22, count: 6 },
    { color: 'Red', percentage: 16, count: 4 },
    { color: 'Green', percentage: 18, count: 5 },
    { color: 'Multicolor', percentage: 8, count: 3 },
    { color: 'Colorless', percentage: 2, count: 1 },
  ],
  archetypeBalance: {
    aggro: 22,
    control: 28,
    midrange: 20,
    combo: 20,
    tempo: 10,
  },
};

// Mock Trend Data
const generateTrendData = (archetypes: DeckArchetype[]): { rising: TrendData[]; declining: TrendData[] } => {
  const rising: TrendData[] = archetypes
    .filter(a => a.topCards.some(c => c.trend === 'rising'))
    .slice(0, 3)
    .map(a => ({
      archetypeId: a.id,
      archetypeName: a.name,
      previousMetaShare: a.metaShare - 2.5,
      currentMetaShare: a.metaShare,
      change: 2.5,
      direction: 'rising' as TrendDirection,
    }));

  const declining: TrendData[] = archetypes
    .filter(a => a.topCards.some(c => c.trend === 'declining'))
    .slice(0, 3)
    .map(a => ({
      archetypeId: a.id,
      archetypeName: a.name,
      previousMetaShare: a.metaShare + 1.8,
      currentMetaShare: a.metaShare,
      change: -1.8,
      direction: 'declining' as TrendDirection,
    }));

  return { rising, declining };
};

// Mock Card Trends
const generateCardTrends = (): CardTrend[] => {
  const weeks = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'];
  
  return [
    {
      cardName: 'Delver of Secrets',
      data: weeks.map((week, i) => ({
        week,
        inclusionRate: 65 + i * 3.5 + Math.random() * 2,
      })),
    },
    {
      cardName: 'Wilderness Reclamation',
      data: weeks.map((week, i) => ({
        week,
        inclusionRate: 88 - i * 1.2 + Math.random() * 2,
      })),
    },
    {
      cardName: 'Dockside Extortionist',
      data: weeks.map((week, i) => ({
        week,
        inclusionRate: 70 + i * 3.2 + Math.random() * 2,
      })),
    },
    {
      cardName: 'Blood Moon',
      data: weeks.map((week, i) => ({
        week,
        inclusionRate: 72 + i * 2.1 + Math.random() * 2,
      })),
    },
    {
      cardName: 'Tarmogoyf',
      data: weeks.map((week, i) => ({
        week,
        inclusionRate: 95 + Math.random() * 2,
      })),
    },
  ];
};

// Helper Functions
export function getMetaData(format: MagicFormat, dateRange: DateRange): MetaData {
  let archetypes: DeckArchetype[];
  let formatHealth: FormatHealth;

  switch (format) {
    case 'standard':
      archetypes = standardArchetypes;
      formatHealth = standardHealth;
      break;
    case 'modern':
      archetypes = modernArchetypes;
      formatHealth = modernHealth;
      break;
    case 'commander':
      archetypes = commanderArchetypes;
      formatHealth = commanderHealth;
      break;
  }

  const { rising, declining } = generateTrendData(archetypes);

  return {
    format,
    dateRange,
    lastUpdated: new Date().toISOString(),
    archetypes,
    formatHealth,
    risingArchetypes: rising,
    decliningArchetypes: declining,
    cardTrends: generateCardTrends(),
  };
}

export function getTopDecks(format: MagicFormat, limit: number = 10): DeckArchetype[] {
  const data = getMetaData(format, 'alltime');
  return data.archetypes
    .sort((a, b) => b.metaShare - a.metaShare)
    .slice(0, limit);
}

export function getCardInclusionRates(archetypeId: string): CardInclusion[] {
  const allArchetypes = [...standardArchetypes, ...modernArchetypes, ...commanderArchetypes];
  const archetype = allArchetypes.find(a => a.id === archetypeId);
  return archetype?.topCards || [];
}

export function getFormatHealth(format: MagicFormat): FormatHealth {
  const data = getMetaData(format, 'alltime');
  return data.formatHealth;
}

export function getRisingArchetypes(format: MagicFormat): TrendData[] {
  const data = getMetaData(format, '30days');
  return data.risingArchetypes;
}

export function getDecliningArchetypes(format: MagicFormat): TrendData[] {
  const data = getMetaData(format, '30days');
  return data.decliningArchetypes;
}

export function getCardTrends(): CardTrend[] {
  const data = getMetaData('standard', '30days');
  return data.cardTrends;
}

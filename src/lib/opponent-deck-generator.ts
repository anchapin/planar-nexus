/**
 * @fileOverview Client-side opponent deck generation module
 * 
 * This module generates random AI opponent decks for single-player mode.
 * Works entirely offline without API calls.
 */

// No imports needed - this module generates deck data offline

// Deck archetype definitions
export type DeckArchetype = 'aggro' | 'control' | 'midrange' | 'combo' | 'ramp' | 'prison';

export interface OpponentDeckGenerationInput {
  format: string;
  archetype?: DeckArchetype;
  colorIdentity?: string[];
  powerLevel?: 'casual' | 'competitive';
}

export interface GeneratedDeck {
  name: string;
  archetype: DeckArchetype;
  description: string;
  cards: Array<{ name: string; quantity: number }>;
  colorIdentity: string[];
}

// Common cards by role and color (minimal set for offline generation)
const CARD_POOL: Record<string, string[]> = {
  // White aggro
  'W_creatures': ['Soul Warden', 'Champion of the Parish', 'Knight of the White Orchid', 'Adanto Vanguard', 'Benevolent Bodyguard'],
  'W_removal': ['Path to Exile', 'Swords to Plowshares', 'Justice Strike', 'Divine Offering'],
  'W_utility': ['Mana Tithe', 'Apostle\'s Blessing', 'Safety // Grief'],
  
  // Blue control
  'U_creatures': ['Snapcaster Mage', 'Thing in the Ice', 'Archmage Emeritus', 'Jace, Vryn\'s Prodigy'],
  'U_counter': ['Counterspell', 'Negate', 'Dispel', 'Neutralize', 'Syncopate'],
  'U_draw': ['Brainstorm', 'Ponder', 'Preordain', 'Chart a Course'],
  
  // Black reanimation
  'B_creatures': ['Grave Crawler', 'Nezumi Prowler', 'Gifted // Willied', 'Phyrexian Rager'],
  'B_kill': ['Innocent Blood', 'Go for the Throat', 'Victim // Night', 'Dead // Gone'],
  'B_reanimate': ['Entomb', 'Unburial Rites', 'Dread Return'],
  
  // Red aggro
  'R_creatures': ['Goblin Guide', 'Monastery Swiftspear', 'Eidolon of the Great Revel', 'Ragavan, Nimble Pilferer'],
  'R_burn': ['Lightning Bolt', 'Lightning Strike', 'Burst Lightning', 'Searing Blaze'],
  'R_utility': ['Fire // Ice', 'Collision // Colussus'],
  
  // Green ramp
  'G_creatures': ['Llanowar Elves', 'Elvish Mystic', 'Fyndhorn Elves', 'Heritage Druid', 'Arbor Elf'],
  'G_ramp': ['Rampant Growth', 'Farseek', 'Nature\'s Lore', 'Cultivate', 'Kodama\'s Reach'],
  'G_big': ['Craterhoof Behemoth', 'Worldspine Wurm', 'Terastodon', 'Mifficult'],
  
  // Colorless/Universal
  'colorless_rocks': ['Sol Ring', 'Arcane Signet', 'Darksteel Ingot', 'Thought Vessel', 'Everflowing Chalice'],
  'colorless_utility': ['Swiftfoot Boots', 'Lightning Greaves', 'Sensei\'s Divining Top', 'Scroll Rack'],
  
  // Lands
  'lands_dual': ['Evolving Wilds', 'Terramorphic Expanse', 'Exotic Orchard', 'City of Brass'],
  'lands_basic': ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'],
};

// Archetype definitions
const ARCHETYPE_CONFIGS: Record<DeckArchetype, { 
  creatureRole: string[];
  spellRole: string[];
  curve: { [cmc: number]: number };
  description: string;
}> = {
  aggro: {
    creatureRole: ['W_creatures', 'R_creatures', 'B_creatures', 'G_creatures', 'U_creatures'],
    spellRole: ['W_removal', 'R_burn', 'B_kill', 'U_counter'],
    curve: { 0: 0, 1: 8, 2: 10, 3: 6, 4: 3, 5: 2, 6: 1 },
    description: 'Fast-paced deck that aims to win quickly through aggressive creatures and burn.',
  },
  control: {
    creatureRole: ['U_creatures', 'B_creatures'],
    spellRole: ['U_counter', 'U_draw', 'B_kill', 'W_removal'],
    curve: { 0: 0, 1: 2, 2: 6, 3: 8, 4: 6, 5: 4, 6: 4 },
    description: 'Defensive deck that controls the board and wins through card advantage.',
  },
  midrange: {
    creatureRole: ['W_creatures', 'B_creatures', 'G_creatures', 'R_creatures'],
    spellRole: ['W_removal', 'R_burn', 'B_kill', 'G_ramp', 'U_counter'],
    curve: { 0: 0, 1: 4, 2: 8, 3: 8, 4: 6, 5: 4, 6: 2 },
    description: 'Balanced deck with threats and answers for all stages of the game.',
  },
  combo: {
    creatureRole: ['U_creatures', 'G_creatures', 'B_creatures'],
    spellRole: ['U_draw', 'B_reanimate', 'G_ramp', 'U_counter'],
    curve: { 0: 0, 1: 2, 2: 4, 3: 6, 4: 8, 5: 6, 6: 4 },
    description: 'Synergistic deck that combines cards for powerful interactions.',
  },
  ramp: {
    creatureRole: ['G_creatures', 'G_creatures'],
    spellRole: ['G_ramp', 'G_big'],
    curve: { 0: 0, 1: 4, 2: 6, 3: 6, 4: 8, 5: 8, 6: 8 },
    description: 'Mana-focused deck that accelerates into powerful late-game threats.',
  },
  prison: {
    creatureRole: ['W_creatures', 'U_creatures'],
    spellRole: ['W_removal', 'U_counter', 'B_kill'],
    curve: { 0: 0, 1: 2, 2: 6, 3: 8, 4: 8, 5: 4, 6: 2 },
    description: 'Lockdown deck that restricts opponent\'s resources and options.',
  },
};

// Helper to get random items from array
function getRandomItems<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Get all cards for given color identity
function getCardsForColors(colorIdentity: string[]): { creatures: string[]; spells: string[]; rocks: string[] } {
  const creatures: string[] = [];
  const spells: string[] = [];
  const rocks = [...CARD_POOL.colorless_rocks];
  
  for (const color of colorIdentity) {
    // Add creatures
    const creatureKey = `${color}_creatures` as keyof typeof CARD_POOL;
    if (CARD_POOL[creatureKey]) {
      creatures.push(...CARD_POOL[creatureKey]);
    }
    
    // Add spells
    const spellKeys = [`${color}_removal`, `${color}_burn`, `${color}_kill`, `${color}_counter`, `${color}_draw`, `${color}_ramp`, `${color}_big`, `${color}_reanimate`, `${color}_utility`];
    for (const key of spellKeys) {
      if (CARD_POOL[key]) {
        spells.push(...CARD_POOL[key]);
      }
    }
  }
  
  return { creatures, spells, rocks };
}

// Generate deck based on archetype
export function generateOpponentDeck(input: OpponentDeckGenerationInput): GeneratedDeck {
  const defaultColors: string[] = ['W', 'U', 'B', 'R', 'G'].slice(0, Math.floor(Math.random() * 5) + 1);
  const { format, archetype = 'midrange', colorIdentity = defaultColors, powerLevel = 'casual' } = input;
  
  const config = ARCHETYPE_CONFIGS[archetype];
  const cards: Array<{ name: string; quantity: number }> = [];
  
  // Get cards for color identity
  const { creatures, spells, rocks } = getCardsForColors(colorIdentity);
  
  // Add lands (37-40 for commander)
  const landCount = format === 'commander' ? 38 : 24;
  const colorIndices: Record<string, number> = { W: 0, U: 1, B: 2, R: 3, G: 4 };
  const basicLands = colorIdentity.map(c => CARD_POOL.lands_basic[colorIndices[c]] || 'Plains');
  
  // Distribute basic lands
  for (const land of basicLands) {
    const count = Math.floor(landCount / basicLands.length);
    if (count > 0) {
      cards.push({ name: land, quantity: count });
    }
  }
  
  // Add mana rocks
  const rockCount = powerLevel === 'competitive' ? 8 : 5;
  const selectedRocks = getRandomItems(rocks, rockCount);
  for (const rock of selectedRocks) {
    cards.push({ name: rock, quantity: 1 });
  }
  
  // Add creatures based on curve
  const creatureCount = Math.floor((60 - landCount - rockCount) * 0.4);
  const selectedCreatures = getRandomItems(creatures, Math.ceil(creatureCount * 0.7));
  
  for (const creature of selectedCreatures) {
    // Distribute across curve based on archetype
    let qty = 1;
    if (Math.random() > 0.7) qty = 2;
    if (Math.random() > 0.9) qty = 3;
    if (Math.random() > 0.95) qty = 4;
    cards.push({ name: creature, quantity: qty });
  }
  
  // Add spells
  const spellCount = Math.floor((60 - landCount - rockCount) * 0.3);
  const selectedSpells = getRandomItems(spells, spellCount);
  for (const spell of selectedSpells) {
    cards.push({ name: spell, quantity: 1 });
  }
  
  // Fill remaining with utility
  const utilityCards = [
    'Brainstorm', 'Ponder', 'Counterspell', 'Lightning Bolt', 
    'Swords to Plowshares', 'Rampant Growth', 'Cultivate'
  ];
  while (cards.length < 60) {
    const utility = getRandomItems(utilityCards, 1)[0];
    if (utility && !cards.find(c => c.name === utility)) {
      cards.push({ name: utility, quantity: 1 });
    }
  }
  
  // Generate deck name
  const colorNames: Record<string, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
  const colors = colorIdentity.map(c => colorNames[c]).join('/');
  const archetypeNames: Record<DeckArchetype, string> = {
    aggro: 'Aggro', control: 'Control', midrange: 'Midrange',
    combo: 'Combo', ramp: 'Ramp', prison: 'Prison'
  };
  
  return {
    name: `${colors} ${archetypeNames[archetype]}`,
    archetype,
    description: config.description,
    cards: cards.slice(0, 60),
    colorIdentity,
  };
}

// Quick generate random deck
export function generateRandomDeck(format: string = 'commander'): GeneratedDeck {
  const archetypes: DeckArchetype[] = ['aggro', 'control', 'midrange', 'combo', 'ramp', 'prison'];
  const archetype = archetypes[Math.floor(Math.random() * archetypes.length)];
  const powerLevels: ('casual' | 'competitive')[] = ['casual', 'competitive'];
  const powerLevel = powerLevels[Math.floor(Math.random() * powerLevels.length)];
  
  return generateOpponentDeck({ format, archetype, powerLevel });
}

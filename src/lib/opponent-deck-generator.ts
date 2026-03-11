/**
 * @fileOverview Enhanced client-side opponent deck generation module
 *
 * This module generates varied, balanced AI opponent decks for single-player mode.
 * Works entirely offline without API calls or AI providers.
 *
 * Features:
 * - Archetype-based generation with strategic themes
 * - Difficulty-based deck quality scaling
 * - Color identity enforcement
 * - Format-specific deck construction
 * - Strategic synergy evaluation
 */

import { formatRules, Format } from './game-rules';
import type { MinimalCard } from './card-database';

// Re-export Format type for test imports
export type { Format };

// Difficulty levels that map to deck quality
export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'expert';

// Expanded deck archetype definitions
export type DeckArchetype =
  | 'aggro'
  | 'control'
  | 'midrange'
  | 'combo'
  | 'ramp'
  | 'prison'
  | 'tempo'
  | 'tokens'
  | 'aristocrats'
  | 'stompy';

// Strategic themes within archetypes
export type StrategicTheme =
  | 'burn'          // Direct damage focus
  | 'weiss'         // White weenies
  | 'fairies'       // Blue/white flying
  | 'zombies'       // Black graveyard synergy
  | 'dragons'       // Big flying threats
  | 'tokens'        // Token generation
  | 'mill'          // Decking opponent
  | 'lifegain'      // Life gain synergies
  | 'artifacts'     // Artifact focus
  | 'enchantments'  // Enchantment focus
  | 'counters'      // Counterspell-heavy
  | 'reanimator'    // Graveyard recursion
  | 'elves'         // Elf tribal
  | 'goblins'       // Goblin tribal
  | 'control'       // Traditional control
  | 'midrange'      // Value-based midrange
  | 'storm'         // Storm combo
  | 'scapeshift'    // Land-based combo
  | 'trample'       // Trample threats
  | 'haste'         // Haste creatures
  | 'flash'         // Flash creatures
  | 'aristocrats'    // Sacrifice synergies
  | 'tempo'         // Disruptive control
  | 'toolbox'       // Silver bullet creatures
  | 'toolbox'       // Silver bullet creatures;

export interface OpponentDeckGenerationInput {
  format: Format;
  archetype?: DeckArchetype;
  theme?: StrategicTheme;
  colorIdentity?: string[];
  difficulty?: DifficultyLevel;
}

export interface GeneratedDeck {
  name: string;
  archetype: DeckArchetype;
  theme: StrategicTheme;
  description: string;
  strategicApproach: string;
  cards: Array<{ name: string; quantity: number }>;
  colorIdentity: string[];
  difficulty: DifficultyLevel;
  format: Format;
}

// Difficulty configuration
interface DifficultyConfig {
  curve: { [cmc: number]: number };
  synergyWeight: number;
  removalCount: number;
  creatureCount: number;
  landCount: number;
  manaFixing: number;
  consistency: number;
}

const DIFFICULTY_CONFIGS: Record<DifficultyLevel, DifficultyConfig> = {
  easy: {
    curve: { 0: 0, 1: 6, 2: 10, 3: 8, 4: 6, 5: 4, 6: 4, 7: 2 },
    synergyWeight: 0.3,
    removalCount: 4,
    creatureCount: 28,
    landCount: 22,
    manaFixing: 0.3,
    consistency: 0.5,
  },
  medium: {
    curve: { 0: 0, 1: 8, 2: 12, 3: 10, 4: 8, 5: 6, 6: 4, 7: 2 },
    synergyWeight: 0.5,
    removalCount: 6,
    creatureCount: 24,
    landCount: 24,
    manaFixing: 0.5,
    consistency: 0.7,
  },
  hard: {
    curve: { 0: 0, 1: 10, 2: 14, 3: 12, 4: 10, 5: 6, 6: 4, 7: 2 },
    synergyWeight: 0.7,
    removalCount: 8,
    creatureCount: 22,
    landCount: 24,
    manaFixing: 0.7,
    consistency: 0.85,
  },
  expert: {
    curve: { 0: 0, 1: 12, 2: 16, 3: 14, 4: 10, 5: 6, 6: 4, 7: 2 },
    synergyWeight: 0.9,
    removalCount: 10,
    creatureCount: 20,
    landCount: 24,
    manaFixing: 0.85,
    consistency: 0.95,
  },
};

// Expanded card pool with strategic categories
interface CardPool {
  [key: string]: string[];
}

const CARD_POOL: CardPool = {
  // === WHITE CARDS ===
  'W_one_drops': [
    'Soul Warden', 'Champion of the Parish', 'Isamaru, Hound of Konda',
    'Mother of Runes', 'Thalia, Guardian of Thraben', 'Kytheon, Hero of Akros',
    'Student of Warfare', 'Steppe Lynx', 'Usher of the Fallen',
  ],
  'W_two_drops': [
    'Knight of the White Orchid', 'Thalia\'s Lieutenant', 'Selfless Spirit',
    'Mentor of the Meek', 'Leonin Arbiter', 'Wall of Omens',
    'Kytheon\'s Tactics', 'Dauntless Bodyguard', 'Gideon\'s Lawkeeper',
  ],
  'W_three_drops': [
    'Adanto Vanguard', 'Benevolent Bodyguard', 'Leonin Relic-Warder',
    'Mirran Crusader', 'Knight of the Holy Nimbus', 'Sun Titan',
    'Eldrazi Displacer', 'Restoration Angel', 'Flickerwisp',
  ],
  'W_four_drops': [
    'Hero of Bladehold', 'Brave the Elements', 'Auriok Champion',
    'Spectral Procession', 'Cloudgoat Ranger', 'Herald of War',
  ],
  'W_removal': [
    'Path to Exile', 'Swords to Plowshares', 'Justice Strike', 'Divine Offering',
    'Declaration in Stone', 'Oblivion Ring', 'Banishing Light', 'Anguished Unmaking',
  ],
  'W_utility': [
    'Mana Tithe', 'Apostle\'s Blessing', 'Safety // Grief', 'Selfless Spirit',
    'Emeria Angel', 'Honor of the Pure', 'Intangible Virtue', 'Anafenza, Kin-Tree Spirit',
  ],
  'W_lifegain': [
    'Soul Warden', 'Soul\'s Attendant', 'Auriok Champion', 'Crested Sunmare',
    'Sphinx\'s Revelation', 'Revitalize', 'Healing Salve', 'Rest for the Weary',
  ],

  // === BLUE CARDS ===
  'U_one_drops': [
    'Delver of Secrets', 'Cursecatcher', 'Phantasmal Image', 'Thassa\'s Oracle',
    'Llanowar Elves', 'Elvish Mystic', 'Birds of Paradise', 'Noble Hierarch',
  ],
  'U_two_drops': [
    'Snapcaster Mage', 'Thing in the Ice', 'Glen Elendra Archmage',
    'Vendilion Clique', 'Spellstutter Sprite', 'Mystic Remora',
    'Dark Confidant', 'Grim Lavamancer', 'Sakura-Tribe Elder',
  ],
  'U_three_drops': [
    'Archmage Emeritus', 'Jace, Vryn\'s Prodigy', 'Teferi, Time Raveler',
    'Mystic Confluence', 'Narset, Parter of Veils', 'Mulldrifter',
  ],
  'U_four_drops': [
    'Cryptic Command', 'Tezzeret the Seeker', 'Jace Beleren',
    'Aetherling', 'Vendilion Clique', 'Batterskull',
  ],
  'U_counter': [
    'Counterspell', 'Negate', 'Dispel', 'Neutralize', 'Syncopate',
    'Mana Leak', 'Spell Pierce', 'Force of Will', 'Daze', 'Arcane Denial',
  ],
  'U_draw': [
    'Brainstorm', 'Ponder', 'Preordain', 'Chart a Course', 'Ancestral Recall',
    'Cantrip', 'Fact or Fiction', 'Jace\'s Ingenuity', 'Opportunity',
  ],
  'U_tempo': [
    'Vapor Snag', 'Unsummon', 'Bounce', 'Remand', 'Cryptic Command',
    'Mystic Confluence', 'Venser, Shaper Savant', 'Peregrine Drake',
  ],

  // === BLACK CARDS ===
  'B_one_drops': [
    'Grave Crawler', 'Bloodsoaked Champion', 'Vampire Lacerator',
    'Goblin Guide', 'Goblin Welder', 'Bloodthrone Vampire',
  ],
  'B_two_drops': [
    'Nezumi Prowler', 'Gifted // Willied', 'Phyrexian Rager', 'Pack Rat',
    'Thoughtseize', 'Inquisition of Kozilek', 'Duress', 'Despise',
  ],
  'B_three_drops': [
    'Phyrexian Arena', 'Grim Haruspex', 'Liliana of the Veil',
    'Deathrite Shaman', 'Geralf\'s Messenger', 'Mesmeric Fiend',
  ],
  'B_four_drops': [
    'Sheoldred, Whispering One', 'Grave Titan', 'Phyrexian Obliterator',
    'Massacre Wurm', 'Gary', 'Huntmaster of the Fells',
  ],
  'B_kill': [
    'Innocent Blood', 'Go for the Throat', 'Victim // Night', 'Dead // Gone',
    'Doom Blade', 'Murder', 'Hero\'s Downfall', 'Ultimate Price', 'Terminate',
    'Abrupt Decay', 'Maelstrom Pulse', 'Dismember', 'Tragic Slip',
  ],
  'B_reanimate': [
    'Entomb', 'Unburial Rites', 'Dread Return', 'Animate Dead',
    'Reanimate', 'Exhume', 'Necromancy', 'Dance of the Dead',
  ],
  'B_discard': [
    'Thoughtseize', 'Inquisition of Kozilek', 'Duress', 'Despise',
    'Thought Scour', 'Mind Rot', 'Hymn to Tourach', 'Mind Burst',
  ],
  'B_zombies': [
    'Grave Crawler', 'Geralf\'s Messenger', 'Shepherd of Rot',
    'Rotlung Reanimator', 'Carrion Feeder', 'Undead Warchief',
    'Lord of the Undead', 'Zombie Master', 'Cemetery Reaper',
  ],

  // === RED CARDS ===
  'R_one_drops': [
    'Goblin Guide', 'Monastery Swiftspear', 'Goblin Bushwhacker',
    'Ragavan, Nimble Pilferer', 'Dragon Fodder', 'Krenko\'s Buzzbrew',
  ],
  'R_two_drops': [
    'Eidolon of the Great Revel', 'Goblin Piledriver', 'Goblin Matron',
    'Young Pyromancer', 'Mogg War Marshal', 'Feldon\'s Cane',
  ],
  'R_three_drops': [
    'Hazoret the Fervent', 'Blood Moon', 'Kiki-Jiki, Mirror Breaker',
    'Molten Rain', 'Stormbreath Dragon', 'Glorybringer',
  ],
  'R_four_drops': [
    'Chandra, Torch of Defiance', 'Krenko, Mob Boss', 'Pia and Kiran Nalaar',
    'Hazardous Conditions', 'Siege-Gang Commander', 'Hellrider',
  ],
  'R_burn': [
    'Lightning Bolt', 'Lightning Strike', 'Burst Lightning', 'Searing Blaze',
    'Chain Lightning', 'Lava Spike', 'Skullcrack', 'Boros Charm',
    'Fireblast', 'Flame Slash', 'Searing Blood', 'Vexing Devil',
  ],
  'R_utility': [
    'Fire // Ice', 'Collision // Colossus', 'Faithless Looting', 'Wheel of Fortune',
    'Chaos Warp', 'Chandra\'s Pyrohelix', 'Pyrokinesis', 'Price of Progress',
  ],
  'R_goblins': [
    'Goblin Guide', 'Goblin Piledriver', 'Goblin Matron', 'Goblin Warchief',
    'Krenko, Mob Boss', 'Siege-Gang Commander', 'Goblin Chieftain', 'Mogg Fanatic',
  ],

  // === GREEN CARDS ===
  'G_one_drops': [
    'Llanowar Elves', 'Elvish Mystic', 'Fyndhorn Elves', 'Heritage Druid',
    'Arbor Elf', 'Birds of Paradise', 'Noble Hierarch', 'Deathrite Shaman',
  ],
  'G_two_drops': [
    'Sakura-Tribe Elder', 'Wall of Roots', 'Eternal Witness', 'Courser of Kruphix',
    'Scavenging Ooze', 'Questing Beast', 'Strangleroot Geist', 'Kitchen Finks',
  ],
  'G_three_drops': [
    'Knight of the Reliquary', 'Eternal Witness', 'Voice of Resurgence',
    'Fierce Empath', 'Courser of Kruphix', 'Thrun, the Last Troll',
  ],
  'G_four_drops': [
    'Craterhoof Behemoth', 'Worldspine Wurm', 'Terastodon', 'Avenger of Zendikar',
    'Primal Command', 'Polukranos, Unchained', 'Thragtusk',
  ],
  'G_ramp': [
    'Rampant Growth', 'Farseek', 'Nature\'s Lore', 'Cultivate', 'Kodama\'s Reach',
    'Sol Ring', 'Birds of Paradise', 'Noble Hierarch', 'Deathrite Shaman',
  ],
  'G_big': [
    'Craterhoof Behemoth', 'Worldspine Wurm', 'Terastodon', 'Avenger of Zendikar',
    'Primal Command', 'Polukranos, Unchained', 'Thragtusk', 'Vorinclex, Voice of Hunger',
  ],
  'G_elves': [
    'Llanowar Elves', 'Elvish Mystic', 'Fyndhorn Elves', 'Heritage Druid',
    'Arbor Elf', 'Elvish Archdruid', 'Ezuri, Renegade Leader', 'Elvish Champion',
    'Imperious Perfect', 'Timberwatch Elf', 'Jagged-Scar Archers',
  ],
  'G_trample': [
    'Questing Beast', 'Thrun, the Last Troll', 'Polukranos, Unchained',
    'Vorinclex, Voice of Hunger', 'Craterhoof Behemoth', 'Worldspine Wurm',
  ],

  // === COLORLESS CARDS ===
  'colorless_rocks': [
    'Sol Ring', 'Arcane Signet', 'Darksteel Ingot', 'Thought Vessel', 'Everflowing Chalice',
    'Worn Powerstone', 'Thran Dynamo', 'Gilded Lotus', 'Mind Stone', 'Fellwar Stone',
  ],
  'colorless_utility': [
    'Swiftfoot Boots', 'Lightning Greaves', 'Sensei\'s Divining Top', 'Scroll Rack',
    'Batterskull', 'Wurmcoil Engine', 'Basalt Monolith', 'Crypt', 'Mana Vault',
  ],
  'colorless_equipment': [
    'Sword of Fire and Ice', 'Sword of Light and Shadow', 'Sword of Feast and Famine',
    'Umezawa\'s Jitte', 'Bonesplitter', 'Skullclamp', 'Cranial Plating', 'Runechanter\'s Pike',
  ],

  // === LANDS ===
  'lands_dual': [
    'Evolving Wilds', 'Terramorphic Expanse', 'Exotic Orchard', 'City of Brass',
    'Mana Confluence', 'Command Tower', 'Reflecting Pool', 'Gemstone Mine',
    'Shockland', 'Checkland', 'Battleland', 'Fetchland',
  ],
  'lands_basic': ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'],
};

// Enhanced archetype configurations with strategic themes
interface ArchetypeConfig {
  preferredColors: string[];
  creatureCategories: string[];
  spellCategories: string[];
  themes: StrategicTheme[];
  description: string;
  strategicApproach: string;
}

const ARCHETYPE_CONFIGS: Record<DeckArchetype, ArchetypeConfig> = {
  aggro: {
    preferredColors: ['R', 'W', 'B'],
    creatureCategories: ['W_one_drops', 'R_one_drops', 'B_one_drops', 'W_two_drops', 'R_two_drops', 'R_three_drops'],
    spellCategories: ['R_burn', 'W_removal', 'B_kill', 'R_utility'],
    themes: ['burn', 'weiss', 'zombies', 'haste', 'goblins'],
    description: 'Fast-paced deck that aims to win quickly through aggressive creatures and burn.',
    strategicApproach: 'Deploy cheap, efficient threats early. Apply constant pressure with creatures and direct damage. Prioritize speed over card advantage. Mulligan aggressively for low-curve hands.',
  },
  control: {
    preferredColors: ['U', 'B', 'W'],
    creatureCategories: ['U_two_drops', 'U_three_drops', 'B_three_drops', 'W_three_drops'],
    spellCategories: ['U_counter', 'U_draw', 'B_kill', 'W_removal', 'B_discard', 'U_tempo'],
    themes: ['control', 'counters', 'mill', 'reanimator'],
    description: 'Defensive deck that controls the board and wins through card advantage.',
    strategicApproach: 'Control the early game with removal and countermagic. Draw extra cards to find win conditions. Establish a dominant board state in the mid-to-late game. Prioritize card quality over quantity.',
  },
  midrange: {
    preferredColors: ['G', 'B', 'W', 'R'],
    creatureCategories: ['G_two_drops', 'G_three_drops', 'B_two_drops', 'B_three_drops', 'W_two_drops', 'W_three_drops'],
    spellCategories: ['G_ramp', 'B_kill', 'W_removal', 'R_burn', 'U_draw'],
    themes: ['midrange', 'aristocrats', 'toolbox', 'flash'],
    description: 'Balanced deck with threats and answers for all stages of the game.',
    strategicApproach: 'Play value creatures that provide multiple benefits. Use removal to disrupt opponent\'s threats while advancing your own board. Adapt strategy based on matchup and game state.',
  },
  combo: {
    preferredColors: ['U', 'G', 'B'],
    creatureCategories: ['U_one_drops', 'U_two_drops', 'G_one_drops', 'G_two_drops', 'B_two_drops'],
    spellCategories: ['U_draw', 'G_ramp', 'B_reanimate', 'U_counter', 'G_big'],
    themes: ['storm', 'reanimator', 'scapeshift', 'artifacts', 'enchantments'],
    description: 'Synergistic deck that combines cards for powerful interactions.',
    strategicApproach: 'Search for combo pieces aggressively. Use card selection spells to find key cards. Protect combo with countermagic and removal. Execute win condition as soon as pieces are assembled.',
  },
  ramp: {
    preferredColors: ['G', 'U', 'R'],
    creatureCategories: ['G_one_drops', 'G_two_drops', 'U_two_drops', 'G_three_drops'],
    spellCategories: ['G_ramp', 'G_big', 'U_draw', 'R_utility', 'colorless_rocks'],
    themes: ['dragons', 'trample', 'artifacts', 'enchantments'],
    description: 'Mana-focused deck that accelerates into powerful late-game threats.',
    strategicApproach: 'Prioritize mana acceleration in the early turns. Protect your ramp spells until they resolve. Play powerful threats that dominate the game once you reach enough mana.',
  },
  prison: {
    preferredColors: ['W', 'U', 'R'],
    creatureCategories: ['W_two_drops', 'W_three_drops', 'U_two_drops', 'R_three_drops'],
    spellCategories: ['W_removal', 'U_counter', 'R_utility', 'W_utility', 'U_tempo'],
    themes: ['control', 'counters', 'artifacts', 'enchantments'],
    description: 'Lockdown deck that restricts opponent\'s resources and options.',
    strategicApproach: 'Deploy resource denial effects early. Counter key threats from the opponent. Establish a dominant board position while limiting opponent\'s options. Win through gradual advantage.',
  },
  tempo: {
    preferredColors: ['U', 'R', 'W'],
    creatureCategories: ['U_one_drops', 'U_two_drops', 'R_one_drops', 'R_two_drops', 'W_one_drops'],
    spellCategories: ['U_tempo', 'U_counter', 'R_burn', 'R_utility', 'W_removal'],
    themes: ['haste', 'flash', 'fairies', 'tempo'],
    description: 'Aggressive control deck that disrupts opponents while applying pressure.',
    strategicApproach: 'Apply early pressure while disrupting opponent\'s plays. Use bounce spells to clear blockers. Countermagic protects your threats and disrupts opponent\'s key spells. Win through efficient damage and tempo advantage.',
  },
  tokens: {
    preferredColors: ['W', 'G', 'B'],
    creatureCategories: ['W_one_drops', 'W_two_drops', 'G_two_drops', 'B_two_drops', 'G_three_drops'],
    spellCategories: ['W_utility', 'G_big', 'W_removal', 'B_kill', 'W_lifegain'],
    themes: ['tokens', 'aristocrats', 'lifegain', 'elves'],
    description: 'Deck focused on generating and utilizing token creatures.',
    strategicApproach: 'Generate tokens early and often. Use token-specific synergies to maximize their value. Populate the board rapidly and overwhelm with token swarm. Use removal to clear blockers for token attacks.',
  },
  aristocrats: {
    preferredColors: ['B', 'W', 'R'],
    creatureCategories: ['B_one_drops', 'B_two_drops', 'W_one_drops', 'W_two_drops', 'R_one_drops'],
    spellCategories: ['B_kill', 'W_removal', 'R_utility', 'B_reanimate', 'W_lifegain'],
    themes: ['aristocrats', 'zombies', 'lifegain', 'tokens'],
    description: 'Synergy deck that sacrifices creatures for value.',
    strategicApproach: 'Sacrifice creatures to generate advantage and drain opponents. Use recursive threats to maintain board presence. Drain opponent\'s life through sacrifice effects. Win through cumulative damage and life gain.',
  },
  stompy: {
    preferredColors: ['G', 'R', 'U'],
    creatureCategories: ['G_one_drops', 'G_two_drops', 'R_one_drops', 'R_two_drops', 'U_one_drops'],
    spellCategories: ['G_ramp', 'R_burn', 'G_trample', 'U_counter', 'G_big'],
    themes: ['trample', 'haste', 'dragons', 'artifacts'],
    description: 'Aggressive deck with powerful, efficient creatures.',
    strategicApproach: 'Play big threats quickly and attack aggressively. Use pump spells and removal to clear blockers. Prioritize creature quality over card advantage. Win through overwhelming board presence and damage.',
  },
};

// Theme-specific card pool modifications
interface ThemeCardPool {
  additionalCreatures: string[];
  additionalSpells: string[];
  keyCards: string[];
}

const THEME_MODIFIERS: Record<StrategicTheme, ThemeCardPool> = {
  burn: {
    additionalCreatures: ['Goblin Guide', 'Monastery Swiftspear', 'Vexing Devil'],
    additionalSpells: ['Lightning Bolt', 'Lava Spike', 'Skullcrack', 'Boros Charm', 'Fireblast'],
    keyCards: ['Lightning Bolt', 'Goblin Guide'],
  },
  weiss: {
    additionalCreatures: ['Soul Warden', 'Champion of the Parish', 'Thalia, Guardian of Thraben'],
    additionalSpells: ['Honor of the Pure', 'Brave the Elements', 'Path to Exile'],
    keyCards: ['Honor of the Pure', 'Thalia, Guardian of Thraben'],
  },
  fairies: {
    additionalCreatures: ['Spellstutter Sprite', 'Vendilion Clique', 'Mistbind Clique'],
    additionalSpells: ['Bitterblossom', 'Cryptic Command', 'Vapor Snag'],
    keyCards: ['Bitterblossom', 'Spellstutter Sprite'],
  },
  zombies: {
    additionalCreatures: ['Grave Crawler', 'Geralf\'s Messenger', 'Shepherd of Rot'],
    additionalSpells: ['Diregraf Ghoul', 'Gravecrawler', 'Dead // Gone'],
    keyCards: ['Grave Crawler', 'Geralf\'s Messenger'],
  },
  dragons: {
    additionalCreatures: ['Stormbreath Dragon', 'Glorybringer', 'Thundermaw Hellkite'],
    additionalSpells: ['Crucible of the Spirit Dragon', 'Dragon\'s Hoard', 'Sarkhan, Fireblood'],
    keyCards: ['Stormbreath Dragon', 'Glorybringer'],
  },
  tokens: {
    additionalCreatures: ['Young Pyromancer', 'Monastery Mentor', 'Secure the Wastes'],
    additionalSpells: ['Raise the Alarm', 'Spectral Procession', 'Secure the Wastes'],
    keyCards: ['Secure the Wastes', 'Spectral Procession'],
  },
  mill: {
    additionalCreatures: ['Jace\'s Phantasm', 'Hedron Crab', 'Manic Scribe'],
    additionalSpells: ['Mind Funeral', 'Mesmeric Orb', 'Archive Trap', 'Glimpse the Unthinkable'],
    keyCards: ['Mind Funeral', 'Mesmeric Orb'],
  },
  lifegain: {
    additionalCreatures: ['Soul Warden', 'Soul\'s Attendant', 'Auriok Champion', 'Crested Sunmare'],
    additionalSpells: ['Sphinx\'s Revelation', 'Revitalize', 'Rest for the Weary', 'Felidar Sovereign'],
    keyCards: ['Crested Sunmare', 'Felidar Sovereign'],
  },
  artifacts: {
    additionalCreatures: ['Karn, Silver Golem', 'Arcbound Ravager', 'Memnite'],
    additionalSpells: ['Mox Opal', 'Chromatic Lantern', 'Whir of Invention'],
    keyCards: ['Arcbound Ravager', 'Mox Opal'],
  },
  enchantments: {
    additionalCreatures: ['Satyr Enchanter', 'Eidolon of Blossoms', 'Enchantress\'s Presence'],
    additionalSpells: ['Omniscience', 'Enchantress\'s Presence', 'Sylvan Library'],
    keyCards: ['Enchantress\'s Presence', 'Sylvan Library'],
  },
  counters: {
    additionalCreatures: ['Snapcaster Mage', 'Thing in the Ice', 'Teferi, Time Raveler'],
    additionalSpells: ['Counterspell', 'Mana Leak', 'Force of Will', 'Cryptic Command'],
    keyCards: ['Counterspell', 'Cryptic Command'],
  },
  reanimator: {
    additionalCreatures: ['Gravecrawler', 'Phyrexian Dreadnought', 'Iona, Shield of Emeria'],
    additionalSpells: ['Entomb', 'Animate Dead', 'Reanimate', 'Exhume'],
    keyCards: ['Entomb', 'Animate Dead'],
  },
  elves: {
    additionalCreatures: ['Llanowar Elves', 'Elvish Archdruid', 'Ezuri, Renegade Leader', 'Heritage Druid'],
    additionalSpells: ['Elvish Promenade', 'Beastmaster Ascension', 'Coat of Arms'],
    keyCards: ['Elvish Archdruid', 'Ezuri, Renegade Leader'],
  },
  goblins: {
    additionalCreatures: ['Goblin Guide', 'Goblin Piledriver', 'Goblin Matron', 'Goblin Warchief'],
    additionalSpells: ['Goblin Bushwhacker', 'Goblin War Strike', 'Empty the Warrens'],
    keyCards: ['Goblin Guide', 'Goblin Warchief'],
  },
  control: {
    additionalCreatures: ['Snapcaster Mage', 'Vendilion Clique', 'Teferi, Time Raveler'],
    additionalSpells: ['Counterspell', 'Thoughtseize', 'Brainstorm', 'Fact or Fiction'],
    keyCards: ['Counterspell', 'Thoughtseize'],
  },
  midrange: {
    additionalCreatures: ['Thrun, the Last Troll', 'Siege Rhino', 'Tarmogoyf'],
    additionalSpells: ['Abrupt Decay', 'Maelstrom Pulse', 'Thoughtseize', 'Garruk, Primal Hunter'],
    keyCards: ['Thrun, the Last Troll', 'Abrupt Decay'],
  },
  storm: {
    additionalCreatures: ['Baral, Chief of Compliance', 'Goblin Electromancer'],
    additionalSpells: ['Mind\'s Desire', 'Grapeshot', 'Empty the Warrens', 'Past in Flames'],
    keyCards: ['Mind\'s Desire', 'Grapeshot'],
  },
  scapeshift: {
    additionalCreatures: ['Sakura-Tribe Elder', 'Knight of the Reliquary'],
    additionalSpells: ['Scapeshift', 'Valakut, the Molten Pinnacle', 'Primeval Titan'],
    keyCards: ['Scapeshift', 'Primeval Titan'],
  },
  trample: {
    additionalCreatures: ['Questing Beast', 'Polukranos, Unchained', 'Vorinclex, Voice of Hunger'],
    additionalSpells: ['Rancor', 'Giant Growth', 'Aspect of Hydra'],
    keyCards: ['Questing Beast', 'Polukranos, Unchained'],
  },
  haste: {
    additionalCreatures: ['Ball Lightning', 'Spark Elemental', 'Feldon\'s Cane'],
    additionalSpells: ['Fling', 'Reckless Charge', 'Bloodrush'],
    keyCards: ['Ball Lightning', 'Feldon\'s Cane'],
  },
  flash: {
    additionalCreatures: ['Restoration Angel', 'Flickerwisp', 'Mystic Snake'],
    additionalSpells: ['Cryptic Command', 'Venser, Shaper Savant', 'Mystic Confluence'],
    keyCards: ['Restoration Angel', 'Cryptic Command'],
  },
  toolbox: {
    additionalCreatures: [' Eternal Witness', 'Kor Spiritdancer', 'Recruitment Officer'],
    additionalSpells: ['Fabricate', 'Birthing Pod', 'Chord of Calling'],
    keyCards: ['Eternal Witness', 'Chord of Calling'],
  },
  aristocrats: {
    additionalCreatures: ['Blood Artist', 'Zulaport Cutthroat', 'Carrion Feeder'],
    additionalSpells: ['Viscera Seer', 'Altar\'s Reap', 'Butcher Ghoul'],
    keyCards: ['Blood Artist', 'Zulaport Cutthroat'],
  },
  tempo: {
    additionalCreatures: ['Delver of Secrets', 'Spellstutter Sprite', 'Noble Hierarch'],
    additionalSpells: ['Daze', 'Force of Will', 'Cryptic Command'],
    keyCards: ['Delver of Secrets', 'Force of Will'],
  },
};

// Helper to get random items from array with weighting
function getRandomItems<T>(arr: T[], count: number, weights?: number[]): T[] {
  if (count <= 0) return [];
  if (arr.length === 0) return [];

  // If weights provided, use weighted random selection
  if (weights && weights.length === arr.length) {
    const selected: T[] = [];
    const available = arr.map((item, index) => ({ item, weight: weights[index] }));

    for (let i = 0; i < Math.min(count, available.length); i++) {
      const totalWeight = available.reduce((sum, item) => sum + item.weight, 0);
      let random = Math.random() * totalWeight;
      let selectedIndex = 0;

      for (let j = 0; j < available.length; j++) {
        random -= available[j].weight;
        if (random <= 0) {
          selectedIndex = j;
          break;
        }
      }

      selected.push(available[selectedIndex].item);
      available.splice(selectedIndex, 1);
    }

    return selected;
  }

  // Otherwise use simple random selection
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Weighted random selection based on card quality/importance
function getWeightedCards(categories: string[], count: number, difficulty: DifficultyLevel): string[] {
  const allCards: string[] = [];
  const weights: number[] = [];

  for (const category of categories) {
    const cards = CARD_POOL[category];
    if (!cards) continue;

    for (const card of cards) {
      allCards.push(card);
      // Higher difficulty = higher weight for good cards
      const baseWeight = 1;
      const difficultyMultiplier = {
        easy: 0.8,
        medium: 1.0,
        hard: 1.2,
        expert: 1.4,
      }[difficulty];

      weights.push(baseWeight * difficultyMultiplier);
    }
  }

  return getRandomItems(allCards, Math.min(count, allCards.length), weights);
}

// Get cards for given color identity and categories
function getCardsForColors(
  colorIdentity: string[],
  categories: string[],
  count: number,
  difficulty: DifficultyLevel
): string[] {
  if (colorIdentity.length === 0) {
    // If no colors specified, get random categories
    return getWeightedCards(categories, count, difficulty);
  }

  const allCards: string[] = [];
  const weights: number[] = [];

  for (const color of colorIdentity) {
    for (const category of categories) {
      if (category.startsWith(color)) {
        const cards = CARD_POOL[category];
        if (cards) {
          for (const card of cards) {
            allCards.push(card);
            weights.push(1.5); // Color-aligned cards get higher weight
          }
        }
      }
    }
  }

  return getRandomItems(allCards, Math.min(count, allCards.length), weights);
}

// Calculate mana curve based on archetype and difficulty
function calculateManaCurve(archetype: DeckArchetype, difficulty: DifficultyLevel): number[] {
  const baseCurve = DIFFICULTY_CONFIGS[difficulty].curve;
  const archetypeMultiplier: Record<DeckArchetype, number> = {
    aggro: 1.0,
    tempo: 1.0,
    control: 0.8,
    midrange: 1.0,
    combo: 0.9,
    ramp: 0.7,
    prison: 0.9,
    tokens: 1.0,
    aristocrats: 1.0,
    stompy: 1.0,
  };

  const multiplier = archetypeMultiplier[archetype];
  const adjustedCurve: number[] = [];

  for (let cmc = 0; cmc <= 7; cmc++) {
    adjustedCurve[cmc] = Math.floor(baseCurve[cmc] || 0 * multiplier);
  }

  return adjustedCurve;
}

// Generate lands based on color identity and format
function generateLands(
  colorIdentity: string[],
  format: Format,
  difficulty: DifficultyLevel,
  landCount: number
): Array<{ name: string; quantity: number }> {
  const lands: Array<{ name: string; quantity: number }> = [];

  if (format === 'legendary-commander') {
    // Commander decks get more lands and dual lands
    const basicLandCount = Math.floor(landCount * 0.6);
    const dualLandCount = Math.floor(landCount * 0.4);

    // Add basic lands
    if (colorIdentity.length > 0) {
      const basicLandsPerColor = Math.floor(basicLandCount / colorIdentity.length);
      for (const color of colorIdentity) {
        const colorIndex = { W: 0, U: 1, B: 2, R: 3, G: 4 }[color];
        if (colorIndex !== undefined) {
          const basicLand = CARD_POOL.lands_basic[colorIndex];
          lands.push({ name: basicLand, quantity: basicLandsPerColor });
        }
      }
    }

    // Add dual lands based on difficulty
    const dualLands = CARD_POOL.lands_dual;
    const dualLandCountActual = Math.min(dualLandCount, dualLands.length * 2);
    const selectedDuals = getRandomItems(dualLands, Math.ceil(dualLandCountActual / 2));

    for (const dualLand of selectedDuals) {
      lands.push({ name: dualLand, quantity: 2 });
    }
  } else {
    // 60-card formats
    const basicLandCount = Math.floor(landCount * 0.7);
    const dualLandCount = Math.floor(landCount * 0.3);

    // Add basic lands
    if (colorIdentity.length > 0) {
      const basicLandsPerColor = Math.floor(basicLandCount / colorIdentity.length);
      for (const color of colorIdentity) {
        const colorIndex = { W: 0, U: 1, B: 2, R: 3, G: 4 }[color];
        if (colorIndex !== undefined) {
          const basicLand = CARD_POOL.lands_basic[colorIndex];
          lands.push({ name: basicLand, quantity: basicLandsPerColor });
        }
      }
    }

    // Add dual lands
    const dualLands = CARD_POOL.lands_dual;
    const selectedDuals = getRandomItems(dualLands, dualLandCount);

    for (const dualLand of selectedDuals) {
      lands.push({ name: dualLand, quantity: 1 });
    }
  }

  return lands;
}

// Generate strategic approach based on archetype and theme
function generateStrategicApproach(
  archetype: DeckArchetype,
  theme: StrategicTheme,
  difficulty: DifficultyLevel
): string {
  const archetypeConfig = ARCHETYPE_CONFIGS[archetype];
  const themeModifier = THEME_MODIFIERS[theme];

  let approach = archetypeConfig.strategicApproach;

  // Add theme-specific guidance
  if (themeModifier.keyCards.length > 0) {
    approach += ` Key cards include ${themeModifier.keyCards.slice(0, 3).join(', ')}.`;
  }

  // Add difficulty-specific guidance
  const difficultyGuidance: Record<DifficultyLevel, string> = {
    easy: ' This opponent makes suboptimal decisions and may miss synergies.',
    medium: ' This opponent plays reasonably well but may make occasional mistakes.',
    hard: ' This opponent plays consistently well and capitalizes on synergies.',
    expert: ' This opponent makes optimal plays with deep strategic understanding.',
  };

  approach += difficultyGuidance[difficulty];

  return approach;
}

/**
 * Generate an opponent deck based on archetype, theme, and difficulty
 */
export function generateOpponentDeck(input: OpponentDeckGenerationInput): GeneratedDeck {
  const {
    format,
    archetype = 'midrange',
    theme,
    colorIdentity,
    difficulty = 'medium',
  } = input;

  const archetypeConfig = ARCHETYPE_CONFIGS[archetype];
  const difficultyConfig = DIFFICULTY_CONFIGS[difficulty];

  // Determine colors if not specified
  let finalColorIdentity = colorIdentity;
  if (!finalColorIdentity || finalColorIdentity.length === 0) {
    const colorCount = Math.floor(Math.random() * 3) + 1; // 1-3 colors
    finalColorIdentity = getRandomItems(archetypeConfig.preferredColors, colorCount);
  }

  // Determine theme if not specified
  const finalTheme = theme || getRandomItems(archetypeConfig.themes, 1)[0];

  const themeModifier = THEME_MODIFIERS[finalTheme];
  const cards: Array<{ name: string; quantity: number }> = [];

  // Get format-specific deck size
  const formatRulesConfig = formatRules[format];
  const totalCards = formatRulesConfig.minCards;
  const isCommander = format === 'legendary-commander';

  // Calculate land count based on format and difficulty
  const landCount = isCommander
    ? Math.floor(totalCards * 0.38)
    : difficultyConfig.landCount;

  // Generate lands
  const lands = generateLands(finalColorIdentity, format, difficulty, landCount);
  cards.push(...lands);

  // Calculate remaining non-land slots
  const nonLandSlots = totalCards - landCount;

  // Get card counts based on difficulty
  const creatureSlots = Math.floor(nonLandSlots * (difficultyConfig.creatureCount / 100));
  const spellSlots = Math.floor(nonLandSlots * ((100 - difficultyConfig.creatureCount - difficultyConfig.synergyWeight * 10) / 100));
  const synergySlots = nonLandSlots - creatureSlots - spellSlots;

  // Add theme-specific key cards
  const keyCardCount = Math.floor(synergySlots * 0.3);
  const keyCards = getRandomItems(themeModifier.keyCards, Math.min(keyCardCount, themeModifier.keyCards.length));

  for (const keyCard of keyCards) {
    const quantity = isCommander ? 1 : Math.min(4, keyCardCount);
    if (!cards.find(c => c.name === keyCard)) {
      cards.push({ name: keyCard, quantity });
    }
  }

  // Add creatures based on archetype and mana curve
  const manaCurve = calculateManaCurve(archetype, difficulty);
  let creaturesAdded = 0;

  for (let cmc = 0; cmc <= 7; cmc++) {
    if (manaCurve[cmc] > 0) {
      const cmcCreatures = getCardsForColors(
        finalColorIdentity,
        archetypeConfig.creatureCategories,
        manaCurve[cmc],
        difficulty
      );

      // Add theme-specific creatures
      const themeCreatures = getWeightedCards(
        themeModifier.additionalCreatures,
        Math.floor(manaCurve[cmc] * 0.3),
        difficulty
      );

      const allCreatures = [...cmcCreatures, ...themeCreatures];
      const selectedCreatures = getRandomItems(allCreatures, Math.min(manaCurve[cmc], creatureSlots - creaturesAdded));

      for (const creature of selectedCreatures) {
        const quantity = isCommander ? 1 : Math.min(4, Math.floor(Math.random() * 3) + 1);
        if (!cards.find(c => c.name === creature) && creaturesAdded < creatureSlots) {
          cards.push({ name: creature, quantity });
          creaturesAdded += quantity;
        }
      }
    }
  }

  // Add spells based on archetype
  let spellsAdded = 0;
  const spellCategories = [...archetypeConfig.spellCategories];

  // Add theme-specific spells
  for (const themeSpell of themeModifier.additionalSpells) {
    if (spellsAdded < spellSlots && !cards.find(c => c.name === themeSpell)) {
      const quantity = isCommander ? 1 : Math.min(4, Math.floor(Math.random() * 3) + 1);
      cards.push({ name: themeSpell, quantity });
      spellsAdded += quantity;
    }
  }

  // Add archetype spells
  const archetypeSpells = getCardsForColors(
    finalColorIdentity,
    spellCategories,
    spellSlots - spellsAdded,
    difficulty
  );

  for (const spell of archetypeSpells) {
    if (spellsAdded < spellSlots && !cards.find(c => c.name === spell)) {
      const quantity = isCommander ? 1 : Math.min(4, Math.floor(Math.random() * 3) + 1);
      cards.push({ name: spell, quantity });
      spellsAdded += quantity;
    }
  }

  // Add mana rocks for ramp decks or higher difficulty
  if (archetype === 'ramp' || difficulty === 'hard' || difficulty === 'expert') {
    const rockCount = isCommander ? 8 : (difficulty === 'expert' ? 4 : 3);
    const rocks = getRandomItems(CARD_POOL.colorless_rocks, rockCount);

    for (const rock of rocks) {
      if (!cards.find(c => c.name === rock)) {
        cards.push({ name: rock, quantity: 1 });
      }
    }
  }

  // Add utility artifacts for higher difficulty
  if (difficulty === 'hard' || difficulty === 'expert') {
    const utilityCount = isCommander ? 6 : 3;
    const utilities = getRandomItems(CARD_POOL.colorless_utility, utilityCount);

    for (const utility of utilities) {
      if (!cards.find(c => c.name === utility)) {
        cards.push({ name: utility, quantity: isCommander ? 1 : 1 });
      }
    }
  }

  // Fill remaining slots with generic good cards if needed
  const currentTotal = cards.reduce((sum, card) => sum + card.quantity, 0);
  if (currentTotal < totalCards) {
    const fillerCards = ['Brainstorm', 'Ponder', 'Counterspell', 'Lightning Bolt', 'Swords to Plowshares'];
    const needed = totalCards - currentTotal;

    for (const filler of fillerCards) {
      if (!cards.find(c => c.name === filler) && cards.reduce((sum, card) => sum + card.quantity, 0) < totalCards) {
        cards.push({ name: filler, quantity: 1 });
      }
    }
  }

  // Generate deck name
  const colorNames: Record<string, string> = {
    W: 'White',
    U: 'Blue',
    B: 'Black',
    R: 'Red',
    G: 'Green',
  };
  const colors = finalColorIdentity.map((c) => colorNames[c]).join('/');
  const archetypeNames: Record<DeckArchetype, string> = {
    aggro: 'Aggro',
    control: 'Control',
    midrange: 'Midrange',
    combo: 'Combo',
    ramp: 'Ramp',
    prison: 'Prison',
    tempo: 'Tempo',
    tokens: 'Tokens',
    aristocrats: 'Aristocrats',
    stompy: 'Stompy',
  };
  const themeNames: Record<StrategicTheme, string> = {
    burn: 'Burn',
    weiss: 'White Weenie',
    fairies: 'Fairies',
    zombies: 'Zombies',
    dragons: 'Dragons',
    tokens: 'Tokens',
    mill: 'Mill',
    lifegain: 'Lifegain',
    artifacts: 'Artifacts',
    enchantments: 'Enchantments',
    counters: 'Counters',
    reanimator: 'Reanimator',
    elves: 'Elves',
    goblins: 'Goblins',
    control: 'Control',
    midrange: 'Midrange',
    storm: 'Storm',
    scapeshift: 'Scapeshift',
    trample: 'Trample',
    haste: 'Haste',
    flash: 'Flash',
    toolbox: 'Toolbox',
    aristocrats: 'Aristocrats',
    tempo: 'Tempo',
  };

  const deckName = `${colors} ${archetypeNames[archetype]} - ${themeNames[finalTheme]}`;
  const strategicApproach = generateStrategicApproach(archetype, finalTheme, difficulty);

  return {
    name: deckName,
    archetype,
    theme: finalTheme,
    description: archetypeConfig.description,
    strategicApproach,
    cards: cards.slice(0, totalCards),
    colorIdentity: finalColorIdentity,
    difficulty,
    format,
  };
}

/**
 * Quick generate random deck with random parameters
 */
export function generateRandomDeck(format: Format = 'legendary-commander'): GeneratedDeck {
  const archetypes: DeckArchetype[] = ['aggro', 'control', 'midrange', 'combo', 'ramp', 'prison', 'tempo', 'tokens', 'aristocrats', 'stompy'];
  const difficulties: DifficultyLevel[] = ['easy', 'medium', 'hard', 'expert'];

  const archetype = archetypes[Math.floor(Math.random() * archetypes.length)];
  const difficulty = difficulties[Math.floor(Math.random() * difficulties.length)];

  return generateOpponentDeck({ format, archetype, difficulty });
}

/**
 * Generate deck with specific theme
 */
export function generateThemedDeck(
  theme: StrategicTheme,
  format: Format = 'legendary-commander',
  difficulty: DifficultyLevel = 'medium'
): GeneratedDeck {
  const themeToArchetype: Partial<Record<StrategicTheme, DeckArchetype>> = {
    burn: 'aggro',
    weiss: 'aggro',
    fairies: 'tempo',
    zombies: 'aristocrats',
    dragons: 'ramp',
    tokens: 'tokens',
    mill: 'control',
    lifegain: 'midrange',
    artifacts: 'combo',
    enchantments: 'combo',
    counters: 'control',
    reanimator: 'combo',
    elves: 'ramp',
    goblins: 'aggro',
    control: 'control',
    midrange: 'midrange',
    storm: 'combo',
    scapeshift: 'combo',
    trample: 'stompy',
    haste: 'aggro',
    flash: 'tempo',
    toolbox: 'midrange',
  };

  const archetype = themeToArchetype[theme] || 'midrange';
  return generateOpponentDeck({ format, archetype, theme, difficulty });
}

/**
 * Generate deck based on color identity
 */
export function generateColorDeck(
  colors: string[],
  format: Format = 'legendary-commander',
  difficulty: DifficultyLevel = 'medium'
): GeneratedDeck {
  const archetypes: DeckArchetype[] = ['aggro', 'control', 'midrange', 'combo', 'ramp', 'prison', 'tempo', 'tokens', 'aristocrats', 'stompy'];
  const archetype = archetypes[Math.floor(Math.random() * archetypes.length)];

  return generateOpponentDeck({ format, archetype, colorIdentity: colors, difficulty });
}

/**
 * Get all available archetypes
 */
export function getAvailableArchetypes(): DeckArchetype[] {
  return Object.keys(ARCHETYPE_CONFIGS) as DeckArchetype[];
}

/**
 * Get all available themes for an archetype
 */
export function getAvailableThemes(archetype: DeckArchetype): StrategicTheme[] {
  return ARCHETYPE_CONFIGS[archetype]?.themes || [];
}

/**
 * Get archetype configuration
 */
export function getArchetypeConfig(archetype: DeckArchetype): ArchetypeConfig | undefined {
  return ARCHETYPE_CONFIGS[archetype];
}

/**
 * Get difficulty configuration
 */
export function getDifficultyConfig(difficulty: DifficultyLevel): DifficultyConfig {
  return DIFFICULTY_CONFIGS[difficulty];
}

/**
 * Validate deck archetype
 */
export function isValidArchetype(archetype: string): archetype is DeckArchetype {
  return getAvailableArchetypes().includes(archetype as DeckArchetype);
}

/**
 * Validate deck theme
 */
export function isValidTheme(theme: string): theme is StrategicTheme {
  return Object.keys(THEME_MODIFIERS).includes(theme);
}

/**
 * Validate difficulty level
 */
export function isValidDifficulty(difficulty: string): difficulty is DifficultyLevel {
  return ['easy', 'medium', 'hard', 'expert'].includes(difficulty);
}

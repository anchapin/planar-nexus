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

import { formatRules, Format } from "./game-rules";
import type { MinimalCard } from "./card-database";

// Re-export Format type for test imports
export type { Format };

// Difficulty levels that map to deck quality
export type DifficultyLevel = "easy" | "medium" | "hard" | "expert";

// Expanded deck archetype definitions
export type DeckArchetype =
  | "aggro"
  | "control"
  | "midrange"
  | "combo"
  | "ramp"
  | "prison"
  | "tempo"
  | "tokens"
  | "aristocrats"
  | "stompy";

// Strategic themes within archetypes
export type StrategicTheme =
  | "burn" // Direct damage focus
  | "weiss" // White weenies
  | "fairies" // Blue/white flying
  | "zombies" // Black graveyard synergy
  | "dragons" // Big flying threats
  | "tokens" // Token generation
  | "mill" // Decking opponent
  | "lifegain" // Life gain synergies
  | "artifacts" // Artifact focus
  | "enchantments" // Enchantment focus
  | "counters" // Counterspell-heavy
  | "reanimator" // Graveyard recursion
  | "elves" // Elf tribal
  | "goblins" // Goblin tribal
  | "control" // Traditional control
  | "midrange" // Value-based midrange
  | "storm" // Storm combo
  | "scapeshift" // Land-based combo
  | "trample" // Trample threats
  | "haste" // Haste creatures
  | "flash" // Flash creatures
  | "aristocrats" // Sacrifice synergies
  | "tempo" // Disruptive control
  | "toolbox" // Silver bullet creatures
  | "toolbox"; // Silver bullet creatures;

/**
 * Archetypes a detected opponent deck may fall under (issue #1229). Wider than
 * the generator's own {@link DeckArchetype} because the detector also surfaces
 * "tribal" and "toolbox" archetypes; the hate-package table below has an entry
 * for each of these seven and is keyed off them.
 */
export type CounterTargetArchetype =
  | "combo"
  | "aggro"
  | "control"
  | "midrange"
  | "tribal"
  | "toolbox"
  | "aristocrats";

export interface OpponentDeckGenerationInput {
  format: Format;
  archetype?: DeckArchetype;
  theme?: StrategicTheme;
  colorIdentity?: string[];
  difficulty?: DifficultyLevel;
  /**
   * Detected archetype of the human player (issue #1229). When supplied, the
   * generator injects a hate package targeting that archetype — e.g. cage
   * effects + Rule-of-Law hate for combo, lifegain + sweepers for aggro.
   *
   * Without a value the generator's maindeck output is unchanged from the
   * pre-#1229 implementation: no counter-picks are added and the random
   * selection sequence is identical (the new branch is skipped entirely).
   *
   * Typically produced by `archetype-detector.detectArchetype()` and plumbed
   * through the game-setup path.
   */
  targetArchetype?: CounterTargetArchetype;
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
  /**
   * Sideboard for best-of-3 (sideboard) play. Issue #995: the AI opponent now
   * generates a legal sideboard alongside its maindeck for any format whose
   * construction rules enable one (`formatRules[format].usesSideboard`). Empty
   * (or `undefined`) for Commander and other non-sideboard formats.
   */
  sideboard?: Array<{ name: string; quantity: number }>;
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
  W_one_drops: [
    "Soul Warden",
    "Champion of the Parish",
    "Isamaru, Hound of Konda",
    "Mother of Runes",
    "Thalia, Guardian of Thraben",
    "Kytheon, Hero of Akros",
    "Student of Warfare",
    "Steppe Lynx",
    "Usher of the Fallen",
  ],
  W_two_drops: [
    "Knight of the White Orchid",
    "Thalia's Lieutenant",
    "Selfless Spirit",
    "Mentor of the Meek",
    "Leonin Arbiter",
    "Wall of Omens",
    "Kytheon's Tactics",
    "Dauntless Bodyguard",
    "Gideon's Lawkeeper",
  ],
  W_three_drops: [
    "Adanto Vanguard",
    "Benevolent Bodyguard",
    "Leonin Relic-Warder",
    "Mirran Crusader",
    "Knight of the Holy Nimbus",
    "Sun Titan",
    "Eldrazi Displacer",
    "Restoration Angel",
    "Flickerwisp",
  ],
  W_four_drops: [
    "Hero of Bladehold",
    "Brave the Elements",
    "Auriok Champion",
    "Spectral Procession",
    "Cloudgoat Ranger",
    "Herald of War",
  ],
  W_removal: [
    "Path to Exile",
    "Swords to Plowshares",
    "Justice Strike",
    "Divine Offering",
    "Declaration in Stone",
    "Oblivion Ring",
    "Banishing Light",
    "Anguished Unmaking",
  ],
  W_utility: [
    "Mana Tithe",
    "Apostle's Blessing",
    "Safety // Grief",
    "Selfless Spirit",
    "Emeria Angel",
    "Honor of the Pure",
    "Intangible Virtue",
    "Anafenza, Kin-Tree Spirit",
  ],
  W_lifegain: [
    "Soul Warden",
    "Soul's Attendant",
    "Auriok Champion",
    "Crested Sunmare",
    "Sphinx's Revelation",
    "Revitalize",
    "Healing Salve",
    "Rest for the Weary",
  ],

  // === BLUE CARDS ===
  U_one_drops: [
    "Delver of Secrets",
    "Cursecatcher",
    "Phantasmal Image",
    "Thassa's Oracle",
    "Llanowar Elves",
    "Elvish Mystic",
    "Birds of Paradise",
    "Noble Hierarch",
  ],
  U_two_drops: [
    "Snapcaster Mage",
    "Thing in the Ice",
    "Glen Elendra Archmage",
    "Vendilion Clique",
    "Spellstutter Sprite",
    "Mystic Remora",
    "Dark Confidant",
    "Grim Lavamancer",
    "Sakura-Tribe Elder",
  ],
  U_three_drops: [
    "Archmage Emeritus",
    "Jace, Vryn's Prodigy",
    "Teferi, Time Raveler",
    "Mystic Confluence",
    "Narset, Parter of Veils",
    "Mulldrifter",
  ],
  U_four_drops: [
    "Cryptic Command",
    "Tezzeret the Seeker",
    "Jace Beleren",
    "Aetherling",
    "Vendilion Clique",
    "Batterskull",
  ],
  U_counter: [
    "Counterspell",
    "Negate",
    "Dispel",
    "Neutralize",
    "Syncopate",
    "Mana Leak",
    "Spell Pierce",
    "Force of Will",
    "Daze",
    "Arcane Denial",
  ],
  U_draw: [
    "Brainstorm",
    "Ponder",
    "Preordain",
    "Chart a Course",
    "Ancestral Recall",
    "Cantrip",
    "Fact or Fiction",
    "Jace's Ingenuity",
    "Opportunity",
  ],
  U_tempo: [
    "Vapor Snag",
    "Unsummon",
    "Bounce",
    "Remand",
    "Cryptic Command",
    "Mystic Confluence",
    "Venser, Shaper Savant",
    "Peregrine Drake",
  ],

  // === BLACK CARDS ===
  B_one_drops: [
    "Grave Crawler",
    "Bloodsoaked Champion",
    "Vampire Lacerator",
    "Goblin Guide",
    "Goblin Welder",
    "Bloodthrone Vampire",
  ],
  B_two_drops: [
    "Nezumi Prowler",
    "Gifted // Willied",
    "Phyrexian Rager",
    "Pack Rat",
    "Thoughtseize",
    "Inquisition of Kozilek",
    "Duress",
    "Despise",
  ],
  B_three_drops: [
    "Phyrexian Arena",
    "Grim Haruspex",
    "Liliana of the Veil",
    "Deathrite Shaman",
    "Geralf's Messenger",
    "Mesmeric Fiend",
  ],
  B_four_drops: [
    "Sheoldred, Whispering One",
    "Grave Titan",
    "Phyrexian Obliterator",
    "Massacre Wurm",
    "Gary",
    "Huntmaster of the Fells",
  ],
  B_kill: [
    "Innocent Blood",
    "Go for the Throat",
    "Victim // Night",
    "Dead // Gone",
    "Doom Blade",
    "Murder",
    "Hero's Downfall",
    "Ultimate Price",
    "Terminate",
    "Abrupt Decay",
    "Maelstrom Pulse",
    "Dismember",
    "Tragic Slip",
  ],
  B_reanimate: [
    "Entomb",
    "Unburial Rites",
    "Dread Return",
    "Animate Dead",
    "Reanimate",
    "Exhume",
    "Necromancy",
    "Dance of the Dead",
  ],
  B_discard: [
    "Thoughtseize",
    "Inquisition of Kozilek",
    "Duress",
    "Despise",
    "Thought Scour",
    "Mind Rot",
    "Hymn to Tourach",
    "Mind Burst",
  ],
  B_zombies: [
    "Grave Crawler",
    "Geralf's Messenger",
    "Shepherd of Rot",
    "Rotlung Reanimator",
    "Carrion Feeder",
    "Undead Warchief",
    "Lord of the Undead",
    "Zombie Master",
    "Cemetery Reaper",
  ],

  // === RED CARDS ===
  R_one_drops: [
    "Goblin Guide",
    "Monastery Swiftspear",
    "Goblin Bushwhacker",
    "Ragavan, Nimble Pilferer",
    "Dragon Fodder",
    "Krenko's Buzzbrew",
  ],
  R_two_drops: [
    "Eidolon of the Great Revel",
    "Goblin Piledriver",
    "Goblin Matron",
    "Young Pyromancer",
    "Mogg War Marshal",
    "Feldon's Cane",
  ],
  R_three_drops: [
    "Hazoret the Fervent",
    "Blood Moon",
    "Kiki-Jiki, Mirror Breaker",
    "Molten Rain",
    "Stormbreath Dragon",
    "Glorybringer",
  ],
  R_four_drops: [
    "Chandra, Torch of Defiance",
    "Krenko, Mob Boss",
    "Pia and Kiran Nalaar",
    "Hazardous Conditions",
    "Siege-Gang Commander",
    "Hellrider",
  ],
  R_burn: [
    "Lightning Bolt",
    "Lightning Strike",
    "Burst Lightning",
    "Searing Blaze",
    "Chain Lightning",
    "Lava Spike",
    "Skullcrack",
    "Boros Charm",
    "Fireblast",
    "Flame Slash",
    "Searing Blood",
    "Vexing Devil",
  ],
  R_utility: [
    "Fire // Ice",
    "Collision // Colossus",
    "Faithless Looting",
    "Wheel of Fortune",
    "Chaos Warp",
    "Chandra's Pyrohelix",
    "Pyrokinesis",
    "Price of Progress",
  ],
  R_goblins: [
    "Goblin Guide",
    "Goblin Piledriver",
    "Goblin Matron",
    "Goblin Warchief",
    "Krenko, Mob Boss",
    "Siege-Gang Commander",
    "Goblin Chieftain",
    "Mogg Fanatic",
  ],

  // === GREEN CARDS ===
  G_one_drops: [
    "Llanowar Elves",
    "Elvish Mystic",
    "Fyndhorn Elves",
    "Heritage Druid",
    "Arbor Elf",
    "Birds of Paradise",
    "Noble Hierarch",
    "Deathrite Shaman",
  ],
  G_two_drops: [
    "Sakura-Tribe Elder",
    "Wall of Roots",
    "Eternal Witness",
    "Courser of Kruphix",
    "Scavenging Ooze",
    "Questing Beast",
    "Strangleroot Geist",
    "Kitchen Finks",
  ],
  G_three_drops: [
    "Knight of the Reliquary",
    "Eternal Witness",
    "Voice of Resurgence",
    "Fierce Empath",
    "Courser of Kruphix",
    "Thrun, the Last Troll",
  ],
  G_four_drops: [
    "Craterhoof Behemoth",
    "Worldspine Wurm",
    "Terastodon",
    "Avenger of Zendikar",
    "Primal Command",
    "Polukranos, Unchained",
    "Thragtusk",
  ],
  G_ramp: [
    "Rampant Growth",
    "Farseek",
    "Nature's Lore",
    "Cultivate",
    "Kodama's Reach",
    "Sol Ring",
    "Birds of Paradise",
    "Noble Hierarch",
    "Deathrite Shaman",
  ],
  G_big: [
    "Craterhoof Behemoth",
    "Worldspine Wurm",
    "Terastodon",
    "Avenger of Zendikar",
    "Primal Command",
    "Polukranos, Unchained",
    "Thragtusk",
    "Vorinclex, Voice of Hunger",
  ],
  G_elves: [
    "Llanowar Elves",
    "Elvish Mystic",
    "Fyndhorn Elves",
    "Heritage Druid",
    "Arbor Elf",
    "Elvish Archdruid",
    "Ezuri, Renegade Leader",
    "Elvish Champion",
    "Imperious Perfect",
    "Timberwatch Elf",
    "Jagged-Scar Archers",
  ],
  G_trample: [
    "Questing Beast",
    "Thrun, the Last Troll",
    "Polukranos, Unchained",
    "Vorinclex, Voice of Hunger",
    "Craterhoof Behemoth",
    "Worldspine Wurm",
  ],

  // === COLORLESS CARDS ===
  colorless_rocks: [
    "Sol Ring",
    "Arcane Signet",
    "Darksteel Ingot",
    "Thought Vessel",
    "Everflowing Chalice",
    "Worn Powerstone",
    "Thran Dynamo",
    "Gilded Lotus",
    "Mind Stone",
    "Fellwar Stone",
  ],
  colorless_utility: [
    "Swiftfoot Boots",
    "Lightning Greaves",
    "Sensei's Divining Top",
    "Scroll Rack",
    "Batterskull",
    "Wurmcoil Engine",
    "Basalt Monolith",
    "Crypt",
    "Mana Vault",
  ],
  colorless_equipment: [
    "Sword of Fire and Ice",
    "Sword of Light and Shadow",
    "Sword of Feast and Famine",
    "Umezawa's Jitte",
    "Bonesplitter",
    "Skullclamp",
    "Cranial Plating",
    "Runechanter's Pike",
  ],

  // === LANDS ===
  lands_dual: [
    "Evolving Wilds",
    "Terramorphic Expanse",
    "Exotic Orchard",
    "City of Brass",
    "Mana Confluence",
    "Command Tower",
    "Reflecting Pool",
    "Gemstone Mine",
    "Shockland",
    "Checkland",
    "Battleland",
    "Fetchland",
  ],
  lands_basic: ["Plains", "Island", "Swamp", "Mountain", "Forest"],
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
    preferredColors: ["R", "W", "B"],
    creatureCategories: [
      "W_one_drops",
      "R_one_drops",
      "B_one_drops",
      "W_two_drops",
      "R_two_drops",
      "R_three_drops",
    ],
    spellCategories: ["R_burn", "W_removal", "B_kill", "R_utility"],
    themes: ["burn", "weiss", "zombies", "haste", "goblins"],
    description:
      "Fast-paced deck that aims to win quickly through aggressive creatures and burn.",
    strategicApproach:
      "Deploy cheap, efficient threats early. Apply constant pressure with creatures and direct damage. Prioritize speed over card advantage. Mulligan aggressively for low-curve hands.",
  },
  control: {
    preferredColors: ["U", "B", "W"],
    creatureCategories: [
      "U_two_drops",
      "U_three_drops",
      "B_three_drops",
      "W_three_drops",
    ],
    spellCategories: [
      "U_counter",
      "U_draw",
      "B_kill",
      "W_removal",
      "B_discard",
      "U_tempo",
    ],
    themes: ["control", "counters", "mill", "reanimator"],
    description:
      "Defensive deck that controls the board and wins through card advantage.",
    strategicApproach:
      "Control the early game with removal and countermagic. Draw extra cards to find win conditions. Establish a dominant board state in the mid-to-late game. Prioritize card quality over quantity.",
  },
  midrange: {
    preferredColors: ["G", "B", "W", "R"],
    creatureCategories: [
      "G_two_drops",
      "G_three_drops",
      "B_two_drops",
      "B_three_drops",
      "W_two_drops",
      "W_three_drops",
    ],
    spellCategories: ["G_ramp", "B_kill", "W_removal", "R_burn", "U_draw"],
    themes: ["midrange", "aristocrats", "toolbox", "flash"],
    description:
      "Balanced deck with threats and answers for all stages of the game.",
    strategicApproach:
      "Play value creatures that provide multiple benefits. Use removal to disrupt opponent's threats while advancing your own board. Adapt strategy based on matchup and game state.",
  },
  combo: {
    preferredColors: ["U", "G", "B"],
    creatureCategories: [
      "U_one_drops",
      "U_two_drops",
      "G_one_drops",
      "G_two_drops",
      "B_two_drops",
    ],
    spellCategories: ["U_draw", "G_ramp", "B_reanimate", "U_counter", "G_big"],
    themes: ["storm", "reanimator", "scapeshift", "artifacts", "enchantments"],
    description:
      "Synergistic deck that combines cards for powerful interactions.",
    strategicApproach:
      "Search for combo pieces aggressively. Use card selection spells to find key cards. Protect combo with countermagic and removal. Execute win condition as soon as pieces are assembled.",
  },
  ramp: {
    preferredColors: ["G", "U", "R"],
    creatureCategories: [
      "G_one_drops",
      "G_two_drops",
      "U_two_drops",
      "G_three_drops",
    ],
    spellCategories: [
      "G_ramp",
      "G_big",
      "U_draw",
      "R_utility",
      "colorless_rocks",
    ],
    themes: ["dragons", "trample", "artifacts", "enchantments"],
    description:
      "Mana-focused deck that accelerates into powerful late-game threats.",
    strategicApproach:
      "Prioritize mana acceleration in the early turns. Protect your ramp spells until they resolve. Play powerful threats that dominate the game once you reach enough mana.",
  },
  prison: {
    preferredColors: ["W", "U", "R"],
    creatureCategories: [
      "W_two_drops",
      "W_three_drops",
      "U_two_drops",
      "R_three_drops",
    ],
    spellCategories: [
      "W_removal",
      "U_counter",
      "R_utility",
      "W_utility",
      "U_tempo",
    ],
    themes: ["control", "counters", "artifacts", "enchantments"],
    description:
      "Lockdown deck that restricts opponent's resources and options.",
    strategicApproach:
      "Deploy resource denial effects early. Counter key threats from the opponent. Establish a dominant board position while limiting opponent's options. Win through gradual advantage.",
  },
  tempo: {
    preferredColors: ["U", "R", "W"],
    creatureCategories: [
      "U_one_drops",
      "U_two_drops",
      "R_one_drops",
      "R_two_drops",
      "W_one_drops",
    ],
    spellCategories: [
      "U_tempo",
      "U_counter",
      "R_burn",
      "R_utility",
      "W_removal",
    ],
    themes: ["haste", "flash", "fairies", "tempo"],
    description:
      "Aggressive control deck that disrupts opponents while applying pressure.",
    strategicApproach:
      "Apply early pressure while disrupting opponent's plays. Use bounce spells to clear blockers. Countermagic protects your threats and disrupts opponent's key spells. Win through efficient damage and tempo advantage.",
  },
  tokens: {
    preferredColors: ["W", "G", "B"],
    creatureCategories: [
      "W_one_drops",
      "W_two_drops",
      "G_two_drops",
      "B_two_drops",
      "G_three_drops",
    ],
    spellCategories: [
      "W_utility",
      "G_big",
      "W_removal",
      "B_kill",
      "W_lifegain",
    ],
    themes: ["tokens", "aristocrats", "lifegain", "elves"],
    description: "Deck focused on generating and utilizing token creatures.",
    strategicApproach:
      "Generate tokens early and often. Use token-specific synergies to maximize their value. Populate the board rapidly and overwhelm with token swarm. Use removal to clear blockers for token attacks.",
  },
  aristocrats: {
    preferredColors: ["B", "W", "R"],
    creatureCategories: [
      "B_one_drops",
      "B_two_drops",
      "W_one_drops",
      "W_two_drops",
      "R_one_drops",
    ],
    spellCategories: [
      "B_kill",
      "W_removal",
      "R_utility",
      "B_reanimate",
      "W_lifegain",
    ],
    themes: ["aristocrats", "zombies", "lifegain", "tokens"],
    description: "Synergy deck that sacrifices creatures for value.",
    strategicApproach:
      "Sacrifice creatures to generate advantage and drain opponents. Use recursive threats to maintain board presence. Drain opponent's life through sacrifice effects. Win through cumulative damage and life gain.",
  },
  stompy: {
    preferredColors: ["G", "R", "U"],
    creatureCategories: [
      "G_one_drops",
      "G_two_drops",
      "R_one_drops",
      "R_two_drops",
      "U_one_drops",
    ],
    spellCategories: ["G_ramp", "R_burn", "G_trample", "U_counter", "G_big"],
    themes: ["trample", "haste", "dragons", "artifacts"],
    description: "Aggressive deck with powerful, efficient creatures.",
    strategicApproach:
      "Play big threats quickly and attack aggressively. Use pump spells and removal to clear blockers. Prioritize creature quality over card advantage. Win through overwhelming board presence and damage.",
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
    additionalCreatures: [
      "Goblin Guide",
      "Monastery Swiftspear",
      "Vexing Devil",
    ],
    additionalSpells: [
      "Lightning Bolt",
      "Lava Spike",
      "Skullcrack",
      "Boros Charm",
      "Fireblast",
    ],
    keyCards: ["Lightning Bolt", "Goblin Guide"],
  },
  weiss: {
    additionalCreatures: [
      "Soul Warden",
      "Champion of the Parish",
      "Thalia, Guardian of Thraben",
    ],
    additionalSpells: [
      "Honor of the Pure",
      "Brave the Elements",
      "Path to Exile",
    ],
    keyCards: ["Honor of the Pure", "Thalia, Guardian of Thraben"],
  },
  fairies: {
    additionalCreatures: [
      "Spellstutter Sprite",
      "Vendilion Clique",
      "Mistbind Clique",
    ],
    additionalSpells: ["Bitterblossom", "Cryptic Command", "Vapor Snag"],
    keyCards: ["Bitterblossom", "Spellstutter Sprite"],
  },
  zombies: {
    additionalCreatures: [
      "Grave Crawler",
      "Geralf's Messenger",
      "Shepherd of Rot",
    ],
    additionalSpells: ["Diregraf Ghoul", "Gravecrawler", "Dead // Gone"],
    keyCards: ["Grave Crawler", "Geralf's Messenger"],
  },
  dragons: {
    additionalCreatures: [
      "Stormbreath Dragon",
      "Glorybringer",
      "Thundermaw Hellkite",
    ],
    additionalSpells: [
      "Crucible of the Spirit Dragon",
      "Dragon's Hoard",
      "Sarkhan, Fireblood",
    ],
    keyCards: ["Stormbreath Dragon", "Glorybringer"],
  },
  tokens: {
    additionalCreatures: [
      "Young Pyromancer",
      "Monastery Mentor",
      "Secure the Wastes",
    ],
    additionalSpells: [
      "Raise the Alarm",
      "Spectral Procession",
      "Secure the Wastes",
    ],
    keyCards: ["Secure the Wastes", "Spectral Procession"],
  },
  mill: {
    additionalCreatures: ["Jace's Phantasm", "Hedron Crab", "Manic Scribe"],
    additionalSpells: [
      "Mind Funeral",
      "Mesmeric Orb",
      "Archive Trap",
      "Glimpse the Unthinkable",
    ],
    keyCards: ["Mind Funeral", "Mesmeric Orb"],
  },
  lifegain: {
    additionalCreatures: [
      "Soul Warden",
      "Soul's Attendant",
      "Auriok Champion",
      "Crested Sunmare",
    ],
    additionalSpells: [
      "Sphinx's Revelation",
      "Revitalize",
      "Rest for the Weary",
      "Felidar Sovereign",
    ],
    keyCards: ["Crested Sunmare", "Felidar Sovereign"],
  },
  artifacts: {
    additionalCreatures: ["Karn, Silver Golem", "Arcbound Ravager", "Memnite"],
    additionalSpells: ["Mox Opal", "Chromatic Lantern", "Whir of Invention"],
    keyCards: ["Arcbound Ravager", "Mox Opal"],
  },
  enchantments: {
    additionalCreatures: [
      "Satyr Enchanter",
      "Eidolon of Blossoms",
      "Enchantress's Presence",
    ],
    additionalSpells: [
      "Omniscience",
      "Enchantress's Presence",
      "Sylvan Library",
    ],
    keyCards: ["Enchantress's Presence", "Sylvan Library"],
  },
  counters: {
    additionalCreatures: [
      "Snapcaster Mage",
      "Thing in the Ice",
      "Teferi, Time Raveler",
    ],
    additionalSpells: [
      "Counterspell",
      "Mana Leak",
      "Force of Will",
      "Cryptic Command",
    ],
    keyCards: ["Counterspell", "Cryptic Command"],
  },
  reanimator: {
    additionalCreatures: [
      "Gravecrawler",
      "Phyrexian Dreadnought",
      "Iona, Shield of Emeria",
    ],
    additionalSpells: ["Entomb", "Animate Dead", "Reanimate", "Exhume"],
    keyCards: ["Entomb", "Animate Dead"],
  },
  elves: {
    additionalCreatures: [
      "Llanowar Elves",
      "Elvish Archdruid",
      "Ezuri, Renegade Leader",
      "Heritage Druid",
    ],
    additionalSpells: [
      "Elvish Promenade",
      "Beastmaster Ascension",
      "Coat of Arms",
    ],
    keyCards: ["Elvish Archdruid", "Ezuri, Renegade Leader"],
  },
  goblins: {
    additionalCreatures: [
      "Goblin Guide",
      "Goblin Piledriver",
      "Goblin Matron",
      "Goblin Warchief",
    ],
    additionalSpells: [
      "Goblin Bushwhacker",
      "Goblin War Strike",
      "Empty the Warrens",
    ],
    keyCards: ["Goblin Guide", "Goblin Warchief"],
  },
  control: {
    additionalCreatures: [
      "Snapcaster Mage",
      "Vendilion Clique",
      "Teferi, Time Raveler",
    ],
    additionalSpells: [
      "Counterspell",
      "Thoughtseize",
      "Brainstorm",
      "Fact or Fiction",
    ],
    keyCards: ["Counterspell", "Thoughtseize"],
  },
  midrange: {
    additionalCreatures: ["Thrun, the Last Troll", "Siege Rhino", "Tarmogoyf"],
    additionalSpells: [
      "Abrupt Decay",
      "Maelstrom Pulse",
      "Thoughtseize",
      "Garruk, Primal Hunter",
    ],
    keyCards: ["Thrun, the Last Troll", "Abrupt Decay"],
  },
  storm: {
    additionalCreatures: ["Baral, Chief of Compliance", "Goblin Electromancer"],
    additionalSpells: [
      "Mind's Desire",
      "Grapeshot",
      "Empty the Warrens",
      "Past in Flames",
    ],
    keyCards: ["Mind's Desire", "Grapeshot"],
  },
  scapeshift: {
    additionalCreatures: ["Sakura-Tribe Elder", "Knight of the Reliquary"],
    additionalSpells: [
      "Scapeshift",
      "Valakut, the Molten Pinnacle",
      "Primeval Titan",
    ],
    keyCards: ["Scapeshift", "Primeval Titan"],
  },
  trample: {
    additionalCreatures: [
      "Questing Beast",
      "Polukranos, Unchained",
      "Vorinclex, Voice of Hunger",
    ],
    additionalSpells: ["Rancor", "Giant Growth", "Aspect of Hydra"],
    keyCards: ["Questing Beast", "Polukranos, Unchained"],
  },
  haste: {
    additionalCreatures: ["Ball Lightning", "Spark Elemental", "Feldon's Cane"],
    additionalSpells: ["Fling", "Reckless Charge", "Bloodrush"],
    keyCards: ["Ball Lightning", "Feldon's Cane"],
  },
  flash: {
    additionalCreatures: ["Restoration Angel", "Flickerwisp", "Mystic Snake"],
    additionalSpells: [
      "Cryptic Command",
      "Venser, Shaper Savant",
      "Mystic Confluence",
    ],
    keyCards: ["Restoration Angel", "Cryptic Command"],
  },
  toolbox: {
    additionalCreatures: [
      " Eternal Witness",
      "Kor Spiritdancer",
      "Recruitment Officer",
    ],
    additionalSpells: ["Fabricate", "Birthing Pod", "Chord of Calling"],
    keyCards: ["Eternal Witness", "Chord of Calling"],
  },
  aristocrats: {
    additionalCreatures: [
      "Blood Artist",
      "Zulaport Cutthroat",
      "Carrion Feeder",
    ],
    additionalSpells: ["Viscera Seer", "Altar's Reap", "Butcher Ghoul"],
    keyCards: ["Blood Artist", "Zulaport Cutthroat"],
  },
  tempo: {
    additionalCreatures: [
      "Delver of Secrets",
      "Spellstutter Sprite",
      "Noble Hierarch",
    ],
    additionalSpells: ["Daze", "Force of Will", "Cryptic Command"],
    keyCards: ["Delver of Secrets", "Force of Will"],
  },
};

// ---------------------------------------------------------------------------
// Issue #992: Difficulty-scaled deck POWER
//
// Previously `difficulty` was only a light nudge (a small selection multiplier),
// so an "easy" opponent fielded decks just as tuned as an "expert" one. The
// infrastructure below makes the deck's *power* scale monotonically with
// difficulty so the generated deck itself reflects the challenge:
//   - `cardStrength`           deterministic per-card quality score in [0,1]
//   - `DIFFICULTY_POWER_TIERS` per-difficulty selection bias / curve / mana / filler
//   - `evaluateDeckPower`      deterministic deck-quality metric (0-100) for tests
// Expert decks prefer the strongest cards, tighter curves, better mana and no
// filler; easy decks prefer weaker picks, clunkier curves, worse mana and noise.
// This composes with the sideboard work (#995) and the unified difficulty
// taxonomy / per-format config (#1064 / #1069): the same `DifficultyLevel` is
// used throughout, and the deck generator is only responsible for maindeck
// power — the sideboard keeps its own (already difficulty-aware) logic.
// ---------------------------------------------------------------------------

/** Deterministic hash of a string in [0,1) (FNV-1a). Stable across runs. */
function hashName(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Base strength tier keyed by CARD_POOL category *suffix* (e.g. "W_removal" ->
 * "removal"). Higher = objectively more impactful / efficient card type. Used
 * when the selecting category is known so the bias has precise signal.
 */
const CATEGORY_STRENGTH_TIER: Record<string, number> = {
  // premium interaction & card advantage
  removal: 0.9,
  kill: 0.9,
  counter: 0.85,
  draw: 0.85,
  burn: 0.72,
  ramp: 0.8,
  rocks: 0.78,
  // efficient threats (lower CMC = tighter, stronger curve)
  one_drops: 0.72,
  two_drops: 0.7,
  three_drops: 0.66,
  four_drops: 0.58,
  big: 0.55,
  trample: 0.6,
  equipment: 0.5,
  reanimate: 0.62,
  tempo: 0.6,
  discard: 0.6,
  // tribal / situational
  zombies: 0.45,
  goblins: 0.45,
  elves: 0.5,
  utility: 0.6,
  // weak / narrow
  lifegain: 0.3,
};

/**
 * Name-only strength fallback (used by {@link evaluateDeckPower} where the
 * selecting category is unknown). Kept self-contained so the power-scaling
 * block has no forward dependencies. Mirrors the role heuristics elsewhere.
 */
const NAME_TIER_FALLBACK: Array<{ re: RegExp; tier: number }> = [
  {
    re: /\b(destroy|exile|remove|kill|burn|bolt|path|swords|doom|murder|decay|pulse|terminate|blast|strike|cut|downfall|push|verdict|wrath|damnation|annihilate)\b/i,
    tier: 0.88,
  },
  {
    re: /\b(counter|negate|cancel|deny|dismiss|remand|interrupt|essence scatter|mana leak)\b/i,
    tier: 0.82,
  },
  {
    re: /\b(draw|divination|ponder|preordain|brainstorm|inspiration|opportunity|fact or fiction|sign in blood|read the bones|catalog|foresight)\b/i,
    tier: 0.82,
  },
  {
    re: /\b(ramp|growth|cultivate|kodama|signet|talisman|sol ring|mana vault|crypt|fellwar|mind stone|arcane signet)\b/i,
    tier: 0.78,
  },
  {
    re: /\b(lifegain|healing|rest for the weary|revitalize|soul warden|soul's attendant|healing salve)\b/i,
    tier: 0.3,
  },
  {
    re: /\b(land|forest|island|mountain|plains|swamp|tower|wastes)\b/i,
    tier: 0.12,
  },
];

function resolveStrengthTier(name: string, category?: string): number {
  if (category) {
    for (const suffix of Object.keys(CATEGORY_STRENGTH_TIER)) {
      if (category.endsWith(suffix)) return CATEGORY_STRENGTH_TIER[suffix];
    }
  }
  for (const { re, tier } of NAME_TIER_FALLBACK) {
    if (re.test(name)) return tier;
  }
  return 0.6; // generic threat
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Deterministic card-quality score in [0,1]. When `category` is supplied (a
 * CARD_POOL key such as "W_removal") the precise category tier is used;
 * otherwise the tier is inferred from the card name. A stable per-name hash
 * adds reproducible intra-tier ordering, so difficulty-scaled selection has a
 * deterministic signal to bias on and tests are fully reproducible.
 */
export function cardStrength(name: string, category?: string): number {
  const tier = resolveStrengthTier(name, category);
  const jitter = (hashName(name) - 0.5) * 2 * 0.08; // [-0.08, +0.08]
  return clamp01(tier + jitter);
}

/**
 * Per-difficulty deck-power tuning (issue #992). Every field is monotonic in
 * skill so that, as difficulty rises, the generator biases toward stronger
 * cards, tighter mana curves, better mana fixing and less filler. Consumed by
 * the card-selection, curve and land helpers.
 */
export interface DifficultyPowerTier {
  /** Exponent on the strength weight. Higher = more ruthless preference. */
  strengthBias: number;
  /** true => favour HIGH-strength cards (expert); false => favour LOW (easy). */
  preferStrong: boolean;
  /** Fraction of non-land slots that may be filled with suboptimal "noise". */
  fillerFraction: number;
  /** Mana-curve slack: <1 tightens (leaner, lower CMC); >1 loosens (clunkier). */
  curveTightness: number;
  /** Dual-land share of the mana base scaling factor (0 = all basics, 1 = full). */
  landQuality: number;
  /** Commander land-count delta vs the 38% baseline (negative = fewer lands). */
  commanderLandDelta: number;
}

export const DIFFICULTY_POWER_TIERS: Record<
  DifficultyLevel,
  DifficultyPowerTier
> = {
  easy: {
    strengthBias: 1.3,
    preferStrong: false, // deliberately pick the weaker cards in each slot
    fillerFraction: 0.18,
    curveTightness: 1.3, // clunky, top-heavy curve
    landQuality: 0.3,
    commanderLandDelta: -3, // ~35 lands, shaky mana
  },
  medium: {
    strengthBias: 0.6,
    preferStrong: true,
    fillerFraction: 0.1,
    curveTightness: 1.1,
    landQuality: 0.6,
    commanderLandDelta: -1,
  },
  hard: {
    strengthBias: 1.3,
    preferStrong: true,
    fillerFraction: 0.04,
    curveTightness: 0.92,
    landQuality: 0.85,
    commanderLandDelta: 1,
  },
  expert: {
    strengthBias: 2.2,
    preferStrong: true, // ruthlessly prefer the strongest available picks
    fillerFraction: 0.0,
    curveTightness: 0.82, // tight, low-curve
    landQuality: 1.0,
    commanderLandDelta: 2, // ~40 lands, smooth mana
  },
};

/**
 * Selection-weight contribution from a card's strength for a given difficulty.
 * Expert strongly up-weights strong cards; easy up-weights WEAK cards (so its
 * decks are measurably less powerful). Always returns a positive multiplier so
 * every card stays selectable and deck legality/counts are preserved.
 */
function strengthWeight(
  name: string,
  category: string,
  difficulty: DifficultyLevel,
): number {
  const tier = DIFFICULTY_POWER_TIERS[difficulty];
  const s = cardStrength(name, category); // [0,1]
  const biased = tier.preferStrong ? s : 1 - s; // [0,1]
  return Math.max(0.05, Math.pow(biased, tier.strengthBias));
}

/** Land-name check for the power metric (self-contained; excludes mana from power). */
function isLandCardName(name: string): boolean {
  return /\b(land|forest|island|mountain|plains|swamp|tower|wastes|fetch|shock)\b/i.test(
    name,
  );
}

/**
 * Deterministic deck-power metric in [0,100]: the quantity-weighted average of
 * {@link cardStrength} over the NON-land cards (lands represent mana, not
 * power, and their count varies by difficulty which would otherwise confound
 * the score). Stable for a given card list, so tests can assert that
 * expert-generated decks score strictly higher than easy-generated decks.
 */
export function evaluateDeckPower(
  cards: Array<{ name: string; quantity: number }>,
): number {
  let weighted = 0;
  let qty = 0;
  for (const c of cards) {
    if (isLandCardName(c.name)) continue;
    weighted += cardStrength(c.name) * c.quantity;
    qty += c.quantity;
  }
  if (qty === 0) return 0;
  return Math.round(((weighted / qty) * 1000) / 10); // 0-100, one decimal
}

// Helper to get random items from array with weighting
function getRandomItems<T>(arr: T[], count: number, weights?: number[]): T[] {
  if (count <= 0) return [];
  if (arr.length === 0) return [];

  // If weights provided, use weighted random selection
  if (weights && weights.length === arr.length) {
    const selected: T[] = [];
    const available = arr.map((item, index) => ({
      item,
      weight: weights[index],
    }));

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

// Weighted random selection based on card quality/importance.
//
// Issue #992: the weight is now driven by the per-card `strengthWeight` so that
// expert decks preferentially select the strongest cards in each category while
// easy decks preferentially select the weakest (within-category ordering is
// deterministic via the card-strength hash, so the effect is measurable and the
// deck power scales monotonically with difficulty).
function getWeightedCards(
  categories: string[],
  count: number,
  difficulty: DifficultyLevel,
): string[] {
  const allCards: string[] = [];
  const weights: number[] = [];

  for (const category of categories) {
    const cards = CARD_POOL[category];
    if (!cards) continue;

    for (const card of cards) {
      allCards.push(card);
      weights.push(strengthWeight(card, category, difficulty));
    }
  }

  return getRandomItems(allCards, Math.min(count, allCards.length), weights);
}

// Get cards for given color identity and categories
function getCardsForColors(
  colorIdentity: string[],
  categories: string[],
  count: number,
  difficulty: DifficultyLevel,
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
            // Color-aligned cards get a bonus, multiplied by the difficulty
            // strength bias (issue #992) so expert still prefers the strongest
            // color-aligned cards and easy the weakest.
            weights.push(1.5 * strengthWeight(card, category, difficulty));
          }
        }
      }
    }
  }

  return getRandomItems(allCards, Math.min(count, allCards.length), weights);
}

// Calculate mana curve based on archetype and difficulty.
//
// Issue #992: applies the per-difficulty `curveTightness` slack so expert decks
// get a leaner, lower-curve distribution while easy decks get a clunkier,
// top-heavy one (their average mana value drifts upward). The slack factor is
// `tightness^(cmc/3 - 1)`: for tightness<1 low CMCs are boosted and high CMCs
// trimmed; for tightness>1 the reverse.
function calculateManaCurve(
  archetype: DeckArchetype,
  difficulty: DifficultyLevel,
): number[] {
  const baseCurve = DIFFICULTY_CONFIGS[difficulty].curve;
  const tightness = DIFFICULTY_POWER_TIERS[difficulty].curveTightness;
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
    const base = baseCurve[cmc] || 0;
    const slack = Math.pow(tightness, cmc / 3 - 1);
    adjustedCurve[cmc] = Math.max(0, Math.round(base * multiplier * slack));
  }

  return adjustedCurve;
}

// Generate lands based on color identity and format
function generateLands(
  colorIdentity: string[],
  format: Format,
  difficulty: DifficultyLevel,
  landCount: number,
): Array<{ name: string; quantity: number }> {
  const lands: Array<{ name: string; quantity: number }> = [];

  if (format === "legendary-commander") {
    // Commander decks get more lands and dual lands. Issue #992: the dual-land
    // share scales with difficulty `landQuality` so expert has smooth mana
    // (more duals) and easy has clunky mana (mostly basics).
    const dualFraction = Math.min(
      0.6,
      DIFFICULTY_POWER_TIERS[difficulty].landQuality * 0.5,
    );
    const basicLandCount = Math.floor(landCount * (1 - dualFraction));
    const dualLandCount = Math.floor(landCount * dualFraction);

    // Add basic lands
    if (colorIdentity.length > 0) {
      const basicLandsPerColor = Math.floor(
        basicLandCount / colorIdentity.length,
      );
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
    const selectedDuals = getRandomItems(
      dualLands,
      Math.ceil(dualLandCountActual / 2),
    );

    for (const dualLand of selectedDuals) {
      lands.push({ name: dualLand, quantity: 2 });
    }
  } else {
    // 60-card formats. Issue #992: dual-land share scales with difficulty.
    const dualFraction = Math.min(
      0.45,
      DIFFICULTY_POWER_TIERS[difficulty].landQuality * 0.4,
    );
    const basicLandCount = Math.floor(landCount * (1 - dualFraction));
    const dualLandCount = Math.floor(landCount * dualFraction);

    // Add basic lands
    if (colorIdentity.length > 0) {
      const basicLandsPerColor = Math.floor(
        basicLandCount / colorIdentity.length,
      );
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
  difficulty: DifficultyLevel,
): string {
  const archetypeConfig = ARCHETYPE_CONFIGS[archetype];
  const themeModifier = THEME_MODIFIERS[theme];

  let approach = archetypeConfig.strategicApproach;

  // Add theme-specific guidance
  if (themeModifier.keyCards.length > 0) {
    approach += ` Key cards include ${themeModifier.keyCards.slice(0, 3).join(", ")}.`;
  }

  // Add difficulty-specific guidance
  const difficultyGuidance: Record<DifficultyLevel, string> = {
    easy: " This opponent makes suboptimal decisions and may miss synergies.",
    medium:
      " This opponent plays reasonably well but may make occasional mistakes.",
    hard: " This opponent plays consistently well and capitalizes on synergies.",
    expert:
      " This opponent makes optimal plays with deep strategic understanding.",
  };

  approach += difficultyGuidance[difficulty];

  return approach;
}

/**
 * Generate an opponent deck based on archetype, theme, and difficulty
 */
export function generateOpponentDeck(
  input: OpponentDeckGenerationInput,
): GeneratedDeck {
  const {
    format,
    archetype = "midrange",
    theme,
    colorIdentity,
    difficulty = "medium",
    targetArchetype,
  } = input;

  const archetypeConfig = ARCHETYPE_CONFIGS[archetype];
  const difficultyConfig = DIFFICULTY_CONFIGS[difficulty];
  const powerTier = DIFFICULTY_POWER_TIERS[difficulty];

  // Issue #992: difficulty-scaled filler pools. Easy decks inject weak "noise";
  // expert decks fill with strong generic interaction only.
  const weakFiller = [
    "Healing Salve",
    "Rest for the Weary",
    "One with Nothing",
    "Storm Crow",
    "Fugitive Wizard",
    "Goblin Piker",
    "Wood Elemental",
    "Oxidda Scrapmelter",
  ];
  const strongFiller = [
    "Brainstorm",
    "Ponder",
    "Counterspell",
    "Lightning Bolt",
    "Swords to Plowshares",
  ];

  // Determine colors if not specified
  let finalColorIdentity = colorIdentity;
  if (!finalColorIdentity || finalColorIdentity.length === 0) {
    const colorCount = Math.floor(Math.random() * 3) + 1; // 1-3 colors
    finalColorIdentity = getRandomItems(
      archetypeConfig.preferredColors,
      colorCount,
    );
  }

  // Determine theme if not specified
  const finalTheme = theme || getRandomItems(archetypeConfig.themes, 1)[0];

  const themeModifier = THEME_MODIFIERS[finalTheme];
  const cards: Array<{ name: string; quantity: number }> = [];

  // Get format-specific deck size
  const formatRulesConfig = formatRules[format];
  const totalCards = formatRulesConfig.minCards;
  const isCommander = format === "legendary-commander";

  // Calculate land count based on format and difficulty. Issue #992: commander
  // land count scales with difficulty (expert ~40 smooth lands, easy ~35 shaky
  // lands); 60-card formats use the per-difficulty landCount from the config.
  const landCount = isCommander
    ? Math.floor(totalCards * 0.38) + powerTier.commanderLandDelta
    : difficultyConfig.landCount;

  // Generate lands
  const lands = generateLands(
    finalColorIdentity,
    format,
    difficulty,
    landCount,
  );
  cards.push(...lands);

  // Calculate remaining non-land slots
  const nonLandSlots = totalCards - landCount;

  // Get card counts based on difficulty
  const creatureSlots = Math.floor(
    nonLandSlots * (difficultyConfig.creatureCount / 100),
  );
  const spellSlots = Math.floor(
    nonLandSlots *
      ((100 -
        difficultyConfig.creatureCount -
        difficultyConfig.synergyWeight * 10) /
        100),
  );
  const synergySlots = nonLandSlots - creatureSlots - spellSlots;

  // Add theme-specific key cards
  const keyCardCount = Math.floor(synergySlots * 0.3);
  const keyCards = getRandomItems(
    themeModifier.keyCards,
    Math.min(keyCardCount, themeModifier.keyCards.length),
  );

  for (const keyCard of keyCards) {
    const quantity = isCommander ? 1 : Math.min(4, keyCardCount);
    if (!cards.find((c) => c.name === keyCard)) {
      cards.push({ name: keyCard, quantity });
    }
  }

  // Calculate mana curve based on archetype and difficulty. Issue #992: when the
  // difficulty reserves filler slots (easy/medium), scale the creature curve
  // down so that space is genuinely left for the weak-filler "noise" to land —
  // otherwise the creature/spell fill saturates the deck and filler (the main
  // power differentiator) is trimmed away by the final size pass.
  const manaCurve = calculateManaCurve(archetype, difficulty);
  if (powerTier.fillerFraction > 0) {
    const slotScale = 1 - powerTier.fillerFraction;
    for (let cmc = 0; cmc < manaCurve.length; cmc++) {
      manaCurve[cmc] = Math.floor(manaCurve[cmc] * slotScale);
    }
  }
  // Issue #992: reserve filler space so easy/medium decks genuinely contain
  // weak "noise" cards. The main build (creatures/spells) is capped at
  // `buildTarget`; the reserved slots are filled afterwards with difficulty-
  // appropriate filler. Without this the spell step saturates the deck and the
  // filler — the main power differentiator — is trimmed away.
  const fillerReserve =
    powerTier.fillerFraction > 0
      ? Math.min(
          Math.round(nonLandSlots * powerTier.fillerFraction),
          (isCommander ? 1 : 4) * weakFiller.length,
        )
      : 0;
  const buildTarget = Math.max(0, totalCards - fillerReserve);
  let totalAdded = cards.reduce((sum, card) => sum + card.quantity, 0);

  for (let cmc = 0; cmc <= 7; cmc++) {
    if (manaCurve[cmc] > 0) {
      const cmcCreatures = getCardsForColors(
        finalColorIdentity,
        archetypeConfig.creatureCategories,
        manaCurve[cmc],
        difficulty,
      );

      // Add theme-specific creatures
      const themeCreatures = getWeightedCards(
        themeModifier.additionalCreatures,
        Math.floor(manaCurve[cmc] * 0.3),
        difficulty,
      );

      const allCreatures = [...cmcCreatures, ...themeCreatures];
      const selectedCreatures = getRandomItems(allCreatures, manaCurve[cmc]);

      for (const creature of selectedCreatures) {
        const quantity = isCommander
          ? 1
          : Math.min(4, Math.floor(Math.random() * 3) + 1);
        if (
          !cards.find((c) => c.name === creature) &&
          totalAdded < buildTarget
        ) {
          const actualQuantity = Math.min(quantity, buildTarget - totalAdded);
          cards.push({ name: creature, quantity: actualQuantity });
          totalAdded += actualQuantity;
        }
      }
    }
  }

  // Add spells based on archetype
  const spellCategories = [...archetypeConfig.spellCategories];

  // Add theme-specific spells
  for (const themeSpell of themeModifier.additionalSpells) {
    if (totalAdded < buildTarget && !cards.find((c) => c.name === themeSpell)) {
      const quantity = isCommander
        ? 1
        : Math.min(4, Math.floor(Math.random() * 3) + 1);
      const actualQuantity = Math.min(quantity, buildTarget - totalAdded);
      cards.push({ name: themeSpell, quantity: actualQuantity });
      totalAdded += actualQuantity;
    }
  }

  // Add archetype spells
  const archetypeSpells = getCardsForColors(
    finalColorIdentity,
    spellCategories,
    Math.max(0, buildTarget - totalAdded),
    difficulty,
  );

  for (const spell of archetypeSpells) {
    if (totalAdded < buildTarget && !cards.find((c) => c.name === spell)) {
      const quantity = isCommander
        ? 1
        : Math.min(4, Math.floor(Math.random() * 3) + 1);
      const actualQuantity = Math.min(quantity, buildTarget - totalAdded);
      cards.push({ name: spell, quantity: actualQuantity });
      totalAdded += actualQuantity;
    }
  }

  // Add mana rocks for ramp decks or higher difficulty
  if (
    archetype === "ramp" ||
    difficulty === "hard" ||
    difficulty === "expert"
  ) {
    const rockCount = isCommander ? 8 : difficulty === "expert" ? 4 : 3;
    const rocks = getRandomItems(CARD_POOL.colorless_rocks, rockCount);

    for (const rock of rocks) {
      if (!cards.find((c) => c.name === rock)) {
        cards.push({ name: rock, quantity: 1 });
      }
    }
  }

  // Add utility artifacts for higher difficulty
  if (difficulty === "hard" || difficulty === "expert") {
    const utilityCount = isCommander ? 6 : 3;
    const utilities = getRandomItems(CARD_POOL.colorless_utility, utilityCount);

    for (const utility of utilities) {
      if (!cards.find((c) => c.name === utility)) {
        cards.push({ name: utility, quantity: isCommander ? 1 : 1 });
      }
    }
  }

  // Issue #992: difficulty-scaled filler. Easy decks deliberately include weak
  // "noise" cards (lowering their measurable power); expert decks fill only
  // with strong generic interaction. The weak-filler reserve (capped by the
  // pool's copy capacity) is injected first into the space reserved above.
  let currentTotal = cards.reduce((sum, card) => sum + card.quantity, 0);

  // Inject the difficulty-scaled weak-filler reserve (easy/medium only) into
  // the space reserved by `buildTarget` (already capped to the pool's capacity).
  if (fillerReserve > 0) {
    for (let i = 0; i < fillerReserve; i++) {
      if (currentTotal >= totalCards) break;
      const pick = weakFiller[i % weakFiller.length];
      const cap = isCommander ? 1 : 4;
      const already = cards.find((c) => c.name === pick);
      if (already) {
        if (already.quantity >= cap) continue;
        already.quantity += 1;
      } else {
        cards.push({ name: pick, quantity: 1 });
      }
      currentTotal += 1;
    }
  }

  // Fill remaining slots. Issue #992: easy decks fill with weak "noise" while
  // expert decks fill with strong generic interaction, so a lower-difficulty
  // deck's filler never accidentally outranks a higher-difficulty deck's filler
  // (which previously let loose easy construction pull in extra premium cards).
  const fillPool = powerTier.preferStrong ? strongFiller : weakFiller;
  if (currentTotal < totalCards) {
    for (const filler of fillPool) {
      if (currentTotal >= totalCards) break;
      if (!cards.find((c) => c.name === filler)) {
        const quantity = isCommander
          ? 1
          : Math.min(4, totalCards - currentTotal);
        cards.push({ name: filler, quantity });
        currentTotal += quantity;
      }
    }
  }

  // If still not enough, add basic lands as temporary filler to reach exact count
  if (currentTotal < totalCards) {
    const fillerLands = ["Wastes", "Reliquary Tower", "Command Tower"];
    for (const land of fillerLands) {
      if (currentTotal >= totalCards) break;
      if (!cards.find((c) => c.name === land)) {
        const quantity = isCommander
          ? 1
          : Math.min(4, totalCards - currentTotal);
        cards.push({ name: land, quantity });
        currentTotal += quantity;
      }
    }
  }

  // If STILL not enough (extremely rare), just add "Filler Card"
  if (currentTotal < totalCards) {
    cards.push({ name: "Unknown Spell", quantity: totalCards - currentTotal });
  }

  // Generate deck name
  const colorNames: Record<string, string> = {
    W: "White",
    U: "Blue",
    B: "Black",
    R: "Red",
    G: "Green",
  };
  const colors = finalColorIdentity.map((c) => colorNames[c]).join("/");
  const archetypeNames: Record<DeckArchetype, string> = {
    aggro: "Aggro",
    control: "Control",
    midrange: "Midrange",
    combo: "Combo",
    ramp: "Ramp",
    prison: "Prison",
    tempo: "Tempo",
    tokens: "Tokens",
    aristocrats: "Aristocrats",
    stompy: "Stompy",
  };
  const themeNames: Record<StrategicTheme, string> = {
    burn: "Burn",
    weiss: "White Weenie",
    fairies: "Fairies",
    zombies: "Zombies",
    dragons: "Dragons",
    tokens: "Tokens",
    mill: "Mill",
    lifegain: "Lifegain",
    artifacts: "Artifacts",
    enchantments: "Enchantments",
    counters: "Counters",
    reanimator: "Reanimator",
    elves: "Elves",
    goblins: "Goblins",
    control: "Control",
    midrange: "Midrange",
    storm: "Storm",
    scapeshift: "Scapeshift",
    trample: "Trample",
    haste: "Haste",
    flash: "Flash",
    toolbox: "Toolbox",
    aristocrats: "Aristocrats",
    tempo: "Tempo",
  };

  const deckName = `${colors} ${archetypeNames[archetype]} - ${themeNames[finalTheme]}`;
  const strategicApproach = generateStrategicApproach(
    archetype,
    finalTheme,
    difficulty,
  );

  // Ensure exact card count
  // -------------------------------------------------------------------
  // Issue #1229 — pre-game counter-deck generation. When the player's
  // archetype is known, inject a tuned hate package at the FRONT of the
  // cards array (so the truncation loop below retains them and drops
  // filler from the tail). Counter-picks REPLACE weak filler from the
  // easy/medium difficulty bands rather than inflating the deck, so a
  // 60-card constructed deck and a 100-card commander deck each stay
  // exactly the format-mandated size after truncation.
  //
  // Skipped entirely when `targetArchetype` is undefined, so the random
  // selection sequence and final deck contents match the pre-#1229 build
  // exactly (backward-compatible per the issue's acceptance criteria).
  if (targetArchetype) {
    const existingNames = new Set(cards.map((c) => c.name));
    const picks = selectCounterPicks(
      targetArchetype,
      finalColorIdentity,
      existingNames,
      DIFFICULTY_COUNTER_PICKS[difficulty],
    );
    // Insert at the head in deterministic order so test assertions about
    // membership are stable across runs.
    const counterCards = picks
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, quantity: 1 }));
    cards.unshift(...counterCards);
  }

  const finalCards = [];
  let finalTotal = 0;
  for (const card of cards) {
    if (finalTotal + card.quantity <= totalCards) {
      finalCards.push(card);
      finalTotal += card.quantity;
    } else if (finalTotal < totalCards) {
      finalCards.push({ ...card, quantity: totalCards - finalTotal });
      finalTotal = totalCards;
      break;
    }
  }

  return {
    name: deckName,
    archetype,
    theme: finalTheme,
    description: archetypeConfig.description,
    strategicApproach,
    cards: finalCards,
    colorIdentity: finalColorIdentity,
    difficulty,
    format,
    sideboard: generateSideboard({
      archetype,
      colorIdentity: finalColorIdentity,
      difficulty,
      format,
      maindeckCards: finalCards,
    }),
  };
}

/**
 * Quick generate random deck with random parameters
 */
export function generateRandomDeck(
  format: Format = "legendary-commander",
): GeneratedDeck {
  const archetypes: DeckArchetype[] = [
    "aggro",
    "control",
    "midrange",
    "combo",
    "ramp",
    "prison",
    "tempo",
    "tokens",
    "aristocrats",
    "stompy",
  ];
  const difficulties: DifficultyLevel[] = ["easy", "medium", "hard", "expert"];

  const archetype = archetypes[Math.floor(Math.random() * archetypes.length)];
  const difficulty =
    difficulties[Math.floor(Math.random() * difficulties.length)];

  return generateOpponentDeck({ format, archetype, difficulty });
}

/**
 * Generate deck with specific theme
 */
export function generateThemedDeck(
  theme: StrategicTheme,
  format: Format = "legendary-commander",
  difficulty: DifficultyLevel = "medium",
): GeneratedDeck {
  const themeToArchetype: Partial<Record<StrategicTheme, DeckArchetype>> = {
    burn: "aggro",
    weiss: "aggro",
    fairies: "tempo",
    zombies: "aristocrats",
    dragons: "ramp",
    tokens: "tokens",
    mill: "control",
    lifegain: "midrange",
    artifacts: "combo",
    enchantments: "combo",
    counters: "control",
    reanimator: "combo",
    elves: "ramp",
    goblins: "aggro",
    control: "control",
    midrange: "midrange",
    storm: "combo",
    scapeshift: "combo",
    trample: "stompy",
    haste: "aggro",
    flash: "tempo",
    toolbox: "midrange",
  };

  const archetype = themeToArchetype[theme] || "midrange";
  return generateOpponentDeck({ format, archetype, theme, difficulty });
}

/**
 * Generate deck based on color identity
 */
export function generateColorDeck(
  colors: string[],
  format: Format = "legendary-commander",
  difficulty: DifficultyLevel = "medium",
): GeneratedDeck {
  const archetypes: DeckArchetype[] = [
    "aggro",
    "control",
    "midrange",
    "combo",
    "ramp",
    "prison",
    "tempo",
    "tokens",
    "aristocrats",
    "stompy",
  ];
  const archetype = archetypes[Math.floor(Math.random() * archetypes.length)];

  return generateOpponentDeck({
    format,
    archetype,
    colorIdentity: colors,
    difficulty,
  });
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
export function getArchetypeConfig(
  archetype: DeckArchetype,
): ArchetypeConfig | undefined {
  return ARCHETYPE_CONFIGS[archetype];
}

/**
 * Get difficulty configuration
 */
export function getDifficultyConfig(
  difficulty: DifficultyLevel,
): DifficultyConfig {
  return DIFFICULTY_CONFIGS[difficulty];
}

/**
 * Validate deck archetype
 */
export function isValidArchetype(
  archetype: string,
): archetype is DeckArchetype {
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
export function isValidDifficulty(
  difficulty: string,
): difficulty is DifficultyLevel {
  return ["easy", "medium", "hard", "expert"].includes(difficulty);
}

// =============================================================================
// Issue #995 — AI sideboard generation + best-of-3 sideboarding
// -----------------------------------------------------------------------------
// The AI opponent previously played game 1's decklist for every game of a
// best-of-3 match. Below it (a) generates a legal, archetype-coherent
// sideboard alongside its maindeck and (b) boards between games using the same
// matchup/role weights that drive the human coach's per-matchup sideboard plan
// (issue #1076, `src/ai/flows/sideboard-plan.ts` -> MATCHUP_PROFILES). Keeping
// the role taxonomy and category weights identical makes the AI's swaps
// principled rather than random and keeps this module testable offline.
// =============================================================================

/** Archetype category, mirroring `src/ai/archetype-signatures.ts` categories. */
export type MatchupCategory =
  "aggro" | "control" | "midrange" | "combo" | "tribal" | "special";

/**
 * Functional role a card plays. Mirrors `RoleKey` in
 * `src/ai/flows/coach-deck-analysis.ts` / `sideboard-plan.ts` (#1076) so the
 * same role/value model drives both the coach's plan and the AI's boarding.
 */
export type CardRole =
  | "threats"
  | "ramp"
  | "removal"
  | "cardDraw"
  | "disruption"
  | "lands"
  | "other";

/** Maps the generator's archetypes onto the matchup-category taxonomy. */
const ARCHETYPE_CATEGORY: Record<DeckArchetype, MatchupCategory> = {
  aggro: "aggro",
  tempo: "aggro",
  stompy: "aggro",
  control: "control",
  prison: "control",
  midrange: "midrange",
  aristocrats: "midrange",
  tokens: "midrange",
  combo: "combo",
  ramp: "special",
};

/**
 * Value of each functional role when facing a given opponent category. This is
 * the SAME weighting model used by the human sideboard coach (#1076); it is
 * reproduced here (rather than imported) so this heuristic module stays
 * self-contained and free of `@/app/actions` / LLM-graph dependencies. Higher
 * = more desirable to board IN against that category; negative = cuttable.
 */
const MATCHUP_ROLE_VALUE: Record<MatchupCategory, Record<CardRole, number>> = {
  aggro: {
    threats: 0,
    ramp: -1,
    removal: 3,
    cardDraw: 1,
    disruption: 2,
    lands: 0,
    other: -2,
  },
  combo: {
    threats: 1,
    ramp: 0,
    removal: 0,
    cardDraw: 2,
    disruption: 3,
    lands: 0,
    other: -2,
  },
  control: {
    threats: 2,
    ramp: 0,
    removal: -1,
    cardDraw: 3,
    disruption: 2,
    lands: 0,
    other: -1,
  },
  midrange: {
    threats: 2,
    ramp: 0,
    removal: 2,
    cardDraw: 2,
    disruption: 1,
    lands: 0,
    other: -1,
  },
  tribal: {
    threats: 1,
    ramp: -1,
    removal: 3,
    cardDraw: 1,
    disruption: 2,
    lands: 0,
    other: -2,
  },
  special: {
    threats: 1,
    ramp: 0,
    removal: 2,
    cardDraw: 2,
    disruption: 2,
    lands: 0,
    other: -1,
  },
};

/**
 * Sideboard composition priority by the AI's own archetype category. A deck
 * stocks the roles it most wants to bring IN across the matchups it typically
 * faces (derived from MATCHUP_ROLE_VALUE: the roles with the highest combined
 * value against the field, weighted toward bad matchups). Used at generation
 * time so the sideboard is archetype-coherent, not random.
 */
const SIDEBOARD_ROLE_PRIORITY: Record<MatchupCategory, CardRole[]> = {
  aggro: ["removal", "disruption", "cardDraw", "threats"],
  control: ["threats", "cardDraw", "disruption", "removal"],
  midrange: ["removal", "cardDraw", "disruption", "threats"],
  combo: ["disruption", "cardDraw", "removal", "threats"],
  tribal: ["removal", "disruption", "cardDraw", "threats"],
  special: ["removal", "disruption", "cardDraw", "threats"],
};

/** A sideboard staple, tagged with its role and color requirements. */
interface SideboardStaple {
  name: string;
  role: CardRole;
  /** Empty/undefined = colorless (legal in any deck). Otherwise must be subset of color identity. */
  colors?: string[];
}

/**
 * Curated sideboard staples by role. These are well-known MTG sideboard cards;
 * like the rest of this module the entries are heuristic name strings (no card
 * DB lookup). Colorless hate cards are preferred so a single pool serves every
 * color identity, with a few color-aligned options for stronger boarding.
 */
const SIDEBOARD_POOL: SideboardStaple[] = [
  // --- Removal / sweepers / permanent hate ---
  { name: "Engineered Explosives", role: "removal" },
  { name: "Pithing Needle", role: "removal" },
  { name: "Sorcerous Spyglass", role: "removal" },
  { name: "Blood Moon", role: "removal", colors: ["R"] },
  { name: "Deafening Silence", role: "removal", colors: ["W"] },
  { name: "Doom Blade", role: "removal", colors: ["B"] },
  { name: "Flame Slash", role: "removal", colors: ["R"] },
  { name: "Path to Exile", role: "removal", colors: ["W"] },
  { name: "Seal of Fire", role: "removal", colors: ["R"] },

  // --- Disruption: counters / discard / stax ---
  { name: "Chalice of the Void", role: "disruption" },
  { name: "Trinisphere", role: "disruption" },
  { name: "Eidolon of Rhetoric", role: "disruption" },
  { name: "Negate", role: "disruption", colors: ["U"] },
  { name: "Flusterstorm", role: "disruption", colors: ["U"] },
  { name: "Duress", role: "disruption", colors: ["B"] },
  { name: "Thoughtseize", role: "disruption", colors: ["B"] },
  { name: "Damping Sphere", role: "disruption" },
  { name: "Leyline of the Void", role: "disruption", colors: ["B"] },

  // --- Card draw / selection / value ---
  { name: "Mystic Remora", role: "cardDraw", colors: ["U"] },
  { name: "Compost", role: "cardDraw", colors: ["G"] },
  { name: "Sylvan Library", role: "cardDraw", colors: ["G"] },
  { name: "Bond of Insight", role: "cardDraw", colors: ["U"] },
  { name: "Sea Gate Restoration", role: "cardDraw", colors: ["U"] },

  // --- Resilient / must-answer threats ---
  { name: "Batterskull", role: "threats" },
  { name: "Wurmcoil Engine", role: "threats" },
  { name: "Karn, the Great Creator", role: "threats" },
  { name: "Ulamog, the Ceaseless Hunger", role: "threats" },
  { name: "Banefire", role: "threats", colors: ["R"] },
  { name: "Kor Firewalker", role: "threats", colors: ["W"] },
  { name: "Gideon, Champion of Justice", role: "threats", colors: ["W"] },

  // --- Graveyard / artifact / enchantment hate (classified as removal) ---
  { name: "Grafdigger\u2019s Cage", role: "removal" },
  { name: "Tormod\u2019s Crypt", role: "removal" },
  { name: "Relic of Progenitus", role: "removal" },
  { name: "Scrabbling Claws", role: "removal" },
  { name: "Solemnity", role: "removal" },
  { name: "Stony Silence", role: "removal", colors: ["W"] },
  { name: "Fragmentize", role: "removal", colors: ["W"] },
  { name: "By Force", role: "removal", colors: ["R"] },
];

/** Lookup table for sideboard-staple roles by name (exact). */
const SIDEBOARD_ROLE_LOOKUP = new Map<string, CardRole>(
  SIDEBOARD_POOL.map((s) => [s.name, s.role]),
);

/**
 * Index of every CARD_POOL card name -> role. Built once at module load from
 * the category buckets so maindeck cards produced by the generator can be
 * scored by role during post-game sideboarding.
 */
const NAME_TO_ROLE: Map<string, CardRole> = (() => {
  const index = new Map<string, CardRole>();
  const set = (name: string, role: CardRole) => index.set(name, role);
  const setIfAbsent = (name: string, role: CardRole) => {
    if (!index.has(name)) index.set(name, role);
  };

  // Pass 1 — specific functional roles. These WIN over the generic creature
  // buckets so dual-category cards (e.g. Llanowar Elves is both a mana dork and
  // a 1-drop creature) classify by their strategic role, not as a generic threat.
  const specific: Array<[string[], CardRole]> = [
    [CARD_POOL.W_removal, "removal"],
    [CARD_POOL.B_kill, "removal"],
    [CARD_POOL.R_burn, "removal"],
    [CARD_POOL.U_counter, "disruption"],
    [CARD_POOL.B_discard, "disruption"],
    [CARD_POOL.U_tempo, "disruption"],
    [CARD_POOL.U_draw, "cardDraw"],
    [CARD_POOL.G_ramp, "ramp"],
    [CARD_POOL.colorless_rocks, "ramp"],
    [CARD_POOL.lands_dual, "lands"],
    [CARD_POOL.lands_basic, "lands"],
    [CARD_POOL.colorless_utility, "other"],
    [CARD_POOL.colorless_equipment, "other"],
    [CARD_POOL.W_utility, "other"],
    [CARD_POOL.R_utility, "other"],
    [CARD_POOL.B_reanimate, "other"],
    [CARD_POOL.W_lifegain, "threats"],
  ];
  for (const [cards, role] of specific) for (const c of cards) set(c, role);

  // Pass 2 — creature buckets fill only entries not already classified.
  const creatureBuckets: string[][] = [
    CARD_POOL.B_zombies,
    CARD_POOL.R_goblins,
    CARD_POOL.G_elves,
    CARD_POOL.G_trample,
    CARD_POOL.G_big,
    CARD_POOL.W_one_drops,
    CARD_POOL.W_two_drops,
    CARD_POOL.W_three_drops,
    CARD_POOL.W_four_drops,
    CARD_POOL.U_one_drops,
    CARD_POOL.U_two_drops,
    CARD_POOL.U_three_drops,
    CARD_POOL.U_four_drops,
    CARD_POOL.B_one_drops,
    CARD_POOL.B_two_drops,
    CARD_POOL.B_three_drops,
    CARD_POOL.B_four_drops,
    CARD_POOL.R_one_drops,
    CARD_POOL.R_two_drops,
    CARD_POOL.R_three_drops,
    CARD_POOL.R_four_drops,
    CARD_POOL.G_one_drops,
    CARD_POOL.G_two_drops,
    CARD_POOL.G_three_drops,
    CARD_POOL.G_four_drops,
  ];
  for (const bucket of creatureBuckets)
    for (const c of bucket) setIfAbsent(c, "threats");
  return index;
})();

/** Set of land card names (used to avoid cutting lands when sideboarding). */
const LAND_NAMES: Set<string> = new Set<string>([
  ...CARD_POOL.lands_dual,
  ...CARD_POOL.lands_basic,
  "Wastes",
  "Reliquary Tower",
  "Command Tower",
]);

function isLandName(name: string): boolean {
  if (LAND_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  return /\b(land|forest|island|mountain|plains|swamp|tower|wastes|fetch|shock)\b/.test(
    lower,
  );
}

/**
 * Classify a card NAME into a functional role. Deterministic.
 * Order: explicit sideboard-staple table -> CARD_POOL index -> name heuristic.
 */
export function classifyCardRole(name: string): CardRole {
  const explicit = SIDEBOARD_ROLE_LOOKUP.get(name);
  if (explicit) return explicit;
  const indexed = NAME_TO_ROLE.get(name);
  if (indexed) return indexed;
  const lower = name.toLowerCase();
  if (isLandName(name)) return "lands";
  if (
    /(counter|negate|cancel|deny|dismiss|quash|essence scatter|flash|confiscate|bounce|unsummon|vapor|remand|interrupt)/.test(
      lower,
    )
  ) {
    return "disruption";
  }
  if (
    /(destroy|exile|remove|kill|burn|bolt|path|swords|doom|murder|decay|pulse|terminate|blast|strike|cut|downfall|push|blast)/.test(
      lower,
    )
  ) {
    return "removal";
  }
  if (
    /(draw|divination|insight|catalog|foresight|ponder|preordain|brainstorm|inspiration|opportunity|jace|fact or fiction|ruinous|read the bones|sign in blood)/.test(
      lower,
    )
  ) {
    return "cardDraw";
  }
  if (
    /(ramp|growth|cultivate|kodama|signet|talisman|fellwar|mind stone|sol ring|mana vault|crypt)/.test(
      lower,
    )
  ) {
    return "ramp";
  }
  return "threats";
}

/** Resolve the AI archetype's matchup category. */
export function archetypeToCategory(archetype: DeckArchetype): MatchupCategory {
  return ARCHETYPE_CATEGORY[archetype] ?? "midrange";
}

function stapleLegalForColors(
  staple: SideboardStaple,
  colorIdentity: string[],
): boolean {
  if (!staple.colors || staple.colors.length === 0) return true; // colorless
  return staple.colors.every((c) => colorIdentity.includes(c));
}

/** Input for sideboard generation. */
export interface SideboardGenerationInput {
  archetype: DeckArchetype;
  colorIdentity: string[];
  difficulty: DifficultyLevel;
  format: Format;
  maindeckCards: Array<{ name: string; quantity: number }>;
}

/**
 * Generate a legal, archetype-coherent sideboard. Deterministic (no Math.random):
 * iterates roles in priority order for the AI's category and selects color-legal
 * staples that are NOT already in the maindeck, up to the format's sideboard
 * size. Returns [] when the format does not use a sideboard.
 */
export function generateSideboard(
  input: SideboardGenerationInput,
): Array<{ name: string; quantity: number }> {
  const rules = formatRules[input.format];
  if (!rules || !rules.usesSideboard || rules.sideboardSize <= 0) return [];

  const maxSize = rules.sideboardSize;
  const maxCopies = rules.maxCopies || 4;
  const priority = SIDEBOARD_ROLE_PRIORITY[
    archetypeToCategory(input.archetype)
  ] ?? ["removal", "disruption", "cardDraw", "threats"];

  const alreadyInMain = new Set(input.maindeckCards.map((c) => c.name));
  const used = new Set<string>();
  const sideboard: Array<{ name: string; quantity: number }> = [];
  let total = 0;

  // Expert/hard decks pack a fuller sideboard (closer to maxSize); easier decks
  // pack a leaner one. Mirrors the difficulty-scaling philosophy of the maindeck.
  const targetSize = Math.max(
    4,
    Math.round(
      maxSize *
        (input.difficulty === "expert"
          ? 1.0
          : input.difficulty === "hard"
            ? 0.9
            : input.difficulty === "medium"
              ? 0.75
              : 0.6),
    ),
  );

  for (const role of priority) {
    if (total >= targetSize) break;
    // Colorless-first, then color-aligned; stable alphabetical tie-break for determinism.
    const candidates = SIDEBOARD_POOL.filter(
      (s) => s.role === role && stapleLegalForColors(s, input.colorIdentity),
    ).sort((a, b) => {
      const ac = a.colors && a.colors.length ? 1 : 0;
      const bc = b.colors && b.colors.length ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return a.name.localeCompare(b.name);
    });

    for (const staple of candidates) {
      if (total >= targetSize) break;
      if (used.has(staple.name)) continue;
      if (alreadyInMain.has(staple.name)) continue;
      const remaining = targetSize - total;
      // Colorless hate: up to 2 copies; color-aligned staples: 1 copy.
      const perCard = staple.colors && staple.colors.length ? 1 : 2;
      const qty = Math.min(maxCopies, perCard, remaining);
      if (qty <= 0) continue;
      sideboard.push({ name: staple.name, quantity: qty });
      used.add(staple.name);
      total += qty;
    }
  }

  // Pad with any remaining legal staples (any role) if under target but >0 wanted.
  if (total < targetSize) {
    for (const staple of SIDEBOARD_POOL) {
      if (total >= targetSize) break;
      if (used.has(staple.name) || alreadyInMain.has(staple.name)) continue;
      if (!stapleLegalForColors(staple, input.colorIdentity)) continue;
      const remaining = targetSize - total;
      const qty = Math.min(remaining, 1);
      sideboard.push({ name: staple.name, quantity: qty });
      used.add(staple.name);
      total += qty;
    }
  }

  return sideboard;
}

/** A single in/out swap pair (quantities always match so totals stay legal). */
export interface SideboardSwapPair {
  in: { name: string; quantity: number };
  out: { name: string; quantity: number };
}

/** A complete post-game sideboarding decision for the AI. */
export interface SideboardSwap {
  opponentCategory: MatchupCategory;
  /** Paired in/out entries (boardIn total === boardOut total). */
  swaps: SideboardSwapPair[];
  boardIn: Array<{ name: string; quantity: number }>;
  boardOut: Array<{ name: string; quantity: number }>;
  /** One-line rationale grounded in the matchup profile. */
  rationale: string;
}

/** Input for post-game sideboarding. */
export interface AISideboardSwapInput {
  deck: GeneratedDeck;
  /** Observed/estimated opponent archetype category for the next game. */
  opponentCategory: MatchupCategory;
  difficulty?: DifficultyLevel;
  /** Result of the game just played. 'win' => board conservatively; 'loss'/'draw'|undefined => board fully. */
  lastGameResult?: "win" | "loss" | "draw";
}

/**
 * Maximum cards the AI will board in a single transition, by difficulty.
 * Scales as requested by issue #995 ("Easy swaps fewer (0-5), Expert swaps
 * optimally (10-15)"); expert is capped at 10 because useful swaps are
 * naturally bounded by the sideboard's role-value inventory.
 */
const DIFFICULTY_SWAP_CAP: Record<DifficultyLevel, number> = {
  easy: 3,
  medium: 5,
  hard: 8,
  expert: 10,
};

const CATEGORY_GUIDANCE: Record<MatchupCategory, string> = {
  aggro:
    "Board in cheap removal and disruptive interaction; shave slow top-end threats.",
  control: "Board in resilient threats and card draw; trim redundant removal.",
  midrange:
    "Board in efficient removal and card draw to pull ahead on resources.",
  combo: "Board in hand disruption and countermagic plus draw to find them.",
  tribal:
    "Board in sweepers and point removal; cut slow, non-interactive cards.",
  special:
    "Board in flexible interaction and card draw; trim narrow utility cards.",
};

/**
 * Compute the AI's post-game sideboarding. Deterministic for a given input:
 * sideboard cards are ranked by MATCHUP_ROLE_VALUE[opp](role) (in candidates)
 * and maindeck non-land cards by the negation (out candidates), then paired.
 * Win-reduced boarding keeps the AI from over-reacting after a victory.
 */
export function computeAISideboardSwap(
  input: AISideboardSwapInput,
): SideboardSwap {
  const deck = input.deck;
  const difficulty: DifficultyLevel =
    input.difficulty ?? deck.difficulty ?? "medium";
  const sideboard = Array.isArray(deck.sideboard) ? deck.sideboard : [];
  const profile =
    MATCHUP_ROLE_VALUE[input.opponentCategory] ?? MATCHUP_ROLE_VALUE.midrange;

  // Board-IN candidates: sideboard cards whose role has positive value here.
  const inCandidates = sideboard
    .map((c) => {
      const role = classifyCardRole(c.name);
      return {
        name: c.name,
        available: c.quantity,
        role,
        value: profile[role] ?? 0,
      };
    })
    .filter((c) => c.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  // Board-OUT candidates: maindeck non-land cards; higher cut = more expendable.
  const outCandidates = deck.cards
    .filter((c) => !isLandName(c.name))
    .map((c) => {
      const role = classifyCardRole(c.name);
      let cut = -(profile[role] ?? 0);
      // Slow cards are more cuttable against fast decks (mirrors #1076).
      if (
        input.opponentCategory === "aggro" ||
        input.opponentCategory === "tribal"
      ) {
        cut += 0.5;
      }
      // Redundant removal underperforms vs control.
      if (input.opponentCategory === "control" && role === "removal")
        cut += 1.0;
      return { name: c.name, available: c.quantity, role, cut };
    })
    .filter((c) => c.cut > 0)
    .sort((a, b) => b.cut - a.cut || a.name.localeCompare(b.name));

  let cap = DIFFICULTY_SWAP_CAP[difficulty] ?? 5;
  if (input.lastGameResult === "win") cap = Math.min(cap, 3);

  const swaps: SideboardSwapPair[] = [];
  const boardIn: Array<{ name: string; quantity: number }> = [];
  const boardOut: Array<{ name: string; quantity: number }> = [];
  let boarded = 0;

  let inIdx = 0;
  let outIdx = 0;
  while (
    boarded < cap &&
    inIdx < inCandidates.length &&
    outIdx < outCandidates.length
  ) {
    const inC = inCandidates[inIdx];
    const outC = outCandidates[outIdx];
    if (inC.available <= 0) {
      inIdx++;
      continue;
    }
    if (outC.available <= 0) {
      outIdx++;
      continue;
    }
    const remaining = cap - boarded;
    const qty = Math.min(inC.available, outC.available, remaining);
    if (qty <= 0) {
      inIdx++;
      continue;
    }
    swaps.push({
      in: { name: inC.name, quantity: qty },
      out: { name: outC.name, quantity: qty },
    });
    boardIn.push({ name: inC.name, quantity: qty });
    boardOut.push({ name: outC.name, quantity: qty });
    inC.available -= qty;
    outC.available -= qty;
    boarded += qty;
  }

  return {
    opponentCategory: input.opponentCategory,
    swaps,
    boardIn,
    boardOut,
    rationale: CATEGORY_GUIDANCE[input.opponentCategory],
  };
}

/**
 * Apply a sideboard swap to a deck, returning a NEW GeneratedDeck whose
 * maindeck and sideboard reflect the in/out changes. Pure: input is not
 * mutated. Maindeck size and sideboard size are preserved (each pair exchanges
 * equal quantities), keeping the configuration legal.
 */
export function applyAISideboardSwap(
  deck: GeneratedDeck,
  swap: SideboardSwap,
): GeneratedDeck {
  const sideboardIn = new Map<string, number>();
  for (const c of deck.sideboard ?? []) sideboardIn.set(c.name, c.quantity);
  const mainIn = new Map<string, number>();
  for (const c of deck.cards) mainIn.set(c.name, c.quantity);

  for (const pair of swap.swaps) {
    // Board OUT of maindeck -> into sideboard.
    const prevOut = mainIn.get(pair.out.name) ?? 0;
    const afterOut = prevOut - pair.out.quantity;
    if (afterOut > 0) mainIn.set(pair.out.name, afterOut);
    else mainIn.delete(pair.out.name);
    sideboardIn.set(
      pair.out.name,
      (sideboardIn.get(pair.out.name) ?? 0) + pair.out.quantity,
    );

    // Board IN from sideboard -> into maindeck.
    const prevSide = sideboardIn.get(pair.in.name) ?? 0;
    const afterSide = prevSide - pair.in.quantity;
    if (afterSide > 0) sideboardIn.set(pair.in.name, afterSide);
    else sideboardIn.delete(pair.in.name);
    mainIn.set(
      pair.in.name,
      (mainIn.get(pair.in.name) ?? 0) + pair.in.quantity,
    );
  }

  const toList = (
    m: Map<string, number>,
  ): Array<{ name: string; quantity: number }> =>
    Array.from(m.entries())
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => a.name.localeCompare(b.name));

  return {
    ...deck,
    cards: toList(mainIn),
    sideboard: toList(sideboardIn),
  };
}

/** One completed game's context for best-of-3 progression. */
export interface AISideboardingStep {
  opponentCategory: MatchupCategory;
  result?: "win" | "loss" | "draw";
}

/**
 * Drive sideboarding across a best-of-(N) match. Game 1 uses the pre-board
 * deck; each subsequent game re-boards from the current configuration using
 * the prior game's result. Deterministic.
 *
 * @returns the deck configuration to play the next game after all steps.
 */
export function progressAISideboarding(
  deck: GeneratedDeck,
  steps: AISideboardingStep[],
): GeneratedDeck {
  let current = deck;
  for (const step of steps) {
    const difficulty = current.difficulty;
    const swap = computeAISideboardSwap({
      deck: current,
      opponentCategory: step.opponentCategory,
      difficulty,
      lastGameResult: step.result,
    });
    if (swap.swaps.length === 0) continue;
    current = applyAISideboardSwap(current, swap);
  }
  return current;
}

/**
 * Resolve the AI sideboard size for a format (0 when sideboards are not used).
 * Exposed for callers/tests that want to verify legality without re-deriving.
 */
export function getAISideboardSize(format: Format): number {
  const rules = formatRules[format];
  if (!rules || !rules.usesSideboard) return 0;
  return rules.sideboardSize;
}

// =============================================================================
// Issue #1229 — Counter-deck generator (hate package tuned to the player's
// detected archetype).
// -----------------------------------------------------------------------------
// Goal: an Expert AI that knows the player is on Storm should bring
// Grafdigger's Cage / Deafening Silence / Rule-of-Law effects in its
// MAINDECK (not just the sideboard — the AI doesn't see post-game sideboards
// in #995's flow), not the same pile of generically-strong cards an Expert
// AI brings against any opponent. Without this, the four difficulty tiers
// converge on the same maindeck and tier differentiation evaporates.
//
// `counterPicksFor(targetArchetype)` is the public hate-card table.
// `generateOpponentDeck` injects `DIFFICULTY_COUNTER_PICKS[difficulty]` picks
// from the table at the front of the cards array when `targetArchetype` is
// supplied; truncation then drops filler from the tail, so the hate package
// replaces weak filler rather than inflating the deck. With `targetArchetype`
// undefined the new branch is skipped entirely, preserving the pre-#1229
// random sequence and maindeck contents.
// =============================================================================

/**
 * Color identity of each named hate pick so we can drop color-illegal picks
 * before injection. Empty array = colorless (always legal). Picks missing from
 * this table are treated as colorless — keeps the table short while still
 * letting the generator fall back to well-known colorless hate cards.
 */
const HATE_CARD_COLORS: Record<string, string[]> = {
  // Colorless hate (SIDEBOARD_POOL classics)
  "Engineered Explosives": [],
  "Pithing Needle": [],
  "Sorcerous Spyglass": [],
  "Chalice of the Void": [],
  Trinisphere: [],
  "Damping Sphere": [],
  "Grafdigger's Cage": [],
  "Tormod's Crypt": [],
  "Relic of Progenitus": [],
  "Scrabbling Claws": [],
  Solemnity: [],
  "Stony Silence": [],
  "Leyline of the Void": ["B"],
  // Colour-aligned removal / disruption (drawn from CARD_POOL)
  Thoughtseize: ["B"],
  Duress: ["B"],
  "Inquisition of Kozilek": ["B"],
  "Path to Exile": ["W"],
  "Swords to Plowshares": ["W"],
  "Anguished Unmaking": ["B", "W", "G"],
  Counterspell: ["U"],
  Negate: ["U"],
  "Spell Pierce": ["U"],
  "Force of Will": ["U"],
  Dispel: ["U"],
  "Doom Blade": ["B"],
  "Go for the Throat": ["B"],
  Dismember: ["B"],
  "Abrupt Decay": ["B", "G"],
  "Maelstrom Pulse": ["B", "G"],
  "Lightning Bolt": ["R"],
  "Brave the Elements": ["W"],
  "Auriok Champion": ["W"],
  "Soul Warden": ["W"],
  "Soul's Attendant": ["W"],
  "Spectral Procession": ["W"],
  "Selfless Spirit": ["W"],
  "Rest for the Weary": ["W"],
  "Goblin Guide": ["R"],
  "Monastery Swiftspear": ["R"],
  "Vexing Devil": ["R"],
  "Steppe Lynx": ["W"],
  "Adanto Vanguard": ["W"],
  "Champion of the Parish": ["W"],
  "Ragavan, Nimble Pilferer": ["R"],
};

/**
 * Hate-card table keyed by the player's detected archetype (issue #1229).
 * Each list mixes colorless staples with color-aligned interaction so a single
 * generator call covers small, midrange and large color budgets. Ordering
 * inside the list is intentional: stronger picks come first and become the
 * preferred picks when the count is trimmed by difficulty.
 *
 * Where possible the picks are drawn from CARD_POOL or SIDEBOARD_POOL so the
 * generator's downstream consumption (sideboard dedup, weight scoring, future
 * worker-bridge code) already knows the names.
 */
const COUNTER_PICKS_FOR_TARGET: Record<CounterTargetArchetype, string[]> = {
  combo: [
    // Colorless combo hate — preferred so they land in every color budget
    "Grafdigger's Cage",
    "Tormod's Crypt",
    "Damping Sphere",
    "Pithing Needle",
    "Solemnity",
    "Stony Silence",
    "Sorcerous Spyglass",
    "Chalice of the Void",
    "Trinisphere",
    // Color-aligned disruption (filtered to legal colors at injection time)
    "Thoughtseize",
    "Duress",
    "Inquisition of Kozilek",
    "Counterspell",
    "Negate",
    "Spell Pierce",
    "Dispel",
    "Force of Will",
  ],
  aggro: [
    // Sweepers and lifegain counter the "race" plan
    "Selfless Spirit",
    "Auriok Champion",
    "Soul Warden",
    "Soul's Attendant",
    "Spectral Procession",
    "Rest for the Weary",
    "Brave the Elements",
    // Color-aligned removal
    "Path to Exile",
    "Swords to Plowshares",
    "Anguished Unmaking",
    "Lightning Bolt",
    "Doom Blade",
    "Go for the Throat",
    "Dismember",
  ],
  control: [
    // Pressure — bring unbearably-fast threats that don't let a control
    // deck stabilize.
    "Goblin Guide",
    "Monastery Swiftspear",
    "Ragavan, Nimble Pilferer",
    "Champion of the Parish",
    "Adanto Vanguard",
    "Steppe Lynx",
    "Vexing Devil",
    // Discard to strip their answers
    "Thoughtseize",
    "Duress",
    "Inquisition of Kozilek",
    "Lightning Bolt",
  ],
  midrange: [
    // Flexible interaction: discard + cheap removal
    "Thoughtseize",
    "Inquisition of Kozilek",
    "Duress",
    "Lightning Bolt",
    "Path to Exile",
    "Swords to Plowshares",
    "Anguished Unmaking",
    "Maelstrom Pulse",
    "Abrupt Decay",
    "Dismember",
    "Counterspell",
    "Dispel",
    // Plus a colorless silver-bullet or two
    "Pithing Needle",
    "Chalice of the Void",
  ],
  tribal: [
    // Mass removal + flexible hate — punt the board twice
    "Engineered Explosives",
    "Pithing Needle",
    "Anguished Unmaking",
    "Maelstrom Pulse",
    "Path to Exile",
    "Swords to Plowshares",
    "Doom Blade",
    "Go for the Throat",
    "Dismember",
    "Brave the Elements",
    "Selfless Spirit",
  ],
  toolbox: [
    // Shut down their tutors/fetches
    "Pithing Needle",
    "Grafdigger's Cage",
    "Tormod's Crypt",
    "Damping Sphere",
    "Stony Silence",
    "Solemnity",
    "Sorcerous Spyglass",
    "Chalice of the Void",
    "Trinisphere",
    // Disruption to back it up
    "Thoughtseize",
    "Duress",
    "Inquisition of Kozilek",
    "Counterspell",
    "Negate",
    "Spell Pierce",
    "Dispel",
    "Force of Will",
  ],
  aristocrats: [
    // Lifegain shut off the drain plan; gy-hate stops the recursion engine
    "Auriok Champion",
    "Soul Warden",
    "Rest for the Weary",
    "Spectral Procession",
    "Selfless Spirit",
    "Brave the Elements",
    "Path to Exile",
    "Swords to Plowshares",
    "Anguished Unmaking",
    "Grafdigger's Cage",
    "Tormod's Crypt",
    "Pithing Needle",
    "Relic of Progenitus",
    "Solemnity",
  ],
};

/**
 * Number of maindeck counter-picks injected by difficulty (issue #1229).
 * Monotonically increasing so Expert decks hold denser hate packages than
 * Hard, which hold denser than Medium, which hold denser than Easy. Easy
 * stays well above zero so the AI still registers *something* for the
 * matchup; below zero would defeat the purpose.
 */
const DIFFICULTY_COUNTER_PICKS: Record<DifficultyLevel, number> = {
  easy: 2,
  medium: 3,
  hard: 5,
  expert: 6,
};

/**
 * Curated hate-card list for a given detected opponent archetype (issue
 * #1229). Exposed so callers and tests can verify a target is supported,
 * inspect the available pool, or build alternative hate packages without
 * running the full generator. Returns `[]` for an unknown target so callers
 * can safely forward a detection result without first validating it.
 */
export function counterPicksFor(target: CounterTargetArchetype): string[] {
  return COUNTER_PICKS_FOR_TARGET[target] ?? [];
}

/**
 * Resolve the number of maindeck counter-picks the generator should inject
 * for a given difficulty (issue #1229). Exposed for tests and for callers
 * that want to tune density without re-deriving the constant.
 */
export function counterPicksForDifficulty(difficulty: DifficultyLevel): number {
  return DIFFICULTY_COUNTER_PICKS[difficulty] ?? 0;
}

/**
 * Predicate: a hate-card name is legal in the supplied color identity. An
 * empty / missing `HATE_CARD_COLORS` entry is treated as colorless and
 * therefore always legal — this lets us add new colorless picks without
 * touching the table.
 */
function isHateCardLegal(name: string, colorIdentity: string[]): boolean {
  const colors = HATE_CARD_COLORS[name];
  if (!colors || colors.length === 0) return true;
  return colors.every((c) => colorIdentity.includes(c));
}

/**
 * Pick up to `count` counter-picks targeting `target` that are legal in
 * `colorIdentity` and not already present in `existingNames`. Picks are
 * ordered by `cardStrength` (stronger = preferred) with a deterministic
 * name-based tie-break so picks are reproducible across runs. Returns an
 * empty array when `target` is unknown or no legal candidates remain.
 *
 * Used by `generateOpponentDeck`'s maindeck-injection pass; not exported
 * because it depends on the per-deck context (color identity, dedup).
 */
function selectCounterPicks(
  target: CounterTargetArchetype,
  colorIdentity: string[],
  existingNames: Set<string>,
  count: number,
): string[] {
  if (count <= 0) return [];
  const sourceList = COUNTER_PICKS_FOR_TARGET[target] ?? [];
  if (sourceList.length === 0) return [];
  // Preserve the table's author-priority ordering — the leading entries of
  // each list are the *strategically most important* hate cards for that
  // matchup (e.g. Grafdigger's Cage for combo, Auriok Champion for aggro).
  // A card-strength reorder would lift generic removal to the top and bury
  // the archetype-specific hate, defeating the purpose. We only filter for
  // dedup + color legality, then take the first `count` (table-order is
  // stable across runs because the underlying object is module-frozen).
  const candidates = sourceList.filter(
    (name) => !existingNames.has(name) && isHateCardLegal(name, colorIdentity),
  );
  if (candidates.length === 0) return [];
  return candidates.slice(0, count);
}

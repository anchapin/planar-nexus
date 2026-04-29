/**
 * @fileOverview Synergy database for Magic: The Gathering deck analysis
 *
 * Defines synergy entries with scoring, descriptions, and examples
 * for identifying card combinations that work well together.
 */

import type { DeckCard } from "@/app/actions";

/**
 * Synergy type categories
 */
export type SynergyType =
  | "keyword"
  | "tribal"
  | "mechanic"
  | "mana"
  | "combo"
  | "theme";

/**
 * Synergy entry in the database
 */
export interface SynergyEntry {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Synergy category */
  type: SynergyType;
  /** Card patterns required for synergy */
  cards: string[];
  /** Cards that enhance the synergy */
  bonusCards?: string[];
  /** Base synergy score (1-10) */
  score: number;
  /** Description of the synergy */
  description: string;
  /** Example combination */
  example: string;
  /** Minimum cards needed for synergy to register */
  minimumCards?: number;
  /** Missing synergy suggestions for this type */
  missingSuggestions?: MissingSynergySuggestion[];
}

/**
 * Missing synergy suggestion
 */
export interface MissingSynergySuggestion {
  /** What's missing */
  missing: string;
  /** Description */
  description: string;
  /** Suggested card(s) to add */
  suggestion: string[];
  /** Impact level if added */
  impact: "high" | "medium" | "low";
  /** Condition to trigger this suggestion */
  condition: (deck: DeckCard[]) => boolean;
}

/**
 * Synergy database with 24 entries covering all types
 */
export const SYNERGY_DATABASE: SynergyEntry[] = [
  // === KEYWORD SYNERGIES (4) ===
  {
    id: "flying-deathtouch",
    name: "Untouchable Fliers",
    type: "keyword",
    cards: ["flying", "deathtouch"],
    score: 8,
    description:
      "Creatures with flying and deathtouch are nearly unblockable and trade favorably",
    example: "Necrotic Dragon, Dragonlord Silumgar",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Evasion enhancement",
        description:
          "Your flying deathtouch creatures could benefit from unblockable or shadow",
        suggestion: ["Shadow Rift", "Teferi's Protection", "Invisibility"],
        impact: "medium",
        condition: (deck) => {
          const flying = countKeyword(deck, "flying");
          const deathtouch = countKeyword(deck, "deathtouch");
          const unblockable =
            countKeyword(deck, "unblockable") + countKeyword(deck, "shadow");
          return flying >= 3 && deathtouch >= 2 && unblockable === 0;
        },
      },
    ],
  },
  {
    id: "first-strike-double-strike",
    name: "Strike Force",
    type: "keyword",
    cards: ["first strike", "double strike"],
    score: 7,
    description:
      "First and double strike creatures win combat and deal damage safely",
    example: "Aurelia, the Warleader + double strike creatures",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Pump spells",
        description:
          "Your strike creatures could benefit from pump spells to maximize damage",
        suggestion: ["Mutagenic Growth", "Titanic Growth", "Berserk"],
        impact: "medium",
        condition: (deck) => {
          const strike =
            countKeyword(deck, "first strike") +
            countKeyword(deck, "double strike");
          const pump = countPattern(deck, [
            "pump",
            "growth",
            "might",
            "strength",
          ]);
          return strike >= 4 && pump < 3;
        },
      },
    ],
  },
  {
    id: "lifelink-aggression",
    name: "Life Gain Aggro",
    type: "keyword",
    cards: ["lifelink", "aggressive"],
    score: 6,
    description: "Lifelink creatures stabilize while applying pressure",
    example: "Soul Warden, Ajani's Pridemate",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Life gain payoffs",
        description:
          "You have lifelink but no cards that benefit from life gain",
        suggestion: ["Ajani's Pridemate", "Soul Warden", "Celestial Mantle"],
        impact: "high",
        condition: (deck) => {
          const lifelink = countKeyword(deck, "lifelink");
          const payoff = countPattern(deck, [
            "lifelink",
            "gain life",
            "whenever you gain",
          ]);
          return lifelink >= 4 && payoff < 3;
        },
      },
    ],
  },
  {
    id: "hexproof-buff",
    name: "Hexproof Beatdown",
    type: "keyword",
    cards: ["hexproof", "aura"],
    score: 8,
    description:
      "Hexproof creatures with auras are hard to remove and very powerful",
    example: "Slippery Bogle + Rancor + Spider Umbra",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Aura package",
        description:
          "Your hexproof creatures need auras to maximize their potential",
        suggestion: ["Rancor", "Spider Umbra", "Ethereal Armor"],
        impact: "high",
        condition: (deck) => {
          const hexproof = countKeyword(deck, "hexproof");
          const auras =
            countType(deck, "enchantment") +
            countPattern(deck, ["aura", "enchant creature"]);
          return hexproof >= 3 && auras < 4;
        },
      },
    ],
  },

  // === TRIBAL SYNERGIES (7) ===
  {
    id: "dragon-tribal",
    name: "Dragon Tribal",
    type: "tribal",
    cards: ["Dragon"],
    bonusCards: ["Dragonlord", "Dragon Tempest", "Kolaghan", "Atarka"],
    score: 8,
    description: "Dragon lords buff your dragons and provide additional value",
    example: "Dragonlord Kolaghan + Dragons",
    minimumCards: 8,
    missingSuggestions: [
      {
        missing: "Dragon lords",
        description: "You have dragons but no lords to buff them",
        suggestion: [
          "Dragonlord Kolaghan",
          "Dragonlord Ojutai",
          "Utvara Hellkite",
        ],
        impact: "high",
        condition: (deck) => {
          const dragons = countPattern(deck, ["dragon", "drake", "wyrm"]);
          const lords = countPattern(deck, [
            "dragonlord",
            "kolaghan",
            "atarka",
            "silumgar",
            "utvara",
          ]);
          return dragons >= 6 && lords < 2;
        },
      },
      {
        missing: "Ramp for dragons",
        description: "Your expensive dragons need ramp to cast them on time",
        suggestion: [
          "Sol Ring",
          "Arcane Signet",
          "Cultivate",
          "Kodama's Reach",
        ],
        impact: "high",
        condition: (deck) => {
          const dragons = countPattern(deck, ["dragon", "drake", "wyrm"]);
          const ramp = countPattern(deck, [
            "ramp",
            "mana",
            "accelerate",
            "cultivate",
            "signet",
            "stone",
          ]);
          const avgCmc = calculateAvgCmc(deck);
          return dragons >= 5 && avgCmc >= 4 && ramp < 6;
        },
      },
    ],
  },
  {
    id: "elf-tribal",
    name: "Elves Tribal",
    type: "tribal",
    cards: ["Elf"],
    bonusCards: [
      "Heritage Druid",
      "Wirewood",
      "Ezuri",
      "Craterhoof",
      "Archdruid",
    ],
    score: 9,
    description: "Elf tribal with ramp and massive board presence",
    example: "Elvish Archdruid + Heritage Druid + Craterhoof",
    minimumCards: 12,
    missingSuggestions: [
      {
        missing: "Elf lords",
        description: "Your elves need lords to maximize their power",
        suggestion: [
          "Elvish Archdruid",
          "Ezuri, Renegade Leader",
          "Imperator of Pleasures",
        ],
        impact: "high",
        condition: (deck) => {
          const elves = countPattern(deck, ["elf", "elvish"]);
          const lords = countPattern(deck, [
            "archdruid",
            "ezuri",
            "imperator",
            "lord",
          ]);
          return elves >= 10 && lords < 2;
        },
      },
      {
        missing: "Finisher",
        description: "Your elf army needs a finisher to close out games",
        suggestion: [
          "Craterhoof Behemoth",
          "Ezuri, Renegade Leader",
          "Primeval Titan",
        ],
        impact: "high",
        condition: (deck) => {
          const elves = countPattern(deck, ["elf", "elvish"]);
          const finisher = countPattern(deck, [
            "craterhoof",
            "overrun",
            "finisher",
          ]);
          return elves >= 12 && finisher < 2;
        },
      },
    ],
  },
  {
    id: "goblin-tribal",
    name: "Goblin Tribal",
    type: "tribal",
    cards: ["Goblin"],
    bonusCards: ["Krenko", "Muxus", "Warren", "King", "Warlord", "Chieftain"],
    score: 8,
    description: "Goblin tribal with lords and sacrifice outlets",
    example: "Krenko, Mob Boss + Goblin tokens",
    minimumCards: 10,
    missingSuggestions: [
      {
        missing: "Goblin lords",
        description: "Your goblins need lords to maximize their aggression",
        suggestion: [
          "Goblin Warchief",
          "Goblin Chieftain",
          "Muxus, Goblin Grandee",
        ],
        impact: "high",
        condition: (deck) => {
          const goblins = countPattern(deck, ["goblin"]);
          const lords = countPattern(deck, [
            "warchief",
            "chieftain",
            "muxus",
            "krenko",
            "king",
          ]);
          return goblins >= 8 && lords < 2;
        },
      },
    ],
  },
  {
    id: "zombie-tribal",
    name: "Zombie Tribal",
    type: "tribal",
    cards: ["Zombie", "Lich", "Skeleton"],
    bonusCards: ["Graveyard", "Recur", "Reanimate", "Death", "Necro"],
    score: 7,
    description: "Zombie tribal with graveyard recursion",
    example: "Relentless Dead + Cemetery Reaper",
    minimumCards: 10,
    missingSuggestions: [
      {
        missing: "Graveyard recursion",
        description: "Your zombies need graveyard synergy to maximize value",
        suggestion: ["Cemetery Reaper", "Relentless Dead", "Undead Alchemist"],
        impact: "high",
        condition: (deck) => {
          const zombies = countPattern(deck, [
            "zombie",
            "lich",
            "skeleton",
            "undead",
          ]);
          const recursion = countPattern(deck, [
            "graveyard",
            "recur",
            "return",
            "reanimate",
          ]);
          return zombies >= 8 && recursion < 4;
        },
      },
    ],
  },
  {
    id: "vampire-tribal",
    name: "Vampire Tribal",
    type: "tribal",
    cards: ["Vampire"],
    bonusCards: [
      "Bloodlord",
      "Bloodghast",
      "Blood Artist",
      "Edgar Markov",
      "Sorin",
    ],
    score: 7,
    description: "Vampire tribal with life drain and card advantage",
    example: "Edgar Markov + Blood Artist + Bloodghast",
    minimumCards: 10,
    missingSuggestions: [
      {
        missing: "Vampire lords",
        description: "Your vampires need lords to maximize their power",
        suggestion: [
          "Edgar Markov",
          "Bloodlord of Vaasgoth",
          "Stromkirk Captain",
        ],
        impact: "high",
        condition: (deck) => {
          const vampires = countPattern(deck, ["vampire"]);
          const lords = countPattern(deck, [
            "edgar",
            "bloodlord",
            "stromkirk",
            "captain",
            "sorin",
          ]);
          return vampires >= 8 && lords < 2;
        },
      },
      {
        missing: "Life drain payoffs",
        description: "Your vampires could benefit from life drain synergies",
        suggestion: [
          "Blood Artist",
          "Zulaport Cutthroat",
          "Syr Konrad, the Grim",
        ],
        impact: "medium",
        condition: (deck) => {
          const vampires = countPattern(deck, ["vampire"]);
          const drain = countPattern(deck, [
            "life drain",
            "blood artist",
            "zulaport",
            "whenever a creature dies",
          ]);
          return vampires >= 8 && drain < 3;
        },
      },
    ],
  },
  {
    id: "merfolk-tribal",
    name: "Merfolk Tribal",
    type: "tribal",
    cards: ["Merfolk"],
    bonusCards: ["Lord", "Master", "Reejerey", "Coralhelm", "Seer"],
    score: 8,
    description: "Merfolk tribal with lords and unblockable threats",
    example: "Master of the Pearl Trident + Lord of Atlantis + Merfolk",
    minimumCards: 10,
    missingSuggestions: [
      {
        missing: "Merfolk lords",
        description: "Your merfolk need lords to maximize their power",
        suggestion: [
          "Master of the Pearl Trident",
          "Lord of Atlantis",
          "Merrow Reejerey",
        ],
        impact: "high",
        condition: (deck) => {
          const merfolk = countPattern(deck, ["merfolk"]);
          const lords = countPattern(deck, [
            "master of the pearl",
            "lord of atlantis",
            "reejerey",
            "coralhelm",
          ]);
          return merfolk >= 8 && lords < 2;
        },
      },
      {
        missing: "Island walk support",
        description: "Your merfolk could benefit from island walk enablers",
        suggestion: [
          "Lord of Atlantis",
          "Spreading Seas",
          "Jace, the Mind Sculptor",
        ],
        impact: "medium",
        condition: (deck) => {
          const merfolk = countPattern(deck, ["merfolk"]);
          const islandwalk = countPattern(deck, [
            "islandwalk",
            "spreading seas",
            "can't be blocked",
          ]);
          return merfolk >= 8 && islandwalk < 3;
        },
      },
    ],
  },
  {
    id: "human-tribal",
    name: "Human Tribal",
    type: "tribal",
    cards: ["Human"],
    bonusCards: ["Thalia", "Kessig", "Champion", "Lieutenant", "Captain"],
    score: 7,
    description: "Human tribal with anthem effects and tempo disruption",
    example: "Thalia, Guardian of Thraben + Human champions",
    minimumCards: 12,
    missingSuggestions: [
      {
        missing: "Human lords",
        description: "Your humans need lords to maximize their power",
        suggestion: [
          "Thalia's Lieutenant",
          "Kessig Malcontents",
          "Champion of the Parish",
        ],
        impact: "high",
        condition: (deck) => {
          const humans = countPattern(deck, ["human"]);
          const lords = countPattern(deck, [
            "thalia",
            "kessig",
            "champion",
            "lieutenant",
            "captain",
          ]);
          return humans >= 10 && lords < 2;
        },
      },
      {
        missing: "Tempo disruption",
        description: "Your humans could benefit from tempo disruption spells",
        suggestion: [
          "Thalia, Guardian of Thraben",
          "Meddling Mage",
          "Leonin Arbiter",
        ],
        impact: "medium",
        condition: (deck) => {
          const humans = countPattern(deck, ["human"]);
          const disruption = countPattern(deck, [
            "thalia",
            "meddling",
            "arbiter",
            "counter target",
            "tax",
          ]);
          return humans >= 10 && disruption < 3;
        },
      },
    ],
  },

  // === MECHANIC SYNERGIES (4) ===
  {
    id: "pump-evasion",
    name: "Evasive Pump",
    type: "mechanic",
    cards: ["pump spell", "evasion"],
    score: 7,
    description:
      "Pump spells on evasive creatures connect more often for lethal damage",
    example: "Mutagenic Growth on flying creature",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Evasion sources",
        description:
          "Your pump spells need evasive creatures to maximize damage",
        suggestion: [
          "Flying creatures",
          "Unblockable creatures",
          "Shadow creatures",
        ],
        impact: "medium",
        condition: (deck) => {
          const pump = countPattern(deck, [
            "pump",
            "growth",
            "might",
            "strength",
            "giant growth",
          ]);
          const evasion =
            countKeyword(deck, "flying") + countKeyword(deck, "unblockable");
          return pump >= 4 && evasion < 4;
        },
      },
    ],
  },
  {
    id: "fight-package",
    name: "Fight Package",
    type: "mechanic",
    cards: ["fight", "reach"],
    score: 6,
    description: "Fight spells with reach creatures handle flying threats",
    example: "Prey Upon + reach creatures",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Reach creatures",
        description: "Your fight spells work better with reach creatures",
        suggestion: ["Reach spiders", "Longbow archers", "Reach dinosaurs"],
        impact: "medium",
        condition: (deck) => {
          const fight = countPattern(deck, ["fight", "prey", "hunt"]);
          const reach = countKeyword(deck, "reach");
          return fight >= 3 && reach < 3;
        },
      },
    ],
  },
  {
    id: "sacrifice-outlet",
    name: "Sacrifice Value",
    type: "mechanic",
    cards: ["sacrifice", "token"],
    score: 7,
    description: "Sacrifice outlets convert tokens into value",
    example: "Visera, Bloodchief + token generators",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Sacrifice outlet",
        description: "Your tokens need sacrifice outlets for maximum value",
        suggestion: [
          "Visera, Bloodchief",
          "Zulaport Cutthroat",
          "Phyrexian Altar",
        ],
        impact: "high",
        condition: (deck) => {
          const tokens = countPattern(deck, [
            "token",
            "create creature",
            "generate",
          ]);
          const outlet = countPattern(deck, [
            "sacrifice",
            "offering",
            "altar",
            "visera",
          ]);
          return tokens >= 4 && outlet < 2;
        },
      },
    ],
  },
  {
    id: "mill-wincon",
    name: "Mill Strategy",
    type: "mechanic",
    cards: ["mill", "library"],
    score: 6,
    description: "Mill cards to deplete opponent's library",
    example: "Jace, Memory Adept + Millstone",
    minimumCards: 6,
    missingSuggestions: [
      {
        missing: "Mill win condition",
        description: "Your mill spells need a dedicated win condition",
        suggestion: ["Jace, Memory Adept", "Millstone", "Hedron Crab"],
        impact: "high",
        condition: (deck) => {
          const mill = countPattern(deck, [
            "mill",
            "library",
            "put into graveyard",
          ]);
          const wincon = countPattern(deck, [
            "jace",
            "millstone",
            "hedron crab",
            "win",
          ]);
          return mill >= 6 && wincon < 2;
        },
      },
    ],
  },

  // === MANA SYNERGIES (4) ===
  {
    id: "ramp-big-spells",
    name: "Ramp to Value",
    type: "mana",
    cards: ["ramp", "cmc≥6"],
    score: 8,
    description: "Ramp lets you cast big spells ahead of curve",
    example: "Sol Ring + Blightsteel Colossus",
    minimumCards: 6,
    missingSuggestions: [
      {
        missing: "Big threats",
        description: "Your ramp needs big spells to justify the acceleration",
        suggestion: [
          "Blightsteel Colossus",
          "Ulamog, the Ceaseless Hunger",
          "Craterhoof Behemoth",
        ],
        impact: "high",
        condition: (deck) => {
          const ramp = countPattern(deck, [
            "ramp",
            "mana",
            "accelerate",
            "cultivate",
            "signet",
          ]);
          const bigSpells = deck.filter((c) => (c.cmc || 0) >= 6).length;
          return ramp >= 6 && bigSpells < 4;
        },
      },
    ],
  },
  {
    id: "mana-rock-curve",
    name: "Mana Rock Acceleration",
    type: "mana",
    cards: ["artifact", "mana rock"],
    score: 6,
    description: "Mana rocks smooth out mana curve",
    example: "Sol Ring + Arcane Signet",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Mana rocks",
        description: "Your deck could benefit from mana acceleration",
        suggestion: ["Sol Ring", "Arcane Signet", "Thought Vessel"],
        impact: "medium",
        condition: (deck) => {
          const rocks = countPattern(deck, [
            "signet",
            "stone",
            "sol ring",
            "mana rock",
          ]);
          const avgCmc = calculateAvgCmc(deck);
          return avgCmc >= 3 && rocks < 4;
        },
      },
    ],
  },
  {
    id: "landfall-package",
    name: "Landfall Synergy",
    type: "mana",
    cards: ["landfall", "land"],
    score: 7,
    description: "Landfall triggers on every land drop",
    example: "Avenger of Zendikar + fetch lands",
    minimumCards: 6,
    missingSuggestions: [
      {
        missing: "Fetch lands",
        description:
          "Your landfall cards benefit from fetch lands for extra triggers",
        suggestion: ["Evolving Wilds", "Terramorphic Expanse", "Fetch lands"],
        impact: "medium",
        condition: (deck) => {
          const landfall = countPattern(deck, ["landfall", "whenever a land"]);
          const fetch = countPattern(deck, [
            "fetch",
            "evolving wilds",
            "terramorphic",
          ]);
          return landfall >= 4 && fetch < 3;
        },
      },
    ],
  },
  {
    id: "storm-ritual",
    name: "Storm Ritual",
    type: "mana",
    cards: ["ritual", "storm"],
    score: 9,
    description: "Ritual effects enable storm combo finishes",
    example: "Dark Ritual + Tendrils of Agony",
    minimumCards: 8,
    missingSuggestions: [
      {
        missing: "Ritual effects",
        description: "Your storm deck needs rituals for explosive turns",
        suggestion: ["Dark Ritual", "Cabal Ritual", "Seething Song"],
        impact: "high",
        condition: (deck) => {
          const storm = countPattern(deck, ["storm", "cast spells"]);
          const ritual = countPattern(deck, [
            "ritual",
            "dark ritual",
            "cabal ritual",
            "seething song",
          ]);
          return storm >= 3 && ritual < 4;
        },
      },
    ],
  },

  // === COMBO SYNERGIES (4) ===
  {
    id: "infinite-mana",
    name: "Infinite Mana",
    type: "combo",
    cards: ["mana generator", "untap"],
    score: 10,
    description: "Generates infinite mana for game-winning plays",
    example: "Basalt Monolith + Rings of Brighthearth",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Combo piece",
        description: "You have one piece of an infinite mana combo",
        suggestion: [
          "Basalt Monolith",
          "Rings of Brighthearth",
          "Power Artifact",
        ],
        impact: "high",
        condition: (deck) => {
          const monolith = countPattern(deck, ["basalt monolith"]);
          const rings = countPattern(deck, ["rings of brighthearth"]);
          return (monolith >= 1 && rings < 1) || (rings >= 1 && monolith < 1);
        },
      },
    ],
  },
  {
    id: "reanimation-combo",
    name: "Reanimation Combo",
    type: "combo",
    cards: ["reanimate", "big creature"],
    score: 9,
    description: "Reanimate big creatures from graveyard for cheap",
    example: "Reanimate + Griselbrand",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Reanimation targets",
        description: "Your reanimation spells need big creatures to target",
        suggestion: [
          "Griselbrand",
          "Archon of Cruelty",
          "Atraxa, Grand Unifier",
        ],
        impact: "high",
        condition: (deck) => {
          const reanimate = countPattern(deck, [
            "reanimate",
            "animate dead",
            "necromancy",
            "exhume",
          ]);
          const bigCreatures = deck.filter(
            (c) => (c.cmc || 0) >= 6 && c.type_line?.includes("Creature"),
          ).length;
          return reanimate >= 3 && bigCreatures < 4;
        },
      },
      {
        missing: "Graveyard setup",
        description:
          "Your reanimation needs ways to put creatures in graveyard",
        suggestion: ["Entomb", "Buried Alive", "Faithless Looting"],
        impact: "high",
        condition: (deck) => {
          const reanimate = countPattern(deck, [
            "reanimate",
            "animate dead",
            "necromancy",
          ]);
          const setup = countPattern(deck, [
            "entomb",
            "buried",
            "mill",
            "loot",
            "discard",
          ]);
          return reanimate >= 3 && setup < 3;
        },
      },
    ],
  },
  {
    id: "protean-hulk",
    name: "Protean Hulk Combo",
    type: "combo",
    cards: ["protean hulk", "dies"],
    score: 9,
    description: "Protean Hulk tutors combo pieces when it dies",
    example: "Protean Hulk + Village Rites",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Hulk targets",
        description: "Your Protean Hulk needs specific creatures to fetch",
        suggestion: [
          "Thassa, Deep-Dwelling",
          "Oracle of Mul Daya",
          "Village Rites",
        ],
        impact: "high",
        condition: (deck) => {
          const hulk = countPattern(deck, ["protean hulk"]);
          const targets = countPattern(deck, [
            "thassa",
            "oracle",
            "village rites",
            "dies",
          ]);
          return hulk >= 1 && targets < 3;
        },
      },
    ],
  },
  {
    id: "kiki-exarch",
    name: "Kiki-Exarch Combo",
    type: "combo",
    cards: ["kiki", "exarch"],
    score: 10,
    description: "Infinite creature tokens with untap combo",
    example: "Kiki-Jiki + Pestermite",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Combo piece",
        description: "You have one piece of the Kiki-Exarch combo",
        suggestion: [
          "Kiki-Jiki, Mirror Breaker",
          "Pestermite",
          "Deceiver Exarch",
        ],
        impact: "high",
        condition: (deck) => {
          const kiki = countPattern(deck, ["kiki-jiki", "kiki"]);
          const exarch = countPattern(deck, [
            "pestermite",
            "deceiver exarch",
            "exarch",
          ]);
          return (kiki >= 1 && exarch < 1) || (exarch >= 1 && kiki < 1);
        },
      },
    ],
  },

  // === THEME SYNERGIES (4) ===
  {
    id: "tokens-sacrifice",
    name: "Sacrifice Outlet",
    type: "theme",
    cards: ["token generator", "sacrifice"],
    score: 8,
    description: "Sacrifice tokens for value and board control",
    example: "Ophiomancer + Visera, Bloodchief",
    minimumCards: 6,
    missingSuggestions: [
      {
        missing: "Token anthems",
        description: "Your tokens need anthems to be threatening",
        suggestion: [
          "Intangible Virtue",
          "Anointed Procession",
          "Parallel Lives",
        ],
        impact: "medium",
        condition: (deck) => {
          const tokens = countPattern(deck, ["token", "create creature"]);
          const anthem = countPattern(deck, [
            "anthem",
            "virtue",
            "procession",
            "lives",
            "+1/+1",
          ]);
          return tokens >= 6 && anthem < 3;
        },
      },
    ],
  },
  {
    id: "artifact-synergy",
    name: "Artifact Synergy",
    type: "theme",
    cards: ["artifact"],
    bonusCards: ["Construct", "Robot", "Golem", "Equipment"],
    score: 7,
    description: "Artifact-focused strategy with synergistic creatures",
    example: "Master of Etherium + artifact creatures",
    minimumCards: 10,
    missingSuggestions: [
      {
        missing: "Artifact lords",
        description: "Your artifacts need lords to maximize their power",
        suggestion: [
          "Master of Etherium",
          "Thopter Foundry",
          "Arcbound Ravager",
        ],
        impact: "high",
        condition: (deck) => {
          const artifacts = countType(deck, "artifact");
          const lords = countPattern(deck, [
            "master of etherium",
            "thopter",
            "arcbound",
          ]);
          return artifacts >= 10 && lords < 3;
        },
      },
    ],
  },
  {
    id: "enchantment-synergy",
    name: "Enchantment Synergy",
    type: "theme",
    cards: ["enchantment"],
    bonusCards: ["Aura", "Curse", "Shrine", "Saga"],
    score: 7,
    description: "Enchantment-focused strategy with value engines",
    example: "Enchantress + Sigil of the Empty Throne",
    minimumCards: 10,
    missingSuggestions: [
      {
        missing: "Enchantress effects",
        description: "Your enchantments need card draw engines",
        suggestion: [
          "Eidolon of Blossoms",
          "Sigil of the Empty Throne",
          "Enchantress's Presence",
        ],
        impact: "high",
        condition: (deck) => {
          const enchantments = countType(deck, "enchantment");
          const draw = countPattern(deck, [
            "enchantress",
            "eidolon",
            "sigil",
            "draw",
          ]);
          return enchantments >= 10 && draw < 2;
        },
      },
    ],
  },
  {
    id: "planeswalker-value",
    name: "Planeswalker Value",
    type: "theme",
    cards: ["planeswalker"],
    bonusCards: ["Protection", "Ultimate"],
    score: 7,
    description: "Multiple planeswalkers for sustained value",
    example: "Teferi + Chandra + Protection",
    minimumCards: 4,
    missingSuggestions: [
      {
        missing: "Planeswalker protection",
        description: "Your planeswalkers need protection to survive",
        suggestion: [
          "Teferi's Protection",
          "Heroic Intervention",
          "Counterspells",
        ],
        impact: "high",
        condition: (deck) => {
          const walkers = countType(deck, "planeswalker");
          const protection = countPattern(deck, [
            "protection",
            "heroic intervention",
            "counterspell",
          ]);
          return walkers >= 4 && protection < 4;
        },
      },
    ],
  },
  {
    id: "superfriends",
    name: "Superfriends",
    type: "theme",
    cards: ["planeswalker", "protection"],
    score: 8,
    description: "Many planeswalkers protected until ultimate",
    example: "The Chain Veil + multiple walkers",
    minimumCards: 8,
    missingSuggestions: [
      {
        missing: "The Chain Veil",
        description:
          "Your planeswalker deck needs The Chain Veil for extra activations",
        suggestion: ["The Chain Veil", "Oath of Teferi"],
        impact: "high",
        condition: (deck) => {
          const walkers = countType(deck, "planeswalker");
          const veil = countPattern(deck, ["chain veil", "oath of teferi"]);
          return walkers >= 6 && veil < 1;
        },
      },
    ],
  },

  // === NLP-DISCOVERED SYNERGIES (7) ===
  {
    id: "nlp-thassa-oracle",
    name: "Thassa Oracle Combo",
    type: "combo",
    cards: ["Thassa's Oracle", "Demonic Consultation", "Tainted Pact"],
    score: 10,
    description:
      "Thassa's Oracle with deck-emptying effects wins the game instantly",
    example: "Thassa's Oracle + Demonic Consultation",
    minimumCards: 2,
  },
  {
    id: "nlp-exquisite-blood-sanguine",
    name: "Infinite Life Loop",
    type: "combo",
    cards: ["Exquisite Blood", "Sanguine Bond"],
    score: 10,
    description:
      "Exquisite Blood and Sanguine Bond create an infinite life drain loop",
    example: "Exquisite Blood + Sanguine Bond + 1 damage trigger",
    minimumCards: 2,
  },
  {
    id: "nlp-humility-orb",
    name: "Lockdown Enchantments",
    type: "theme",
    cards: ["Humility", "Opalescence"],
    score: 9,
    description: "Humility with Opalescence creates a unique board lock",
    example: "Humility + Opalescence + Moat",
    minimumCards: 2,
  },
  {
    id: "nlp-najeela-combat",
    name: "Najeela Combat",
    type: "combo",
    cards: ["Najeela", "Combat", "Extra combat"],
    score: 10,
    description: "Najeela with extra combat phase enablers goes infinite",
    example: "Najeela, the Blade-Blossom + Hassleberry + Warmaster",
    minimumCards: 3,
  },
  {
    id: "nlp-dockside-extravagance",
    name: "Dockside Storm",
    type: "combo",
    cards: ["Dockside Extortionist", "Storm", "Ritual"],
    score: 9,
    description:
      "Dockside Extortionist generates massive mana in multiplayer for storm finishes",
    example: "Dockside Extortionist + Bitter Ordeal + Aetherflux Reservoir",
    minimumCards: 3,
  },
  {
    id: "nlp-underworld-breach-lotus",
    name: "Underworld Breach Lotus",
    type: "combo",
    cards: ["Underworld Breach", "Lotus Petal", "Lion's Eye Diamond"],
    score: 10,
    description: "Underworld Breach recurs artifacts for a storm combo finish",
    example:
      "Underworld Breach + Lion's Eye Diamond + Lotus Petal + Brain Freeze",
    minimumCards: 4,
  },
  {
    id: "nlp-avenger-craterhoof",
    name: "Avenger Craterhoof",
    type: "combo",
    cards: ["Avenger of Zendikar", "Craterhoof Behemoth"],
    score: 9,
    description:
      "Avenger creates tokens that Craterhoof pumps for a lethal attack",
    example: "Avenger of Zendikar + Scute Swarm + Craterhoof Behemoth",
    minimumCards: 2,
  },
];

/**
 * Helper: Count cards with specific keyword
 */
function countKeyword(deck: DeckCard[], keyword: string): number {
  let count = 0;
  for (const card of deck) {
    const text = (card.oracle_text || "").toLowerCase();
    const type = (card.type_line || "").toLowerCase();
    const combined = `${text} ${type}`;

    if (combined.includes(keyword.toLowerCase())) {
      count += card.count;
    }
  }
  return count;
}

/**
 * Helper: Count cards matching patterns
 */
function countPattern(deck: DeckCard[], patterns: string[]): number {
  let count = 0;
  for (const card of deck) {
    const name = card.name.toLowerCase();
    const text = (card.oracle_text || "").toLowerCase();
    const type = (card.type_line || "").toLowerCase();
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
 * Helper: Count cards of specific type
 */
function countType(deck: DeckCard[], type: string): number {
  let count = 0;
  for (const card of deck) {
    const typeLine = (card.type_line || "").toLowerCase();
    if (typeLine.includes(type.toLowerCase())) {
      count += card.count;
    }
  }
  return count;
}

/**
 * Helper: Calculate average CMC
 */
function calculateAvgCmc(deck: DeckCard[]): number {
  let totalCmc = 0;
  let totalCards = 0;
  for (const card of deck) {
    const cmc = card.cmc || 0;
    if (cmc > 0) {
      totalCmc += cmc * card.count;
      totalCards += card.count;
    }
  }
  return totalCards > 0 ? totalCmc / totalCards : 0;
}

/**
 * Get synergy by ID
 */
export function getSynergyById(id: string): SynergyEntry | undefined {
  return SYNERGY_DATABASE.find((s) => s.id === id);
}

/**
 * Get synergies by type
 */
export function getSynergiesByType(type: SynergyType): SynergyEntry[] {
  return SYNERGY_DATABASE.filter((s) => s.type === type);
}

/**
 * Get all synergy names
 */
export function getAvailableSynergyNames(): string[] {
  return SYNERGY_DATABASE.map((s) => s.name);
}

/**
 * Get synergy IDs
 */
export function getAvailableSynergyIds(): string[] {
  return SYNERGY_DATABASE.map((s) => s.id);
}

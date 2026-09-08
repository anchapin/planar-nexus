/**
 * Engine-owned format / game-mode configuration (issue #1724).
 *
 * This module holds the format and deck-construction rules the rules
 * engine consults at validation time (e.g. `ValidationService`'s
 * per-format `maxLandsPerTurn` lookup via `getGameMode`). The data
 * previously lived in the root-level `@/lib/game-rules` module, which is
 * simultaneously consumed by UI components and AI flows — a UI-driven
 * edit there could silently alter engine validation results without
 * passing through the engine's mutation-tested surface.
 *
 * The dependency direction is now reversed: the ENGINE owns this
 * versioned input data, and `@/lib/game-rules` acts as a facade that
 * re-exports it so every pre-existing consumer keeps working unchanged.
 *
 * FORMAT_RULES_VERSION must be bumped whenever the data below changes
 * validation semantics (starting-life, deck sizes, copies, ban/restricted
 * lists, or the set of modes). It is deliberately coarse — data-only
 * edits that cannot change an engine outcome (typo fixes in display
 * strings) may keep the version.
 */

/**
 * Version of the engine-owned format rules input data (see header).
 */
export const FORMAT_RULES_VERSION = "1.0.0";

/**
 * Generic deck construction rule types
 */
export interface DeckConstructionRules {
  maxCopies: number;
  minCards: number;
  maxCards: number;
  startingLife: number;
  commanderDamage: number | null;
  usesSideboard: boolean;
  sideboardSize: number;
}

/**
 * Game mode configuration interface
 */
export interface GameModeConfig {
  id: string;
  name: string;
  description: string;
  deckRules: DeckConstructionRules;
  rules: string[];
  banList?: string[];
  restrictedList?: string[];
}

/**
 * Default deck construction rules for different game mode categories
 */
export const DEFAULT_RULES = {
  singleCommander: {
    maxCopies: 1,
    minCards: 100,
    maxCards: 100,
    startingLife: 40,
    commanderDamage: 21,
    usesSideboard: false,
    sideboardSize: 0,
  },
  constructed: {
    maxCopies: 4,
    minCards: 60,
    maxCards: Infinity,
    startingLife: 20,
    commanderDamage: null,
    usesSideboard: true,
    sideboardSize: 15,
  },
  limited: {
    maxCopies: 4,
    minCards: 40,
    maxCards: Infinity,
    startingLife: 20,
    commanderDamage: null,
    usesSideboard: false,
    sideboardSize: 0,
  },
};

/**
 * Predefined game modes
 * These can be extended or customized without code changes
 */
export const gameModes: Record<string, GameModeConfig> = {
  "legendary-commander": {
    id: "legendary-commander",
    name: "Legendary Commander",
    description:
      "Single-commander format with 100-card decks and 40 starting life",
    deckRules: DEFAULT_RULES.singleCommander,
    rules: [
      "100 cards exactly (including legendary)",
      "Maximum 1 copy of each card (except basic lands)",
      "1 Legendary card in the command zone",
      "Legendary's color identity determines deck colors",
      "40 starting life",
      "21 legendary damage eliminates a player",
    ],
    banList: [
      "ancestral recall",
      "balance",
      "biorhythm",
      "black lotus",
      "channel",
      "chaos orb",
      "coalition victory",
      "contract from below",
      "darkpact",
      "demonic attorney",
      "dream halls",
      "emrakul, the aeons torn",
      "entropy",
      "faithless looting",
      "fastbond",
      "flash",
      "fractured powerstone",
      "goblin recruiter",
      "griselbrand",
      "humility",
      "karakas",
      "kinnan, bonder prodigy",
      "leovold, emissary of trest",
      "limited resources",
      "mana crypt",
      "mana vault",
      "mox emerald",
      "mox jet",
      "mox pearl",
      "mox ruby",
      "mox sapphire",
      "mystic remora",
      "nadir kraken",
      "najal, the storm generator",
      "nas_met, megrim master",
      "oxizea, storm of the sea",
      "painter's servant",
      "panharmonicon",
      "primeval titan",
      "prophet of kruphix",
      "recurring nightmare",
      "rofelza, vizier of the ancients",
      "rofellos, llanowar emissary",
      "sunder",
      "sylvan primordial",
      "time walk",
      "timetwister",
      "tolarian academy",
      "trade secrets",
      "upheaval",
      "yawgmoth's bargain",
      "yawgmoth's will",
    ],
  },
  "constructed-core": {
    id: "constructed-core",
    name: "Constructed Core",
    description: "Standard constructed format with current card pool",
    deckRules: DEFAULT_RULES.constructed,
    rules: [
      "Minimum 60 cards",
      "Maximum 4 copies of each card (except basic lands)",
      "15 card sideboard (optional)",
      "20 starting life",
      "Uses current Core card pool",
    ],
    banList: [],
  },
  "constructed-legacy": {
    id: "constructed-legacy",
    name: "Constructed Legacy",
    description: "Extended constructed format with expanded card pool",
    deckRules: DEFAULT_RULES.constructed,
    rules: [
      "Minimum 60 cards",
      "Maximum 4 copies of each card (except basic lands)",
      "15 card sideboard (optional)",
      "20 starting life",
      "Cards from Legacy expansion onward",
    ],
    banList: [
      "ancestral recall",
      "balance",
      "black lotus",
      "channel",
      "channeler",
      "demonic tutor",
      "dream halls",
      "earthcraft",
      "flash",
      "frantic search",
      "goblin recruiter",
      "griselbrand",
      "hermit druid",
      "illusionist's bracers",
      "memory jar",
      "mox emerald",
      "mox jet",
      "mox pearl",
      "mox ruby",
      "mox sapphire",
      "mystic remora",
      "narset of the ancient way",
      "necropotence",
      "past in flames",
      "sensei's divining top",
      "skullclamp",
      "sol ring",
      "strip mine",
      "time walk",
      "timetwister",
      "tolarian academy",
      "treasure cruise",
      "triangle of war",
      "underworld breach",
      "vampiric tutor",
      "wheel of fortune",
      "windfall",
      "winter orb",
      "yawgmoth's bargain",
      "yawgmoth's will",
    ],
  },
  "constructed-vintage": {
    id: "constructed-vintage",
    name: "Constructed Vintage",
    description: "Constructed format with all cards and restricted list",
    deckRules: { ...DEFAULT_RULES.constructed, maxCopies: 4 },
    rules: [
      "Minimum 60 cards",
      "Maximum 4 copies of each card (except basic lands)",
      "Restricted cards limited to 1 copy",
      "15 card sideboard (optional)",
      "20 starting life",
      "All cards are legal, with some restrictions",
    ],
    restrictedList: [
      "ancestral recall",
      "ancestral vision",
      "balance",
      "black lotus",
      "brainstorm",
      "channel",
      "chromatic mox",
      "contract from below",
      "demonic tutor",
      "dig through time",
      "gush",
      "imperial seal",
      "jeweled lotus",
      "library of alexandria",
      "lion's eye diamond",
      "lotus petal",
      "mana crypt",
      "mana vault",
      "memory jar",
      "mox emerald",
      "mox jet",
      "mox pearl",
      "mox ruby",
      "mox sapphire",
      "mystic remora",
      "mystic tutor",
      "necropotence",
      "orcish lumberjack",
      "ponder",
      "preordain",
      "sol ring",
      "time walk",
      "timetwister",
      "tinker",
      "tolarian academy",
      "treasure cruise",
      "trinisphere",
      "vampiric tutor",
      "vault",
      "windfall",
      "yawgmoth's bargain",
      "yawgmoth's will",
    ],
  },
  "constructed-extended": {
    id: "constructed-extended",
    name: "Constructed Extended",
    description: "Constructed format with modern expansion sets",
    deckRules: DEFAULT_RULES.constructed,
    rules: [
      "Minimum 60 cards",
      "Maximum 4 copies of each card (except basic lands)",
      "15 card sideboard (optional)",
      "20 starting life",
      "Cards from Eighth Edition onward",
    ],
    banList: [
      "ancient tomb",
      "bazaar of baghdad",
      "blazing shoal",
      "chrome mox",
      "cloudpost",
      "depths",
      "dig through time",
      "dread return",
      "eye of ugin",
      "glimpse of nature",
      "golgari grave-troll",
      "green sun's zenith",
      "hypergenesis",
      "jace, the mind sculptor",
      "mental misstep",
      "mox opal",
      "mystic remora",
      "ancestral vision",
      "ponder",
      "preordain",
      "rite of flame",
      "seething song",
      "stoneforge mystic",
      "sword of the meek",
      "treasure cruise",
      "umezawa's jitte",
      "valakut, the molten pinnacle",
    ],
  },
  "constructed-restricted": {
    id: "constructed-restricted",
    name: "Constructed Restricted",
    description: "Constructed format limited to common cards only",
    deckRules: DEFAULT_RULES.constructed,
    rules: [
      "Minimum 60 cards",
      "Maximum 4 copies of each card (except basic lands)",
      "15 card sideboard (optional)",
      "20 starting life",
      "Only common cards allowed",
    ],
    banList: [
      "cloudpost",
      "crucible of worlds",
      "empty the warrens",
      "flash",
      "frantic search",
      "grapeshot",
      "invigorate",
      "ponder",
      "preordain",
      "storm",
      "treasure cruise",
    ],
  },
  "constructed-pioneer": {
    id: "constructed-pioneer",
    name: "Constructed Pioneer",
    description: "Constructed format with recent expansion sets",
    deckRules: DEFAULT_RULES.constructed,
    rules: [
      "Minimum 60 cards",
      "Maximum 4 copies of each card (except basic lands)",
      "15 card sideboard (optional)",
      "20 starting life",
      "Cards from Return to Ravnica onward (2012+)",
    ],
    banList: [],
  },
};

/**
 * Legacy type aliases for backward compatibility
 * Maps old format names to new game mode IDs
 */
export type Format = keyof typeof gameModes;

/**
 * Get game mode configuration by ID
 */
export function getGameMode(id: string): GameModeConfig | undefined {
  return gameModes[id];
}

/**
 * Get all available game modes
 */
export function getAllGameModes(): GameModeConfig[] {
  return Object.values(gameModes);
}

/**
 * Create a custom game mode
 * This allows users to define new formats without code changes
 */
export function createGameMode(
  config: Omit<GameModeConfig, "id">,
): GameModeConfig {
  const id = config.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return {
    ...config,
    id,
  };
}

/**
 * Register a custom game mode
 * This allows adding new formats at runtime
 */
export function registerGameMode(config: GameModeConfig): void {
  (gameModes as Record<string, GameModeConfig>)[config.id] = config;
}

/**
 * Get game mode by name (case-insensitive)
 */
export function findGameModeByName(name: string): GameModeConfig | undefined {
  const normalizedName = name.toLowerCase();
  return Object.values(gameModes).find(
    (mode) => mode.name.toLowerCase() === normalizedName,
  );
}

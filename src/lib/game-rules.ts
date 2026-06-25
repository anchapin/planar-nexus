/**
 * Generic format rules system for Planar Nexus
 *
 * This module defines a configurable game mode system with custom rulesets.
 * Formats are generic game modes that can be customized without code changes.
 */

// Game state types are defined in @/lib/game-state/types.ts (canonical internal representation)
// UI-facing adapter types are in @/types/game.ts for external/API compatibility

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
 * Legacy format rules for backward compatibility
 */
export const formatRules: Record<Format, DeckConstructionRules> =
  Object.fromEntries(
    Object.entries(gameModes).map(([id, config]) => [id, config.deckRules]),
  ) as Record<Format, DeckConstructionRules>;

/**
 * Legacy ban lists for backward compatibility
 */
export const banLists: Record<Format, string[]> = Object.fromEntries(
  Object.entries(gameModes).map(([id, config]) => [id, config.banList || []]),
) as Record<Format, string[]>;

/**
 * A legal substitute for a banned card.
 *
 * `type` and `manaValue` let callers group suggestions by card type and
 * mana cost so the most relevant replacement surfaces first. `reason`
 * explains the functional overlap (e.g. "ramp artifact") so the UI can
 * show why a substitute was chosen.
 */
export interface CardAlternative {
  name: string;
  type: string;
  manaValue: number;
  reason: string;
}

/**
 * Mapping of banned card names (lowercase) to 2-3 legal substitutes.
 *
 * Substitutes are chosen to match the banned card's primary function and
 * mana cost band. No substitute appearing here is on any format's ban
 * list defined in `gameModes`, so the suggestions are safe to surface in
 * any format. Cards without a strong direct replacement are omitted and
 * fall back to a generic "search for similar cards" affordance in the UI.
 */
export const BANNED_CARD_ALTERNATIVES: Record<string, CardAlternative[]> = {
  // --- PowerNine / fast mana (artifacts) ---
  "black lotus": [
    { name: "Lotus Petal", type: "Artifact", manaValue: 0, reason: "Free one-shot mana acceleration" },
    { name: "Dark Ritual", type: "Instant", manaValue: 1, reason: "Burst black mana ramp" },
    { name: "Elvish Spirit Guide", type: "Creature", manaValue: 2, reason: "Free green mana from hand" },
  ],
  "mox emerald": [
    { name: "Arcane Signet", type: "Artifact", manaValue: 2, reason: "Two-color mana rock" },
    { name: "Fellwar Stone", type: "Artifact", manaValue: 2, reason: "Reusable mana ramp" },
  ],
  "mox jet": [
    { name: "Arcane Signet", type: "Artifact", manaValue: 2, reason: "Two-color mana rock" },
    { name: "Charcoal Diamond", type: "Artifact", manaValue: 2, reason: "Black mana ramp" },
  ],
  "mox pearl": [
    { name: "Arcane Signet", type: "Artifact", manaValue: 2, reason: "Two-color mana rock" },
    { name: "Marble Diamond", type: "Artifact", manaValue: 2, reason: "White mana ramp" },
  ],
  "mox ruby": [
    { name: "Arcane Signet", type: "Artifact", manaValue: 2, reason: "Two-color mana rock" },
    { name: "Fire Diamond", type: "Artifact", manaValue: 2, reason: "Red mana ramp" },
  ],
  "mox sapphire": [
    { name: "Arcane Signet", type: "Artifact", manaValue: 2, reason: "Two-color mana rock" },
    { name: "Sky Diamond", type: "Artifact", manaValue: 2, reason: "Blue mana ramp" },
  ],
  "mana crypt": [
    { name: "Thran Dynamo", type: "Artifact", manaValue: 4, reason: "Big mana ramp artifact" },
    { name: "Gilded Lotus", type: "Artifact", manaValue: 5, reason: "Three-color ramp rock" },
    { name: "Worn Powerstone", type: "Artifact", manaValue: 3, reason: "Repeatable colorless ramp" },
  ],
  "mana vault": [
    { name: "Thran Dynamo", type: "Artifact", manaValue: 4, reason: "Big mana ramp artifact" },
    { name: "Worn Powerstone", type: "Artifact", manaValue: 3, reason: "Repeatable colorless ramp" },
    { name: "Voltaic Key", type: "Artifact", manaValue: 1, reason: "Untaps mana rocks for value" },
  ],
  "sol ring": [
    { name: "Thran Dynamo", type: "Artifact", manaValue: 4, reason: "Big mana ramp artifact" },
    { name: "Worn Powerstone", type: "Artifact", manaValue: 3, reason: "Repeatable colorless ramp" },
    { name: "Hedron Archive", type: "Artifact", manaValue: 4, reason: "Ramp with card draw option" },
  ],

  // --- Card draw / tutors ---
  "ancestral recall": [
    { name: "Brainstorm", type: "Instant", manaValue: 1, reason: "Cheap blue card selection" },
    { name: "Careful Study", type: "Sorcery", manaValue: 1, reason: "Low-cost loot effect" },
    { name: "Chart a Course", type: "Sorcery", manaValue: 2, reason: "Two-card draw" },
  ],
  "timetwister": [
    { name: "Time Spiral", type: "Sorcery", manaValue: 6, reason: "Wheel that refunds mana" },
    { name: "Day's Undoing", type: "Sorcery", manaValue: 3, reason: "Symmetric wheel" },
    { name: "Echo of Eons", type: "Sorcery", manaValue: 4, reason: "Repeatable wheel" },
  ],
  "time walk": [
    { name: "Time Warp", type: "Sorcery", manaValue: 5, reason: "Extra turn at fair cost" },
    { name: "Temporal Manipulation", type: "Sorcery", manaValue: 5, reason: "Extra turn" },
    { name: "Capture of Jingzhou", type: "Sorcery", manaValue: 5, reason: "Extra turn" },
  ],
  "yawgmoth's bargain": [
    { name: "Phyrexian Arena", type: "Enchantment", manaValue: 3, reason: "Repeatable life-for-cards" },
    { name: "Greed", type: "Enchantment", manaValue: 3, reason: "Pay life to draw cards" },
    { name: "Ambition's Cost", type: "Sorcery", manaValue: 4, reason: "Life-for-cards in one shot" },
  ],
  "necropotence": [
    { name: "Phyrexian Arena", type: "Enchantment", manaValue: 3, reason: "Repeatable life-for-cards" },
    { name: "Dark Confidant", type: "Creature", manaValue: 2, reason: "Life-for-cards on a body" },
    { name: "Greed", type: "Enchantment", manaValue: 3, reason: "Pay life to draw cards" },
  ],
  "demonic tutor": [
    { name: "Diabolic Tutor", type: "Sorcery", manaValue: 4, reason: "Fair-cost universal tutor" },
    { name: "Increasing Ambition", type: "Sorcery", manaValue: 5, reason: "Multiple-tutor option" },
    { name: "Beseech the Queen", type: "Sorcery", manaValue: 3, reason: "Scaled-cost tutor" },
  ],
  "jace, the mind sculptor": [
    { name: "Jace Beleren", type: "Planeswalker", manaValue: 3, reason: "Cheaper draw planeswalker" },
    { name: "Consecrated Sphinx", type: "Creature", manaValue: 6, reason: "Powerful repeatable card draw" },
    { name: "Fact or Fiction", type: "Instant", manaValue: 4, reason: "Blue card-selection instant" },
  ],

  // --- Big finishers ---
  "griselbrand": [
    { name: "Razaketh, the Foul-Blooded", type: "Creature", manaValue: 8, reason: "Life-for-tutors demon" },
    { name: "Vilis, Broker of Blood", type: "Creature", manaValue: 8, reason: "Life loss converts to cards" },
    { name: "Kothophed, Soul Hoarder", type: "Creature", manaValue: 6, reason: "Card draw on opponent loss" },
  ],
  "primeval titan": [
    { name: "Avenger of Zendikar", type: "Creature", manaValue: 7, reason: "Green land-matters finisher" },
    { name: "Terastodon", type: "Creature", manaValue: 8, reason: "Big green utility creature" },
    { name: "Woodfall Primus", type: "Creature", manaValue: 6, reason: "Persistent removal on a body" },
  ],
  "emrakul, the aeons torn": [
    { name: "Ulamog, the Ceaseless Hunger", type: "Creature", manaValue: 10, reason: "Cast-trigger removal eldrazi" },
    { name: "Kozilek, Butcher of Truth", type: "Creature", manaValue: 10, reason: "Card-draw eldrazi" },
    { name: "It That Betrays", type: "Creature", manaValue: 10, reason: "Annihilator payoff" },
  ],
  "sylvan primordial": [
    { name: "Woodfall Primus", type: "Creature", manaValue: 6, reason: "Persistent removal on a body" },
    { name: "Terastodon", type: "Creature", manaValue: 8, reason: "Multi-target removal" },
    { name: "Bane of Progress", type: "Creature", manaValue: 6, reason: "Mass artifact/enchantment removal" },
  ],

  // --- Lands ---
  "tolarian academy": [
    { name: "Nykthos, Shrine to Nyx", type: "Land", manaValue: 0, reason: "Scaling mana land" },
    { name: "Gaea's Cradle", type: "Land", manaValue: 0, reason: "Creature-based mana land" },
    { name: "Heartless Summoning", type: "Enchantment", manaValue: 2, reason: "Creature cost reduction" },
  ],
  "karakas": [
    { name: "Command Beacon", type: "Land", manaValue: 0, reason: "Commander-protection land" },
    { name: "High Market", type: "Land", manaValue: 0, reason: "Sac outlet land" },
    { name: "Crystal Shard", type: "Artifact", manaValue: 3, reason: "Bounces your legendary for reuse" },
  ],
  "strip mine": [
    { name: "Ghost Quarter", type: "Land", manaValue: 0, reason: "Land replacement with downside" },
    { name: "Tectonic Edge", type: "Land", manaValue: 0, reason: "Conditional land removal" },
    { name: "Field of Ruin", type: "Land", manaValue: 0, reason: "Symmetric land removal" },
  ],

  // --- Enchantments / combo enablers ---
  "panharmonicon": [
    { name: "Conjurer's Closet", type: "Artifact", manaValue: 5, reason: "Repeatable ETB abuse" },
    { name: "Deadeye Navigator", type: "Creature", manaValue: 6, reason: "Repeatable ETB trigger soulbond" },
    { name: "Teleportation Circle", type: "Enchantment", manaValue: 4, reason: "Repeatable blink" },
  ],
  "humility": [
    { name: "Winds of Rath", type: "Sorcery", manaValue: 5, reason: "Board reset leaving aura creatures" },
    { name: "Single Combat", type: "Sorcery", manaValue: 3, reason: "Forces symmetrical creature sacrifice" },
    { name: "Peacekeeper", type: "Creature", manaValue: 1, reason: "Stops combat damage" },
  ],
  "recurring nightmare": [
    { name: "Phyrexian Reclamation", type: "Enchantment", manaValue: 1, reason: "Pay life to recur creatures" },
    { name: "Sheoldred, Whispering One", type: "Creature", manaValue: 7, reason: "Repeatable reanimation" },
    { name: "Whisper, Blood Liturgist", type: "Creature", manaValue: 3, reason: "Tap-to-reanimate" },
  ],
  "sunder": [
    { name: "Cyclonic Rift", type: "Instant", manaValue: 2, reason: "Mass bounce (overload)" },
    { name: "Evacuation", type: "Instant", manaValue: 5, reason: "Symmetric creature bounce" },
    { name: "Devastation Tide", type: "Sorcery", manaValue: 5, reason: "Miracle mass bounce" },
  ],
  "upheaval": [
    { name: "Cyclonic Rift", type: "Instant", manaValue: 2, reason: "Mass bounce (overload)" },
    { name: "Devastation Tide", type: "Sorcery", manaValue: 5, reason: "Miracle mass bounce" },
    { name: "Oblivion Stone", type: "Artifact", manaValue: 3, reason: "Reset board state" },
  ],
};

/**
 * Look up legal substitutes for a banned card name.
 *
 * Returns substitutes sorted by similarity to the banned card's function
 * (cheaper / same-type first). Substitutes that are themselves banned in
 * the supplied format are filtered out so callers never re-suggest a
 * banned card. Returns an empty array when no curated alternatives exist.
 */
export function getBannedCardAlternatives(
  cardName: string,
  format?: Format,
): CardAlternative[] {
  const normalized = cardName.toLowerCase().trim();
  const alternatives = BANNED_CARD_ALTERNATIVES[normalized];
  if (!alternatives || alternatives.length === 0) return [];

  if (!format) return alternatives;

  const gameModeId = getGameModeIdFromFormatName(format);
  const bannedInFormat = new Set(
    (gameModes[gameModeId]?.banList || []).map((c) => c.toLowerCase()),
  );

  return alternatives.filter((alt) => !bannedInFormat.has(alt.name.toLowerCase()));
}

/**
 * Legacy restricted list for Vintage (now mapped to constructed-vintage)
 */
export const vintageRestrictedList: Set<string> = new Set(
  gameModes["constructed-vintage"].restrictedList || [],
);

/**
 * Legacy format rule descriptions for backward compatibility
 */
export const formatRuleDescriptions: Record<Format, string[]> =
  Object.fromEntries(
    Object.entries(gameModes).map(([id, config]) => [id, config.rules]),
  ) as Record<Format, string[]>;

/**
 * Legacy format name mappings for backward compatibility
 * Maps old format names (commander, modern, etc.) to new game mode IDs
 */
export const FORMAT_NAME_MAPPINGS: Record<string, string> = {
  commander: "legendary-commander",
  modern: "constructed-legacy",
  standard: "constructed-core",
  pioneer: "constructed-pioneer",
  legacy: "constructed-legacy",
  vintage: "constructed-vintage",
  pauper: "constructed-restricted",
};

/**
 * Get game mode ID from legacy format name
 */
export function getGameModeIdFromFormatName(formatName: string): string {
  return (
    FORMAT_NAME_MAPPINGS[formatName.toLowerCase()] || formatName.toLowerCase()
  );
}

/**
 * Basic land names (excluded from copy limits)
 */
const basicLandNames = [
  "forest",
  "island",
  "mountain",
  "plains",
  "swamp",
  "snow-covered forest",
  "snow-covered island",
  "snow-covered mountain",
  "snow-covered plains",
  "snow-covered swamp",
  "wastes",
];

/**
 * Check if a card is a basic land
 */
export function isBasicLand(cardName: string): boolean {
  const normalizedName = cardName.toLowerCase().trim();
  return basicLandNames.some((basic) => basic === normalizedName);
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  /**
   * Legal substitutes for each banned card detected in the deck/sideboard.
   * Only populated when one or more banned cards with curated alternatives
   * are found; omitted (undefined) otherwise to keep results stable for
   * callers that do not opt into alternatives.
   */
  bannedCardSuggestions?: BannedCardSuggestion[];
}

/**
 * One banned card plus its curated legal substitutes, ready for UI display.
 */
export interface BannedCardSuggestion {
  bannedCard: string;
  alternatives: CardAlternative[];
}

/**
 * Severity of a card's color-identity status relative to its commander.
 *
 * - `valid`    - card identity is fully within the commander's identity
 * - `warning`  - card has exactly 1 color outside the commander's identity
 *                (close to violating; highlighted distinctly from hard violations)
 * - `violation`- card has 2+ colors outside the commander's identity
 */
export type ColorIdentitySeverity = "valid" | "warning" | "violation";

/**
 * A per-card color-identity assessment. `violatedColors` lists the specific
 * mana colors present on the card but absent from the commander's identity.
 */
export interface ColorIdentityViolation {
  name: string;
  colorIdentity: string[];
  violatedColors: string[];
  severity: ColorIdentitySeverity;
}

/**
 * Human-readable names for the single-letter MTG mana color codes.
 */
export const MANA_COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

/**
 * Comprehensive format validation result
 */
export interface FormatValidationResult extends ValidationResult {
  format: Format;
  deckSize: number;
  requiredSize: number;
  hasCommander: boolean;
  colorIdentity?: string[];
  /**
   * Per-card color-identity assessments for cards that fall outside the
   * commander's color identity. Only populated for legendary-commander
   * decks when a commander is present. Undefined when there are no
   * violations or when the check does not apply.
   */
  colorIdentityViolations?: ColorIdentityViolation[];
}

/**
 * Return the colors present in `cardIdentity` but absent from
 * `commanderIdentity`.
 */
export function getViolatedColors(
  cardIdentity: string[],
  commanderIdentity: string[],
): string[] {
  return cardIdentity.filter((color) => !commanderIdentity.includes(color));
}

/**
 * Classify how severely a card violates the commander's color identity based
 * on the number of out-of-identity colors. A single out-of-identity color is
 * treated as a warning (close to violating); two or more is a hard violation.
 */
export function getColorIdentitySeverity(
  violatedColors: string[],
): ColorIdentitySeverity {
  if (violatedColors.length === 0) return "valid";
  if (violatedColors.length === 1) return "warning";
  return "violation";
}

export interface CardColorIdentityStatus {
  name: string;
  colorIdentity: string[];
  violatedColors: string[];
  severity: ColorIdentitySeverity;
}

/**
 * Assess a single card's color identity against the commander's identity.
 *
 * Returns `null` when the check does not apply (no commander identity, or the
 * card is a basic land which is always exempt). Colorless cards (empty
 * identity) are reported as `valid`.
 */
export function getCardColorIdentityStatus(
  card: { name: string; color_identity?: string[] },
  commanderIdentity: string[] | undefined,
): CardColorIdentityStatus | null {
  if (!commanderIdentity || commanderIdentity.length === 0) return null;
  if (isBasicLand(card.name)) return null;

  const identity = card.color_identity || [];
  const violated = getViolatedColors(identity, commanderIdentity);
  return {
    name: card.name,
    colorIdentity: identity,
    violatedColors: violated,
    severity: getColorIdentitySeverity(violated),
  };
}

/**
 * Derive the commander from a deck by selecting the first legendary creature.
 * Returns `undefined` when no legendary creature is present. The returned
 * color identity defaults to an empty array when the card has none.
 */
export function getCommanderFromDeck(
  deckCards: {
    name: string;
    type_line?: string;
    color_identity?: string[];
  }[],
): { name: string; color_identity: string[] } | undefined {
  const commander = deckCards.find((c) => {
    const type = (c.type_line || "").toLowerCase();
    return type.includes("legendary") && type.includes("creature");
  });
  if (!commander) return undefined;
  return {
    name: commander.name,
    color_identity: commander.color_identity || [],
  };
}

/**
 * Suggest cards to remove from a deck to bring it into compliance with the
 * commander's color identity. Results are sorted with hard violations first
 * (2+ out-of-identity colors), then warnings (1 out-of-identity color), then
 * alphabetically by name. Returns an empty array when there is no commander
 * identity or nothing violates it.
 */
export function getColorIdentityFixSuggestions(
  deckCards: {
    name: string;
    color_identity?: string[];
  }[],
  commanderIdentity: string[] | undefined,
): ColorIdentityViolation[] {
  if (!commanderIdentity || commanderIdentity.length === 0) return [];

  const suggestions: ColorIdentityViolation[] = [];
  deckCards.forEach((card) => {
    const status = getCardColorIdentityStatus(card, commanderIdentity);
    if (status && status.severity !== "valid") {
      suggestions.push({
        name: status.name,
        colorIdentity: status.colorIdentity,
        violatedColors: status.violatedColors,
        severity: status.severity,
      });
    }
  });

  return suggestions.sort((a, b) => {
    if (a.severity !== b.severity) {
      return a.severity === "violation" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Validate a decklist for a specific game mode with comprehensive checks
 */
export function validateDeckFormat(
  deckCards: {
    name: string;
    count: number;
    color_identity?: string[];
    type_line?: string;
  }[],
  format: Format,
  commander?: { name: string; color_identity: string[] },
): FormatValidationResult {
  // Map legacy format name to game mode ID
  const gameModeId = getGameModeIdFromFormatName(format);
  const gameMode = gameModes[gameModeId];

  if (!gameMode) {
    return {
      isValid: false,
      errors: [`Unknown format: ${format}`],
      warnings: [],
      format,
      deckSize: 0,
      requiredSize: 0,
      hasCommander: false,
    };
  }

  const rules = gameMode.deckRules;
  const errors: string[] = [];
  const warnings: string[] = [];
  let restrictedViolation = false;
  const bannedCardSuggestions: BannedCardSuggestion[] = [];
  const colorIdentityViolations: ColorIdentityViolation[] = [];
  const bannedCards = new Set(
    (gameMode.banList || []).map((c) => c.toLowerCase()),
  );
  const restrictedCards = new Set(
    (gameMode.restrictedList || []).map((c) => c.toLowerCase()),
  );

  // Check total card count
  const totalCards = deckCards.reduce((sum, card) => sum + card.count, 0);

  if (totalCards < rules.minCards) {
    errors.push(
      `Deck must have at least ${rules.minCards} cards (has ${totalCards})`,
    );
  }

  if (totalCards > rules.maxCards) {
    errors.push(
      `Deck must have at most ${rules.maxCards} cards (has ${totalCards})`,
    );
  }

  // Legendary Commander format validation
  if (format === "legendary-commander") {
    // Commander must have exactly 100 cards
    if (totalCards !== 100) {
      errors.push(
        `Legendary Commander decks must have exactly 100 cards (has ${totalCards})`,
      );
    }

    // Check for commander presence
    const hasCommander = !!commander;
    if (!hasCommander) {
      warnings.push(
        "No legendary specified - ensure deck follows color identity rules",
      );
    }

    // Check color identity if commander is present
    if (commander && commander.color_identity) {
      const commanderIdentity = commander.color_identity;

      deckCards.forEach(({ name, color_identity }) => {
        const status = getCardColorIdentityStatus(
          { name, color_identity },
          commanderIdentity,
        );
        if (status && status.severity !== "valid") {
          colorIdentityViolations.push({
            name: status.name,
            colorIdentity: status.colorIdentity,
            violatedColors: status.violatedColors,
            severity: status.severity,
          });
        }
      });

      if (colorIdentityViolations.length > 0) {
        // Detailed message including the specific colors each card violates.
        const details = colorIdentityViolations.slice(0, 5)
          .map((v) => {
            const violatedNames = v.violatedColors
              .map((c) => MANA_COLOR_NAMES[c] || c)
              .join("/");
            return `${v.name} (has ${violatedNames})`;
          })
          .join(", ");
        errors.push(
          `Color identity violation: ${details}${colorIdentityViolations.length > 5 ? "..." : ""} not in legendary's colors`,
        );
      }
    }
  }

  // Check individual card counts
  const cardCounts = new Map<string, { count: number; isBasic: boolean }>();

  deckCards.forEach(({ name, count }) => {
    const normalizedName = name.toLowerCase().trim();
    const isBasic = isBasicLand(name);

    const current = cardCounts.get(normalizedName) || { count: 0, isBasic };
    cardCounts.set(normalizedName, {
      count: current.count + count,
      isBasic,
    });
  });

  // Validate copy limits, ban lists, and restricted lists
  cardCounts.forEach(({ count, isBasic }, cardName) => {
    // Skip basic lands for copy limits
    if (isBasic) return;

    // Check restricted list - these cards are allowed with 1 copy
    if (restrictedCards.has(cardName)) {
      if (count > 1) {
        errors.push(
          `${cardName} is restricted in ${gameMode.name} - maximum 1 copy allowed`,
        );
        restrictedViolation = true;
      }
      return;
    }

    // Check ban list
    if (bannedCards.has(cardName)) {
      errors.push(`${cardName} is banned in ${gameMode.name}`);
      const alternatives = getBannedCardAlternatives(cardName, format);
      if (alternatives.length > 0) {
        bannedCardSuggestions.push({ bannedCard: cardName, alternatives });
      }
      return;
    }

    // Check copy limits
    if (count > rules.maxCopies) {
      errors.push(
        `${cardName} has ${count} copies, maximum is ${rules.maxCopies} in ${gameMode.name}`,
      );
    }
  });

  // Restricted format validation (all cards must be common)
  if (format === "constructed-restricted") {
    deckCards.forEach(({ name, type_line }) => {
      // Skip basic lands
      if (isBasicLand(name)) return;

      // Note: In production, this would check the actual rarity from card data
      // For now, we'll add a warning that this needs to be verified
      if (type_line && !type_line.toLowerCase().includes("basic")) {
        // Can't verify rarity without full card data, so add a warning
        warnings.push(
          `Rarity verification needed for ${name} (Restricted format requires commons only)`,
        );
      }
    });
  }

  const isValid = errors.length === 0;

  return {
    isValid: errors.length === 0 && !restrictedViolation,
    errors,
    warnings,
    format,
    deckSize: totalCards,
    requiredSize: rules.minCards,
    hasCommander: format === "legendary-commander" ? !!commander : false,
    colorIdentity: commander?.color_identity,
    bannedCardSuggestions:
      bannedCardSuggestions.length > 0 ? bannedCardSuggestions : undefined,
    colorIdentityViolations:
      colorIdentityViolations.length > 0 ? colorIdentityViolations : undefined,
  };
}

/**
 * Validate a sideboard for a format
 */
export function validateSideboard(
  sideboardCards: { name: string; count: number }[],
  format: Format,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const gameModeId = getGameModeIdFromFormatName(format);
  const gameMode = gameModes[gameModeId];

  if (!gameMode) {
    return {
      isValid: false,
      errors: [`Unknown format: ${format}`],
      warnings: [],
    };
  }

  const rules = gameMode.deckRules;

  // Legendary Commander doesn't use sideboards
  if (!rules.usesSideboard) {
    errors.push(`${gameMode.name} format does not use sideboards`);
    return { isValid: false, errors, warnings };
  }

  const sideboardSize = rules.sideboardSize;
  const totalCards = sideboardCards.reduce((sum, card) => sum + card.count, 0);

  if (totalCards > sideboardSize) {
    errors.push(
      `Sideboard must have at most ${sideboardSize} cards (has ${totalCards})`,
    );
  }

  // Enforce banned list, restricted list, and copy limits in the sideboard.
  // Combined main+sideboard limits are enforced by validateDeckAndSideboard.
  const bannedCards = new Set(
    (gameMode.banList || []).map((c) => c.toLowerCase()),
  );
  const restrictedCards = new Set(
    (gameMode.restrictedList || []).map((c) => c.toLowerCase()),
  );
  const bannedCardSuggestions: BannedCardSuggestion[] = [];

  const cardCounts = new Map<string, { count: number; isBasic: boolean }>();

  sideboardCards.forEach(({ name, count }) => {
    const normalizedName = name.toLowerCase().trim();
    const isBasic = isBasicLand(name);
    const current = cardCounts.get(normalizedName) || { count: 0, isBasic };
    cardCounts.set(normalizedName, {
      count: current.count + count,
      isBasic: current.isBasic && isBasic,
    });
  });

  cardCounts.forEach(({ count, isBasic }, cardName) => {
    // Banned cards are never allowed in the sideboard
    if (bannedCards.has(cardName)) {
      errors.push(`${cardName} is banned in ${gameMode.name}`);
      const alternatives = getBannedCardAlternatives(cardName, format);
      if (alternatives.length > 0) {
        bannedCardSuggestions.push({ bannedCard: cardName, alternatives });
      }
      return;
    }

    // Restricted cards are limited to a single copy
    if (restrictedCards.has(cardName)) {
      if (count > 1) {
        errors.push(
          `Sideboard: ${cardName} is restricted in ${gameMode.name} - maximum 1 copy allowed`,
        );
      }
      return;
    }

    // Basic lands are exempt from copy limits
    if (isBasic) return;

    if (count > rules.maxCopies) {
      errors.push(
        `Sideboard: ${cardName} has ${count} copies, maximum is ${rules.maxCopies}`,
      );
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    bannedCardSuggestions:
      bannedCardSuggestions.length > 0 ? bannedCardSuggestions : undefined,
  };
}

/**
 * Validation result for a deck and its sideboard checked together.
 */
export interface DeckAndSideboardValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  deckValidation: FormatValidationResult;
  sideboardValidation: ValidationResult;
}

/**
 * Validate a main deck together with its sideboard, enforcing the
 * cross-list rules that per-list validators cannot catch:
 *  - restricted cards are limited to 1 copy across main + sideboard combined
 *  - banned cards are disallowed in both lists (delegated to per-list checks)
 *  - non-basic-land cards are limited to maxCopies across main + sideboard combined
 *
 * Per-list checks (deck size, sideboard size, color identity, etc.) are
 * delegated to validateDeckFormat and validateSideboard.
 */
export function validateDeckAndSideboard(
  deckCards: {
    name: string;
    count: number;
    color_identity?: string[];
    type_line?: string;
  }[],
  sideboardCards: { name: string; count: number }[],
  format: Format,
  commander?: { name: string; color_identity: string[] },
): DeckAndSideboardValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate each list independently first.
  const deckValidation = validateDeckFormat(deckCards, format, commander);
  const sideboardValidation = validateSideboard(sideboardCards, format);

  errors.push(...deckValidation.errors, ...sideboardValidation.errors);
  warnings.push(...deckValidation.warnings, ...sideboardValidation.warnings);

  const gameModeId = getGameModeIdFromFormatName(format);
  const gameMode = gameModes[gameModeId];

  if (gameMode) {
    const rules = gameMode.deckRules;
    const bannedCards = new Set(
      (gameMode.banList || []).map((c) => c.toLowerCase()),
    );
    const restrictedCards = new Set(
      (gameMode.restrictedList || []).map((c) => c.toLowerCase()),
    );

    // Aggregate combined copy counts across main deck + sideboard.
    const combined = new Map<string, { count: number; isBasic: boolean }>();

    const addCards = (cards: { name: string; count: number }[]) => {
      cards.forEach(({ name, count }) => {
        const normalizedName = name.toLowerCase().trim();
        const isBasic = isBasicLand(name);
        const current = combined.get(normalizedName) || {
          count: 0,
          isBasic,
        };
        combined.set(normalizedName, {
          count: current.count + count,
          isBasic: current.isBasic && isBasic,
        });
      });
    };

    addCards(deckCards);
    addCards(sideboardCards);

    combined.forEach(({ count, isBasic }, cardName) => {
      // Basic lands are exempt from copy limits
      if (isBasic) return;

      // Banned cards are already reported by the per-list validators;
      // skip here to avoid duplicating the error message.
      if (bannedCards.has(cardName)) return;

      // Restricted cards: max 1 copy across main + sideboard combined
      if (restrictedCards.has(cardName)) {
        if (count > 1) {
          errors.push(
            `${cardName} is restricted in ${gameMode.name} - maximum 1 copy allowed across deck and sideboard (has ${count})`,
          );
        }
        return;
      }

      // Standard copy limit across main + sideboard combined
      if (count > rules.maxCopies) {
        errors.push(
          `${cardName} has ${count} copies across deck and sideboard, maximum is ${rules.maxCopies} in ${gameMode.name}`,
        );
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    deckValidation,
    sideboardValidation,
  };
}

/**
 * Check if a deck is legal for a format
 */
export function isDeckLegal(
  deckCards: {
    name: string;
    count: number;
    color_identity?: string[];
    type_line?: string;
  }[],
  format: Format,
  commander?: { name: string; color_identity: string[] },
): boolean {
  const result = validateDeckFormat(deckCards, format, commander);
  return result.isValid && result.warnings.length === 0;
}

/**
 * Get starting life total for a format
 */
export function getStartingLife(format: Format): number {
  const gameModeId = getGameModeIdFromFormatName(format);
  const gameMode = gameModes[gameModeId];
  return gameMode ? gameMode.deckRules.startingLife : 20;
}

/**
 * Get commander damage threshold for formats that use it
 */
export function getCommanderDamageThreshold(format: Format): number | null {
  const gameModeId = getGameModeIdFromFormatName(format);
  const gameMode = gameModes[gameModeId];
  return gameMode ? gameMode.deckRules.commanderDamage : null;
}

/**
 * Get mulligan rules for a format
 */
export function getMulliganRules() {
  return {
    type: "london",
    minHandSize: 0,
  };
}

/**
 * Get maximum hand size for a format
 */
export function getMaxHandSize(): number {
  return 7;
}

/**
 * Check if a format uses sideboards
 */
export function formatUsesSideboard(format: Format): boolean {
  const gameModeId = getGameModeIdFromFormatName(format);
  const gameMode = gameModes[gameModeId];
  return gameMode ? gameMode.deckRules.usesSideboard : false;
}

/**
 * Get sideboard size for a format
 */
export function getSideboardSize(format: Format): number {
  const gameModeId = getGameModeIdFromFormatName(format);
  const gameMode = gameModes[gameModeId];
  return gameMode ? gameMode.deckRules.sideboardSize : 0;
}

/**
 * Get format rules as human-readable descriptions
 */
export function getFormatRulesDescription(format: Format): string[] {
  const gameModeId = getGameModeIdFromFormatName(format);
  const gameMode = gameModes[gameModeId];
  return gameMode ? gameMode.rules : [];
}

/**
 * Get format display name
 */
export function getFormatDisplayName(format: Format): string {
  const gameModeId = getGameModeIdFromFormatName(format);
  const gameMode = gameModes[gameModeId];
  return gameMode ? gameMode.name : format;
}

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

/**
 * Get game mode description
 */
export function getGameModeDescription(format: Format): string {
  const gameModeId = getGameModeIdFromFormatName(format);
  const gameMode = gameModes[gameModeId];
  return gameMode ? gameMode.description : "";
}

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
}

/**
 * Comprehensive format validation result
 */
export interface FormatValidationResult extends ValidationResult {
  format: Format;
  deckSize: number;
  requiredSize: number;
  hasCommander: boolean;
  colorIdentity?: string[];
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
      const invalidCards: string[] = [];

      deckCards.forEach(({ name, color_identity }) => {
        if (!color_identity || isBasicLand(name)) return;

        // Check if card's color identity is within commander's
        const cardColors = color_identity;
        const hasInvalidColor = cardColors.some(
          (color) => !commanderIdentity.includes(color),
        );

        if (hasInvalidColor) {
          invalidCards.push(name);
        }
      });

      if (invalidCards.length > 0) {
        errors.push(
          `Color identity violation: ${invalidCards.slice(0, 5).join(", ")}${invalidCards.length > 5 ? "..." : ""} not in legendary's colors`,
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

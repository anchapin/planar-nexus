/**
 * Game rules and format definitions for Planar Nexus
 *
 * This module defines the rules for Magic: The Gathering formats,
 * including deck construction rules, ban/restricted lists, and validation.
 */

// Note: GameState type is defined in @/types/game
// Import directly from '@/types/game' when needed
// Also see @/lib/game-state/types.ts for full game state types

/**
 * Format-specific deck construction rules
 */
export const formatRules = {
  commander: {
    maxCopies: 1,
    minCards: 100,
    maxCards: 100,
    startingLife: 40,
    commanderDamage: 21,
    usesSideboard: false,
    sideboardSize: 0,
  },
  standard: {
    maxCopies: 4,
    minCards: 60,
    maxCards: Infinity,
    startingLife: 20,
    commanderDamage: null,
    usesSideboard: true,
    sideboardSize: 15,
  },
  modern: {
    maxCopies: 4,
    minCards: 60,
    maxCards: Infinity,
    startingLife: 20,
    commanderDamage: null,
    usesSideboard: true,
    sideboardSize: 15,
  },
  pioneer: {
    maxCopies: 4,
    minCards: 60,
    maxCards: Infinity,
    startingLife: 20,
    commanderDamage: null,
    usesSideboard: true,
    sideboardSize: 15,
  },
  legacy: {
    maxCopies: 4,
    minCards: 60,
    maxCards: Infinity,
    startingLife: 20,
    commanderDamage: null,
    usesSideboard: true,
    sideboardSize: 15,
  },
  vintage: {
    maxCopies: 4, // Except for restricted cards
    minCards: 60,
    maxCards: Infinity,
    startingLife: 20,
    commanderDamage: null,
    usesSideboard: true,
    sideboardSize: 15,
  },
  pauper: {
    maxCopies: 4,
    minCards: 60,
    maxCards: Infinity,
    startingLife: 20,
    commanderDamage: null,
    usesSideboard: true,
    sideboardSize: 15,
  },
};

export type Format = keyof typeof formatRules;

/**
 * Ban lists for each format (card names in lowercase)
 * Note: These are sample lists - in production, these should be fetched from Scryfall
 */
export const banLists: Record<Format, string[]> = {
  commander: [
    // Commander has a relatively small ban list
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
  standard: [
    // Standard ban list changes frequently - this is a sample
    // In production, fetch from Scryfall API
  ],
  modern: [
    // Modern ban list - sample
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
  pioneer: [
    // Pioneer ban list - sample
    "agent of treachery",
    " brawl",
    "cauldron familiar",
    "chapter",
    "collections",
    "connive",
    "convoke",
    "decay",
    "demonstrate",
    "design",
    "develop",
    "devour",
    "disguise",
    "disturb",
    "double strike",
    "enchant",
    "equip",
    "escape",
    "explore",
    "fabricate",
    "fear",
    "fight",
    "first strike",
    "flash",
    "flying",
    "for-mind",
    "fortell",
    "ward",
    "undergrowth",
    "unearth",
    "vanilla",
    "ward",
    "undergrowth",
  ],
  legacy: [
    // Legacy has a relatively small ban list
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
  vintage: [
    // Vintage has restricted cards instead of bans
    // These are limited to 1 copy
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
    "vampiric tutor",
    "vault",
    "windfall",
    "yawgmoth's bargain",
    "yawgmoth's will",
  ],
  pauper: [
    // Pauper ban list
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
};

/**
 * Restricted list for Vintage (cards limited to 1 copy)
 */
export const vintageRestrictedList: Set<string> = new Set(banLists.vintage);

/**
 * Format-specific rules for display
 */
export const formatRuleDescriptions: Record<Format, string[]> = {
  commander: [
    "100 cards exactly (including commander)",
    "Maximum 1 copy of each card (except basic lands)",
    "1 Commander card in the command zone",
    "Commander's color identity determines deck colors",
    "40 starting life",
    "21 commander damage eliminates a player",
  ],
  standard: [
    "Minimum 60 cards",
    "Maximum 4 copies of each card (except basic lands)",
    "15 card sideboard (optional)",
    "20 starting life",
    "Uses current Standard-legal card pool",
  ],
  modern: [
    "Minimum 60 cards",
    "Maximum 4 copies of each card (except basic lands)",
    "15 card sideboard (optional)",
    "20 starting life",
    "Cards from Eighth Edition onward, plus all core sets",
  ],
  pioneer: [
    "Minimum 60 cards",
    "Maximum 4 copies of each card (except basic lands)",
    "15 card sideboard (optional)",
    "20 starting life",
    "Cards from Return to Ravnica onward (2012+)",
  ],
  legacy: [
    "Minimum 60 cards",
    "Maximum 4 copies of each card (except basic lands)",
    "15 card sideboard (optional)",
    "20 starting life",
    "Almost all Magic cards are legal",
  ],
  vintage: [
    "Minimum 60 cards",
    "Maximum 4 copies of each card (except basic lands)",
    "Restricted cards limited to 1 copy",
    "15 card sideboard (optional)",
    "20 starting life",
    "All Magic cards are legal, with some restrictions",
  ],
  pauper: [
    "Minimum 60 cards",
    "Maximum 4 copies of each card (except basic lands)",
    "15 card sideboard (optional)",
    "20 starting life",
    "Only common cards allowed",
  ],
};

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
  "wastes", // Colorless basic land
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
 * Validate a decklist for a specific format with comprehensive checks
 */
export function validateDeckFormat(
  deckCards: { name: string; count: number; color_identity?: string[]; type_line?: string }[],
  format: Format,
  commander?: { name: string; color_identity: string[] }
): FormatValidationResult {
  const rules = formatRules[format];
  const errors: string[] = [];
  const warnings: string[] = [];
  const bannedCards = new Set(banLists[format].map((c) => c.toLowerCase()));

  // Check total card count
  const totalCards = deckCards.reduce((sum, card) => sum + card.count, 0);

  if (totalCards < rules.minCards) {
    errors.push(
      `Deck must have at least ${rules.minCards} cards (has ${totalCards})`
    );
  }

  if (totalCards > rules.maxCards) {
    errors.push(
      `Deck must have at most ${rules.maxCards} cards (has ${totalCards})`
    );
  }

  // Format-specific validation
  if (format === "commander") {
    // Commander must have exactly 100 cards
    if (totalCards !== 100) {
      errors.push(`Commander decks must have exactly 100 cards (has ${totalCards})`);
    }

    // Check for commander presence
    const hasCommander = !!commander;
    if (!hasCommander) {
      warnings.push("No commander specified - ensure deck follows color identity rules");
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
          (color) => !commanderIdentity.includes(color)
        );

        if (hasInvalidColor) {
          invalidCards.push(name);
        }
      });

      if (invalidCards.length > 0) {
        errors.push(
          `Color identity violation: ${invalidCards.slice(0, 5).join(", ")}${invalidCards.length > 5 ? "..." : ""} not in commander's colors`
        );
      }
    }
  }

  // Check individual card counts
  const cardCounts = new Map<string, { count: number; isBasic: boolean }>();

  deckCards.forEach(({ name, count, color_identity }) => {
    const normalizedName = name.toLowerCase().trim();
    const isBasic = isBasicLand(name);

    const current = cardCounts.get(normalizedName) || { count: 0, isBasic };
    cardCounts.set(normalizedName, {
      count: current.count + count,
      isBasic,
    });
  });

  // Validate copy limits and ban/restricted lists
  cardCounts.forEach(({ count, isBasic }, cardName) => {
    // Skip basic lands for copy limits
    if (isBasic) return;

    // Check ban list
    if (bannedCards.has(cardName)) {
      errors.push(`${cardName} is banned in ${format}`);
      return;
    }

    // Vintage restricted list check
    if (format === "vintage" && vintageRestrictedList.has(cardName)) {
      if (count > 1) {
        errors.push(`${cardName} is restricted in Vintage - maximum 1 copy allowed`);
      }
      return;
    }

    // Check copy limits
    if (count > rules.maxCopies) {
      errors.push(
        `${cardName} has ${count} copies, maximum is ${rules.maxCopies} in ${format}`
      );
    }
  });

  // Pauper-specific validation (all cards must be common)
  if (format === "pauper") {
    const uncommonCards: string[] = [];

    deckCards.forEach(({ name, type_line }) => {
      // Skip basic lands
      if (isBasicLand(name)) return;

      // Note: In production, this would check the actual rarity from Scryfall
      // For now, we'll add a warning that this needs to be verified
      if (type_line && !type_line.toLowerCase().includes("basic")) {
        // Can't verify rarity without full card data, so add a warning
        warnings.push(`Rarity verification needed for ${name} (Pauper requires commons only)`);
      }
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    format,
    deckSize: totalCards,
    requiredSize: rules.minCards,
    hasCommander: format === "commander" ? !!commander : false,
    colorIdentity: commander?.color_identity,
  };
}

/**
 * Validate a sideboard for a format
 */
export function validateSideboard(
  sideboardCards: { name: string; count: number }[],
  format: Format
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Commander doesn't use sideboards
  if (format === "commander") {
    errors.push("Commander format does not use sideboards");
    return { isValid: false, errors, warnings };
  }

  const sideboardSize = getSideboardSize(format);
  const totalCards = sideboardCards.reduce((sum, card) => sum + card.count, 0);

  if (totalCards > sideboardSize) {
    errors.push(
      `Sideboard must have at most ${sideboardSize} cards (has ${totalCards})`
    );
  }

  // Check that sideboard cards don't exceed 4 copies
  const cardCounts = new Map<string, number>();

  sideboardCards.forEach(({ name, count }) => {
    const normalizedName = name.toLowerCase().trim();
    const currentCount = cardCounts.get(normalizedName) || 0;
    cardCounts.set(normalizedName, currentCount + count);
  });

  cardCounts.forEach((count, cardName) => {
    if (count > 4) {
      errors.push(
        `Sideboard: ${cardName} has ${count} copies, maximum is 4`
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
 * Check if a deck is legal for a format
 */
export function isDeckLegal(
  deckCards: { name: string; count: number; color_identity?: string[]; type_line?: string }[],
  format: Format,
  commander?: { name: string; color_identity: string[] }
): boolean {
  const result = validateDeckFormat(deckCards, format, commander);
  return result.isValid && result.warnings.length === 0;
}

/**
 * Get starting life total for a format
 */
export function getStartingLife(format: Format): number {
  return formatRules[format].startingLife;
}

/**
 * Get commander damage threshold for formats that use it
 */
export function getCommanderDamageThreshold(format: Format): number | null {
  return formatRules[format].commanderDamage;
}

/**
 * Get mulligan rules for a format
 */
export function getMulliganRules(format: Format) {
  return {
    type: "london",
    minHandSize: 0,
  };
}

/**
 * Get maximum hand size for a format
 */
export function getMaxHandSize(format: Format): number {
  return 7;
}

/**
 * Check if a format uses sideboards
 */
export function formatUsesSideboard(format: Format): boolean {
  return formatRules[format].usesSideboard;
}

/**
 * Get sideboard size for a format
 */
export function getSideboardSize(format: Format): number {
  return formatRules[format].sideboardSize;
}

/**
 * Get format rules as human-readable descriptions
 */
export function getFormatRulesDescription(format: Format): string[] {
  return formatRuleDescriptions[format];
}

/**
 * Get format display name
 */
export function getFormatDisplayName(format: Format): string {
  const names: Record<Format, string> = {
    commander: "Commander",
    standard: "Standard",
    modern: "Modern",
    pioneer: "Pioneer",
    legacy: "Legacy",
    vintage: "Vintage",
    pauper: "Pauper",
  };
  return names[format];
}

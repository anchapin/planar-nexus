/**
 * MTG (Magic: The Gathering) Adapter for Generic Framework
 *
 * This module provides MTG-specific implementations and mappings to work with
 * the generic card game framework. It handles the translation between MTG-specific
 * terminology and generic framework concepts.
 *
 * Terminology Mapping:
 * - "Commander" → "Legendary Leader"
 * - "mana" → "resources"
 * - "lands" → "sources"
 * - "command zone" → "leader zone"
 * - "life" → "health"
 *
 * @module mtg-adapter
 */

import type {
  CardData,
  ResourcePool,
  GameSystemConfig,
  CardInstanceId,
  PlayerId,
} from "./generic-types";
import type { ScryfallCard } from "@/app/actions";

/**
 * MTG Game System Configuration
 */
export const MTG_CONFIG: GameSystemConfig = {
  name: "mtg",
  leaderDamageThreshold: 21,
  startingHealth: 20,
  startingHandSize: 7,
  maxSourcesPerTurn: 1,
};

/**
 * MTG Commander Format Configuration
 */
export const MTG_COMMANDER_CONFIG: GameSystemConfig = {
  name: "mtg-commander",
  leaderDamageThreshold: 21,
  startingHealth: 40,
  startingHandSize: 7,
  maxSourcesPerTurn: 1,
};

/**
 * MTG color types
 */
export type MTGColor = "white" | "blue" | "black" | "red" | "green" | "colorless";

/**
 * MTG Mana Pool (specialized ResourcePool)
 */
export interface MTGManaPool extends ResourcePool {
  /** White mana */
  white: number;
  /** Blue mana */
  blue: number;
  /** Black mana */
  black: number;
  /** Red mana */
  red: number;
  /** Green mana */
  green: number;
  /** Colorless mana */
  colorless: number;
  /** Generic mana that can be paid with any color */
  generic: number;
}

/**
 * MTG Card Data Adapter
 * Converts ScryfallCard to generic CardData
 */
export class MTGCardDataAdapter {
  /**
   * Convert ScryfallCard to generic CardData
   */
  static toGenericCard(scryfallCard: ScryfallCard): CardData {
    return {
      id: scryfallCard.id,
      name: scryfallCard.name,
      types: this.extractTypes(scryfallCard),
      subtypes: this.extractSubtypes(scryfallCard),
      supertypes: this.extractSupertypes(scryfallCard),
      cost: scryfallCard.mana_cost || undefined,
      text: scryfallCard.oracle_text || undefined,
      power: this.extractPower(scryfallCard),
      toughness: this.extractToughness(scryfallCard),
      metadata: {
        // Preserve MTG-specific data
        colors: scryfallCard.colors || [],
        color_identity: scryfallCard.color_identity || [],
        cmc: scryfallCard.cmc,
        loyalty: scryfallCard.loyalty,
        type_line: scryfallCard.type_line,
        image_uris: scryfallCard.image_uris,
        card_faces: scryfallCard.card_faces,
        // Store original scryfall data for reference
        _scryfall: scryfallCard,
      },
    };
  }

  /**
   * Extract card types from type_line
   */
  private static extractTypes(card: ScryfallCard): string[] {
    const typeLine = card.type_line?.toLowerCase() || "";
    const types: string[] = [];

    if (typeLine.includes("creature")) types.push("creature");
    if (typeLine.includes("instant")) types.push("instant");
    if (typeLine.includes("sorcery")) types.push("sorcery");
    if (typeLine.includes("artifact")) types.push("artifact");
    if (typeLine.includes("enchantment")) types.push("enchantment");
    if (typeLine.includes("planeswalker")) types.push("planeswalker");
    if (typeLine.includes("land")) types.push("land");

    return types;
  }

  /**
   * Extract subtypes from type_line
   */
  private static extractSubtypes(card: ScryfallCard): string[] {
    const typeLine = card.type_line || "";
    const match = typeLine.match(/—\s*(.+)$/);
    if (match) {
      return match[1].split(" ").filter(Boolean);
    }
    return [];
  }

  /**
   * Extract supertypes from type_line
   */
  private static extractSupertypes(card: ScryfallCard): string[] {
    const typeLine = card.type_line?.toLowerCase() || "";
    const supertypes: string[] = [];

    if (typeLine.includes("legendary")) supertypes.push("legendary");
    if (typeLine.includes("basic")) supertypes.push("basic");
    if (typeLine.includes("ongoing")) supertypes.push("ongoing");
    if (typeLine.includes("snow")) supertypes.push("snow");
    if (typeLine.includes("world")) supertypes.push("world");

    return supertypes;
  }

  /**
   * Extract power from card
   */
  private static extractPower(card: ScryfallCard): number | undefined {
    const pt = card.power_toughness;
    if (!pt) return undefined;

    const powerMatch = pt.match(/(\d+)/);
    return powerMatch ? parseInt(powerMatch[1], 10) : undefined;
  }

  /**
   * Extract toughness from card
   */
  private static extractToughness(card: ScryfallCard): number | undefined {
    const pt = card.power_toughness;
    if (!pt) return undefined;

    const toughnessMatch = pt.match(/\d+$/);
    return toughnessMatch ? parseInt(toughnessMatch[0], 10) : undefined;
  }
}

/**
 * MTG Resource Pool Adapter
 * Handles mana-specific operations
 */
export class MTGResourcePoolAdapter {
  /**
   * Create empty MTG mana pool
   */
  static createEmpty(): MTGManaPool {
    return {
      resources: new Map([
        ["white", 0],
        ["blue", 0],
        ["black", 0],
        ["red", 0],
        ["green", 0],
        ["colorless", 0],
        ["generic", 0],
      ]),
      white: 0,
      blue: 0,
      black: 0,
      red: 0,
      green: 0,
      colorless: 0,
      generic: 0,
    };
  }

  /**
   * Add mana to pool
   */
  static addMana(
    pool: MTGManaPool,
    color: MTGColor | "generic",
    amount: number
  ): MTGManaPool {
    const updated = { ...pool };

    if (color === "generic") {
      updated.generic += amount;
    } else {
      (updated as Record<string, number>)[color] += amount;
    }

    // Update resources map
    updated.resources.set(color, (updated.resources.get(color) || 0) + amount);

    return updated;
  }

  /**
   * Check if player has enough mana
   */
  static hasEnoughMana(
    pool: MTGManaPool,
    cost: Partial<MTGManaPool>
  ): boolean {
    return (
      pool.white >= (cost.white ?? 0) &&
      pool.blue >= (cost.blue ?? 0) &&
      pool.black >= (cost.black ?? 0) &&
      pool.red >= (cost.red ?? 0) &&
      pool.green >= (cost.green ?? 0) &&
      pool.colorless >= (cost.colorless ?? 0)
    );
  }

  /**
   * Spend mana from pool
   */
  static spendMana(
    pool: MTGManaPool,
    cost: Partial<MTGManaPool>
  ): MTGManaPool {
    const updated = { ...pool };

    updated.white = Math.max(0, updated.white - (cost.white ?? 0));
    updated.blue = Math.max(0, updated.blue - (cost.blue ?? 0));
    updated.black = Math.max(0, updated.black - (cost.black ?? 0));
    updated.red = Math.max(0, updated.red - (cost.red ?? 0));
    updated.green = Math.max(0, updated.green - (cost.green ?? 0));
    updated.colorless = Math.max(0, updated.colorless - (cost.colorless ?? 0));

    // Update resources map
    const colors: Array<keyof typeof updated> = ['white', 'blue', 'black', 'red', 'green', 'colorless', 'generic'];
    for (const color of colors) {
      updated.resources.set(color, updated[color]);
    }

    return updated;
  }
}

/**
 * MTG Card Type Utilities
 */
export class MTGCardTypeUtils {
  /**
   * Check if a card is a source (land)
   */
  static isSource(cardData: CardData): boolean {
    return cardData.types.includes("land");
  }

  /**
   * Check if a card is a legendary leader (commander)
   */
  static isLegendaryLeader(cardData: CardData): boolean {
    const supertypes = cardData.supertypes || [];
    const types = cardData.types || [];

    // Check for legendary supertype
    const isLegendary = supertypes.includes("legendary");

    // Check for creature or planeswalker type
    const isCreatureOrPlaneswalker =
      types.includes("creature") || types.includes("planeswalker");

    return isLegendary && isCreatureOrPlaneswalker;
  }

  /**
   * Get color identity from card
   */
  static getColorIdentity(cardData: CardData): MTGColor[] {
    const metadata = cardData.metadata as Record<string, unknown>;
    const colors = metadata.colors as string[] | undefined;
    const colorIdentity = metadata.color_identity as string[] | undefined;

    // Combine and deduplicate
    const combined = [...new Set([...(colors || []), ...(colorIdentity || [])])];

    return combined as MTGColor[];
  }

  /**
   * Check if card has a specific color
   */
  static hasColor(cardData: CardData, color: MTGColor): boolean {
    return this.getColorIdentity(cardData).includes(color);
  }

  /**
   * Check if card is creature
   */
  static isCreature(cardData: CardData): boolean {
    return cardData.types.includes("creature");
  }

  /**
   * Check if card is planeswalker
   */
  static isPlaneswalker(cardData: CardData): boolean {
    return cardData.types.includes("planeswalker");
  }

  /**
   * Check if card is instant or sorcery
   */
  static isInstantOrSorcery(cardData: CardData): boolean {
    return (
      cardData.types.includes("instant") || cardData.types.includes("sorcery")
    );
  }

  /**
   * Check if card is permanent
   */
  static isPermanent(cardData: CardData): boolean {
    const permanentTypes = [
      "creature",
      "artifact",
      "enchantment",
      "planeswalker",
      "land",
    ];
    return cardData.types.some((type) => permanentTypes.includes(type));
  }

  /**
   * Get mana value (CMC)
   */
  static getManaValue(cardData: CardData): number {
    const metadata = cardData.metadata as Record<string, unknown>;
    return (metadata.cmc as number) || 0;
  }
}

/**
 * MTG Zone Type Mappings
 */
export const MTG_ZONE_MAPPINGS = new Map<string, string>([
  ["library", "library"],
  ["hand", "hand"],
  ["battlefield", "battlefield"],
  ["graveyard", "graveyard"],
  ["exile", "exile"],
  ["stack", "stack"],
  ["command", "leader"], // MTG "command" zone → generic "leader" zone
  ["sideboard", "sideboard"],
  ["anticipate", "anticipate"],
]);

/**
 * MTG Zone Type Utilities
 */
export class MTGZoneUtils {
  /**
   * Convert MTG zone type to generic zone type
   */
  static toGenericZone(mtgZone: string): string {
    return MTG_ZONE_MAPPINGS.get(mtgZone) || mtgZone;
  }

  /**
   * Convert generic zone type to MTG zone type
   */
  static fromGenericZone(genericZone: string): string {
    // Reverse mapping
    for (const [mtg, generic] of Array.from(MTG_ZONE_MAPPINGS.entries())) {
      if (generic === genericZone) {
        return mtg;
      }
    }
    return genericZone;
  }
}

/**
 * MTG Leader Damage Tracking (Commander Damage)
 */
export interface MTGLeaderDamageState {
  /** Map of leader ID to damage dealt to each opponent */
  damageByLeader: Map<CardInstanceId, Map<PlayerId, number>>;
  /** Map of player ID to their leaders */
  playerLeaders: Map<PlayerId, CardInstanceId[]>;
  /** Damage threshold for losing (default 21 for Commander) */
  damageThreshold: number;
}

/**
 * Create initial MTG leader damage state
 */
export function createMTGLeaderDamageState(
  threshold: number = 21
): MTGLeaderDamageState {
  return {
    damageByLeader: new Map(),
    playerLeaders: new Map(),
    damageThreshold: threshold,
  };
}

/**
 * MTG Action Type Mappings
 */
export const MTG_ACTION_MAPPINGS = new Map<string, string>([
  ["play_land", "play_source"],
  ["gain_life", "gain_health"],
  ["lose_life", "lose_health"],
  ["pay_mana", "pay_resource"],
  ["add_mana", "add_resource"],
]);

/**
 * Convert MTG action type to generic action type
 */
export function toGenericActionType(mtgAction: string): string {
  return MTG_ACTION_MAPPINGS.get(mtgAction) || mtgAction;
}

/**
 * Convert generic action type to MTG action type
 */
export function fromGenericActionType(genericAction: string): string {
  // Reverse mapping
  for (const [mtg, generic] of Array.from(MTG_ACTION_MAPPINGS.entries())) {
    if (generic === genericAction) {
      return mtg;
    }
  }
  return genericAction;
}

/**
 * MTG Game State Helpers
 * Utility functions that work with MTG-specific data
 */
export class MTGGameStateHelpers {
  /**
   * Check if a card can be a commander (legendary leader)
   */
  static canBeCommander(cardData: CardData): boolean {
    return MTGCardTypeUtils.isLegendaryLeader(cardData);
  }

  /**
   * Get commander damage threshold
   */
  static getCommanderDamageThreshold(format: string): number {
    if (format === "commander") {
      return MTG_COMMANDER_CONFIG.leaderDamageThreshold || 21;
    }
    return MTG_CONFIG.leaderDamageThreshold || 0;
  }

  /**
   * Get starting life for format
   */
  static getStartingLife(format: string): number {
    if (format === "commander") {
      return MTG_COMMANDER_CONFIG.startingHealth;
    }
    return MTG_CONFIG.startingHealth;
  }

  /**
   * Get max sources per turn for format
   */
  static getMaxSourcesPerTurn(format: string): number {
    if (format === "commander") {
      return MTG_COMMANDER_CONFIG.maxSourcesPerTurn;
    }
    return MTG_CONFIG.maxSourcesPerTurn;
  }
}

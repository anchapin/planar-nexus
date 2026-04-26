/**
 * Hand Targeting System
 * 
 * Provides game state functions for initiating and resolving hand targeting effects
 * like Duress, Thoughtseize, and Inquisition of Kozilek.
 */

import { 
  CardInstanceId, 
  GameState, 
  PlayerId, 
  CardInstance,
  Zone
} from "./types";

/**
 * Result of initiating hand targeting
 */
export interface HandTargetingResult {
  success: boolean;
  /** Cards revealed from the target player's hand */
  revealedCards: CardInstanceId[];
  /** Card IDs that match the targeting filter (valid targets) */
  targetableCardIds: CardInstanceId[];
  /** Card IDs that don't match the filter */
  nonTargetableCardIds: CardInstanceId[];
  /** Error message if failed */
  error?: string;
}

/**
 * Result of resolving hand targeting (selecting a card)
 */
export interface HandTargetResolutionResult {
  success: boolean;
  /** The selected card */
  selectedCard?: CardInstance;
  /** Description of what happened */
  description: string;
  /** Error if failed */
  error?: string;
}

/**
 * Filter types for hand card targeting
 */
export type HandCardFilter = 
  | "any"
  | "nonland"
  | "creature" 
  | "planeswalker"
  | "creature_or_planeswalker"
  | "artifact"
  | "enchantment"
  | "instant"
  | "sorcery";

/**
 * Checks if a card matches the filter
 */
function cardMatchesFilter(card: CardInstance, filter: HandCardFilter): boolean {
  const typeLine = card.cardData?.type_line?.toLowerCase() || "";
  
  switch (filter) {
    case "any":
      return true;
    case "nonland":
      return !typeLine.includes("land");
    case "creature":
      return typeLine.includes("creature");
    case "planeswalker":
      return typeLine.includes("planeswalker");
    case "creature_or_planeswalker":
      return typeLine.includes("creature") || typeLine.includes("planeswalker");
    case "artifact":
      return typeLine.includes("artifact");
    case "enchantment":
      return typeLine.includes("enchantment");
    case "instant":
      return typeLine.includes("instant");
    case "sorcery":
      return typeLine.includes("sorcery");
    default:
      return false;
  }
}

/**
 * Gets the hand targeting filter for a specific card
 */
export function getHandTargetingFilter(cardName: string): HandCardFilter | null {
  const normalizedName = cardName.toLowerCase();
  
  if (normalizedName.includes("duress") || normalizedName.includes("thoughtseize")) {
    return "nonland";
  }
  if (normalizedName.includes("inquisition")) {
    return "creature_or_planeswalker";
  }
  if (normalizedName.includes("despise")) {
    return "creature";
  }
  if (normalizedName.includes("coerc")) {
    return "any";
  }
  return null;
}

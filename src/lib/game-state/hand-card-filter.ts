/**
 * Hand Card Filtering System
 * 
 * Provides filtering logic for cards in hand for effects like Duress, Thoughtseize,
 * and Inquisition of Kozilek that require selecting a specific type of card from
 * an opponent's hand.
 */

import { CardInstance } from "./types";

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
  | "sorcery"
  | "instant_or_sorcery"
  | "noncreature"
  | "nonplaneswalker";

/**
 * Result of filtering hand cards
 */
export interface FilterResult {
  /** Cards matching the filter */
  matchingCards: CardInstance[];
  /** Cards not matching the filter */
  nonMatchingCards: CardInstance[];
  /** Whether the filter had any matches */
  hasMatches: boolean;
}

/**
 * Card type flags extracted from card data
 */
export interface CardTypeInfo {
  isLand: boolean;
  isCreature: boolean;
  isPlaneswalker: boolean;
  isArtifact: boolean;
  isEnchantment: boolean;
  isInstant: boolean;
  isSorcery: boolean;
  isBattle: boolean;
}

/**
 * Checks if a card's types match a given filter
 */
export function cardMatchesFilter(card: CardInstance, filter: HandCardFilter): boolean {
  const types = getCardTypeInfo(card);
  
  switch (filter) {
    case "any":
      return true;
      
    case "nonland":
      return !types.isLand;
      
    case "creature":
      return types.isCreature;
      
    case "planeswalker":
      return types.isPlaneswalker;
      
    case "creature_or_planeswalker":
      return types.isCreature || types.isPlaneswalker;
      
    case "artifact":
      return types.isArtifact;
      
    case "enchantment":
      return types.isEnchantment;
      
    case "instant":
      return types.isInstant;
      
    case "sorcery":
      return types.isSorcery;
      
    case "instant_or_sorcery":
      return types.isInstant || types.isSorcery;
      
    case "noncreature":
      return !types.isCreature;
      
    case "nonplaneswalker":
      return !types.isPlaneswalker;
      
    default:
      return false;
  }
}

/**
 * Extracts type information from a card instance
 */
export function getCardTypeInfo(card: CardInstance): CardTypeInfo {
  // Get type line from cardData (ScryfallCard)
  const cardData = card.cardData;
  const typeLine = cardData?.type_line || "";
  const lowerTypeLine = typeLine.toLowerCase();
  
  return {
    isLand: lowerTypeLine.includes("land") || lowerTypeLine.includes("basic"),
    isCreature: lowerTypeLine.includes("creature"),
    isPlaneswalker: lowerTypeLine.includes("planeswalker"),
    isArtifact: lowerTypeLine.includes("artifact"),
    isEnchantment: lowerTypeLine.includes("enchantment"),
    isInstant: lowerTypeLine.includes("instant"),
    isSorcery: lowerTypeLine.includes("sorcery"),
    isBattle: lowerTypeLine.includes("battle"),
  };
}

/**
 * Filters hand cards based on the specified filter
 */
export function filterHandCards(
  hand: CardInstance[],
  filter: HandCardFilter
): FilterResult {
  const matchingCards: CardInstance[] = [];
  const nonMatchingCards: CardInstance[] = [];
  
  for (const card of hand) {
    if (cardMatchesFilter(card, filter)) {
      matchingCards.push(card);
    } else {
      nonMatchingCards.push(card);
    }
  }
  
  return {
    matchingCards,
    nonMatchingCards,
    hasMatches: matchingCards.length > 0,
  };
}

/**
 * Gets the filter string for common hand-targeting cards
 */
export function getHandFilterForCard(cardName: string): HandCardFilter | null {
  const normalizedName = cardName.toLowerCase();
  
  // Duress: target noncreature, nonplaneswalker, nonland (sorcery, instant, enchantment, artifact)
  if (normalizedName.includes("duress")) {
    return "nonland"; // Simplified - targets nonland cards
  }
  
  // Thoughtseize: target nonland
  if (normalizedName.includes("thoughtseize")) {
    return "nonland";
  }
  
  // Inquisition of Kozilek: target creature or planeswalker
  if (normalizedName.includes("inquisition")) {
    return "creature_or_planeswalker";
  }
  
  // Other hand disruption cards
  if (normalizedName.includes(" despises") || normalizedName.includes("coerc")) {
    return "any";
  }
  
  return null;
}

/**
 * Maps filter names to display-friendly descriptions
 */
export function getFilterDescription(filter: HandCardFilter): string {
  switch (filter) {
    case "any":
      return "any card";
    case "nonland":
      return "nonland card";
    case "creature":
      return "creature";
    case "planeswalker":
      return "planeswalker";
    case "creature_or_planeswalker":
      return "creature or planeswalker";
    case "artifact":
      return "artifact";
    case "enchantment":
      return "enchantment";
    case "instant":
      return "instant";
    case "sorcery":
      return "sorcery";
    case "instant_or_sorcery":
      return "instant or sorcery";
    case "noncreature":
      return "noncreature";
    case "nonplaneswalker":
      return "nonplaneswalker";
    default:
      return filter;
  }
}

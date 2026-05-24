/**
 * Targeting Validation System
 *
 * Implements CR 702.16 (Protection), CR 702.11 (Hexproof), CR 702.18 (Shroud)
 * for validating target合法性 during spell casting and ability activation.
 *
 * Issue #857: Protection/hexproof targeting validation (CR 702.16)
 */

import type {
  CardInstance,
  CardInstanceId,
  PlayerId,
  GameState,
} from "./types";

/**
 * Result of target validation
 */
export interface TargetValidationResult {
  valid: boolean;
  reason?: string;
  message?: string;
}

/**
 * Check if a card has shroud (can't be targeted at all)
 * CR 702.18: "Hexproof and Shroud" - Shroud prevents all targeting
 * Uses word boundary to avoid matching "unshroud" or similar words
 */
export function hasShroud(card: CardInstance): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  // Use word boundary to match only the word "shroud" not "unshroud", "SGROUD", etc.
  const shroudRegex = /\bshroud\b/i;
  return shroudRegex.test(oracleText);
}

/**
 * Check if a card has protection from a specific color
 * CR 702.16: Protection from a color means:
 * - Can't be targeted by spells/abilities of that color
 * - Can't be enchanted by Auras of that color
 * - Deals no damage to blockers of that color
 * - Can't be blocked by creatures of that color
 */
export function hasProtectionFromColor(
  card: CardInstance,
  color: string,
): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  const colorLower = color.toLowerCase();

  // Match "protection from X" and "protection from X and Y" patterns
  // Example: "protection from red and blue" -> extracts ["red", "blue"]
  const protectionRegex = /protection from\s+([\w]+(?:\s+and\s+[\w]+)?)/gi;
  let match;

  while ((match = protectionRegex.exec(oracleText)) !== null) {
    const qualityPart = match[1].toLowerCase();
    const parts = qualityPart.split(/\s+and\s+/);
    for (const part of parts) {
      const trimmed = part.trim().toLowerCase();
      if (
        trimmed === colorLower ||
        normalizeColor(trimmed) === normalizeColor(colorLower)
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Get all qualities a card has protection from
 * Returns array of colors/quality types
 */
export function getProtectionQualities(card: CardInstance): string[] {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  const qualities: string[] = [];

  // Match "protection from X" or "protection from X and Y"
  const protectionRegex = /protection from\s+([\w]+(?:\s+and\s+[\w]+)?)/gi;
  let match;

  while ((match = protectionRegex.exec(oracleText)) !== null) {
    const parts = match[1].split(/\s+and\s+/);
    for (const part of parts) {
      const trimmed = part.trim().toLowerCase();
      if (isValidProtectionQuality(trimmed)) {
        qualities.push(trimmed);
      }
    }
  }

  return qualities;
}

/**
 * Check if a quality string is a valid MTG protection quality
 * Colors: white, blue, black, red, green
 * Other: protection from "colored" artifacts, protection from X mana
 */
function isValidProtectionQuality(quality: string): boolean {
  const validColors = ["white", "blue", "black", "red", "green"];
  return validColors.includes(quality);
}

/**
 * Get the colors of a card from its cardData
 * Handles bothsymbol formats (W, U, B, R, G) and full names
 */
export function getCardColors(card: CardInstance): string[] {
  return card.cardData.colors || [];
}

/**
 * Normalize a color to standard MTG format
 */
function normalizeColor(color: string): string {
  const colorMap: Record<string, string> = {
    w: "white",
    white: "white",
    u: "blue",
    blue: "blue",
    b: "black",
    black: "black",
    r: "red",
    red: "red",
    g: "green",
    green: "green",
  };
  return colorMap[color.toLowerCase()] || color.toLowerCase();
}

/**
 * Check if a target is protected from a source based on protection keywords
 * CR 702.16A: Can't be targeted by spells/abilities with the given quality
 */
export function isProtectedFromSource(
  target: CardInstance,
  source: CardInstance,
): boolean {
  const targetQualities = getProtectionQualities(target);
  if (targetQualities.length === 0) return false;

  const sourceColors = getCardColors(source);

  // Check if source has any color that the target is protected from
  for (const color of sourceColors) {
    const normalized = normalizeColor(color);
    if (targetQualities.some((q) => q.toLowerCase() === normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a card has hexproof from a specific controller
 * CR 702.11: Hexproof - Can't be targeted by opponents
 */
export function hasHexproof(card: CardInstance): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  return oracleText.includes("hexproof");
}

/**
 * Check if a target is protected by hexproof from a source controller
 * CR 702.11A: Can't be targeted by opponents' spells/abilities
 */
export function isProtectedByHexproof(
  target: CardInstance,
  sourceControllerId: PlayerId,
): boolean {
  if (!hasHexproof(target)) return false;
  return target.controllerId !== sourceControllerId;
}

/**
 * Validate if a spell can legally target a card
 * Combines protection, hexproof, and shroud checks
 *
 * CR 702.16A: Protection prevents targeting by spells/abilities with the given quality
 * CR 702.11A: Hexproof prevents targeting by opponents
 * CR 702.18A: Shroud prevents all targeting
 */
export function canTargetCard(
  target: CardInstance,
  source: CardInstance,
  sourceControllerId: PlayerId,
): TargetValidationResult {
  // CR 702.18: Shroud prevents all targeting
  if (hasShroud(target)) {
    return {
      valid: false,
      reason: "shroud",
      message: `${target.cardData.name} has shroud and cannot be targeted.`,
    };
  }

  // CR 702.11: Hexproof - can't be targeted by opponents
  if (isProtectedByHexproof(target, sourceControllerId)) {
    return {
      valid: false,
      reason: "hexproof",
      message: `${target.cardData.name} has hexproof and cannot be targeted by opponents.`,
    };
  }

  // CR 702.16: Protection from color - can't be targeted by spells of that color
  if (isProtectedFromSource(target, source)) {
    const targetQualities = getProtectionQualities(target);
    return {
      valid: false,
      reason: "protection",
      message: `${target.cardData.name} has protection from ${targetQualities.join(", ")} and cannot be targeted.`,
    };
  }

  return { valid: true };
}

/**
 * Validate if a spell can legally target a player
 * Players don't have protection/hexproof/shroud (those are permanents only)
 * but we include this for completeness and future expansion
 */
export function canTargetPlayer(
  _targetPlayerId: PlayerId,
  _sourceControllerId: PlayerId,
): TargetValidationResult {
  // Currently no player-protecting effects in MTG
  // Future expansion could include "can't be targeted by opponents" effects
  return { valid: true };
}

/**
 * Validate all targets for a spell or ability
 * Returns validation result for the first invalid target found
 */
export function validateSpellTargets(
  state: GameState,
  sourceCardId: CardInstanceId,
  targetIds: CardInstanceId[],
): TargetValidationResult {
  const source = state.cards.get(sourceCardId);
  if (!source) {
    return {
      valid: false,
      reason: "source_not_found",
      message: "Source card not found.",
    };
  }

  for (const targetId of targetIds) {
    const target = state.cards.get(targetId);
    if (!target) continue; // Skip if card not found

    const result = canTargetCard(target, source, source.controllerId);
    if (!result.valid) {
      return result;
    }
  }

  return { valid: true };
}

/**
 * Get a description of all targeting restrictions on a card
 * Useful for UI display of why a card can't be targeted
 */
export function getTargetingRestrictions(card: CardInstance): string[] {
  const restrictions: string[] = [];
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";

  if (oracleText.includes("shroud")) {
    restrictions.push("Shroud (can't be targeted)");
  }

  if (oracleText.includes("hexproof")) {
    restrictions.push("Hexproof (can't be targeted by opponents)");
  }

  const protections = getProtectionQualities(card);
  for (const quality of protections) {
    restrictions.push(`Protection from ${quality}`);
  }

  return restrictions;
}

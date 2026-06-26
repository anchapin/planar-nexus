/**
 * Targeting Validation System
 *
 * Implements CR 702.16 (Protection), CR 702.11 (Hexproof), CR 702.18 (Shroud),
 * and CR 702.21 (Ward) for validating target合法性 during spell casting and
 * ability activation.
 *
 * Issue #857: Protection/hexproof targeting validation (CR 702.16)
 * Issue #970: Wire ward cost payment into targeting validation (CR 702.21)
 */

import type {
  CardInstance,
  CardInstanceId,
  PlayerId,
  GameState,
} from "./types";
import {
  hasWard,
  getWardCost,
  isProtectedByWard,
} from "./evergreen-keywords";
import { parseWardCostString, type WardCostDescriptor } from "./ward-system";

/**
 * A ward payment requirement surfaced by targeting validation.
 *
 * Ward (CR 702.21) does NOT prevent targeting — the target is legal, but the
 * casting player must pay the listed cost (or decline) before the spell/ability
 * resolves, otherwise it is countered. This descriptor hands the requirement
 * off to the cost-payment flow (see `payWardCost` / `createWardPaymentChoice`
 * in ward-system.ts).
 */
export interface WardRequirement {
  /** The warded permanent that was targeted. */
  targetCardId: CardInstanceId;
  /** Controller of the warded permanent (an opponent of the caster). */
  wardControllerId: PlayerId;
  /** The cost the caster must pay to stop the spell/ability from being countered. */
  cost: WardCostDescriptor;
}

/**
 * Result of target validation
 */
export interface TargetValidationResult {
  valid: boolean;
  reason?: string;
  message?: string;
  /**
   * Ward payment requirement for a single-target check (CR 702.21).
   * Present when `canTargetCard` detects an opposing warded permanent.
   * Targeting is still `valid` — ward is a payment trigger, not a hard block.
   */
  wardRequired?: WardRequirement;
  /**
   * All ward requirements collected across a multi-target spell. Populated by
   * `validateSpellTargets` so the casting flow can present one payment choice
   * per warded target (each must be paid or the whole spell is countered).
   */
  wardRequirements?: WardRequirement[];
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
 * Combines protection, hexproof, shroud, and ward checks
 *
 * CR 702.16A: Protection prevents targeting by spells/abilities with the given quality
 * CR 702.11A: Hexproof prevents targeting by opponents
 * CR 702.18A: Shroud prevents all targeting
 * CR 702.21:  Ward does NOT prevent targeting — the target is legal, but a ward
 *             payment is required. If unpaid at resolution, the spell/ability
 *             is countered. The requirement is returned via `wardRequired`.
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

  // CR 702.21: Ward — targeting is LEGAL, but a payment is required. Unlike
  // shroud/hexproof/protection, ward does not block the target selection; it
  // triggers a cost the caster must pay or the spell/ability will be countered
  // on resolution. We surface the requirement so the casting/payment flow can
  // present the choice (see ward-system.ts `payWardCost`).
  if (isProtectedByWard(target, sourceControllerId)) {
    const cost = parseWardCostString(getWardCost(target));
    if (cost) {
      return {
        valid: true,
        wardRequired: {
          targetCardId: target.id,
          wardControllerId: target.controllerId,
          cost,
        },
      };
    }
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
 *
 * Returns the validation result for the first invalid (illegal) target found.
 * If every target is legal but one or more carry a ward requirement (CR
 * 702.21), the result is `valid: true` with `wardRequirements` populated so the
 * caller can drive the ward payment flow (one choice per warded target).
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

  const wardRequirements: WardRequirement[] = [];

  for (const targetId of targetIds) {
    const target = state.cards.get(targetId);
    if (!target) continue; // Skip if card not found

    const result = canTargetCard(target, source, source.controllerId);
    if (!result.valid) {
      return result;
    }
    if (result.wardRequired) {
      wardRequirements.push(result.wardRequired);
    }
  }

  if (wardRequirements.length > 0) {
    return { valid: true, wardRequirements };
  }

  return { valid: true };
}

/**
 * Collect every ward payment requirement (CR 702.21) raised by a spell or
 * ability's targets. Returns an empty array when no target triggers ward.
 *
 * Convenience wrapper around `validateSpellTargets` for callers (spell-casting
 * flow, AI) that only care about ward payments. Each requirement can be handed
 * directly to `payWardCost` / `createWardPaymentChoice` in ward-system.ts.
 */
export function getWardRequirements(
  state: GameState,
  sourceCardId: CardInstanceId,
  targetIds: CardInstanceId[],
): WardRequirement[] {
  const result = validateSpellTargets(state, sourceCardId, targetIds);
  return result.wardRequirements ?? [];
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

  // CR 702.21: Ward is surfaced as a payment requirement, not a hard block —
  // the card CAN be targeted, but the caster must pay the ward cost or the
  // spell/ability is countered.
  if (hasWard(card)) {
    const costStr = getWardCost(card);
    restrictions.push(
      costStr
        ? `Ward ${costStr} (targeting costs ${costStr} or spell is countered)`
        : "Ward (targeting may cost mana or the spell is countered)",
    );
  }

  return restrictions;
}

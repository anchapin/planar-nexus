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
import { hasWard, getWardCost, isProtectedByWard } from "./evergreen-keywords";
import { hasHexproofStrict } from "./keyword-actions/hexproof";
import { hasShroudStrict } from "./keyword-actions/shroud";
import { oracleTextDeclaresOwnKeyword } from "./keyword-actions/grant-negation";
import { getProtectionQualitiesStrict } from "./keyword-actions/protection";
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
 * CR 702.18a: "A permanent with shroud can't be the target of spells or
 * abilities."
 *
 * Detection: defer to `hasShroudStrict` (parsed-keywords only, canonical
 * contract — see `keyword-actions/shroud.ts`); fall back to a word-bound
 * regex on the oracle text only when the strict check returns false, so
 * cards whose `keywords` array is missing the tag still resolve correctly.
 *
 * Issue #2336: before this, the strict check was absent and the oracle
 * text was the *only* source consulted. That produced a genuine false
 * negative in the live targeting pipeline — a permanent carrying
 * `keywords: ["Shroud"]`, or one that gained shroud through a
 * layer-applied continuous-effect grant, but whose oracle text does not
 * literally contain the word "Shroud", was treated as targetable. This
 * mirrors the hexproof strict-first shape applied in #2322 and brings
 * targeting-validation into contract parity with `evergreen-keywords.hasShroud`.
 *
 * Note the word boundary in the fallback avoids matching "unshroud",
 * "shrouded", or similar stems.
 *
 * Issue #2348: that hand-rolled anchored regex is now the shared
 * `oracleTextDeclaresOwnKeyword` helper, which also rejects grant/negation
 * phrases — "This creature loses shroud." is not shroud, and
 * `evergreen-keywords.hasShroud` now agrees. The two copies had drifted: the
 * evergreen copy fell back to the unanchored `hasKeyword` helper and read
 * "This creature is unshrouded." / "Shrouding the temple." / "Enshrouded in
 * mist." as shroud while this copy correctly rejected all three.
 */
export function hasShroud(card: CardInstance): boolean {
  if (hasShroudStrict(card)) {
    return true;
  }
  return oracleTextDeclaresOwnKeyword(
    "shroud",
    card.cardData.oracle_text ?? "",
  );
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
 * Returns array of colors/quality types.
 *
 * Defer to `getProtectionQualitiesStrict` (parsed-keywords only, canonical
 * contract — see `keyword-actions/protection.ts`); fall back to the
 * oracle-text regex only when the strict check returns empty, so cards
 * whose `keywords` array is missing the tag still resolve correctly. This
 * mirrors the ward/hexproof pattern.
 */
export function getProtectionQualities(card: CardInstance): string[] {
  const strict = getProtectionQualitiesStrict(card);
  if (strict.length > 0) {
    return strict;
  }
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
 * Check if a card has hexproof.
 * CR 702.11: Hexproof - Can't be targeted by opponents.
 *
 * Detection: defer to `hasHexproofStrict` (parsed-keywords only, canonical
 * contract — see `keyword-actions/hexproof.ts`); fall back to the shared
 * `oracleTextDeclaresOwnKeyword` helper only when the strict check returns
 * false, so cards whose `keywords` array is missing the tag still resolve
 * correctly. This mirrors the flash/defender/ward pattern and brings
 * targeting-validation into contract parity with `evergreen-keywords.hasHexproof`.
 *
 * Issue #2348: the fallback previously accepted a bare anchored match, so
 * "Other creatures you control have hexproof." read as hexproof and made a card
 * that only *grants* hexproof wrongly untargetable.
 */
export function hasHexproof(card: CardInstance): boolean {
  if (hasHexproofStrict(card)) {
    return true;
  }
  return oracleTextDeclaresOwnKeyword(
    "hexproof",
    card.cardData.oracle_text ?? "",
  );
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
  // No raw `oracleText` local: #2336 removed the shroud substring check and
  // #2348 removed the hexproof one, so this function no longer reads the
  // oracle text directly — every line below goes through a strict-first gate.

  // Issue #2336: use the strict-first `hasShroud` rather than a bare
  // `oracleText.includes("shroud")` substring, so a permanent that carries
  // parsed-keyword shroud (or gained it from a continuous effect) is
  // reported to the UI instead of silently omitted, and an oracle text that
  // merely mentions shroud in a non-keyword context is not mislabelled.
  if (hasShroud(card)) {
    restrictions.push("Shroud (can't be targeted)");
  }

  // Issue #2348: the hexproof half was missed by #2336 and still used a raw
  // unanchored `oracleText.includes("hexproof")`, so the UI mislabelled
  // "Other creatures you control have hexproof." and "Loses hexproof." as
  // hexproof. It now uses the same strict-first `hasHexproof` as the shroud
  // line above.
  if (hasHexproof(card)) {
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

/**
 * Spell targeting (CR 115): target legality, valid-target enumeration, validation.
 *
 * Mechanically extracted from spell-casting.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, PlayerId, StackObject, Target, WaitingChoice, ChoiceOption } from '../types';
import { canTargetKeyword } from '../evergreen-keywords';

/**
 * Check if a spell/ability can be targeted
 * CR 702.11 (Hexproof), CR 702.16 (Protection), CR 702.18 (Shroud)
 */
export function canTarget(
  targetType: Target["type"],
  targetId: string,
  state: GameState,
  sourcePlayerId: PlayerId,
  effectColor?: string,
): { canTarget: boolean; reason?: string } {
  switch (targetType) {
    case "card": {
      // Check if card exists
      const card = state.cards.get(targetId);
      if (!card) return { canTarget: false, reason: "Card not found" };

      // Check hexproof, shroud, and protection targeting restrictions
      const targetingResult = canTargetKeyword(
        card,
        sourcePlayerId,
        effectColor,
      );
      if (!targetingResult.canTarget) {
        return targetingResult;
      }

      return { canTarget: true };
    }
    case "player": {
      // Check if player exists
      const player = state.players.get(targetId);
      if (!player) return { canTarget: false, reason: "Player not found" };
      return { canTarget: true };
    }
    case "stack": {
      // Check if target stack object exists
      const exists = state.stack.some((obj) => obj.id === targetId);
      return {
        canTarget: exists,
        reason: exists ? undefined : "Stack object not found",
      };
    }
    case "zone": {
      // Check if zone exists
      const exists = state.zones.has(targetId);
      return {
        canTarget: exists,
        reason: exists ? undefined : "Zone not found",
      };
    }
    default:
      return { canTarget: false, reason: "Invalid target type" };
  }
}

/**
 * Create a waiting choice for spell targeting
 */
export function createTargetingChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  targetType: Target["type"],
  validTargets: ChoiceOption[],
): WaitingChoice {
  return {
    type: "choose_targets",
    playerId,
    stackObjectId,
    prompt: `Choose target ${targetType} for ${spellName}:`,
    choices: validTargets,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Get valid targets for a spell based on its text
 */
export function getValidTargets(
  _stackObjectId: string,
  _state: GameState,
  _playerId: PlayerId,
): ChoiceOption[] {
  // For now, return empty array
  // In a full implementation, this would parse the spell's text
  // to determine what kinds of targets are valid
  return [];
}

/**
 * Check if all required targets for a spell are valid
 */
export function validateSpellTargets(
  stackObject: StackObject,
  _state: GameState,
): boolean {
  // If no targets required, spell is valid
  if (stackObject.targets.length === 0) {
    return true;
  }

  // Check all targets are valid
  for (const target of stackObject.targets) {
    if (!target.isValid) {
      return false;
    }
  }

  return true;
}


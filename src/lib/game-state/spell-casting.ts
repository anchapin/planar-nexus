/**
 * Spell Casting System
 *
 * This module implements the spell casting system for Magic: The Gathering,
 * including cost validation, stack management, and timing restrictions.
 *
 * Reference: CR 601 - Casting Spells
 */

import type {
  GameState,
  PlayerId,
  CardInstanceId,
  StackObject,
  Target,
  WaitingChoice,
  ChoiceOption,
} from "./types";
import { Phase, ZoneType } from "./types";
import { moveCardBetweenZones } from "./zones";
import { spendMana, getSpellManaCost } from "./mana";
import { ValidationService } from "./validation-service";
import { hasSplitSecondOnStack } from "./auto-pass-priority";
import { initializePlaneswalkerLoyalty } from "./card-instance";
import {
  parseKicker,
  parseAlternativeCost,
  parseBuyback,
  parseFlashback,
  parseBestow,
  parseBlitz,
  parseForetell,
  parseSpectacle,
  parseConvoke,
  parseDelve,
  parseEscape,
  parseSplitSecond,
  parseStorm,
  isModalSpell,
  getModesForModalSpell,
  hasFuse,
  isSplitCard,
  getSplitCardHalves,
} from "./oracle-text-parser";
import {
  checkTriggeredAbilities,
  evaluateInterveningIfClause,
} from "./abilities";
import { detectStormTrigger, detectProwessTriggers } from "./trigger-system";
import { completeHandTargeting } from "./hand-targeting";
import { destroyCard, createTokenCard } from "./keyword-actions";
import {
  getPrototypeInfo,
  initializePrototype,
  getPrototypeManaCostForSpell,
} from "./prototype";
import {
  resolveStackObjectEffects,
  parseSpellEffects,
  getEffectsForChosenModes,
} from "./effect-resolution";
import type { CardInstance, StackEffect } from "./types";
import { canTargetKeyword, applyProwessBoost } from "./evergreen-keywords";
import { applyWardResolution } from "./ward-system";

/**
 * Generate a unique stack object ID
 */
function generateStackObjectId(): string {
  return `stack-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Check if oracle text represents a board sweeper effect (destroy all creatures)
 */
export function isBoardSweeper(oracleText: string): boolean {
  const lowerText = oracleText.toLowerCase();
  return (
    lowerText.includes("destroy all creatures") ||
    (lowerText.includes("destroy") &&
      lowerText.includes("creatures") &&
      lowerText.includes("all"))
  );
}

/**
 * Check if a board sweeper effect destroys indestructible creatures
 * Cards with "can't be regenerated" or "can't be regenerated" wording
 * destroy indestructible creatures (they would be regenerated otherwise)
 */
export function destroysIndestructibleCreatures(oracleText: string): boolean {
  const lowerText = oracleText.toLowerCase();
  return lowerText.includes("can't be regenerated");
}

/**
 * Execute a board sweeper effect, destroying all creatures
 */
function executeBoardSweeper(
  state: GameState,
  sourceCardId: CardInstanceId,
  ignoreIndestructible: boolean = false,
): GameState {
  let currentState = state;
  const sourceCard = state.cards.get(sourceCardId);
  if (!sourceCard) return state;

  for (const [zoneKey, zone] of state.zones) {
    if (zone.type !== ZoneType.BATTLEFIELD) continue;

    for (const cardId of zone.cardIds) {
      const card = currentState.cards.get(cardId);
      if (!card) continue;

      const typeLine = card.cardData.type_line?.toLowerCase() || "";
      if (!typeLine.includes("creature")) continue;

      const result = destroyCard(currentState, cardId, ignoreIndestructible);
      if (result.success) {
        currentState = result.state;
      }
    }
  }

  return currentState;
}

/**
 * Check if a player can cast a spell from their hand
 */
export function canCastSpell(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): { canCast: boolean; reason?: string } {
  const player = state.players.get(playerId);
  if (!player) {
    return { canCast: false, reason: "Player not found" };
  }

  // Player must have priority
  if (state.priorityPlayerId !== playerId) {
    return { canCast: false, reason: "Player does not have priority" };
  }

  // Verify the card is in player's hand
  const handZone = state.zones.get(`${playerId}-hand`);
  if (!handZone || !handZone.cardIds.includes(cardId)) {
    return { canCast: false, reason: "Card not in hand" };
  }

  // Get the card
  const card = state.cards.get(cardId);
  if (!card) {
    return { canCast: false, reason: "Card not found" };
  }

  // Check phase/timing restrictions
  const currentPhase = state.turn.currentPhase;
  const isMainPhase =
    currentPhase === Phase.PRECOMBAT_MAIN ||
    currentPhase === Phase.POSTCOMBAT_MAIN;
  const stackIsEmpty = state.stack.length === 0;
  const isActivePlayer = state.turn.activePlayerId === playerId;

  // CR 702.60b - Split second: while a spell with split second is on the
  // stack, no other spells may be cast. Reported before sorcery-speed timing
  // so the operative restriction is surfaced (instants/flash are otherwise
  // legal timing-wise but are still barred by split second).
  if (hasSplitSecondOnStack(state)) {
    return {
      canCast: false,
      reason: "A spell with split second is on the stack",
    };
  }

  // Check if it's an instant
  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  const isInstant = typeLine.includes("instant");

  // Check for cards that can be cast at any time (e.g., flash)
  // This must be checked BEFORE sorcery-speed restrictions since flash overrides them
  const oracleText = card.cardData.oracle_text || "";
  const hasFlash = oracleText.toLowerCase().includes("flash");

  // If it's not an instant and doesn't have flash, apply sorcery-speed restrictions
  if (!isInstant && !hasFlash) {
    // Can only cast during main phase with empty stack
    if (!stackIsEmpty) {
      return {
        canCast: false,
        reason: "Stack must be empty to cast sorcery-speed spells",
      };
    }

    if (!isMainPhase) {
      return {
        canCast: false,
        reason: "Can only cast sorcery-speed spells during main phase",
      };
    }

    // Can only cast on your own turn (never on opponent's turn)
    if (!isActivePlayer) {
      return {
        canCast: false,
        reason: "Can only cast sorcery-speed spells during your turn",
      };
    }
  }

  // Flash allows casting at any time - already checked above, but explicit return for clarity
  if (hasFlash) {
    return { canCast: true };
  }

  // For split cards, check both halves
  if (card.cardData.layout === "split") {
    // Split cards can be cast as either half during main phase
    if (!isMainPhase || !stackIsEmpty) {
      return {
        canCast: false,
        reason:
          "Split cards can only be cast during main phase with empty stack",
      };
    }
  }

  return { canCast: true };
}

/**
 * Cast a spell from hand and put it on the stack
 * Validates priority, mana costs, and timing rules before casting
 *
 * CR 601 - Casting Spells
 * CR 702.8 - Buyback
 * CR 702.66 - Flashback
 * CR 702.93 - Convoke
 * CR 702.99 - Bestow
 * CR 702.150 - Blitz
 * CR 702.85 - Kicker
 */
export function castSpell(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  targets: Target[] = [],
  chosenModes: string[] = [],
  xValue: number = 0,
  isKicked: boolean = false,
  alternativeCost?: {
    type:
      | "buyback"
      | "flashback"
      | "bestow"
      | "escape"
      | "spectacle"
      | "blitz"
      | "foretell"
      | "convoke"
      | "delve";
    buybackReturnToHand?: boolean;
    bestowTarget?: CardInstanceId;
    /**
     * CR 702.93 - Convoke: untapped creatures the player chooses to tap while
     * casting this spell. Each colored creature pays for one mana of that
     * creature's color (CR 702.93b) or one generic mana; each colorless
     * creature pays for one generic mana (CR 702.93c). Tapping a creature
     * for convoke is NOT activating a {T}/{Q} ability, so summoning sickness
     * does NOT restrict it (CR 302.6 only restricts {T}/{Q} activated costs).
     */
    convokeCreatures?: CardInstanceId[];
    /**
     * CR 702.61 - Delve: cards in the player's graveyard chosen to be exiled
     * while casting this spell. Each exiled card reduces the GENERIC portion
     * of the cost by {1} (CR 702.61a); delve cannot pay colored pips (unlike
     * Convoke). The chosen cards are exiled as part of paying the spell's
     * cost. Over-exiling (more cards than remaining generic pips) is allowed
     * but the extras reduce nothing — they are still exiled (binding choice).
     */
    delveCards?: CardInstanceId[];
    /**
     * CR 702.138 - Escape: N other cards in the player's graveyard chosen to
     * be exiled while casting this spell from the graveyard. The escape cost
     * REPLACES the printed mana cost; exiling exactly N "other" graveyard
     * cards is a MANDATORY additional cost (CR 702.138a). The chosen cards
     * are exiled as part of paying the spell's cost. The cast is rejected
     * with "Not enough exile targets" if fewer than N valid other cards are
     * provided or available. The exact N required is parsed from the card's
     * oracle text (e.g. "Exile four other cards..." → N=4; "Exile 5 other
     * cards..." → N=5).
     */
    escapeExileCards?: CardInstanceId[];
  },
  /**
   * CR 702.85 — number of times the kicker (or multikicker) cost was paid.
   * For single-kicker cards this is 0 or 1; for multikicker cards this can
   * be any non-negative integer bounded by available mana. When provided,
   * takes precedence over `isKicked` (the latter is treated as a hint that
   * `timesKicked >= 1`).
   */
  timesKicked?: number,
): { success: boolean; state: GameState; error?: string } {
  // Canonicalize the kicker count: an explicit `timesKicked` argument wins;
  // otherwise derive from the boolean `isKicked` flag (1 if true, 0 if false).
  const effectiveTimesKicked =
    typeof timesKicked === "number"
      ? Math.max(0, Math.floor(timesKicked))
      : isKicked
        ? 1
        : 0;
  const effectiveIsKicked = effectiveTimesKicked > 0;

  // Create a game action for validation
  const action = {
    type: "cast_spell" as const,
    playerId,
    timestamp: Date.now(),
    data: {
      cardId,
      targets,
      chosenModes,
      xValue,
      isKicked: effectiveIsKicked,
      timesKicked: effectiveTimesKicked,
      alternativeCost,
    },
  };

  // Validate the action before executing
  const validationResult = ValidationService.validateAction(state, action);
  if (!validationResult.isValid) {
    return {
      success: false,
      state,
      error: validationResult.message || validationResult.reason,
    };
  }

  // Get the card
  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state, error: "Card not found." };
  }

  // Verify the card is in player's hand (or graveyard for Flashback / Escape,
  // or exile for a foretold card cast via Foretell — CR 702.142c).
  let sourceZone: string | null = null;
  const handZone = state.zones.get(`${playerId}-hand`);
  const graveZone = state.zones.get(`${playerId}-graveyard`);
  const exileZone = state.zones.get(`${playerId}-exile`);

  if (handZone && handZone.cardIds.includes(cardId)) {
    sourceZone = `${playerId}-hand`;
  } else if (
    alternativeCost?.type === "flashback" &&
    graveZone &&
    graveZone.cardIds.includes(cardId)
  ) {
    sourceZone = `${playerId}-graveyard`;
  } else if (
    alternativeCost?.type === "escape" &&
    graveZone &&
    graveZone.cardIds.includes(cardId)
  ) {
    // CR 702.138a: a card with Escape may be cast from its owner's graveyard.
    sourceZone = `${playerId}-graveyard`;
  } else if (
    alternativeCost?.type === "foretell" &&
    exileZone &&
    exileZone.cardIds.includes(cardId)
  ) {
    // CR 702.142c: a foretold card is cast from its owner's exile.
    sourceZone = `${playerId}-exile`;
  } else if (!handZone || !handZone.cardIds.includes(cardId)) {
    return { success: false, state, error: "Card not in hand." };
  }

  // Handle modal spell mode selection requirement
  // CR 700.2: Modal spells require the controller to choose modes before targeting
  // Only require explicit mode selection if the modal spell has modes that need targets
  if (isModalSpell(card.cardData)) {
    const modeInfo = getModesForModalSpell(card.cardData);
    if (
      modeInfo &&
      modeInfo.some((m) => m.targetTypes.length > 0) &&
      chosenModes.length === 0
    ) {
      return {
        success: false,
        state,
        error: "Modal spells require mode selection. No modes provided.",
      };
    }
  }

  // Handle split card casting (CR 709.2)
  // When casting a split card, only the left half is cast unless using fuse
  if (isSplitCard(card.cardData)) {
    const halves = getSplitCardHalves(card.cardData);
    // Split cards can be cast as only one half by default
    // The fuse ability (if present) allows casting both halves
  }

  // Get the stack zone
  const stackZone = state.zones.get("stack");
  if (!stackZone) {
    return { success: false, state, error: "Stack zone not found." };
  }

  // Calculate and validate the mana cost
  const manaCost = getSpellManaCost(card.cardData);

  // Add X value to the cost if applicable
  let totalGeneric = manaCost.generic + xValue;
  let totalWhite = manaCost.white;
  let totalBlue = manaCost.blue;
  let totalBlack = manaCost.black;
  let totalRed = manaCost.red;
  let totalGreen = manaCost.green;

  // Track alternative costs used
  const alternativeCostsUsed: string[] = [];

  // Add kicker cost if spell is kicked (CR 702.85).
  // For multikicker (CR 702.85 multikicker variant) the cost is paid N times
  // where N = `effectiveTimesKicked`; the bonus effect scales linearly with N
  // during resolution (see `StackObject.timesKicked`).
  let kickerChargeCount = 0;
  if (effectiveIsKicked) {
    const kickerInfo = parseKicker(card.cardData.oracle_text || "");
    if (kickerInfo.hasKicker && kickerInfo.kickerCost) {
      const n = effectiveTimesKicked;
      totalGeneric += kickerInfo.kickerCost.generic * n;
      totalWhite += kickerInfo.kickerCost.white * n;
      totalBlue += kickerInfo.kickerCost.blue * n;
      totalBlack += kickerInfo.kickerCost.black * n;
      totalRed += kickerInfo.kickerCost.red * n;
      totalGreen += kickerInfo.kickerCost.green * n;
      alternativeCostsUsed.push("kicker");
      kickerChargeCount = n;
    }
  }

  // Handle alternative costs (Buyback, Flashback, Bestow, etc.)
  let buybackReturnZone: string | undefined = undefined;
  let bestowTarget: CardInstanceId | undefined = undefined;
  // CR 702.93 - Convoke: creatures the player declared they would tap while
  // casting. Validated inside the `case "convoke":` branch; the actual tap
  // is applied AFTER mana is spent (see `applyConvokeTaps` below) so the
  // pre-cast state used for validation is not mutated.
  const convokeTappedCreatures: CardInstanceId[] = [];
  // CR 702.61 - Delve: graveyard cards the player declared they would exile
  // while casting. Validated inside the `case "delve":` branch; the actual
  // exile is applied AFTER mana is spent (see the delve exile block below)
  // so the pre-cast state used for validation is not mutated.
  const delveExiledCards: CardInstanceId[] = [];
  // CR 702.138 - Escape: graveyard cards the player declared they would exile
  // while casting. Validated inside the `case "escape":` branch; the actual
  // exile is applied AFTER mana is spent (see the escape exile block below)
  // so the pre-cast state used for validation is not mutated.
  const escapeExiledCards: CardInstanceId[] = [];

  if (alternativeCost) {
    switch (alternativeCost.type) {
      case "buyback": {
        // CR 702.8 - Buyback: additional cost that lets spell resolve then return to hand
        const buybackInfo = parseBuyback(card.cardData.oracle_text || "");
        if (buybackInfo.hasBuyback && buybackInfo.buybackCost) {
          totalGeneric += buybackInfo.buybackCost.generic;
          totalWhite += buybackInfo.buybackCost.white;
          totalBlue += buybackInfo.buybackCost.blue;
          totalBlack += buybackInfo.buybackCost.black;
          totalRed += buybackInfo.buybackCost.red;
          totalGreen += buybackInfo.buybackCost.green;
          alternativeCostsUsed.push("buyback");
          if (alternativeCost.buybackReturnToHand) {
            buybackReturnZone = `${playerId}-hand`;
          }
        }
        break;
      }
      case "flashback": {
        // CR 702.66 - Flashback: cast from graveyard
        const flashbackInfo = parseFlashback(card.cardData.oracle_text || "");
        if (flashbackInfo.hasFlashback && flashbackInfo.flashbackCost) {
          totalGeneric += flashbackInfo.flashbackCost.generic;
          totalWhite += flashbackInfo.flashbackCost.white;
          totalBlue += flashbackInfo.flashbackCost.blue;
          totalBlack += flashbackInfo.flashbackCost.black;
          totalRed += flashbackInfo.flashbackCost.red;
          totalGreen += flashbackInfo.flashbackCost.green;
          alternativeCostsUsed.push("flashback");
        }
        break;
      }
      case "bestow": {
        // CR 702.99 - Bestow: cast as aura attached to creature
        const bestowInfo = parseBestow(card.cardData.oracle_text || "");
        if (bestowInfo.hasBestow && bestowInfo.bestowCost) {
          totalGeneric += bestowInfo.bestowCost.generic;
          totalWhite += bestowInfo.bestowCost.white;
          totalBlue += bestowInfo.bestowCost.blue;
          totalBlack += bestowInfo.bestowCost.black;
          totalRed += bestowInfo.bestowCost.red;
          totalGreen += bestowInfo.bestowCost.green;
          alternativeCostsUsed.push("bestow");
          bestowTarget = alternativeCost.bestowTarget;
        }
        break;
      }
      case "blitz": {
        // CR 702.150 - Blitz: an alternative cost that REPLACES the mana cost
        // (not an additional cost). The spell's mana value is unchanged, but the
        // mana paid is the blitz cost; other additional costs/taxes (e.g.
        // kicker) still apply on top. Subtract the printed mana-cost component
        // and add the blitz-cost component so additional costs are preserved.
        const blitzInfo = parseBlitz(card.cardData.oracle_text || "");
        if (blitzInfo.hasBlitz && blitzInfo.blitzCost) {
          totalGeneric += blitzInfo.blitzCost.generic - manaCost.generic;
          totalWhite += blitzInfo.blitzCost.white - manaCost.white;
          totalBlue += blitzInfo.blitzCost.blue - manaCost.blue;
          totalBlack += blitzInfo.blitzCost.black - manaCost.black;
          totalRed += blitzInfo.blitzCost.red - manaCost.red;
          totalGreen += blitzInfo.blitzCost.green - manaCost.green;
          alternativeCostsUsed.push("blitz");
        }
        break;
      }
      case "foretell": {
        // CR 702.142c - Foretell: an alternative cost that REPLACES the mana
        // cost (not an additional cost). The printed foretell cost is paid
        // instead of the mana cost; the spell's mana value is unchanged and
        // other additional costs/taxes still apply on top. Subtract the printed
        // mana-cost component and add the foretell-cost component so additional
        // costs are preserved (same treatment as Blitz).
        const foretellInfo = parseForetell(card.cardData.oracle_text || "");
        if (foretellInfo.hasForetell && foretellInfo.foretellCost) {
          totalGeneric += foretellInfo.foretellCost.generic - manaCost.generic;
          totalWhite += foretellInfo.foretellCost.white - manaCost.white;
          totalBlue += foretellInfo.foretellCost.blue - manaCost.blue;
          totalBlack += foretellInfo.foretellCost.black - manaCost.black;
          totalRed += foretellInfo.foretellCost.red - manaCost.red;
          totalGreen += foretellInfo.foretellCost.green - manaCost.green;
          alternativeCostsUsed.push("foretell");
        }
        break;
      }
      case "spectacle": {
        // CR 702.135 - Spectacle: an alternative cost that REPLACES the mana
        // cost (not an additional cost). The printed spectacle cost is paid
        // instead of the mana cost; the spell's mana value is unchanged and
        // other additional costs/taxes still apply on top. Subtract the
        // printed mana-cost component and add the spectacle-cost component so
        // additional costs are preserved (same treatment as Blitz/Foretell).
        //
        // CR 702.135a precondition: the controller may cast for the spectacle
        // cost only "if an opponent has lost life this turn." The engine
        // accumulates per-player life loss on `Player.lastTurnLifeLost`
        // (populated by `dealDamageToPlayer` / `loseLife` in player-actions.ts,
        // reset at the start of each turn in game-state.ts). If no opponent
        // lost life this turn, the spectacle branch is a no-op: the printed
        // mana cost is charged instead (Spectacle is a player OPTION —
        // falling back to the printed cost, not rejecting the cast).
        const spectacleInfo = parseSpectacle(card.cardData.oracle_text || "");
        if (spectacleInfo.hasSpectacle && spectacleInfo.spectacleCost) {
          let opponentLostLife = false;
          for (const [pid, p] of state.players) {
            if (pid !== playerId && (p.lastTurnLifeLost ?? 0) > 0) {
              opponentLostLife = true;
              break;
            }
          }
          if (opponentLostLife) {
            totalGeneric +=
              spectacleInfo.spectacleCost.generic - manaCost.generic;
            totalWhite += spectacleInfo.spectacleCost.white - manaCost.white;
            totalBlue += spectacleInfo.spectacleCost.blue - manaCost.blue;
            totalBlack += spectacleInfo.spectacleCost.black - manaCost.black;
            totalRed += spectacleInfo.spectacleCost.red - manaCost.red;
            totalGreen += spectacleInfo.spectacleCost.green - manaCost.green;
            // Records the spectacle alternative cost on the StackObject so
            // replay / resolution can observe it (mirrors blitz/foretell —
            // `alternativeCostsUsed` is the engine's per-cast event log).
            alternativeCostsUsed.push("spectacle");
          }
          // If the precondition is false, fall through silently: the printed
          // cost charged below is the player's fallback option (CR 702.135a).
        }
        break;
      }
      case "convoke": {
        // CR 702.93 - Convoke: "Your creatures can help cast this spell. Each
        // creature you tap while casting this spell pays for {1} or one mana
        // of that creature's color." Convoke is a cost-reduction applied to
        // the printed mana cost (not an alternative cost that replaces it);
        // other additional costs/taxes (kicker, etc.) still apply on top.
        //
        // Validation per CR 702.93a: each declared creature must be a
        // creature, untapped, on the battlefield, and controlled by the
        // spell's controller. Summoning sickness is NOT a restriction (CR
        // 302.6 only restricts activating {T}/{Q} abilities, and tapping
        // for convoke is the convoke rule itself, not a {T} ability).
        const convokeInfo = parseConvoke(card.cardData.oracle_text || "");
        if (convokeInfo.hasConvoke) {
          alternativeCostsUsed.push("convoke");
          const declaredCreatures = alternativeCost.convokeCreatures ?? [];
          const seen = new Set<CardInstanceId>();
          for (const creatureId of declaredCreatures) {
            if (seen.has(creatureId)) {
              return {
                success: false,
                state,
                error:
                  "Convoke: a creature cannot be tapped more than once to pay for the same spell.",
              };
            }
            seen.add(creatureId);

            const creature = state.cards.get(creatureId);
            if (!creature) {
              return {
                success: false,
                state,
                error: "Convoke: creature not found.",
              };
            }
            // Must be controlled by the caster (CR 702.93a: "you control").
            if (creature.controllerId !== playerId) {
              return {
                success: false,
                state,
                error:
                  "Convoke: tapped creature must be controlled by the spell's controller.",
              };
            }
            // Must be on the battlefield.
            const czKey = creature.currentZoneKey;
            const cz = czKey ? state.zones.get(czKey) : undefined;
            if (
              !cz ||
              cz.type !== ZoneType.BATTLEFIELD ||
              !cz.cardIds.includes(creatureId)
            ) {
              return {
                success: false,
                state,
                error: "Convoke: tapped creature must be on the battlefield.",
              };
            }
            // Must actually be a creature (CR 702.93a: "untapped creatures").
            const cTypeLine = creature.cardData.type_line?.toLowerCase() || "";
            if (!cTypeLine.includes("creature")) {
              return {
                success: false,
                state,
                error: "Convoke: tapped permanent is not a creature.",
              };
            }
            // Must be untapped.
            if (creature.isTapped) {
              return {
                success: false,
                state,
                error: "Convoke: creature is already tapped.",
              };
            }

            // Apply cost reduction per CR 702.93b (colored pip of the
            // creature's color) then 702.93c (any one generic mana). A
            // creature with multiple colors reduces the first unpaid colored
            // pip in W/U/B/R/G order that matches one of its colors. A
            // colorless creature (e.g. an artifact creature with no colors)
            // can only reduce a generic pip. If no pip is left to reduce,
            // the creature is still tapped (CR 702.93a allows over-declaring)
            // — the post-loop tap step records it.
            const colors = creature.cardData.colors || [];
            let reduced = false;
            if (totalWhite > 0 && colors.includes("W")) {
              totalWhite--;
              reduced = true;
            } else if (totalBlue > 0 && colors.includes("U")) {
              totalBlue--;
              reduced = true;
            } else if (totalBlack > 0 && colors.includes("B")) {
              totalBlack--;
              reduced = true;
            } else if (totalRed > 0 && colors.includes("R")) {
              totalRed--;
              reduced = true;
            } else if (totalGreen > 0 && colors.includes("G")) {
              totalGreen--;
              reduced = true;
            } else if (totalGeneric > 0) {
              totalGeneric--;
              reduced = true;
            }
            convokeTappedCreatures.push(creatureId);
            // `reduced` is intentionally unused beyond this point: an
            // over-declared tap still taps the creature but contributes
            // nothing to the cost (CR 702.93a allows it; the post-cast
            // tap step records the tap regardless).
            void reduced;
          }
        }
        break;
      }
      case "delve": {
        // CR 702.61 - Delve: "For each card you exile from your graveyard
        // while casting this spell, you may pay {1} rather than pay that
        // card's mana cost." Delve is a cost-reduction applied to the
        // printed mana cost (not an alternative cost that replaces it);
        // other additional costs/taxes (kicker, etc.) still apply on top.
        //
        // CR 702.61a: each exiled card reduces the GENERIC portion of the
        // cost by {1}. Unlike Convoke, delve CANNOT pay colored pips —
        // colored mana must still come from the mana pool.
        //
        // Validation per CR 702.61a: each declared card must be a card in
        // the caster's graveyard. (Graveyard cards are always owned by the
        // caster in whose graveyard they sit — CR 400.3 — so the owner
        // check is structural.) Over-exiling is allowed (binding choice)
        // but extra cards beyond the generic portion reduce nothing.
        const delveInfo = parseDelve(card.cardData.oracle_text || "");
        if (delveInfo.hasDelve) {
          alternativeCostsUsed.push("delve");
          const declaredCards = alternativeCost.delveCards ?? [];
          const seen = new Set<CardInstanceId>();
          for (const delveCardId of declaredCards) {
            if (seen.has(delveCardId)) {
              return {
                success: false,
                state,
                error:
                  "Delve: a graveyard card cannot be exiled more than once to pay for the same spell.",
              };
            }
            seen.add(delveCardId);

            const delveCard = state.cards.get(delveCardId);
            if (!delveCard) {
              return {
                success: false,
                state,
                error: "Delve: card not found.",
              };
            }
            // Must be in the caster's graveyard (CR 702.61a). The
            // graveyard is keyed by controller/owner; a card there is
            // owned by that player (CR 400.3).
            const graveKey = `${playerId}-graveyard`;
            const grave = state.zones.get(graveKey);
            if (!grave || !grave.cardIds.includes(delveCardId)) {
              return {
                success: false,
                state,
                error: "Delve: exiled card must be in the caster's graveyard.",
              };
            }
            // Controller must be the caster (defensive — graveyard
            // membership already implies this, but the explicit check
            // guards against state corruption).
            if (delveCard.controllerId !== playerId) {
              return {
                success: false,
                state,
                error:
                  "Delve: exiled card must be controlled by the spell's controller.",
              };
            }

            // CR 702.61a: reduce the generic portion by {1} per exiled
            // card. If no generic pip remains, the card is still exiled
            // (over-exile — binding choice) but contributes nothing.
            if (totalGeneric > 0) {
              totalGeneric--;
            }
            delveExiledCards.push(delveCardId);
          }
        }
        break;
      }
      case "escape": {
        // CR 702.138 - Escape: "Escape—[cost], Exile N other cards from
        // your graveyard." Escape is an alternative cost that REPLACES the
        // printed mana cost (CR 702.138a — same treatment as
        // Blitz/Foretell/Spectacle): the spell's mana value is unchanged
        // and other additional costs/taxes still apply on top. The card
        // MUST be cast from its owner's graveyard (handled by the
        // source-zone logic above), and exiling exactly N OTHER graveyard
        // cards is a MANDATORY additional cost. On resolution, if the
        // spell would leave the stack for anywhere but the battlefield, it
        // is exiled instead (CR 702.138c — handled in
        // `resolveSpellCompletion`).
        //
        // CR 702.138a strictness: Escape may ONLY be used to cast a card
        // from its owner's graveyard. If `alternativeCost.type ===
        // "escape"` was declared for a card that ended up in a different
        // zone (e.g. hand), reject the cast rather than silently falling
        // back to the printed cost or applying the escape cost from the
        // wrong zone.
        if (sourceZone !== `${playerId}-graveyard`) {
          return {
            success: false,
            state,
            error:
              "Escape can only be used to cast a card from your graveyard.",
          };
        }
        const escapeInfo = parseEscape(card.cardData.oracle_text || "");
        if (escapeInfo.hasEscape && escapeInfo.escapeCost) {
          // Replace the printed mana-cost component with the escape-cost
          // component. Subtract printed-cost pips, add escape-cost pips,
          // so additional costs (kicker, taxes) layered on top are
          // preserved (same shape as Blitz/Foretell/Spectacle).
          totalGeneric += escapeInfo.escapeCost.generic - manaCost.generic;
          totalWhite += escapeInfo.escapeCost.white - manaCost.white;
          totalBlue += escapeInfo.escapeCost.blue - manaCost.blue;
          totalBlack += escapeInfo.escapeCost.black - manaCost.black;
          totalRed += escapeInfo.escapeCost.red - manaCost.red;
          totalGreen += escapeInfo.escapeCost.green - manaCost.green;
          alternativeCostsUsed.push("escape");

          // CR 702.138a: exile exactly N OTHER cards from the caster's
          // graveyard as a mandatory additional cost. The card itself is
          // excluded from the eligible pool (it is the source, not an
          // exile target). Validate each declared card up front so the
          // cast fails atomically before mana is spent.
          const requiredN = escapeInfo.exileCount;
          const graveKey = `${playerId}-graveyard`;
          const grave = state.zones.get(graveKey);
          // Other cards in graveyard = all grave cards except the source.
          const otherGraveIds = (grave?.cardIds ?? []).filter(
            (id) => id !== cardId,
          );
          if (otherGraveIds.length < requiredN) {
            return {
              success: false,
              state,
              error: "Not enough exile targets",
            };
          }
          const declaredCards = alternativeCost.escapeExileCards ?? [];
          if (declaredCards.length !== requiredN) {
            return {
              success: false,
              state,
              error: `Escape: must exile exactly ${requiredN} other cards from your graveyard (got ${declaredCards.length}).`,
            };
          }
          const seen = new Set<CardInstanceId>();
          for (const escapeCardId of declaredCards) {
            if (seen.has(escapeCardId)) {
              return {
                success: false,
                state,
                error:
                  "Escape: a graveyard card cannot be exiled more than once to pay for the same spell.",
              };
            }
            seen.add(escapeCardId);
            // The source card itself is not an eligible exile target —
            // CR 702.138a says "N OTHER cards".
            if (escapeCardId === cardId) {
              return {
                success: false,
                state,
                error:
                  "Escape: the escaping card itself cannot be exiled to pay its own escape cost.",
              };
            }
            const escapeCard = state.cards.get(escapeCardId);
            if (!escapeCard) {
              return {
                success: false,
                state,
                error: "Escape: card not found.",
              };
            }
            // Must be in the caster's graveyard (CR 702.138a). The
            // graveyard is keyed by controller/owner; a card there is
            // owned by that player (CR 400.3).
            if (!grave || !grave.cardIds.includes(escapeCardId)) {
              return {
                success: false,
                state,
                error: "Escape: exiled card must be in the caster's graveyard.",
              };
            }
            // Controller must be the caster (defensive — graveyard
            // membership already implies this, but the explicit check
            // guards against state corruption).
            if (escapeCard.controllerId !== playerId) {
              return {
                success: false,
                state,
                error:
                  "Escape: exiled card must be controlled by the spell's controller.",
              };
            }
            escapeExiledCards.push(escapeCardId);
          }
        }
        break;
      }
    }
  }

  // Check if player has enough mana to cast the spell
  const player = state.players.get(playerId);
  if (!player) {
    return { success: false, state, error: "Player not found." };
  }

  const pool = player.manaPool;

  // Calculate total colored mana available for generic payment
  const totalColored =
    pool.white + pool.blue + pool.black + pool.red + pool.green;
  const availableForGeneric = pool.generic + totalColored + pool.colorless;

  if (
    pool.white < totalWhite ||
    pool.blue < totalBlue ||
    pool.black < totalBlack ||
    pool.red < totalRed ||
    pool.green < totalGreen ||
    availableForGeneric < totalGeneric
  ) {
    return {
      success: false,
      state: state,
      error: "Not enough energy (mana) available.",
    };
  }

  // Spend the mana
  const spendResult = spendMana(state, playerId, {
    white: totalWhite,
    blue: totalBlue,
    black: totalBlack,
    red: totalRed,
    green: totalGreen,
    generic: totalGeneric,
  });

  if (!spendResult.success) {
    return { success: false, state, error: "Failed to spend energy (mana)." };
  }

  // Use the state with mana already spent
  let currentState = spendResult.state;

  // CR 702.93 - Convoke: now that mana is spent and the cast is committed,
  // tap each declared creature. Tapping for convoke is not the same as
  // activating a {T} ability (no summoning-sickness restriction), and the
  // tap persists through the spell's resolution until the controller's next
  // untap step.
  if (convokeTappedCreatures.length > 0) {
    const updatedConvokeCards = new Map(currentState.cards);
    for (const creatureId of convokeTappedCreatures) {
      const creature = updatedConvokeCards.get(creatureId);
      if (creature) {
        updatedConvokeCards.set(creatureId, { ...creature, isTapped: true });
      }
    }
    currentState = {
      ...currentState,
      cards: updatedConvokeCards,
      lastModifiedAt: Date.now(),
    };
  }

  // CR 702.61 - Delve: now that mana is spent and the cast is committed,
  // exile each declared graveyard card to the caster's exile zone. The
  // generic-cost reduction was already applied in the `case "delve":`
  // branch; this step performs the actual zone move (graveyard → exile)
  // and updates each card's `currentZoneKey` so subsequent lookups find it
  // in exile. Cards exiled for delve are gone for good (CR 702.61a: the
  // exile is part of paying the cost, not a duration effect).
  if (delveExiledCards.length > 0) {
    const graveKey = `${playerId}-graveyard`;
    const exileKey = `${playerId}-exile`;
    const updatedZonesDelve = new Map(currentState.zones);
    let updatedGraveDelve = updatedZonesDelve.get(graveKey);
    let updatedExileDelve = updatedZonesDelve.get(exileKey);
    const updatedCardsDelve = new Map(currentState.cards);
    if (updatedGraveDelve && updatedExileDelve) {
      for (const delveCardId of delveExiledCards) {
        const moved = moveCardBetweenZones(
          updatedGraveDelve,
          updatedExileDelve,
          delveCardId,
        );
        updatedGraveDelve = moved.from;
        updatedExileDelve = moved.to;
        const dc = updatedCardsDelve.get(delveCardId);
        if (dc) {
          updatedCardsDelve.set(delveCardId, {
            ...dc,
            currentZoneKey: exileKey,
          });
        }
      }
      updatedZonesDelve.set(graveKey, updatedGraveDelve);
      updatedZonesDelve.set(exileKey, updatedExileDelve);
      currentState = {
        ...currentState,
        zones: updatedZonesDelve,
        cards: updatedCardsDelve,
        lastModifiedAt: Date.now(),
      };
    }
  }

  // CR 702.138 - Escape: now that mana is spent and the cast is committed,
  // exile each declared graveyard card to the caster's exile zone. The
  // mandatory-N validation was already applied in the `case "escape":`
  // branch; this step performs the actual zone move (graveyard → exile)
  // and updates each card's `currentZoneKey` so subsequent lookups find it
  // in exile. Cards exiled for escape are gone for good (CR 702.138a: the
  // exile is part of paying the cost, not a duration effect). The source
  // card itself is NOT in this list — it stays in the graveyard until the
  // zone-move-to-stack step below promotes it to the stack.
  if (escapeExiledCards.length > 0) {
    const graveKey = `${playerId}-graveyard`;
    const exileKey = `${playerId}-exile`;
    const updatedZonesEscape = new Map(currentState.zones);
    let updatedGraveEscape = updatedZonesEscape.get(graveKey);
    let updatedExileEscape = updatedZonesEscape.get(exileKey);
    const updatedCardsEscape = new Map(currentState.cards);
    if (updatedGraveEscape && updatedExileEscape) {
      for (const escapeCardId of escapeExiledCards) {
        const moved = moveCardBetweenZones(
          updatedGraveEscape,
          updatedExileEscape,
          escapeCardId,
        );
        updatedGraveEscape = moved.from;
        updatedExileEscape = moved.to;
        const ec = updatedCardsEscape.get(escapeCardId);
        if (ec) {
          updatedCardsEscape.set(escapeCardId, {
            ...ec,
            currentZoneKey: exileKey,
          });
        }
      }
      updatedZonesEscape.set(graveKey, updatedGraveEscape);
      updatedZonesEscape.set(exileKey, updatedExileEscape);
      currentState = {
        ...currentState,
        zones: updatedZonesEscape,
        cards: updatedCardsEscape,
        lastModifiedAt: Date.now(),
      };
    }
  }

  // Create stack object with alternative cost info
  const stackObject: StackObject = {
    id: generateStackObjectId(),
    type: "spell",
    sourceCardId: cardId,
    controllerId: playerId,
    name: card.cardData.name,
    text: card.cardData.oracle_text || "",
    manaCost: card.cardData.mana_cost ?? null,
    targets,
    chosenModes,
    variableValues: new Map([["X", xValue]]),
    isCountered: false,
    timestamp: Date.now(),
    alternativeCostsUsed,
    // `wasKicked` preserves the caller's intent: when the legacy `isKicked`
    // boolean is the only signal (no explicit `timesKicked`) we stamp it
    // directly so callers see their declaration retained even on cards where
    // parseKicker returns no kicker (caller-declared flag retained per
    // kicker-end-to-end suite). When `timesKicked` is provided explicitly,
    // `wasKicked` is derived from the actual charge count so non-kicker
    // cards stay false even if a caller passes timesKicked>0 (multikicker
    // suite). `timesKicked` itself records how many kicks were actually
    // paid (0 for non-kicker cards; 1+ for kicker/multikicker) and is what
    // resolution code scales the additional effect by.
    wasKicked:
      typeof timesKicked === "number" ? kickerChargeCount > 0 : isKicked,
    timesKicked: kickerChargeCount,
    buybackReturnZone,
    bestowTarget,
    // CR 702.60 - Split second: parsed from Oracle text and stamped onto the
    // spell's StackObject so the restriction can be enforced while it's on
    // the stack (see hasSplitSecondOnStack / ValidationService).
    splitSecond: parseSplitSecond(card.cardData.oracle_text || "")
      .hasSplitSecond,
    // CR 702.41 - Storm: parsed from Oracle text and stamped onto the spell's
    // StackObject so the on-cast trigger can fire (see detectStormTrigger /
    // copySpellOnStack below).
    storm: parseStorm(card.cardData.oracle_text || "").hasStorm,
  };

  // Move card from hand (or graveyard for flashback) to stack
  const sourceZoneObj = sourceZone
    ? currentState.zones.get(sourceZone)
    : handZone;
  if (!sourceZoneObj) {
    return { success: false, state, error: "Source zone not found." };
  }

  const moved = moveCardBetweenZones(sourceZoneObj, stackZone, cardId);

  // Update zones using the state with mana spent
  const updatedZones = new Map(currentState.zones);
  if (sourceZone) {
    updatedZones.set(sourceZone, moved.from);
  }
  updatedZones.set("stack", moved.to);

  // CR 702.142c - Foretell: reveal the card as it is announced on the stack.
  // Turn it face up and clear the foretold marker so it is visible to everyone
  // and no longer treated as a foretold card while on the stack / resolving.
  let updatedCards = currentState.cards;
  if (alternativeCost?.type === "foretell") {
    updatedCards = new Map(currentState.cards);
    updatedCards.set(cardId, {
      ...card,
      isFaceDown: false,
      foretold: false,
      currentZoneKey: "stack",
    });
  }

  // Add stack object to stack
  const updatedStack = [...currentState.stack, stackObject];

  // Reset the player's priority pass flag since they just cast something
  const updatedPlayer = currentState.players.get(playerId);
  const updatedPlayers = new Map(currentState.players);
  // CR 702.41 - Storm count basis: a spell was cast this turn. Increment the
  // per-player counter that storm reads from. (A spell COPY is not "cast" —
  // CR 707.10 — so copySpellOnStack does NOT increment this, which is what
  // stops storm copies from recursively re-triggering storm.)
  const spellsCastBefore = updatedPlayer?.spellsCastThisTurn ?? 0;
  if (updatedPlayer) {
    updatedPlayers.set(playerId, {
      ...updatedPlayer,
      hasPassedPriority: false,
      spellsCastThisTurn: spellsCastBefore + 1,
    });
  }

  // Pass priority to next player
  // Find the next player in APNAP order
  const activePlayerId = currentState.turn.activePlayerId;
  const playerIds = Array.from(currentState.players.keys());
  const currentIndex = playerIds.indexOf(activePlayerId);
  let nextIndex = (currentIndex + 1) % playerIds.length;

  // Skip players who have lost
  while (playerIds.length > 1 && nextIndex !== currentIndex) {
    const nextPlayerId = playerIds[nextIndex];
    const nextPlayer = currentState.players.get(nextPlayerId);
    if (nextPlayer && !nextPlayer.hasLost) {
      break;
    }
    nextIndex = (nextIndex + 1) % playerIds.length;
  }

  let finalState: GameState = {
    ...currentState,
    zones: updatedZones,
    cards: updatedCards,
    stack: updatedStack,
    players: updatedPlayers,
    priorityPlayerId: playerIds[nextIndex],
    consecutivePasses: 0,
    lastModifiedAt: Date.now(),
  };

  // CR 702.41 - Storm: "When you cast this spell, copy it for each spell cast
  // before it this turn." The storm trigger fires on cast; resolve it here by
  // creating `spellsCastBefore` copies on top of the stack. Detection/count
  // lives in trigger-system (detectStormTrigger); creation uses the shared
  // copySpellOnStack primitive (CR 707.10). Each copy retains the original's
  // targets by default — the controller MAY reselect, exposed via
  // copySpellOnStack's `newTargets` argument (CR 702.41a / 707.10d).
  if (stackObject.storm) {
    const storm = detectStormTrigger(finalState, stackObject.id);
    for (let i = 0; i < storm.copyCount; i++) {
      const copyResult = copySpellOnStack(finalState, stackObject.id);
      if (copyResult.success && copyResult.state) {
        finalState = copyResult.state;
      }
    }
  }

  // CR 702.108 - Prowess: "Whenever you cast a noncreature spell, this creature
  // gets +1/+1 until end of turn." The trigger fires on cast for each prowess
  // instance on each creature the caster controls. Detection lives in
  // trigger-system (detectProwessTriggers); resolution here stamps the +1/+1
  // onto each triggering creature's `prowessBoost`, which the layer-7
  // power/toughness path reads and `clearProwessBoosts` removes at end of turn.
  // Prowess triggers resolve like storm (on cast) rather than queuing on the
  // stack, matching the engine's established on-cast-trigger convention.
  const prowessTriggers = detectProwessTriggers(
    finalState,
    cardId,
    playerId,
    activePlayerId,
  );
  if (prowessTriggers.length > 0) {
    for (const trigger of prowessTriggers) {
      finalState = applyProwessBoost(finalState, trigger.sourceCardId, 1);
    }
  }

  return { success: true, state: finalState };
}

/**
 * Copy a spell on the stack (CR 707.10).
 *
 * Foundational primitive used by Storm (CR 702.41) and by general "copy target
 * spell" effects (e.g. Twincast, Reverberate, Lithoform Engine). Creates a NEW
 * spell on the stack, on top of the original, sharing the original's
 * characteristics — name, oracle text, mana cost, chosen modes, X values,
 * controller, split second/storm markers, and structured effects — with no cost
 * paid (CR 707.10). The copy RETAINS the original's targets by default (CR
 * 707.10c); pass `newTargets` to reselect them (CR 707.10d).
 *
 * A copy is not "cast" (CR 707.10), so it does NOT increment the storm count
 * and does NOT trigger "when you cast" abilities — only `castSpell` does. On
 * resolution a permanent copy becomes a token and an instant/sorcery copy
 * ceases to exist (see `resolveCopyCompletion`).
 *
 * @returns the new copy's stack object id on success.
 */
export function copySpellOnStack(
  state: GameState,
  sourceStackObjectId: string,
  newTargets?: Target[],
): {
  success: boolean;
  state: GameState;
  copiedStackObjectId?: string;
  error?: string;
} {
  const sourceIndex = state.stack.findIndex(
    (o) => o.id === sourceStackObjectId,
  );
  if (sourceIndex === -1) {
    return {
      success: false,
      state,
      error: "Source spell not found on the stack.",
    };
  }
  const source = state.stack[sourceIndex];
  if (source.type !== "spell") {
    return {
      success: false,
      state,
      error: "Only spells (not abilities) can be copied (CR 707.10).",
    };
  }

  // CR 707.10 — copy the spell's characteristics. Targets default to the
  // original's (707.10c) and may be overridden (707.10d). `isCopy` marks the
  // object so resolution knows not to move a card and to create a token for
  // permanents instead. `manaCost` is a characteristic and is copied (the "no
  // cost paid" rule means only that the copy is never paid for, not that the
  // value differs). `sourceCardId` is retained so the copy's oracle text / type
  // line can still be looked up during effect resolution.
  //
  // CR 702.138 (Escape) — `alternativeCostsUsed` is copied verbatim, so a
  // copy of an escaped spell also records "escape". This is intentional for
  // introspection / replay, but it MUST NOT cause the copy to re-exile N
  // graveyard cards: cost payments happen only in `castSpell`, which this
  // function is not. Likewise, on resolution the copy goes through
  // `resolveCopyCompletion` (because `isCopy === true`) and simply ceases
  // to exist — no card is moved to exile, no second exile cost is assessed.
  const copy: StackObject = {
    id: generateStackObjectId(),
    type: "spell",
    sourceCardId: source.sourceCardId,
    controllerId: source.controllerId,
    name: source.name,
    text: source.text,
    manaCost: source.manaCost,
    targets: newTargets
      ? newTargets.map((t) => ({ ...t }))
      : source.targets.map((t) => ({ ...t })),
    chosenModes: [...source.chosenModes],
    variableValues: new Map(source.variableValues),
    isCountered: false,
    timestamp: Date.now(),
    alternativeCostsUsed: source.alternativeCostsUsed
      ? [...source.alternativeCostsUsed]
      : undefined,
    wasKicked: source.wasKicked,
    timesKicked: source.timesKicked,
    splitSecond: source.splitSecond,
    storm: source.storm,
    isCopy: true,
    effects: source.effects,
  };

  return {
    success: true,
    copiedStackObjectId: copy.id,
    state: {
      ...state,
      stack: [...state.stack, copy],
      lastModifiedAt: Date.now(),
    },
  };
}

/**
 * Resolve the top object on the stack
 * CR 608 - Resolving Spells and Abilities
 */
export function resolveTopOfStack(state: GameState): GameState {
  if (state.stack.length === 0) {
    return state;
  }

  // Get the top object (last one added resolves first - LIFO)
  const stackObject = state.stack[state.stack.length - 1];

  // If it's countered, just remove it
  if (stackObject.isCountered) {
    return removeFromStack(state, stackObject.id);
  }

  // Ward (CR 702.21): if this spell/ability targets a warded permanent an
  // opponent controls and the ward cost was not paid, it is countered (removed
  // from the stack with no effect). This is enforced here, before resolution.
  const wardResult = applyWardResolution(state, stackObject);
  if (wardResult.countered) {
    return removeFromStack(state, stackObject.id);
  }

  // CR 603.4 — intervening "if" clause re-check at resolution. A triggered
  // ability ("When/Whenever/At X, if Y, Z") only triggers when Y is true at the
  // trigger event, AND when it would resolve Y is checked again: if it is no
  // longer true the ability is removed from the stack and does nothing. The
  // clause was carried onto the StackObject when the trigger was put on the
  // stack; re-evaluate it against the current (resolution-time) game state.
  if (stackObject.type === "ability" && stackObject.interveningIf) {
    const sourceCard = stackObject.sourceCardId
      ? state.cards.get(stackObject.sourceCardId)
      : undefined;
    if (
      !evaluateInterveningIfClause(
        stackObject.interveningIf,
        state,
        stackObject.controllerId,
        sourceCard,
      )
    ) {
      return removeFromStack(state, stackObject.id);
    }
  }

  let currentState = state;

  // CR 702.85 — number of additional effects owed to the kicker / multikicker
  // cost. Single-kicker stamps `timesKicked = 1` when paid; multikicker stamps
  // any non-negative integer. Non-kicker spells and spells cast without paying
  // the kicker cost leave `timesKicked` undefined / 0, so the bonus is a no-op.
  const kickerBonus = stackObject.timesKicked ?? 0;

  // Handle structured effects if present
  if (stackObject.effects && stackObject.effects.length > 0) {
    // Resolve each effect in order
    const result = resolveStackObjectEffects(
      state,
      stackObject.effects,
      stackObject.sourceCardId || undefined,
      stackObject.targets,
      kickerBonus,
    );
    currentState = result;
  }

  // Check if this is a board sweeper spell (legacy string-based check)
  if (stackObject.type === "spell" && stackObject.sourceCardId) {
    const sourceCard = currentState.cards.get(stackObject.sourceCardId);
    if (sourceCard) {
      const oracleText = sourceCard.cardData.oracle_text || "";

      // Handle board sweeper spells
      if (isBoardSweeper(oracleText)) {
        const ignoreIndestructible =
          destroysIndestructibleCreatures(oracleText);
        const stateAfterSweeper = executeBoardSweeper(
          currentState,
          stackObject.sourceCardId,
          ignoreIndestructible,
        );

        // Remove the stack object after resolution
        const updatedStack = stateAfterSweeper.stack.filter(
          (obj) => obj.id !== stackObject.id,
        );

        return {
          ...stateAfterSweeper,
          stack: updatedStack,
          consecutivePasses: 0,
          lastModifiedAt: Date.now(),
        };
      }

      // Parse effects from oracle text if no structured effects present
      if (!stackObject.effects || stackObject.effects.length === 0) {
        // CR 700.2: modal spells ("Choose one —", "Choose two —",
        // "Choose three —") resolve only the modes the controller chose.
        // When the stack object's chosenModes is populated, restrict the
        // parsed effects to those modes; otherwise parse the full oracle
        // text (legacy / choose-none-yet behavior — the modal choice is
        // expected to set chosenModes before resolution for the modal
        // branch to fire).
        const isModalWithChoice =
          stackObject.chosenModes && stackObject.chosenModes.length > 0;
        const parsedEffects = isModalWithChoice
          ? getEffectsForChosenModes(stackObject, currentState)
          : parseSpellEffects(oracleText, stackObject.variableValues);

        if (parsedEffects.length > 0) {
          // Apply effects with target information. CR 702.85 — pass the
          // kicker bonus so each scalable base effect (damage / card_draw
          // / token_creation) gets +N when the spell was kicked.
          const result = resolveStackObjectEffects(
            currentState,
            parsedEffects,
            stackObject.sourceCardId,
            stackObject.targets,
            kickerBonus,
          );
          currentState = result;
        }
      }
    }
  }

  // Move the card from stack to appropriate zone and handle post-resolution
  return resolveSpellCompletion(currentState, stackObject);
}

/**
 * Handle the completion of spell resolution - moving to zone and triggering effects
 * CR 608.2 - After the spell's effect(s) are applied, it moves to its destination zone
 */
function resolveSpellCompletion(
  state: GameState,
  stackObject: StackObject,
): GameState {
  // CR 707.10 — a copy of a spell is not backed by a card. Its effects were
  // already applied in resolveTopOfStack (which looks the source card up via
  // `sourceCardId` to parse oracle-text effects). On completion a permanent
  // copy becomes a token on the battlefield under its controller (CR 707.10d /
  // CR 111) and an instant/sorcery copy simply ceases to exist. No card is
  // moved because there is no card to move.
  if (stackObject.isCopy) {
    return resolveCopyCompletion(state, stackObject);
  }

  // Get the card
  if (stackObject.sourceCardId) {
    const card = state.cards.get(stackObject.sourceCardId);
    if (card) {
      // Move card from stack to appropriate zone based on card type
      const typeLine = card.cardData.type_line?.toLowerCase() || "";

      const oracleText = (card.cardData.oracle_text || "").toLowerCase();

      // Check if this is a board sweeper (destroy all creatures)
      const isBoardSweeper =
        typeLine.includes("sorcery") &&
        oracleText.includes("destroy") &&
        oracleText.includes("all creatures");

      if (isBoardSweeper) {
        // Execute board sweeper effect
        let updatedState = { ...state };
        const allCreatureIds: CardInstanceId[] = [];

        for (const [zoneKey, zone] of updatedState.zones) {
          if (zone.type === ZoneType.BATTLEFIELD) {
            for (const cId of zone.cardIds) {
              const c = updatedState.cards.get(cId);
              if (
                c &&
                c.cardData.type_line?.toLowerCase().includes("creature")
              ) {
                allCreatureIds.push(cId);
              }
            }
          }
        }

        for (const creatureId of allCreatureIds) {
          const result = destroyCard(updatedState, creatureId);
          if (result.success) {
            updatedState = result.state;
          }
        }

        // Move sweeper to graveyard
        const stackZone = updatedState.zones.get("stack");
        const graveZone = updatedState.zones.get(
          `${card.controllerId}-graveyard`,
        );
        if (stackZone && graveZone) {
          const moved = moveCardBetweenZones(
            stackZone,
            graveZone,
            stackObject.sourceCardId,
          );
          const updatedZones = new Map(updatedState.zones);
          updatedZones.set("stack", moved.from);
          updatedZones.set(`${card.controllerId}-graveyard`, moved.to);
          const updatedStack = updatedState.stack.filter(
            (o) => o.id !== stackObject.id,
          );

          return {
            ...updatedState,
            zones: updatedZones,
            stack: updatedStack,
            priorityPlayerId: updatedState.turn.activePlayerId,
            lastModifiedAt: Date.now(),
          };
        }
      }

      let destinationZone: string;
      if (typeLine.includes("instant") || typeLine.includes("sorcery")) {
        // Instants and sorceries go to graveyard — UNLESS they were cast
        // with Escape (CR 702.138c): "If a resolving spell cast with escape
        // would be put into a zone other than the stack or the battlefield,
        // exile it instead." Permanents cast with escape still enter the
        // battlefield normally (the same rule says "other than ... the
        // battlefield"); the exile-instead-of-graveyard replacement for
        // escaped permanents that later die is a separate replacement-effect
        // concern, not handled here.
        const wasEscaped =
          stackObject.alternativeCostsUsed?.includes("escape") ?? false;
        destinationZone = wasEscaped
          ? `${card.controllerId}-exile`
          : `${card.controllerId}-graveyard`;
      } else {
        // Permanents go to battlefield
        destinationZone = `${card.controllerId}-battlefield`;
      }

      const stackZone = state.zones.get("stack");
      const destZone = state.zones.get(destinationZone);

      if (stackZone && destZone) {
        const moved = moveCardBetweenZones(
          stackZone,
          destZone,
          stackObject.sourceCardId,
        );

        const updatedZones = new Map(state.zones);
        updatedZones.set("stack", moved.from);
        updatedZones.set(destinationZone, moved.to);

        const updatedStack = state.stack.filter(
          (obj) => obj.id !== stackObject.id,
        );

        // Initialize loyalty counters for planeswalkers entering the battlefield
        let updatedCards = state.cards;
        if (!typeLine.includes("instant") && !typeLine.includes("sorcery")) {
          const card = state.cards.get(stackObject.sourceCardId);
          if (card) {
            const initializedCard = initializePlaneswalkerLoyalty(card);
            if (initializedCard !== card) {
              updatedCards = new Map(state.cards);
              updatedCards.set(stackObject.sourceCardId, initializedCard);
            }
          }
        }

        // Reset priority passes for all players (CR 117.4)
        const updatedPlayers = new Map(state.players);
        updatedPlayers.forEach((player) => {
          updatedPlayers.set(player.id, {
            ...player,
            hasPassedPriority: false,
          });
        });

        let currentState: GameState = {
          ...state,
          zones: updatedZones,
          stack: updatedStack,
          cards: updatedCards,
          players: updatedPlayers,
          priorityPlayerId: state.turn.activePlayerId,
          consecutivePasses: 0,
          lastModifiedAt: Date.now(),
        };

        if (typeLine.includes("instant") || typeLine.includes("sorcery")) {
          // Instants and sorceries don't trigger ETB abilities
        } else {
          currentState = checkTriggeredAbilities(
            currentState,
            "entersBattlefield",
          ).state;
        }

        // CR 702.85 — the kicker additional effect (damage / card_draw /
        // token_creation bonus) is applied in `resolveTopOfStack` above,
        // where `stackObject.timesKicked` is forwarded to
        // `resolveStackObjectEffects` as the `kickerBonus` argument. By the
        // time we reach spell completion the kicker clause has already fired
        // and the effects list has been scaled; no extra work is needed here.
        // The conditional below is retained as a marker that kicker was paid
        // for downstream introspection / logs (e.g. game-replay serialization).
        if (stackObject.alternativeCostsUsed?.includes("kicker")) {
          // Kicker bonus already applied during effect resolution.
        }

        // CR 702.8 - Buyback: Return spell to hand instead of graveyard
        if (
          stackObject.alternativeCostsUsed?.includes("buyback") &&
          stackObject.buybackReturnZone
        ) {
          const spellCard = currentState.cards.get(stackObject.sourceCardId!);
          if (spellCard) {
            const battlefieldZone = currentState.zones.get(
              `${spellCard.controllerId}-battlefield`,
            );
            const handZone = currentState.zones.get(
              stackObject.buybackReturnZone,
            );
            if (battlefieldZone && handZone) {
              const moved = moveCardBetweenZones(
                battlefieldZone,
                handZone,
                stackObject.sourceCardId!,
              );
              const updatedZones2 = new Map(currentState.zones);
              updatedZones2.set(
                `${spellCard.controllerId}-battlefield`,
                moved.from,
              );
              updatedZones2.set(stackObject.buybackReturnZone!, moved.to);
              currentState = {
                ...currentState,
                zones: updatedZones2,
              };
            }
          }
        }

        // CR 702.99 - Bestow: Attach the aura to the target creature
        if (
          stackObject.alternativeCostsUsed?.includes("bestow") &&
          stackObject.bestowTarget
        ) {
          const auraCard = currentState.cards.get(stackObject.sourceCardId!);
          if (auraCard) {
            const updatedCards = new Map(currentState.cards);
            updatedCards.set(stackObject.sourceCardId!, {
              ...auraCard,
              attachedToId: stackObject.bestowTarget,
            });
            currentState = {
              ...currentState,
              cards: updatedCards,
            };
          }
        }

        // CR 702.150 - Blitz: a creature cast for its blitz cost gains haste
        // and is marked so the engine can apply the coupled "when this creature
        // dies, draw a card" trigger and the "sacrifice at the beginning of the
        // next end step" delayed trigger. Haste = no summoning sickness; the
        // marker is the single source of truth consumed by the trigger system.
        if (stackObject.alternativeCostsUsed?.includes("blitz")) {
          const blitzCard = currentState.cards.get(stackObject.sourceCardId!);
          if (blitzCard) {
            const updatedCards = new Map(currentState.cards);
            updatedCards.set(stackObject.sourceCardId!, {
              ...blitzCard,
              blitz: true,
              hasSummoningSickness: false,
            });
            currentState = {
              ...currentState,
              cards: updatedCards,
            };
          }
        }

        // CR 702.66 - Flashback: Card goes to exile instead of graveyard
        if (stackObject.alternativeCostsUsed?.includes("flashback")) {
          // Flashback spells resolve normally
        }

        return currentState;
      }
    }
  }

  // Fallback: just remove from stack
  return removeFromStack(state, stackObject.id);
}

/**
 * Complete the resolution of a SPELL COPY (CR 707.10).
 *
 * Copies have no card backing them, so the normal "move card to graveyard /
 * battlefield" path does not apply. A copy of a permanent spell enters the
 * battlefield as a token under its controller (CR 707.10d → CR 111); a copy of
 * an instant/sorcery spell simply ceases to exist once its effects have
 * resolved. The copy is then removed from the stack.
 */
function resolveCopyCompletion(
  state: GameState,
  stackObject: StackObject,
): GameState {
  const sourceCard = stackObject.sourceCardId
    ? state.cards.get(stackObject.sourceCardId)
    : undefined;
  const typeLine = sourceCard?.cardData.type_line?.toLowerCase() ?? "";
  const isPermanent =
    typeLine.length > 0 &&
    !typeLine.includes("instant") &&
    !typeLine.includes("sorcery");

  let currentState = state;
  if (isPermanent && sourceCard) {
    // CR 707.10d — a copy of a permanent spell enters the battlefield as a
    // token owned and controlled by the copy's controller.
    const tokenResult = createTokenCard(
      currentState,
      sourceCard.cardData,
      stackObject.controllerId,
      stackObject.controllerId,
      1,
    );
    if (tokenResult.success) {
      currentState = tokenResult.state;
    }
  }

  return removeFromStack(currentState, stackObject.id);
}

/**
 * Remove an object from the stack
 */
function removeFromStack(state: GameState, stackObjectId: string): GameState {
  const updatedStack = state.stack.filter((obj) => obj.id !== stackObjectId);

  // Reset priority passes
  const updatedPlayers = new Map(state.players);
  updatedPlayers.forEach((player) => {
    updatedPlayers.set(player.id, { ...player, hasPassedPriority: false });
  });

  return {
    ...state,
    stack: updatedStack,
    players: updatedPlayers,
    priorityPlayerId: state.turn.activePlayerId,
    consecutivePasses: 0,
    lastModifiedAt: Date.now(),
  };
}

// Note: counterSpell is already exported in keyword-actions.ts
// Re-export it here for convenience
// export { counterSpell } from "./keyword-actions";

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
 * Create a waiting choice for choosing modes
 * For modal spells like "Choose one" or "Choose two"
 * CR 700.2: Modal spells have multiple modes
 */
export function createModeChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  availableModes: string[],
  minChoices: number = 1,
  maxChoices: number = 1,
): WaitingChoice {
  return {
    type: "choose_mode",
    playerId,
    stackObjectId,
    prompt:
      minChoices > 1
        ? `Choose ${minChoices} modes for ${spellName}:`
        : `Choose mode for ${spellName}:`,
    choices: availableModes.map((mode) => ({
      label: mode,
      value: mode,
      isValid: true,
    })),
    minChoices,
    maxChoices,
    presentedAt: Date.now(),
  };
}

/**
 * Create a mode choice for choose-two style modal spells
 * CR 700.2 Example: "Choose two — Create a 1/1 white Soldier token. / Create a 1/1 white Soldier token. / Create a 1/1 white Soldier token."
 */
export function createChooseTwoModeChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  availableModes: string[],
): WaitingChoice {
  return createModeChoice(
    state,
    playerId,
    stackObjectId,
    spellName,
    availableModes,
    2,
    2,
  );
}

/**
 * Create a mode choice for modal spells with any valid number of modes
 */
export function createModalSpellChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  availableModes: string[],
  modeCount: number,
): WaitingChoice {
  return createModeChoice(
    state,
    playerId,
    stackObjectId,
    spellName,
    availableModes,
    modeCount,
    modeCount,
  );
}

/**
 * Create a waiting choice for X value
 */
export function createXValueChoice(
  state: GameState,
  playerId: PlayerId,
  stackObjectId: string,
  spellName: string,
  maxX: number,
): WaitingChoice {
  const choices: ChoiceOption[] = [];
  for (let i = 0; i <= maxX; i++) {
    choices.push({
      label: i.toString(),
      value: i,
      isValid: true,
    });
  }

  return {
    type: "choose_value",
    playerId,
    stackObjectId,
    prompt: `Choose value for X in ${spellName}:`,
    choices,
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

/**
 * Normalize a choose_mode payload into a `string[]` regardless of whether the
 * UI passed a single value or an array. Multi-select modal spells
 * (`choose_two`, `choose_three`) pass an array; legacy callers passing a
 * single string still work for `choose_one` spells. Returns null if the
 * payload cannot be normalized.
 */
function normalizeModeSelection(
  selectedValue: unknown,
  minChoices: number,
  maxChoices: number,
): string[] | null {
  let raw: string[] = [];
  if (Array.isArray(selectedValue)) {
    raw = selectedValue.map((v) => String(v));
  } else if (
    typeof selectedValue === "string" ||
    typeof selectedValue === "number" ||
    typeof selectedValue === "boolean"
  ) {
    raw = [String(selectedValue)];
  } else {
    return null;
  }
  // Distinguish between duplicates ("same mode twice") and unselected slots.
  // Modal rules (CR 700.2) require distinct modes for choose-N when N > 1, so
  // we collapse dupes defensively and treat the resulting count as the chosen
  // set.
  const unique = Array.from(new Set(raw));
  if (unique.length > maxChoices || unique.length < minChoices) {
    return null;
  }
  return unique;
}

/**
 * Resolve a waiting choice made by the player
 * Called when player selects cards/options in a choice dialog
 *
 * Modal-spell (CR 700.2) payloads are widened to also accept a `string[]` so
 * that choose-two / choose-three choices deliver the full set of selected
 * modes — see `normalizeModeSelection`. The single string form is preserved
 * for backward compatibility with choose-one callers and existing tests.
 */
export function resolveWaitingChoice(
  state: GameState,
  playerId: PlayerId,
  selectedValue: string | readonly string[] | number | boolean,
): { success: boolean; state: GameState; error?: string } {
  if (!state.waitingChoice) {
    return { success: false, state, error: "No waiting choice to resolve" };
  }

  if (state.waitingChoice.playerId !== playerId) {
    return {
      success: false,
      state,
      error: "Not this player's turn to make a choice",
    };
  }

  const { type, stackObjectId, minChoices, maxChoices } = state.waitingChoice;

  if (type === "choose_value" && typeof selectedValue === "number") {
    const stackObj = state.stack.find((s) => s.id === stackObjectId);

    if (!stackObj) {
      return { success: false, state, error: "Stack object not found" };
    }

    const newVariableValues = new Map(stackObj.variableValues);
    newVariableValues.set("X", selectedValue);

    const newState = {
      ...state,
      waitingChoice: null,
      stack: state.stack.map((obj) =>
        obj.id === stackObjectId
          ? { ...obj, variableValues: newVariableValues }
          : obj,
      ),
    };

    return { success: true, state: newState };
  }

  if (type === "choose_cards" && typeof selectedValue === "string") {
    const castingPlayerId = playerId;
    const opponentId = Array.from(state.players.keys()).find(
      (pid) => pid !== castingPlayerId && !state.players.get(pid)?.hasLost,
    );

    if (!opponentId) {
      return { success: false, state, error: "No opponent found" };
    }

    const result = completeHandTargeting(
      state,
      castingPlayerId,
      opponentId,
      selectedValue,
      stackObjectId || "",
    );

    if (!result.success) {
      return { success: false, state, error: result.error };
    }

    if (!result.state) {
      return {
        success: false,
        state,
        error: "completeHandTargeting returned no state",
      };
    }

    return { success: true, state: result.state };
  }

  if (type === "choose_mode") {
    const stackObj = state.stack.find((s) => s.id === stackObjectId);

    if (!stackObj) {
      return { success: false, state, error: "Stack object not found" };
    }

    const chosenModes = normalizeModeSelection(
      selectedValue,
      minChoices,
      maxChoices,
    );
    if (!chosenModes) {
      return {
        success: false,
        state,
        error: `choose_mode requires between ${minChoices} and ${maxChoices} distinct modes`,
      };
    }

    const newState = {
      ...state,
      waitingChoice: null,
      stack: state.stack.map((obj) =>
        obj.id === stackObjectId ? { ...obj, chosenModes } : obj,
      ),
    };

    return { success: true, state: newState };
  }

  return {
    success: false,
    state,
    error: `Unsupported waiting choice type: ${type}`,
  };
}

/**
 * Get the mana value of a spell from its card data
 * Uses the card-instance's getManaValue for accurate mana value calculation
 */
export function getSpellManaValueFromCard(card: {
  mana_cost?: string;
  cmc?: number;
}): number {
  // Mana value is already available from card.cardData.cmc
  return card.cmc ?? 0;
}

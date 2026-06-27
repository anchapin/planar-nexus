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
  parseSplitSecond,
  parseStorm,
  isModalSpell,
  getModesForModalSpell,
  hasFuse,
  isSplitCard,
  getSplitCardHalves,
} from "./oracle-text-parser";
import { checkTriggeredAbilities } from "./abilities";
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
      | "foretell";
    buybackReturnToHand?: boolean;
    bestowTarget?: CardInstanceId;
  },
): { success: boolean; state: GameState; error?: string } {
  // Create a game action for validation
  const action = {
    type: "cast_spell" as const,
    playerId,
    timestamp: Date.now(),
    data: { cardId, targets, chosenModes, xValue, isKicked, alternativeCost },
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

  // Verify the card is in player's hand (or graveyard for Flashback, or exile
  // for a foretold card cast via Foretell — CR 702.142c).
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

  // Add kicker cost if spell is kicked (CR 702.85)
  if (isKicked) {
    const kickerInfo = parseKicker(card.cardData.oracle_text || "");
    if (kickerInfo.hasKicker && kickerInfo.kickerCost) {
      totalGeneric += kickerInfo.kickerCost.generic;
      totalWhite += kickerInfo.kickerCost.white;
      totalBlue += kickerInfo.kickerCost.blue;
      totalBlack += kickerInfo.kickerCost.black;
      totalRed += kickerInfo.kickerCost.red;
      totalGreen += kickerInfo.kickerCost.green;
      alternativeCostsUsed.push("kicker");
    }
  }

  // Handle alternative costs (Buyback, Flashback, Bestow, etc.)
  let buybackReturnZone: string | undefined = undefined;
  let bestowTarget: CardInstanceId | undefined = undefined;

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
  const currentState = spendResult.state;

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
    wasKicked: isKicked,
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

  let currentState = state;

  // Handle structured effects if present
  if (stackObject.effects && stackObject.effects.length > 0) {
    // Resolve each effect in order
    const result = resolveStackObjectEffects(
      state,
      stackObject.effects,
      stackObject.sourceCardId || undefined,
      stackObject.targets,
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
        const parsedEffects = parseSpellEffects(
          oracleText,
          stackObject.variableValues,
        );

        if (parsedEffects.length > 0) {
          // Apply effects with target information
          const result = resolveStackObjectEffects(
            currentState,
            parsedEffects,
            stackObject.sourceCardId,
            stackObject.targets,
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
        // Instants and sorceries go to graveyard
        destinationZone = `${card.controllerId}-graveyard`;
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

        // CR 702.85 - Apply kicker effects if spell was kicked
        if (stackObject.alternativeCostsUsed?.includes("kicker")) {
          // Additional effect handled by spell's own effect processing
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
 * Resolve a waiting choice made by the player
 * Called when player selects cards/options in a choice dialog
 */
export function resolveWaitingChoice(
  state: GameState,
  playerId: PlayerId,
  selectedValue: string | number | boolean,
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

  const { type, stackObjectId } = state.waitingChoice;

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

    const newState = {
      ...state,
      waitingChoice: null,
      stack: state.stack.map((obj) =>
        obj.id === stackObjectId
          ? { ...obj, chosenModes: [String(selectedValue)] }
          : obj,
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

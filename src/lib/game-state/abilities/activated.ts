import { isSelfTransformText } from "../keyword-actions/transform";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  StackObject,
} from "../types";
import { isPriorityPlayer } from "../priority-guard";
import { hasSplitSecondOnStack } from "../auto-pass-priority";
import { isManaAbility, spendMana, addMana } from "../mana";
import { parseManaFromEffect } from "./mana";
import { destroyCard, discardCards } from "../keyword-actions";
import { getActivatedAbilities } from "./parse";
import { isCreature } from "../card-instance";
import { hasKeyword } from "../evergreen-keywords";
import { generateAbilityId } from "./ids";
import { evaluateInterveningIfClause } from "./evaluate";
import { getActivationCondition } from "../keyword-actions/threshold";
import {
  parseTriggerTargetSpec,
  getLegalActivatedAbilityTargets,
} from "../trigger-system/trigger-targets";
import type { ActivateAbilityResult } from "./types";

export function canActivateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
): { canActivate: boolean; reason?: string } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { canActivate: false, reason: "Card not found" };
  }

  if (card.controllerId !== playerId) {
    return { canActivate: false, reason: "You do not control this card" };
  }

  if (!isPriorityPlayer(state, playerId)) {
    return { canActivate: false, reason: "You do not have priority" };
  }

  const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone || !battlefieldZone.cardIds.includes(cardId)) {
    return { canActivate: false, reason: "Card is not on the battlefield" };
  }

  const abilities = getActivatedAbilities(card.cardData);
  const ability = abilities[abilityIndex];

  if (ability && hasSplitSecondOnStack(state)) {
    if (!isManaAbility(cardId, ability.effect)) {
      return {
        canActivate: false,
        reason:
          "A spell with split second is on the stack. Only mana abilities may be activated.",
      };
    }
  }

  // CR 302.6: a creature's {T} ability can't be activated unless it's been
  // under its controller's control since their most recent turn began
  // (haste waives this, CR 702.10).
  if (
    ability &&
    ability.costs.tap &&
    card.hasSummoningSickness &&
    isCreature(card) &&
    !hasKeyword(card, "haste")
  ) {
    return {
      canActivate: false,
      reason: "This creature has summoning sickness",
    };
  }

  // CR 602.5b: "Activate only if <condition>" (threshold's Thought Shucker
  // and Loot, the Anomaly, issue #2300).
  const condition = ability
    ? getActivationCondition(card, ability.effect ?? "")
    : null;
  if (condition && !evaluateInterveningIfClause(condition, state, playerId)) {
    return {
      canActivate: false,
      reason: `Activate only if ${condition}`,
    };
  }

  return { canActivate: true };
}

/** A non-mana activated ability the player can activate right now. */
export interface ActivatableAbility {
  abilityIndex: number;
  /** The ability's line of oracle text ("cost: effect") when found. */
  label: string;
  effect: string;
}

/**
 * Non-mana activated abilities of a permanent that `playerId` can activate
 * now (priority, timing, summoning sickness). Mana abilities are excluded;
 * they go through the mana flow.
 */
export function getActivatableAbilities(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): ActivatableAbility[] {
  const card = state.cards.get(cardId);
  if (!card) return [];
  const lines = (card.cardData.oracle_text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes(":"));
  const out: ActivatableAbility[] = [];
  getActivatedAbilities(card.cardData).forEach((ability, abilityIndex) => {
    const effect = ability.effect ?? "";
    if (isManaAbility(cardId, effect)) return;
    if (
      !canActivateAbility(state, playerId, cardId, abilityIndex).canActivate
    ) {
      return;
    }
    const key = effect.toLowerCase().slice(0, 24);
    const label =
      (key && lines.find((l) => l.toLowerCase().includes(key))) || effect;
    out.push({ abilityIndex, label, effect });
  });
  return out;
}

export function activateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
  targets: { type: string; targetId: string }[] = [],
): ActivateAbilityResult {
  const card = state.cards.get(cardId);
  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: "Card not found",
    };
  }

  const canActivate = canActivateAbility(state, playerId, cardId, abilityIndex);
  if (!canActivate.canActivate) {
    return {
      success: false,
      state,
      description: "",
      error: canActivate.reason,
    };
  }

  const abilities = getActivatedAbilities(card.cardData);
  const ability = abilities[abilityIndex];

  if (!ability) {
    return {
      success: false,
      state,
      description: "",
      error: "Ability not found",
    };
  }

  // CR 602.2b / 601.2c: targets are checked before any cost is paid.
  const targetSpec = isManaAbility(cardId, ability.effect)
    ? null
    : parseTriggerTargetSpec(ability.effect ?? "");
  if (targets.length > 0) {
    if (!targetSpec) {
      return {
        success: false,
        state,
        description: "",
        error: "This ability has no targets",
      };
    }
    if (targets.length > 1) {
      return {
        success: false,
        state,
        description: "",
        error: "This ability takes one target",
      };
    }
    const legal = new Set(
      getLegalActivatedAbilityTargets(state, playerId, cardId, abilityIndex),
    );
    const illegal = targets.find((t) => !legal.has(t.targetId));
    if (illegal) {
      return {
        success: false,
        state,
        description: "",
        error: `Illegal target: ${illegal.targetId}`,
      };
    }
  }

  let currentState = state;

  if (ability.costs.tap) {
    const updatedCard = {
      ...card,
      isTapped: true,
    };
    const updatedCards = new Map(currentState.cards);
    updatedCards.set(cardId, updatedCard);
    currentState = {
      ...currentState,
      cards: updatedCards,
    };
  }

  if (ability.costs.mana) {
    const manaCost = ability.costs.mana;
    const manaPayment = {
      generic: manaCost.generic,
      white: manaCost.white,
      blue: manaCost.blue,
      black: manaCost.black,
      red: manaCost.red,
      green: manaCost.green,
    };
    const manaResult = spendMana(currentState, playerId, manaPayment);
    if (!manaResult.success) {
      return {
        success: false,
        state: currentState,
        description: "",
        error: "Not enough mana",
      };
    }
    currentState = manaResult.state;
  }

  if (ability.costs.payLife > 0) {
    const player = currentState.players.get(playerId);
    if (!player || player.life < ability.costs.payLife) {
      return {
        success: false,
        state: currentState,
        description: "",
        error: "Not enough life",
      };
    }
    const updatedPlayer = {
      ...player,
      life: player.life - ability.costs.payLife,
    };
    const updatedPlayers = new Map(currentState.players);
    updatedPlayers.set(playerId, updatedPlayer);
    currentState = {
      ...currentState,
      players: updatedPlayers,
    };
  }

  if (ability.costs.sacrifice) {
    const result = destroyCard(currentState, cardId, true);
    if (result.success) {
      currentState = result.state;
    }
  }

  if (ability.costs.discard) {
    const result = discardCards(currentState, playerId, 1, false);
    if (result.success) {
      currentState = result.state;
    }
  }

  if (isManaAbility(cardId, ability.effect)) {
    const parsedMana = parseManaFromEffect(ability.effect);
    if (Object.keys(parsedMana).length > 0) {
      currentState = addMana(currentState, playerId, parsedMana);
    }

    const updatedPlayers = new Map(currentState.players);
    const player = updatedPlayers.get(playerId);
    if (player) {
      updatedPlayers.set(playerId, {
        ...player,
        hasActivatedManaAbility: true,
      });
    }

    return {
      success: true,
      state: {
        ...currentState,
        players: updatedPlayers,
        lastModifiedAt: Date.now(),
      },
      description: `Activated ${card.cardData.name}'s mana ability`,
    };
  }

  const stackZone = currentState.zones.get("stack");
  if (!stackZone) {
    return {
      success: false,
      state: currentState,
      description: "",
      error: "Stack zone not found",
    };
  }

  const battlefieldZone = currentState.zones.get(`${playerId}-battlefield`);

  let cardMovedState = currentState;
  if (battlefieldZone && battlefieldZone.cardIds.includes(cardId)) {
    const stackObject: StackObject = {
      id: generateAbilityId(),
      type: "ability",
      sourceCardId: cardId,
      controllerId: playerId,
      name: `${card.cardData.name} ability`,
      text: ability.effect,
      // CR 701.28 - "Transform <this>" resolves as a structured effect so
      // it doesn't depend on oracle-text parsing of the whole card.
      ...(isSelfTransformText(ability.effect ?? "", card.cardData.name)
        ? { effects: [{ effectType: "transform" as const, targetId: cardId }] }
        : {}),
      manaCost: card.cardData.mana_cost ?? null,
      targets: targets.map((t) => ({
        type: t.type as "card" | "player" | "zone",
        targetId: t.targetId,
        isValid: true,
      })),
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: Date.now(),
      // CR 602: resolves from its own text; targets picked now or, when the
      // caller passed none, chosen on the stack (see triggerNeedsTargets).
      activated: true,
      ...(targetSpec ? { targetsChosen: targets.length > 0 } : {}),
    };

    const updatedStack = [...cardMovedState.stack, stackObject];

    cardMovedState = {
      ...cardMovedState,
      stack: updatedStack,
      lastModifiedAt: Date.now(),
    };
  }

  const playerIds = Array.from(cardMovedState.players.keys());
  const currentIndex = playerIds.indexOf(playerId);
  const nextIndex = (currentIndex + 1) % playerIds.length;
  const nextPlayerId = playerIds[nextIndex];

  const updatedPlayers = new Map(cardMovedState.players);
  const player = updatedPlayers.get(playerId);
  if (player) {
    updatedPlayers.set(playerId, {
      ...player,
      hasPassedPriority: false,
    });
  }

  return {
    success: true,
    state: {
      ...cardMovedState,
      players: updatedPlayers,
      priorityPlayerId: nextPlayerId,
      consecutivePasses: 0,
      lastModifiedAt: Date.now(),
    },
    description: `Activated ${card.cardData.name}'s ability`,
  };
}

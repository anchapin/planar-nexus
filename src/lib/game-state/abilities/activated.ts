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
import { generateAbilityId } from "./ids";
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

  if (ability && !ability.costs.tap && card.hasSummoningSickness) {
    // Some abilities can be activated despite summoning sickness
  }

  return { canActivate: true };
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

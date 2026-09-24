import type { GameState, PlayerId, CardInstanceId } from "../types";
import { isPriorityPlayer } from "../priority-guard";
import { Phase } from "../types";
import { getActivatedAbilities } from "./parse";
import type { ActivateAbilityResult, LoyaltyAbility } from "./types";

export function getLoyaltyAbilities(card: {
  oracle_text?: string;
}): LoyaltyAbility[] {
  if (!card.oracle_text) return [];

  const abilities: LoyaltyAbility[] = [];
  const lines = card.oracle_text.split("\n");

  for (const line of lines) {
    const match = line.match(/^(\+\d+|-\d+|0):\s*(.+)/);
    if (match) {
      abilities.push({
        cost: parseInt(match[1], 10),
        effect: match[2],
      });
    }
  }

  return abilities;
}

export function canActivateLoyaltyAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityCost: number,
): { canActivate: boolean; reason?: string } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { canActivate: false, reason: "Card not found" };
  }

  const typeLine = card.cardData.type_line?.toLowerCase() || "";
  if (!typeLine.includes("planeswalker")) {
    return { canActivate: false, reason: "Card is not a planeswalker" };
  }

  if (card.controllerId !== playerId) {
    return {
      canActivate: false,
      reason: "You do not control this planeswalker",
    };
  }

  if (!isPriorityPlayer(state, playerId)) {
    return { canActivate: false, reason: "You do not have priority" };
  }

  const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone || !battlefieldZone.cardIds.includes(cardId)) {
    return {
      canActivate: false,
      reason: "Planeswalker is not on the battlefield",
    };
  }

  const currentPhase = state.turn.currentPhase;
  if (
    currentPhase !== Phase.PRECOMBAT_MAIN &&
    currentPhase !== Phase.POSTCOMBAT_MAIN
  ) {
    return {
      canActivate: false,
      reason: "Can only activate loyalty abilities during main phases",
    };
  }

  if (state.stack.length > 0) {
    return {
      canActivate: false,
      reason: "Stack must be empty to activate loyalty abilities",
    };
  }

  const loyaltyCounter = card.counters?.find((c) => c.type === "loyalty");
  const currentLoyalty = loyaltyCounter?.count || 0;

  if (abilityCost > 0 && currentLoyalty < abilityCost) {
    return { canActivate: false, reason: "Not enough loyalty counters" };
  }

  if (abilityCost < 0 && currentLoyalty < Math.abs(abilityCost)) {
    return { canActivate: false, reason: "Not enough loyalty counters" };
  }

  return { canActivate: true };
}

export function activateLoyaltyAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
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

  const abilities = getLoyaltyAbilities(card.cardData);
  const ability = abilities[abilityIndex];

  if (!ability) {
    return {
      success: false,
      state,
      description: "",
      error: "Loyalty ability not found",
    };
  }

  const canActivate = canActivateLoyaltyAbility(
    state,
    playerId,
    cardId,
    ability.cost,
  );
  if (!canActivate.canActivate) {
    return {
      success: false,
      state,
      description: "",
      error: canActivate.reason,
    };
  }

  let currentState = state;

  const loyaltyCounter = card.counters?.find((c) => c.type === "loyalty");
  const currentLoyalty = loyaltyCounter?.count || 0;
  const newLoyalty = currentLoyalty + ability.cost;

  const updatedCounters =
    card.counters?.filter((c) => c.type !== "loyalty") || [];
  if (newLoyalty > 0) {
    updatedCounters.push({ type: "loyalty", count: newLoyalty });
  }

  const updatedCard = {
    ...card,
    counters: updatedCounters,
  };

  const updatedCards = new Map(currentState.cards);
  updatedCards.set(cardId, updatedCard);
  currentState = {
    ...currentState,
    cards: updatedCards,
    lastModifiedAt: Date.now(),
  };

  const effectDescription = `Activated ${card.cardData.name} loyalty ability (${ability.cost >= 0 ? "+" : ""}${ability.cost}: ${ability.effect})`;

  const playerIds = Array.from(currentState.players.keys());
  const currentIndex = playerIds.indexOf(playerId);
  const nextPlayerId = playerIds[(currentIndex + 1) % playerIds.length];

  return {
    success: true,
    state: {
      ...currentState,
      priorityPlayerId: nextPlayerId,
    },
    description: effectDescription,
  };
}

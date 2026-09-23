import type { CardInstanceId, GameState, PlayerId } from "../types";
import { Phase } from "../types";
import type { ReplacementEvent } from "../replacement-effects";
import { ValidationService } from "../validation-service";
import { isPriorityPlayer } from "../priority-guard";
import { moveCardBetweenZones } from "../zones";

export function canPlayLand(state: GameState, playerId: PlayerId): boolean {
  const player = state.players.get(playerId);
  if (!player) {
    return false;
  }

  const maxLands = player.maxLandsPerTurn ?? 1;
  if ((player.landsPlayedThisTurn ?? 0) >= maxLands) {
    return false;
  }

  // Must be in a main phase
  const currentPhase = state.turn.currentPhase;
  if (
    currentPhase !== Phase.PRECOMBAT_MAIN &&
    currentPhase !== Phase.POSTCOMBAT_MAIN
  ) {
    return false;
  }

  // Stack must be empty
  if (state.stack.length > 0) {
    return false;
  }

  // Must have priority
  if (!isPriorityPlayer(state, playerId)) {
    return false;
  }

  return true;
}

export function playLand(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  modeId?: string,
  entersTappedOverride?: boolean,
): { success: boolean; state: GameState; error?: string } {
  const action = {
    type: "play_land" as const,
    playerId,
    timestamp: Date.now(),
    data: { cardId },
  };

  const validationResult = ValidationService.validateAction(
    state,
    action,
    modeId,
  );
  if (!validationResult.isValid) {
    return {
      success: false,
      state,
      error: validationResult.message || validationResult.reason,
    };
  }

  const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone) {
    return { success: false, state, error: "Battlefield zone not found." };
  }

  const handZone = state.zones.get(`${playerId}-hand`);
  if (!handZone || !handZone.cardIds.includes(cardId)) {
    return { success: false, state, error: "Card not in hand." };
  }

  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state, error: "Card not found." };
  }

  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  const defaultEntersTapped =
    oracleText.includes("enters tapped") ||
    oracleText.includes("enters the battlefield tapped");

  const landEnterEvent: ReplacementEvent = {
    type: "landEnterBattlefield",
    timestamp: Date.now(),
    sourceId: cardId,
    targetId: cardId,
    amount: 1,
    entersTapped: defaultEntersTapped,
  };

  const processedEvent =
    state.replacementEffectManager.processEvent(landEnterEvent);
  let entersTapped = processedEvent.entersTapped ?? defaultEntersTapped;

  if (entersTappedOverride !== undefined) {
    entersTapped = entersTappedOverride;
  }

  const moved = moveCardBetweenZones(handZone, battlefieldZone, cardId);

  const updatedZones = new Map(state.zones);
  updatedZones.set(`${playerId}-hand`, moved.from);
  updatedZones.set(`${playerId}-battlefield`, moved.to);

  const updatedCards = new Map(state.cards);
  const movedCard = updatedCards.get(cardId);
  if (movedCard) {
    updatedCards.set(cardId, { ...movedCard, isTapped: entersTapped });
  }

  const player = state.players.get(playerId);
  if (!player) {
    return { success: false, state, error: "Player not found." };
  }

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    landsPlayedThisTurn: (player.landsPlayedThisTurn ?? 0) + 1,
  });

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      players: updatedPlayers,
      cards: updatedCards,
    },
  };
}

export function isLandPlayed(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): boolean {
  const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone) return false;
  return battlefieldZone.cardIds.includes(cardId);
}

export function resetLandPlays(
  state: GameState,
  playerId: PlayerId,
): GameState {
  const player = state.players.get(playerId);
  if (!player) {
    return state;
  }

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    landsPlayedThisTurn: 0,
    hasActivatedManaAbility: false,
  });

  return {
    ...state,
    players: updatedPlayers,
    lastModifiedAt: Date.now(),
  };
}

export function setMaxLandsPerTurn(
  state: GameState,
  playerId: PlayerId,
  maxLands: number,
): GameState {
  const player = state.players.get(playerId);
  if (!player) {
    return state;
  }

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    maxLandsPerTurn: maxLands,
  });

  return {
    ...state,
    players: updatedPlayers,
  };
}

export function addLandPlay(
  state: GameState,
  playerId: PlayerId,
  amount: number = 1,
): GameState {
  const player = state.players.get(playerId);
  if (!player) {
    return state;
  }

  const updatedPlayers = new Map(state.players);
  updatedPlayers.set(playerId, {
    ...player,
    maxLandsPerTurn: player.maxLandsPerTurn + amount,
  });

  return {
    ...state,
    players: updatedPlayers,
  };
}

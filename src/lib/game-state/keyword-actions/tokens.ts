/**
 * Token creation keyword action (CR 701.6).
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstanceId, PlayerId, ScryfallCard } from '../types';
import { createToken } from '../card-instance';
import { KeywordActionResult } from './shared';

/**
 * Create a token on the battlefield
 */
export function createTokenCard(
  state: GameState,
  tokenData: ScryfallCard,
  controllerId: PlayerId,
  ownerId: PlayerId,
  count: number = 1,
): KeywordActionResult {
  const player = state.players.get(controllerId);

  if (!player) {
    return {
      success: false,
      state,
      description: "",
      error: `Player ${controllerId} not found`,
    };
  }

  const battlefieldZoneKey = `${controllerId}-battlefield`;
  const battlefield = state.zones.get(battlefieldZoneKey);

  if (!battlefield) {
    return {
      success: false,
      state,
      description: "",
      error: `Battlefield zone not found`,
    };
  }

  const tokenIds: CardInstanceId[] = [];
  const updatedCards = new Map(state.cards);

  for (let i = 0; i < count; i++) {
    const token = createToken(tokenData, controllerId, ownerId);
    tokenIds.push(token.id);
    updatedCards.set(token.id, token);
  }

  const updatedBattlefield = {
    ...battlefield,
    cardIds: [...battlefield.cardIds, ...tokenIds],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(battlefieldZoneKey, updatedBattlefield);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      zones: updatedZones,
      lastModifiedAt: Date.now(),
    },
    description: `Created ${count} ${tokenData.name} token${count !== 1 ? "s" : ""}`,
    affectedCards: tokenIds,
  };
}


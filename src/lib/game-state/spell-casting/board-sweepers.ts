/**
 * Board-sweeper detection and execution (wrath-class resolution effects).
 *
 * Mechanically extracted from spell-casting.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstanceId } from '../types';
import { ZoneType } from '../types';
import { destroyCard } from '../keyword-actions';

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
export function executeBoardSweeper(
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


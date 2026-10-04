/**
 * Dies triggers (CR 700.4, CR 603.10a), issue #2498.
 *
 * "Dies" means a creature was put into a graveyard from the battlefield.
 * Leaves-the-battlefield abilities look back in time: they are detected on
 * the game state just before the creature left, so "When this creature
 * dies" still sees its own ability, then go on the stack after the move.
 *
 * Wired into `moveCardToZone` (destroy, lethal damage and 0-toughness SBAs,
 * sacrifice), the shared path every battlefield-to-graveyard move uses.
 */
import type { GameState, CardInstanceId } from "../types";
import { detectTriggeredAbilities } from "../abilities/triggered";
import type { TriggeredAbilityInstance } from "../abilities/types";

function isCreatureOnBattlefield(
  state: GameState,
  cardId: CardInstanceId,
): boolean {
  const card = state.cards.get(cardId);
  if (!card) return false;
  if (!(card.cardData.type_line ?? "").toLowerCase().includes("creature")) {
    return false;
  }
  return (
    state.zones.get(`${card.controllerId}-battlefield`)?.cardIds.includes(cardId) ??
    false
  );
}

/**
 * Dies triggers for a creature about to be put into a graveyard, read from
 * the state before the move (CR 603.10a). Empty when it is not a creature on
 * the battlefield.
 */
export function detectDiesTriggers(
  stateBeforeMove: GameState,
  dyingCardId: CardInstanceId,
): TriggeredAbilityInstance[] {
  if (!isCreatureOnBattlefield(stateBeforeMove, dyingCardId)) return [];
  return detectTriggeredAbilities(stateBeforeMove, "dies", {
    sourceCardId: dyingCardId,
    dyingCardId,
  });
}

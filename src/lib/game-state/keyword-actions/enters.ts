/**
 * Enters-the-battlefield triggers for permanents that enter other than by a
 * resolving permanent spell (issue #2300).
 *
 * Spell resolution already raises "entersBattlefield" with the entering
 * card. This leaf does the same for lands played, tokens created,
 * permanents put onto the battlefield (`moveCardToZone`) and persist
 * returns, so "When this creature enters" and "Whenever another creature
 * you control enters" fire for them too (CR 603.6a). Phasing in is not
 * entering (CR 702.26d) and does not use this path.
 */
import type { GameState, CardInstanceId } from "../types";
import { checkTriggeredAbilities } from "../abilities/check";

/** Put every ETB trigger that cares about `enteringCardId` onto the stack. */
export function fireEntersTriggers(
  state: GameState,
  enteringCardId: CardInstanceId,
): GameState {
  return checkTriggeredAbilities(state, "entersBattlefield", {
    enteringCardId,
  }).state;
}

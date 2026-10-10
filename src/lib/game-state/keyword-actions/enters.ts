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
import {
  createEnterChoiceWaitingChoice,
  hasEnterChoice,
} from "./enter-choice";

/** Put every ETB trigger that cares about `enteringCardId` onto the stack. */
export function fireEntersTriggers(
  state: GameState,
  enteringCardId: CardInstanceId,
): GameState {
  let next = checkTriggeredAbilities(state, "entersBattlefield", {
    enteringCardId,
  }).state;
  // Wave 4.7 lane 39: "as this enters, choose a [thing]" (#2594
  // follow-up). Surface the choice after ETB triggers fire so any
  // "when this enters" trigger doesn't see the choice yet. Like
  // `resolve.ts` we no-op when another choice is already pending so
  // we don't clobber a higher-priority prompt (e.g. legend rule).
  const entering = next.cards.get(enteringCardId);
  if (
    entering &&
    !next.waitingChoice &&
    hasEnterChoice(entering)
  ) {
    const choice = createEnterChoiceWaitingChoice(next, enteringCardId);
    if (choice) {
      next = {
        ...next,
        waitingChoice: choice,
        lastModifiedAt: Date.now(),
      };
    }
  }
  return next;
}

/**
 * Battle cry (CR 702.91, issue #2300): Sanguine Evangelist.
 *
 * "Whenever this creature attacks, each other attacking creature gets +1/+0
 * until end of turn." Applied when attackers are declared, before blockers,
 * which is when the trigger would resolve with no responses. Each instance
 * triggers separately (CR 702.91b), so two battle cry creatures each pump the
 * other and every other attacker gets +2/+0.
 */
import type { CardInstance, CardInstanceId, GameState } from "../types";
import { oracleTextDeclaresOwnKeyword } from "./grant-negation";
import { addUntilEndOfTurnPT } from "../pt-until-end-of-turn";

/** True when the card itself has battle cry (not a grant of it). */
export function hasBattleCry(card: CardInstance): boolean {
  if (
    (card.cardData.keywords ?? []).some((k) => /^battle cry$/i.test(k.trim()))
  ) {
    return true;
  }
  return oracleTextDeclaresOwnKeyword(
    "battle cry",
    card.cardData.oracle_text ?? "",
  );
}

/** Resolve every battle cry trigger among the declared attackers. */
export function applyBattleCry(
  state: GameState,
  attackerIds: CardInstanceId[],
): GameState {
  let next = state;
  for (const sourceId of attackerIds) {
    const source = state.cards.get(sourceId);
    if (!source || !hasBattleCry(source)) continue;
    for (const otherId of attackerIds) {
      if (otherId === sourceId) continue;
      next = addUntilEndOfTurnPT(next, otherId, 1, 0);
    }
  }
  return next;
}

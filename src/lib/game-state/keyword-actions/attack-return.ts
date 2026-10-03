/**
 * Graveyard attack trigger that returns the card "tapped and attacking"
 * (issue #2428, found on Persistent Marshstalker):
 *
 *   "Threshold — Whenever you attack with one or more Rats, if there are
 *   seven or more cards in your graveyard, you may pay {2}{B}. If you do,
 *   return this card from your graveyard to the battlefield tapped and
 *   attacking."
 *
 * The ability functions from the graveyard (CR 113.6k). "You attack" means
 * attackers were declared (CR 508.1), so the hook runs from
 * `declareAttackers`. The threshold clause is an intervening "if" (CR 603.4):
 * checked when attackers are declared and again when the payment is made.
 *
 * Like Corpse and Tribute, the optional payment is surfaced as a
 * `waitingChoice` rather than going on the stack, so opponents get no window
 * to respond to the trigger itself. A creature put onto the battlefield
 * attacking was never declared as an attacker (CR 508.4), so it does not fire
 * "whenever this attacks" abilities.
 */
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
} from "../types";
import { spendMana } from "../mana";
import { moveCardToZone } from "./removal";
import { getEffectivePower } from "../evergreen-keywords";
import { registerOfferResolver } from "../spell-casting/choices";
import {
  ATTACK_RETURN_CHOICE_TYPE,
  graveyardIds,
  manaFor,
  matchingAttacker,
  parseAttackReturn,
  surfaceNext,
} from "./attack-return-offers";

export {
  ATTACK_RETURN_CHOICE_TYPE,
  createAttackReturnChoice,
  parseAttackReturn,
  processAttackReturnOffers,
} from "./attack-return-offers";
export type { AttackReturnAbility } from "./attack-return-offers";

export interface AttackReturnResolution {
  success: boolean;
  state: GameState;
  description: string;
}

function finish(
  state: GameState,
  cardId: CardInstanceId,
  description: string,
): AttackReturnResolution {
  const queue = (state.pendingAttackReturnOffers ?? []).filter(
    (id) => id !== cardId,
  );
  const cleared: GameState = {
    ...state,
    waitingChoice: null,
    pendingAttackReturnOffers: queue,
    lastModifiedAt: Date.now(),
  };
  return { success: true, state: surfaceNext(cleared), description };
}

/** Resolve a pending `attack_return_offer` with `pay:<id>` or `decline:<id>`. */
export function resolveAttackReturnChoice(
  state: GameState,
  playerId: PlayerId,
  chosenValue: string,
): AttackReturnResolution {
  const choice = state.waitingChoice;
  if (!choice || choice.type !== ATTACK_RETURN_CHOICE_TYPE) {
    return { success: false, state, description: "No pending return offer" };
  }
  if (choice.playerId !== playerId) {
    return { success: false, state, description: "Not this player's offer" };
  }
  const option = choice.choices.find((c) => String(c.value) === chosenValue);
  if (!option || !option.isValid) {
    return { success: false, state, description: "Invalid choice" };
  }
  const [decision, rawId] = chosenValue.split(":");
  const cardId = rawId as CardInstanceId;
  const card = state.cards.get(cardId);
  const ability = card
    ? parseAttackReturn(card.cardData.oracle_text ?? "")
    : null;
  if (!card || !ability) {
    return finish(state, cardId, "Return offer resolved: source gone");
  }
  const name = card.cardData.name || "Creature";
  if (decision === "decline") {
    return finish(state, cardId, `${name}: declined`);
  }

  // Intervening "if" (CR 603.4): the card must still be in the graveyard and
  // the graveyard must still meet the threshold.
  const graveyard = graveyardIds(state, playerId);
  if (!graveyard.includes(cardId) || graveyard.length < ability.minGraveyard) {
    return finish(state, cardId, `${name}: condition no longer met`);
  }
  const attacker = matchingAttacker(state, playerId, ability.subtype);
  if (!attacker) {
    return finish(state, cardId, `${name}: no attacker to join`);
  }

  const mana = manaFor(ability.cost);
  if (!mana) return finish(state, cardId, `${name}: unreadable cost`);
  const paid = spendMana(state, playerId, mana);
  if (!paid.success) {
    return { success: false, state, description: "Not enough mana" };
  }

  const moved = moveCardToZone(paid.state, cardId, "battlefield");
  if (!moved.success) {
    return finish(paid.state, cardId, `${name}: could not return`);
  }
  const returned = moved.state.cards.get(cardId);
  if (!returned) return finish(moved.state, cardId, `${name}: missing`);

  const tapped: CardInstance = { ...returned, isTapped: true };
  const cards = new Map(moved.state.cards);
  cards.set(cardId, tapped);
  // Attacks the same player or planeswalker as the attacker that triggered
  // it (the controller's choice, CR 506.3; defaulted here).
  const combat = {
    ...moved.state.combat,
    attackers: [
      ...moved.state.combat.attackers,
      {
        cardId,
        defenderId: attacker.defenderId,
        isAttackingPlaneswalker: attacker.isAttackingPlaneswalker,
        damageToDeal: getEffectivePower(tapped),
        hasFirstStrike: false,
        hasDoubleStrike: false,
      },
    ],
  };
  return finish(
    { ...moved.state, cards, combat },
    cardId,
    `${name} returned to the battlefield tapped and attacking`,
  );
}

registerOfferResolver(ATTACK_RETURN_CHOICE_TYPE, resolveAttackReturnChoice);

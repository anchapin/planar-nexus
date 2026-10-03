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
// Offer-creation half of the graveyard attack-return ability, split out so
// combat declaration can queue offers without importing zone moves and the
// rest of the rules engine into every client route (issue #2470). Resolving
// an offer lives in ./attack-return.
import type {
  CardInstance,
  CardInstanceId,
  ChoiceOption,
  GameState,
  PlayerId,
  WaitingChoice,
} from "../types";
import { spendMana } from "../mana";
import { parseManaCost } from "../oracle-text-parser/mana-cost";
import { singularSubtype } from "./tribal-anthem";

export const ATTACK_RETURN_CHOICE_TYPE = "attack_return_offer" as const;

export interface AttackReturnAbility {
  /** Creature type an attacker must have ("Rat"). */
  subtype: string;
  /** Intervening-if graveyard size ("seven or more cards"). */
  minGraveyard: number;
  /** Mana cost to pay, e.g. "{2}{B}". */
  cost: string;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const ATTACK_RETURN =
  /Whenever you attack with one or more ([A-Z][a-z]+), if there are (\w+) or more cards in your graveyard, you may pay ((?:\{[^}]+\})+)\. If you do, return this card from your graveyard to the battlefield tapped and attacking/;

export function parseAttackReturn(
  oracleText: string,
): AttackReturnAbility | null {
  const m = oracleText.match(ATTACK_RETURN);
  if (!m) return null;
  const min = NUMBER_WORDS[m[2].toLowerCase()] ?? parseInt(m[2], 10);
  if (!Number.isFinite(min)) return null;
  return { subtype: singularSubtype(m[1]), minGraveyard: min, cost: m[3] };
}

function subtypesOf(card: CardInstance): string[] {
  const typeLine = card.cardData.type_line ?? "";
  const after = typeLine.split(/\s+[\u2014-]\s+/)[1] ?? "";
  return after.split(/\s+/).filter(Boolean);
}

export function graveyardIds(
  state: GameState,
  playerId: PlayerId,
): CardInstanceId[] {
  return state.zones.get(`${playerId}-graveyard`)?.cardIds ?? [];
}

/** First declared attacker of `subtype` controlled by `playerId`, if any. */
export function matchingAttacker(
  state: GameState,
  playerId: PlayerId,
  subtype: string,
) {
  return state.combat.attackers.find((a) => {
    const card = state.cards.get(a.cardId);
    return (
      card?.controllerId === playerId && subtypesOf(card).includes(subtype)
    );
  });
}

export function manaFor(cost: string) {
  const m = parseManaCost(cost);
  if (!m) return null;
  return {
    generic: m.generic,
    colorless: m.colorless,
    white: m.white,
    blue: m.blue,
    black: m.black,
    red: m.red,
    green: m.green,
  };
}

function canAfford(state: GameState, playerId: PlayerId, cost: string) {
  const mana = manaFor(cost);
  return mana ? spendMana(state, playerId, mana).success : false;
}

export function createAttackReturnChoice(
  state: GameState,
  cardId: CardInstanceId,
): WaitingChoice | null {
  const card = state.cards.get(cardId);
  if (!card) return null;
  const ability = parseAttackReturn(card.cardData.oracle_text ?? "");
  if (!ability) return null;
  const playerId = card.ownerId;
  const name = card.cardData.name || "Creature";
  const affordable = canAfford(state, playerId, ability.cost);
  const choices: ChoiceOption[] = [
    {
      label: affordable
        ? `Pay ${ability.cost}: return ${name} tapped and attacking`
        : `Pay ${ability.cost} (not enough mana)`,
      value: `pay:${cardId}`,
      isValid: affordable,
    },
    { label: "Decline", value: `decline:${cardId}`, isValid: true },
  ];
  return {
    type: ATTACK_RETURN_CHOICE_TYPE,
    playerId,
    stackObjectId: null,
    prompt: `${name}: you may pay ${ability.cost} to return it from your graveyard to the battlefield tapped and attacking.`,
    choices,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

export function surfaceNext(state: GameState): GameState {
  const queue = state.pendingAttackReturnOffers ?? [];
  if (queue.length === 0 || state.waitingChoice) return state;
  const choice = createAttackReturnChoice(state, queue[0]);
  if (!choice) {
    return surfaceNext({ ...state, pendingAttackReturnOffers: queue.slice(1) });
  }
  return { ...state, waitingChoice: choice, lastModifiedAt: Date.now() };
}

/**
 * Queue an offer for each card in the attacking player's graveyard whose
 * ability matches a declared attacker and whose threshold is met.
 */
export function processAttackReturnOffers(
  state: GameState,
  attackingPlayerId: PlayerId,
): GameState {
  const graveyard = graveyardIds(state, attackingPlayerId);
  const queue = [...(state.pendingAttackReturnOffers ?? [])];
  let added = false;
  for (const id of graveyard) {
    const card = state.cards.get(id);
    if (!card) continue;
    const ability = parseAttackReturn(card.cardData.oracle_text ?? "");
    if (!ability) continue;
    if (graveyard.length < ability.minGraveyard) continue;
    if (!matchingAttacker(state, attackingPlayerId, ability.subtype)) continue;
    if (queue.includes(id)) continue;
    queue.push(id);
    added = true;
  }
  if (!added) return state;
  return surfaceNext({ ...state, pendingAttackReturnOffers: queue });
}

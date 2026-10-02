/**
 * Fight keyword action (CR 701.14).
 *
 * "A creature fights another creature" means each deals damage equal to its
 * power to the other (701.14a). If either creature is no longer on the
 * battlefield or no longer a creature, no damage is dealt (701.14b). A
 * creature that fights itself deals damage to itself equal to twice its
 * power (701.14c). Fight damage is not combat damage (701.14d).
 *
 * This leaf only works out who deals how much damage to whom; the damage
 * itself is dealt by `resolveFight` in effect-resolution so deathtouch,
 * lifelink, and prevention follow the normal damage path.
 *
 * Issue #2300 (Standard remainder slice).
 */
import type { GameState, CardInstanceId } from "../types";
import { getEffectivePower } from "../evergreen-keywords";

export interface FightDamage {
  sourceId: CardInstanceId;
  targetId: CardInstanceId;
  amount: number;
}

function isCreatureOnBattlefield(
  state: GameState,
  cardId: CardInstanceId,
): boolean {
  const card = state.cards.get(cardId);
  if (!card) return false;
  const onBattlefield = state.zones
    .get(`${card.controllerId}-battlefield`)
    ?.cardIds.includes(cardId);
  if (!onBattlefield) return false;
  return (
    card.cardData.type_line.toLowerCase().includes("creature") ||
    card.crewedUntilEndOfTurn === true
  );
}

/** True when both creatures can fight right now (CR 701.14b). */
export function canFight(
  state: GameState,
  fighterId: CardInstanceId,
  opponentId: CardInstanceId,
): boolean {
  return (
    isCreatureOnBattlefield(state, fighterId) &&
    isCreatureOnBattlefield(state, opponentId)
  );
}

/**
 * The damage a fight deals, with both powers read before any damage
 * (the two damage events are simultaneous). Empty when the fight deals
 * no damage.
 */
export function getFightDamage(
  state: GameState,
  fighterId: CardInstanceId,
  opponentId: CardInstanceId,
): FightDamage[] {
  if (!canFight(state, fighterId, opponentId)) return [];
  const fighter = state.cards.get(fighterId)!;
  if (fighterId === opponentId) {
    return [
      {
        sourceId: fighterId,
        targetId: fighterId,
        amount: getEffectivePower(fighter) * 2,
      },
    ];
  }
  const opponent = state.cards.get(opponentId)!;
  return [
    {
      sourceId: fighterId,
      targetId: opponentId,
      amount: getEffectivePower(fighter),
    },
    {
      sourceId: opponentId,
      targetId: fighterId,
      amount: getEffectivePower(opponent),
    },
  ].filter((d) => d.amount > 0);
}

/** Oracle text (reminder text removed) that tells creatures to fight. */
export function isFightText(oracleText: string): boolean {
  const text = oracleText.toLowerCase().replace(/\([^)]*\)/g, "");
  return /\bfights?\b/.test(text);
}

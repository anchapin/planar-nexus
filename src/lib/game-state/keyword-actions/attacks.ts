/**
 * Attack triggers (CR 508.1m), issue #2498.
 *
 * Abilities that trigger on attackers being declared go on the stack once
 * attackers are declared. "Whenever this creature attacks" fires for that
 * creature only, "whenever a creature you control attacks" once per matching
 * attacker, and "whenever you attack" / "one or more creatures ... attack"
 * once per combat. Wired into `declareAttackers`.
 */
import type { GameState, CardInstanceId, PlayerId } from "../types";
import { detectTriggeredAbilities } from "../abilities/triggered";
import { getTriggeredAbilities } from "../abilities/parse";
import type { TriggeredAbilityInstance } from "../abilities/types";
import {
  putTriggersOnStack,
  sortTriggersAPNAP,
} from "../trigger-system/stack-ops";

export interface DeclaredAttack {
  cardId: CardInstanceId;
  defenderId: PlayerId | CardInstanceId;
}

function triggersOncePerCombat(
  state: GameState,
  trigger: TriggeredAbilityInstance,
): boolean {
  const card = state.cards.get(trigger.sourceCardId);
  if (!card) return false;
  return getTriggeredAbilities(card.cardData).some(
    (ability) =>
      ability.trigger.event === "attacked" &&
      ability.effect === trigger.effect &&
      ability.trigger.attackFilter?.once === true,
  );
}

/** Every attack trigger for this declaration, in APNAP order. */
export function detectAttackTriggers(
  state: GameState,
  attackers: readonly DeclaredAttack[],
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];
  const once = new Set<string>();
  for (const attack of attackers) {
    for (const trigger of detectTriggeredAbilities(state, "attacked", {
      sourceCardId: attack.cardId,
      attackerId: attack.cardId,
      attackDefenderId: attack.defenderId,
      attackerCount: attackers.length,
    })) {
      if (triggersOncePerCombat(state, trigger)) {
        const key = `${trigger.sourceCardId}|${trigger.effect}`;
        if (once.has(key)) continue;
        once.add(key);
      }
      triggers.push(trigger);
    }
  }
  return sortTriggersAPNAP(triggers, state, state.turn.activePlayerId);
}

/** Put every attack trigger for this declaration onto the stack. */
export function fireAttackTriggers(
  state: GameState,
  attackers: readonly DeclaredAttack[],
): GameState {
  const triggers = detectAttackTriggers(state, attackers);
  if (triggers.length === 0) return state;
  return putTriggersOnStack(state, triggers).state;
}

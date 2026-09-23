import type { GameState, PlayerId } from "../types";
import type { TriggeredAbilityInstance } from "../abilities";
import {
  isOnBattlefield,
  TriggerConditionType,
  TriggerDetectionContext,
  generateTriggeredAbilityId,
  getTriggeredAbilitiesFromCard,
} from "./types";
import { evaluateInterveningIfClause } from "../abilities";
import { sortTriggersAPNAP } from "./stack-ops";

function evaluateStateCondition(
  condition: string,
  state: GameState,
  playerId: PlayerId,
): boolean {
  return evaluateInterveningIfClause(condition, state, playerId);
}

export function detectStateTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (ability.trigger.event === "stateTrigger") {
        if (ability.interveningIf) {
          if (
            !evaluateStateCondition(
              ability.interveningIf,
              state,
              card.controllerId,
            )
          ) {
            continue;
          }
        }

        const context: TriggerDetectionContext = {
          triggerType: TriggerConditionType.STATE_CHANGE,
        };

        triggers.push({
          id: generateTriggeredAbilityId(),
          sourceCardId: cardId,
          triggeringPlayerId: card.controllerId,
          triggerCondition: ability.trigger.event,
          effect: ability.effect,
          timestamp: Date.now(),
          sourceCardTimestamp: card.enteredBattlefieldTimestamp,
          interveningIf: ability.interveningIf,
          context: context as any,
        });
      }
    }
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

const BECOMES_MONARCH_PATTERN =
  /(?:whenever|when)\s+you\s+become(?:s)?\s+the\s+monarch/i;

export function detectMonarchyChangeTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  const monarchId = (() => {
    for (const [id, player] of state.players) {
      if (player.isMonarch) return id;
    }
    return null;
  })();
  if (monarchId === null) return triggers;

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;
    if (card.controllerId !== monarchId) continue;
    const oracle = card.cardData.oracle_text || "";
    if (!BECOMES_MONARCH_PATTERN.test(oracle)) continue;

    const context: TriggerDetectionContext = {
      triggerType: TriggerConditionType.MONARCHY_CHANGE,
      damageTarget: monarchId,
    };

    triggers.push({
      id: generateTriggeredAbilityId(),
      sourceCardId: cardId,
      triggeringPlayerId: card.controllerId,
      triggerCondition: "becomesMonarch",
      effect: oracle,
      timestamp: Date.now(),
      sourceCardTimestamp: card.enteredBattlefieldTimestamp,
      context: context as any,
    });
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

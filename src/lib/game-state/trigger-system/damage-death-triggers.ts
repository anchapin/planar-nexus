import type { GameState, PlayerId, CardInstanceId } from "../types";
import type { TriggeredAbilityInstance } from "../abilities";
import {
  isOnBattlefield,
  TriggerConditionType,
  TriggerDetectionContext,
  generateTriggeredAbilityId,
  getTriggeredAbilitiesFromCard,
  hasCorpseAbility,
  getCorpseAbility,
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

export function detectDamageTriggers(
  state: GameState,
  sourceId: CardInstanceId,
  targetId: PlayerId | CardInstanceId,
  damageAmount: number,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];
  const sourceCard = state.cards.get(sourceId);
  if (!sourceCard) return triggers;

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (ability.trigger.event === "damageDealt") {
        const isSelfTrigger = cardId === sourceId;
        const isAnySourceTrigger =
          !ability.trigger.source ||
          ability.trigger.source === "any" ||
          ability.trigger.source === "source";

        if (!isSelfTrigger && !isAnySourceTrigger) continue;

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
          sourceCardId: sourceId,
          damageAmount,
          damageTarget: targetId,
          triggerType: TriggerConditionType.DAMAGE_DEALT,
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

export function detectCreatureDeathTriggers(
  state: GameState,
  deadCardId: CardInstanceId | undefined,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (
        ability.trigger.event === "dies" ||
        ability.trigger.event === "creatureDies"
      ) {
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
          sourceCardId: deadCardId,
          triggerType: TriggerConditionType.CREATURE_DIES,
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

  if (deadCardId) {
    const deadCard = state.cards.get(deadCardId);
    if (deadCard && deadCard.blitz === true) {
      const deathContext: TriggerDetectionContext = {
        sourceCardId: deadCardId,
        triggerType: TriggerConditionType.CREATURE_DIES,
      };
      triggers.push({
        id: generateTriggeredAbilityId(),
        sourceCardId: deadCardId,
        triggeringPlayerId: deadCard.controllerId,
        triggerCondition: "dies",
        effect: "draw a card",
        timestamp: Date.now(),
        sourceCardTimestamp: deadCard.enteredBattlefieldTimestamp,
        context: deathContext as any,
      });
    }

    if (deadCard && hasCorpseAbility(deadCard)) {
      const ability = getCorpseAbility(deadCard);
      const corpseContext: TriggerDetectionContext = {
        sourceCardId: deadCardId,
        triggerType: TriggerConditionType.CREATURE_DIES,
      };
      triggers.push({
        id: generateTriggeredAbilityId(),
        sourceCardId: deadCardId,
        triggeringPlayerId: deadCard.controllerId,
        triggerCondition: "dies",
        effect:
          ability != null
            ? `Corpse ${ability.cost}: when this creature dies, you may pay ${ability.cost}. If you do, ${
                ability.effectDescription || "apply its effect"
              }`
            : "Corpse trigger",
        timestamp: Date.now(),
        sourceCardTimestamp: deadCard.enteredBattlefieldTimestamp,
        context: corpseContext as any,
      });
    }
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

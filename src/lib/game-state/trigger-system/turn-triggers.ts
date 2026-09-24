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

export function detectTurnStartTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (
        ability.trigger.event === "upkeep" ||
        ability.trigger.event === "turnBegins" ||
        ability.trigger.event === "beginningOfTurn"
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
          triggerType: TriggerConditionType.TURN_START,
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

export function detectUntapStepTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (ability.trigger.event === "untapStep") {
        if (card.controllerId !== activePlayerId) continue;

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
          triggerType: TriggerConditionType.UNTAP_STEP,
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

export function detectTurnEndTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (
        ability.trigger.event === "turnEnds" ||
        ability.trigger.event === "phaseEnds" ||
        ability.trigger.event === "endOfTurn" ||
        ability.trigger.event === "cleanupStep"
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
          triggerType: TriggerConditionType.TURN_END,
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

  for (const blitzId of blitzEndStepSourceIds(state)) {
    const card = state.cards.get(blitzId);
    if (!card) continue;
    const endContext: TriggerDetectionContext = {
      sourceCardId: blitzId,
      triggerType: TriggerConditionType.TURN_END,
    };
    triggers.push({
      id: generateTriggeredAbilityId(),
      sourceCardId: blitzId,
      triggeringPlayerId: card.controllerId,
      triggerCondition: "endOfTurn",
      effect: "sacrifice this creature",
      timestamp: Date.now(),
      sourceCardTimestamp: card.enteredBattlefieldTimestamp,
      context: endContext as any,
    });
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

function blitzEndStepSourceIds(
  state: GameState,
): import("../types").CardInstanceId[] {
  const ids: import("../types").CardInstanceId[] = [];
  for (const [cardId, card] of state.cards) {
    if (card.blitz === true && isOnBattlefield(state, cardId)) {
      ids.push(cardId);
    }
  }
  return ids;
}

export function detectBlitzEndStepTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const blitzId of blitzEndStepSourceIds(state)) {
    const card = state.cards.get(blitzId);
    if (!card) continue;
    const context: TriggerDetectionContext = {
      sourceCardId: blitzId,
      triggerType: TriggerConditionType.TURN_END,
    };
    triggers.push({
      id: generateTriggeredAbilityId(),
      sourceCardId: blitzId,
      triggeringPlayerId: card.controllerId,
      triggerCondition: "endOfTurn",
      effect: "sacrifice this creature",
      timestamp: Date.now(),
      sourceCardTimestamp: card.enteredBattlefieldTimestamp,
      context: context as any,
    });
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

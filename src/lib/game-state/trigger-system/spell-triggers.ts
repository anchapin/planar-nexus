import type { GameState, PlayerId, CardInstanceId } from "../types";
import type { TriggeredAbilityInstance } from "../abilities";
import {
  isOnBattlefield,
  TriggerConditionType,
  TriggerDetectionContext,
  generateTriggeredAbilityId,
  getTriggeredAbilitiesFromCard,
} from "./types";
import { hasProwess, getProwessInstanceCount } from "./types";
import { evaluateInterveningIfClause } from "../abilities";
import { sortTriggersAPNAP } from "./stack-ops";

function evaluateStateCondition(
  condition: string,
  state: GameState,
  playerId: PlayerId,
): boolean {
  return evaluateInterveningIfClause(condition, state, playerId);
}

export function detectLifeLossTriggers(
  state: GameState,
  playerId: PlayerId,
  lifeLostAmount: number,
  sourceId: CardInstanceId | undefined,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (ability.trigger.event === "lifeLost") {
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
          lifeLostPlayer: playerId,
          lifeLostAmount,
          sourceCardId: sourceId,
          triggerType: TriggerConditionType.LIFE_LOSS,
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

export function detectSpellCastTriggers(
  state: GameState,
  spellCardId: CardInstanceId,
  castingPlayerId: PlayerId,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];
  const spellCard = state.cards.get(spellCardId);
  if (!spellCard) return triggers;

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (
        ability.trigger.event === "spellCast" ||
        ability.trigger.event === "cast"
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
          spellCardId,
          triggerType: TriggerConditionType.SPELL_CAST,
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

export function detectStormTrigger(
  state: GameState,
  stackObjectId: string,
): { shouldFire: boolean; copyCount: number } {
  const obj = state.stack.find((o) => o.id === stackObjectId);
  if (!obj || !obj.storm) {
    return { shouldFire: false, copyCount: 0 };
  }
  const controller = state.players.get(obj.controllerId);
  const castThisTurn = controller?.spellsCastThisTurn ?? 0;
  const copyCount = Math.max(0, castThisTurn - 1);
  return { shouldFire: copyCount > 0, copyCount };
}

export function detectProwessTriggers(
  state: GameState,
  spellCardId: CardInstanceId,
  castingPlayerId: PlayerId,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  const spellCard = state.cards.get(spellCardId);
  if (!spellCard) return triggers;

  const spellTypeLine = spellCard.cardData.type_line?.toLowerCase() || "";
  if (spellTypeLine.includes("creature")) {
    return triggers;
  }

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;
    if (card.controllerId !== castingPlayerId) continue;
    if (!hasProwess(card)) continue;

    const instances = getProwessInstanceCount(card);
    const context: TriggerDetectionContext = {
      spellCardId,
      triggerType: TriggerConditionType.SPELL_CAST,
    };

    for (let i = 0; i < instances; i++) {
      triggers.push({
        id: generateTriggeredAbilityId(),
        sourceCardId: cardId,
        triggeringPlayerId: card.controllerId,
        triggerCondition: "spellCast",
        effect: "Prowess — This creature gets +1/+1 until end of turn.",
        timestamp: Date.now(),
        sourceCardTimestamp: card.enteredBattlefieldTimestamp,
        context: context as any,
      });
    }
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

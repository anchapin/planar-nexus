import type { GameState, PlayerId, CardInstanceId } from "../types";
import type { TriggeredAbilityInstance } from "../abilities";
import {
  isOnBattlefield,
  isCreature,
  TriggerConditionType,
  TriggerDetectionContext,
  generateTriggeredAbilityId,
  parseRenown,
  parseTribute,
} from "./types";
import { sortTriggersAPNAP } from "./stack-ops";

export function detectRenownEtbTriggers(
  state: GameState,
  enteringCardId: CardInstanceId,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  const card = state.cards.get(enteringCardId);
  if (!card) return triggers;
  if (!isOnBattlefield(state, enteringCardId)) return triggers;

  if (!isCreature(card)) return triggers;

  const info = parseRenown(card.cardData.oracle_text || "");
  if (!info.hasRenown) return triggers;
  const count = info.renownCount ?? 0;
  if (count <= 0) return triggers;

  if (card.renowned === true) return triggers;

  const context: TriggerDetectionContext = {
    sourceCardId: enteringCardId,
    triggerType: TriggerConditionType.ETB,
  };

  triggers.push({
    id: generateTriggeredAbilityId(),
    sourceCardId: enteringCardId,
    triggeringPlayerId: card.controllerId,
    triggerCondition: "entersBattlefield",
    effect: `Renown ${count} — when this creature enters the battlefield, if it isn't renowned, put ${count} +1/+1 counters on it and it becomes renowned.`,
    timestamp: Date.now(),
    sourceCardTimestamp: card.enteredBattlefieldTimestamp,
    context: context as any,
  });

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

export function detectTributeEtbTriggers(
  state: GameState,
  enteringCardId: CardInstanceId,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  const card = state.cards.get(enteringCardId);
  if (!card) return triggers;
  if (!isOnBattlefield(state, enteringCardId)) return triggers;

  if (!isCreature(card)) return triggers;

  const info = parseTribute(card.cardData.oracle_text || "");
  if (!info.hasTribute) return triggers;
  const count = info.tributeCount ?? 0;
  if (count <= 0) return triggers;

  const context: TriggerDetectionContext = {
    sourceCardId: enteringCardId,
    triggerType: TriggerConditionType.ETB,
  };

  triggers.push({
    id: generateTriggeredAbilityId(),
    sourceCardId: enteringCardId,
    triggeringPlayerId: card.controllerId,
    triggerCondition: "entersBattlefield",
    effect: `Tribute ${count} — as this creature enters the battlefield, an opponent may pay ${count}. If they decline, the printed effect fires.`,
    timestamp: Date.now(),
    sourceCardTimestamp: card.enteredBattlefieldTimestamp,
    context: context as any,
  });

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

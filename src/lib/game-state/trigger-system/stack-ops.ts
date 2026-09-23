import type { GameState, PlayerId, StackObject } from "../types";
import type { TriggeredAbilityInstance } from "../abilities";
import type { TriggerResult } from "./types";

export function putTriggersOnStack(
  state: GameState,
  triggers: TriggeredAbilityInstance[],
): TriggerResult {
  let currentState = state;
  const descriptions: string[] = [];

  for (const trigger of triggers) {
    const card = currentState.cards.get(trigger.sourceCardId);
    if (!card) continue;

    const stackObject: StackObject = {
      id: trigger.id,
      type: "ability",
      sourceCardId: trigger.sourceCardId,
      controllerId: card.controllerId,
      name: `${card.cardData.name} triggered ability`,
      text: trigger.effect,
      manaCost: null,
      targets: [],
      chosenModes: [],
      variableValues: new Map(),
      isCountered: false,
      timestamp: trigger.timestamp,
      interveningIf: trigger.interveningIf,
    };

    currentState = {
      ...currentState,
      stack: [...currentState.stack, stackObject],
      lastModifiedAt: Date.now(),
    };

    descriptions.push(
      `${card.cardData.name}'s triggered ability (${trigger.triggerCondition}) was put on the stack`,
    );
  }

  return {
    state: currentState,
    triggeredAbilities: triggers,
    descriptions,
  };
}

export function sortTriggersAPNAP(
  triggers: TriggeredAbilityInstance[],
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  return [...triggers].sort((a, b) => {
    const aIsActive = a.triggeringPlayerId === activePlayerId;
    const bIsActive = b.triggeringPlayerId === activePlayerId;

    if (aIsActive && !bIsActive) return -1;
    if (!aIsActive && bIsActive) return 1;

    if (aIsActive && bIsActive) {
      if (a.sourceCardTimestamp !== b.sourceCardTimestamp) {
        return a.sourceCardTimestamp - b.sourceCardTimestamp;
      }
      return 0;
    }

    const playerIds = Array.from(state.players.keys());
    const activeIndex = playerIds.indexOf(activePlayerId);

    const aPosition =
      (playerIds.indexOf(a.triggeringPlayerId) -
        activeIndex +
        playerIds.length) %
      playerIds.length;
    const bPosition =
      (playerIds.indexOf(b.triggeringPlayerId) -
        activeIndex +
        playerIds.length) %
      playerIds.length;

    if (aPosition !== bPosition) {
      return aPosition - bPosition;
    }

    if (a.sourceCardTimestamp !== b.sourceCardTimestamp) {
      return a.sourceCardTimestamp - b.sourceCardTimestamp;
    }

    return 0;
  });
}

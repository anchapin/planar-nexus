import type { GameState, StackObject } from "../types";
import { createEngineUncaughtException } from "../errors";
import { detectTriggeredAbilities } from "./triggered";
import type {
  TriggerEvent,
  TriggerContext,
  TriggeredAbilityResult,
} from "./types";

export function checkTriggeredAbilities(
  state: GameState,
  event: TriggerEvent,
  context?: TriggerContext,
): TriggeredAbilityResult {
  const originalState = state;
  try {
    const triggeredAbilities = detectTriggeredAbilities(state, event, context);

    let currentState = state;

    for (const trigger of triggeredAbilities) {
      const card = state.cards.get(trigger.sourceCardId);
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

      const updatedStack = [...currentState.stack, stackObject];
      currentState = {
        ...currentState,
        stack: updatedStack,
      };
    }

    return {
      abilities: triggeredAbilities,
      state: currentState,
    };
  } catch (err) {
    void createEngineUncaughtException(
      err,
      "checkTriggeredAbilities",
      originalState,
    );
    return {
      abilities: [],
      state: originalState,
    };
  }
}

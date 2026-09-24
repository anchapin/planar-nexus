import type { GameState } from "../types";
import { isOnBattlefield } from "../types";
import { getTriggeredAbilities } from "./parse";
import { generateTriggeredAbilityId } from "./ids";
import { evaluateInterveningIfClause } from "./evaluate";
import type {
  TriggerEvent,
  TriggerContext,
  TriggeredAbilityInstance,
} from "./types";

export function detectTriggeredAbilities(
  state: GameState,
  event: TriggerEvent,
  context?: TriggerContext,
): TriggeredAbilityInstance[] {
  const triggeredAbilities: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilities(card.cardData);

    for (const ability of abilities) {
      let shouldTrigger = false;

      switch (event) {
        case "entersBattlefield":
          shouldTrigger = ability.trigger.event === "entersBattlefield";
          break;
        case "leavesBattlefield":
          shouldTrigger =
            ability.trigger.event === "leavesBattlefield" ||
            ability.trigger.event === "dies";
          break;
        case "damageDealt":
          shouldTrigger = ability.trigger.event === "damageDealt";
          break;
        case "dies":
        case "creatureDies":
          shouldTrigger = ability.trigger.event === "dies";
          break;
        case "attacked":
          shouldTrigger = ability.trigger.event === "attacked";
          break;
        case "phaseChange":
        case "beginningOfTurn":
          shouldTrigger =
            ability.trigger.event === "upkeep" ||
            ability.trigger.event === "phaseEnds" ||
            ability.trigger.event === "turnEnds" ||
            ability.trigger.event === "turnBegins" ||
            ability.trigger.event === "beginningOfTurn";
          break;
        case "endOfTurn":
          shouldTrigger =
            ability.trigger.event === "turnEnds" ||
            ability.trigger.event === "phaseEnds" ||
            ability.trigger.event === "endOfTurn" ||
            ability.trigger.event === "cleanupStep";
          break;
        case "drawCard":
          shouldTrigger = ability.trigger.event === "drawStep";
          break;
        case "cast":
        case "spellCast":
          shouldTrigger =
            ability.trigger.event === "cast" ||
            ability.trigger.event === "spellCast" ||
            ability.trigger.event === "abilityActivated";
          break;
        case "lifeGain":
          shouldTrigger = ability.trigger.event === "lifeGain";
          break;
        case "lifeLost":
          shouldTrigger = ability.trigger.event === "lifeLost";
          break;
      }

      if (shouldTrigger && ability.interveningIf) {
        shouldTrigger = evaluateInterveningIfClause(
          ability.interveningIf,
          state,
          card.controllerId,
          card,
          context,
        );
      }

      if (shouldTrigger) {
        const sourceCardTimestamp = card.enteredBattlefieldTimestamp;
        triggeredAbilities.push({
          id: generateTriggeredAbilityId(),
          sourceCardId: cardId,
          triggeringPlayerId: card.controllerId,
          triggerCondition: ability.trigger.event,
          effect: ability.effect,
          timestamp: Date.now(),
          sourceCardTimestamp,
          context,
          interveningIf: ability.interveningIf,
        });
      }
    }
  }

  triggeredAbilities.sort((a, b) => {
    const activePlayerId = state.turn.activePlayerId;
    const playerIds = Array.from(state.players.keys());

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

  return triggeredAbilities;
}

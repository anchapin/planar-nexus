import type { GameState, CardInstance, CardInstanceId } from "../types";
import type { TriggerCondition } from "../oracle-text-parser/abilities";
import { isOnBattlefield } from "../types";
import { getTriggeredAbilities } from "./parse";
import { generateTriggeredAbilityId } from "./ids";
import { evaluateInterveningIfClause } from "./evaluate";
import { evaluateTriggerWhileCondition } from "../keyword-actions/ferocious";
import type {
  TriggerEvent,
  TriggerContext,
  TriggeredAbilityInstance,
} from "./types";

/**
 * CR 603.6a: does this ETB trigger care about the permanent that entered?
 * Without an `enteringCardId` in the context (older callers) every ETB
 * trigger fires, as before.
 */
function entersTriggerMatches(
  state: GameState,
  cardId: CardInstanceId,
  card: CardInstance,
  trigger: TriggerCondition,
  context?: TriggerContext,
): boolean {
  return subjectMatches(state, cardId, card, trigger, context?.enteringCardId);
}

/**
 * Does the permanent an enters/dies/attack trigger watches match its subject
 * ("this creature", "another creature you control", "a creature")? Without a
 * subject id (older callers) every such trigger fires, as before.
 */
function subjectMatches(
  state: GameState,
  cardId: CardInstanceId,
  card: CardInstance,
  trigger: TriggerCondition,
  enteringId: CardInstanceId | undefined,
): boolean {
  if (!enteringId || !trigger.subject) return true;
  if (trigger.subject === "self") return enteringId === cardId;
  if (trigger.subject === "another" && enteringId === cardId) return false;
  const entering = state.cards.get(enteringId);
  if (!entering) return false;
  const filter = trigger.enteringFilter;
  if (!filter) return true;
  const typeLine = (entering.cardData.type_line ?? "").toLowerCase();
  if (
    filter.types.length > 0 &&
    !filter.types.some((type) => typeLine.includes(type))
  ) {
    return false;
  }
  if (
    filter.controller === "you" &&
    entering.controllerId !== card.controllerId
  )
    return false;
  if (
    filter.controller === "opponent" &&
    entering.controllerId === card.controllerId
  )
    return false;
  if (filter.nontoken && entering.isToken) return false;
  return true;
}

/** CR 508.1m: does an attack trigger care about this attacker? */
function attackTriggerMatches(
  state: GameState,
  cardId: CardInstanceId,
  card: CardInstance,
  trigger: TriggerCondition,
  context?: TriggerContext,
): boolean {
  const attackerId = context?.attackerId;
  if (!attackerId) return true;
  // "this creature attacks" with no subject parsed is about itself.
  if (!trigger.subject && attackerId !== cardId) return false;
  if (!subjectMatches(state, cardId, card, trigger, attackerId)) return false;
  const filter = trigger.attackFilter;
  if (filter?.alone && context?.attackerCount !== 1) return false;
  if (filter?.defenderIsYou && context?.attackDefenderId !== card.controllerId)
    return false;
  return true;
}

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
          shouldTrigger =
            ability.trigger.event === "entersBattlefield" &&
            entersTriggerMatches(state, cardId, card, ability.trigger, context);
          break;
        case "landfall":
          shouldTrigger =
            ability.trigger.event === "landfall" &&
            context?.landControllerId === card.controllerId;
          break;
        case "leavesBattlefield":
          shouldTrigger =
            ability.trigger.event === "leavesBattlefield" ||
            ability.trigger.event === "dies";
          break;
        case "damageDealt":
          shouldTrigger = ability.trigger.event === "damageDealt";
          break;
        case "dealsCombatDamageToPlayer":
          // "Whenever this creature deals combat damage to a player" (#2428).
          shouldTrigger =
            ability.trigger.event === "dealsCombatDamageToPlayer" &&
            context?.sourceCardId === cardId;
          break;
        case "dies":
        case "creatureDies":
          // CR 603.10a: a self dies trigger with no subject parsed ("when ~
          // is put into a graveyard from the battlefield") is about itself.
          shouldTrigger =
            ability.trigger.event === "dies" &&
            (context?.dyingCardId && !ability.trigger.subject
              ? context.dyingCardId === cardId
              : subjectMatches(
                  state,
                  cardId,
                  card,
                  ability.trigger,
                  context?.dyingCardId,
                ));
          break;
        case "attacked":
          shouldTrigger =
            ability.trigger.event === "attacked" &&
            attackTriggerMatches(state, cardId, card, ability.trigger, context);
          break;
        case "upkeep": {
          const whose = context?.upkeepPlayerId;
          const of = ability.trigger.upkeepOf ?? "you";
          shouldTrigger =
            ability.trigger.event === "upkeep" &&
            (!whose ||
              of === "each" ||
              (of === "you" && whose === card.controllerId) ||
              (of === "opponent" && whose !== card.controllerId));
          break;
        }
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

      // CR 603.2: a "while" clause is part of the trigger event; an
      // unrecognised one leaves the trigger ungated, as before.
      if (shouldTrigger && ability.whileCondition) {
        shouldTrigger =
          evaluateTriggerWhileCondition(
            ability.whileCondition,
            state,
            card.controllerId,
          ) ?? true;
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

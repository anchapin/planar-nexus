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

function warpEndStepTriggers(state: GameState): TriggeredAbilityInstance[] {
  const out: TriggeredAbilityInstance[] = [];
  for (const [cardId, card] of state.cards) {
    if (card.warp !== true || !isOnBattlefield(state, cardId)) continue;
    const context: TriggerDetectionContext = {
      sourceCardId: cardId,
      triggerType: TriggerConditionType.TURN_END,
    };
    out.push({
      id: generateTriggeredAbilityId(),
      sourceCardId: cardId,
      triggeringPlayerId: card.controllerId,
      triggerCondition: "endOfTurn",
      effect: "exile this permanent (warp)",
      timestamp: Date.now(),
      sourceCardTimestamp: card.enteredBattlefieldTimestamp,
      context: context as any,
    });
  }
  return out;
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
  // CR 702.185a: warp's delayed "exile at the next end step" rides the same
  // end-step pass as blitz.
  triggers.push(...warpEndStepTriggers(state));

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

/**
 * "At the beginning of your end step" / "at the beginning of each end step"
 * printed triggers (CR 513.1a, issue #2448). Read from the card's own oracle
 * lines so "your" (active player's permanents only) and "each" stay distinct,
 * and so delayed "next end step" wording inside an effect never fires here.
 * An optional ability word ("Raid — ") and intervening "if" clause are kept.
 */
const END_STEP_TRIGGER =
  /^(?:[A-Z][\w' ]*\s+\u2014\s+)?at the beginning of (your|each) end step,\s*(?:if ([^,]+),\s*)?(.+)$/i;

export function parseEndStepTriggers(
  oracleText: string,
): { scope: "your" | "each"; interveningIf?: string; effect: string }[] {
  const out: {
    scope: "your" | "each";
    interveningIf?: string;
    effect: string;
  }[] = [];
  for (const raw of oracleText.split("\n")) {
    const m = raw.trim().match(END_STEP_TRIGGER);
    if (!m) continue;
    out.push({
      scope: m[1].toLowerCase() as "your" | "each",
      interveningIf: m[2]?.trim(),
      effect: m[3].trim().replace(/\.$/, ""),
    });
  }
  return out;
}

export function detectEndStepTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;
    for (const t of parseEndStepTriggers(card.cardData.oracle_text || "")) {
      if (t.scope === "your" && card.controllerId !== activePlayerId) continue;
      // CR 603.4: an intervening "if" must be true when the trigger event
      // occurs; it is checked again on resolution.
      if (
        t.interveningIf &&
        !evaluateStateCondition(t.interveningIf, state, card.controllerId)
      ) {
        continue;
      }
      const context: TriggerDetectionContext = {
        sourceCardId: cardId,
        triggerType: TriggerConditionType.TURN_END,
      };
      triggers.push({
        id: generateTriggeredAbilityId(),
        sourceCardId: cardId,
        triggeringPlayerId: card.controllerId,
        triggerCondition: "phaseEnds",
        effect: t.effect,
        timestamp: Date.now(),
        sourceCardTimestamp: card.enteredBattlefieldTimestamp,
        interveningIf: t.interveningIf,
        context: context as any,
      });
    }
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

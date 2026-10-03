/**
 * Cards-drawn-this-turn tracking and "at the beginning of combat on your
 * turn" triggers (issue #2428, Proft's Eidetic Memory).
 *
 * - Every draw bumps `Player.cardsDrawnThisTurn`; the counter resets when a
 *   new turn begins.
 * - "if you've drawn more than N cards this turn" intervening-if (CR 603.4).
 * - Beginning-of-combat triggers (CR 507.1) go on the stack as the
 *   beginning-of-combat step starts. A "target creature you control" trigger
 *   gets its target when it is put on the stack (CR 603.3d); with no legal
 *   target it is removed from the stack.
 */
import type { CardInstanceId, GameState, PlayerId } from "../types";
import { isOnBattlefield } from "../types";
import type { TriggeredAbilityInstance } from "../abilities";
import {
  getTriggeredAbilitiesFromCard,
  generateTriggeredAbilityId,
} from "../trigger-system/types";
import {
  putTriggersOnStack,
  sortTriggersAPNAP,
} from "../trigger-system/stack-ops";
import { evaluateInterveningIfClause } from "../abilities/evaluate";

const WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
};

/** Number of cards `playerId` has drawn this turn. */
export function cardsDrawnThisTurn(
  state: GameState,
  playerId: PlayerId,
): number {
  return state.players.get(playerId)?.cardsDrawnThisTurn ?? 0;
}

/** Record that `playerId` drew `count` cards. */
export function recordCardsDrawn(
  state: GameState,
  playerId: PlayerId,
  count: number,
): GameState {
  if (count <= 0) return state;
  const player = state.players.get(playerId);
  if (!player) return state;
  const players = new Map(state.players);
  players.set(playerId, {
    ...player,
    cardsDrawnThisTurn: (player.cardsDrawnThisTurn ?? 0) + count,
  });
  return { ...state, players };
}

/**
 * "you've drawn more than one card this turn" -> 1. Returns null when the
 * condition is not a cards-drawn condition.
 */
export function drawnMoreThanThreshold(condition: string): number | null {
  const m = condition
    .toLowerCase()
    .match(/you(?:'ve| have) drawn more than (\w+) cards? this turn/);
  if (!m) return null;
  const n = WORDS[m[1]] ?? parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/** "...where X is the number of cards you've drawn this turn minus one" */
const COUNTERS_FROM_DRAWS =
  /put x \+1\/\+1 counters? on target creature you control,? where x is the number of cards you(?:'ve| have) drawn this turn(?: minus (\w+))?/;

export function parseCountersFromDraws(
  lower: string,
  controllerId: PlayerId,
): { offset: number; playerId: PlayerId } | null {
  const m = lower.match(COUNTERS_FROM_DRAWS);
  if (!m) return null;
  const minus = m[1] ? (WORDS[m[1]] ?? parseInt(m[1], 10)) : 0;
  return {
    offset: Number.isFinite(minus) ? -minus : 0,
    playerId: controllerId,
  };
}

/** Detect the active player's "beginning of combat on your turn" triggers. */
export function detectBeginningOfCombatTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];
  for (const [cardId, card] of state.cards) {
    if (card.controllerId !== activePlayerId) continue;
    if (!isOnBattlefield(state, cardId)) continue;
    for (const ability of getTriggeredAbilitiesFromCard(card.cardData)) {
      if (ability.trigger.event !== "beginningOfCombat") continue;
      if (
        ability.interveningIf &&
        !evaluateInterveningIfClause(
          ability.interveningIf,
          state,
          card.controllerId,
          card,
        )
      ) {
        continue;
      }
      triggers.push({
        id: generateTriggeredAbilityId(),
        sourceCardId: cardId,
        triggeringPlayerId: card.controllerId,
        triggerCondition: ability.trigger.event,
        effect: ability.effect,
        timestamp: Date.now(),
        sourceCardTimestamp: card.enteredBattlefieldTimestamp,
        interveningIf: ability.interveningIf,
      } as TriggeredAbilityInstance);
    }
  }
  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

/** Creature the controller controls with the highest power (default target). */
function bestOwnCreature(
  state: GameState,
  playerId: PlayerId,
): CardInstanceId | null {
  const bf = state.zones.get(`${playerId}-battlefield`)?.cardIds ?? [];
  let best: CardInstanceId | null = null;
  let bestPower = -Infinity;
  for (const id of bf) {
    const card = state.cards.get(id);
    if (!card) continue;
    const typeLine = (card.cardData.type_line ?? "").toLowerCase();
    const isCreature =
      typeLine.includes("creature") || Boolean(card.turnCreatureForm);
    if (!isCreature) continue;
    const plus = card.counters.find((c) => c.type === "+1/+1")?.count ?? 0;
    const power =
      parseInt(card.cardData.power ?? "0", 10) +
      plus +
      (card.powerModifier ?? 0);
    if (power > bestPower) {
      bestPower = power;
      best = id;
    }
  }
  return best;
}

/**
 * Put the active player's beginning-of-combat triggers on the stack and pick
 * targets for "target creature you control" ones.
 */
export function processBeginningOfCombat(state: GameState): GameState {
  const triggers = detectBeginningOfCombatTriggers(
    state,
    state.turn.activePlayerId,
  );
  if (triggers.length === 0) return state;
  const ids = new Set(triggers.map((t) => t.id));
  let next = putTriggersOnStack(state, triggers).state;
  const stack = [];
  for (const obj of next.stack) {
    if (
      !ids.has(obj.id) ||
      !/target creature you control/i.test(obj.text ?? "")
    ) {
      stack.push(obj);
      continue;
    }
    const target = bestOwnCreature(next, obj.controllerId);
    if (!target) continue; // CR 603.3d: no legal target, removed from the stack
    stack.push({
      ...obj,
      targets: [{ type: "card" as const, targetId: target, isValid: true }],
    });
  }
  next = { ...next, stack };
  return next;
}

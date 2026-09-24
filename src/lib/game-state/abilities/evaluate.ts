import type { GameState, PlayerId, CardInstance } from "../types";
import type { TriggerContext } from "./types";
import { isOnBattlefield } from "../types";

export function evaluateInterveningIfClause(
  condition: string,
  state: GameState,
  controllerId: PlayerId,
  _sourceCard?: CardInstance,
  _context?: TriggerContext,
): boolean {
  const c = condition.toLowerCase().trim();

  const negate = /^(you (?:do not|don't) control|you control no)\b/.test(c);

  let m = c.match(/you have (\d+) or less life/);
  if (m) {
    const player = state.players.get(controllerId);
    return player ? player.life <= parseInt(m[1], 10) : false;
  }
  m = c.match(/you have (\d+) or more life/);
  if (m) {
    const player = state.players.get(controllerId);
    return player ? player.life >= parseInt(m[1], 10) : false;
  }
  m = c.match(/your life total is (\d+) or less/);
  if (m) {
    const player = state.players.get(controllerId);
    return player ? player.life <= parseInt(m[1], 10) : false;
  }
  m = c.match(/your life total is (\d+) or (?:greater|more)/);
  if (m) {
    const player = state.players.get(controllerId);
    return player ? player.life >= parseInt(m[1], 10) : false;
  }

  m = c.match(/you have (\d+) or more poison counters/);
  if (m) {
    const player = state.players.get(controllerId);
    return player ? player.poisonCounters >= parseInt(m[1], 10) : false;
  }
  m = c.match(/you have (\d+) or (?:fewer|less) poison counters/);
  if (m) {
    const player = state.players.get(controllerId);
    return player ? player.poisonCounters <= parseInt(m[1], 10) : false;
  }

  m = c.match(/you have (\d+) or more cards in (?:your )?hand/);
  if (m) {
    const zone = state.zones.get(`${controllerId}-hand`);
    return zone ? zone.cardIds.length >= parseInt(m[1], 10) : false;
  }
  m = c.match(/you have (\d+) or (?:fewer|less) cards in (?:your )?hand/);
  if (m) {
    const zone = state.zones.get(`${controllerId}-hand`);
    return zone ? zone.cardIds.length <= parseInt(m[1], 10) : false;
  }

  m = c.match(/you control (\d+) or more (\w+?)(?:s)?(?:\b|$)/);
  if (m) {
    const result =
      countControlledByType(state, controllerId, m[2]) >= parseInt(m[1], 10);
    return result;
  }
  m = c.match(/^you control (?:an?|another)\s+(\w+?)\b/);
  if (m) {
    const result = countControlledByType(state, controllerId, m[1]) >= 1;
    return negate ? !result : result;
  }
  m = c.match(
    /(?:you control no|you do not control a|you don't control an?)\s+(\w+?)\b/,
  );
  if (m) {
    return countControlledByType(state, controllerId, m[1]) === 0;
  }

  return false;
}

function countControlledByType(
  state: GameState,
  playerId: PlayerId,
  type: string,
): number {
  const needle = type.toLowerCase();
  let count = 0;
  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;
    if (card.controllerId !== playerId) continue;
    const typeLine = (card.cardData.type_line || "").toLowerCase();
    if (typeLine.includes(needle)) count++;
  }
  return count;
}

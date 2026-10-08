import type { GameState, PlayerId, CardInstance } from "../types";
import type { TriggerContext } from "./types";
import { isOnBattlefield } from "../types";
import { RAID_CONDITION, hasAttackedThisTurn } from "../keyword-actions/raid";
import {
  controlsCreatureWithPowerAtLeast,
  ferociousThreshold,
} from "../keyword-actions/ferocious";
import {
  MORBID_CONDITION,
  hasCreatureDiedThisTurn,
} from "../keyword-actions/morbid";
import {
  cardsDrawnThisTurn,
  drawnMoreThanThreshold,
} from "../keyword-actions/cards-drawn";

export function evaluateInterveningIfClause(
  condition: string,
  state: GameState,
  controllerId: PlayerId,
  _sourceCard?: CardInstance,
  _context?: TriggerContext,
): boolean {
  const c = condition.toLowerCase().trim();

  const negate = /^(you (?:do not|don't) control|you control no)\b/.test(c);

  // "an opponent lost life this turn" (Hired Claw, #2614; the counter
  // spectacle reads, CR 702.135a).
  if (/^(?:if )?an opponent (?:has )?lost life this turn$/.test(c)) {
    for (const [id, p] of state.players) {
      if (id !== controllerId && (p.lastTurnLifeLost ?? 0) > 0) return true;
    }
    return false;
  }

  // Raid: "if you attacked this turn".
  if (RAID_CONDITION.test(c)) {
    return hasAttackedThisTurn(state, controllerId);
  }

  // Morbid: "if a creature died this turn" (any controller's creature).
  if (MORBID_CONDITION.test(c)) {
    return hasCreatureDiedThisTurn(state);
  }

  // "if you've drawn more than one card this turn" (issue #2428).
  const drawn = drawnMoreThanThreshold(c);
  if (drawn !== null) {
    return cardsDrawnThisTurn(state, controllerId) > drawn;
  }

  // Ferocious: "if you control a creature with power 4 or greater". Checked
  // before the generic "you control a <type>" match below, which would
  // otherwise read it as "you control a creature" and ignore the power.
  const ferocious = ferociousThreshold(c);
  if (ferocious !== null) {
    return controlsCreatureWithPowerAtLeast(state, controllerId, ferocious);
  }

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

  // Threshold (issue #2300): "there are seven or more cards in your graveyard".
  m = c.match(
    /there are (\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more cards in your graveyard/,
  );
  if (m) {
    const words = [
      "zero",
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
      "nine",
      "ten",
    ];
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : words.indexOf(m[1]);
    const zone = state.zones.get(`${controllerId}-graveyard`);
    return (zone?.cardIds.length ?? 0) >= n;
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

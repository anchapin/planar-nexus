/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
} from "../types";
import type { TriggeredAbilityInstance } from "../abilities";
import { evaluateInterveningIfClause } from "../abilities";
import { hasProwess, getProwessInstanceCount } from "../evergreen-keywords";
import {
  parseTriggeredAbilities,
  parseRenown,
  parseTribute,
} from "../oracle-text-parser";
import { hasCorpseAbility, getCorpseAbility } from "../corpse-keyword";
import type { DungeonRoomCompletion } from "../dungeon-data";

export {
  isOnBattlefield,
  type GameState,
  type PlayerId,
  type CardInstanceId,
  type CardInstance,
} from "../types";
export { isCreature } from "../card-instance";
export { hasProwess, getProwessInstanceCount } from "../evergreen-keywords";
export { evaluateInterveningIfClause } from "../abilities";
export {
  parseTriggeredAbilities,
  parseRenown,
  parseTribute,
} from "../oracle-text-parser";
export { hasCorpseAbility, getCorpseAbility } from "../corpse-keyword";

export enum TriggerConditionType {
  TURN_START = "turnStart",
  UNTAP_STEP = "untapStep",
  TURN_END = "turnEnd",
  DAMAGE_DEALT = "damageDealt",
  CREATURE_DIES = "creatureDies",
  LIFE_LOSS = "lifeLoss",
  SPELL_CAST = "spellCast",
  ETB = "etb",
  STATE_CHANGE = "stateChange",
  MONARCHY_CHANGE = "monarchyChange",
}

export interface TriggerDetectionContext {
  sourceCardId?: CardInstanceId;
  damageAmount?: number;
  damageTarget?: PlayerId | CardInstanceId;
  lifeLostPlayer?: PlayerId;
  lifeLostAmount?: number;
  spellCardId?: CardInstanceId;
  triggerType: TriggerConditionType;
}

export interface TriggerResult {
  state: GameState;
  triggeredAbilities: TriggeredAbilityInstance[];
  descriptions: string[];
}

export interface DungeonRoomCompletionTrigger {
  id: string;
  playerId: PlayerId;
  dungeonId: string;
  dungeonName: string;
  roomId: string;
  roomName: string;
  effect: string;
  roomIndex: number;
  isFinalRoom: boolean;
  timestamp: number;
}

export function hasVentureIntoDungeonText(oracleText: string): boolean {
  return /\bventure into the dungeon\b/i.test(oracleText);
}

export function detectDungeonRoomCompletionTriggers(
  completion?: DungeonRoomCompletion | DungeonRoomCompletion[],
  playerId?: PlayerId,
): DungeonRoomCompletionTrigger[] {
  if (!completion || !playerId) return [];
  const completions = Array.isArray(completion) ? completion : [completion];
  return completions.map((room) => ({
    id: generateTriggeredAbilityId(),
    playerId,
    dungeonId: room.dungeonId,
    dungeonName: room.dungeonName,
    roomId: room.roomId,
    roomName: room.roomName,
    effect: room.effect,
    roomIndex: room.roomIndex,
    isFinalRoom: room.isFinalRoom,
    timestamp: Date.now(),
  }));
}

export function generateTriggeredAbilityId(): string {
  return `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export function evaluateStateCondition(
  condition: string,
  state: GameState,
  playerId: PlayerId,
): boolean {
  return evaluateInterveningIfClause(condition, state, playerId);
}

export function checkSpellTypeMatch(
  spellCard: CardInstance["cardData"],
  spellType: string,
): boolean {
  const typeLine = spellCard.type_line?.toLowerCase() || "";
  switch (spellType.toLowerCase()) {
    case "instant":
      return typeLine.includes("instant");
    case "sorcery":
      return typeLine.includes("sorcery");
    case "creature":
      return typeLine.includes("creature");
    case "artifact":
      return typeLine.includes("artifact");
    case "enchantment":
      return typeLine.includes("enchantment");
    case "planeswalker":
      return typeLine.includes("planeswalker");
    case "spell":
    case "any":
      return true;
    default:
      return false;
  }
}

interface ParsedAbility {
  trigger: {
    event: string;
    source?: string;
    spellType?: string;
  };
  effect: string;
  interveningIf?: string;
}

export function getTriggeredAbilitiesFromCard(
  cardData: CardInstance["cardData"],
): ParsedAbility[] {
  return parseTriggeredAbilities(cardData.oracle_text || "").map((parsed) => ({
    trigger: {
      event: parsed.trigger.event,
      source: parsed.trigger.source,
      spellType: undefined,
    },
    effect: parsed.effect,
    interveningIf: parsed.interveningIf,
  }));
}

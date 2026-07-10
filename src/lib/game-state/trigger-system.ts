/**
 * Triggered Ability System
 *
 * Implements MTG triggered abilities (CR 603) including:
 * - At-beginning-of-turn triggers (CR 603.2) - e.g., upkeep triggers
 * - At-end-of-turn triggers (CR 603.4) - e.g., "at end of turn" effects
 * - When-damage-is-dealt triggers - e.g., "whenever this creature deals damage"
 * - When-a-creature-dies triggers - e.g., "whenever a creature dies"
 * - When-a-player-losses-life triggers (CR 603.3)
 * - State triggers - e.g., "when you have 10 or less life"
 * - When-a-spell-is-cast triggers
 *
 * Reference: CR 603 - Handling Triggered Abilities, CR 704.5j - SBA timing
 *
 * Issue #856: Complete triggered ability system implementation
 */

import type {
  GameState,
  PlayerId,
  CardInstanceId,
  CardInstance,
  StackObject,
} from "./types";
import { Phase, ZoneType, isOnBattlefield } from "./types";
import { isCreature } from "./card-instance";
import type { TriggeredAbilityInstance } from "./abilities";
import { evaluateInterveningIfClause } from "./abilities";
import { hasProwess, getProwessInstanceCount } from "./evergreen-keywords";
import { parseTriggeredAbilities } from "./oracle-text-parser";
import type { DungeonRoomCompletion } from "../cards/dungeons";

/**
 * Trigger condition types for the new trigger system
 * These map to specific game events
 */
export enum TriggerConditionType {
  TURN_START = "turnStart", // Beginning of turn (upkeep triggers)
  UNTAP_STEP = "untapStep", // Beginning of the untap step (CR 502.3)
  TURN_END = "turnEnd", // End of turn
  DAMAGE_DEALT = "damageDealt", // When damage is dealt
  CREATURE_DIES = "creatureDies", // When a creature dies
  LIFE_LOSS = "lifeLoss", // When a player loses life
  SPELL_CAST = "spellCast", // When a spell is cast
  ETB = "etb", // Enters battlefield (already exists)
  STATE_CHANGE = "stateChange", // State-based trigger condition
  // Issue #1225 — monarchy (CR 704.5p). Fired when a player becomes the
  // monarch so that cards like `Regal Behemoth` and `Archpriest of Iona`
  // resolve their "Whenever you become the monarch" triggers.
  MONARCHY_CHANGE = "monarchyChange",
}

/**
 * Extended trigger context that includes all possible trigger info
 */
export interface TriggerDetectionContext {
  /** The source card ID that caused this trigger (for damage, dies, etc.) */
  sourceCardId?: CardInstanceId;
  /** The amount of damage dealt (for damageDealt triggers) */
  damageAmount?: number;
  /** The target of damage (player or card) */
  damageTarget?: PlayerId | CardInstanceId;
  /** The player who lost life (for lifeLost triggers) */
  lifeLostPlayer?: PlayerId;
  /** Amount of life lost */
  lifeLostAmount?: number;
  /** The spell that was cast (for spellCast triggers) */
  spellCardId?: CardInstanceId;
  /** Type of trigger being detected */
  triggerType: TriggerConditionType;
}

/**
 * Result of putting triggers on the stack
 */
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

/**
 * Generate a unique triggered ability ID
 */
function generateTriggeredAbilityId(): string {
  return `triggered-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Detect turn-start triggers (CR 603.2)
 * Called at the beginning of each turn, before any SBAs
 * Example: "At the beginning of your upkeep"
 */
export function detectTurnStartTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  // CR 603.2: Trigger conditions that check at beginning of turn
  // include "at beginning of turn", "at start of turn", "upkeep"
  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (
        ability.trigger.event === "upkeep" ||
        ability.trigger.event === "turnBegins" ||
        ability.trigger.event === "beginningOfTurn"
      ) {
        // Check intervening "if" conditions
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
          context: context as any, // Cast to existing TriggerContext type
        });
      }
    }
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

/**
 * Detect "beginning of your untap step" triggers (CR 502.3, CR 603.2).
 *
 * Called at the start of the discrete untap step. This is the hook point for
 * triggered abilities worded "At the beginning of your untap step, ...".
 *
 * Note: no player receives priority during the untap step (CR 502.3), so these
 * triggers are put on the stack and will receive priority during the upkeep step.
 */
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
        // "At the beginning of YOUR untap step" — only the active player's controller fires
        if (card.controllerId !== activePlayerId) continue;

        // Check intervening "if" conditions (CR 603.4)
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

/**
 * Detect turn-end triggers (CR 603.4)
 * Called at the end of each turn
 * Example: "At the beginning of the end step"
 */
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

  // CR 702.150a — Blitz delayed sacrifice. Every battlefield creature carrying
  // the blitz marker must be sacrificed "at the beginning of the next end
  // step". This is surfaced as a triggered ability here; deterministic
  // resolution also happens via applyBlitzEndStepSacrifice.
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

/**
 * IDs of battlefield creatures carrying the blitz marker (CR 702.150). These
 * are the sources of the delayed "sacrifice at the beginning of the next end
 * step" trigger.
 */
function blitzEndStepSourceIds(state: GameState): CardInstanceId[] {
  const ids: CardInstanceId[] = [];
  for (const [cardId, card] of state.cards) {
    if (card.blitz === true && isOnBattlefield(state, cardId)) {
      ids.push(cardId);
    }
  }
  return ids;
}

/**
 * Detect the delayed Blitz end-step sacrifice triggers (CR 702.150a).
 *
 * Returns a triggered-ability instance for each battlefield creature cast for
 * its blitz cost, ordering them APNAP. (Mirrors detectTurnEndTriggers but
 * scoped to the blitz delayed trigger.)
 */
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

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

/**
 * Detect damage-dealt triggers
 * Called when damage is dealt by a source
 * Example: "Whenever this creature deals damage to a player"
 */
export function detectDamageTriggers(
  state: GameState,
  sourceId: CardInstanceId,
  targetId: PlayerId | CardInstanceId,
  damageAmount: number,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];
  const sourceCard = state.cards.get(sourceId);
  if (!sourceCard) return triggers;

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (ability.trigger.event === "damageDealt") {
        // Check if this trigger's source matches the damage source
        // For "whenever this creature deals damage", cardId === sourceId
        // For "whenever a source deals damage", any source
        const isSelfTrigger = cardId === sourceId;
        const isAnySourceTrigger =
          !ability.trigger.source ||
          ability.trigger.source === "any" ||
          ability.trigger.source === "source";

        if (!isSelfTrigger && !isAnySourceTrigger) continue;

        // Check intervening "if" conditions
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
          sourceCardId: sourceId,
          damageAmount,
          damageTarget: targetId,
          triggerType: TriggerConditionType.DAMAGE_DEALT,
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

/**
 * Detect creature-death triggers
 * Called when a creature dies
 * Example: "Whenever a creature dies"
 */
export function detectCreatureDeathTriggers(
  state: GameState,
  deadCardId: CardInstanceId | undefined,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (
        ability.trigger.event === "dies" ||
        ability.trigger.event === "creatureDies"
      ) {
        // Check intervening "if" conditions
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
          sourceCardId: deadCardId,
          triggerType: TriggerConditionType.CREATURE_DIES,
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

  // CR 702.150a — Blitz dies-draw. A creature cast for its blitz cost has a
  // "When this creature dies, draw a card" triggered ability. The dead card is
  // already off the battlefield (so the ability loop above, which scans
  // battlefield sources, won't see it), but it remains in state.cards, so we
  // synthesize the trigger from its blitz marker. (Resolution/drawing is also
  // handled deterministically via resolveBlitzDeathDraw in the SBA path.)
  if (deadCardId) {
    const deadCard = state.cards.get(deadCardId);
    if (deadCard && deadCard.blitz === true) {
      const deathContext: TriggerDetectionContext = {
        sourceCardId: deadCardId,
        triggerType: TriggerConditionType.CREATURE_DIES,
      };
      triggers.push({
        id: generateTriggeredAbilityId(),
        sourceCardId: deadCardId,
        triggeringPlayerId: deadCard.controllerId,
        triggerCondition: "dies",
        effect: "draw a card",
        timestamp: Date.now(),
        sourceCardTimestamp: deadCard.enteredBattlefieldTimestamp,
        context: deathContext as any,
      });
    }
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

/**
 * Detect life-loss triggers
 * Called when a player loses life
 * Example: "Whenever you lose life"
 */
export function detectLifeLossTriggers(
  state: GameState,
  playerId: PlayerId,
  lifeLostAmount: number,
  sourceId: CardInstanceId | undefined,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (ability.trigger.event === "lifeLost") {
        // Check intervening "if" conditions
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
          lifeLostPlayer: playerId,
          lifeLostAmount,
          sourceCardId: sourceId,
          triggerType: TriggerConditionType.LIFE_LOSS,
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

/**
 * Detect spell-cast triggers
 * Called when a spell is cast
 * Example: "Whenever you cast a sorcery"
 */
export function detectSpellCastTriggers(
  state: GameState,
  spellCardId: CardInstanceId,
  castingPlayerId: PlayerId,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];
  const spellCard = state.cards.get(spellCardId);
  if (!spellCard) return triggers;

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (
        ability.trigger.event === "spellCast" ||
        ability.trigger.event === "cast"
      ) {
        // Check spell type condition if specified
        // e.g., "Whenever you cast a sorcery"
        if (ability.trigger.spellType) {
          const matchesType = checkSpellTypeMatch(
            spellCard.cardData,
            ability.trigger.spellType,
          );
          if (!matchesType) continue;
        }

        // Check intervening "if" conditions
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
          spellCardId,
          triggerType: TriggerConditionType.SPELL_CAST,
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

/**
 * Detect the Storm on-cast trigger (CR 702.41) for a spell on the stack.
 *
 * Storm is a triggered ability that reads: "When you cast this spell, copy it
 * for each spell cast before it this turn. If the spell has any targets, you
 * may choose new targets for any of the copies." This function is the detection
 * half of the mechanic: given a spell already on the stack, it reports whether
 * its storm trigger should fire and how many copies to create. The copy count
 * equals the number of spells the spell's controller CAST before this spell
 * this turn (the "storm count"), derived from `Player.spellsCastThisTurn`.
 *
 * `castSpell` increments `spellsCastThisTurn` AFTER pushing the spell onto the
 * stack, so the count includes the storm spell itself — hence the `- 1` (the
 * storm spell is never a copy of itself; CR 702.41a "spells cast BEFORE it").
 * The copies themselves are created by `copySpellOnStack` (CR 707.10) in
 * spell-casting.ts, which is also what enforces that copies do not re-trigger
 * storm (copies are not "cast").
 *
 * @returns `{ shouldFire, copyCount }` — `copyCount` is 0 when no copies are
 * created (e.g. the storm spell is the first spell cast this turn).
 */
export function detectStormTrigger(
  state: GameState,
  stackObjectId: string,
): { shouldFire: boolean; copyCount: number } {
  const obj = state.stack.find((o) => o.id === stackObjectId);
  if (!obj || !obj.storm) {
    return { shouldFire: false, copyCount: 0 };
  }
  const controller = state.players.get(obj.controllerId);
  const castThisTurn = controller?.spellsCastThisTurn ?? 0;
  // Subtract 1 for the storm spell itself, which was counted when it was cast.
  const copyCount = Math.max(0, castThisTurn - 1);
  return { shouldFire: copyCount > 0, copyCount };
}

/**
 * Detect the Prowess cast trigger (CR 702.108) for a spell being cast.
 *
 * Prowess is a triggered ability that reads: "Whenever you cast a noncreature
 * spell, this creature gets +1/+1 until end of turn." (CR 702.108a). This
 * function is the detection half: given the spell a player just cast, it
 * reports one trigger per prowess instance on each creature that player
 * controls on the battlefield — but ONLY when the cast spell is noncreature.
 * "Whenever you cast" means the trigger's source must be controlled by the
 * spell's caster (CR 702.108a). Multiple instances of prowess on the same
 * creature trigger separately (CR 702.108b), so each instance yields its own
 * trigger (and thus its own +1/+1).
 *
 * The +1/+1 is applied by `castSpell` (incrementing `prowessBoost`), read by
 * the layer-7 power/toughness path, and removed at end of turn.
 */
export function detectProwessTriggers(
  state: GameState,
  spellCardId: CardInstanceId,
  castingPlayerId: PlayerId,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  const spellCard = state.cards.get(spellCardId);
  if (!spellCard) return triggers;

  // CR 702.108a — only NONCREATURE spells trigger prowess.
  const spellTypeLine = spellCard.cardData.type_line?.toLowerCase() || "";
  if (spellTypeLine.includes("creature")) {
    return triggers;
  }

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;
    // "Whenever YOU cast" — only the caster's own prowess creatures trigger.
    if (card.controllerId !== castingPlayerId) continue;
    if (!hasProwess(card)) continue;

    // CR 702.108b — each instance of prowess triggers separately.
    const instances = getProwessInstanceCount(card);
    const context: TriggerDetectionContext = {
      spellCardId,
      triggerType: TriggerConditionType.SPELL_CAST,
    };

    for (let i = 0; i < instances; i++) {
      triggers.push({
        id: generateTriggeredAbilityId(),
        sourceCardId: cardId,
        triggeringPlayerId: card.controllerId,
        triggerCondition: "spellCast",
        effect: "Prowess — This creature gets +1/+1 until end of turn.",
        timestamp: Date.now(),
        sourceCardTimestamp: card.enteredBattlefieldTimestamp,
        context: context as any,
      });
    }
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

/**
 * Detect state-based triggers
 * Example: "When you have 10 or less life"
 * These check continuously at SBA points
 */
export function detectStateTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilitiesFromCard(card.cardData);
    for (const ability of abilities) {
      if (ability.trigger.event === "stateTrigger") {
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
          triggerType: TriggerConditionType.STATE_CHANGE,
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

/**
 * Issue #1225 — detect "Whenever you become the monarch" triggers.
 *
 * Fires on each battlefield permanent whose controller IS the current monarch
 * AND whose oracle text mentions becoming the monarch (e.g. `Regal Behemoth`,
 * `Calamity of the Ether`, `Akoum Hellhound`). The caller should invoke this
 * immediately after `setMonarch` so the trigger resolves as part of the same
 * SBA batch.
 *
 * We deliberately do not pull this through `parseTriggeredAbilities` because
 * that orchestrator would emit a generic "triggered ability" node whose
 * event category isn't yet wired through `oracle-text-parser`. Keeping a
 * dedicated, regex-based matcher contained here keeps the change surgical
 * (avoids touching `oracle-text-parser.ts` or downstream consumers).
 */
const BECOMES_MONARCH_PATTERN =
  /(?:whenever|when)\s+you\s+become(?:s)?\s+the\s+monarch/i;

export function detectMonarchyChangeTriggers(
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  const triggers: TriggeredAbilityInstance[] = [];

  // Identify the player who currently holds the monarchy.
  const monarchId = (() => {
    for (const [id, player] of state.players) {
      if (player.isMonarch) return id;
    }
    return null;
  })();
  if (monarchId === null) return triggers;

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;
    if (card.controllerId !== monarchId) continue;
    const oracle = card.cardData.oracle_text || "";
    if (!BECOMES_MONARCH_PATTERN.test(oracle)) continue;

    const context: TriggerDetectionContext = {
      triggerType: TriggerConditionType.MONARCHY_CHANGE,
      damageTarget: monarchId,
    };

    triggers.push({
      id: generateTriggeredAbilityId(),
      sourceCardId: cardId,
      triggeringPlayerId: card.controllerId,
      triggerCondition: "becomesMonarch",
      effect: oracle,
      timestamp: Date.now(),
      sourceCardTimestamp: card.enteredBattlefieldTimestamp,
      context: context as any,
    });
  }

  return sortTriggersAPNAP(triggers, state, activePlayerId);
}

/**
 * Put triggered abilities on the stack respecting APNAP ordering (CR 603.3)
 */
export function putTriggersOnStack(
  state: GameState,
  triggers: TriggeredAbilityInstance[],
): TriggerResult {
  let currentState = state;
  const descriptions: string[] = [];

  for (const trigger of triggers) {
    const card = currentState.cards.get(trigger.sourceCardId);
    if (!card) continue;

    // Create stack object for the triggered ability
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

/**
 * Sort triggers according to APNAP ordering (CR 603.3)
 * Active player's triggers go on stack first, then non-active in turn order
 */
function sortTriggersAPNAP(
  triggers: TriggeredAbilityInstance[],
  state: GameState,
  activePlayerId: PlayerId,
): TriggeredAbilityInstance[] {
  return [...triggers].sort((a, b) => {
    const aIsActive = a.triggeringPlayerId === activePlayerId;
    const bIsActive = b.triggeringPlayerId === activePlayerId;

    // Active player abilities go first (CR 603.3a)
    if (aIsActive && !bIsActive) return -1;
    if (!aIsActive && bIsActive) return 1;

    // Both active - use source card timestamp (CR 603.3b)
    if (aIsActive && bIsActive) {
      if (a.sourceCardTimestamp !== b.sourceCardTimestamp) {
        return a.sourceCardTimestamp - b.sourceCardTimestamp;
      }
      return 0;
    }

    // Both non-active - use turn order position (CR 603.3a)
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

    // Same player - use source card timestamp
    if (a.sourceCardTimestamp !== b.sourceCardTimestamp) {
      return a.sourceCardTimestamp - b.sourceCardTimestamp;
    }

    return 0;
  });
}

/**
 * Evaluate an intervening "if" clause for the trigger-system detect functions.
 *
 * Delegates to the shared {@link evaluateInterveningIfClause} in `abilities.ts`
 * so the trigger-time gate (CR 603.4) uses exactly the same logic as the
 * resolution-time re-check, and so that an unrecognised clause evaluates to
 * `false` rather than the previous (illegal) `true`.
 */
function evaluateStateCondition(
  condition: string,
  state: GameState,
  playerId: PlayerId,
): boolean {
  return evaluateInterveningIfClause(condition, state, playerId);
}

/**
 * Check if a spell matches a specified type for trigger conditions
 * Example: "Whenever you cast a sorcery"
 */
function checkSpellTypeMatch(
  spellCard: CardInstance["cardData"],
  spellType: string,
): boolean {
  const typeLine = spellCard.type_line?.toLowerCase() || "";
  const oracleText = spellCard.oracle_text?.toLowerCase() || "";

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
      return true; // Any spell
    default:
      return false;
  }
}

/**
 * Type definition for parsed triggered ability from card oracle text
 */
interface ParsedAbility {
  trigger: {
    event: string;
    source?: string;
    spellType?: string;
  };
  effect: string;
  interveningIf?: string;
}

/**
 * Get triggered abilities from card data.
 *
 * Detection is delegated to {@link parseTriggeredAbilities} in
 * `oracle-text-parser.ts` (resolves issue #1057): the previous implementation
 * used a single inline regex that could not separate the trigger condition,
 * the CR 603.4 intervening "if" clause, and the effect. The shared parser now
 * produces typed `{ trigger, effect, interveningIf }` objects, including the
 * intervening-if clause which the detect functions gate on at trigger time and
 * which is re-checked at resolution (CR 603.4).
 */
function getTriggeredAbilitiesFromCard(
  cardData: CardInstance["cardData"],
): ParsedAbility[] {
  return parseTriggeredAbilities(cardData.oracle_text || "").map((parsed) => ({
    trigger: {
      event: parsed.trigger.event,
      source: parsed.trigger.source,
      // The oracle parser does not emit a spellType; leaving it undefined makes
      // the spellCast detect branch fall back to "matches any spell".
      spellType: undefined,
    },
    effect: parsed.effect,
    interveningIf: parsed.interveningIf,
  }));
}

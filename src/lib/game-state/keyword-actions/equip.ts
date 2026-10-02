/**
 * Equip keyword ability (Comprehensive Rules, "Equip").
 *
 * "Equip [cost]" means "[Cost]: Attach this permanent to target creature you
 * control. Activate only as a sorcery." This leaf enforces that shape:
 *
 * - only an Equipment you control on the battlefield can be activated;
 * - only at sorcery speed (your turn, a main phase, empty stack, priority);
 * - the target must be a creature you control other than the Equipment, and
 *   protection still applies (`canBeEquippedBy`);
 * - the equip cost is paid on activation and the attach goes on the stack;
 * - on resolution the target is re-checked; if it is no longer legal the
 *   ability does nothing, otherwise the Equipment moves off any previous
 *   creature and onto the new one.
 *
 * Only the plain mana form ("Equip {2}") is parsed. Variants such as
 * "Equip legendary creature {1}" or non-mana costs are follow-ups.
 *
 * Issue #2300 (Standard remainder slice).
 */
import type {
  GameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
  StackObject,
} from "../types";
import { Phase } from "../types";
import { isPriorityPlayer } from "../priority-guard";
import { spendMana } from "../mana";
import { parseManaCost } from "../oracle-text-parser/mana-cost";
import type { ParsedManaCost } from "../oracle-text-parser/mana-cost";
import { canBeEquippedBy } from "../evergreen-keywords";
import { generateAbilityId } from "../abilities/ids";
import { KeywordActionResult } from "./shared";

const EQUIP_LINE = /^equip\s+((?:\{[^}]+\})+)\s*(?:\(|$)/im;

function isEquipment(card: CardInstance): boolean {
  return (card.cardData.type_line ?? "").toLowerCase().includes("equipment");
}

function isCreatureCard(card: CardInstance): boolean {
  return (card.cardData.type_line ?? "").toLowerCase().includes("creature");
}

function onBattlefieldOf(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): boolean {
  return (
    state.zones.get(`${playerId}-battlefield`)?.cardIds.includes(cardId) ??
    false
  );
}

/**
 * The mana cost of a card's plain "Equip {N}" ability, or null when it has
 * none (or only a variant this leaf does not parse yet).
 */
export function getEquipCost(card: CardInstance): ParsedManaCost | null {
  const match = (card.cardData.oracle_text ?? "").match(EQUIP_LINE);
  if (!match) return null;
  return parseManaCost(match[1]);
}

/**
 * Sorcery timing: the player is the active player, it is a main phase, the
 * stack is empty, and they hold priority.
 */
export function isSorceryTiming(state: GameState, playerId: PlayerId): boolean {
  const phase = state.turn.currentPhase;
  return (
    state.turn.activePlayerId === playerId &&
    (phase === Phase.PRECOMBAT_MAIN || phase === Phase.POSTCOMBAT_MAIN) &&
    state.stack.length === 0 &&
    isPriorityPlayer(state, playerId)
  );
}

/**
 * Whether `playerId` may activate equip on `equipmentId` targeting `targetId`.
 */
export function canEquip(
  state: GameState,
  playerId: PlayerId,
  equipmentId: CardInstanceId,
  targetId: CardInstanceId,
): { canEquip: boolean; reason?: string } {
  const equipment = state.cards.get(equipmentId);
  if (!equipment) return { canEquip: false, reason: "Equipment not found" };
  if (!isEquipment(equipment)) {
    return { canEquip: false, reason: "Only Equipment can equip" };
  }
  if (equipment.controllerId !== playerId) {
    return { canEquip: false, reason: "You do not control this Equipment" };
  }
  if (!onBattlefieldOf(state, playerId, equipmentId)) {
    return { canEquip: false, reason: "Equipment is not on the battlefield" };
  }
  if (!getEquipCost(equipment)) {
    return { canEquip: false, reason: "This Equipment has no equip cost" };
  }
  if (!isSorceryTiming(state, playerId)) {
    return {
      canEquip: false,
      reason: "Equip can only be activated as a sorcery",
    };
  }
  const targetCheck = checkEquipTarget(state, equipment, targetId);
  if (targetCheck) return { canEquip: false, reason: targetCheck };
  return { canEquip: true };
}

/** Target legality for equip; returns a reason, or null when legal. */
function checkEquipTarget(
  state: GameState,
  equipment: CardInstance,
  targetId: CardInstanceId,
): string | null {
  const target = state.cards.get(targetId);
  if (!target) return "Target not found";
  if (targetId === equipment.id) return "Equipment can't equip itself";
  if (!isCreatureCard(target)) return "Target must be a creature";
  if (target.controllerId !== equipment.controllerId) {
    return "Target must be a creature you control";
  }
  if (!onBattlefieldOf(state, equipment.controllerId, targetId)) {
    return "Target is not on the battlefield";
  }
  if (!canBeEquippedBy(target, equipment)) {
    return "Target can't be equipped by this Equipment";
  }
  return null;
}

/**
 * Attach an Equipment to a creature, moving it off any creature it was on.
 * Used by equip resolution; it does not check timing or costs.
 */
export function attachEquipment(
  state: GameState,
  equipmentId: CardInstanceId,
  targetId: CardInstanceId,
): KeywordActionResult {
  const equipment = state.cards.get(equipmentId);
  const target = state.cards.get(targetId);
  if (!equipment || !target) {
    return {
      success: false,
      state,
      description: "",
      error: "Equipment or target not found",
    };
  }
  if (equipment.attachedToId === targetId) {
    return {
      success: true,
      state,
      description: `${equipment.cardData.name} is already attached to ${target.cardData.name}`,
      affectedCards: [equipmentId],
    };
  }

  const cards = new Map(state.cards);
  const previousHostId = equipment.attachedToId;
  if (previousHostId) {
    const previousHost = cards.get(previousHostId);
    if (previousHost) {
      cards.set(previousHostId, {
        ...previousHost,
        attachedCardIds: previousHost.attachedCardIds.filter(
          (id) => id !== equipmentId,
        ),
      });
    }
  }
  cards.set(equipmentId, {
    ...equipment,
    attachedToId: targetId,
    attachedTimestamp: Date.now(),
  });
  const host = cards.get(targetId)!;
  cards.set(targetId, {
    ...host,
    attachedCardIds: [
      ...host.attachedCardIds.filter((id) => id !== equipmentId),
      equipmentId,
    ],
  });

  return {
    success: true,
    state: { ...state, cards, lastModifiedAt: Date.now() },
    description: `Attached ${equipment.cardData.name} to ${target.cardData.name}`,
    affectedCards: previousHostId
      ? [equipmentId, targetId, previousHostId]
      : [equipmentId, targetId],
  };
}

/**
 * Activate equip: validate, pay the equip cost, and put the attach on the
 * stack. Priority passes to the next player, as with other activations.
 */
export function activateEquip(
  state: GameState,
  playerId: PlayerId,
  equipmentId: CardInstanceId,
  targetId: CardInstanceId,
): KeywordActionResult {
  const check = canEquip(state, playerId, equipmentId, targetId);
  if (!check.canEquip) {
    return { success: false, state, description: "", error: check.reason };
  }
  const equipment = state.cards.get(equipmentId)!;
  const cost = getEquipCost(equipment)!;

  const paid = spendMana(state, playerId, {
    generic: cost.generic,
    colorless: cost.colorless,
    white: cost.white,
    blue: cost.blue,
    black: cost.black,
    red: cost.red,
    green: cost.green,
  });
  if (!paid.success) {
    return { success: false, state, description: "", error: "Not enough mana" };
  }

  const stackObject: StackObject = {
    id: generateAbilityId(),
    type: "ability",
    sourceCardId: equipmentId,
    controllerId: playerId,
    name: `${equipment.cardData.name} equip`,
    text: `Attach ${equipment.cardData.name} to target creature you control.`,
    manaCost: null,
    targets: [{ type: "card", targetId, isValid: true }],
    effects: [{ effectType: "attach", attachmentId: equipmentId, targetId }],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
  };

  const playerIds = Array.from(paid.state.players.keys());
  const nextPlayerId =
    playerIds[(playerIds.indexOf(playerId) + 1) % playerIds.length];
  const players = new Map(paid.state.players);
  const player = players.get(playerId);
  if (player) players.set(playerId, { ...player, hasPassedPriority: false });

  return {
    success: true,
    state: {
      ...paid.state,
      stack: [...paid.state.stack, stackObject],
      players,
      priorityPlayerId: nextPlayerId,
      consecutivePasses: 0,
      lastModifiedAt: Date.now(),
    },
    description: `Activated equip on ${equipment.cardData.name}`,
    affectedCards: [equipmentId, targetId],
  };
}

/**
 * Resolve an equip ability. The target is checked again (it may have left
 * the battlefield or changed control); if it is no longer legal, or the
 * Equipment has left the battlefield, the ability does nothing.
 */
export function resolveEquip(
  state: GameState,
  equipmentId: CardInstanceId,
  targetId: CardInstanceId,
): KeywordActionResult {
  const equipment = state.cards.get(equipmentId);
  if (
    !equipment ||
    !onBattlefieldOf(state, equipment.controllerId, equipmentId)
  ) {
    return {
      success: false,
      state,
      description: "Equipment left the battlefield; equip does nothing",
    };
  }
  const reason = checkEquipTarget(state, equipment, targetId);
  if (reason) {
    return {
      success: false,
      state,
      description: `Equip does nothing: ${reason.toLowerCase()}`,
    };
  }
  return attachEquipment(state, equipmentId, targetId);
}

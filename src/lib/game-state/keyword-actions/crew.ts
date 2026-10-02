/**
 * Crew keyword ability (Comprehensive Rules 702.122).
 *
 * "Crew N" means "Tap any number of other untapped creatures you control
 * with total power N or more: This permanent becomes an artifact creature
 * until end of turn." This leaf enforces that shape:
 *
 * - only a permanent you control on the battlefield with "Crew N" can crew;
 * - the crew must be other untapped creatures you control, each listed once,
 *   with total power of at least N. Summoning sickness does not stop a
 *   creature from crewing (crew is not a {T} ability of the creature);
 * - crew can be activated any time you have priority (no timing rule);
 * - tapping the crew is the cost, paid on activation; the "becomes a
 *   creature" effect goes on the stack;
 * - on resolution, if the Vehicle is still on the battlefield, it is a
 *   creature until end of turn (`crewedUntilEndOfTurn`), cleared when the
 *   next turn begins.
 *
 * "Crewed" triggers and crew-cost reductions are follow-ups.
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
import { ZoneType } from "../types";
import { isPriorityPlayer } from "../priority-guard";
import { isCreature, getPower } from "../card-instance";
import { generateAbilityId } from "../abilities/ids";
import { KeywordActionResult } from "./shared";

const CREW_LINE = /(?:^|\n)\s*crew (\d+)\b/i;

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

/** Whether the card's type line includes Vehicle. */
export function isVehicle(card: CardInstance): boolean {
  return (card.cardData.type_line ?? "").toLowerCase().includes("vehicle");
}

/** The N in "Crew N", or null when the card has no crew ability. */
export function getCrewPower(card: CardInstance): number | null {
  const match = (card.cardData.oracle_text ?? "").match(CREW_LINE);
  return match ? Number(match[1]) : null;
}

/** Validate a crew activation without changing state. */
export function canCrew(
  state: GameState,
  playerId: PlayerId,
  vehicleId: CardInstanceId,
  crewIds: CardInstanceId[],
): { canCrew: boolean; reason?: string } {
  const vehicle = state.cards.get(vehicleId);
  if (!vehicle) return { canCrew: false, reason: "Vehicle not found" };
  if (
    vehicle.controllerId !== playerId ||
    !onBattlefieldOf(state, playerId, vehicleId)
  ) {
    return {
      canCrew: false,
      reason: "You can only crew a Vehicle you control on the battlefield",
    };
  }
  const crewPower = getCrewPower(vehicle);
  if (crewPower === null) {
    return {
      canCrew: false,
      reason: `${vehicle.cardData.name} has no crew ability`,
    };
  }
  if (!isPriorityPlayer(state, playerId)) {
    return { canCrew: false, reason: "You don't have priority" };
  }
  if (new Set(crewIds).size !== crewIds.length) {
    return { canCrew: false, reason: "Each creature can only be tapped once" };
  }

  let total = 0;
  for (const crewId of crewIds) {
    if (crewId === vehicleId) {
      return { canCrew: false, reason: "A Vehicle can't crew itself" };
    }
    const crew = state.cards.get(crewId);
    if (
      !crew ||
      crew.controllerId !== playerId ||
      !onBattlefieldOf(state, playerId, crewId) ||
      crew.isPhasedOut
    ) {
      return { canCrew: false, reason: "Crew must be creatures you control" };
    }
    if (!isCreature(crew)) {
      return {
        canCrew: false,
        reason: `${crew.cardData.name} is not a creature`,
      };
    }
    if (crew.isTapped) {
      return {
        canCrew: false,
        reason: `${crew.cardData.name} is already tapped`,
      };
    }
    total += Math.max(0, getPower(crew));
  }
  if (total < crewPower) {
    return {
      canCrew: false,
      reason: `Crew ${crewPower} needs total power ${crewPower} or more (got ${total})`,
    };
  }
  return { canCrew: true };
}

/**
 * Activate crew: validate, tap the crew as the cost, and put the
 * "becomes an artifact creature" effect on the stack. Priority passes to
 * the next player, as with other activations.
 */
export function activateCrew(
  state: GameState,
  playerId: PlayerId,
  vehicleId: CardInstanceId,
  crewIds: CardInstanceId[],
): KeywordActionResult {
  const check = canCrew(state, playerId, vehicleId, crewIds);
  if (!check.canCrew) {
    return { success: false, state, description: "", error: check.reason };
  }
  const vehicle = state.cards.get(vehicleId)!;

  const cards = new Map(state.cards);
  for (const crewId of crewIds) {
    cards.set(crewId, { ...cards.get(crewId)!, isTapped: true });
  }

  const stackObject: StackObject = {
    id: generateAbilityId(),
    type: "ability",
    sourceCardId: vehicleId,
    controllerId: playerId,
    name: `${vehicle.cardData.name} crew`,
    text: `${vehicle.cardData.name} becomes an artifact creature until end of turn.`,
    manaCost: null,
    targets: [],
    effects: [{ effectType: "crew", vehicleId }],
    chosenModes: [],
    variableValues: new Map(),
    isCountered: false,
    timestamp: Date.now(),
  };

  const playerIds = Array.from(state.players.keys());
  const nextPlayerId =
    playerIds[(playerIds.indexOf(playerId) + 1) % playerIds.length];
  const players = new Map(state.players);
  const player = players.get(playerId);
  if (player) players.set(playerId, { ...player, hasPassedPriority: false });

  return {
    success: true,
    state: {
      ...state,
      cards,
      stack: [...state.stack, stackObject],
      players,
      priorityPlayerId: nextPlayerId,
      consecutivePasses: 0,
      lastModifiedAt: Date.now(),
    },
    description: `Crewed ${vehicle.cardData.name}`,
    affectedCards: [vehicleId, ...crewIds],
  };
}

/**
 * Resolve a crew ability: if the Vehicle is still on the battlefield it
 * becomes an artifact creature until end of turn.
 */
export function resolveCrew(
  state: GameState,
  vehicleId: CardInstanceId,
): KeywordActionResult {
  const vehicle = state.cards.get(vehicleId);
  if (!vehicle || !onBattlefieldOf(state, vehicle.controllerId, vehicleId)) {
    return {
      success: false,
      state,
      description: "Vehicle left the battlefield; crew does nothing",
    };
  }
  const cards = new Map(state.cards);
  cards.set(vehicleId, { ...vehicle, crewedUntilEndOfTurn: true });
  return {
    success: true,
    state: { ...state, cards, lastModifiedAt: Date.now() },
    description: `${vehicle.cardData.name} is an artifact creature until end of turn`,
    affectedCards: [vehicleId],
  };
}

/** End the "until end of turn" crew effect on every crewed Vehicle. */
export function clearCrewedVehicles(state: GameState): GameState {
  let changed = false;
  const cards = new Map(state.cards);
  for (const [, zone] of state.zones) {
    if (zone.type !== ZoneType.BATTLEFIELD) continue;
    for (const cardId of zone.cardIds) {
      const card = cards.get(cardId);
      if (card?.crewedUntilEndOfTurn) {
        cards.set(cardId, { ...card, crewedUntilEndOfTurn: false });
        changed = true;
      }
    }
  }
  return changed ? { ...state, cards } : state;
}

/**
 * Landfall ability word (CR 207.2c).
 *
 * "Landfall — Whenever a land you control enters, ..." (older wording:
 * "Whenever a land enters the battlefield under your control"). The trigger
 * parser maps both forms to the "landfall" event; this leaf fires it when a
 * land enters the battlefield, for permanents controlled by that land's
 * controller only. The triggered abilities go on the stack through the
 * shared trigger path.
 *
 * Wired into playing a land (`playLand`) and putting a land onto the
 * battlefield (`moveCardToZone`). Lands that enter as part of a resolving
 * spell's own battlefield move use the same `moveCardToZone` path.
 *
 * Issue #2300 (Standard remainder slice).
 */
import type { GameState, CardInstanceId } from "../types";
import { detectTriggeredAbilities } from "../abilities/triggered";
import type { TriggeredAbilityInstance } from "../abilities/types";
import { putTriggersOnStack } from "../trigger-system/stack-ops";

function isLandCard(state: GameState, cardId: CardInstanceId): boolean {
  const card = state.cards.get(cardId);
  return (card?.cardData.type_line ?? "").toLowerCase().includes("land");
}

/** Landfall triggers for a land that just entered the battlefield. */
export function detectLandfallTriggers(
  state: GameState,
  landId: CardInstanceId,
): TriggeredAbilityInstance[] {
  const land = state.cards.get(landId);
  if (!land || !isLandCard(state, landId)) return [];
  if (!state.zones.get(`${land.controllerId}-battlefield`)?.cardIds.includes(landId)) {
    return [];
  }
  return detectTriggeredAbilities(state, "landfall", {
    sourceCardId: landId,
    landCardId: landId,
    landControllerId: land.controllerId,
  });
}

/** Put every landfall trigger for this land onto the stack. */
export function fireLandfallTriggers(
  state: GameState,
  landId: CardInstanceId,
): GameState {
  const triggers = detectLandfallTriggers(state, landId);
  if (triggers.length === 0) return state;
  return putTriggersOnStack(state, triggers).state;
}

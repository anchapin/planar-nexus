/**
 * Scripted land-play rules (#2614 Icetill Explorer): "You may play an
 * additional land on each of your turns" (CR 305.2) and "You may play lands
 * from your graveyard" (CR 305.1). Both come from permanents the player
 * controls, read from each card script's `land_rules`.
 */
import type { GameState, PlayerId } from "../types";
import { getCardScript } from "../card-scripts/registry";

function controlledLandRules(state: GameState, playerId: PlayerId) {
  const zone = state.zones.get(`${playerId}-battlefield`);
  const out: { extra_land_plays?: number; from_graveyard?: boolean }[] = [];
  if (!zone) return out;
  for (const id of zone.cardIds) {
    const card = state.cards.get(id);
    if (!card || card.controllerId !== playerId) continue;
    const rules = getCardScript(card.cardData.name)?.land_rules;
    if (rules) out.push(rules);
  }
  return out;
}

/** Extra land plays this turn granted by permanents the player controls. */
export function extraLandPlays(state: GameState, playerId: PlayerId): number {
  return controlledLandRules(state, playerId).reduce(
    (n, r) => n + (r.extra_land_plays ?? 0),
    0,
  );
}

/** True when a permanent the player controls lets them play graveyard lands. */
export function canPlayLandsFromGraveyard(
  state: GameState,
  playerId: PlayerId,
): boolean {
  return controlledLandRules(state, playerId).some((r) => r.from_graveyard);
}
